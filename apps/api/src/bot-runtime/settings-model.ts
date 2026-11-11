import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import type { KeyboardStateRow, PreparedUpdate } from './contracts.js';
import type { TopicMenuHelpers } from './handlers/topic-menu.js';
import { buildTopicPack } from './handlers/topic-menu.js';

export const SETTINGS_LEVELS = ['a1', 'a2', 'b1', 'b2', 'c1'] as const;
export type SettingsAction = { variant: 'r' | 'w'; kind: 'open' | 'home' | 'close' | 'page' | 'level' | 'reply' | 'topic'; value: string };
export class SettingsInputError extends Error {}
export function parseSettingsAction(data: string): SettingsAction {
  const [group, variant, kind, value = '', extra] = data.split(':');
  if (Buffer.byteLength(data) > 64 || group !== 'settings' || (variant !== 'r' && variant !== 'w') || extra !== undefined) throw new SettingsInputError('invalid');
  const valid = ['open','home','close'].includes(kind) ? !value
    : kind === 'level' ? SETTINGS_LEVELS.includes(value as typeof SETTINGS_LEVELS[number])
    : kind === 'reply' ? ['voice','text'].includes(value)
    : kind === 'page' ? /^(0|[1-9]\d{0,4})$/.test(value)
    : kind === 'topic' && (value === 'free' || /^[a-f0-9]{16}$/.test(value));
  if (!valid) throw new SettingsInputError('invalid');
  return { variant, kind: kind as SettingsAction['kind'], value };
}
export const topicToken = (id: unknown) => createHash('sha256').update(String(id)).digest('hex').slice(0,16);
export const shortText = (value: unknown, max = 32) => Array.from(String(value ?? '').replace(/\u0000/g, '')).slice(0,max).join('');
export interface SettingsView {
  v: number; l: string; r: string; t: string; n: string;
  p: number; pages: number; o: Array<[string,string]>; screen: 'home' | 'topics' | 'closed'; e?: string;
}
export function settingsView(row: KeyboardStateRow, catalog: Record<string, unknown>[], action: SettingsAction, freeLabel: string): SettingsView {
  const pack = typeof row.topic_pack_json === 'string' ? JSON.parse(row.topic_pack_json) : row.topic_pack_json;
  const current = row.topic_enabled ? String(row.topic_template_id || '') : '';
  const pages = Math.max(1, Math.ceil(catalog.length / 3));
  const p = Math.min(action.kind === 'page' ? Number(action.value) : 0, pages - 1);
  return {
    v: Date.now(), l: String(row.level || 'a1'), r: String(row.reply_mode || 'voice'),
    t: current ? topicToken(current) : 'free',
    n: shortText(current ? (pack as Record<string, unknown>)?.title_base || current : freeLabel, 36),
    p, pages, o: action.kind === 'page' ? catalog.slice(p*3,p*3+3).map(t => [topicToken(t.topic_id), shortText(t.title_base || t.topic_id)]) : [],
    screen: action.kind === 'page' ? 'topics' : action.kind === 'close' ? 'closed' : 'home'
  };
}
export async function accessibleSettingsCatalog(helpers: TopicMenuHelpers, chatId: number, botKey: string) {
  const tier = await helpers.fetchEffectiveTierForChat(chatId);
  return (await helpers.fetchTopicCatalogRows(botKey,{ userTier: tier }))
    .filter(t => String(t.access_tier || 'all') !== 'pro' || tier === 'pro');
}
// Called inside the durable effect transaction. No network or AI calls here.
export async function applySettingsAction(client: PoolClient, update: PreparedUpdate, action: SettingsAction, catalog: Record<string,unknown>[]) {
  const scope = [update.input.chatId, update.botKey];
  const current = await client.query('SELECT level, topic_pinned_message_id FROM user_bots WHERE chat_id = $1 AND bot_key = $2 FOR UPDATE', scope);
  if (!current.rows[0]) throw new SettingsInputError('missing');
  if (action.kind === 'level' || action.kind === 'reply') {
    const column = action.kind === 'level' ? 'level' : 'reply_mode';
    await client.query(`UPDATE user_bots SET ${column} = $3, updated_at = NOW() WHERE chat_id = $1 AND bot_key = $2`, [...scope, action.value]);
    return { oldPin: null };
  }
  if (action.kind !== 'topic') return { oldPin: null };
  const topic = action.value === 'free' ? null : catalog.find(t => topicToken(t.topic_id) === action.value);
  if (action.value !== 'free' && !topic) throw new SettingsInputError('topic');
  const pack = topic ? buildTopicPack(topic, current.rows[0].level) : null;
  // The settings form selects a topic without sending an unsolicited opening question.
  if (pack) { pack.turns_in_topic = 0; pack.last_assistant_question = ''; }
  await client.query(`UPDATE user_bots SET topic_enabled = $3, topic_template_id = $4,
    topic_pack_json = $5::jsonb, topic_pinned_message_id = NULL, topic_updated_at = NOW(), updated_at = NOW()
    WHERE chat_id = $1 AND bot_key = $2`, [...scope, Boolean(topic), topic?.topic_id || null, pack ? JSON.stringify(pack) : null]);
  await client.query(`INSERT INTO action_events (chat_id, bot_key, action_type, source, properties, occurred_at)
    VALUES ($1, $2, $3, 'bot_runtime', $4::jsonb, NOW())`, [...scope, topic ? 'topic_set' : 'topic_clear', JSON.stringify({ topic_id: topic?.topic_id || null, via: 'settings' })]);
  return { oldPin: Number(current.rows[0].topic_pinned_message_id) || null };
}
