<template>
  <div class="shell fade-in">
    <header class="hero">
      <div class="hero-badge">{{ $t('subscription.heroBadge') }}</div>
      <h1>{{ $t('subscription.title') }}</h1>
      <p class="hero-sub">
        {{ $t('subscription.sub') }}
      </p>
    </header>

    <section class="status" v-if="statusMessage">
      <div class="status-card">
        <span class="status-label">{{ $t('common.status') }}</span>
        <span class="status-text">{{ statusMessage }}</span>
      </div>
    </section>

    <section class="status" v-if="noticeMessage">
      <div class="status-card">
        <span class="status-label">{{ $t('common.scheduled') }}</span>
        <span class="status-text">{{ noticeMessage }}</span>
      </div>
    </section>

    <section class="status" v-if="errorMessage">
      <div class="status-card error">
        <span class="status-label">{{ $t('common.notice') }}</span>
        <span class="status-text">{{ errorMessage }}</span>
      </div>
    </section>

    <section class="manage" v-if="user">
      <div class="manage-card">
        <div>
          <h2>{{ $t('subscription.manage.yourPlan') }}</h2>
          <p>
            {{ currentPlanLabel }}
            <template v-if="showAutoRenewControls"> · {{ autoRenewLabel }}</template>
          </p>
          <p class="pending" v-if="pendingLabel">
            {{ pendingLabel }}
          </p>
          <div class="manage-usage" v-if="usage">
            <div class="usage-item">
              <span class="label">{{ $t('subscription.manage.voiceTotal') }}</span>
              <div class="usage-bar">
                <div class="usage-track">
                  <div
                    class="usage-fill accent"
                    :style="{ width: `${usagePercent(totalVoiceUsed(usage), totalVoiceLimit(usage))}%` }"
                  ></div>
                </div>
              </div>
            </div>
          </div>
        </div>
        <div class="manage-actions">
          <button
            class="ghost"
            :disabled="isBusy"
            @click="openBillingPortal"
            v-if="showManagePayments"
          >
            {{ $t('subscription.manage.managePayments') }}
          </button>
        <template v-if="showAutoRenewControls">
          <button
            class="ghost"
            :disabled="isBusy"
            @click="cancel"
            v-if="false && user.plan_autorenew"
          >
            {{ $t('subscription.manage.turnOffAutoRenew') }}
          </button>
          <button
            class="ghost"
            :disabled="isBusy"
            @click="resume"
            v-if="!user.plan_autorenew"
          >
            {{ $t('subscription.manage.resumeAutoRenew') }}
          </button>
          </template>
        </div>
      </div>
    </section>

    <section class="plans">
      <div class="billing-toggle" v-if="showBillingToggle">
        <button
          v-for="interval in availableBillingIntervals"
          :key="interval"
          type="button"
          class="billing-toggle-btn"
          :class="{ active: interval === selectedBillingInterval }"
          :disabled="isBusy"
          @click="selectBillingInterval(interval)"
        >
          {{ billingIntervalLabel(interval) }}
        </button>
      </div>

      <article
        v-for="(plan, index) in visiblePlans"
        :key="`${plan.tier}-${plan.billing_interval}`"
        class="plan"
        :class="{ featured: plan.tier === 'pro' }"
        :style="{ animationDelay: `${index * 120}ms` }"
      >
        <header>
          <span class="plan-tier">{{ planLabel(plan.tier) }}</span>
          <div class="plan-price">
            <span class="currency">{{ currencySymbol(plan.currency) }}</span>
            <span class="amount">{{ formatPrice(plan.amount_cents) }}</span>
            <span class="period">{{ periodLabel(plan.billing_interval) }}</span>
          </div>
        </header>

        <p class="plan-tagline">{{ planTagline(plan.tier) }}</p>

        <button
          class="cta"
          :disabled="isBusy"
          @click.stop="subscribe(plan.tier, plan.billing_interval)"
        >
          {{ actionPending === planActionKey(plan) ? $t('subscription.actions.openingCheckout') : actionLabel() }}
        </button>
      </article>

      <div class="plan-empty" v-if="!visiblePlans.length">
        {{ $t('subscription.notes.alreadyTopTier') }}
      </div>
    </section>

    <div class="bottom-nav">
      <BackToMenu @navigate="(path) => $emit('navigate', path)" />
    </div>

  </div>
</template>

<script setup>
import { onMounted, reactive, computed, ref } from 'vue';
import { useI18n } from '../i18n.js';
import { tgOpenLink } from '../lib/tg.js';
import { track } from '../lib/metrics.js';
import BackToMenu from '../components/BackToMenu.vue';
import { addDebugLog } from '../lib/debug.js';

const props = defineProps({
  apiBase: { type: String, required: true },
  token: { type: String, required: true }
});

const emit = defineEmits(['navigate']);
const { t, locale } = useI18n({ useScope: 'global' });

const state = reactive({
  loading: true,
  plans: [],
  user: null,
  currency: 'EUR',
  usage: null
});

const errorState = ref(null);
const noticeState = ref(null);
const actionPending = ref('');
const isBusy = computed(() => state.loading || Boolean(actionPending.value));

const errorMessage = computed(() => (errorState.value ? t(errorState.value.key, errorState.value.params) : ''));
const noticeMessage = computed(() => (noticeState.value ? t(noticeState.value.key, noticeState.value.params) : ''));

const embeddedCheckoutEnabled = (import.meta.env.VITE_STRIPE_EMBEDDED_CHECKOUT || '').toString().toLowerCase() === 'true';
const stripePublishableKey = (import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY || '').toString().trim();
const stripePublishableKeyPresent = Boolean(stripePublishableKey);
const useEmbeddedCheckout = computed(() => embeddedCheckoutEnabled && stripePublishableKeyPresent);
const BILLING_INTERVAL_MONTH = 'month';
const BILLING_INTERVAL_YEAR = 'year';
const BILLING_INTERVALS = new Set([BILLING_INTERVAL_MONTH, BILLING_INTERVAL_YEAR]);
const selectedBillingInterval = ref(BILLING_INTERVAL_MONTH);

function normalizeBillingInterval(raw, fallback = null) {
  const value = (raw ?? '').toString().trim().toLowerCase();
  if (!value) return fallback;
  if (!BILLING_INTERVALS.has(value)) return fallback;
  return value;
}

function billingIntervalSortValue(interval) {
  if (interval === BILLING_INTERVAL_MONTH) return 0;
  if (interval === BILLING_INTERVAL_YEAR) return 1;
  return 2;
}

function buildCheckoutPath(tier, currency, billingInterval) {
  const params = new URLSearchParams();
  params.set('tier', tier);
  params.set('currency', currency);
  params.set('billing_interval', billingInterval);
  const currentParams = new URLSearchParams(window.location.search);
  const debugParam = currentParams.get('debug');
  if (debugParam) params.set('debug', debugParam);
  return `/checkout?${params.toString()}`;
}

function setError(key, params) {
  errorState.value = { key, params };
}

function setNotice(key, params) {
  noticeState.value = { key, params };
}

function clearMessages() {
  errorState.value = null;
  noticeState.value = null;
}

const statusMessage = computed(() => {
  const params = new URLSearchParams(window.location.search);
  if (params.get('session_id')) return t('subscription.statusMessage.checkoutCompleted');
  if (window.location.pathname.endsWith('/cancel')) return t('subscription.statusMessage.checkoutCanceled');
  return '';
});

function trackPurchaseSuccessOnce() {
  const params = new URLSearchParams(window.location.search);
  const sessionId = (params.get('session_id') || '').toString().trim();
  const isSuccessPath = window.location.pathname.endsWith('/success');
  if (!sessionId && !isSuccessPath) return;

  const dedupeKey = sessionId
    ? `purchase_success:${sessionId}`
    : `purchase_success:path:${window.location.pathname}`;

  try {
    const storageKey = 'miniapp_purchase_success_seen';
    const existingRaw = window.sessionStorage.getItem(storageKey) || '';
    const seen = new Set(existingRaw.split('|').filter(Boolean));
    if (seen.has(dedupeKey)) return;
    seen.add(dedupeKey);
    window.sessionStorage.setItem(storageKey, Array.from(seen).slice(-20).join('|'));
  } catch {
    // Best-effort dedupe only.
  }

  track('purchase_success', {
    source: 'miniapp',
    session_id: sessionId || null
  });
}

const plans = computed(() => state.plans || []);
const user = computed(() => state.user);
const usage = computed(() => state.usage);
const effectiveTier = computed(() => usage.value?.tier || state.user?.plan_tier || 'free');
const showAutoRenewControls = computed(() => effectiveTier.value !== 'free');
const showManagePayments = computed(() => showAutoRenewControls.value || Boolean(state.user?.stripe_subscription_status));

const currentPlanLabel = computed(() => {
  if (!effectiveTier.value) return t('plans.tiers.free');
  return planLabel(effectiveTier.value);
});

function formatDate(date) {
  try {
    return new Intl.DateTimeFormat(locale.value, { year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
  } catch {
    return date.toLocaleDateString();
  }
}

const pendingLabel = computed(() => {
  const pendingTier = state.user?.pending_plan_tier;
  if (!pendingTier) return '';
  const label = planLabel(pendingTier);
  const effectiveAt = state.user?.pending_plan_effective_at ? new Date(state.user.pending_plan_effective_at) : null;
  if (effectiveAt && Number.isFinite(effectiveAt.getTime())) {
    return t('subscription.pending.withDate', { plan: label, date: formatDate(effectiveAt) });
  }
  return t('subscription.pending.atRenewal', { plan: label });
});

const autoRenewLabel = computed(() => {
  if (!state.user) return t('subscription.autoRenew.off');
  return state.user.plan_autorenew ? t('subscription.autoRenew.on') : t('subscription.autoRenew.off');
});

function planLabel(tier) {
  const normalized = (tier || '').toString().toLowerCase();
  if (normalized === 'free') return t('plans.tiers.free');
  if (normalized === 'pro') return t('plans.tiers.pro');
  // Hide legacy/unknown paid tiers from user-facing UI.
  return t('plans.tiers.pro');
}

function planTagline(tier) {
  if (tier === 'pro') return t('subscription.taglines.pro');
  return t('subscription.taglines.free');
}

function currencySymbol(currency) {
  if (currency === 'EUR') return '€';
  if (currency === 'USD') return '$';
  return currency || '€';
}

function formatPrice(cents) {
  if (!cents) return t('common.dash');
  return (cents / 100).toFixed(0);
}

function usagePercent(used, limit) {
  if (!limit || limit <= 0) return 0;
  return Math.min(100, Math.round((used / limit) * 100));
}

function totalVoiceUsed(usageData) {
  if (!usageData || typeof usageData !== 'object') return 0;
  if (Number.isFinite(Number(usageData.used_total))) return Number(usageData.used_total);
  return Number(usageData.used_user || 0) + Number(usageData.used_tts || 0);
}

function totalVoiceLimit(usageData) {
  if (!usageData || typeof usageData !== 'object') return 0;
  if (Number.isFinite(Number(usageData.limit_total))) return Number(usageData.limit_total);
  return Number(usageData.limit_user || 0) + Number(usageData.limit_tts || 0);
}

const proPlans = computed(() =>
  plans.value
    .filter((plan) => plan.tier === 'pro')
    .map((plan) => ({
      ...plan,
      billing_interval: normalizeBillingInterval(plan.billing_interval, BILLING_INTERVAL_MONTH)
    }))
);

const availableBillingIntervals = computed(() => {
  const intervals = Array.from(new Set(
    proPlans.value.map((plan) => plan.billing_interval).filter(Boolean)
  ));
  return intervals.sort((a, b) => billingIntervalSortValue(a) - billingIntervalSortValue(b));
});

const selectedProPlan = computed(() => {
  const selected = proPlans.value.find((plan) => plan.billing_interval === selectedBillingInterval.value);
  return selected || proPlans.value[0] || null;
});

const showBillingToggle = computed(() => {
  const isPro = effectiveTier.value === 'pro';
  return !isPro && availableBillingIntervals.value.length > 1;
});

function syncSelectedBillingInterval() {
  const intervals = availableBillingIntervals.value;
  if (intervals.length === 0) {
    selectedBillingInterval.value = BILLING_INTERVAL_MONTH;
    return;
  }
  if (intervals.includes(selectedBillingInterval.value)) return;
  selectedBillingInterval.value = intervals.includes(BILLING_INTERVAL_MONTH)
    ? BILLING_INTERVAL_MONTH
    : intervals[0];
}

const visiblePlans = computed(() => {
  const isPro = effectiveTier.value === 'pro';
  if (isPro) return [];
  const selected = selectedProPlan.value;
  return selected ? [selected] : [];
});

function actionLabel() {
  return t('subscription.actions.subscribe');
}

function periodLabel(intervalRaw) {
  const interval = normalizeBillingInterval(intervalRaw, BILLING_INTERVAL_MONTH);
  if (interval === BILLING_INTERVAL_YEAR) return t('subscription.period.perYear');
  return t('subscription.period.perMonth');
}

function billingIntervalLabel(intervalRaw) {
  const interval = normalizeBillingInterval(intervalRaw, BILLING_INTERVAL_MONTH);
  if (interval === BILLING_INTERVAL_YEAR) return t('subscription.billingIntervals.annual');
  return t('subscription.billingIntervals.monthly');
}

function selectBillingInterval(intervalRaw) {
  const interval = normalizeBillingInterval(intervalRaw);
  if (!interval) return;
  if (!availableBillingIntervals.value.includes(interval)) return;
  selectedBillingInterval.value = interval;
}

function planActionKey(plan) {
  const interval = normalizeBillingInterval(plan?.billing_interval, BILLING_INTERVAL_MONTH);
  return `${plan?.tier || 'unknown'}:${interval}`;
}

async function loadPlans({ keepNotice = false } = {}) {
  errorState.value = null;
  if (!keepNotice) noticeState.value = null;
  addDebugLog('plans_request_started');
  const resp = await fetch(`${props.apiBase}/plans?include_all_intervals=true`, {
    headers: { Authorization: `Bearer ${props.token}` }
  });
  addDebugLog('plans_response_received', { ok: resp.ok, status: resp.status });

  if (!resp.ok) {
    setError('subscription.actionLabels.unableToLoadPlans');
    return;
  }

  const data = await resp.json();
  state.plans = data.plans || [];
  state.user = data.user;
  state.currency = data.currency || 'EUR';
  state.usage = data.usage || null;
  syncSelectedBillingInterval();
}

async function subscribe(tier, billingIntervalRaw = BILLING_INTERVAL_MONTH) {
  const billingInterval = normalizeBillingInterval(billingIntervalRaw);
  if (tier !== 'pro' || !billingInterval) {
    setError('subscription.actionLabels.checkoutUnavailable');
    return;
  }
  actionPending.value = `${tier}:${billingInterval}`;
  clearMessages();
  try {
    track('ui_click', { id: 'subscription_subscribe', tier, billing_interval: billingInterval });
    addDebugLog('subscribe_clicked', {
      tier,
      billingInterval,
      effectiveTier: effectiveTier.value,
      currency: state.currency,
      embeddedCheckoutEnabled,
      stripePublishableKeyPresent,
      useEmbeddedCheckout: useEmbeddedCheckout.value
    });
    if (useEmbeddedCheckout.value) {
      const target = buildCheckoutPath(tier, state.currency, billingInterval);
      addDebugLog('embedded_checkout_navigation', { target });
      track('checkout_opened', { tier, currency: state.currency, billing_interval: billingInterval, mode: 'embedded' });
      emit('navigate', target);
      return;
    }

    const resp = await fetch(`${props.apiBase}/billing/checkout`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${props.token}`
      },
      body: JSON.stringify({ tier, currency: state.currency, billing_interval: billingInterval })
    });

    if (!resp.ok) {
      setError('subscription.actionLabels.checkoutUnavailable');
      return;
    }

    const data = await resp.json();
    addDebugLog('redirect_checkout_url_received', { hasUrl: Boolean(data?.url) });
    track('checkout_opened', { tier, currency: state.currency, billing_interval: billingInterval, mode: 'redirect' });
    tgOpenLink(data.url);
  } catch (err) {
    console.error(err);
    addDebugLog('subscribe_error', { message: err?.message || 'unknown_error' });
    setError('subscription.actionLabels.checkoutUnavailable');
  } finally {
    actionPending.value = '';
  }
}

	async function openBillingPortal() {
	  actionPending.value = 'portal';
    clearMessages();
	  try {
      track('ui_click', { id: 'subscription_open_billing_portal' });
      addDebugLog('billing_portal_request_started');
	    const resp = await fetch(`${props.apiBase}/billing/portal`, {
	      method: 'POST',
	      headers: { Authorization: `Bearer ${props.token}` }
	    });
      addDebugLog('billing_portal_response_received', { ok: resp.ok, status: resp.status });

	    if (!resp.ok) {
	      const payload = await resp.json().catch(() => ({}));
	      setError(
          payload?.error === 'no_customer'
            ? 'subscription.actionLabels.billingNotAvailableYet'
            : 'subscription.actionLabels.unableToOpenBillingPortal'
        );
	      return;
	    }

	    const data = await resp.json();
	    if (!data?.url) {
	      setError('subscription.actionLabels.unableToOpenBillingPortal');
	      return;
	    }

      track('billing_portal_opened');
      addDebugLog('billing_portal_opened', { hasUrl: Boolean(data?.url) });
	    tgOpenLink(data.url);
	  } catch (err) {
	    console.error(err);
      addDebugLog('billing_portal_error', { message: err?.message || 'unknown_error' });
	    setError('subscription.actionLabels.unableToOpenBillingPortal');
	  } finally {
	    actionPending.value = '';
	  }
	}

async function cancel() {
  actionPending.value = 'cancel';
  track('ui_click', { id: 'subscription_cancel_autorenew' });
  const resp = await fetch(`${props.apiBase}/billing/cancel`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${props.token}` }
  });

  if (resp.ok) {
    track('subscription_autorenew_disabled');
    await loadPlans();
  }
  actionPending.value = '';
}

async function resume() {
  actionPending.value = 'resume';
  track('ui_click', { id: 'subscription_resume_autorenew' });
  const resp = await fetch(`${props.apiBase}/billing/resume`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${props.token}` }
  });

  if (resp.ok) {
    track('subscription_autorenew_enabled');
    await loadPlans();
  }
  actionPending.value = '';
}

onMounted(async () => {
  trackPurchaseSuccessOnce();
  addDebugLog('subscription_screen_mounted', {
    path: window.location.pathname,
    search: window.location.search,
    embeddedCheckoutEnabled,
    stripePublishableKeyPresent,
    useEmbeddedCheckout: useEmbeddedCheckout.value
  });
  state.loading = true;
  try {
    await loadPlans();
  } catch (err) {
    console.error(err);
    setError('subscription.actionLabels.unexpectedError');
  } finally {
    state.loading = false;
    actionPending.value = '';
  }
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
  gap: 32px;
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
  font-size: clamp(32px, 5vw, 56px);
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
  font-weight: 600;
}

.manage-card {
  border: 1px solid var(--stroke);
  border-radius: 22px;
  padding: 20px 22px;
  background: rgba(255, 255, 255, 0.62);
  box-shadow: 0 28px 70px var(--shadow);
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 24px;
}

.manage-card h2 {
  margin: 0;
  font-size: 18px;
}

.manage-card p {
  margin: 6px 0 0;
  color: var(--muted);
}

.pending {
  margin: 10px 0 0;
  color: rgba(30, 26, 22, 0.78);
  font-weight: 650;
}

.manage-actions {
  display: grid;
  gap: 10px;
  align-content: start;
  justify-items: end;
}

.ghost {
  border: 1px solid var(--stroke);
  background: transparent;
  padding: 10px 14px;
  border-radius: 14px;
  cursor: pointer;
  font-weight: 650;
  letter-spacing: 0.01em;
  color: var(--ink);
}

.ghost:disabled {
  opacity: 0.55;
  cursor: default;
}

.ghost:active:not(:disabled) {
  transform: translateY(1px);
}

.manage-usage {
  margin-top: 16px;
  display: grid;
  gap: 16px;
}

.usage-item .label {
  font-size: 12px;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.16em;
}

.usage-bar {
  margin-top: 8px;
}

.usage-track {
  height: 10px;
  border-radius: 999px;
  background: rgba(30, 26, 22, 0.08);
  overflow: hidden;
}

.usage-fill {
  height: 100%;
  border-radius: 999px;
  background: rgba(31, 107, 99, 0.75);
}

.usage-fill.accent {
  background: rgba(199, 90, 36, 0.75);
}

.usage-meta {
  margin-top: 8px;
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  color: var(--muted);
}

.plans {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: 16px;
}

.billing-toggle {
  grid-column: 1 / -1;
  display: inline-flex;
  width: fit-content;
  border-radius: 14px;
  border: 1px solid var(--stroke);
  background: rgba(255, 255, 255, 0.55);
  padding: 4px;
  box-shadow: 0 14px 34px rgba(30, 26, 22, 0.12);
}

.billing-toggle-btn {
  border: none;
  border-radius: 10px;
  padding: 8px 12px;
  background: transparent;
  color: var(--muted);
  font-weight: 700;
  font-size: 13px;
  cursor: pointer;
  transition: background 140ms ease, color 140ms ease;
}

.billing-toggle-btn.active {
  background: rgba(30, 26, 22, 0.9);
  color: rgba(255, 255, 255, 0.94);
}

.billing-toggle-btn:disabled {
  opacity: 0.6;
  cursor: default;
}

.plan {
  border: 1px solid var(--stroke);
  border-radius: 22px;
  padding: 18px 18px;
  background: rgba(255, 255, 255, 0.64);
  box-shadow: 0 26px 60px var(--shadow);
  display: grid;
  gap: 14px;
  animation: floatIn 700ms ease-out both;
}

.plan.featured {
  border-color: rgba(199, 90, 36, 0.28);
  background:
    radial-gradient(120% 150% at 0% 0%, rgba(199, 90, 36, 0.18), transparent 55%),
    rgba(255, 255, 255, 0.64);
}

.plan-tier {
  text-transform: uppercase;
  letter-spacing: 0.26em;
  font-size: 11px;
  color: var(--accent-2);
  font-weight: 800;
}

.plan-price {
  display: flex;
  align-items: baseline;
  gap: 6px;
  margin-top: 10px;
}

.currency {
  font-weight: 900;
}

.amount {
  font-size: 34px;
  font-weight: 900;
  letter-spacing: -0.02em;
}

.period {
  color: var(--muted);
  font-size: 13px;
}

.plan-tagline {
  margin: 0;
  color: var(--muted);
  line-height: 1.55;
}

.pro-advantage {
  border-radius: 18px;
  padding: 12px 12px;
  background: rgba(255, 255, 255, 0.64);
  border: 1px solid rgba(30, 26, 22, 0.12);
  display: grid;
  gap: 6px;
}

.plan.featured .pro-advantage {
  border-color: rgba(199, 90, 36, 0.22);
  background: rgba(255, 255, 255, 0.72);
}

.pro-advantage-kicker {
  text-transform: uppercase;
  letter-spacing: 0.22em;
  font-size: 10px;
  font-weight: 850;
  color: var(--muted);
}

.plan.featured .pro-advantage-kicker {
  color: rgba(199, 90, 36, 0.95);
}

.pro-advantage-line {
  font-weight: 900;
  letter-spacing: -0.01em;
}

.cta {
  width: 100%;
  border: none;
  border-radius: 16px;
  padding: 12px 14px;
  background: rgba(31, 107, 99, 0.9);
  color: white;
  font-weight: 800;
  letter-spacing: 0.02em;
  cursor: pointer;
  box-shadow: 0 18px 40px rgba(31, 107, 99, 0.25);
  transition: transform 120ms ease, box-shadow 120ms ease, filter 120ms ease;
}

.plan.featured .cta {
  background: rgba(199, 90, 36, 0.95);
  box-shadow: 0 18px 40px rgba(199, 90, 36, 0.23);
}

.cta:disabled {
  opacity: 0.65;
  cursor: default;
  box-shadow: none;
}

.cta:active:not(:disabled) {
  transform: translateY(2px);
  filter: saturate(0.95);
}

.plan-note {
  margin: 10px 0 0;
  color: var(--muted);
  font-size: 12px;
  line-height: 1.5;
}

.plan-empty {
  padding: 16px 18px;
  border-radius: 18px;
  border: 1px dashed rgba(30, 26, 22, 0.22);
  color: var(--muted);
  grid-column: 1 / -1;
}

.bottom-nav {
  margin-top: auto;
  padding-top: 6px;
}

@media (max-width: 720px) {
  .manage-card {
    grid-template-columns: 1fr;
  }
  .manage-actions {
    justify-items: start;
  }
}
</style>
