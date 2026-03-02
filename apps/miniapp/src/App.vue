<template>
  <div class="app">
    <div class="loading" v-if="loading">
      <div
        class="loading-spinner"
        role="status"
        aria-live="polite"
        :aria-label="$t('app.loading.title')"
      />
    </div>

    <div class="error" v-else-if="fatalKey">
      <div class="error-card">
        <div class="error-kicker">{{ $t('app.error.kicker') }}</div>
        <div class="error-title">{{ $t('app.error.title') }}</div>
        <div class="error-sub">{{ fatalText }}</div>
      </div>
    </div>

    <BotPickerScreen
      v-else-if="showBotPicker"
      :bots="meBots"
      @select="selectBotAndRefresh"
    />

    <HomeScreen
      v-else-if="nav.screen.value === 'home'"
      :me="me"
      @navigate="nav.go"
    />

    <AdminDashboardScreen
      v-else-if="nav.screen.value === 'admin'"
      :apiBase="apiBase"
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
      :me="me"
      :bots="meBots"
      :toast="toast"
      @navigate="nav.go"
    />

    <LevelScreen
      v-else-if="nav.screen.value === 'level'"
      :apiBase="apiBase"
      :token="token"
      :me="me"
      :botKey="botKey"
      :refreshMe="refreshMe"
      :toast="toast"
      @navigate="nav.go"
    />

    <AboutScreen
      v-else
      :bots="meBots"
      @navigate="nav.go"
    />

    <div class="toast" v-if="toastState.show" role="status" aria-live="polite">
      <div class="toast-card">{{ toastState.message }}</div>
    </div>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { setAppLocale, useI18n } from './i18n.js';
import HomeScreen from './screens/HomeScreen.vue';
import AdminDashboardScreen from './screens/AdminDashboardScreen.vue';
import SubscriptionScreen from './screens/SubscriptionScreen.vue';
import CheckoutScreen from './screens/CheckoutScreen.vue';
import LanguageScreen from './screens/LanguageScreen.vue';
import LevelScreen from './screens/LevelScreen.vue';
import AboutScreen from './screens/AboutScreen.vue';
import BotPickerScreen from './screens/BotPickerScreen.vue';
import { useNav } from './lib/nav.js';
import { apiJson, authTelegram } from './lib/api.js';
import { getTelegramWebApp, tgReady } from './lib/tg.js';
import { identifyUser, track, trackScreen } from './lib/metrics.js';
import { addDebugLog } from './lib/debug.js';

const apiBase = import.meta.env.VITE_API_BASE || 'http://localhost:3000';

const nav = useNav();
const { t } = useI18n({ useScope: 'global' });
const isAdmin = computed(() => nav.screen.value === 'admin');

const loading = ref(true);
const fatalKey = ref('');
const fatalText = computed(() => (fatalKey.value ? t(fatalKey.value) : ''));
const token = ref('');
const me = ref(null);
const botKey = ref('');
const meBots = ref([]);
const showBotPicker = computed(
  () => !isAdmin.value && !loading.value && !fatalKey.value && meBots.value.length > 1 && !botKey.value
);
const effectiveBaseLanguage = computed(() => {
  const fromMe = (me.value?.base_language || '').toString().trim().toLowerCase();
  if (fromMe) return fromMe;

  const selectedBotKey = (botKey.value || '').toString().trim().toLowerCase();
  if (!selectedBotKey) return '';
  const selectedBot = meBots.value.find(
    (row) => (row?.bot_key || '').toString().trim().toLowerCase() === selectedBotKey
  );
  const fromSelectedBot = (selectedBot?.base_language || '').toString().trim().toLowerCase();
  if (fromSelectedBot) return fromSelectedBot;

  const [fromBotKey] = selectedBotKey.split('-');
  return (fromBotKey || '').toString().trim().toLowerCase();
});

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

function readBotKeyFromLocation() {
  try {
    const u = new URL(window.location.href);
    return (
      u.searchParams.get('bot-key') ||
      u.searchParams.get('bot_key') ||
      ''
    ).toString().trim().toLowerCase();
  } catch {
    return '';
  }
}

function setBotKeyInLocation(nextBotKey) {
  const value = (nextBotKey || '').toString().trim().toLowerCase();
  try {
    const u = new URL(window.location.href);
    if (value) u.searchParams.set('bot-key', value);
    else u.searchParams.delete('bot-key');
    window.history.replaceState({}, '', `${u.pathname}${u.search}`);
  } catch {
    // ignore URL update failures
  }
}

async function refreshMe() {
  if (!token.value) return;
  const query = botKey.value ? { bot_key: botKey.value } : undefined;
  const data = await apiJson(apiBase, '/me', { token: token.value, query });
  me.value = data.user;
  if (me.value?.bot_key) {
    const normalized = String(me.value.bot_key).trim().toLowerCase();
    if (normalized) {
      botKey.value = normalized;
      setBotKeyInLocation(normalized);
    }
  }
}

async function refreshBots() {
  if (!token.value) return;
  const query = botKey.value ? { bot_key: botKey.value } : undefined;
  const data = await apiJson(apiBase, '/me/bots', { token: token.value, query });
  meBots.value =
    (Array.isArray(data?.available_bots) && data.available_bots.length > 0)
      ? data.available_bots
      : (Array.isArray(data?.bots) ? data.bots : []);

  const normalizedSelected = (data?.selected_bot_key || '').toString().trim().toLowerCase();
  const available = new Set(meBots.value.map((row) => (row?.bot_key || '').toString().trim().toLowerCase()).filter(Boolean));

  if (botKey.value && available.has(botKey.value)) return;
  if (normalizedSelected && available.has(normalizedSelected)) {
    botKey.value = normalizedSelected;
    setBotKeyInLocation(normalizedSelected);
    return;
  }
  if (meBots.value.length === 1) {
    botKey.value = (meBots.value[0].bot_key || '').toString().trim().toLowerCase();
    setBotKeyInLocation(botKey.value);
    return;
  }
  if (meBots.value.length > 1) {
    botKey.value = '';
    return;
  }

  botKey.value = '';
}

async function selectBotAndRefresh(nextBotKey) {
  const normalized = (nextBotKey || '').toString().trim().toLowerCase();
  if (!normalized) return;
  botKey.value = normalized;
  setBotKeyInLocation(normalized);
  track('ui_click', { id: 'bot_select', bot_key: normalized });
  await Promise.all([refreshMe(), refreshBots()]);
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
  track('start', {
    source: 'miniapp',
    platform: (tg?.platform || '').toString(),
    version: (tg?.version || '').toString()
  });
  track('app_open', {
    platform: (tg?.platform || '').toString(),
    version: (tg?.version || '').toString()
  });
}

onMounted(async () => {
  loading.value = true;
  fatalKey.value = '';

  const initialBotKey = readBotKeyFromLocation();
  try {
    if (isAdmin.value) return;
    const tg = getTelegramWebApp();
    addDebugLog('app_boot_started', {
      path: window.location.pathname,
      search: window.location.search,
      apiBase,
      botKeyFromUrl: initialBotKey || null,
      hasTelegram: Boolean(tg),
      hasInitData: Boolean(tg?.initData),
      platform: (tg?.platform || '').toString() || null,
      version: (tg?.version || '').toString() || null
    });

    if (!tg?.initData) {
      addDebugLog('app_boot_failed_missing_init_data', {
        hasTelegram: Boolean(tg),
        platform: (tg?.platform || '').toString() || null,
        version: (tg?.version || '').toString() || null
      });
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
    const fromUrl = initialBotKey;
    const fromAuth = (auth?.bot_key || '').toString().trim().toLowerCase();
    addDebugLog('auth_telegram_success', {
      chatId: Number(auth?.user?.id) || null,
      fromUrl: fromUrl || null,
      fromAuth: fromAuth || null
    });
    botKey.value = fromUrl || fromAuth || '';
    if (botKey.value) setBotKeyInLocation(botKey.value);

    await refreshBots();
    if (botKey.value || meBots.value.length <= 1) {
      await refreshMe();
    } else {
      me.value = null;
    }

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
    addDebugLog('app_boot_failed', {
      code: (err?.code || '').toString() || null,
      message: (err?.message || '').toString() || null,
      status: Number.isFinite(err?.status) ? Number(err.status) : null,
      payload: err?.payload || null,
      path: window.location.pathname,
      search: window.location.search,
      botKeyFromUrl: initialBotKey || null
    });
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

watch(
  () => effectiveBaseLanguage.value,
  (value) => {
    if (!value) return;
    setAppLocale(value);
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
  width: 100%;
  min-height: 100vh;
  display: grid;
  place-items: stretch;
}

.loading {
  width: 100%;
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: 24px;
}

.loading-spinner {
  width: 96px;
  height: 96px;
  border-radius: 999px;
  border: 9px solid rgba(30, 26, 22, 0.14);
  border-top-color: var(--accent-2);
  box-shadow: 0 22px 56px var(--shadow);
  animation: spinnerRotate 900ms linear infinite;
}

.error {
  width: min(860px, 100%);
  margin: 0 auto;
  padding: 44px 22px 80px;
}

.error-card {
  border: 1px solid var(--stroke);
  border-radius: 20px;
  padding: 18px 18px;
  background: rgba(255, 255, 255, 0.62);
  box-shadow: 0 28px 70px var(--shadow);
}

.error-kicker {
  text-transform: uppercase;
  letter-spacing: 0.26em;
  font-size: 11px;
  color: var(--accent-2);
}

.error-title {
  font-family: var(--font-display);
  font-size: 28px;
  margin-top: 10px;
  letter-spacing: -0.02em;
}

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

@keyframes spinnerRotate {
  to {
    transform: rotate(360deg);
  }
}
</style>
