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
        <div class="value value-pair">
          {{ fmt(totals.active_users_in_range) }}
          <span class="value-secondary">/ {{ fmt(totals.total_users_in_range) }}</span>
        </div>
        <div class="meta">All-time: {{ fmt(totals.active_users_all_time) }} / {{ fmt(totals.total_users_all_time) }}</div>
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

    <section class="card broadcast">
      <div class="broadcast-head">
        <div>
          <div class="kicker">Broadcast</div>
          <h2>Send message to filtered users</h2>
          <p class="sub compact">Preview count updates from filters before sending.</p>
        </div>
        <div class="broadcast-counter">
          <div class="counter-label">Will send to</div>
          <div class="counter-value">{{ fmt(broadcastPreview.count) }}</div>
          <div class="counter-meta" v-if="previewLoading">Updating…</div>
          <div class="counter-meta" v-else-if="previewError">Preview error</div>
          <div class="counter-meta" v-else-if="previewUpdatedAt">Updated: {{ previewUpdatedAt }}</div>
        </div>
      </div>

      <div class="row">
        <label class="field grow">
          <span>Username contains</span>
          <input
            v-model.trim="broadcast.username"
            type="text"
            autocomplete="off"
            inputmode="text"
            placeholder="(optional)"
          />
        </label>

        <label class="field">
          <span>Last activity</span>
          <select v-model="broadcast.lastActivityMode">
            <option value="any">Any</option>
            <option value="active_within">Active within X days</option>
            <option value="inactive_for">Inactive for X+ days</option>
            <option value="never_active">Never active</option>
          </select>
        </label>

        <label class="field" v-if="broadcast.lastActivityMode !== 'any' && broadcast.lastActivityMode !== 'never_active'">
          <span>X days</span>
          <input v-model.number="broadcast.lastActivityDays" type="number" min="1" max="3650" />
        </label>
      </div>

      <div class="row">
        <label class="field">
          <span>Usage filter</span>
          <select v-model="broadcast.usageMode">
            <option value="any">Any</option>
            <option value="reached">Limit reached</option>
            <option value="percent_gte">Usage >= X%</option>
          </select>
        </label>

        <label class="field" v-if="broadcast.usageMode === 'percent_gte'">
          <span>X percent</span>
          <input v-model.number="broadcast.usagePercent" type="number" min="0" max="100" />
        </label>

        <div class="field grow">
          <span>Current plan</span>
          <div class="plan-pills">
            <label class="pill">
              <input v-model="broadcast.planFree" type="checkbox" />
              <span>Free</span>
            </label>
            <label class="pill">
              <input v-model="broadcast.planPlus" type="checkbox" />
              <span>Plus</span>
            </label>
            <label class="pill">
              <input v-model="broadcast.planPro" type="checkbox" />
              <span>Pro</span>
            </label>
          </div>
        </div>
      </div>

      <div class="row">
        <label class="field grow">
          <span>Message text</span>
          <textarea
            v-model="broadcast.messageText"
            rows="5"
            maxlength="4096"
            placeholder="Write the message that will be sent to each selected user..."
          />
        </label>
      </div>

      <div class="row">
        <label class="field">
          <span>Confirm send</span>
          <input
            v-model.trim="broadcastConfirm"
            type="text"
            autocomplete="off"
            inputmode="text"
            placeholder="Type SEND"
          />
        </label>

        <div class="actions">
          <button class="btn" type="button" :disabled="!password || previewLoading" @click="refreshBroadcastPreview()">
            {{ previewLoading ? 'Preview…' : 'Refresh preview' }}
          </button>
          <button class="btn primary" type="button" :disabled="!canSendBroadcast || sendingBroadcast" @click="sendBroadcast">
            {{ sendingBroadcast ? 'Sending…' : `Send to ${fmt(broadcastPreview.count)}` }}
          </button>
        </div>
      </div>

      <p class="hint" v-if="!password">Enter admin password above to use broadcast.</p>
      <p class="hint" v-else-if="!hasAnySelectedPlan">Pick at least one plan.</p>
      <p class="error" v-else-if="previewError">{{ previewError }}</p>
      <p class="error" v-else-if="sendError">{{ sendError }}</p>
      <p class="hint" v-else-if="sendInfo">{{ sendInfo }}</p>

      <div class="preview-sample" v-if="broadcastPreview.sample.length">
        <div class="sample-title">Sample recipients</div>
        <ul>
          <li v-for="row in broadcastPreview.sample.slice(0, 8)" :key="row.chat_id">
            <code>{{ row.chat_id }}</code>
            <span>{{ row.username ? `@${row.username}` : '(no username)' }}</span>
            <span>{{ row.effective_tier }}</span>
            <span>{{ formatLastActivity(row.last_activity_at) }}</span>
          </li>
        </ul>
      </div>

      <div class="campaign-state" v-if="campaignState">
        <div class="campaign-head">
          <strong>Campaign #{{ campaignState.id }}</strong>
          <span class="chip">{{ campaignState.status }}</span>
        </div>
        <div class="campaign-stats">
          <span>Total: {{ fmt(campaignState.total_recipients) }}</span>
          <span>Sent: {{ fmt(campaignState.sent_count) }}</span>
          <span>Failed: {{ fmt(campaignState.failed_count) }}</span>
          <span>Pending: {{ fmt(campaignState.pending_count) }}</span>
        </div>
        <p class="error" v-if="campaignState.error_text">{{ campaignState.error_text }}</p>
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
      title="Inactive users by day"
      subtitle="Users marked inactive from permanent Telegram delivery failures"
      kind="bar"
      :data="inactiveUsersSeries"
      :series="[{ key: 'count', label: 'Inactive users', color: 'rgba(174, 43, 40, 0.86)' }]"
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
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
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
const previewUpdatedAt = ref('');

const totals = ref({
  total_users_all_time: 0,
  active_users_all_time: 0,
  plus_users_all_time: 0,
  pro_users_all_time: 0,
  total_users_in_range: 0,
  active_users_in_range: 0,
  plus_users_in_range: 0,
  pro_users_in_range: 0
});

const newUsersSeries = ref([]);
const newPaidSeries = ref([]);
const activeUsersSeries = ref([]);
const inactiveUsersSeries = ref([]);
const usageSecondsSeries = ref([]);
const previewLoading = ref(false);
const previewError = ref('');
const sendError = ref('');
const sendInfo = ref('');
const sendingBroadcast = ref(false);
const broadcastConfirm = ref('');
const campaignState = ref(null);
const broadcastPreview = reactive({
  count: 0,
  sample: []
});
const broadcast = reactive({
  username: '',
  planFree: true,
  planPlus: true,
  planPro: true,
  lastActivityMode: 'any',
  lastActivityDays: 14,
  usageMode: 'any',
  usagePercent: 80,
  messageText: ''
});

let previewTimer = null;
let campaignPollTimer = null;

const canFetch = computed(() => {
  if (!password.value) return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fromDate.value)) return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(toDate.value)) return false;
  return fromDate.value < toDate.value;
});

function adminHeaders() {
  return { 'X-Admin-Password': password.value };
}

function clampInt(value, min, max, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  const int = Math.trunc(num);
  if (int < min) return min;
  if (int > max) return max;
  return int;
}

function clampNumber(value, min, max, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  if (num < min) return min;
  if (num > max) return max;
  return num;
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

function formatLastActivity(raw) {
  if (!raw) return 'never active';
  const d = new Date(raw);
  if (!Number.isFinite(d.getTime())) return 'unknown';
  const now = Date.now();
  const days = Math.floor((now - d.getTime()) / DAY_MS);
  if (days <= 0) return 'today';
  if (days === 1) return '1 day ago';
  return `${days} days ago`;
}

const selectedPlans = computed(() => {
  const plans = [];
  if (broadcast.planFree) plans.push('free');
  if (broadcast.planPlus) plans.push('plus');
  if (broadcast.planPro) plans.push('pro');
  return plans;
});

const hasAnySelectedPlan = computed(() => selectedPlans.value.length > 0);

function broadcastFiltersPayload() {
  const filters = {};
  if (broadcast.username.trim()) filters.username = broadcast.username.trim();

  if (selectedPlans.value.length > 0 && selectedPlans.value.length < 3) {
    filters.plans = selectedPlans.value;
  }

  if (broadcast.lastActivityMode !== 'any') {
    filters.lastActivityMode = broadcast.lastActivityMode;
    if (broadcast.lastActivityMode !== 'never_active') {
      filters.lastActivityDays = clampInt(broadcast.lastActivityDays, 1, 3650, 14);
    }
  }

  if (broadcast.usageMode !== 'any') {
    filters.usageMode = broadcast.usageMode;
    if (broadcast.usageMode === 'percent_gte') {
      filters.usagePercent = clampNumber(broadcast.usagePercent, 0, 100, 80);
    }
  }

  return filters;
}

const canSendBroadcast = computed(() => {
  const message = broadcast.messageText.trim();
  if (!password.value) return false;
  if (!hasAnySelectedPlan.value) return false;
  if (!message) return false;
  if (message.length > 4096) return false;
  if (broadcastPreview.count <= 0) return false;
  if (broadcastConfirm.value.toUpperCase() !== 'SEND') return false;
  return true;
});

function stopCampaignPolling() {
  if (!campaignPollTimer) return;
  window.clearInterval(campaignPollTimer);
  campaignPollTimer = null;
}

async function loadCampaignStatus(campaignId) {
  if (!password.value) return;
  const headers = adminHeaders();
  const data = await apiJson(props.apiBase, `/admin/broadcasts/${campaignId}`, { headers });
  campaignState.value = data?.campaign || null;
  const status = campaignState.value?.status || '';
  if (status === 'completed' || status === 'failed') {
    stopCampaignPolling();
  }
}

function startCampaignPolling(campaignId) {
  stopCampaignPolling();
  campaignPollTimer = window.setInterval(() => {
    loadCampaignStatus(campaignId).catch((err) => {
      console.error(err);
      stopCampaignPolling();
    });
  }, 2000);
}

async function refreshBroadcastPreview({ silent = false } = {}) {
  if (!password.value) return;
  if (!hasAnySelectedPlan.value) {
    broadcastPreview.count = 0;
    broadcastPreview.sample = [];
    previewError.value = '';
    return;
  }

  previewLoading.value = true;
  if (!silent) previewError.value = '';
  try {
    const headers = adminHeaders();
    const body = { filters: broadcastFiltersPayload() };
    const data = await apiJson(props.apiBase, '/admin/broadcasts/preview', {
      method: 'POST',
      headers,
      body
    });
    const nextCount = Number(data?.count || 0);
    broadcastPreview.count = Number.isFinite(nextCount) ? nextCount : 0;
    broadcastPreview.sample = Array.isArray(data?.sample) ? data.sample : [];
    previewUpdatedAt.value = isoStampNow();
    previewError.value = '';
  } catch (err) {
    console.error(err);
    broadcastPreview.count = 0;
    broadcastPreview.sample = [];
    previewUpdatedAt.value = '';
    const msg = err?.payload?.error || err?.message || 'request_failed';
    previewError.value = `Preview failed: ${msg}`;
  } finally {
    previewLoading.value = false;
  }
}

function scheduleBroadcastPreview() {
  if (previewTimer) {
    window.clearTimeout(previewTimer);
    previewTimer = null;
  }
  if (!password.value) return;
  previewTimer = window.setTimeout(() => {
    refreshBroadcastPreview({ silent: true });
    previewTimer = null;
  }, 320);
}

async function sendBroadcast() {
  if (!canSendBroadcast.value) return;

  sendingBroadcast.value = true;
  sendError.value = '';
  sendInfo.value = '';

  try {
    const headers = adminHeaders();
    const payloadBody = {
      filters: broadcastFiltersPayload(),
      messageText: broadcast.messageText.trim()
    };
    const data = await apiJson(props.apiBase, '/admin/broadcasts/send', {
      method: 'POST',
      headers,
      body: payloadBody
    });

    const campaignId = Number(data?.campaign_id || 0);
    if (!Number.isFinite(campaignId) || campaignId <= 0) {
      throw new Error('bad_campaign_id');
    }

    sendInfo.value = `Queued campaign #${campaignId} for ${fmt(data?.total_recipients || 0)} users.`;
    broadcastConfirm.value = '';
    await loadCampaignStatus(campaignId);
    startCampaignPolling(campaignId);
  } catch (err) {
    console.error(err);
    const msg = err?.payload?.error || err?.message || 'request_failed';
    sendError.value = `Send failed: ${msg}`;
  } finally {
    sendingBroadcast.value = false;
  }
}

async function refresh() {
  if (!canFetch.value) return;
  loading.value = true;
  errorText.value = '';
  try {
    const q = query();
    const headers = adminHeaders();
    const [summary, newUsers, newPaid, activeUsers, inactiveUsers, usageSeconds, payloads] = await Promise.all([
      apiJson(props.apiBase, '/admin/metrics/summary', { query: q, headers }),
      apiJson(props.apiBase, '/admin/metrics/new-users-by-day', { query: q, headers }),
      apiJson(props.apiBase, '/admin/metrics/new-paid-by-day', { query: q, headers }),
      apiJson(props.apiBase, '/admin/metrics/active-users-by-day', { query: q, headers }),
      apiJson(props.apiBase, '/admin/metrics/inactive-users-by-day', { query: q, headers }),
      apiJson(props.apiBase, '/admin/metrics/usage-seconds-by-day', { query: q, headers }),
      apiJson(props.apiBase, '/admin/metrics/acquisition-payloads', { query: q, headers })
    ]);

    totals.value = summary?.totals || totals.value;
    newUsersSeries.value = Array.isArray(newUsers?.series) ? newUsers.series : [];
    newPaidSeries.value = Array.isArray(newPaid?.series) ? newPaid.series : [];
    activeUsersSeries.value = Array.isArray(activeUsers?.series) ? activeUsers.series : [];
    inactiveUsersSeries.value = Array.isArray(inactiveUsers?.series) ? inactiveUsers.series : [];
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
  previewError.value = '';
  sendError.value = '';
  sendInfo.value = '';
  broadcastPreview.count = 0;
  broadcastPreview.sample = [];
  previewUpdatedAt.value = '';
  campaignState.value = null;
  stopCampaignPolling();
}

onMounted(() => {
  // No auto-fetch until password is provided.
});

watch(
  () => [
    password.value,
    broadcast.username,
    broadcast.planFree,
    broadcast.planPlus,
    broadcast.planPro,
    broadcast.lastActivityMode,
    broadcast.lastActivityDays,
    broadcast.usageMode,
    broadcast.usagePercent
  ],
  () => {
    if (!password.value) {
      previewError.value = '';
      broadcastPreview.count = 0;
      broadcastPreview.sample = [];
      previewUpdatedAt.value = '';
      return;
    }
    scheduleBroadcastPreview();
  }
);

onBeforeUnmount(() => {
  if (previewTimer) {
    window.clearTimeout(previewTimer);
    previewTimer = null;
  }
  stopCampaignPolling();
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

.field input[type='text'],
.field input[type='password'],
.field input[type='date'],
.field input[type='number'],
.field select,
.field textarea {
  border-radius: 14px;
  border: 1px solid rgba(30, 26, 22, 0.16);
  background: rgba(246, 241, 232, 0.6);
  padding: 0 12px;
  font: inherit;
  color: var(--ink);
  outline: none;
}

.field input[type='text'],
.field input[type='password'],
.field input[type='date'],
.field input[type='number'],
.field select {
  height: 42px;
}

.field textarea {
  min-height: 120px;
  padding: 10px 12px;
  resize: vertical;
}

.field select {
  appearance: none;
}

.field input[type='text']:focus,
.field input[type='password']:focus,
.field input[type='date']:focus,
.field input[type='number']:focus,
.field select:focus,
.field textarea:focus {
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

.broadcast {
  display: grid;
  gap: 14px;
}

.broadcast h2 {
  margin: 0;
  font-size: 22px;
  line-height: 1.2;
}

.broadcast-head {
  display: flex;
  justify-content: space-between;
  gap: 14px;
  align-items: start;
}

.compact {
  margin-top: 6px;
}

.broadcast-counter {
  min-width: 180px;
  border: 1px solid rgba(31, 107, 99, 0.2);
  background: rgba(31, 107, 99, 0.08);
  border-radius: 16px;
  padding: 10px 12px;
  display: grid;
  gap: 4px;
}

.counter-label {
  font-size: 12px;
  color: var(--muted);
}

.counter-value {
  font-family: var(--font-display);
  font-size: 32px;
  line-height: 1;
}

.counter-meta {
  font-size: 11px;
  color: var(--muted);
}

.plan-pills {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  min-height: 42px;
  align-items: center;
}

.pill {
  border: 1px solid rgba(30, 26, 22, 0.14);
  border-radius: 999px;
  padding: 6px 10px;
  background: rgba(255, 255, 255, 0.62);
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
}

.pill input {
  height: 14px;
  width: 14px;
  margin: 0;
}

.preview-sample {
  border-top: 1px solid rgba(30, 26, 22, 0.1);
  padding-top: 10px;
  display: grid;
  gap: 6px;
}

.sample-title {
  font-size: 12px;
  color: var(--muted);
}

.preview-sample ul {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 4px;
}

.preview-sample li {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  font-size: 12px;
}

.campaign-state {
  border-top: 1px solid rgba(30, 26, 22, 0.1);
  padding-top: 10px;
  display: grid;
  gap: 6px;
}

.campaign-head {
  display: flex;
  align-items: center;
  gap: 8px;
}

.chip {
  border-radius: 999px;
  border: 1px solid rgba(30, 26, 22, 0.14);
  padding: 2px 8px;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  background: rgba(246, 241, 232, 0.55);
}

.campaign-stats {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  font-size: 12px;
  color: var(--muted);
}

@media (max-width: 820px) {
  .cards {
    grid-template-columns: 1fr;
  }

  .broadcast-head {
    flex-direction: column;
  }

  .broadcast-counter {
    width: 100%;
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

.value-pair {
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.value-secondary {
  font-size: 19px;
  color: var(--muted);
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
