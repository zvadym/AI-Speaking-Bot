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
import { addDebugLog } from '../lib/debug.js';

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

const publishableKey = (import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY || '').toString().trim();
const BILLING_INTERVAL_MONTH = 'month';
const BILLING_INTERVAL_YEAR = 'year';
const BILLING_INTERVALS = new Set([BILLING_INTERVAL_MONTH, BILLING_INTERVAL_YEAR]);

let embeddedCheckout = null;

function buildSubscriptionPath() {
  const params = new URLSearchParams(window.location.search);
  const debugParam = params.get('debug');
  if (!debugParam) return '/subscription';
  return `/subscription?debug=${encodeURIComponent(debugParam)}`;
}

function goBack() {
  emit('navigate', buildSubscriptionPath());
}

function parseCheckoutParams() {
  const params = new URLSearchParams(window.location.search);
  const tier = (params.get('tier') || '').toLowerCase();
  const currency = (params.get('currency') || 'EUR').toUpperCase();
  const billingIntervalRaw = (params.get('billing_interval') || BILLING_INTERVAL_MONTH).toLowerCase();
  const billingInterval = BILLING_INTERVALS.has(billingIntervalRaw) ? billingIntervalRaw : null;
  return { tier, currency, billingInterval };
}

function setError(key) {
  errorKey.value = key;
  addDebugLog('checkout_error_set', { key });
}

async function fetchClientSecret() {
  const { tier, currency, billingInterval } = parseCheckoutParams();
  addDebugLog('embedded_client_secret_request_started', { tier, currency, billingInterval });
  if (tier !== 'pro') {
    setError('checkout.errors.badTier');
    throw new Error('bad_tier');
  }
  if (!billingInterval) {
    setError('checkout.errors.badBillingInterval');
    throw new Error('bad_billing_interval');
  }

  const resp = await fetch(`${props.apiBase}/billing/checkout/embedded`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${props.token}`
    },
    body: JSON.stringify({ tier, currency, billing_interval: billingInterval })
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
  return data.client_secret;
}

onMounted(async () => {
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
  } catch (err) {
    console.error(err);
    addDebugLog('checkout_mount_error', { message: err?.message || 'unknown_error' });
    if (!errorKey.value) setError('checkout.errors.unavailable');
  } finally {
    loading.value = false;
  }
});

onBeforeUnmount(() => {
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
  width: min(760px, 100%);
  min-height: 100vh;
  min-height: 100dvh;
  padding: 24px 16px calc(28px + env(safe-area-inset-bottom, 0px));
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.hero {
  display: grid;
  gap: 8px;
}

.hero-badge {
  text-transform: uppercase;
  letter-spacing: 0.12em;
  font-size: 10px;
  color: var(--accent-2);
  font-weight: 700;
}

.hero h1 {
  font-family: var(--font-body);
  font-size: clamp(24px, 5vw, 32px);
  letter-spacing: -0.04em;
  font-weight: 800;
  margin: 0;
}

.hero-sub {
  margin: 0;
  max-width: 44ch;
  color: var(--muted);
  font-size: 14px;
  line-height: 1.5;
}

.status {
  display: grid;
}

.status-card {
  border: 1px solid var(--stroke);
  border-radius: 14px;
  padding: 12px 14px;
  background: rgba(255, 255, 255, 0.6);
  display: flex;
  justify-content: space-between;
  gap: 12px;
}

.status-card.error {
  border-color: rgba(181, 109, 86, 0.32);
  background: rgba(181, 109, 86, 0.08);
}

.status-label {
  text-transform: uppercase;
  letter-spacing: 0.12em;
  font-size: 10px;
  color: var(--muted);
}

.status-text {
  font-weight: 650;
  text-align: right;
}

.checkout {
  display: grid;
  gap: 10px;
  width: 100%;
  flex: 1;
  min-height: 380px;
}

.checkout-loading {
  color: var(--muted);
  font-weight: 650;
}

.checkout-mount {
  width: 100%;
  min-height: 380px;
  border: 1px solid var(--stroke);
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.62);
  overflow: hidden;
}

.bottom-nav {
  display: grid;
  justify-items: stretch;
  margin-top: 4px;
}

.ghost {
  width: 100%;
  border: 1px solid var(--stroke);
  background: rgba(255, 255, 255, 0.52);
  padding: 11px 14px;
  border-radius: 12px;
  cursor: pointer;
  font-weight: 700;
  letter-spacing: 0.01em;
  color: var(--ink);
  transition: transform 120ms ease, background 120ms ease, border-color 120ms ease;
}

.ghost:disabled {
  opacity: 0.6;
  cursor: default;
}

.ghost:active:not(:disabled) {
  transform: translateY(1px);
  border-color: rgba(95, 117, 96, 0.34);
}
</style>
