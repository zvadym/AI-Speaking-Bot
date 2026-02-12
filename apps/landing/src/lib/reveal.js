function prefersReducedMotion() {
  try {
    return window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
  } catch {
    return false;
  }
}

export function setupSectionReveal(sections) {
  const els = Array.isArray(sections) ? sections.filter(Boolean) : [];
  if (!els.length) return () => {};
  if (typeof window === 'undefined') return () => {};
  if (prefersReducedMotion()) return () => {};
  if (typeof IntersectionObserver === 'undefined') return () => {};

  let activeId = '';

  function setActive(nextId) {
    if (!nextId || nextId === activeId) return;
    activeId = nextId;
    for (const el of els) {
      el.dataset.active = el.id === activeId ? 'true' : 'false';
    }
  }

  const io = new IntersectionObserver(
    (entries) => {
      const visible = entries
        .filter((e) => e.isIntersecting)
        .sort((a, b) => (b.intersectionRatio || 0) - (a.intersectionRatio || 0));
      if (!visible.length) return;
      const id = visible[0]?.target?.id || '';
      if (id) setActive(id);
    },
    {
      root: null,
      threshold: [0.2, 0.35, 0.5, 0.65],
      rootMargin: '-15% 0px -25% 0px'
    }
  );

  for (const el of els) io.observe(el);
  if (els[0]?.id) setActive(els[0].id);

  return () => io.disconnect();
}

