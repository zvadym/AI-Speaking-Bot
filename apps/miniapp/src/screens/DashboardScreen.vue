<template>
  <div class="dashboard-shell fade-in">
    <GlassCard tone="accent" class="hero-card">
      <div class="hero-copy">
        <h1>{{ greeting }}</h1>
        <p class="hero-sub">{{ heroSubtitle }}</p>
      </div>

      <div class="hero-chip">
        <Sparkles class="hero-chip-icon" />
        <span>{{ statusCopy }}</span>
      </div>

      <div class="setup-card">
        <div class="setup-main">
          <div class="coach-avatar">{{ teacherAvatar }}</div>
          <div>
            <div class="setup-label">{{ $t('dashboard.setupLabel') }}</div>
            <h2>{{ selectedBot.bot_name || languageLabel }}</h2>
            <p class="setup-copy">{{ teacherTagline }}</p>
          </div>
        </div>
        <div class="setup-meta">
          <span>{{ languageLabel }}</span>
          <span>{{ levelLabel }}</span>
        </div>
        <button type="button" class="secondary-link secondary-link--fit" @click="emit('navigate', '/profile')">
          <SlidersHorizontal class="button-icon" />
          <span>{{ $t('dashboard.manageSetup') }}</span>
        </button>
      </div>
    </GlassCard>

    <section class="summary-grid" v-if="!loading">
      <GlassCard :tone="streakTone" class="summary-card">
        <div class="summary-head">
          <div>
            <div class="summary-label">{{ $t('dashboard.currentStreak') }}</div>
            <div class="summary-value">{{ streak.current }}</div>
          </div>
          <Flame class="summary-icon" />
        </div>
        <p class="summary-copy">{{ currentStreakCopy }}</p>
      </GlassCard>

      <GlassCard tone="subtle" class="summary-card">
        <div class="summary-head">
          <div>
            <div class="summary-label">{{ $t('dashboard.planUsage') }}</div>
            <div class="summary-inline">{{ planLabel }}</div>
          </div>
          <WalletCards class="summary-icon" />
        </div>
        <p class="summary-copy">{{ usageCopy }}</p>
        <div class="usage-track">
          <div class="usage-fill" :style="{ width: `${usagePercent}%` }"></div>
        </div>
      </GlassCard>

      <GlassCard tone="subtle" class="summary-card support-card">
        <div class="summary-head">
          <div>
            <div class="summary-label">{{ $t('dashboard.supportLabel') }}</div>
            <h3 class="support-title">{{ $t('dashboard.supportTitle') }}</h3>
          </div>
          <MessageSquareText class="summary-icon" />
        </div>

        <div v-if="feedbackSummary.has_thread" class="support-preview">
          <div class="support-meta">
            <span>{{ lastSenderLabel }}</span>
            <span v-if="feedbackSummary.unread_admin_replies" class="support-badge">
              {{ $t('dashboard.unreadReplies', { count: feedbackSummary.unread_admin_replies }) }}
            </span>
          </div>
          <p>{{ feedbackSummary.last_message_preview }}</p>
        </div>
        <p v-else class="support-empty">{{ $t('dashboard.supportEmpty') }}</p>

        <button type="button" class="secondary-link secondary-link--fit" @click="emit('navigate', '/feedback')">
          <MessageSquareText class="button-icon" />
          <span>{{ feedbackSummary.has_thread ? $t('dashboard.openSupport') : $t('dashboard.startSupport') }}</span>
        </button>
      </GlassCard>
    </section>

    <GlassCard v-if="error" tone="warning" class="notice-card">
      <p>{{ error }}</p>
    </GlassCard>
  </div>
</template>

<script setup>
import { computed, ref, watch } from 'vue';
import {
  Flame,
  MessageSquareText,
  SlidersHorizontal,
  Sparkles,
  WalletCards
} from 'lucide-vue-next';
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
  activity_today: false
});
const feedbackSummary = computed(() => dashboard.value?.feedback_summary || {
  has_thread: false,
  unread_admin_replies: 0,
  last_message_preview: '',
  last_message_sender: null
});
const usage = computed(() => dashboard.value?.usage || null);

const greeting = computed(() => {
  const name = (props.me?.first_name || dashboard.value?.user?.first_name || '').toString().trim();
  return name ? t('dashboard.greetingNamed', { name }) : t('dashboard.greetingAnon');
});

function practiceLanguageLabel(codeRaw) {
  const code = (codeRaw || '').toString().trim().toLowerCase();
  if (!code) return t('common.dash');
  const key = `practiceLanguages.${code}`;
  const translated = t(key);
  return translated !== key ? translated : code.toUpperCase();
}

const languageLabel = computed(() => practiceLanguageLabel(selectedBot.value?.learning_language));
const levelLabel = computed(() => (selectedBot.value?.level || props.me?.level || 'b1').toString().toUpperCase());
const teacherAvatar = computed(() => (selectedBot.value?.teacher_avatar_emoji || 'AI').toString());
const teacherTagline = computed(() =>
  selectedBot.value?.teacher_tagline_en
  || selectedBot.value?.teacher_tagline_it
  || selectedBot.value?.teacher_tagline_uk
  || t('dashboard.teacherFallback')
);

const statusCopy = computed(() => {
  if (streak.value.status === 'active') return t('dashboard.statusActive');
  if (streak.value.status === 'at_risk') return t('dashboard.statusAtRisk');
  return t('dashboard.statusBroken');
});

const heroSubtitle = computed(() => t('dashboard.heroSub', {
  language: languageLabel.value,
  level: levelLabel.value
}));

const streakTone = computed(() => {
  if (streak.value.status === 'active') return 'success';
  if (streak.value.status === 'at_risk') return 'warning';
  return 'subtle';
});

const currentStreakCopy = computed(() => {
  if (streak.value.status === 'active') return t('dashboard.currentStreakActive');
  if (streak.value.status === 'at_risk') return t('dashboard.currentStreakAtRisk');
  return t('dashboard.currentStreakBroken');
});

const planLabel = computed(() => {
  const tier = (usage.value?.tier || dashboard.value?.user?.plan_tier || 'free').toString().toLowerCase();
  return tier === 'pro' ? t('plans.tiers.pro') : t('plans.tiers.free');
});

const usageCopy = computed(() => {
  if (!usage.value) return t('dashboard.usageFallback');
  return t('dashboard.usageCopy', { percent: usagePercent.value });
});

const usagePercent = computed(() => {
  const limit = Number(usage.value?.limit_seconds || 0);
  if (!limit) return 0;
  const used = Number(usage.value?.used_seconds || 0);
  return Math.min(100, Math.max(0, Math.round((used / limit) * 100)));
});

const lastSenderLabel = computed(() => {
  if (feedbackSummary.value.last_message_sender === 'admin') return t('dashboard.supportFromAdmin');
  if (feedbackSummary.value.last_message_sender === 'user') return t('dashboard.supportFromYou');
  return t('dashboard.supportLabel');
});
</script>

<style scoped>
.dashboard-shell {
  width: min(760px, 100%);
  padding: 28px 18px calc(118px + env(safe-area-inset-bottom, 0px));
  display: grid;
  gap: 18px;
}

.summary-grid {
  display: grid;
  gap: 16px;
}

.hero-card,
.summary-card,
.notice-card {
  padding: 20px;
}

.hero-card {
  display: grid;
  gap: 18px;
}

.hero-card h1,
.setup-card h2,
.support-title {
  margin: 0;
  font-family: var(--font-display);
  letter-spacing: -0.03em;
}

.hero-card h1 {
  font-size: clamp(34px, 9vw, 56px);
  line-height: 0.96;
}

.hero-sub,
.setup-copy,
.summary-copy,
.support-empty,
.support-preview p,
.support-title {
  margin: 0;
}

.hero-sub,
.setup-copy,
.summary-copy,
.support-empty,
.support-preview p {
  color: var(--muted);
  line-height: 1.6;
}

.hero-chip {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  width: fit-content;
  max-width: 100%;
  border-radius: 999px;
  padding: 10px 14px;
  background: rgba(255, 255, 255, 0.78);
  color: var(--ink);
  font-weight: 700;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.6);
}

.hero-chip-icon,
.summary-icon {
  width: 20px;
  height: 20px;
  color: var(--accent-strong);
}

.setup-card {
  display: grid;
  gap: 14px;
  padding: 18px;
  border-radius: 22px;
  background: rgba(255, 255, 255, 0.42);
  border: 1px solid rgba(255, 255, 255, 0.52);
}

.setup-main,
.summary-head {
  display: flex;
  justify-content: space-between;
  gap: 16px;
}

.setup-main {
  align-items: flex-start;
}

.setup-label,
.summary-label {
  font-size: 11px;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.16em;
  color: var(--muted-strong);
}

.setup-card h2 {
  margin-top: 6px;
  font-size: clamp(24px, 6vw, 30px);
}

.secondary-link {
  border: 0;
  border-radius: 18px;
  cursor: pointer;
  font-weight: 700;
  transition: transform 180ms ease, box-shadow 180ms ease, background-color 180ms ease;
}

.secondary-link {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  min-height: 52px;
  padding: 0 18px;
}

.secondary-link {
  background: rgba(255, 255, 255, 0.82);
  color: var(--ink);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.56);
}

.secondary-link--fit {
  justify-self: start;
}

.secondary-link:hover {
  transform: translateY(-1px);
}

.button-icon {
  width: 18px;
  height: 18px;
}

.coach-avatar {
  width: 52px;
  height: 52px;
  border-radius: 18px;
  display: grid;
  place-items: center;
  font-size: 26px;
  background: rgba(255, 255, 255, 0.82);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.5);
}

.setup-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.setup-meta span,
.support-badge {
  display: inline-flex;
  align-items: center;
  min-height: 32px;
  padding: 0 12px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.78);
  color: var(--muted-strong);
  font-size: 12px;
  font-weight: 700;
}

.summary-card {
  display: grid;
  gap: 12px;
}

.summary-value {
  font-size: clamp(34px, 8vw, 42px);
  font-weight: 800;
  letter-spacing: -0.05em;
  color: var(--ink);
}

.summary-inline {
  margin-top: 8px;
  font-size: 19px;
  font-weight: 700;
  color: var(--ink);
}

.usage-track {
  height: 10px;
  border-radius: 999px;
  background: rgba(109, 130, 161, 0.15);
  overflow: hidden;
}

.usage-fill {
  height: 100%;
  border-radius: 999px;
  background: linear-gradient(90deg, var(--accent), var(--accent-strong));
}

.support-card {
  display: grid;
  gap: 14px;
}

.support-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 10px;
}

.support-meta span:first-child {
  color: var(--muted-strong);
  font-size: 13px;
  font-weight: 700;
}

.support-title {
  font-size: clamp(22px, 5vw, 28px);
}

.notice-card p {
  margin: 0;
  color: var(--ink);
  font-weight: 600;
}

@media (min-width: 768px) {
  .summary-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .support-card {
    grid-column: 1 / -1;
  }
}
</style>
