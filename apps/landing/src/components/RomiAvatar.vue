<template>
  <div class="avatar-wrap" :style="sizeStyle">
    <div class="avatar">
      <picture class="avatar-picture">
        <source v-if="srcAvif" :srcset="srcAvif" type="image/avif" />
        <source v-if="srcWebp" :srcset="srcWebp" type="image/webp" />
        <img
          class="avatar-img"
          :src="src"
          :alt="alt"
          :loading="loading"
          :fetchpriority="fetchpriority"
          :decoding="decoding"
          :width="size"
          :height="size"
        />
      </picture>
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
import { computed } from 'vue';
import { useI18n } from '../i18n.js';

const props = defineProps({
  practicePath: { type: Object, default: null },
  size: { type: Number, default: 56 },
  loading: { type: String, default: 'lazy' },
  fetchpriority: { type: String, default: 'auto' },
  decoding: { type: String, default: 'async' },
  alt: { type: String, default: 'Romi' }
});

const { t } = useI18n();

const src = computed(() => props.practicePath?.avatarImage || '/avatar/base.png');
const srcAvif = computed(() => props.practicePath?.avatarSources?.avif || '');
const srcWebp = computed(() => props.practicePath?.avatarSources?.webp || '');
const sizeStyle = computed(() => ({ width: `${props.size}px`, height: `${props.size}px` }));

function getLanguageFlag(languageCode) {
  const code = (languageCode || '').toString().trim().toLowerCase();
  const flagsByLanguage = {
    ar: '🇸🇦', de: '🇩🇪', en: '🇬🇧', es: '🇪🇸', fr: '🇫🇷', hi: '🇮🇳', id: '🇮🇩',
    it: '🇮🇹', pl: '🇵🇱', pt: '🇵🇹', ru: '🇷🇺', tr: '🇹🇷', ua: '🇺🇦', uk: '🇺🇦'
  };
  return flagsByLanguage[code] || '🏳️';
}

const targetLanguage = computed(() => (props.practicePath?.targetLanguage || '').toString().trim().toLowerCase());
const languageBadge = computed(() => {
  const code = targetLanguage.value;
  if (!code) return null;
  const ariaLabel = t(`languageName.${code}`);
  return {
    text: getLanguageFlag(code),
    ariaLabel: ariaLabel && ariaLabel !== `languageName.${code}` ? ariaLabel : code.toUpperCase()
  };
});

const languageBadgeSize = computed(() => {
  const size = Number(props.size) || 56;
  const baseSize = Math.round(Math.min(56, Math.max(36, size * 0.66)));
  return Math.max(24, Math.round(baseSize * 0.85));
});

const languageBadgeStyle = computed(() => {
  if (!languageBadge.value) return {};
  const badgeSize = languageBadgeSize.value;
  const fontSize = Math.max(11, Math.round(badgeSize * 0.64));
  return {
    width: `${badgeSize}px`,
    height: `${badgeSize}px`,
    fontSize: `${fontSize}px`
  };
});
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
  border-radius: 24%;
  background:
    linear-gradient(145deg, rgba(255, 255, 255, 0.62), rgba(255, 255, 255, 0.22)),
    var(--surface);
  border: 1px solid color-mix(in srgb, var(--fg) 10%, var(--border));
  display: grid;
  place-items: center;
  overflow: hidden;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.68);
}

.avatar-picture {
  width: 100%;
  height: 100%;
  display: block;
}

.avatar-img {
  width: 100%;
  height: 100%;
  display: block;
  object-fit: cover;
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
  user-select: none;
  background: var(--bg);
  border: 2px solid var(--bg);
  box-shadow:
    0 10px 18px color-mix(in srgb, var(--fg) 14%, transparent),
    0 0 0 1px color-mix(in srgb, var(--fg) 12%, transparent);
}
</style>
