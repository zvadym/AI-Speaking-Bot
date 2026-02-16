export function withLandingStartParam(urlRaw) {
  const raw = (urlRaw || '').toString().trim();
  if (!raw) return '';

  try {
    const url = new URL(raw);
    url.searchParams.set('start', 'landing');
    return url.toString();
  } catch {
    const [basePart, hashPart] = raw.split('#', 2);
    const base = (basePart || '').toString();
    const hash = hashPart ? `#${hashPart}` : '';
    if (!base) return raw;

    if (/[?&]start=/.test(base)) {
      return `${base.replace(/([?&])start=[^&#]*/u, '$1start=landing')}${hash}`;
    }

    const delimiter = base.includes('?') ? '&' : '?';
    return `${base}${delimiter}start=landing${hash}`;
  }
}

export function getTeacherTelegramUrl(teacher) {
  if (!teacher) return '';
  const direct = (teacher.telegramUrl || '').toString().trim();
  return withLandingStartParam(direct);
}
