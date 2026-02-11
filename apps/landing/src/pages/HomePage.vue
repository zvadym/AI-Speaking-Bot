<template>
  <div>
    <section class="hero">
      <div class="container hero-inner">
        <div class="badge">{{ t('home.badge') }}</div>

        <h1 class="h1">{{ t('home.headline') }}</h1>
        <p class="muted hero-sub">
          {{ t('home.subhead') }}
        </p>

        <div class="hero-actions">
          <RouterLink class="btn primary" to="/teachers">{{ t('cta.start') }}</RouterLink>

          <RouterLink class="btn" to="/teachers">{{ t('home.meetTeachers') }}</RouterLink>
        </div>

        <div class="shot card muted">{{ t('home.screenshotPlaceholder') }}</div>
      </div>
    </section>

    <section class="section">
      <div class="container section-head">
        <div>
          <h2 class="h2">{{ t('home.teachersTitle') }}</h2>
          <p class="muted">{{ t('home.teachersDesc') }}</p>
        </div>
        <RouterLink class="btn" to="/teachers">{{ t('cta.allTeachers') }}</RouterLink>
      </div>

      <div class="container grid-2">
        <TeacherCard v-for="t in previewTeachers" :key="t.slug" :teacher="t" />
      </div>
    </section>

    <section class="section">
      <div class="container">
        <h2 class="h2">{{ t('home.howTitle') }}</h2>
        <div class="grid-3 steps">
          <div class="card">
            <div class="step-num">1</div>
            <div class="h3">{{ t('home.steps.oneTitle') }}</div>
            <div class="muted">{{ t('home.steps.oneDesc') }}</div>
          </div>
          <div class="card">
            <div class="step-num">2</div>
            <div class="h3">{{ t('home.steps.twoTitle') }}</div>
            <div class="muted">{{ t('home.steps.twoDesc') }}</div>
          </div>
          <div class="card">
            <div class="step-num">3</div>
            <div class="h3">{{ t('home.steps.threeTitle') }}</div>
            <div class="muted">{{ t('home.steps.threeDesc') }}</div>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import { RouterLink } from 'vue-router';
import TeacherCard from '../components/TeacherCard.vue';
import { teachers } from '../data/teachers.js';
import { useI18n } from '../i18n.js';

const { t } = useI18n();
const previewTeachers = computed(() => teachers.slice(0, 2));
</script>

<style scoped>
.hero {
  padding: 56px 0 18px;
}

.hero-inner {
  display: grid;
  gap: 18px;
}

.hero-sub {
  max-width: 52ch;
  font-size: 18px;
  line-height: 1.6;
}

.hero-actions {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}

.shot {
  height: 280px;
  display: grid;
  place-items: center;
  background: var(--surface);
}

.section {
  padding: 56px 0;
}

.section-head {
  display: flex;
  align-items: end;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 16px;
}

.steps {
  margin-top: 16px;
}

.step-num {
  width: 36px;
  height: 36px;
  border-radius: 999px;
  background: var(--surface);
  border: 1px solid var(--border);
  display: grid;
  place-items: center;
  font-family: Outfit, Inter, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif;
  font-weight: 900;
  margin-bottom: 10px;
}
</style>
