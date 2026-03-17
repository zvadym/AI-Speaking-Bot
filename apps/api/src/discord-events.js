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

function buildN8nErrorEmbed(event, botMetaForKey) {
  return {
    title: 'n8n execution error',
    color: 0xe74c3c,
    description: maskMentions(cleanText(event.error_message || event.message || 'Execution failed', 1500)),
    fields: [
      field('Workflow', cleanLine(event.workflow_name || '', 160) || cleanLine(event.workflow_id || '', 120) || 'unknown'),
      field('Execution ID', cleanLine(event.execution_id || '', 120) || '-', true),
      field('Bot', botLabel(event.bot_key, botMetaForKey), true),
      field('Mode', cleanLine(event.mode || '', 64) || '-', true),
      field('Last Node', cleanLine(event.last_node || '', 160) || '-', false),
      field('URL', cleanLine(event.url || '', 300) || '-', false)
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
  if (type === 'n8n_execution_error') {
    return buildN8nErrorEmbed(event, botMetaForKey);
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
