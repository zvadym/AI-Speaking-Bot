<template>
  <a
    :class="['practice-card', { highlighted }]"
    :href="telegramUrl"
    target="_blank"
    rel="noreferrer"
    :aria-label="ariaLabel"
    @click="emit('choose')"
  >
    <div class="practice-card-core">
      <div class="flag-badge" :aria-label="title">{{ flag }}</div>

      <div class="info">
        <div class="title-row">
          <div class="h3 title">{{ title }}</div>
          <span class="tg-pill">
            <span class="telegram-mark" aria-hidden="true">
              <svg viewBox="0 0 24 24" focusable="false">
                <path d="M20.66 4.21a2.05 2.05 0 0 0-2.08-.24L3.61 10.3a1.17 1.17 0 0 0 .09 2.18l3.08 1.06 1.16 4.38a1.19 1.19 0 0 0 2.02.51l2.2-2.26 4.24 3.14a1.77 1.77 0 0 0 2.78-1.01l2.46-12.3a2.05 2.05 0 0 0-.98-1.79Z" />
                <path d="m8.01 13.14 8.99-5.49a.45.45 0 0 1 .57.67l-7.39 7.36-.47 2.34-.95-3.55a1.46 1.46 0 0 1-.75-1.33Z" />
              </svg>
            </span>
            <span>{{ t('practice.cardCta') }}</span>
          </span>
        </div>
      </div>
    </div>
  </a>
</template>

<script setup>
import { computed } from 'vue';
import { getLandingStartPayload, getPracticePathTelegramUrl } from '../lib/telegram.js';
import { useI18n } from '../i18n.js';

const props = defineProps({
  practicePath: { type: Object, required: true },
  highlighted: { type: Boolean, default: false }
});

const emit = defineEmits(['choose']);
const route = useRoute();
const { t } = useI18n();

const title = computed(() => t(`languageName.${props.practicePath.targetLanguage}`));
const startPayload = computed(() => getLandingStartPayload(route.query));
const telegramUrl = computed(() => getPracticePathTelegramUrl(props.practicePath, startPayload.value));
const ariaLabel = computed(() => `${t('practice.cardCta')}: ${title.value}`);
const flag = computed(() => {
  const code = (props.practicePath?.targetLanguage || '').toString().trim().toLowerCase();
  const flagsByLanguage = {
    ar: '🇸🇦', de: '🇩🇪', en: '🇬🇧', es: '🇪🇸', fr: '🇫🇷', hi: '🇮🇳', id: '🇮🇩',
    it: '🇮🇹', pl: '🇵🇱', pt: '🇵🇹', ru: '🇷🇺', tr: '🇹🇷', ua: '🇺🇦', uk: '🇺🇦'
  };
  return flagsByLanguage[code] || '🏳️';
});
</script>

<style scoped>
.practice-card {
  display: block;
  padding: 6px;
  border: 1px solid color-mix(in srgb, var(--border) 72%, transparent);
  border-radius: var(--radius-xl);
  background:
    linear-gradient(145deg, rgba(255, 255, 255, 0.78), rgba(255, 255, 255, 0.30)),
    color-mix(in srgb, var(--surface) 70%, var(--bg));
  box-shadow:
    var(--shadow),
    inset 0 1px 0 rgba(255, 255, 255, 0.78);
  transition:
    transform 620ms var(--motion-spring),
    border-color 620ms var(--motion-spring),
    box-shadow 620ms var(--motion-spring);
}

.practice-card-core {
  display: grid;
  grid-template-columns: 52px 1fr;
  gap: 12px 16px;
  align-items: center;
  padding: 18px;
  border-radius: calc(var(--radius-xl) - 8px);
  background:
    linear-gradient(135deg, rgba(34, 158, 217, 0.07), transparent 44%),
    color-mix(in srgb, var(--surface) 58%, var(--bg));
  box-shadow: inset 0 1px 1px rgba(255, 255, 255, 0.82);
}

.practice-card.highlighted {
  border-color: color-mix(in srgb, #229ed9 42%, var(--border));
  box-shadow:
    0 18px 42px color-mix(in srgb, #229ed9 18%, transparent),
    0 0 0 1px color-mix(in srgb, #229ed9 20%, transparent);
}

.practice-card:hover {
  text-decoration: none;
  transform: translateY(-4px);
  border-color: color-mix(in srgb, #229ed9 35%, var(--border));
  box-shadow: 0 18px 42px color-mix(in srgb, #229ed9 18%, transparent);
}

.info {
  min-width: 0;
}

.flag-badge {
  width: 52px;
  height: 52px;
  display: grid;
  place-items: center;
  border-radius: 16px;
  background: color-mix(in srgb, var(--surface) 78%, var(--bg));
  border: 1px solid color-mix(in srgb, var(--fg) 12%, var(--border));
  box-shadow: 0 10px 24px color-mix(in srgb, var(--fg) 10%, transparent);
  font-size: 28px;
}

.title-row {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.title {
  margin: 0;
}

.tg-pill {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 800;
  letter-spacing: 0.01em;
  color: color-mix(in srgb, #229ed9 82%, var(--fg));
  background:
    radial-gradient(120% 140% at 10% 10%, color-mix(in srgb, #229ed9 18%, transparent), transparent 55%),
    color-mix(in srgb, var(--surface) 78%, var(--bg));
  border: 1px solid color-mix(in srgb, #229ed9 28%, var(--border));
}

.telegram-mark {
  width: 18px;
  height: 18px;
  display: grid;
  place-items: center;
}

.telegram-mark svg {
  width: 18px;
  height: 18px;
  fill: currentColor;
}
</style>
