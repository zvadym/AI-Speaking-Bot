type TelegramUpdate = Record<string, unknown>;

export function messageUpdate({
  updateId = 1000,
  text,
  voice,
  chatId = 42,
  chatType = 'private',
  senderIsBot = false,
  extraMessage = {}
}: {
  updateId?: number;
  text?: string;
  voice?: Record<string, unknown>;
  chatId?: number;
  chatType?: string;
  senderIsBot?: boolean;
  extraMessage?: Record<string, unknown>;
} = {}): TelegramUpdate {
  return {
    update_id: updateId,
    message: {
      message_id: updateId + 100,
      ...(text === undefined ? {} : { text }),
      ...(voice === undefined ? {} : { voice }),
      chat: { id: chatId, type: chatType },
      from: {
        id: 42,
        is_bot: senderIsBot,
        username: 'alice',
        first_name: 'Alice',
        language_code: 'uk'
      },
      ...extraMessage
    }
  };
}

export function callbackUpdate({
  updateId = 2000,
  data,
  chatId = 42,
  chatType = 'private',
  senderIsBot = false
}: {
  updateId?: number;
  data: string;
  chatId?: number;
  chatType?: string;
  senderIsBot?: boolean;
}): TelegramUpdate {
  return {
    update_id: updateId,
    callback_query: {
      id: `callback-${updateId}`,
      data,
      from: {
        id: 42,
        is_bot: senderIsBot,
        username: 'alice',
        first_name: 'Alice',
        language_code: 'uk'
      },
      message: {
        message_id: updateId + 200,
        text: 'Assistant reply',
        chat: { id: chatId, type: chatType }
      }
    }
  };
}

export const voice = {
  file_id: 'voice-file-1',
  duration: 4
};
