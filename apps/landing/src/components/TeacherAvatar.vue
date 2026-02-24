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

function getLanguageBadgeTheme(languageCode) {
  const code = (languageCode || '').toString().trim().toLowerCase();

  if (code === 'de') {
    return {
      background: 'linear-gradient(to bottom, #000 0 33%, #dd0000 33% 66%, #ffce00 66% 100%)',
      color: '#ffffff'
    };
  }

  if (code === 'it') {
    return {
      background: 'linear-gradient(to right, #009246 0 33%, #ffffff 33% 66%, #ce2b37 66% 100%)',
      color: '#0f172a'
    };
  }

  if (code === 'es') {
    return {
      background: 'linear-gradient(to bottom, #aa151b 0 25%, #f1bf00 25% 75%, #aa151b 75% 100%)',
      color: '#0f172a'
    };
  }

  if (code === 'pt') {
    return {
      background: 'linear-gradient(to right, #006600 0 40%, #ff0000 40% 100%)',
      color: '#ffffff'
    };
  }

  if (code === 'fr') {
    return {
      background: 'linear-gradient(to right, #0055a4 0 33%, #ffffff 33% 66%, #ef4135 66% 100%)',
      color: '#0f172a'
    };
  }

  if (code === 'uk' || code === 'ua') {
    return {
      background: 'linear-gradient(to bottom, #005bbb 0 50%, #ffd500 50% 100%)',
      color: '#0f172a'
    };
  }

  if (code === 'pl') {
    return {
      background: 'linear-gradient(to bottom, #ffffff 0 50%, #dc143c 50% 100%)',
      color: '#0f172a'
    };
  }

  if (code === 'ru') {
    return {
      background: 'linear-gradient(to bottom, #ffffff 0 33%, #0039a6 33% 66%, #d52b1e 66% 100%)',
      color: '#0f172a'
    };
  }

  if (code === 'en') {
    return {
      background: 'linear-gradient(135deg, #1d4ed8 0%, #1d4ed8 50%, #dc2626 50%, #dc2626 100%)',
      color: '#ffffff'
    };
  }

  return {
    background: 'var(--surface)',
    color: 'var(--fg)'
  };
}

const learningLanguage = computed(() => (props.teacher?.learningLanguage || '').toString().trim().toLowerCase());

const languageBadge = computed(() => {
  const code = learningLanguage.value;
  if (!code) return null;

  const ariaLabel = t(`languageName.${code}`);
  const label = ariaLabel && ariaLabel !== `languageName.${code}` ? ariaLabel : code.toUpperCase();
  return {
    text: code.toUpperCase(),
    ariaLabel: label,
    ...getLanguageBadgeTheme(code)
  };
});

const languageBadgeSize = computed(() => {
  const size = Number(props.size) || 56;
  // ~2x previous sizing (keeps it readable at a glance on cards and profile hero)
  return Math.round(Math.min(56, Math.max(36, size * 0.66)));
});

const languageBadgeStyle = computed(() => {
  if (!languageBadge.value) return {};
  const size = languageBadgeSize.value;
  const fontSize = Math.max(11, Math.round(size * 0.34));

  return {
    width: `${size}px`,
    height: `${size}px`,
    fontSize: `${fontSize}px`,
    background: languageBadge.value.background,
    color: languageBadge.value.color
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
  letter-spacing: 0.02em;
  user-select: none;
  border: 2px solid var(--bg);
  box-shadow:
    0 10px 18px color-mix(in srgb, var(--fg) 14%, transparent),
    0 0 0 1px color-mix(in srgb, var(--fg) 12%, transparent);
  text-shadow: 0 1px 1px color-mix(in srgb, #000 40%, transparent);
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
