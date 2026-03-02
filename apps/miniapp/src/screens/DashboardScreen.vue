<template>
  <div class="dashboard-shell fade-in">
    <section class="hero-grid">
      <GlassCard tone="accent" class="hero-card">
        <div class="hero-copy">
          <div class="eyebrow">{{ $t('dashboard.eyebrow') }}</div>
          <h1>{{ greeting }}</h1>
          <p class="hero-sub">{{ heroSubtitle }}</p>
        </div>

        <div class="hero-actions">
          <div class="hero-chip">
            <Languages class="hero-chip-icon" />
            <span>{{ selectedBot.bot_name || languageLabel }}</span>
          </div>

          <button
            type="button"
            class="secondary-link secondary-link--fit"
            @click="openTeachersUrl"
          >
            <Globe class="button-icon" />
            <span>{{ $t('dashboard.otherLanguages') }}</span>
          </button>

          <div class="hero-chip">
            <Sparkles class="hero-chip-icon" />
            <span>{{ statusCopy }}</span>
          </div>

          <button
            v-if="selectedBot.telegram_url"
            type="button"
            class="primary-cta"
            @click="openTelegram"
          >
            <Send class="button-icon" />
            <span>{{ $t('dashboard.openChat') }}</span>
          </button>
        </div>
      </GlassCard>

      <GlassCard tone="subtle" class="coach-card">
        <div class="coach-head">
          <div class="coach-avatar">{{ teacherAvatar }}</div>
          <div>
            <div class="coach-overline">{{ $t('dashboard.coachLabel') }}</div>
            <h2>{{ selectedBot.bot_name || languageLabel }}</h2>
          </div>
        </div>
        <p class="coach-copy">{{ teacherTagline }}</p>
        <div class="coach-meta">
          <span>{{ languageLabel }}</span>
          <span>{{ levelLabel }}</span>
        </div>
      </GlassCard>
    </section>

    <section class="stats-grid" v-if="!loading">
      <GlassCard :tone="streakTone" class="stat-card">
        <div class="stat-head">
          <div>
            <div class="stat-label">{{ $t('dashboard.currentStreak') }}</div>
            <div class="stat-value">{{ streak.current }}</div>
          </div>
          <Flame class="stat-icon" />
        </div>
        <p class="stat-copy">{{ currentStreakCopy }}</p>
      </GlassCard>

      <GlassCard tone="subtle" class="stat-card">
        <div class="stat-head">
          <div>
            <div class="stat-label">{{ $t('dashboard.longestStreak') }}</div>
            <div class="stat-value">{{ streak.longest }}</div>
          </div>
          <Trophy class="stat-icon" />
        </div>
        <p class="stat-copy">{{ longestStreakCopy }}</p>
      </GlassCard>

      <GlassCard tone="subtle" class="stat-card usage-card">
        <div class="stat-head">
          <div>
            <div class="stat-label">{{ $t('dashboard.planUsage') }}</div>
            <div class="stat-inline">{{ planLabel }}</div>
          </div>
          <WalletCards class="stat-icon" />
        </div>
        <p class="usage-copy">{{ usageCopy }}</p>
        <div class="usage-track">
          <div class="usage-fill" :style="{ width: `${usagePercent}%` }"></div>
        </div>
      </GlassCard>

      <GlassCard tone="subtle" class="stat-card">
        <div class="stat-head">
          <div>
            <div class="stat-label">{{ $t('dashboard.learningProfile') }}</div>
            <div class="stat-inline">{{ languageLabel }}</div>
          </div>
          <GraduationCap class="stat-icon" />
        </div>
        <p class="stat-copy">{{ $t('dashboard.profileSummary', { level: levelLabel }) }}</p>
      </GlassCard>
    </section>

    <section class="dashboard-grid">
      <GlassCard v-if="showFocusPanel" :tone="streak.status === 'at_risk' ? 'warning' : 'subtle'" class="panel">
        <div class="panel-head">
          <div>
            <div class="panel-label">{{ $t('dashboard.todayFocus') }}</div>
            <h3>{{ focusTitle }}</h3>
          </div>
          <TimerReset class="panel-icon" />
        </div>
        <p class="panel-copy">{{ focusCopy }}</p>
        <button type="button" class="secondary-link" @click="openTelegram">
          <AudioLines class="button-icon" />
          <span>{{ $t('dashboard.practiceNow') }}</span>
        </button>
      </GlassCard>

      <GlassCard tone="subtle" class="panel">
        <div class="panel-head">
          <div>
            <div class="panel-label">{{ $t('dashboard.quickActions') }}</div>
            <h3>{{ $t('dashboard.quickActionsTitle') }}</h3>
          </div>
          <ChevronRight class="panel-icon" />
        </div>

        <div class="action-list">
          <button type="button" class="action-btn" @click="emit('navigate', '/profile?section=level')">
            <GraduationCap class="action-icon" />
            <span>{{ $t('dashboard.actions.level') }}</span>
          </button>
          <button type="button" class="action-btn" @click="openTeachersUrl">
            <Languages class="action-icon" />
            <span>{{ $t('dashboard.actions.otherLanguages') }}</span>
          </button>
          <button type="button" class="action-btn" @click="emit('navigate', '/subscription')">
            <WalletCards class="action-icon" />
            <span>{{ $t('dashboard.actions.plan') }}</span>
          </button>
          <button type="button" class="action-btn" @click="emit('navigate', '/feedback')">
            <LifeBuoy class="action-icon" />
            <span>{{ $t('dashboard.actions.support') }}</span>
          </button>
        </div>
      </GlassCard>

      <GlassCard tone="subtle" class="panel support-panel">
        <div class="panel-head">
          <div>
            <div class="panel-label">{{ $t('dashboard.supportLabel') }}</div>
            <h3>{{ $t('dashboard.supportTitle') }}</h3>
          </div>
          <MessageSquareText class="panel-icon" />
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

        <button type="button" class="secondary-link" @click="emit('navigate', '/feedback')">
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
  AudioLines,
  ChevronRight,
  Flame,
  Globe,
  GraduationCap,
  Languages,
  LifeBuoy,
  MessageSquareText,
  Send,
  Sparkles,
  TimerReset,
  Trophy,
  WalletCards
} from 'lucide-vue-next';
import GlassCard from '../components/GlassCard.vue';
import { apiJson } from '../lib/api.js';
import { tgOpenLink } from '../lib/tg.js';
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
const currentBotKey = computed(() => props.botKey || selectedBot.value?.bot_key || '');

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
const baseLanguageCode = computed(() => {
  const raw = (selectedBot.value?.base_language || currentBotKey.value.split('-')[0] || '').toString().trim().toLowerCase();
  if (raw === 'ua') return 'uk';
  return raw || 'en';
});
const teachersUrl = computed(() => `https://ai-language-school.online/${baseLanguageCode.value}/teachers`);

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

const longestStreakCopy = computed(() => {
  if (!streak.value.longest) return t('dashboard.longestStreakEmpty');
  return t('dashboard.longestStreakCopy', { count: streak.value.longest });
});

const planLabel = computed(() => {
  const tier = (usage.value?.tier || dashboard.value?.user?.plan_tier || 'free').toString().toLowerCase();
  return tier === 'pro' ? t('plans.tiers.pro') : t('plans.tiers.free');
});

function formatMinutes(secondsRaw) {
  const seconds = Number(secondsRaw || 0);
  const minutes = Math.max(0, Math.round(seconds / 60));
  return `${minutes} ${t('dashboard.minutes')}`;
}

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

const focusTitle = computed(() => {
  if (streak.value.status === 'active') return t('dashboard.focusActiveTitle');
  if (streak.value.status === 'at_risk') return t('dashboard.focusRiskTitle');
  return t('dashboard.focusRestartTitle');
});

const focusCopy = computed(() => {
  if (streak.value.status === 'active') return t('dashboard.focusActiveCopy');
  if (streak.value.status === 'at_risk') return t('dashboard.focusRiskCopy');
  return t('dashboard.focusRestartCopy');
});
const showFocusPanel = computed(() => streak.value.status !== 'broken');

const lastSenderLabel = computed(() => {
  if (feedbackSummary.value.last_message_sender === 'admin') return t('dashboard.supportFromAdmin');
  if (feedbackSummary.value.last_message_sender === 'user') return t('dashboard.supportFromYou');
  return t('dashboard.supportLabel');
});

function openTelegram() {
  const url = selectedBot.value?.telegram_url || props.me?.telegram_url || '';
  if (!url) return;
  tgOpenLink(url);
}

function openTeachersUrl() {
  tgOpenLink(teachersUrl.value);
}
</script>

<style scoped>
.dashboard-shell {
  width: min(760px, 100%);
  padding: 28px 18px calc(118px + env(safe-area-inset-bottom, 0px));
  display: grid;
  gap: 18px;
}

.hero-grid,
.stats-grid,
.dashboard-grid {
  display: grid;
  gap: 16px;
}

.hero-card,
.coach-card,
.panel,
.stat-card,
.notice-card {
  padding: 20px;
}

.hero-card {
  display: grid;
  gap: 18px;
}

.eyebrow,
.coach-overline,
.stat-label,
.panel-label {
  font-size: 11px;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.16em;
  color: var(--muted-strong);
}

.hero-card h1,
.coach-card h2,
.panel h3 {
  margin: 0;
  font-family: var(--font-display);
  letter-spacing: -0.03em;
}

.hero-card h1 {
  font-size: clamp(34px, 9vw, 56px);
  line-height: 0.96;
  margin-top: 10px;
}

.hero-sub,
.coach-copy,
.panel-copy,
.stat-copy,
.support-empty,
.support-preview p,
.usage-copy {
  margin: 0;
  color: var(--muted);
  line-height: 1.6;
}

.hero-actions {
  display: grid;
  gap: 12px;
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
.panel-icon,
.stat-icon {
  width: 20px;
  height: 20px;
  color: var(--accent-strong);
}

.primary-cta,
.secondary-link,
.action-btn {
  border: 0;
  border-radius: 18px;
  cursor: pointer;
  font-weight: 700;
  transition: transform 180ms ease, box-shadow 180ms ease, background-color 180ms ease;
}

.primary-cta,
.secondary-link {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  min-height: 52px;
  padding: 0 18px;
}

.primary-cta {
  background: linear-gradient(135deg, var(--accent), var(--accent-strong));
  color: white;
  box-shadow: 0 18px 34px rgba(66, 121, 214, 0.28);
}

.secondary-link {
  background: rgba(255, 255, 255, 0.82);
  color: var(--ink);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.56);
}

.secondary-link--fit {
  justify-self: start;
}

.primary-cta:hover,
.secondary-link:hover,
.action-btn:hover {
  transform: translateY(-1px);
}

.button-icon,
.action-icon {
  width: 18px;
  height: 18px;
}

.coach-head,
.panel-head,
.stat-head {
  display: flex;
  justify-content: space-between;
  gap: 16px;
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

.coach-card {
  display: grid;
  gap: 14px;
}

.coach-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.coach-meta span,
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

.stat-card {
  display: grid;
  gap: 12px;
}

.stat-value {
  font-size: clamp(34px, 8vw, 42px);
  font-weight: 800;
  letter-spacing: -0.05em;
  color: var(--ink);
}

.stat-inline {
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

.panel {
  display: grid;
  gap: 16px;
}

.action-list {
  display: grid;
  gap: 10px;
}

.action-btn {
  min-height: 54px;
  padding: 0 16px;
  display: flex;
  align-items: center;
  gap: 12px;
  justify-content: flex-start;
  background: rgba(255, 255, 255, 0.78);
  color: var(--ink);
}

.support-panel {
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

.notice-card p {
  margin: 0;
  color: var(--ink);
  font-weight: 600;
}

@media (min-width: 768px) {
  .stats-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
