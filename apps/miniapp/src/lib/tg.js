export function getTelegramWebApp() {
  return window.Telegram?.WebApp || null;
}

export function tgReady(tg) {
  try {
    tg.ready();
    tg.expand();
    tg.setHeaderColor?.('bg_color');
  } catch {
    // ignore
  }
}

export function tgHaptic(type = 'impact', style = 'light') {
  const tg = getTelegramWebApp();
  try {
    if (!tg?.HapticFeedback) return;
    if (type === 'selection') tg.HapticFeedback.selectionChanged();
    if (type === 'notification') tg.HapticFeedback.notificationOccurred(style);
    if (type === 'impact') tg.HapticFeedback.impactOccurred(style);
  } catch {
    // ignore
  }
}

export function tgOpenLink(url) {
  const tg = getTelegramWebApp();
  if (tg?.openLink) tg.openLink(url);
  else window.location.href = url;
}

