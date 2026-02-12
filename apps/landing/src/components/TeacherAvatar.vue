<template>
  <div class="avatar" :style="sizeStyle">
    <img
      v-if="showImage"
      class="avatar-img"
      :src="teacher.avatarImage"
      :alt="alt"
      loading="lazy"
      @error="onImgError"
    />
    <span v-else-if="teacher.avatarEmoji" class="avatar-emoji" aria-hidden="true">{{ teacher.avatarEmoji }}</span>
    <span v-else class="avatar-letter" aria-hidden="true">{{ letter }}</span>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue';

const props = defineProps({
  teacher: { type: Object, required: true },
  name: { type: String, default: '' },
  size: { type: Number, default: 56 }
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

