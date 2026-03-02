<template>
  <div class="profile-shell fade-in">
    <GlassCard tone="accent" class="profile-hero">
      <div>
        <div class="eyebrow">{{ $t('profile.eyebrow') }}</div>
        <h1>{{ $t('profile.title') }}</h1>
        <p class="hero-copy">{{ $t('profile.sub') }}</p>
      </div>
      <button v-if="selectedBot.telegram_url" type="button" class="ghost-link" @click="openTelegram">
        <Bot class="button-icon" />
        <span>{{ $t('profile.openCoachChat') }}</span>
      </button>
    </GlassCard>

    <GlassCard tone="subtle" class="section">
      <div class="section-head">
        <div>
          <div class="eyebrow">{{ $t('profile.teacherSection') }}</div>
          <h2>{{ selectedBot.bot_name || languageLabel }}</h2>
        </div>
        <div class="coach-badge">{{ teacherAvatar }}</div>
      </div>
      <p class="section-copy">{{ teacherTagline }}</p>
      <div class="meta-grid">
        <div class="meta-tile">
          <span>{{ $t('profile.learningLanguage') }}</span>
          <strong>{{ languageLabel }}</strong>
        </div>
        <button type="button" class="meta-tile meta-button" @click="scrollToLevelSection">
          <span>{{ $t('profile.level') }}</span>
          <strong>{{ currentLevelLabel }}</strong>
        </button>
        <div class="meta-tile">
          <span>{{ $t('profile.replyMode') }}</span>
          <strong>{{ replyModeLabel }}</strong>
        </div>
      </div>
      <button type="button" class="ghost-link secondary" @click="openTeachersUrl">
        <Globe class="button-icon" />
        <span>{{ $t('profile.otherLanguages') }}</span>
      </button>
    </GlassCard>

    <GlassCard ref="levelSectionEl" tone="subtle" class="section">
      <div class="section-head compact">
        <div>
          <div class="eyebrow">{{ $t('profile.levelSection') }}</div>
          <h2>{{ $t('profile.levelTitle') }}</h2>
        </div>
        <GraduationCap class="section-icon" />
      </div>
      <div class="level-grid">
        <button
          v-for="lvl in levels"
          :key="lvl.code"
          type="button"
          class="level-tile"
          :class="{ active: currentLevel === lvl.code, busy: savingLevel === lvl.code }"
          :disabled="Boolean(savingLevel)"
          @click="setLevel(lvl.code)"
        >
          <div class="level-top">
            <strong>{{ lvl.code.toUpperCase() }}</strong>
            <span v-if="currentLevel === lvl.code">{{ $t('common.selected') }}</span>
          </div>
          <p>{{ lvl.note }}</p>
        </button>
      </div>
    </GlassCard>

    <GlassCard tone="subtle" class="section">
      <div class="section-head compact">
        <div>
          <div class="eyebrow">{{ $t('profile.appSection') }}</div>
          <h2>{{ $t('profile.appTitle') }}</h2>
        </div>
        <Info class="section-icon" />
      </div>
      <p class="section-copy">{{ $t('profile.schoolCopy') }}</p>
      <button type="button" class="ghost-link secondary" @click="openSchoolUrl">
        <Globe class="button-icon" />
        <span>{{ $t('profile.schoolLink') }}</span>
      </button>
    </GlassCard>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue';
import { Bot, Globe, GraduationCap, Info } from 'lucide-vue-next';
import GlassCard from '../components/GlassCard.vue';
import { apiJson } from '../lib/api.js';
import { tgHaptic, tgOpenLink } from '../lib/tg.js';
import { useI18n } from '../i18n.js';

const props = defineProps({
  apiBase: { type: String, required: true },
  token: { type: String, required: true },
  me: { type: Object, default: null },
  bots: { type: Array, default: () => [] },
  botKey: { type: String, default: '' },
  refreshMe: { type: Function, required: true },
  selectBotAndRefresh: { type: Function, required: false, default: null },
  toast: { type: Function, required: true }
});

const { t } = useI18n({ useScope: 'global' });
const savingLevel = ref('');
const levelSectionEl = ref(null);
const schoolUrl = ((import.meta.env.VITE_SCHOOL_URL || 'https://ai-language-school.online/').toString()).trim();

const selectedBot = computed(() => props.me || {});
const currentBotKey = computed(() => props.botKey || selectedBot.value?.bot_key || '');
const currentLevel = computed(() => (selectedBot.value?.level || 'b1').toString().toLowerCase());
const currentLevelLabel = computed(() => currentLevel.value.toUpperCase());
const teacherAvatar = computed(() => (selectedBot.value?.teacher_avatar_emoji || 'AI').toString());
const teacherTagline = computed(() =>
  selectedBot.value?.teacher_tagline_en
  || selectedBot.value?.teacher_tagline_it
  || selectedBot.value?.teacher_tagline_uk
  || t('profile.teacherFallback')
);

function languageLabelForCode(codeRaw, keyPrefix = 'practiceLanguages') {
  const code = (codeRaw || '').toString().trim().toLowerCase();
  if (!code) return t('common.dash');
  const key = `${keyPrefix}.${code}`;
  const translated = t(key);
  return translated !== key ? translated : code.toUpperCase();
}

const languageLabel = computed(() => languageLabelForCode(selectedBot.value?.learning_language));
const replyModeLabel = computed(() => (
  selectedBot.value?.reply_mode === 'voice' ? t('profile.replyModeVoice') : t('profile.replyModeText')
));
const baseLanguageCode = computed(() => {
  const raw = (selectedBot.value?.base_language || currentBotKey.value.split('-')[0] || '').toString().trim().toLowerCase();
  if (raw === 'ua') return 'uk';
  return raw || 'en';
});
const teachersUrl = computed(() => `${schoolUrl.replace(/\/+$/, '')}/${baseLanguageCode.value}/teachers`);

const levels = computed(() => [
  { code: 'a1', note: t('level.notes.a1') },
  { code: 'a2', note: t('level.notes.a2') },
  { code: 'b1', note: t('level.notes.b1') },
  { code: 'b2', note: t('level.notes.b2') },
  { code: 'c1', note: t('level.notes.c1') }
]);

function scrollToLevelSection() {
  levelSectionEl.value?.$el?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
}

function openTeachersUrl() {
  if (!teachersUrl.value) return;
  tgOpenLink(teachersUrl.value);
}

async function setLevel(code) {
  if (!code || savingLevel.value || currentLevel.value === code) return;
  savingLevel.value = code;
  try {
    await apiJson(props.apiBase, '/me/level', {
      method: 'POST',
      token: props.token,
      query: currentBotKey.value ? { bot_key: currentBotKey.value } : undefined,
      body: { level: code }
    });
    await props.refreshMe();
    props.toast(t('profile.levelSaved'));
    tgHaptic('notification', 'success');
  } catch (err) {
    console.error(err);
    props.toast(t('common.errors.couldNotSave'));
    tgHaptic('notification', 'error');
  } finally {
    savingLevel.value = '';
  }
}

function openTelegram() {
  const url = selectedBot.value?.telegram_url || '';
  if (!url) return;
  tgOpenLink(url);
}

function openSchoolUrl() {
  if (!schoolUrl) return;
  tgOpenLink(schoolUrl);
}

onMounted(() => {
  const section = new URLSearchParams(window.location.search).get('section');
  if (section === 'level') {
    window.requestAnimationFrame(() => scrollToLevelSection());
  }
});
</script>

<style scoped>
.profile-shell {
  width: min(760px, 100%);
  padding: 28px 18px calc(118px + env(safe-area-inset-bottom, 0px));
  display: grid;
  gap: 18px;
}

.profile-hero,
.section {
  padding: 20px;
}

.profile-hero,
.section {
  display: grid;
  gap: 16px;
}

.section-head {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  align-items: flex-start;
}

.section-head.compact {
  align-items: center;
}

.eyebrow {
  font-size: 11px;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.16em;
  color: var(--muted-strong);
}

h1,
h2 {
  margin: 0;
  font-family: var(--font-display);
  letter-spacing: -0.03em;
}

h1 {
  font-size: clamp(32px, 8vw, 48px);
}

h2 {
  font-size: clamp(24px, 5vw, 32px);
}

.hero-copy,
.section-copy,
.level-tile p {
  margin: 0;
  color: var(--muted);
  line-height: 1.6;
}

.ghost-link {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  min-height: 50px;
  padding: 0 16px;
  border-radius: 18px;
  border: 0;
  cursor: pointer;
  background: rgba(255, 255, 255, 0.82);
  color: var(--ink);
  font-weight: 700;
}

.ghost-link.secondary {
  justify-self: flex-start;
}

.button-icon,
.section-icon {
  width: 18px;
  height: 18px;
}

.coach-badge {
  width: 50px;
  height: 50px;
  border-radius: 18px;
  display: grid;
  place-items: center;
  background: rgba(255, 255, 255, 0.84);
  font-size: 26px;
}

.meta-grid,
.level-grid {
  display: grid;
  gap: 12px;
}

.meta-tile,
.level-tile {
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.78);
}

.meta-button {
  border: 0;
  text-align: left;
  cursor: pointer;
}

.meta-tile {
  padding: 14px 16px;
  display: grid;
  gap: 6px;
}

.meta-tile span {
  color: var(--muted);
  font-size: 13px;
  font-weight: 600;
}

.meta-tile strong {
  color: var(--ink);
  font-size: 15px;
}

.level-tile {
  border: 0;
  cursor: pointer;
  text-align: left;
  padding: 16px;
  transition: transform 180ms ease, box-shadow 180ms ease, background-color 180ms ease;
}

.level-tile.active {
  background:
    radial-gradient(120% 150% at 0% 0%, rgba(124, 197, 255, 0.22), transparent 48%),
    rgba(255, 255, 255, 0.9);
}

.level-tile.busy {
  opacity: 0.82;
}

.level-top {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 8px;
}

.level-top strong {
  font-size: 18px;
}

.level-top span {
  color: var(--accent-strong);
  font-size: 12px;
  font-weight: 700;
}

@media (min-width: 768px) {
  .meta-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .level-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
