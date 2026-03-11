<template>
  <div class="profile-shell fade-in">
    <GlassCard tone="subtle" class="section">
      <div class="section-head">
        <div>
          <div class="eyebrow">{{ $t('profile.teacherSection') }}</div>
          <h2>{{ selectedBot.bot_name || languageLabel }}</h2>
        </div>
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
import { Globe, GraduationCap, Info } from 'lucide-vue-next';
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
  padding: 22px 16px calc(104px + env(safe-area-inset-bottom, 0px));
  display: grid;
  gap: 14px;
  align-content: start;
}

.section {
  padding: 16px;
}

.section {
  display: grid;
  gap: 12px;
  align-content: start;
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
  font-size: 10px;
  font-weight: 750;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  color: var(--muted);
}

h1,
h2 {
  margin: 0;
  font-family: var(--font-body);
  letter-spacing: -0.04em;
}

h1 {
  font-size: clamp(28px, 7vw, 38px);
  font-weight: 800;
}

h2 {
  font-size: clamp(20px, 4vw, 26px);
  font-weight: 760;
}

.hero-copy,
.section-copy,
.level-tile p {
  margin: 0;
  color: var(--muted);
  line-height: 1.5;
}

.ghost-link {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 40px;
  padding: 0 14px;
  border-radius: 12px;
  border: 1px solid rgba(157, 146, 129, 0.24);
  cursor: pointer;
  background: rgba(255, 255, 255, 0.58);
  color: var(--ink);
  font-weight: 700;
}

.ghost-link.secondary {
  justify-self: flex-start;
}

.button-icon,
.section-icon {
  width: 16px;
  height: 16px;
}

.meta-grid,
.level-grid {
  display: grid;
  gap: 10px;
}

.meta-tile,
.level-tile {
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.56);
  border: 1px solid rgba(157, 146, 129, 0.2);
}

.meta-button {
  border: 0;
  text-align: left;
  cursor: pointer;
}

.meta-tile {
  padding: 12px 14px;
  display: grid;
  gap: 4px;
}

.meta-tile span {
  color: var(--muted);
  font-size: 12px;
  font-weight: 600;
}

.meta-tile strong {
  color: var(--ink);
  font-size: 14px;
}

.level-tile {
  cursor: pointer;
  text-align: left;
  padding: 14px;
  transition: transform 180ms ease, box-shadow 180ms ease, background-color 180ms ease, border-color 180ms ease;
}

.level-tile.active {
  background: rgba(127, 150, 128, 0.16);
  border-color: rgba(95, 117, 96, 0.3);
}

.level-tile.busy {
  opacity: 0.82;
}

.level-top {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 6px;
}

.level-top strong {
  font-size: 16px;
}

.level-top span {
  color: var(--accent-strong);
  font-size: 11px;
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
