// Deleting an already deleted card is a successful replay, including after an
// ambiguous network failure. Other Telegram errors must retain their retry policy.
export async function deleteSettingsMessage(
  api: (method: string, body: Record<string, unknown>) => Promise<unknown>,
  chatId: number, messageId: number
): Promise<void> {
  try {
    await api('deleteMessage', {chat_id: chatId, message_id: messageId});
  } catch (error) {
    const failure = error as {telegramDescription?: string; message?: string};
    if (!String(failure.telegramDescription || failure.message).toLowerCase().includes('message to delete not found')) throw error;
  }
}
