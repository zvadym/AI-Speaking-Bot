import { createHmac, timingSafeEqual } from 'node:crypto';

export function deriveTelegramWebhookSecret({
  botKey,
  botToken,
  signingSecret
}: {
  botKey: string;
  botToken: string;
  signingSecret: string;
}): string {
  if (!botKey || !botToken || !signingSecret) {
    throw new Error('telegram_webhook_secret_inputs_missing');
  }
  return createHmac('sha256', signingSecret)
    .update(`telegram-webhook:v1:${botKey}:${botToken}`)
    .digest('hex');
}

export function verifyTelegramWebhookSecret(actual: unknown, expected: string): boolean {
  const left = Buffer.from(String(actual || ''), 'utf8');
  const right = Buffer.from(expected, 'utf8');
  return left.length === right.length && timingSafeEqual(left, right);
}
