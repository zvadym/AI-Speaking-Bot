function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function prefersReducedMotion() {
  try {
    return window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
  } catch {
    return false;
  }
}

export function setupParallax(sections) {
  const els = Array.isArray(sections) ? sections.filter(Boolean) : [];
  if (!els.length) return () => {};
  if (typeof window === 'undefined') return () => {};
  if (prefersReducedMotion()) return () => {};

  let raf = 0;

  function apply() {
    raf = 0;
    const vh = window.innerHeight || 1;
    const center = vh / 2;

    for (let i = 0; i < els.length; i++) {
      const el = els[i];
      const rect = el.getBoundingClientRect();
      const elCenter = rect.top + rect.height / 2;
      const raw = (elCenter - center) / vh; // -1..1 (ish)
      const y = clamp(raw, -1, 1);
      const x = clamp(raw * (i % 2 === 0 ? 0.35 : -0.35), -1, 1);
      el.style.setProperty('--parallaxY', String(y));
      el.style.setProperty('--parallaxX', String(x));
    }
  }

  function onScroll() {
    if (raf) return;
    raf = window.requestAnimationFrame(apply);
  }

  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll, { passive: true });
  apply();

  return () => {
    window.removeEventListener('scroll', onScroll);
    window.removeEventListener('resize', onScroll);
    if (raf) window.cancelAnimationFrame(raf);
  };
}

