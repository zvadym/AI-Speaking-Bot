<template>
  <div class="shell fade-in">
    <header class="hero">
      <div class="hero-badge">Subscription Atelier</div>
      <h1>Choose your training tempo</h1>
      <p class="hero-sub">
        Keep your speaking practice steady. Pick a cadence that matches your week and toggle auto-renew whenever you want.
      </p>
    </header>

    <section class="status" v-if="statusMessage">
      <div class="status-card">
        <span class="status-label">Status</span>
        <span class="status-text">{{ statusMessage }}</span>
      </div>
    </section>

    <section class="status" v-if="notice">
      <div class="status-card">
        <span class="status-label">Scheduled</span>
        <span class="status-text">{{ notice }}</span>
      </div>
    </section>

    <section class="status" v-if="error">
      <div class="status-card error">
        <span class="status-label">Notice</span>
        <span class="status-text">{{ error }}</span>
      </div>
    </section>

    <section class="manage" v-if="user">
      <div class="manage-card">
        <div>
          <h2>Your plan</h2>
          <p>
            {{ currentPlanLabel }}
            <template v-if="showAutoRenewControls"> · {{ autoRenewLabel }}</template>
          </p>
          <p class="pending" v-if="pendingLabel">
            {{ pendingLabel }}
          </p>
          <div class="manage-usage" v-if="usage">
            <div class="usage-item">
              <span class="label">Practice time</span>
              <div class="usage-bar">
                <div class="usage-track">
                  <div
                    class="usage-fill"
                    :style="{ width: `${usagePercent(usage.used_user, usage.limit_user)}%` }"
                  ></div>
                </div>
                <div class="usage-meta">
                  <span>{{ formatSeconds(usage.used_user) }} used</span>
                  <span>{{ formatSeconds(usage.remaining_user) }} left</span>
                </div>
              </div>
            </div>
            <div class="usage-item">
              <span class="label">Voice replies</span>
              <div class="usage-bar">
                <div class="usage-track">
                  <div
                    class="usage-fill accent"
                    :style="{ width: `${usagePercent(usage.used_tts, usage.limit_tts)}%` }"
                  ></div>
                </div>
                <div class="usage-meta">
                  <span>{{ formatSeconds(usage.used_tts) }} used</span>
                  <span>{{ formatSeconds(usage.remaining_tts) }} left</span>
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
            Manage payments
          </button>
          <button
            class="ghost"
            :disabled="isBusy"
            @click="cancel"
            v-if="showAutoRenewControls && user.plan_autorenew"
          >
            Turn off auto-renew
          </button>
          <button
            class="ghost"
            :disabled="isBusy"
            @click="resume"
            v-else-if="showAutoRenewControls"
          >
            Resume auto-renew
          </button>
        </div>
      </div>
    </section>

    <section class="plans">
      <section class="comparison" v-if="showProVsPlus">
        <div class="comparison-card">
          <div class="comparison-kicker">Pro advantage</div>
          <div class="comparison-title">
            <span class="comparison-pro">Pro</span>
            <span class="comparison-eq">is</span>
            <span class="comparison-mult">{{ proVsPlusMultiplier }}×</span>
            <span class="comparison-plus">Plus</span>
          </div>
          <p class="comparison-sub">A single upgrade signal — built for longer voice messages and more back‑and‑forth.</p>
        </div>
      </section>

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
            <span class="period">/ month</span>
          </div>
        </header>

        <p class="plan-tagline">{{ planTagline(plan.tier) }}</p>

        <button
          class="cta"
          :disabled="isBusy || (effectiveTier === 'pro' && plan.tier === 'plus' && user?.pending_plan_tier === 'plus')"
          @click.stop="subscribe(plan.tier)"
        >
          {{ actionPending === plan.tier ? 'Opening Checkout…' : actionLabel(plan.tier) }}
        </button>

        <p class="plan-note" v-if="effectiveTier === 'pro' && plan.tier === 'plus'">
          Switches at the end of your current billing period.
        </p>
      </article>

      <div class="plan-empty" v-if="!visiblePlans.length">
        You're already on the top tier.
      </div>
    </section>

    <div class="bottom-nav">
      <BackToMenu @navigate="(path) => $emit('navigate', path)" />
    </div>
  </div>
</template>

<script setup>
import { onMounted, reactive, computed, ref } from 'vue';
import { tgOpenLink } from '../lib/tg.js';
import BackToMenu from '../components/BackToMenu.vue';

const props = defineProps({
  apiBase: { type: String, required: true },
  token: { type: String, required: true }
});

defineEmits(['navigate']);

const state = reactive({
  loading: true,
  plans: [],
  user: null,
  currency: 'EUR',
  usage: null
});

const error = ref('');
const notice = ref('');
const actionPending = ref('');
const isBusy = computed(() => state.loading || Boolean(actionPending.value));

const statusMessage = computed(() => {
  const params = new URLSearchParams(window.location.search);
  if (params.get('session_id')) return 'Checkout completed. We are activating your plan now.';
  if (window.location.pathname.endsWith('/cancel')) return 'Checkout canceled. Your current plan remains unchanged.';
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
const showProVsPlus = computed(() => effectiveTier.value !== 'pro' && Boolean(proVsPlusMultiplier.value));

const currentPlanLabel = computed(() => {
  if (!effectiveTier.value) return 'Free';
  return planLabel(effectiveTier.value);
});

const pendingLabel = computed(() => {
  const pendingTier = state.user?.pending_plan_tier;
  if (!pendingTier) return '';
  const label = pendingTier === 'pro' ? 'Pro' : pendingTier === 'plus' ? 'Plus' : 'Free';
  const effectiveAt = state.user?.pending_plan_effective_at ? new Date(state.user.pending_plan_effective_at) : null;
  if (effectiveAt && Number.isFinite(effectiveAt.getTime())) {
    return `Scheduled: switch to ${label} on ${effectiveAt.toLocaleDateString()}.`;
  }
  return `Scheduled: switch to ${label} at renewal.`;
});

const autoRenewLabel = computed(() => {
  if (!state.user) return 'Auto-renew off';
  return state.user.plan_autorenew ? 'Auto-renew on' : 'Auto-renew off';
});

function planLabel(tier) {
  if (tier === 'pro') return 'Pro';
  if (tier === 'plus') return 'Plus';
  return 'Free';
}

function planTagline(tier) {
  if (tier === 'pro') return 'Daily training mode — for longer voice messages and more back‑and‑forth.';
  if (tier === 'plus') return 'A steady weekly cadence to keep your speaking momentum.';
  return 'A gentle warm‑up for casual practice.';
}

function currencySymbol(currency) {
  if (currency === 'EUR') return '€';
  if (currency === 'USD') return '$';
  return currency || '€';
}

function formatPrice(cents) {
  if (!cents) return '—';
  return (cents / 100).toFixed(0);
}

function formatSeconds(seconds) {
  if (!seconds && seconds !== 0) return '—';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  return `${hours} h`;
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
  if (effectiveTier.value === 'plus' && tier === 'pro') return 'Upgrade';
  if (effectiveTier.value === 'pro' && tier === 'plus') {
    if (state.user?.pending_plan_tier === 'plus') return 'Scheduled';
    return 'Switch to Plus';
  }
  return 'Subscribe';
}

async function loadPlans() {
  const resp = await fetch(`${props.apiBase}/plans`, {
    headers: { Authorization: `Bearer ${props.token}` }
  });

  if (!resp.ok) {
    error.value = 'Unable to load plans.';
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
  try {
    if (effectiveTier.value === 'plus' && tier === 'pro') {
      await openBillingPortal();
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
        error.value = payload?.error === 'not_a_downgrade' ? 'This plan change is not available.' : 'Switch unavailable right now.';
        return;
      }

      const data = await resp.json().catch(() => ({}));
      const effectiveAt = data?.effective_at ? new Date(data.effective_at) : null;
      notice.value =
        effectiveAt && Number.isFinite(effectiveAt.getTime())
          ? `We’ll switch you at renewal (${effectiveAt.toLocaleDateString()}).`
          : 'We’ll switch you at renewal.';
      await loadPlans();
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
      error.value = 'Checkout unavailable right now.';
      return;
    }

    const data = await resp.json();
    tgOpenLink(data.url);
  } catch (err) {
    console.error(err);
    error.value = 'Checkout unavailable right now.';
  } finally {
    actionPending.value = '';
  }
}

	async function openBillingPortal() {
	  actionPending.value = 'portal';
	  try {
	    const resp = await fetch(`${props.apiBase}/billing/portal`, {
	      method: 'POST',
	      headers: { Authorization: `Bearer ${props.token}` }
	    });

	    if (!resp.ok) {
	      const payload = await resp.json().catch(() => ({}));
	      error.value = payload?.error === 'no_customer' ? 'Billing is not available yet.' : 'Unable to open billing portal.';
	      return;
	    }

	    const data = await resp.json();
	    if (!data?.url) {
	      error.value = 'Unable to open billing portal.';
	      return;
	    }

	    tgOpenLink(data.url);
	  } catch (err) {
	    console.error(err);
	    error.value = 'Unable to open billing portal.';
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
  state.loading = true;
  try {
    await loadPlans();
  } catch (err) {
    console.error(err);
    error.value = 'Unexpected error. Try again later.';
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

.comparison {
  grid-column: 1 / -1;
}

.comparison-card {
  border: 1px solid rgba(30, 26, 22, 0.14);
  border-radius: 24px;
  padding: 18px 18px;
  background:
    radial-gradient(120% 180% at 15% 0%, rgba(199, 90, 36, 0.18), transparent 55%),
    radial-gradient(110% 170% at 90% 15%, rgba(31, 107, 99, 0.18), transparent 55%),
    rgba(255, 255, 255, 0.62);
  box-shadow: 0 30px 70px rgba(30, 26, 22, 0.14);
  animation: floatIn 700ms ease-out both;
}

.comparison-kicker {
  text-transform: uppercase;
  letter-spacing: 0.24em;
  font-size: 10px;
  color: var(--muted);
}

.comparison-title {
  margin-top: 10px;
  display: flex;
  align-items: baseline;
  gap: 10px;
  flex-wrap: wrap;
  font-family: var(--font-display);
  font-size: clamp(22px, 3.1vw, 34px);
  letter-spacing: -0.02em;
}

.comparison-pro {
  color: var(--ink);
}

.comparison-eq {
  font-family: var(--font-body);
  font-size: 14px;
  letter-spacing: 0.02em;
  color: var(--muted);
}

.comparison-mult {
  display: inline-flex;
  align-items: center;
  padding: 4px 10px;
  border-radius: 999px;
  background: rgba(199, 90, 36, 0.16);
  border: 1px solid rgba(199, 90, 36, 0.22);
  color: rgba(199, 90, 36, 0.95);
  font-weight: 900;
}

.comparison-plus {
  color: rgba(31, 107, 99, 0.95);
}

.comparison-sub {
  margin: 10px 0 0;
  color: var(--muted);
  line-height: 1.55;
  max-width: 640px;
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
