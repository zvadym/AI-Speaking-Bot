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
              <span class="label">{{ voiceUsageLabel }}</span>
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
      <div v-if="showCurrencySelector" class="selector-group">
        <div class="selector-group-head">
          <span class="selector-group-label">{{ $t('subscription.currency.label') }}</span>
          <span class="selector-group-note">{{ currencyNoteLabel }}</span>
        </div>
        <div class="selector-list selector-list-row selector-list-currency" role="radiogroup" :aria-label="$t('subscription.currency.label')">
          <button
            v-for="currency in availableCurrencies"
            :key="currency"
            type="button"
            class="selector-option selector-option-compact"
            :class="{ active: currency === state.currency }"
            :disabled="isBusy"
            @click="selectCurrency(currency)"
          >
            <span class="selector-radio" aria-hidden="true"></span>
            <span class="selector-copy">
              <span class="selector-title">{{ currencyChipLabel(currency) }}</span>
              <span class="selector-caption">{{ currencyOptionNote(currency) }}</span>
            </span>
          </button>
        </div>
      </div>

      <div class="selector-group" v-if="showBillingToggle">
        <div class="selector-group-head">
          <span class="selector-group-label">{{ $t('subscription.period.label') }}</span>
          <span class="selector-group-note" v-if="billingSavingsPercent">
            {{ $t('subscription.billingIntervals.save', { save: billingSavingsPercent }) }}
          </span>
        </div>
        <div class="selector-list selector-list-row selector-list-billing" role="radiogroup" :aria-label="$t('subscription.period.label')">
        <button
          v-for="interval in availableBillingIntervals"
          :key="interval"
          type="button"
          class="selector-option selector-option-compact"
          :class="{ active: interval === selectedBillingInterval }"
          :disabled="isBusy"
          @click="selectBillingInterval(interval)"
        >
          <span class="selector-radio" aria-hidden="true"></span>
          <span class="selector-copy">
            <span class="selector-title">{{ billingIntervalLabel(interval) }}</span>
            <span class="selector-caption">{{ billingIntervalNote(interval) }}</span>
          </span>
        </button>
        </div>
      </div>

      <article
        v-for="(plan, index) in visiblePlans"
        :key="`${plan.tier}-${plan.billing_interval}`"
        class="plan"
        :class="{ featured: plan.tier === 'pro' }"
        :style="{ animationDelay: `${index * 120}ms` }"
        >
        <header>
          <div class="plan-topline">
            <span class="plan-tier">{{ planLabel(plan.tier) }}</span>
            <span class="plan-context">{{ currencyChipLabel(plan.currency) }} · {{ billingIntervalLabel(plan.billing_interval) }}</span>
          </div>
          <div class="plan-price">
            <template v-if="plan.billing_interval === BILLING_INTERVAL_YEAR && monthlyProPlan">
              <div class="price-meta">
                <s class="was">
                  {{ formatMoney(plan.currency, monthlyProPlan.amount_cents) }} {{ $t('subscription.period.perMonth') }}
                </s>
              </div>
              <div class="price-main">
                <span class="amount">
                  {{
                    formatMoney(plan.currency, monthlyEquivalentCents(plan.amount_cents) ?? plan.amount_cents, {
                      maximumFractionDigits: 2
                    })
                  }}
                </span>
                <span class="period">{{ $t('subscription.period.perMonth') }}</span>
              </div>
              <div class="price-sub">
                {{
                  $t('subscription.notes.billedAnnually', {
                    total: formatMoney(plan.currency, plan.amount_cents),
                    period: $t('subscription.period.perYear')
                  })
                }}
              </div>
            </template>
            <template v-else>
              <div class="price-main">
                <span class="amount">{{ formatMoney(plan.currency, plan.amount_cents) }}</span>
                <span class="period">{{ periodLabel(plan.billing_interval) }}</span>
              </div>
            </template>
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

    </section>
  </div>
</template>

<script setup>
import { onMounted, reactive, computed, ref, watch } from 'vue';
import { useI18n } from '../i18n.js';
import { tgOpenLink } from '../lib/tg.js';
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
  availableCurrencies: [],
  currencyDetails: {},
  baseLanguage: '',
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
const selectedBillingInterval = ref(BILLING_INTERVAL_YEAR);

function normalizeBillingInterval(raw, fallback = null) {
  const value = (raw ?? '').toString().trim().toLowerCase();
  if (!value) return fallback;
  if (!BILLING_INTERVALS.has(value)) return fallback;
  return value;
}

function normalizeCurrencyCode(raw, fallback = null) {
  const value = (raw ?? '').toString().trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(value)) return fallback;
  return value;
}

function billingIntervalSortValue(interval) {
  if (interval === BILLING_INTERVAL_YEAR) return 0;
  if (interval === BILLING_INTERVAL_MONTH) return 1;
  return 2;
}

function readSavedBillingInterval() {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem('subscription.billingInterval');
    return normalizeBillingInterval(raw);
  } catch {
    return null;
  }
}

watch(selectedBillingInterval, (next) => {
  if (typeof window === 'undefined') return;
  if (!next) return;
  try {
    window.localStorage.setItem('subscription.billingInterval', next);
  } catch {
    // ignore
  }
});

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

const plans = computed(() => state.plans || []);
const user = computed(() => state.user);
const usage = computed(() => state.usage);
const availableCurrencies = computed(() => Array.isArray(state.availableCurrencies) ? state.availableCurrencies : []);
const currencyDetails = computed(() => (state.currencyDetails && typeof state.currencyDetails === 'object') ? state.currencyDetails : {});
const effectiveTier = computed(() => usage.value?.tier || state.user?.plan_tier || 'free');
const showAutoRenewControls = computed(() => effectiveTier.value !== 'free');
const showManagePayments = computed(() => showAutoRenewControls.value || Boolean(state.user?.stripe_subscription_status));
const showCurrencySelector = computed(() => effectiveTier.value !== 'pro' && availableCurrencies.value.length > 1);
const currencyNoteLabel = computed(() => {
  const details = currencyDetails.value[state.currency];
  return t('subscription.currency.note', {
    currency: details?.name || state.currency
  });
});

const currentPlanLabel = computed(() => {
  if (!effectiveTier.value) return t('plans.tiers.free');
  return planLabel(effectiveTier.value);
});

const voiceUsageLabel = computed(() => {
  if (usage.value?.limit_period === 'month') return t('subscription.manage.voiceTotalMonthly');
  return t('subscription.manage.voiceTotalLifetime');
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

function formatMoney(currencyRaw, cents, { maximumFractionDigits = 0 } = {}) {
  const value = Number(cents);
  if (!Number.isFinite(value)) return t('common.dash');
  const amount = value / 100;
  const currency = normalizeCurrencyCode(currencyRaw, state.currency || 'EUR');
  const decimals = Number.isFinite(maximumFractionDigits) ? maximumFractionDigits : 0;
  try {
    return new Intl.NumberFormat(locale.value, {
      style: 'currency',
      currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: decimals
    }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(decimals)}`;
  }
}

function monthlyEquivalentCents(yearlyCents) {
  const value = Number(yearlyCents);
  if (!Number.isFinite(value) || value <= 0) return null;
  return value / 12;
}

function usagePercent(used, limit) {
  if (!limit || limit <= 0) return 0;
  return Math.min(100, Math.round((used / limit) * 100));
}

function totalVoiceUsed(usageData) {
  if (!usageData || typeof usageData !== 'object') return 0;
  if (Number.isFinite(Number(usageData.used_seconds))) return Number(usageData.used_seconds);
  if (Number.isFinite(Number(usageData.used_total))) return Number(usageData.used_total);
  return Number(usageData.used_user || 0) + Number(usageData.used_tts || 0);
}

function totalVoiceLimit(usageData) {
  if (!usageData || typeof usageData !== 'object') return 0;
  if (Number.isFinite(Number(usageData.limit_seconds))) return Number(usageData.limit_seconds);
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

const monthlyProPlan = computed(() => proPlans.value.find((plan) => plan.billing_interval === BILLING_INTERVAL_MONTH) || null);
const annualProPlan = computed(() => proPlans.value.find((plan) => plan.billing_interval === BILLING_INTERVAL_YEAR) || null);
const billingSavingsPercent = computed(() => {
  const month = monthlyProPlan.value?.amount_cents ?? null;
  const year = annualProPlan.value?.amount_cents ?? null;
  if (!Number.isFinite(Number(month)) || !Number.isFinite(Number(year))) return null;
  const base = Number(month) * 12;
  if (base <= 0) return null;
  const pct = Math.round((1 - Number(year) / base) * 100);
  return pct > 0 ? pct : null;
});

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
  selectedBillingInterval.value = intervals.includes(BILLING_INTERVAL_YEAR)
    ? BILLING_INTERVAL_YEAR
    : intervals.includes(BILLING_INTERVAL_MONTH)
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

function billingIntervalNote(intervalRaw) {
  const interval = normalizeBillingInterval(intervalRaw, BILLING_INTERVAL_MONTH);
  if (interval === BILLING_INTERVAL_YEAR && billingSavingsPercent.value) {
    return t('subscription.billingIntervals.save', { save: billingSavingsPercent.value });
  }
  return t('subscription.period.perMonth');
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

function applyPlansPayload(data, { includeUserState = true } = {}) {
  state.plans = Array.isArray(data?.plans) ? data.plans : [];
  state.user = includeUserState ? (data?.user || null) : null;
  state.usage = includeUserState ? (data?.usage || null) : null;
  state.currency = normalizeCurrencyCode(data?.currency, 'EUR');
  state.availableCurrencies = Array.isArray(data?.available_currencies)
    ? data.available_currencies.map((currency) => normalizeCurrencyCode(currency)).filter(Boolean)
    : [];
  state.currencyDetails = data?.currency_details && typeof data.currency_details === 'object'
    ? data.currency_details
    : {};
  state.baseLanguage = (data?.base_language || '').toString().trim().toLowerCase();
  syncSelectedBillingInterval();
}

async function fetchPlansPayload(path, headers = {}) {
  const resp = await fetch(`${props.apiBase}${path}`, { headers });
  const data = await resp.json().catch(() => null);
  return { resp, data };
}

function buildPlansPath(basePath, currencyOverride = null) {
  const params = new URLSearchParams();
  params.set('include_all_intervals', 'true');
  const currency = normalizeCurrencyCode(currencyOverride, null);
  if (currency) params.set('currency', currency);
  return `${basePath}?${params.toString()}`;
}

async function loadPlans({ keepNotice = false, currencyOverride = null } = {}) {
  errorState.value = null;
  if (!keepNotice) noticeState.value = null;
  addDebugLog('plans_request_started');
  try {
    const { resp, data } = await fetchPlansPayload(buildPlansPath('/plans', currencyOverride), {
      Authorization: `Bearer ${props.token}`
    });
    addDebugLog('plans_response_received', { ok: resp.ok, status: resp.status, source: 'authorized' });
    if (resp.ok) {
      applyPlansPayload(data);
      return;
    }
    addDebugLog('plans_request_failed', {
      status: resp.status,
      error: data?.error || null,
      source: 'authorized'
    });
  } catch (err) {
    console.error(err);
    addDebugLog('plans_request_failed', {
      status: null,
      error: err?.message || 'unknown_error',
      source: 'authorized'
    });
  }

  try {
    addDebugLog('plans_public_fallback_started');
    const { resp, data } = await fetchPlansPayload(buildPlansPath('/public/plans', currencyOverride));
    addDebugLog('plans_response_received', { ok: resp.ok, status: resp.status, source: 'public' });
    if (!resp.ok) {
      setError('subscription.actionLabels.unableToLoadPlans');
      return;
    }
    applyPlansPayload(data, { includeUserState: false });
  } catch (err) {
    console.error(err);
    addDebugLog('plans_request_failed', {
      status: null,
      error: err?.message || 'unknown_error',
      source: 'public'
    });
    setError('subscription.actionLabels.unableToLoadPlans');
  }
}

function currencyChipLabel(currencyRaw) {
  const currency = normalizeCurrencyCode(currencyRaw, '');
  if (!currency) return '';
  const details = currencyDetails.value[currency];
  const symbol = details?.symbol || currency;
  return symbol === currency ? currency : `${symbol} ${currency}`;
}

function currencyOptionNote(currencyRaw) {
  const currency = normalizeCurrencyCode(currencyRaw, '');
  if (!currency) return '';
  return currencyDetails.value[currency]?.name || currency;
}

async function selectCurrency(currencyRaw) {
  const currency = normalizeCurrencyCode(currencyRaw, null);
  if (!currency) return;
  if (!availableCurrencies.value.includes(currency)) return;
  if (currency === state.currency) return;

  actionPending.value = `currency:${currency}`;
  clearMessages();
  try {
    const resp = await fetch(`${props.apiBase}/me/preferences/billing-currency`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${props.token}`
      },
      body: JSON.stringify({ currency })
    });

    if (!resp.ok) {
      setError('common.errors.couldNotSave');
      return;
    }

    await loadPlans({ keepNotice: true, currencyOverride: currency });
    addDebugLog('subscription_currency_selected', {
      currency,
      baseLanguage: state.baseLanguage || null
    });
  } catch (err) {
    console.error(err);
    setError('common.errors.couldNotSave');
  } finally {
    actionPending.value = '';
  }
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
  const resp = await fetch(`${props.apiBase}/billing/cancel`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${props.token}` }
  });

  if (resp.ok) {
    await loadPlans();
  }
  actionPending.value = '';
}

async function resume() {
  actionPending.value = 'resume';
  const resp = await fetch(`${props.apiBase}/billing/resume`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${props.token}` }
  });

  if (resp.ok) {
    await loadPlans();
  }
  actionPending.value = '';
}

onMounted(async () => {
  const savedInterval = readSavedBillingInterval();
  if (savedInterval) selectedBillingInterval.value = savedInterval;
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
  width: min(760px, 100%);
  min-height: 100vh;
  min-height: 100dvh;
  padding: 24px 16px calc(104px + env(safe-area-inset-bottom, 0px));
  display: flex;
  flex-direction: column;
  gap: 18px;
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
  font-size: clamp(28px, 7vw, 38px);
  letter-spacing: -0.04em;
  font-weight: 800;
  margin: 0;
}

.hero-sub {
  margin: 0;
  max-width: 40ch;
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
  background: rgba(255, 255, 255, 0.58);
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
  font-weight: 600;
}

.manage-card {
  border: 1px solid var(--stroke);
  border-radius: 16px;
  padding: 16px;
  background: rgba(255, 255, 255, 0.62);
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 14px;
}

.manage-card h2 {
  margin: 0;
  font-size: 17px;
  letter-spacing: -0.03em;
}

.manage-card p {
  margin: 4px 0 0;
  color: var(--muted);
}

.pending {
  margin: 8px 0 0;
  color: rgba(30, 26, 22, 0.78);
  font-weight: 600;
}

.manage-actions {
  display: grid;
  gap: 8px;
  align-content: start;
  justify-items: end;
}

.ghost {
  border: 1px solid var(--stroke);
  background: rgba(255, 255, 255, 0.42);
  padding: 10px 12px;
  border-radius: 12px;
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
  margin-top: 12px;
  display: grid;
  gap: 10px;
}

.usage-item .label {
  font-size: 11px;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.1em;
}

.usage-bar {
  margin-top: 6px;
}

.usage-track {
  height: 8px;
  border-radius: 999px;
  background: rgba(32, 35, 29, 0.08);
  overflow: hidden;
}

.usage-fill {
  height: 100%;
  border-radius: 999px;
  background: rgba(95, 117, 96, 0.75);
}

.usage-fill.accent {
  background: rgba(181, 109, 86, 0.78);
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
  gap: 14px;
}

.selector-group {
  display: grid;
  gap: 8px;
  padding-top: 2px;
}

.selector-group-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.selector-group-label {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--muted);
  font-weight: 700;
}

.selector-group-note {
  font-size: 12px;
  color: var(--muted);
}

.selector-list {
  display: grid;
  gap: 8px;
}

.selector-list-row {
  grid-auto-flow: column;
  grid-auto-columns: 1fr;
}

.selector-list-currency {
  grid-template-columns: repeat(4, minmax(0, 1fr));
}

.selector-list-billing {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.selector-option {
  border: 1px solid rgba(157, 146, 129, 0.24);
  border-radius: 14px;
  padding: 10px 12px;
  background: rgba(255, 255, 255, 0.58);
  color: var(--ink);
  display: grid;
  grid-template-columns: 16px 1fr;
  align-items: center;
  gap: 10px;
  text-align: left;
  transition: border-color 140ms ease, background 140ms ease, transform 140ms ease;
}

.selector-option-compact {
  min-width: 0;
  padding: 10px 10px;
}

.selector-option:hover:not(:disabled),
.selector-option:focus-visible:not(:disabled) {
  transform: translateY(-1px);
  border-color: rgba(95, 117, 96, 0.28);
}

.selector-option.active {
  background: rgba(127, 150, 128, 0.12);
  border-color: rgba(95, 117, 96, 0.34);
}

.selector-option:disabled {
  opacity: 0.6;
  cursor: default;
}

.selector-radio {
  width: 16px;
  height: 16px;
  border-radius: 999px;
  border: 1.5px solid rgba(134, 124, 107, 0.45);
  background: rgba(255, 255, 255, 0.82);
  position: relative;
}

.selector-option.active .selector-radio {
  border-color: rgba(95, 117, 96, 0.6);
  background: rgba(255, 255, 255, 0.94);
}

.selector-option.active .selector-radio::after {
  content: '';
  position: absolute;
  inset: 3px;
  border-radius: 999px;
  background: var(--accent-strong);
}

.selector-copy {
  display: grid;
  gap: 2px;
}

.selector-title {
  font-size: 13px;
  font-weight: 700;
  color: var(--ink);
}

.selector-caption {
  font-size: 11px;
  color: var(--muted);
}

.plan {
  border: 1px solid var(--stroke);
  border-radius: 16px;
  padding: 16px;
  background: rgba(255, 255, 255, 0.64);
  display: grid;
  gap: 12px;
  animation: floatIn 700ms ease-out both;
}

.plan.featured {
  border-color: rgba(181, 109, 86, 0.28);
  background:
    radial-gradient(120% 150% at 0% 0%, rgba(181, 109, 86, 0.12), transparent 55%),
    rgba(255, 255, 255, 0.64);
}

.plan-topline {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  align-items: center;
  flex-wrap: wrap;
}

.plan-tier {
  text-transform: uppercase;
  letter-spacing: 0.12em;
  font-size: 10px;
  color: var(--accent-strong);
  font-weight: 800;
}

.plan-context {
  font-size: 11px;
  color: var(--muted);
}

.plan-price {
  display: grid;
  gap: 4px;
  margin-top: 8px;
}

.price-main {
  display: flex;
  align-items: baseline;
  gap: 6px;
  flex-wrap: nowrap;
  white-space: nowrap;
}

.price-meta,
.price-sub {
  font-size: 11px;
  color: var(--muted);
}

.price-meta {
  margin-bottom: -2px;
}

.was {
  text-decoration-thickness: 2px;
  text-decoration-color: rgba(30, 26, 22, 0.22);
}

.currency {
  font-weight: 900;
}

.amount {
  font-size: 31px;
  font-weight: 800;
  letter-spacing: -0.02em;
}

.period {
  color: var(--muted);
  font-size: 12px;
}

.plan-tagline {
  margin: 0;
  color: var(--muted);
  line-height: 1.5;
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
  border-radius: 12px;
  padding: 12px 14px;
  background: rgba(95, 117, 96, 0.92);
  color: white;
  font-weight: 750;
  letter-spacing: 0.02em;
  cursor: pointer;
  transition: transform 120ms ease, filter 120ms ease;
}

.plan.featured .cta {
  background: rgba(181, 109, 86, 0.95);
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

@media (max-width: 720px) {
  .manage-card {
    grid-template-columns: 1fr;
  }
  .manage-actions {
    justify-items: start;
  }

  .status-card {
    flex-direction: column;
  }

  .selector-list-currency {
    grid-template-columns: repeat(auto-fit, minmax(0, 1fr));
  }
}
</style>
