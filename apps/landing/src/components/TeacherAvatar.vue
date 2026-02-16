<template>
  <div class="avatar" :style="sizeStyle">
    <picture v-if="showImage" class="avatar-picture">
      <source
        v-if="teacher.avatarSources?.avif"
        :srcset="teacher.avatarSources.avif"
        type="image/avif"
      />
      <source
        v-if="teacher.avatarSources?.webp"
        :srcset="teacher.avatarSources.webp"
        type="image/webp"
      />
      <img
        class="avatar-img"
        :src="teacher.avatarImage"
        :alt="alt"
        :loading="loading"
        :fetchpriority="fetchpriority"
        :decoding="decoding"
        :width="size"
        :height="size"
        @error="onImgError"
      />
    </picture>
    <span v-else-if="teacher.avatarEmoji" class="avatar-emoji" aria-hidden="true">{{ teacher.avatarEmoji }}</span>
    <span v-else class="avatar-letter" aria-hidden="true">{{ letter }}</span>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue';

const props = defineProps({
  teacher: { type: Object, required: true },
  name: { type: String, default: '' },
  size: { type: Number, default: 56 },
  loading: { type: String, default: 'lazy' },
  fetchpriority: { type: String, default: 'auto' },
  decoding: { type: String, default: 'async' }
});

const imgBroken = ref(false);
const showImage = computed(() => !!props.teacher?.avatarImage && !imgBroken.value);
const letter = computed(() => (props.name || '?').toString().trim().slice(0, 1).toUpperCase());
const alt = computed(() => (props.name || '').toString().trim() || 'Teacher');
const sizeStyle = computed(() => ({
  width: `${props.size}px`,
  height: `${props.size}px`
}));

function onImgError() {
  imgBroken.value = true;
}
</script>

<style scoped>
.avatar {
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

.avatar-picture {
  width: 100%;
  height: 100%;
  display: block;
}

.avatar-emoji {
  font-size: 24px;
  line-height: 1;
}

.avatar-letter {
  font-family: Outfit, Inter, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif;
  font-weight: 900;
  font-size: 18px;
}
</style>
