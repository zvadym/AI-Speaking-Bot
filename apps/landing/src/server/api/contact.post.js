import {
  createError,
  defineEventHandler,
  getHeader,
  getRequestIP,
  getRequestURL,
  readBody,
  setResponseStatus
} from 'h3';

const MAX_NAME_LENGTH = 80;
const MAX_CONTACT_LENGTH = 160;
const MAX_MESSAGE_LENGTH = 2000;
const MAX_META_LENGTH = 300;

function cleanLine(value, maxLength) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function cleanText(value, maxLength) {
  return String(value ?? '')
    .replace(/\r\n?/g, '\n')
    .trim()
    .slice(0, maxLength);
}

function maskMentions(value) {
  return String(value ?? '').replace(/@/g, '@\u200b');
}

function field(name, value, inline = false) {
  return {
    name,
    value: value || '—',
    inline
  };
}

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig(event);
  const webhookUrl = String(config.discordContactWebhookUrl || '').trim();

  if (!webhookUrl) {
    throw createError({
      statusCode: 503,
      statusMessage: 'contact_disabled',
      data: { error: 'contact_disabled' }
    });
  }

  const body = (await readBody(event)) || {};
  const trap = cleanLine(body.website, 120);
  if (trap) {
    setResponseStatus(event, 202);
    return { ok: true };
  }

  const name = cleanLine(body.name, MAX_NAME_LENGTH);
  const contact = cleanLine(body.contact, MAX_CONTACT_LENGTH);
  const message = cleanText(body.message, MAX_MESSAGE_LENGTH);
  const locale = cleanLine(body.locale, 24);
  const pageUrl = cleanLine(body.pageUrl || getRequestURL(event).toString(), MAX_META_LENGTH);
  const referrer = cleanLine(getHeader(event, 'referer') || '', MAX_META_LENGTH);
  const userAgent = cleanLine(getHeader(event, 'user-agent') || '', MAX_META_LENGTH);
  const ipAddress = cleanLine(getRequestIP(event, { xForwardedFor: true }) || '', 80);

  if (name.length < 2) {
    throw createError({
      statusCode: 400,
      statusMessage: 'invalid_name',
      data: { error: 'invalid_name' }
    });
  }

  if (contact.length < 3) {
    throw createError({
      statusCode: 400,
      statusMessage: 'invalid_contact',
      data: { error: 'invalid_contact' }
    });
  }

  if (message.length < 10) {
    throw createError({
      statusCode: 400,
      statusMessage: 'invalid_message',
      data: { error: 'invalid_message' }
    });
  }

  const payload = {
    username: 'Landing Contact',
    allowed_mentions: { parse: [] },
    embeds: [
      {
        title: 'New landing contact',
        color: 0x229ed9,
        description: maskMentions(message).slice(0, MAX_MESSAGE_LENGTH),
        fields: [
          field('Name', maskMentions(name), true),
          field('Reply Contact', maskMentions(contact), true),
          field('Locale', locale || 'unknown', true),
          field('Page', pageUrl),
          field('Referrer', referrer),
          field('IP', ipAddress, true),
          field('User-Agent', userAgent)
        ],
        timestamp: new Date().toISOString()
      }
    ]
  };

  let resp = null;
  try {
    resp = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json'
      },
      body: JSON.stringify(payload)
    });
  } catch (err) {
    throw createError({
      statusCode: 502,
      statusMessage: 'discord_webhook_failed',
      data: {
        error: 'discord_webhook_failed',
        details: err instanceof Error ? err.message : 'network_error'
      }
    });
  }

  if (!resp.ok) {
    const errorText = (await resp.text().catch(() => '')).slice(0, 500);
    throw createError({
      statusCode: 502,
      statusMessage: 'discord_webhook_failed',
      data: {
        error: 'discord_webhook_failed',
        details: errorText
      }
    });
  }

  return { ok: true };
});
