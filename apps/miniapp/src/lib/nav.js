import { computed, onBeforeUnmount, onMounted, ref } from 'vue';

function normalizePath(pathname) {
  const path = (pathname || '/').trim() || '/';
  if (path === '' || path === '/') return '/';
  const clean = path.replace(/\/+$/, '');
  return clean.startsWith('/') ? clean : `/${clean}`;
}

export function useNav() {
  const path = ref(normalizePath(window.location.pathname));

  function syncFromLocation() {
    path.value = normalizePath(window.location.pathname);
  }

  function go(nextPath, { replace = false } = {}) {
    const target = normalizePath(nextPath);
    if (replace) window.history.replaceState({}, '', target);
    else window.history.pushState({}, '', target);
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
    if (current === '/subscription') return 'subscription';
    if (current === '/language') return 'language';
    if (current === '/level') return 'level';
    if (current === '/about') return 'about';
    if (current === '/success') return 'subscription';
    if (current === '/cancel') return 'subscription';
    return 'home';
  });

  return { path, screen, go, back };
}
