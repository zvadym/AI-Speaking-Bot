const MAX_FIELD_VALUE_LEN = 1024;
const MAX_DESCRIPTION_LEN = 4000;
const MAX_LINE_LEN = 240;

function cleanLine(value, maxLength = MAX_LINE_LEN) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function cleanText(value, maxLength = MAX_DESCRIPTION_LEN) {
  return String(value ?? '')
    .replace(/\r\n?/g, '\n')
    .trim()
    .slice(0, maxLength);
}

function maskMentions(value) {
  return String(value ?? '').replace(/@/g, '@\u200b');
}

function field(name, value, inline = false) {
  const normalizedName = cleanLine(name, 128) || 'Field';
  const normalizedValue = cleanText(value, MAX_FIELD_VALUE_LEN) || '-';
  return {
    name: normalizedName,
    value: maskMentions(normalizedValue),
    inline
  };
}

function botLabel(botKey, botMetaForKey) {
  const normalizedBotKey = cleanLine(botKey, 64);
  if (!normalizedBotKey) return 'unknown';
  const meta = typeof botMetaForKey === 'function' ? botMetaForKey(normalizedBotKey) : null;
  const botName = cleanLine(meta?.bot_name || '', 120);
  return botName ? `${normalizedBotKey} (${botName})` : normalizedBotKey;
}

function userLabel(event) {
  const username = cleanLine(event.username || '', 80);
  const firstName = cleanLine(event.first_name || '', 80);
  const chatId = Number(event.chat_id);
  const parts = [];

  if (firstName) parts.push(firstName);
  if (username) parts.push(`@${username}`);
  if (Number.isFinite(chatId) && chatId > 0) parts.push(`chat_id=${chatId}`);

  return parts.join(' | ') || 'unknown';
}

function buildNewPaidUserEmbed(event, botMetaForKey) {
  return {
    title: 'New paid user',
    color: 0x2ecc71,
    fields: [
      field('User', userLabel(event)),
      field('Plan', cleanLine(event.plan_tier || 'paid', 64), true),
      field('Bot', botLabel(event.bot_key, botMetaForKey), true),
      field('Status', cleanLine(event.status || 'active', 64), true),
      field('Price ID', cleanLine(event.price_id || '', 120) || '-', false),
      field('Currency', cleanLine(event.currency || '', 24) || '-', true),
      field('Subscription ID', cleanLine(event.subscription_id || '', 120) || '-', false)
    ],
    timestamp: new Date().toISOString()
  };
}

function buildUserMilestoneEmbed(event, botMetaForKey) {
  const totalUsers = Number(event.total_users);
  const milestone = Number(event.milestone);

  return {
    title: `User milestone reached: ${Number.isFinite(milestone) ? milestone : totalUsers}`,
    color: 0x3498db,
    description: Number.isFinite(totalUsers) && totalUsers > 0
      ? `Total users: ${totalUsers}`
      : '',
    fields: [
      field('Latest user', userLabel(event)),
      field('Bot', botLabel(event.bot_key, botMetaForKey), true)
    ],
    timestamp: new Date().toISOString()
  };
}

function buildUserFeedbackEmbed(event, botMetaForKey) {
  const category = cleanLine(event.category || '', 64) || 'unknown';
  const source = cleanLine(event.source || '', 64) || 'unknown';
  const kind = cleanLine(event.kind || '', 64) || 'text';
  const message = cleanText(event.feedback_text || event.text || '', 1500) || '(empty)';

  return {
    title: 'New user feedback',
    color: 0xf39c12,
    description: maskMentions(message),
    fields: [
      field('User', userLabel(event)),
      field('Category', category, true),
      field('Bot', botLabel(event.bot_key, botMetaForKey), true),
      field('Source', source, true),
      field('Kind', kind, true),
      field('Feedback ID', cleanLine(event.feedback_id || event.id || '', 120) || '-', true)
    ],
    timestamp: new Date().toISOString()
  };
}

function buildEmbed(event, botMetaForKey) {
  const type = cleanLine(event?.type || '', 64);
  if (type === 'new_paid_user') {
    return buildNewPaidUserEmbed(event, botMetaForKey);
  }
  if (type === 'user_milestone') {
    return buildUserMilestoneEmbed(event, botMetaForKey);
  }
  if (type === 'user_feedback') {
    return buildUserFeedbackEmbed(event, botMetaForKey);
  }
  throw new Error(`unsupported_discord_event_type:${type || 'unknown'}`);
}

export async function sendDiscordEventNotification({
  webhookUrl,
  event,
  botMetaForKey,
  fetchImpl = fetch
}) {
  const normalizedWebhookUrl = cleanLine(webhookUrl, 2048);
  if (!normalizedWebhookUrl) {
    return { ok: false, skipped: true, reason: 'webhook_not_configured' };
  }

  const embed = buildEmbed(event || {}, botMetaForKey);
  const payload = {
    username: 'AI School Events',
    allowed_mentions: { parse: [] },
    embeds: [embed]
  };

  let response = null;
  try {
    response = await fetchImpl(normalizedWebhookUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify(payload)
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'network_error';
    throw new Error(`discord_webhook_network_error:${message}`);
  }

  if (!response.ok) {
    const errorText = cleanText(await response.text().catch(() => ''), 500);
    throw new Error(`discord_webhook_failed:${response.status}:${errorText || 'unknown_error'}`);
  }

  return {
    ok: true,
    type: cleanLine(event?.type || '', 64) || 'unknown'
  };
}

/** @typedef {{name: string, data: Uint8Array, contentType: string}} DiscordFeedbackAttachment */

export class DiscordFeedbackDeliveryError extends Error {
  constructor(kind, code, retryAfterMs = 0) {
    super(code);
    this.name = 'DiscordFeedbackDeliveryError';
    this.kind = kind;
    this.code = code;
    this.retryAfterMs = retryAfterMs;
  }
}

/**
 * Dedicated feedback sender: successful acknowledgement includes the Discord ID.
 * Network/5xx failures can follow acceptance, so callers must retain unknown state.
 * @param {{webhookUrl: string, event: Record<string, unknown>, attachments?: DiscordFeedbackAttachment[], botMetaForKey?: (key: string) => unknown, fetchImpl?: typeof fetch}} options
 */
export async function sendDiscordFeedbackNotification({ webhookUrl, event, attachments = [], botMetaForKey, fetchImpl = fetch }) {
  let url;
  try { url = new URL(webhookUrl); } catch { throw new DiscordFeedbackDeliveryError('permanent', 'discord_feedback_webhook_invalid'); }
  url.searchParams.set('wait', 'true');
  const embed = buildUserFeedbackEmbed(event, botMetaForKey);
  const fullText = String(event.feedback_text || event.text || '').replace(/\r\n?/g, '\n').trim();
  const files = [...attachments];
  if (event.created_at && Number.isFinite(new Date(event.created_at).getTime())) embed.timestamp = new Date(event.created_at).toISOString();
  if (fullText.length > 1500) {
    files.push({ name: 'feedback.txt', data: new TextEncoder().encode(fullText), contentType: 'text/plain; charset=utf-8' });
    embed.description += '\n\nFull text is attached in feedback.txt.';
  }
  const payload = {
    username: 'AI School Events', allowed_mentions: { parse: [] }, embeds: [embed],
    attachments: files.map((file, id) => ({ id, filename: file.name }))
  };
  const body = new FormData();
  body.set('payload_json', JSON.stringify(payload));
  files.forEach((file, id) => body.set(`files[${id}]`, new Blob([new Uint8Array(file.data)], { type: file.contentType }), file.name));
  let response;
  try {
    response = await fetchImpl(url.toString(), { method: 'POST', body, signal: AbortSignal.timeout(15000) });
  } catch {
    throw new DiscordFeedbackDeliveryError('unknown', 'discord_feedback_send_ambiguous');
  }
  if (response.status === 429) {
    const result = await response.json().catch(() => ({}));
    const seconds = Number(result.retry_after || response.headers.get('retry-after') || 30);
    throw new DiscordFeedbackDeliveryError('retryable', 'discord_feedback_rate_limited', Math.max(1000, Math.min(3600000, (Number.isFinite(seconds) ? seconds : 30) * 1000)));
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new DiscordFeedbackDeliveryError(response.status >= 500 ? 'unknown' : 'permanent', `discord_feedback_http_${response.status}`);
  }
  let result;
  try { result = await response.json(); } catch { throw new DiscordFeedbackDeliveryError('unknown', 'discord_feedback_ack_invalid'); }
  if (!result || typeof result.id !== 'string' || !/^\d+$/.test(result.id)) {
    throw new DiscordFeedbackDeliveryError('unknown', 'discord_feedback_ack_invalid');
  }
  return { messageId: result.id };
}
