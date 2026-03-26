<template>
  <Teleport to="body">
    <div v-if="open" class="overlay" @click="onOverlayClick">
      <div
        ref="dialogRef"
        class="dialog"
        role="dialog"
        aria-modal="true"
        :aria-labelledby="titleId"
        @click.stop
        @keydown.esc.prevent="close"
      >
        <header class="dialog-head">
          <div class="head-left">
            <div class="icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" focusable="false">
                <path d="M20.66 4.21a2.05 2.05 0 0 0-2.08-.24L3.61 10.3a1.17 1.17 0 0 0 .09 2.18l3.08 1.06 1.16 4.38a1.19 1.19 0 0 0 2.02.51l2.2-2.26 4.24 3.14a1.77 1.77 0 0 0 2.78-1.01l2.46-12.3a2.05 2.05 0 0 0-.98-1.79Z" />
                <path d="m8.01 13.14 8.99-5.49a.45.45 0 0 1 .57.67l-7.39 7.36-.47 2.34-.95-3.55a1.46 1.46 0 0 1-.75-1.33Z" />
              </svg>
            </div>
            <div class="head-text">
              <h2 :id="titleId" class="h2 title">{{ t('home.tryModalTitle') }}</h2>
              <p class="muted sub">{{ t('home.tryModalSubhead') }}</p>
            </div>
          </div>

          <button ref="closeBtnRef" class="icon-btn" type="button" :aria-label="t('cta.close')" @click="close">
            <span aria-hidden="true">✕</span>
          </button>
        </header>

        <div class="dialog-body">
          <div v-if="sections.length" class="sections">
            <section v-for="section in sections" :key="section.code" class="paths-section" :class="{ primary: section.isPrimary }">
              <header class="section-head">
                <h3 class="h3 section-title">{{ t('practice.basePathsHeading', { language: section.label }) }}</h3>
                <p class="muted section-sub">
                  {{ t(section.targetSummary ? 'practice.basePathsSubhead' : 'practice.basePathsSubheadFallback', { language: section.label, targets: section.targetSummary }) }}
                </p>
                <div v-if="section.targetLanguages?.length" class="section-language-pills">
                  <button
                    v-for="target in section.targetLanguages"
                    :key="`${section.code}-${target.code}`"
                    type="button"
                    class="section-language-pill"
                    :class="{ active: activeTargetCodeFor(section.code) === target.code }"
                    :aria-pressed="activeTargetCodeFor(section.code) === target.code ? 'true' : 'false'"
                    @click="toggleTarget(section.code, target.code)"
                  >
                    {{ target.label }}
                  </button>
                </div>
              </header>
              <TransitionGroup name="path-list" tag="div" class="grid-2 list">
                <PracticePathTelegramCard
                  v-for="practicePath in sortedPracticePathsFor(section)"
                  :key="practicePath.slug"
                  :practice-path="practicePath"
                  :highlighted="isPracticePathHighlighted(section, practicePath)"
                  @choose="close"
                />
              </TransitionGroup>
            </section>
          </div>

          <p v-else class="muted empty">{{ t('practice.empty') }}</p>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import PracticePathTelegramCard from './PracticePathTelegramCard.vue';
import { practicePaths } from '../data/practicePaths.js';
import { useI18n } from '../i18n.js';
import { useFocusTrap } from '../lib/useFocusTrap.js';
import { usePracticePathSections } from '../lib/usePracticePathSections.js';
import { usePracticePathTargetSort } from '../lib/usePracticePathTargetSort.js';

const props = defineProps({
  open: { type: Boolean, default: false }
});

const emit = defineEmits(['update:open']);
const { t, locale } = useI18n();
const { sections } = usePracticePathSections(practicePaths, locale, t);
const { activeTargetCodeFor, toggleTarget, sortedPracticePathsFor, isPracticePathHighlighted, reset } = usePracticePathTargetSort();

const titleId = 'try-practice-title';
const closeBtnRef = ref(null);
const dialogRef = ref(null);
const previousOverflow = ref('');

function close() {
  emit('update:open', false);
}

function onOverlayClick(event) {
  if (event.target !== event.currentTarget) return;
  close();
}

function lockBodyScroll() {
  if (!import.meta.client) return;
  previousOverflow.value = document.body.style.overflow || '';
  document.body.style.overflow = 'hidden';
}

function unlockBodyScroll() {
  if (!import.meta.client) return;
  document.body.style.overflow = previousOverflow.value;
}

const openState = computed(() => !!props.open);

useFocusTrap({
  active: openState,
  containerRef: dialogRef,
  initialFocusRef: closeBtnRef
});

watch(
  openState,
  async (isOpen) => {
    if (!import.meta.client) return;
    if (isOpen) {
      lockBodyScroll();
      return;
    }
    reset();
    unlockBodyScroll();
  },
  { immediate: true }
);

onBeforeUnmount(() => {
  if (!import.meta.client) return;
  unlockBodyScroll();
});
</script>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: grid;
  place-items: center;
  padding: 22px;
  background: color-mix(in srgb, var(--fg) 50%, transparent);
  backdrop-filter: blur(10px);
}

.dialog {
  width: min(1040px, 100%);
  max-height: min(86vh, 920px);
  border-radius: calc(var(--radius-lg) + 4px);
  border: 1px solid color-mix(in srgb, var(--fg) 14%, var(--border));
  box-shadow:
    0 40px 90px color-mix(in srgb, var(--fg) 22%, transparent),
    0 2px 0 rgba(0, 0, 0, 0.06);
  background:
    radial-gradient(120% 140% at 12% 8%, color-mix(in srgb, #229ed9 14%, transparent), transparent 50%),
    radial-gradient(120% 140% at 90% 84%, color-mix(in srgb, #34d399 10%, transparent), transparent 52%),
    var(--bg);
  overflow: hidden;
}

.dialog-head {
  display: flex;
  align-items: start;
  justify-content: space-between;
  gap: 16px;
  padding: 18px 18px 14px;
  border-bottom: 1px solid color-mix(in srgb, var(--fg) 10%, var(--border));
}

.head-left {
  display: flex;
  gap: 14px;
  min-width: 0;
}

.head-text {
  min-width: 0;
  display: grid;
  gap: 6px;
}

.title {
  font-size: clamp(22px, 2.2vw, 30px);
  line-height: 1.05;
}

.sub {
  margin: 0;
  max-width: 72ch;
  line-height: 1.55;
}

.icon {
  width: 44px;
  height: 44px;
  border-radius: 14px;
  display: grid;
  place-items: center;
  background:
    radial-gradient(120% 140% at 10% 10%, color-mix(in srgb, #229ed9 22%, transparent), transparent 52%),
    color-mix(in srgb, var(--surface) 74%, var(--bg));
  border: 1px solid color-mix(in srgb, #229ed9 30%, var(--border));
}

.icon svg {
  width: 22px;
  height: 22px;
  fill: color-mix(in srgb, #229ed9 86%, var(--fg));
}

.icon-btn {
  border: 0;
  background: transparent;
  color: var(--muted);
  font-size: 20px;
  line-height: 1;
  cursor: pointer;
}

.dialog-body {
  overflow: auto;
  padding: 18px;
}

.sections {
  display: grid;
  gap: 18px;
}

.paths-section {
  display: grid;
  gap: 18px;
  padding: 22px;
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: linear-gradient(180deg, color-mix(in srgb, var(--surface) 36%, var(--bg)), var(--bg));
}

.paths-section.primary {
  border-color: color-mix(in srgb, #229ed9 35%, var(--border));
  background: linear-gradient(180deg, color-mix(in srgb, #229ed9 10%, var(--surface)), color-mix(in srgb, #229ed9 4%, var(--bg)));
}

.section-head {
  display: grid;
  gap: 10px;
}

.section-title {
  margin: 0;
  font-size: clamp(21px, 2.2vw, 29px);
}

.section-sub {
  margin: 0;
  max-width: 64ch;
  line-height: 1.55;
}

.section-language-pills {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.section-language-pill {
  display: inline-flex;
  align-items: center;
  padding: 5px 10px;
  border-radius: 999px;
  border: 1px solid color-mix(in srgb, var(--fg) 12%, var(--border));
  background: color-mix(in srgb, var(--surface) 66%, var(--bg));
  font-size: 12px;
  font-weight: 650;
  cursor: pointer;
  appearance: none;
}

.section-language-pill.active {
  border-color: color-mix(in srgb, #229ed9 45%, var(--border));
  background:
    radial-gradient(120% 140% at 10% 10%, color-mix(in srgb, #229ed9 12%, transparent), transparent 55%),
    color-mix(in srgb, var(--surface) 66%, var(--bg));
  color: color-mix(in srgb, #229ed9 85%, var(--fg));
}

.path-list-move {
  transition: transform 260ms cubic-bezier(0.2, 0.8, 0.2, 1);
}

.path-list-enter-active,
.path-list-leave-active {
  transition: opacity 140ms ease;
}

.path-list-enter-from,
.path-list-leave-to {
  opacity: 0;
}

.list {
  gap: 14px;
}
</style>
