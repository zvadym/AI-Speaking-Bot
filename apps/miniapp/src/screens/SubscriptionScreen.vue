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
            {{ currentPlanLabel }} · {{ autoRenewLabel }}
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
            @click="cancel"
            v-if="user.plan_autorenew"
          >
            Turn off auto-renew
          </button>
          <button
            class="ghost"
            :disabled="isBusy"
            @click="resume"
            v-else
          >
            Resume auto-renew
          </button>
          <button class="ghost subtle" @click="$emit('navigate', '/')">
            Back to menu
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
            <span class="period">/ month</span>
          </div>
        </header>

        <div class="plan-limits">
          <div>
            <span class="label">Practice time</span>
            <span class="value">{{ formatSeconds(plan.user_audio_seconds_per_week) }} / week</span>
          </div>
          <div>
            <span class="label">Voice replies</span>
            <span class="value">{{ formatSeconds(plan.tts_seconds_per_week) }} / week</span>
          </div>
        </div>

        <button
          class="cta"
          :disabled="isBusy"
          @click.stop="subscribe(plan.tier)"
        >
          {{ actionPending === plan.tier ? 'Opening Checkout…' : actionLabel(plan.tier) }}
        </button>
      </article>

      <div class="plan-empty" v-if="!visiblePlans.length">
        You're already on the top tier.
      </div>
    </section>
  </div>
</template>

<script setup>
import { onMounted, reactive, computed, ref } from 'vue';
import { tgOpenLink } from '../lib/tg.js';

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

const currentPlanLabel = computed(() => {
  if (!effectiveTier.value) return 'Free';
  return planLabel(effectiveTier.value);
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
      const resp = await fetch(`${props.apiBase}/billing/upgrade`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${props.token}`
        },
        body: JSON.stringify({ tier })
      });

      if (!resp.ok) {
        const payload = await resp.json().catch(() => ({}));
        error.value = payload?.error === 'not_an_upgrade' ? 'You are already on this plan.' : 'Upgrade unavailable right now.';
        return;
      }

      const data = await resp.json();
      const url = data?.invoice?.hosted_invoice_url;
      if (url) {
        tgOpenLink(url);
        return;
      }

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
  padding: 48px 24px 80px;
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

.ghost.subtle {
  opacity: 0.8;
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

.plan-limits {
  display: grid;
  gap: 10px;
}

.plan-limits .label {
  text-transform: uppercase;
  letter-spacing: 0.16em;
  font-size: 10px;
  color: var(--muted);
}

.plan-limits .value {
  display: block;
  margin-top: 3px;
  font-weight: 700;
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
}
</style>

