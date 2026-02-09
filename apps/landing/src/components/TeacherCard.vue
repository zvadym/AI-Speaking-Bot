<template>
  <article class="card teacher-card">
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

    <div class="info">
      <div class="h3 name">{{ teacher.name }}</div>
      <div class="muted meta">
        <span>{{ teacher.languages.join(' • ') }}</span>
        <span v-if="teacher.tagline"> • {{ teacher.tagline }}</span>
      </div>
    </div>

    <div class="actions">
      <RouterLink class="btn" :to="`/teachers/${teacher.slug}`">View profile</RouterLink>
      <a
        v-if="telegramUrl"
        class="btn primary"
        :href="telegramUrl"
        target="_blank"
        rel="noreferrer"
      >
        Open in Telegram
      </a>
    </div>
  </article>
</template>

<script setup>
import { computed } from 'vue';
import { RouterLink } from 'vue-router';
import { getTeacherTelegramUrl } from '../lib/telegram.js';

const props = defineProps({
  teacher: {
    type: Object,
    required: true
  }
});

const letter = computed(() => (props.teacher?.name || '?').toString().trim().slice(0, 1).toUpperCase());
const telegramUrl = computed(() => getTeacherTelegramUrl(props.teacher));
</script>

<style scoped>
.teacher-card {
  display: grid;
  grid-template-columns: 56px 1fr;
  gap: 14px 16px;
  align-items: start;
}

.avatar {
  width: 56px;
  height: 56px;
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
}

.info {
  min-width: 0;
}

.name {
  margin: 0;
}

.meta {
  margin-top: 4px;
  font-size: 14px;
}

.actions {
  grid-column: 1 / -1;
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}
</style>
