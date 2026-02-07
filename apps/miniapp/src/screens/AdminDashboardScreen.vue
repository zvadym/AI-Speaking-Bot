<template>
  <div class="shell fade-in">
    <header class="hero">
      <div class="kicker">Internal</div>
      <h1>Admin dashboard</h1>
      <p class="sub">UTC charts. Date range is <strong>[from, to)</strong> (to is exclusive).</p>
    </header>

    <section class="card">
      <div class="row">
        <label class="field">
          <span>Password</span>
          <input v-model="password" type="password" autocomplete="current-password" placeholder="••••••••" />
        </label>

        <label class="field">
          <span>From (UTC)</span>
          <input v-model="fromDate" type="date" />
        </label>

        <label class="field">
          <span>To (UTC, exclusive)</span>
          <input v-model="toDate" type="date" />
        </label>
      </div>

      <div class="row">
        <label class="field grow">
          <span>Acquisition payload</span>
          <input
            v-model="payload"
            type="text"
            inputmode="text"
            autocomplete="off"
            placeholder="(optional)"
            list="payloads"
          />
          <datalist id="payloads">
            <option v-for="p in payloadOptions" :key="p.payload" :value="p.payload" />
          </datalist>
        </label>

        <div class="actions">
          <button class="btn primary" type="button" :disabled="!canFetch || loading" @click="refresh">
            {{ loading ? 'Loading…' : 'Refresh' }}
          </button>
          <button class="btn" type="button" :disabled="loading" @click="resetRange">Last 30d</button>
          <button class="btn danger" type="button" :disabled="loading" @click="clearPassword">Clear</button>
        </div>
      </div>

      <p class="hint" v-if="!password">
        Enter password to load metrics (sent to the API as <code>X-Admin-Password</code>).
      </p>
      <p class="error" v-else-if="errorText">{{ errorText }}</p>
    </section>

    <section class="cards">
      <div class="stat">
        <div class="label">Users (range)</div>
        <div class="value">{{ fmt(totals.total_users_in_range) }}</div>
        <div class="meta">All-time: {{ fmt(totals.total_users_all_time) }}</div>
      </div>
      <div class="stat">
        <div class="label">Plus (range)</div>
        <div class="value">{{ fmt(totals.plus_users_in_range) }}</div>
        <div class="meta">All-time: {{ fmt(totals.plus_users_all_time) }}</div>
      </div>
      <div class="stat">
        <div class="label">Pro (range)</div>
        <div class="value">{{ fmt(totals.pro_users_in_range) }}</div>
        <div class="meta">All-time: {{ fmt(totals.pro_users_all_time) }}</div>
      </div>
    </section>

    <AdminChart
      title="New users by day"
      kind="bar"
      :data="newUsersSeries"
      :series="[{ key: 'count', label: 'New users', color: 'rgba(199, 90, 36, 0.86)' }]"
    />

    <AdminChart
      title="New paid users by day (first time)"
      subtitle="Split by tier at first payment"
      kind="bar"
      :data="newPaidSeries"
      :series="[
        { key: 'plus', label: 'Plus', color: 'rgba(31, 107, 99, 0.88)' },
        { key: 'pro', label: 'Pro', color: 'rgba(199, 90, 36, 0.88)' }
      ]"
    />

    <AdminChart
      title="Active users by day"
      subtitle="Active = at least one voice usage event that day"
      kind="bar"
      :data="activeUsersSeries"
      :series="[{ key: 'count', label: 'Active users', color: 'rgba(31, 107, 99, 0.86)' }]"
    />

    <AdminChart
      title="Voice usage seconds by day"
      kind="line"
      :data="usageSecondsSeries"
      :series="[
        { key: 'in_seconds', label: 'In', color: 'rgba(31, 107, 99, 0.9)' },
        { key: 'out_seconds', label: 'Out', color: 'rgba(199, 90, 36, 0.9)' }
      ]"
    />

    <footer class="foot">
      <button class="link" type="button" @click="emit('navigate', '/', { replace: true })">← Back to app</button>
      <span v-if="lastUpdated" class="stamp">Updated: {{ lastUpdated }}</span>
    </footer>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue';
import { apiJson } from '../lib/api.js';
import AdminChart from '../components/AdminChart.vue';

const props = defineProps({
  apiBase: { type: String, required: true }
});

const emit = defineEmits(['navigate']);

const DAY_MS = 24 * 60 * 60 * 1000;

function dateToYmdUtc(d) {
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function defaultRange() {
  const now = new Date();
  const todayUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const to = new Date(todayUtc.getTime() + DAY_MS);
  const from = new Date(to.getTime() - 30 * DAY_MS);
  return { from: dateToYmdUtc(from), to: dateToYmdUtc(to) };
}

const password = ref('');
const { from: defaultFrom, to: defaultTo } = defaultRange();
const fromDate = ref(defaultFrom);
const toDate = ref(defaultTo);
const payload = ref('');
const payloadOptions = ref([]);

const loading = ref(false);
const errorText = ref('');
const lastUpdated = ref('');

const totals = ref({
  total_users_all_time: 0,
  plus_users_all_time: 0,
  pro_users_all_time: 0,
  total_users_in_range: 0,
  plus_users_in_range: 0,
  pro_users_in_range: 0
});

const newUsersSeries = ref([]);
const newPaidSeries = ref([]);
const activeUsersSeries = ref([]);
const usageSecondsSeries = ref([]);

const canFetch = computed(() => {
  if (!password.value) return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fromDate.value)) return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(toDate.value)) return false;
  return fromDate.value < toDate.value;
});

function adminHeaders() {
  return { 'X-Admin-Password': password.value };
}

function query() {
  return {
    from: fromDate.value,
    to: toDate.value,
    payload: payload.value.trim() ? payload.value.trim() : undefined
  };
}

function fmt(v) {
  const n = Number(v || 0);
  if (!Number.isFinite(n)) return '0';
  return new Intl.NumberFormat('en-US').format(Math.round(n));
}

function isoStampNow() {
  const d = new Date();
  return d.toISOString().replace('T', ' ').replace('Z', 'Z');
}

async function refresh() {
  if (!canFetch.value) return;
  loading.value = true;
  errorText.value = '';
  try {
    const q = query();
    const headers = adminHeaders();
    const [summary, newUsers, newPaid, activeUsers, usageSeconds, payloads] = await Promise.all([
      apiJson(props.apiBase, '/admin/metrics/summary', { query: q, headers }),
      apiJson(props.apiBase, '/admin/metrics/new-users-by-day', { query: q, headers }),
      apiJson(props.apiBase, '/admin/metrics/new-paid-by-day', { query: q, headers }),
      apiJson(props.apiBase, '/admin/metrics/active-users-by-day', { query: q, headers }),
      apiJson(props.apiBase, '/admin/metrics/usage-seconds-by-day', { query: q, headers }),
      apiJson(props.apiBase, '/admin/metrics/acquisition-payloads', { query: q, headers })
    ]);

    totals.value = summary?.totals || totals.value;
    newUsersSeries.value = Array.isArray(newUsers?.series) ? newUsers.series : [];
    newPaidSeries.value = Array.isArray(newPaid?.series) ? newPaid.series : [];
    activeUsersSeries.value = Array.isArray(activeUsers?.series) ? activeUsers.series : [];
    usageSecondsSeries.value = Array.isArray(usageSeconds?.series) ? usageSeconds.series : [];
    payloadOptions.value = Array.isArray(payloads?.payloads) ? payloads.payloads : [];
    lastUpdated.value = isoStampNow();
  } catch (err) {
    console.error(err);
    const msg = err?.payload?.error || err?.message || 'request_failed';
    errorText.value = `Failed to load: ${msg}`;
  } finally {
    loading.value = false;
  }
}

function resetRange() {
  const r = defaultRange();
  fromDate.value = r.from;
  toDate.value = r.to;
}

function clearPassword() {
  password.value = '';
  errorText.value = '';
}

onMounted(() => {
  // No auto-fetch until password is provided.
});
</script>

<style scoped>
.shell {
  width: min(980px, 100%);
  padding: 44px 22px 76px;
  display: grid;
  gap: 18px;
}

.hero {
  display: grid;
  gap: 10px;
}

.kicker {
  text-transform: uppercase;
  letter-spacing: 0.26em;
  font-size: 11px;
  color: var(--accent-2);
}

h1 {
  font-family: var(--font-display);
  margin: 0;
  font-size: clamp(30px, 5vw, 52px);
  letter-spacing: -0.02em;
  line-height: 1;
}

.sub {
  margin: 0;
  max-width: 70ch;
  color: var(--muted);
  font-size: 15px;
  line-height: 1.6;
}

.card {
  border: 1px solid var(--stroke);
  border-radius: 20px;
  background: rgba(255, 255, 255, 0.55);
  box-shadow: 0 18px 40px var(--shadow);
  padding: 14px;
  display: grid;
  gap: 12px;
}

.row {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: end;
}

.field {
  display: grid;
  gap: 6px;
  min-width: 210px;
}

.field span {
  font-size: 12px;
  color: var(--muted);
}

.field input {
  height: 42px;
  border-radius: 14px;
  border: 1px solid rgba(30, 26, 22, 0.16);
  background: rgba(246, 241, 232, 0.6);
  padding: 0 12px;
  font: inherit;
  color: var(--ink);
  outline: none;
}

.field input:focus {
  border-color: rgba(31, 107, 99, 0.55);
  box-shadow: 0 0 0 4px rgba(31, 107, 99, 0.15);
}

.grow {
  flex: 1;
  min-width: 280px;
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.btn {
  border: 1px solid var(--stroke);
  background: rgba(255, 255, 255, 0.62);
  border-radius: 999px;
  padding: 10px 14px;
  cursor: pointer;
  font-weight: 650;
  letter-spacing: 0.01em;
  box-shadow: 0 12px 26px rgba(30, 26, 22, 0.14);
  transition: transform 120ms ease, box-shadow 120ms ease;
}

.btn:active {
  transform: translateY(1px);
  box-shadow: 0 9px 18px rgba(30, 26, 22, 0.12);
}

.btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
  transform: none;
}

.primary {
  background: rgba(199, 90, 36, 0.16);
  border-color: rgba(199, 90, 36, 0.28);
}

.danger {
  background: rgba(174, 43, 40, 0.12);
  border-color: rgba(174, 43, 40, 0.22);
}

.hint {
  margin: 0;
  color: var(--muted);
  font-size: 13px;
}

.hint code {
  font-size: 12px;
}

.error {
  margin: 0;
  color: rgba(174, 43, 40, 0.9);
  font-size: 13px;
}

.cards {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}

@media (max-width: 820px) {
  .cards {
    grid-template-columns: 1fr;
  }
}

.stat {
  border: 1px solid var(--stroke);
  border-radius: 20px;
  background: rgba(255, 255, 255, 0.55);
  box-shadow: 0 18px 40px var(--shadow);
  padding: 14px 14px 12px;
  display: grid;
  gap: 6px;
}

.label {
  color: var(--muted);
  font-size: 12px;
}

.value {
  font-family: var(--font-display);
  font-size: 34px;
  line-height: 1;
  letter-spacing: -0.02em;
}

.meta {
  color: var(--muted);
  font-size: 12px;
}

.foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  color: var(--muted);
  font-size: 12px;
  margin-top: 8px;
}

.link {
  border: none;
  background: transparent;
  padding: 0;
  font: inherit;
  cursor: pointer;
  color: var(--accent-2);
  font-weight: 650;
}

.stamp {
  opacity: 0.9;
}
</style>

