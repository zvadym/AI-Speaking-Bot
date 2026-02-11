export function getTeacherTelegramUrl(teacher) {
  if (!teacher) return '';
  const direct = (teacher.telegramUrl || '').toString().trim();
  return direct;
}
