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

    <section class="status" v-if="upgradeConfirm.open">
      <div class="status-card confirm">
        <span class="status-label">{{ $t('subscription.upgradeConfirm.title') }}</span>
        <div class="status-text confirm-content">
          <div>{{ $t('subscription.upgradeConfirm.chargeNow', { amount: upgradeConfirmAmountNow }) }}</div>
          <div>{{ $t('subscription.upgradeConfirm.newMonthly', { amount: upgradeConfirmAmountNext }) }}</div>
          <div class="confirm-actions">
            <button class="ghost" :disabled="isBusy" @click="cancelUpgradeConfirm">
              {{ $t('subscription.upgradeConfirm.cancel') }}
            </button>
            <button class="cta confirm-cta" :disabled="isBusy" @click="confirmUpgrade">
              {{ actionPending === 'upgrade_confirm' ? $t('subscription.actions.openingCheckout') : $t('subscription.upgradeConfirm.confirm') }}
            </button>
          </div>
        </div>
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
              <span class="label">{{ $t('subscription.manage.practiceTime') }}</span>
              <div class="usage-bar">
                <div class="usage-track">
                  <div
                    class="usage-fill"
                    :style="{ width: `${usagePercent(usage.used_user, usage.limit_user)}%` }"
                  ></div>
                </div>
              </div>
            </div>
            <div class="usage-item">
              <span class="label">{{ $t('subscription.manage.voiceReplies') }}</span>
              <div class="usage-bar">
                <div class="usage-track">
                  <div
                    class="usage-fill accent"
                    :style="{ width: `${usagePercent(usage.used_tts, usage.limit_tts)}%` }"
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
          <button
            class="ghost"
            :disabled="isBusy"
            @click="cancel"
            v-if="showAutoRenewControls && user.plan_autorenew"
          >
            {{ $t('subscription.manage.turnOffAutoRenew') }}
          </button>
          <button
            class="ghost"
            :disabled="isBusy"
            @click="resume"
            v-else-if="showAutoRenewControls"
          >
            {{ $t('subscription.manage.resumeAutoRenew') }}
          </button>
        </div>
      </div>
    </section>

    <section class="plans">
      <article
        v-for="(plan, index) in visiblePlans"
        :key="plan.tier"
        class="plan"
        :class="{ featured: plan.tier === 'pro' }"
        :style="{ animationDelay: `${index * 120}ms` }"
      >
        <header>
          <span class="plan-tier">{{ planLabel(plan.tier) }}</span>
          <div class="plan-price">
            <span class="currency">{{ currencySymbol(plan.currency) }}</span>
            <span class="amount">{{ formatPrice(plan.amount_cents) }}</span>
            <span class="period">{{ $t('subscription.period.perMonth') }}</span>
          </div>
        </header>

        <div class="pro-advantage" v-if="plan.tier === 'pro' && proVsPlusMultiplier">
          <div class="pro-advantage-kicker">{{ $t('subscription.comparison.kicker') }}</div>
          <div class="pro-advantage-line">
            {{ $t('plans.tiers.pro') }} {{ $t('subscription.comparison.is') }} {{ proVsPlusMultiplier }}× {{ $t('plans.tiers.plus') }}
          </div>
        </div>

        <p class="plan-tagline">{{ planTagline(plan.tier) }}</p>

        <button
          class="cta"
          :disabled="isBusy || (effectiveTier === 'pro' && plan.tier === 'plus' && user?.pending_plan_tier === 'plus')"
          @click.stop="subscribe(plan.tier)"
        >
          {{ actionPending === plan.tier ? $t('subscription.actions.openingCheckout') : actionLabel(plan.tier) }}
        </button>

        <p class="plan-note" v-if="effectiveTier === 'pro' && plan.tier === 'plus'">
          {{ $t('subscription.notes.downgradeEndOfPeriod') }}
        </p>
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
import { loadStripe } from '@stripe/stripe-js';
import { useI18n } from '../i18n.js';
import { tgOpenLink } from '../lib/tg.js';
import { track } from '../lib/analytics.js';
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
const upgradeConfirm = reactive({
  open: false,
  tier: '',
  currency: 'EUR',
  amountDueCents: 0,
  nextAmountCents: 0,
  prorationDate: null
});
const upgradeConfirmAmountNow = computed(() => formatCurrencyAmount(upgradeConfirm.amountDueCents, upgradeConfirm.currency));
const upgradeConfirmAmountNext = computed(() => formatCurrencyAmount(upgradeConfirm.nextAmountCents, upgradeConfirm.currency));

function buildCheckoutPath(tier, currency) {
  const params = new URLSearchParams();
  params.set('tier', tier);
  params.set('currency', currency);
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

function resetUpgradeConfirm() {
  upgradeConfirm.open = false;
  upgradeConfirm.tier = '';
  upgradeConfirm.currency = 'EUR';
  upgradeConfirm.amountDueCents = 0;
  upgradeConfirm.nextAmountCents = 0;
  upgradeConfirm.prorationDate = null;
}

function formatCurrencyAmount(cents, currency) {
  const safeCents = Number.isFinite(Number(cents)) ? Number(cents) : 0;
  const safeCurrency = (currency || 'EUR').toString().toUpperCase();
  try {
    return new Intl.NumberFormat(locale.value || 'en', {
      style: 'currency',
      currency: safeCurrency
    }).format(safeCents / 100);
  } catch {
    return `${(safeCents / 100).toFixed(2)} ${safeCurrency}`;
  }
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
const effectiveTier = computed(() => usage.value?.tier || state.user?.plan_tier || 'free');
const showAutoRenewControls = computed(() => effectiveTier.value !== 'free');
const showManagePayments = computed(() => showAutoRenewControls.value || Boolean(state.user?.stripe_subscription_status));
const plusPlan = computed(() => plans.value.find((plan) => plan.tier === 'plus') || null);
const proPlan = computed(() => plans.value.find((plan) => plan.tier === 'pro') || null);
const proVsPlusMultiplier = computed(() => {
  const plusSeconds = plusPlan.value?.user_audio_seconds_per_week;
  const proSeconds = proPlan.value?.user_audio_seconds_per_week;
  if (!plusSeconds || !proSeconds) return null;
  const ratio = proSeconds / plusSeconds;
  if (!Number.isFinite(ratio) || ratio <= 0) return null;
  return Math.max(1, Math.round(ratio));
});

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
  if (tier !== 'pro' && tier !== 'plus' && tier !== 'free') return t('plans.tiers.free');
  return t(`plans.tiers.${tier}`);
}

function planTagline(tier) {
  if (tier === 'pro') return t('subscription.taglines.pro');
  if (tier === 'plus') return t('subscription.taglines.plus');
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

function formatSeconds(seconds) {
  if (!seconds && seconds !== 0) return t('common.dash');
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return t('units.minutesShort', { count: minutes });
  const hours = Math.round(minutes / 60);
  return t('units.hoursShort', { count: hours });
}

function usagePercent(used, limit) {
  if (!limit || limit <= 0) return 0;
  return Math.min(100, Math.round((used / limit) * 100));
}

const visiblePlans = computed(() => {
  if (!effectiveTier.value) return plans.value;
  return plans.value.filter((plan) => plan.tier !== effectiveTier.value);
});

function actionLabel(tier) {
  if (effectiveTier.value === 'plus' && tier === 'pro') return t('subscription.actions.upgrade');
  if (effectiveTier.value === 'pro' && tier === 'plus') {
    if (state.user?.pending_plan_tier === 'plus') return t('subscription.actions.scheduled');
    return t('subscription.actions.switchToPlus');
  }
  return t('subscription.actions.subscribe');
}

async function confirmUpgradePaymentIntent(paymentIntent) {
  const clientSecret = paymentIntent?.client_secret || '';
  if (!clientSecret) return true;
  if (!stripePublishableKey) {
    setError('subscription.actionLabels.checkoutUnavailable');
    addDebugLog('upgrade_payment_confirm_skipped_missing_key');
    return false;
  }

  const stripe = await loadStripe(stripePublishableKey);
  if (!stripe?.confirmCardPayment) {
    setError('subscription.actionLabels.checkoutUnavailable');
    addDebugLog('upgrade_payment_confirm_skipped_missing_stripe');
    return false;
  }

  addDebugLog('upgrade_payment_confirm_started', {
    status: paymentIntent?.status || null
  });
  const result = await stripe.confirmCardPayment(clientSecret);
  if (result?.error) {
    setError('subscription.actionLabels.upgradePaymentFailed');
    addDebugLog('upgrade_payment_confirm_error', {
      code: result.error.code || null,
      type: result.error.type || null,
      message: result.error.message || 'unknown_error'
    });
    return false;
  }

  const status = result?.paymentIntent?.status || null;
  addDebugLog('upgrade_payment_confirm_result', { status });
  if (status === 'succeeded' || status === 'processing' || status === 'requires_capture') {
    return true;
  }

  setError('subscription.actionLabels.upgradePaymentFailed');
  return false;
}

async function upgradePlan(tier, { prorationDate = null } = {}) {
  const body = { tier };
  if (prorationDate) {
    body.proration_date = prorationDate;
  }
  addDebugLog('upgrade_request_started', { tier });
  const resp = await fetch(`${props.apiBase}/billing/upgrade`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${props.token}`
    },
    body: JSON.stringify(body)
  });
  addDebugLog('upgrade_response_received', { ok: resp.ok, status: resp.status });

  if (!resp.ok) {
    const payload = await resp.json().catch(() => ({}));
    setError(
      payload?.error === 'not_an_upgrade'
        ? 'subscription.actionLabels.notADowngrade'
        : 'subscription.actionLabels.switchUnavailable'
    );
    return;
  }

  const data = await resp.json().catch(() => ({}));
  addDebugLog('upgrade_response_parsed', {
    pending: Boolean(data?.pending),
    paymentIntentStatus: data?.payment_intent?.status || null,
    hasPaymentIntentSecret: Boolean(data?.payment_intent?.client_secret),
    invoiceStatus: data?.invoice?.status || null
  });

  const confirmed = await confirmUpgradePaymentIntent(data?.payment_intent || null);
  if (!confirmed) return;

  if (data?.pending) {
    setNotice('subscription.actionLabels.upgradePending');
  } else {
    setNotice('subscription.actionLabels.upgradeSuccess');
  }
  await loadPlans({ keepNotice: true });
}

async function requestUpgradePreview(tier) {
  addDebugLog('upgrade_preview_request_started', { tier });
  const resp = await fetch(`${props.apiBase}/billing/upgrade/preview`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${props.token}`
    },
    body: JSON.stringify({ tier })
  });
  addDebugLog('upgrade_preview_response_received', { ok: resp.ok, status: resp.status });

  if (!resp.ok) {
    setError('subscription.actionLabels.switchUnavailable');
    return null;
  }

  const data = await resp.json().catch(() => ({}));
  addDebugLog('upgrade_preview_response_parsed', {
    amountDueCents: data?.amount_due_cents ?? null,
    nextAmountCents: data?.next_amount_cents ?? null,
    currency: data?.currency || null,
    prorationDate: data?.proration_date || null
  });
  return data;
}

function openUpgradeConfirm(preview, tier) {
  upgradeConfirm.open = true;
  upgradeConfirm.tier = tier;
  upgradeConfirm.currency = (preview?.currency || state.currency || 'EUR').toUpperCase();
  upgradeConfirm.amountDueCents = Number(preview?.amount_due_cents || 0);
  upgradeConfirm.nextAmountCents = Number(preview?.next_amount_cents || 0);
  upgradeConfirm.prorationDate = Number.isFinite(Number(preview?.proration_date)) ? Number(preview.proration_date) : null;
  addDebugLog('upgrade_confirmation_opened', {
    tier,
    amountDueCents: upgradeConfirm.amountDueCents,
    nextAmountCents: upgradeConfirm.nextAmountCents,
    currency: upgradeConfirm.currency
  });
}

function cancelUpgradeConfirm() {
  addDebugLog('upgrade_confirmation_canceled');
  resetUpgradeConfirm();
}

async function confirmUpgrade() {
  if (!upgradeConfirm.open || !upgradeConfirm.tier) return;
  actionPending.value = 'upgrade_confirm';
  clearMessages();
  try {
    addDebugLog('upgrade_confirmation_accepted', { tier: upgradeConfirm.tier });
    await upgradePlan(upgradeConfirm.tier, { prorationDate: upgradeConfirm.prorationDate });
    resetUpgradeConfirm();
  } catch (err) {
    console.error(err);
    addDebugLog('upgrade_confirmation_error', { message: err?.message || 'unknown_error' });
    setError('subscription.actionLabels.switchUnavailable');
  } finally {
    actionPending.value = '';
  }
}

async function loadPlans({ keepNotice = false } = {}) {
  errorState.value = null;
  if (!keepNotice) noticeState.value = null;
  addDebugLog('plans_request_started');
  const resp = await fetch(`${props.apiBase}/plans`, {
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
}

async function subscribe(tier) {
  actionPending.value = tier;
  clearMessages();
  resetUpgradeConfirm();
  try {
    track('ui_click', { id: 'subscription_subscribe', tier });
    addDebugLog('subscribe_clicked', {
      tier,
      effectiveTier: effectiveTier.value,
      currency: state.currency,
      embeddedCheckoutEnabled,
      stripePublishableKeyPresent,
      useEmbeddedCheckout: useEmbeddedCheckout.value
    });
    if (effectiveTier.value === 'plus' && tier === 'pro') {
      const preview = await requestUpgradePreview(tier);
      if (preview) openUpgradeConfirm(preview, tier);
      return;
    }

    if (effectiveTier.value === 'pro' && tier === 'plus') {
      const resp = await fetch(`${props.apiBase}/billing/downgrade`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${props.token}`
        },
        body: JSON.stringify({ tier })
      });

      if (!resp.ok) {
        const payload = await resp.json().catch(() => ({}));
        setError(
          payload?.error === 'not_a_downgrade'
            ? 'subscription.actionLabels.notADowngrade'
            : 'subscription.actionLabels.switchUnavailable'
        );
        return;
      }

      const data = await resp.json().catch(() => ({}));
      const effectiveAt = data?.effective_at ? new Date(data.effective_at) : null;
      setNotice(
        effectiveAt && Number.isFinite(effectiveAt.getTime())
          ? 'subscription.actionLabels.switchAtRenewalWithDate'
          : 'subscription.actionLabels.switchAtRenewal',
        effectiveAt && Number.isFinite(effectiveAt.getTime()) ? { date: formatDate(effectiveAt) } : undefined
      );
      await loadPlans({ keepNotice: true });
      return;
    }

    if (useEmbeddedCheckout.value) {
      const target = buildCheckoutPath(tier, state.currency);
      addDebugLog('embedded_checkout_navigation', { target });
      track('checkout_opened', { tier, currency: state.currency, mode: 'embedded' });
      emit('navigate', target);
      return;
    }

    const resp = await fetch(`${props.apiBase}/billing/checkout`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${props.token}`
      },
      body: JSON.stringify({ tier, currency: state.currency })
    });

    if (!resp.ok) {
      setError('subscription.actionLabels.checkoutUnavailable');
      return;
    }

    const data = await resp.json();
    addDebugLog('redirect_checkout_url_received', { hasUrl: Boolean(data?.url) });
    track('checkout_opened', { tier, currency: state.currency, mode: 'redirect' });
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

.status-card.confirm {
  border-color: rgba(31, 107, 99, 0.35);
  background: rgba(31, 107, 99, 0.08);
}

.confirm-content {
  display: grid;
  gap: 8px;
}

.confirm-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 4px;
}

.cta.confirm-cta {
  width: auto;
  min-width: 180px;
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
