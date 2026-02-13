<template>
  <div class="shell fade-in">
    <header class="hero">
      <div class="hero-badge">{{ $t('checkout.heroBadge') }}</div>
      <h1>{{ $t('checkout.title') }}</h1>
      <p class="hero-sub">
        {{ $t('checkout.sub') }}
      </p>
    </header>

    <section class="status" v-if="errorMessage">
      <div class="status-card error">
        <span class="status-label">{{ $t('common.notice') }}</span>
        <span class="status-text">{{ errorMessage }}</span>
      </div>
    </section>

    <section class="checkout">
      <div class="checkout-loading" v-if="loading && !errorMessage">
        {{ $t('checkout.loading') }}
      </div>
      <div ref="mountEl" class="checkout-mount" />
    </section>

    <section class="debug-wrap" v-if="debugEnabled">
      <DebugPanel
        title="Checkout Debug"
        :logs="debugLogs"
        @clear="clearDebugPanel"
      />
    </section>

    <div class="bottom-nav">
      <button class="ghost" type="button" @click="goBack" :disabled="loading">
        {{ $t('common.back') }}
      </button>
    </div>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { loadStripe } from '@stripe/stripe-js';
import { useI18n } from '../i18n.js';
import { track } from '../lib/metrics.js';
import DebugPanel from '../components/DebugPanel.vue';
import { addDebugLog, clearDebugLogs, isDebugEnabled, readDebugLogs, subscribeDebugLogs } from '../lib/debug.js';

const props = defineProps({
  apiBase: { type: String, required: true },
  token: { type: String, required: true }
});

const emit = defineEmits(['navigate']);
const { t } = useI18n({ useScope: 'global' });

const loading = ref(true);
const errorKey = ref('');
const errorMessage = computed(() => (errorKey.value ? t(errorKey.value) : ''));
const mountEl = ref(null);
const debugEnabled = ref(isDebugEnabled());
const debugLogs = ref(readDebugLogs());
let unsubscribeDebug = null;

const publishableKey = (import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY || '').toString().trim();

let embeddedCheckout = null;

function clearDebugPanel() {
  clearDebugLogs();
}

function buildSubscriptionPath() {
  const params = new URLSearchParams(window.location.search);
  const debugParam = params.get('debug');
  if (!debugParam) return '/subscription';
  return `/subscription?debug=${encodeURIComponent(debugParam)}`;
}

function goBack() {
  track('ui_click', { id: 'checkout_back', to: '/subscription' });
  emit('navigate', buildSubscriptionPath());
}

function parseCheckoutParams() {
  const params = new URLSearchParams(window.location.search);
  const tier = (params.get('tier') || '').toLowerCase();
  const currency = (params.get('currency') || 'EUR').toUpperCase();
  return { tier, currency };
}

function setError(key) {
  errorKey.value = key;
  addDebugLog('checkout_error_set', { key });
}

async function fetchClientSecret() {
  const { tier, currency } = parseCheckoutParams();
  addDebugLog('embedded_client_secret_request_started', { tier, currency });
  if (tier !== 'pro') {
    setError('checkout.errors.badTier');
    throw new Error('bad_tier');
  }

  const resp = await fetch(`${props.apiBase}/billing/checkout/embedded`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${props.token}`
    },
    body: JSON.stringify({ tier, currency })
  });
  addDebugLog('embedded_client_secret_response_received', { ok: resp.ok, status: resp.status });

  if (!resp.ok) {
    setError('checkout.errors.unavailable');
    throw new Error('checkout_unavailable');
  }

  const data = await resp.json().catch(() => ({}));
  if (!data?.client_secret) {
    setError('checkout.errors.unavailable');
    throw new Error('missing_client_secret');
  }

  addDebugLog('embedded_client_secret_received', { hasClientSecret: Boolean(data?.client_secret) });
  track('checkout_embedded_client_secret_loaded', { tier, currency });
  return data.client_secret;
}

onMounted(async () => {
  unsubscribeDebug = subscribeDebugLogs((logs) => {
    debugLogs.value = logs;
  });
  loading.value = true;
  errorKey.value = '';
  addDebugLog('checkout_screen_mounted', {
    path: window.location.pathname,
    search: window.location.search,
    hasPublishableKey: Boolean(publishableKey)
  });

  if (!publishableKey) {
    setError('checkout.errors.missingKey');
    loading.value = false;
    return;
  }

  try {
    const stripe = await loadStripe(publishableKey);
    addDebugLog('stripe_loaded', { initialized: Boolean(stripe) });
    if (!stripe?.initEmbeddedCheckout) {
      setError('checkout.errors.unavailable');
      return;
    }

    embeddedCheckout = await stripe.initEmbeddedCheckout({ fetchClientSecret });
    addDebugLog('embedded_checkout_initialized', { initialized: Boolean(embeddedCheckout) });
    if (!mountEl.value) {
      setError('checkout.errors.unavailable');
      return;
    }

    embeddedCheckout.mount(mountEl.value);
    addDebugLog('embedded_checkout_mounted');
    track('checkout_embedded_mounted');
  } catch (err) {
    console.error(err);
    addDebugLog('checkout_mount_error', { message: err?.message || 'unknown_error' });
    if (!errorKey.value) setError('checkout.errors.unavailable');
  } finally {
    loading.value = false;
  }
});

onBeforeUnmount(() => {
  if (unsubscribeDebug) unsubscribeDebug();
  unsubscribeDebug = null;
  try {
    embeddedCheckout?.destroy?.();
  } catch {
    // ignore
  }
  embeddedCheckout = null;
});
</script>

<style scoped>
.shell {
  width: min(1100px, 100%);
  min-height: 100vh;
  min-height: 100dvh;
  padding: 48px 24px calc(22px + env(safe-area-inset-bottom, 0px));
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.hero {
  display: grid;
  gap: 12px;
}

.hero-badge {
  text-transform: uppercase;
  letter-spacing: 0.25em;
  font-size: 11px;
  color: var(--accent-2);
}

.hero h1 {
  font-family: var(--font-display);
  font-size: clamp(28px, 4vw, 44px);
  margin: 0;
}

.hero-sub {
  margin: 0;
  max-width: 560px;
  color: var(--muted);
  font-size: 16px;
  line-height: 1.6;
}

.status {
  display: grid;
}

.status-card {
  border: 1px solid var(--stroke);
  border-radius: 16px;
  padding: 16px 20px;
  background: rgba(255, 255, 255, 0.5);
  box-shadow: 0 20px 50px var(--shadow);
  display: flex;
  justify-content: space-between;
  gap: 16px;
}

.status-card.error {
  border-color: rgba(199, 90, 36, 0.35);
  background: rgba(199, 90, 36, 0.08);
}

.status-label {
  text-transform: uppercase;
  letter-spacing: 0.2em;
  font-size: 10px;
  color: var(--muted);
}

.status-text {
  font-weight: 650;
  text-align: right;
}

.checkout {
  display: grid;
  gap: 12px;
  width: 100%;
  flex: 1;
  min-height: 420px;
}

.checkout-loading {
  color: var(--muted);
  font-weight: 650;
}

.checkout-mount {
  width: 100%;
  min-height: 420px;
  border: 1px solid var(--stroke);
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.6);
  overflow: hidden;
}

.debug-wrap {
  display: grid;
}

.bottom-nav {
  display: grid;
  justify-items: stretch;
  margin-top: 10px;
}

.ghost {
  width: 100%;
  border: 1px solid var(--stroke);
  background: rgba(255, 255, 255, 0.45);
  box-shadow: 0 18px 40px rgba(30, 26, 22, 0.12);
  padding: 12px 14px;
  border-radius: 16px;
  cursor: pointer;
  font-weight: 750;
  letter-spacing: 0.01em;
  color: var(--ink);
  transition: transform 120ms ease, box-shadow 120ms ease, background 120ms ease;
}

.ghost:disabled {
  opacity: 0.6;
  cursor: default;
}

.ghost:active:not(:disabled) {
  transform: translateY(1px);
  box-shadow: 0 12px 28px rgba(30, 26, 22, 0.12);
}
</style>
