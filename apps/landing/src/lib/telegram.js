export function getDefaultTelegramBotUrl() {
  const raw = (import.meta.env.VITE_TELEGRAM_BOT_URL || '').toString().trim();
  return raw || '';
}

export function getTeacherTelegramUrl(teacher) {
  if (!teacher) return '';
  const direct = (teacher.telegramUrl || '').toString().trim();
  if (direct) return direct;
  return getDefaultTelegramBotUrl();
}

