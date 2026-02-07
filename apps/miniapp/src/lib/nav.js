import { computed, onBeforeUnmount, onMounted, ref } from 'vue';

function normalizePath(pathname) {
  const raw = (pathname || '/').trim() || '/';
  let path = raw;
  try {
    path = new URL(raw, window.location.origin).pathname || '/';
  } catch {
    // ignore and fall back to raw value
  }
  if (path === '' || path === '/') return '/';
  const clean = path.replace(/\/+$/, '');
  return clean.startsWith('/') ? clean : `/${clean}`;
}

export function useNav() {
  const path = ref(normalizePath(window.location.pathname));
  const adminPath = normalizePath((import.meta.env.VITE_ADMIN_PATH || '').toString());

  function syncFromLocation() {
    path.value = normalizePath(window.location.pathname);
  }

  function go(nextPath, { replace = false } = {}) {
    const target = normalizePath(nextPath);
    const fullTarget = (nextPath || '/').toString().trim() || '/';
    if (replace) window.history.replaceState({}, '', fullTarget);
    else window.history.pushState({}, '', fullTarget);
    path.value = target;
  }

  function back() {
    if (window.history.length > 1) {
      window.history.back();
      return;
    }
    go('/', { replace: true });
  }

  function onPopState() {
    syncFromLocation();
  }

  onMounted(() => {
    window.addEventListener('popstate', onPopState);
    syncFromLocation();
  });

  onBeforeUnmount(() => {
    window.removeEventListener('popstate', onPopState);
  });

  const screen = computed(() => {
    const current = path.value;
    if (adminPath && adminPath !== '/' && current === adminPath) return 'admin';
    if (current === '/subscription') return 'subscription';
    if (current === '/checkout') return 'checkout';
    if (current === '/language') return 'language';
    if (current === '/level') return 'level';
    if (current === '/about') return 'about';
    if (current === '/success') return 'subscription';
    if (current === '/cancel') return 'subscription';
    return 'home';
  });

  return { path, screen, go, back };
}
