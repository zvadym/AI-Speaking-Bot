<template>
  <div class="avatar-wrap" :style="sizeStyle">
    <div class="avatar">
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

    <span
      v-if="languageBadge"
      class="lang-badge"
      :style="languageBadgeStyle"
      role="img"
      :aria-label="languageBadge.ariaLabel"
      :title="languageBadge.ariaLabel"
    >
      {{ languageBadge.text }}
    </span>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue';
import { useI18n } from '../i18n.js';

const props = defineProps({
  teacher: { type: Object, required: true },
  name: { type: String, default: '' },
  size: { type: Number, default: 56 },
  loading: { type: String, default: 'lazy' },
  fetchpriority: { type: String, default: 'auto' },
  decoding: { type: String, default: 'async' }
});

const { t } = useI18n();

const imgBroken = ref(false);
const showImage = computed(() => !!props.teacher?.avatarImage && !imgBroken.value);
const letter = computed(() => (props.name || '?').toString().trim().slice(0, 1).toUpperCase());
const alt = computed(() => (props.name || '').toString().trim() || 'Teacher');
const sizeStyle = computed(() => ({
  width: `${props.size}px`,
  height: `${props.size}px`
}));

function getLanguageFlag(languageCode) {
  const code = (languageCode || '').toString().trim().toLowerCase();
  const flagsByLanguage = {
    ar: '🇸🇦',
    de: '🇩🇪',
    en: '🇬🇧',
    es: '🇪🇸',
    fr: '🇫🇷',
    hi: '🇮🇳',
    id: '🇮🇩',
    it: '🇮🇹',
    pl: '🇵🇱',
    pt: '🇵🇹',
    ru: '🇷🇺',
    tr: '🇹🇷',
    ua: '🇺🇦',
    uk: '🇺🇦'
  };
  return flagsByLanguage[code] || '🏳️';
}

const learningLanguage = computed(() => (props.teacher?.learningLanguage || '').toString().trim().toLowerCase());

const languageBadge = computed(() => {
  const code = learningLanguage.value;
  if (!code) return null;

  const ariaLabel = t(`languageName.${code}`);
  const label = ariaLabel && ariaLabel !== `languageName.${code}` ? ariaLabel : code.toUpperCase();
  return {
    text: getLanguageFlag(code),
    ariaLabel: label
  };
});

const languageBadgeSize = computed(() => {
  const size = Number(props.size) || 56;
  const baseSize = Math.round(Math.min(56, Math.max(36, size * 0.66)));
  return Math.max(24, Math.round(baseSize * 0.85));
});

const languageBadgeStyle = computed(() => {
  if (!languageBadge.value) return {};
  const size = languageBadgeSize.value;
  const fontSize = Math.max(11, Math.round(size * 0.64));

  return {
    width: `${size}px`,
    height: `${size}px`,
    fontSize: `${fontSize}px`
  };
});

function onImgError() {
  imgBroken.value = true;
}
</script>

<style scoped>
.avatar-wrap {
  position: relative;
  display: grid;
  place-items: center;
}

.avatar {
  width: 100%;
  height: 100%;
  border-radius: 999px;
  background: var(--surface);
  border: 1px solid var(--border);
  display: grid;
  place-items: center;
  overflow: hidden;
}

.lang-badge {
  position: absolute;
  right: -6px;
  bottom: -6px;
  border-radius: 999px;
  display: grid;
  place-items: center;
  font-weight: 900;
  line-height: 1;
  letter-spacing: 0;
  user-select: none;
  background: var(--bg);
  border: 2px solid var(--bg);
  box-shadow:
    0 10px 18px color-mix(in srgb, var(--fg) 14%, transparent),
    0 0 0 1px color-mix(in srgb, var(--fg) 12%, transparent);
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
