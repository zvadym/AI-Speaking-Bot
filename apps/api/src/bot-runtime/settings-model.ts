import type { PoolClient } from 'pg';
import type { KeyboardStateRow, PreparedUpdate } from './contracts.js';

export const SETTINGS_LEVELS = ['a1', 'a2', 'b1', 'b2', 'c1'] as const;
export type SettingsAction = { variant: 'r' | 'w'; kind: 'open' | 'home' | 'close' | 'level' | 'reply'; value: string };
export class SettingsInputError extends Error {}
export function parseSettingsAction(data: string): SettingsAction {
  const [group, variant, kind, value = '', extra] = data.split(':');
  if (Buffer.byteLength(data) > 64 || group !== 'settings' || (variant !== 'r' && variant !== 'w') || extra !== undefined) throw new SettingsInputError('invalid');
  const valid = ['open','home','close'].includes(kind) ? !value
    : kind === 'level' ? SETTINGS_LEVELS.includes(value as typeof SETTINGS_LEVELS[number])
    : kind === 'reply' && ['voice','text'].includes(value);
  if (!valid) throw new SettingsInputError('invalid');
  return { variant, kind: kind as SettingsAction['kind'], value };
}
export interface SettingsView { v: number; l: string; r: string; e?: string }
export function settingsView(row: KeyboardStateRow): SettingsView {
  return { v: Date.now(), l: String(row.level || 'a1'), r: String(row.reply_mode || 'voice') };
}
// Called inside the durable effect transaction. No network or AI calls here.
export async function applySettingsAction(client: PoolClient, update: PreparedUpdate, action: SettingsAction) {
  if (action.kind !== 'level' && action.kind !== 'reply') return {};
  const column = action.kind === 'level' ? 'level' : 'reply_mode';
  const changed = await client.query(`UPDATE user_bots SET ${column} = $3, updated_at = NOW() WHERE chat_id = $1 AND bot_key = $2 RETURNING chat_id`, [update.input.chatId, update.botKey, action.value]);
  if (!changed.rowCount) throw new SettingsInputError('missing');
  return {};
}
