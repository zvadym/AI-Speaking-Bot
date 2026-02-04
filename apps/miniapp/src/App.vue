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

const apiBase = import.meta.env.VITE_API_BASE || 'http://localhost:3000';

const state = reactive({
  loading: true,
  token: '',
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

async function authenticate() {
  const tg = window.Telegram?.WebApp;
  if (!tg?.initData) {
    error.value = 'Open this page inside Telegram.';
    return;
  }

  tg.ready();
  tg.expand();

  const resp = await fetch(`${apiBase}/auth/telegram`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ initData: tg.initData })
  });

  if (!resp.ok) {
    error.value = 'Authorization failed.';
    return;
  }

  const data = await resp.json();
  state.token = data.token;
}

async function loadPlans() {
  const resp = await fetch(`${apiBase}/plans`, {
    headers: { Authorization: `Bearer ${state.token}` }
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
      const resp = await fetch(`${apiBase}/billing/upgrade`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${state.token}`
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
        if (window.Telegram?.WebApp) {
          window.Telegram.WebApp.openLink(url);
        } else {
          window.location.href = url;
        }
        return;
      }

      await loadPlans();
      return;
    }

    const resp = await fetch(`${apiBase}/billing/checkout`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${state.token}`
      },
      body: JSON.stringify({ tier, currency: state.currency })
    });

    if (!resp.ok) {
      error.value = 'Checkout unavailable right now.';
      return;
    }

    const data = await resp.json();
    if (window.Telegram?.WebApp) {
      window.Telegram.WebApp.openLink(data.url);
    } else {
      window.location.href = data.url;
    }
  } catch (err) {
    console.error(err);
    error.value = 'Checkout unavailable right now.';
  } finally {
    actionPending.value = '';
  }
}

async function cancel() {
  actionPending.value = 'cancel';
  const resp = await fetch(`${apiBase}/billing/cancel`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${state.token}` }
  });

  if (resp.ok) {
    await loadPlans();
  }
  actionPending.value = '';
}

async function resume() {
  actionPending.value = 'resume';
  const resp = await fetch(`${apiBase}/billing/resume`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${state.token}` }
  });

  if (resp.ok) {
    await loadPlans();
  }
  actionPending.value = '';
}

onMounted(async () => {
  state.loading = true;
  try {
    await authenticate();
    if (state.token) {
      await loadPlans();
    }
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
  backdrop-filter: blur(6px);
  display: flex;
  gap: 12px;
  align-items: center;
}

.status-card.error {
  border-color: rgba(208, 107, 47, 0.4);
  background: rgba(208, 107, 47, 0.08);
}

.status-label {
  font-weight: 600;
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.2em;
}

.status-text {
  font-size: 14px;
}

.plans {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 24px;
}

.plan {
  border: 1px solid var(--stroke);
  border-radius: 24px;
  padding: 24px;
  background: rgba(255, 255, 255, 0.7);
  box-shadow: 0 14px 30px -20px var(--shadow);
  display: grid;
  gap: 20px;
  animation: floatIn 800ms ease both;
}

.plan.featured {
  border-color: rgba(46, 111, 107, 0.4);
  box-shadow: 0 20px 40px -20px rgba(46, 111, 107, 0.4);
}

.plan-tier {
  font-size: 13px;
  text-transform: uppercase;
  letter-spacing: 0.2em;
  color: var(--accent-2);
}

.plan-price {
  display: flex;
  align-items: baseline;
  gap: 8px;
  font-family: var(--font-display);
}

.plan-price .amount {
  font-size: 36px;
}

.plan-price .currency {
  font-size: 18px;
}

.plan-price .period {
  font-size: 14px;
  font-family: 'Sora', sans-serif;
  color: var(--muted);
}

.plan-limits {
  display: grid;
  gap: 8px;
  font-size: 14px;
}

.plan-limits .label {
  color: var(--muted);
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.15em;
}

.plan-limits .value {
  font-weight: 600;
}

.cta {
  border: none;
  background: var(--accent);
  color: #fff;
  font-weight: 600;
  padding: 12px 18px;
  border-radius: 14px;
  cursor: pointer;
  transition: transform 150ms ease, box-shadow 150ms ease;
}

.cta:hover {
  transform: translateY(-1px);
  box-shadow: 0 10px 20px -12px rgba(208, 107, 47, 0.8);
}

.cta:disabled {
  opacity: 0.6;
  cursor: not-allowed;
  box-shadow: none;
  transform: none;
}

.manage {
  display: grid;
}

.manage-card {
  border-radius: 20px;
  border: 1px dashed rgba(31, 28, 22, 0.2);
  padding: 20px 24px;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  background: rgba(255, 255, 255, 0.5);
}

.manage-card h2 {
  margin: 0 0 4px;
  font-family: var(--font-display);
}

.manage-card p {
  margin: 0;
  color: var(--muted);
}

.manage-usage {
  display: grid;
  gap: 10px;
  margin-top: 14px;
  font-size: 13px;
}

.usage-item {
  display: grid;
  gap: 8px;
}

.usage-item .label {
  color: var(--muted);
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.12em;
}

.usage-bar {
  display: grid;
  gap: 6px;
}

.usage-track {
  position: relative;
  height: 10px;
  border-radius: 999px;
  background: rgba(31, 28, 22, 0.08);
  overflow: hidden;
}

.usage-fill {
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, rgba(208, 107, 47, 0.95), rgba(208, 107, 47, 0.55));
  box-shadow: 0 6px 12px -8px rgba(208, 107, 47, 0.9);
  transition: width 350ms ease;
}

.usage-fill.accent {
  background: linear-gradient(90deg, rgba(46, 111, 107, 0.95), rgba(46, 111, 107, 0.55));
  box-shadow: 0 6px 12px -8px rgba(46, 111, 107, 0.8);
}

.usage-meta {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  font-size: 12px;
  color: var(--muted);
}

.manage-actions {
  display: flex;
  gap: 12px;
}

.plan-empty {
  border: 1px dashed var(--stroke);
  border-radius: 18px;
  padding: 18px 20px;
  color: var(--muted);
  font-size: 14px;
}

.ghost {
  border: 1px solid var(--stroke);
  background: transparent;
  padding: 10px 16px;
  border-radius: 12px;
  cursor: pointer;
  font-weight: 500;
}

@media (max-width: 720px) {
  .shell {
    padding: 32px 18px 60px;
  }

  .manage-card {
    flex-direction: column;
    align-items: flex-start;
  }
}
</style>
