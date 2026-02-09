<template>
  <section class="page">
    <div class="container">
      <div v-if="teacher" class="card profile">
        <div class="avatar">
          <img
            v-if="teacher.photoUrl"
            class="avatar-img"
            :src="teacher.photoUrl"
            :alt="teacher.name"
            loading="lazy"
            decoding="async"
          />
          <span v-else class="avatar-letter" aria-hidden="true">{{ letter }}</span>
        </div>

        <div class="main">
          <h1 class="h2">{{ teacher.name }}</h1>
          <div class="muted meta">
            {{ teacher.languages.join(' • ') }}<span v-if="teacher.tagline"> • {{ teacher.tagline }}</span>
          </div>

          <p class="bio">{{ teacher.bio }}</p>

          <div class="details">
            <div class="detail">
              <div class="muted label">Focus</div>
              <div class="value">{{ teacher.focus }}</div>
            </div>
          </div>

          <div class="actions">
            <a
              v-if="telegramUrl"
              class="btn primary"
              :href="telegramUrl"
              target="_blank"
              rel="noreferrer"
            >
              Open in Telegram
            </a>
            <RouterLink class="btn" to="/teachers">Back to teachers</RouterLink>
          </div>
        </div>
      </div>

      <div v-else class="card">
        <h1 class="h2">Teacher not found</h1>
        <p class="muted">Try the teachers list.</p>
        <RouterLink class="btn" to="/teachers">Teachers</RouterLink>
      </div>
    </div>
  </section>
</template>

<script setup>
import { computed, onMounted, watch } from 'vue';
import { RouterLink } from 'vue-router';
import { getTeacherBySlug } from '../data/teachers.js';
import { getTeacherTelegramUrl } from '../lib/telegram.js';

const props = defineProps({
  slug: { type: String, required: true }
});

const teacher = computed(() => getTeacherBySlug(props.slug));
const letter = computed(() => (teacher.value?.name || '?').toString().trim().slice(0, 1).toUpperCase());
const telegramUrl = computed(() => getTeacherTelegramUrl(teacher.value));

function syncTitle() {
  const base = 'AI Language School';
  document.title = teacher.value ? `${teacher.value.name} — ${base}` : `Teacher — ${base}`;
}

onMounted(syncTitle);
watch(teacher, syncTitle);
</script>

<style scoped>
.page {
  padding: 56px 0;
}

.profile {
  display: grid;
  grid-template-columns: 72px 1fr;
  gap: 18px;
  align-items: start;
}

.avatar {
  width: 72px;
  height: 72px;
  border-radius: 999px;
  background: var(--surface);
  border: 1px solid var(--border);
  display: grid;
  place-items: center;
  overflow: hidden;
}

.avatar-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}

.avatar-letter {
  font-family: Outfit, Inter, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif;
  font-weight: 900;
  font-size: 22px;
}

.meta {
  margin-top: 6px;
}

.bio {
  margin: 14px 0 0;
  line-height: 1.65;
}

.details {
  margin-top: 18px;
  display: grid;
  gap: 10px;
}

.detail .label {
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.02em;
  text-transform: uppercase;
}

.detail .value {
  margin-top: 4px;
  font-weight: 600;
}

.actions {
  margin-top: 20px;
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

@media (min-width: 860px) {
  .profile {
    grid-template-columns: 96px 1fr;
  }
  .avatar {
    width: 96px;
    height: 96px;
  }
  .avatar-letter {
    font-size: 28px;
  }
}
</style>
