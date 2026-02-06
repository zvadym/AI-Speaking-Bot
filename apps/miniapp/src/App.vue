<template>
  <div class="app">
    <div class="loading" v-if="loading">
      <div class="loading-card">
        <div class="loading-kicker">{{ $t('app.loading.kicker') }}</div>
        <div class="loading-title">{{ $t('app.loading.title') }}</div>
        <div class="loading-sub">{{ $t('app.loading.sub') }}</div>
      </div>
    </div>

    <div class="error" v-else-if="fatalKey">
      <div class="error-card">
        <div class="error-kicker">{{ $t('app.error.kicker') }}</div>
        <div class="error-title">{{ $t('app.error.title') }}</div>
        <div class="error-sub">{{ fatalText }}</div>
      </div>
    </div>

    <HomeScreen
      v-else-if="nav.screen.value === 'home'"
      :me="me"
      @navigate="nav.go"
    />

    <SubscriptionScreen
      v-else-if="nav.screen.value === 'subscription'"
      :apiBase="apiBase"
      :token="token"
      @navigate="nav.go"
    />

    <CheckoutScreen
      v-else-if="nav.screen.value === 'checkout'"
      :apiBase="apiBase"
      :token="token"
      @navigate="nav.go"
    />

    <LanguageScreen
      v-else-if="nav.screen.value === 'language'"
      :apiBase="apiBase"
      :token="token"
      :me="me"
      :refreshMe="refreshMe"
      :toast="toast"
      @navigate="nav.go"
    />

    <LevelScreen
      v-else-if="nav.screen.value === 'level'"
      :apiBase="apiBase"
      :token="token"
      :me="me"
      :refreshMe="refreshMe"
      :toast="toast"
      @navigate="nav.go"
    />

    <AboutScreen
      v-else
      @navigate="nav.go"
    />

    <div class="toast" v-if="toastState.show" role="status" aria-live="polite">
      <div class="toast-card">{{ toastState.message }}</div>
    </div>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { useI18n } from './i18n.js';
import HomeScreen from './screens/HomeScreen.vue';
import SubscriptionScreen from './screens/SubscriptionScreen.vue';
import CheckoutScreen from './screens/CheckoutScreen.vue';
import LanguageScreen from './screens/LanguageScreen.vue';
import LevelScreen from './screens/LevelScreen.vue';
import AboutScreen from './screens/AboutScreen.vue';
import { useNav } from './lib/nav.js';
import { apiJson, authTelegram } from './lib/api.js';
import { getTelegramWebApp, tgReady } from './lib/tg.js';
import { identifyUser, track, trackScreen } from './lib/analytics.js';

const apiBase = import.meta.env.VITE_API_BASE || 'http://localhost:3000';

const nav = useNav();
const { t } = useI18n({ useScope: 'global' });

const loading = ref(true);
const fatalKey = ref('');
const fatalText = computed(() => (fatalKey.value ? t(fatalKey.value) : ''));
const token = ref('');
const me = ref(null);

const toastState = reactive({
  show: false,
  message: ''
});

let toastTimer = null;
let didTrackOpen = false;
let tgActivatedHandler = null;
let tgDeactivatedHandler = null;
let visibilityHandler = null;

function toast(message) {
  toastState.message = message;
  toastState.show = true;
  if (toastTimer) window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    toastState.show = false;
    toastState.message = '';
    toastTimer = null;
  }, 2600);
}

async function refreshMe() {
  if (!token.value) return;
  const data = await apiJson(apiBase, '/me', { token: token.value });
  me.value = data.user;
}

let tgBackHandler = null;

function syncTelegramBackButton() {
  const tg = getTelegramWebApp();
  if (!tg?.BackButton) return;

  if (nav.screen.value === 'home') tg.BackButton.hide();
  else tg.BackButton.show();
}

function trackAppOpenOnce() {
  if (didTrackOpen) return;
  didTrackOpen = true;
  const tg = getTelegramWebApp();
  track('app_open', {
    platform: (tg?.platform || '').toString(),
    version: (tg?.version || '').toString()
  });
}

onMounted(async () => {
  loading.value = true;
  fatalKey.value = '';

  try {
    const tg = getTelegramWebApp();
    if (!tg?.initData) {
      fatalKey.value = 'app.error.openInTelegram';
      return;
    }

    tgReady(tg);

    tgBackHandler = () => nav.back();
    try {
      tg.onEvent?.('backButtonClicked', tgBackHandler);
    } catch {
      // ignore
    }

    const auth = await authTelegram(apiBase, tg.initData);
    token.value = auth.token;
    await refreshMe();

    if (me.value) identifyUser(me.value);
    trackAppOpenOnce();

    tgActivatedHandler = () => track('app_activated');
    tgDeactivatedHandler = () => track('app_deactivated');
    try {
      tg.onEvent?.('activated', tgActivatedHandler);
      tg.onEvent?.('deactivated', tgDeactivatedHandler);
    } catch {
      // ignore
    }

    visibilityHandler = () => {
      if (document.visibilityState === 'visible') track('app_activated');
      else track('app_deactivated');
    };
    document.addEventListener('visibilitychange', visibilityHandler);
  } catch (err) {
    console.error(err);
    fatalKey.value = 'app.error.authFailed';
  } finally {
    loading.value = false;
    syncTelegramBackButton();
  }
});

watch(
  () => nav.screen.value,
  () => syncTelegramBackButton(),
  { immediate: true }
);

watch(
  () => nav.path.value,
  () => {
    if (!me.value) return;
    trackScreen({ path: nav.path.value, screen: nav.screen.value });
  },
  { immediate: true }
);

onBeforeUnmount(() => {
  const tg = getTelegramWebApp();
  try {
    if (tgBackHandler) tg?.offEvent?.('backButtonClicked', tgBackHandler);
    if (tgActivatedHandler) tg?.offEvent?.('activated', tgActivatedHandler);
    if (tgDeactivatedHandler) tg?.offEvent?.('deactivated', tgDeactivatedHandler);
  } catch {
    // ignore
  }
  if (visibilityHandler) document.removeEventListener('visibilitychange', visibilityHandler);
  if (toastTimer) window.clearTimeout(toastTimer);
});
</script>

<style scoped>
.app {
  min-height: 100vh;
  display: grid;
  place-items: stretch;
}

.loading,
.error {
  width: min(860px, 100%);
  margin: 0 auto;
  padding: 44px 22px 80px;
}

.loading-card,
.error-card {
  border: 1px solid var(--stroke);
  border-radius: 20px;
  padding: 18px 18px;
  background: rgba(255, 255, 255, 0.62);
  box-shadow: 0 28px 70px var(--shadow);
}

.loading-kicker,
.error-kicker {
  text-transform: uppercase;
  letter-spacing: 0.26em;
  font-size: 11px;
  color: var(--accent-2);
}

.loading-title,
.error-title {
  font-family: var(--font-display);
  font-size: 28px;
  margin-top: 10px;
  letter-spacing: -0.02em;
}

.loading-sub,
.error-sub {
  margin-top: 8px;
  color: var(--muted);
  line-height: 1.6;
}

.toast {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 20px;
  display: grid;
  justify-items: center;
  padding: 0 18px;
  pointer-events: none;
  z-index: 10;
}

.toast-card {
  pointer-events: none;
  border: 1px solid rgba(30, 26, 22, 0.18);
  background: rgba(255, 255, 255, 0.78);
  box-shadow: 0 20px 55px rgba(30, 26, 22, 0.22);
  border-radius: 999px;
  padding: 10px 14px;
  font-weight: 650;
  letter-spacing: 0.01em;
  animation: toastIn 220ms ease-out both;
}

@keyframes toastIn {
  from {
    opacity: 0;
    transform: translateY(10px) scale(0.98);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}
</style>
