<template>
  <div class="dashboard-shell fade-in">
    <header class="dash-head">
      <h1 class="app-title">{{ $t('dashboard.title') }}</h1>
      <div class="chip-row" aria-label="Current learning setup">
        <span class="chip">{{ languageLabel }}</span>
        <span class="chip">{{ levelLabel }}</span>
      </div>
      <button
        type="button"
        class="chip chip--tier"
        @click="emit('navigate', '/subscription')"
        :aria-label="$t('dashboard.openSubscription')"
      >
        {{ planLabel }}
      </button>
    </header>

    <GlassCard v-if="!loading" tone="subtle" class="streak-card">
      <div class="streak-head">
        <div class="streak-label">{{ $t('dashboard.currentStreak') }}</div>
        <div class="streak-value">{{ streak.current }}</div>
      </div>

      <div class="calendar" role="group" :aria-label="$t('dashboard.streakCalendar')">
        <div class="calendar-weekdays" aria-hidden="true">
          <span v-for="label in weekdayLabels" :key="label">{{ label }}</span>
        </div>
        <div class="calendar-grid" role="grid">
          <div
            v-for="cell in calendarCells"
            :key="cell.key"
            class="calendar-day"
            :class="{ muted: cell.muted, today: cell.isToday, empty: cell.empty }"
            role="gridcell"
            :aria-label="cell.ariaLabel"
          >
            <span class="day-num">{{ cell.dayNumber }}</span>
            <span v-if="cell.isActive" class="dot" aria-hidden="true" />
          </div>
        </div>
      </div>
    </GlassCard>

    <GlassCard v-if="error" tone="warning" class="notice-card">
      <p>{{ error }}</p>
    </GlassCard>
  </div>
</template>

<script setup>
import { computed, ref, watch } from 'vue';
import GlassCard from '../components/GlassCard.vue';
import { apiJson } from '../lib/api.js';
import { useI18n } from '../i18n.js';

const props = defineProps({
  apiBase: { type: String, required: true },
  token: { type: String, required: true },
  me: { type: Object, default: null },
  bots: { type: Array, default: () => [] },
  botKey: { type: String, default: '' },
  selectBotAndRefresh: { type: Function, required: false, default: null }
});

const emit = defineEmits(['navigate']);
const { t } = useI18n({ useScope: 'global' });

const loading = ref(true);
const error = ref('');
const dashboard = ref(null);

async function loadDashboard() {
  if (!props.token) return;
  loading.value = true;
  error.value = '';
  try {
    dashboard.value = await apiJson(props.apiBase, '/me/dashboard', {
      token: props.token,
      query: props.botKey ? { bot_key: props.botKey } : undefined
    });
  } catch (err) {
    console.error(err);
    error.value = t('dashboard.loadError');
  } finally {
    loading.value = false;
  }
}

watch(
  () => [props.token, props.botKey],
  () => {
    loadDashboard();
  },
  { immediate: true }
);

const selectedBot = computed(() => dashboard.value?.selected_bot || props.me || {});
const streak = computed(() => dashboard.value?.streak || {
  current: 0,
  longest: 0,
  status: 'broken',
  activity_today: false,
  activity_days: []
});
const usage = computed(() => dashboard.value?.usage || null);

function practiceLanguageLabel(codeRaw) {
  const code = (codeRaw || '').toString().trim().toLowerCase();
  if (!code) return t('common.dash');
  const key = `practiceLanguages.${code}`;
  const translated = t(key);
  return translated !== key ? translated : code.toUpperCase();
}

const languageLabel = computed(() => practiceLanguageLabel(selectedBot.value?.learning_language));
const levelLabel = computed(() => (selectedBot.value?.level || props.me?.level || 'b1').toString().toUpperCase());

const planLabel = computed(() => {
  const tier = (usage.value?.tier || dashboard.value?.user?.plan_tier || 'free').toString().toLowerCase();
  return tier === 'pro' ? t('plans.tiers.pro') : t('plans.tiers.free');
});

const DAY_MS = 24 * 60 * 60 * 1000;

function utcDateKey(dateUtc) {
  return dateUtc.toISOString().slice(0, 10);
}

function addDaysUtc(dateUtc, days) {
  return new Date(dateUtc.getTime() + (days * DAY_MS));
}

function todayUtc() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function startOfWeekUtc(dateUtc, weekStartsOn = 1) {
  const weekday = dateUtc.getUTCDay();
  const diff = (weekday - weekStartsOn + 7) % 7;
  return addDaysUtc(dateUtc, -diff);
}

function endOfWeekUtc(dateUtc, weekStartsOn = 1) {
  return addDaysUtc(startOfWeekUtc(dateUtc, weekStartsOn), 6);
}

const weekdayLabels = computed(() => {
  const fmt = new Intl.DateTimeFormat(undefined, { weekday: 'narrow' });
  const monday = new Date(Date.UTC(2024, 0, 1)); // 2024-01-01 is a Monday
  return Array.from({ length: 7 }, (_, idx) => fmt.format(addDaysUtc(monday, idx)));
});

const activityDateKeys = computed(() => {
  const raw = streak.value?.activity_days;
  if (!Array.isArray(raw)) return new Set();
  return new Set(
    raw
      .map((value) => (value ?? '').toString().slice(0, 10))
      .filter(Boolean)
  );
});

const calendarCells = computed(() => {
  const today = todayUtc();
  const rangeStart = addDaysUtc(today, -27);
  const gridStart = startOfWeekUtc(rangeStart, 1);
  const gridEnd = endOfWeekUtc(today, 1);
  const activeSet = activityDateKeys.value;
  const dateFmt = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });

  const cells = [];
  for (let cursor = gridStart; cursor <= gridEnd; cursor = addDaysUtc(cursor, 1)) {
    const key = utcDateKey(cursor);
    const isFuture = cursor.getTime() > today.getTime();
    const inRange = cursor.getTime() >= rangeStart.getTime() && cursor.getTime() <= today.getTime();
    const isActive = inRange && activeSet.has(key);
    const empty = isFuture;

    cells.push({
      key,
      empty,
      muted: !inRange && !isFuture,
      isToday: key === utcDateKey(today),
      isActive,
      dayNumber: empty ? '' : cursor.getUTCDate(),
      ariaLabel: empty ? '' : `${dateFmt.format(cursor)}${isActive ? ', active' : ''}`
    });
  }
  return cells;
});
</script>

<style scoped>
.dashboard-shell {
  width: min(760px, 100%);
  padding: 28px 18px calc(118px + env(safe-area-inset-bottom, 0px));
  display: grid;
  gap: 18px;
}

.dash-head {
  display: grid;
  gap: 12px;
}

.app-title {
  margin: 0;
  font-family: var(--font-display);
  letter-spacing: -0.03em;
  font-size: 24px;
  line-height: 1.1;
}

.chip-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.chip {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 34px;
  padding: 0 12px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.78);
  border: 1px solid rgba(255, 255, 255, 0.68);
  color: var(--ink);
  font-size: 13px;
  font-weight: 800;
}

.chip--tier {
  justify-self: start;
  cursor: pointer;
  transition: transform 160ms ease, background-color 160ms ease, border-color 160ms ease;
}

.chip--tier:hover,
.chip--tier:focus-visible {
  transform: translateY(-1px);
  background: rgba(255, 255, 255, 0.86);
  border-color: rgba(122, 154, 196, 0.34);
}

.streak-card,
.notice-card {
  padding: 20px;
}

.streak-card {
  display: grid;
  gap: 14px;
}

.streak-head {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: baseline;
}

.streak-label {
  font-size: 11px;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.16em;
  color: var(--muted-strong);
}

.streak-value {
  font-size: 40px;
  font-weight: 900;
  letter-spacing: -0.05em;
  color: var(--ink);
  font-variant-numeric: tabular-nums;
}

.calendar {
  display: grid;
  gap: 8px;
}

.calendar-weekdays {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 8px;
  color: var(--muted-strong);
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

.calendar-weekdays span {
  text-align: center;
}

.calendar-grid {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 8px;
}

.calendar-day {
  position: relative;
  height: 42px;
  background: rgba(255, 255, 255, 0.78);
  border: 1px solid rgba(255, 255, 255, 0.68);
  border-radius: 14px;
  display: grid;
  place-items: center;
  color: var(--ink);
  font-weight: 800;
  font-variant-numeric: tabular-nums;
}

.calendar-day.muted {
  opacity: 0.55;
}

.calendar-day.empty {
  background: transparent;
  border-color: transparent;
}

.calendar-day.today {
  border-color: rgba(63, 129, 216, 0.5);
  box-shadow: 0 10px 28px rgba(63, 129, 216, 0.14);
}

.day-num {
  font-size: 13px;
}

.dot {
  position: absolute;
  bottom: 8px;
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: var(--accent-strong);
}

.notice-card p {
  margin: 0;
  color: var(--ink);
  font-weight: 600;
}
</style>
