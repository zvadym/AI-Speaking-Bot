<template>
  <div class="shell fade-in">
    <header class="page-hero">
      <div class="kicker">{{ $t('level.kicker') }}</div>
      <h1>{{ $t('level.title') }}</h1>
      <p class="sub">
        {{ $t('level.subPrefix') }} <code>/level</code>{{ $t('level.subSuffix') }}
      </p>
    </header>

    <section class="grid">
      <button
        v-for="lvl in levels"
        :key="lvl.code"
        class="tile"
        :class="{ active: current === lvl.code, busy: busy === lvl.code }"
        :disabled="Boolean(busy)"
        @click="setLevel(lvl.code)"
      >
        <div class="top">
          <span class="code">{{ lvl.code.toUpperCase() }}</span>
          <span class="tag" v-if="current === lvl.code">{{ $t('common.selected') }}</span>
        </div>
        <div class="note">{{ lvl.note }}</div>
      </button>
    </section>

    <BackToMenu @navigate="(path) => $emit('navigate', path)" />
  </div>
</template>

<script setup>
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { apiJson } from '../lib/api.js';
import { tgHaptic } from '../lib/tg.js';
import BackToMenu from '../components/BackToMenu.vue';

const props = defineProps({
  apiBase: { type: String, required: true },
  token: { type: String, required: true },
  me: { type: Object, default: null },
  refreshMe: { type: Function, required: true },
  toast: { type: Function, required: true }
});

defineEmits(['navigate']);
const { t } = useI18n({ useScope: 'global' });

const busy = ref('');

const levels = computed(() => [
  { code: 'a1', note: t('level.notes.a1') },
  { code: 'a2', note: t('level.notes.a2') },
  { code: 'b1', note: t('level.notes.b1') },
  { code: 'b2', note: t('level.notes.b2') },
  { code: 'c1', note: t('level.notes.c1') }
]);

const current = computed(() => (props.me?.level || 'b1').toString().toLowerCase());

async function setLevel(code) {
  if (busy.value) return;
  busy.value = code;
  tgHaptic('impact', 'light');
  try {
    await apiJson(props.apiBase, '/me/level', {
      method: 'POST',
      token: props.token,
      body: { level: code }
    });
    await props.refreshMe();
    props.toast(t('level.toasts.saved'));
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

.grid {
  display: grid;
  gap: 12px;
}

.tile {
  width: 100%;
  text-align: left;
  border-radius: 20px;
  border: 1px solid var(--stroke);
  background: rgba(255, 255, 255, 0.65);
  box-shadow: 0 16px 38px var(--shadow);
  padding: 16px 16px;
  cursor: pointer;
  transition: transform 120ms ease, box-shadow 120ms ease;
}

.tile.active {
  border-color: rgba(199, 90, 36, 0.28);
  background:
    radial-gradient(130% 150% at 0% 0%, rgba(199, 90, 36, 0.18), transparent 55%),
    rgba(255, 255, 255, 0.65);
}

.tile.busy {
  opacity: 0.8;
}

.tile:active {
  transform: translateY(2px);
  box-shadow: 0 12px 26px var(--shadow);
}

.tile:disabled {
  cursor: default;
}

.top {
  display: flex;
  align-items: baseline;
  gap: 10px;
  flex-wrap: wrap;
}

.code {
  font-weight: 900;
  letter-spacing: -0.02em;
  font-size: 18px;
}

.tag {
  padding: 5px 10px;
  border-radius: 999px;
  border: 1px solid rgba(199, 90, 36, 0.22);
  background: rgba(255, 255, 255, 0.45);
  text-transform: uppercase;
  font-size: 11px;
  letter-spacing: 0.16em;
  font-weight: 800;
  color: var(--ink);
  opacity: 0.8;
}

.note {
  margin-top: 8px;
  font-size: 14px;
  color: var(--muted);
  line-height: 1.5;
  max-width: 68ch;
}

</style>
