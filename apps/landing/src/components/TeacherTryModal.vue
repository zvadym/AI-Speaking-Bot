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
            <section v-for="section in sections" :key="section.code" class="teachers-section" :class="{ primary: section.isPrimary }">
              <header class="section-head">
                <h3 class="h3 section-title">{{ t('teachers.baseTeachersHeading', { language: section.label }) }}</h3>
                <p class="muted section-sub">
                  {{
                    t(
                      section.learningSummary ? 'teachers.baseTeachersSubhead' : 'teachers.baseTeachersSubheadFallback',
                      { language: section.label, targets: section.learningSummary }
                    )
                  }}
                </p>
                <div v-if="section.learningLanguages?.length" class="section-language-pills">
                  <button
                    v-for="target in section.learningLanguages"
                    :key="`${section.code}-${target.code}`"
                    type="button"
                    class="section-language-pill"
                    :class="{ active: activeLearningCodeFor(section.code) === target.code }"
                    :aria-pressed="activeLearningCodeFor(section.code) === target.code ? 'true' : 'false'"
                    @click="toggleLearningTarget(section.code, target.code)"
                  >
                    {{ target.label }}
                  </button>
                </div>
              </header>
              <TransitionGroup name="teacher-list" tag="div" class="grid-2 list">
                <TeacherTelegramCard
                  v-for="teacher in sortedTeachersFor(section)"
                  :key="teacher.teacherKey || teacher.slug"
                  :teacher="teacher"
                  :highlighted="isTeacherHighlighted(section, teacher)"
                  @choose="close"
                />
              </TransitionGroup>
            </section>
          </div>

          <p v-else class="muted empty">{{ t('teachers.empty') }}</p>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import TeacherTelegramCard from './TeacherTelegramCard.vue';
import { teachers } from '../data/teachers.js';
import { useI18n } from '../i18n.js';
import { useTeacherLearningTargetSort } from '../lib/teacherLearningTargetSort.js';
import { useTeacherSections } from '../lib/teacherSections.js';

const props = defineProps({
  open: {
    type: Boolean,
    default: false
  }
});

const emit = defineEmits(['update:open']);

const { t, locale } = useI18n();
const { sections } = useTeacherSections(teachers, locale, t);

const titleId = 'try-teacher-title';
const closeBtnRef = ref(null);
const dialogRef = ref(null);
const previousOverflow = ref('');
const { activeLearningCodeFor, toggleLearningTarget, sortedTeachersFor, isTeacherHighlighted, reset } =
  useTeacherLearningTargetSort();

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

watch(
  openState,
  async (isOpen) => {
    if (!import.meta.client) return;
    if (isOpen) {
      lockBodyScroll();
      await nextTick();
      closeBtnRef.value?.focus?.();
      return;
    }
    reset();
    unlockBodyScroll();
  },
  { immediate: true }
);

function onGlobalKeydown(event) {
  if (!openState.value) return;
  if (event.key === 'Escape') close();
}

watch(
  openState,
  (isOpen) => {
    if (!import.meta.client) return;
    if (isOpen) window.addEventListener('keydown', onGlobalKeydown);
    else window.removeEventListener('keydown', onGlobalKeydown);
  },
  { immediate: true }
);

onBeforeUnmount(() => {
  if (!import.meta.client) return;
  window.removeEventListener('keydown', onGlobalKeydown);
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
    color-mix(in srgb, var(--surface) 76%, var(--bg));
  border: 1px solid color-mix(in srgb, #229ed9 22%, var(--border));
  color: color-mix(in srgb, #229ed9 82%, var(--fg));
  box-shadow: 0 10px 22px color-mix(in srgb, #229ed9 18%, transparent);
  flex: none;
}

.icon svg {
  width: 22px;
  height: 22px;
  fill: currentColor;
}

.icon-btn {
  width: 42px;
  height: 42px;
  border-radius: 14px;
  border: 1px solid color-mix(in srgb, var(--fg) 14%, var(--border));
  background: color-mix(in srgb, var(--surface) 60%, var(--bg));
  color: var(--fg);
  font-size: 16px;
  font-weight: 900;
  cursor: pointer;
  box-shadow: 0 1px 0 rgba(0, 0, 0, 0.05);
}

.icon-btn:hover {
  border-color: color-mix(in srgb, var(--fg) 22%, var(--border));
}

.dialog-body {
  padding: 16px 16px 18px;
  overflow: auto;
  max-height: calc(min(86vh, 920px) - 72px);
}

.empty {
  margin: 0;
  padding: 12px 6px;
}

.sections {
  display: grid;
  gap: 16px;
}

.teachers-section {
  display: grid;
  gap: 18px;
  padding: 16px 16px 18px;
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background:
    linear-gradient(180deg, color-mix(in srgb, var(--surface) 34%, var(--bg)), var(--bg));
}

.teachers-section.primary {
  border-color: color-mix(in srgb, #229ed9 35%, var(--border));
  background:
    linear-gradient(
      180deg,
      color-mix(in srgb, #229ed9 10%, var(--surface)),
      color-mix(in srgb, #229ed9 4%, var(--bg))
    );
}

.section-head {
  display: grid;
  gap: 10px;
}

.section-title {
  margin: 0;
  font-size: clamp(20px, 2vw, 26px);
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
  appearance: none;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border-radius: 999px;
  border: 1px solid color-mix(in srgb, var(--fg) 14%, var(--border));
  background: color-mix(in srgb, var(--surface) 74%, var(--bg));
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.01em;
  cursor: pointer;
  user-select: none;
}

.section-language-pill:hover {
  border-color: color-mix(in srgb, var(--fg) 22%, var(--border));
}

.section-language-pill:focus-visible {
  outline: 2px solid color-mix(in srgb, #229ed9 55%, transparent);
  outline-offset: 2px;
}

.section-language-pill.active {
  border-color: color-mix(in srgb, #229ed9 45%, var(--border));
  background:
    radial-gradient(120% 140% at 10% 10%, color-mix(in srgb, #229ed9 14%, transparent), transparent 55%),
    color-mix(in srgb, var(--surface) 74%, var(--bg));
  color: color-mix(in srgb, #229ed9 85%, var(--fg));
}

.teacher-list-move {
  transition: transform 260ms cubic-bezier(0.2, 0.8, 0.2, 1);
}

.teacher-list-enter-active,
.teacher-list-leave-active {
  transition: opacity 140ms ease;
}

.teacher-list-enter-from,
.teacher-list-leave-to {
  opacity: 0;
}

@media (prefers-reduced-motion: reduce) {
  .overlay {
    backdrop-filter: none;
  }

  .teacher-list-move,
  .teacher-list-enter-active,
  .teacher-list-leave-active {
    transition: none;
  }
}
</style>
