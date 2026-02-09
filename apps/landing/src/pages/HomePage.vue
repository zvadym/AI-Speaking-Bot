<template>
  <div>
    <section class="hero">
      <div class="container hero-inner">
        <div class="badge">Voice-first language practice</div>

        <h1 class="h1">Learn by speaking.</h1>
        <p class="muted hero-sub">
          Choose a teacher bot, send voice messages, get instant corrections and better phrasing — every day.
        </p>

        <div class="hero-actions">
          <a
            v-if="telegramUrl"
            class="btn primary"
            :href="telegramUrl"
            target="_blank"
            rel="noreferrer"
          >
            Start in Telegram
          </a>
          <RouterLink v-else class="btn primary" to="/teachers">Start</RouterLink>

          <RouterLink class="btn" to="/teachers">Meet the teachers</RouterLink>
        </div>

        <div class="shot card muted">Screenshot placeholder</div>
      </div>
    </section>

    <section class="section">
      <div class="container section-head">
        <div>
          <h2 class="h2">Teachers</h2>
          <p class="muted">Each teacher is a Telegram bot with their own tone, languages, and focus.</p>
        </div>
        <RouterLink class="btn" to="/teachers">All teachers</RouterLink>
      </div>

      <div class="container grid-2">
        <TeacherCard v-for="t in previewTeachers" :key="t.slug" :teacher="t" />
      </div>
    </section>

    <section class="section">
      <div class="container">
        <h2 class="h2">How it works</h2>
        <div class="grid-3 steps">
          <div class="card">
            <div class="step-num">1</div>
            <div class="h3">Pick a teacher</div>
            <div class="muted">Choose a teacher bot that matches your level and vibe.</div>
          </div>
          <div class="card">
            <div class="step-num">2</div>
            <div class="h3">Send a voice message</div>
            <div class="muted">Speak naturally — the teacher will transcribe and correct you.</div>
          </div>
          <div class="card">
            <div class="step-num">3</div>
            <div class="h3">Improve daily</div>
            <div class="muted">Save corrections, learn patterns, and build a real speaking habit.</div>
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
import { getDefaultTelegramBotUrl } from '../lib/telegram.js';

const telegramUrl = computed(() => getDefaultTelegramBotUrl());
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

