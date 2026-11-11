import { classifyTelegramDeliveryError } from './telegram-text-delivery.js';

export interface ReservedSettingsDelivery {
  id: string;
  step_key: string;
  telegram_method: string;
  status: string;
  telegram_message_id: number | null;
  send: boolean;
}

export interface SettingsDeliveryResult {
  id: string;
  status: string;
  message_id: number | null;
  error_code: string | null;
}

// Only explicitly reserved attempts may send. Pending/unknown attempts from a
// previous request may already exist in Telegram, so replay must not resend them.
export async function sendReservedSettingsMessages({ deliveries, chatId, richMessage, title, replyMarkup, api }: {
  deliveries: ReservedSettingsDelivery[];
  chatId: number;
  richMessage: object;
  title: string;
  replyMarkup: object;
  api(method: string, body: Record<string, unknown>): Promise<unknown>;
}) {
  const outcomes = await Promise.all(deliveries.map(async delivery => {
    const base = {id:delivery.id,message_id:delivery.telegram_message_id};
    if (delivery.status === 'delivered') return {...base,status:'delivered',error_code:null,retryable:false};
    const card = delivery.step_key === 'settings:open:r:v1';
    if (!delivery.send || delivery.telegram_method !== (card ? 'sendRichMessage' : 'sendMessage')) {
      return {...base,status:'unknown',error_code:'previous_attempt_incomplete',retryable:false};
    }
    try {
      const result = await api(delivery.telegram_method, card
        ? {chat_id:chatId,rich_message:richMessage}
        : {chat_id:chatId,text:title,reply_markup:replyMarkup}) as {message_id?:unknown} | null;
      const messageId = Number(result?.message_id);
      if (!Number.isSafeInteger(messageId) || messageId <= 0) {
        return {...base,status:'unknown',error_code:'telegram_delivery_response_unknown',retryable:false};
      }
      return {...base,status:'delivered',message_id:messageId,error_code:null,retryable:false};
    } catch (error) {
      const failure = classifyTelegramDeliveryError(error);
      return {...base,status:failure.kind === 'unknown' ? 'unknown' : 'failed',
        error_code:failure.errorCode,retryable:failure.kind === 'retryable'};
    }
  }));
  // Unknown/permanent failures take precedence; a new user tap can safely start
  // a new delivery, whereas replaying this same update risks a duplicate.
  const failure = outcomes.find(o => o.status !== 'delivered' && !o.retryable)
    || outcomes.find(o => o.status !== 'delivered');
  return {
    deliveries:outcomes as SettingsDeliveryResult[],
    status:failure ? (failure.retryable ? 'retryable_failed' : 'permanent_failed') : 'succeeded',
    errorCode:failure?.error_code || null
  };
}
