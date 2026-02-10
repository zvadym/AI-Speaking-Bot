<template>
  <div class="shell fade-in">
    <header class="page-hero">
      <div class="kicker">{{ $t('language.kicker') }}</div>
      <h1>{{ $t('language.title') }}</h1>
      <p class="sub">
        {{ $t('language.subLocked') }}
      </p>
    </header>

    <section class="list">
      <button
        v-for="lang in languages"
        :key="lang.code"
        class="row"
        :class="{ active: current === lang.code, busy: busy === lang.code }"
        :disabled="languageLocked || Boolean(busy)"
        @click="setLang(lang.code)"
      >
        <div class="flag" aria-hidden="true">{{ lang.flag }}</div>
        <div class="mid">
          <div class="top">
            <span class="label">{{ lang.label }}</span>
            <span class="tag" v-if="current === lang.code">{{ $t('common.selected') }}</span>
          </div>
          <div class="note">{{ lang.note }}</div>
        </div>
        <div class="right" aria-hidden="true">
          <span v-if="current === lang.code">✓</span>
          <span v-else>→</span>
        </div>
      </button>
    </section>

    <BackToMenu @navigate="(path) => $emit('navigate', path)" />
  </div>
</template>

<script setup>
import { computed, ref } from 'vue';
import { useI18n } from '../i18n.js';
import { apiJson } from '../lib/api.js';
import { tgHaptic } from '../lib/tg.js';
import { track } from '../lib/metrics.js';
import BackToMenu from '../components/BackToMenu.vue';

const props = defineProps({
  apiBase: { type: String, required: true },
  token: { type: String, required: true },
  me: { type: Object, default: null },
  botKey: { type: String, default: '' },
  refreshMe: { type: Function, required: true },
  toast: { type: Function, required: true }
});

const emit = defineEmits(['navigate']);
const { t } = useI18n({ useScope: 'global' });

const busy = ref('');
const languageLocked = true;

const languages = computed(() => [
  { code: 'en', flag: '🇬🇧', label: t('practiceLanguages.en'), note: t('language.options.en.note') },
  { code: 'de', flag: '🇩🇪', label: t('practiceLanguages.de'), note: t('language.options.de.note') }
]);

const current = computed(() => (props.me?.target_lang || 'en').toLowerCase());

async function setLang(code) {
  if (languageLocked) return;
  if (busy.value) return;
  busy.value = code;
  track('ui_click', { id: 'language_select', lang: code });
  tgHaptic('impact', 'light');
  try {
    await apiJson(props.apiBase, '/me/target-lang', {
      method: 'POST',
      token: props.token,
      query: props.botKey ? { bot_key: props.botKey } : undefined,
      body: { target_lang: code }
    });
    await props.refreshMe();
    track('setting_saved', { key: 'target_lang', value: code });
    props.toast(t('language.toasts.savedPickLevel'));
    emit('navigate', '/level');
  } catch (err) {
    console.error(err);
    props.toast(t('common.errors.couldNotSave'));
    tgHaptic('notification', 'error');
  } finally {
    busy.value = '';
  }
}
</script>

<style scoped>
.shell {
  width: min(900px, 100%);
  padding: 40px 22px 72px;
  display: grid;
  gap: 18px;
}

.page-hero {
  display: grid;
  gap: 10px;
  margin-bottom: 6px;
}

.kicker {
  text-transform: uppercase;
  letter-spacing: 0.26em;
  font-size: 11px;
  color: var(--accent-2);
}

.page-hero h1 {
  font-family: var(--font-display);
  font-size: clamp(28px, 4.8vw, 46px);
  line-height: 1.04;
  margin: 0;
}

.sub {
  margin: 0;
  color: var(--muted);
  font-size: 15px;
  line-height: 1.6;
}

.sub code {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;
  font-size: 0.95em;
  padding: 2px 7px;
  border-radius: 999px;
  border: 1px solid rgba(30, 26, 22, 0.14);
  background: rgba(255, 255, 255, 0.55);
}

.list {
  display: grid;
  gap: 12px;
}

.row {
  width: 100%;
  display: grid;
  grid-template-columns: auto 1fr auto;
  gap: 14px;
  text-align: left;
  align-items: center;
  padding: 16px 16px;
  border-radius: 20px;
  border: 1px solid var(--stroke);
  background: rgba(255, 255, 255, 0.65);
  box-shadow: 0 16px 38px var(--shadow);
  cursor: pointer;
  transition: transform 120ms ease, box-shadow 120ms ease;
}

.row.active {
  border-color: rgba(31, 107, 99, 0.32);
  background:
    radial-gradient(120% 140% at 0% 0%, rgba(31, 107, 99, 0.18), transparent 55%),
    rgba(255, 255, 255, 0.65);
}

.row.busy {
  opacity: 0.8;
}

.row:active {
  transform: translateY(2px);
  box-shadow: 0 12px 26px var(--shadow);
}

.row:disabled {
  cursor: default;
  opacity: 0.65;
}

.flag {
  width: 44px;
  height: 44px;
  border-radius: 14px;
  display: grid;
  place-items: center;
  font-size: 22px;
  background: rgba(255, 255, 255, 0.55);
  border: 1px solid rgba(30, 26, 22, 0.08);
}

.top {
  display: flex;
  align-items: baseline;
  gap: 10px;
  flex-wrap: wrap;
}

.label {
  font-weight: 800;
  letter-spacing: -0.01em;
  font-size: 17px;
}

.tag {
  padding: 5px 10px;
  border-radius: 999px;
  border: 1px solid rgba(31, 107, 99, 0.24);
  background: rgba(255, 255, 255, 0.45);
  text-transform: uppercase;
  font-size: 11px;
  letter-spacing: 0.16em;
  font-weight: 800;
  color: var(--ink);
  opacity: 0.8;
}

.note {
  margin-top: 6px;
  font-size: 14px;
  color: var(--muted);
  line-height: 1.5;
}

.right {
  font-size: 18px;
  opacity: 0.72;
}

</style>
