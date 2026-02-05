<template>
  <div class="shell fade-in">
    <header class="hero">
      <div class="kicker">{{ $t('home.kicker') }}</div>
      <h1>
        {{ greeting }}
      </h1>
      <p class="sub">
        {{ $t('home.sub') }}
      </p>

      <div class="chips">
        <button class="chip" v-if="me" @click="$emit('navigate', '/language')">
          🌍 {{ languageLabel }}
        </button>
        <button class="chip" v-if="me" @click="$emit('navigate', '/level')">
          🎯 {{ levelLabel }}
        </button>

        <div
          v-if="showUiLocaleSwitcher"
          class="locale-switch"
          role="group"
          :aria-label="$t('home.uiLanguage')"
        >
          <span class="locale-label">🌐 {{ $t('home.uiLanguage') }}</span>
          <button
            class="locale-btn"
            type="button"
            :class="{ active: locale === 'uk' }"
            @click="setUiLocale('uk')"
          >
            UA
          </button>
          <button
            class="locale-btn"
            type="button"
            :class="{ active: locale === 'en' }"
            @click="setUiLocale('en')"
          >
            EN
          </button>
        </div>
      </div>
    </header>

    <section class="menu">
      <button class="menu-card featured" @click="$emit('navigate', '/subscription')">
        <div class="left">
          <div class="emoji">⭐</div>
        </div>
        <div class="mid">
          <div class="title-row">
            <span class="title">{{ $t('home.menu.subscription.title') }}</span>
            <span class="pill" v-if="me">{{ planLabel }}</span>
          </div>
          <p class="desc">{{ $t('home.menu.subscription.desc') }}</p>
        </div>
        <div class="right" aria-hidden="true">
          <span class="arrow">→</span>
        </div>
      </button>

      <button class="menu-card" @click="$emit('navigate', '/language')">
        <div class="left">
          <div class="emoji">🌍</div>
        </div>
        <div class="mid">
          <div class="title-row">
            <span class="title">{{ $t('home.menu.language.title') }}</span>
            <span class="meta" v-if="me">{{ languageLabel }}</span>
          </div>
          <p class="desc">{{ $t('home.menu.language.desc') }}</p>
        </div>
        <div class="right" aria-hidden="true"><span class="arrow">→</span></div>
      </button>

      <button class="menu-card" @click="$emit('navigate', '/level')">
        <div class="left">
          <div class="emoji">🎯</div>
        </div>
        <div class="mid">
          <div class="title-row">
            <span class="title">{{ $t('home.menu.level.title') }}</span>
            <span class="meta" v-if="me">{{ levelLabel }}</span>
          </div>
          <p class="desc">{{ $t('home.menu.level.desc') }}</p>
        </div>
        <div class="right" aria-hidden="true"><span class="arrow">→</span></div>
      </button>

      <button class="menu-card" @click="$emit('navigate', '/about')">
        <div class="left">
          <div class="emoji">ℹ️</div>
        </div>
        <div class="mid">
          <div class="title-row">
            <span class="title">{{ $t('home.menu.about.title') }}</span>
          </div>
          <p class="desc">{{ $t('home.menu.about.desc') }}</p>
        </div>
        <div class="right" aria-hidden="true"><span class="arrow">→</span></div>
      </button>
    </section>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import { useI18n } from '../i18n.js';
import { setAppLocale } from '../i18n.js';

const props = defineProps({
  me: { type: Object, default: null }
});

defineEmits(['navigate']);

const { t, locale } = useI18n({ useScope: 'global' });
const showUiLocaleSwitcher = false;

function setUiLocale(nextLocale) {
  setAppLocale(nextLocale);
}

const greeting = computed(() => {
  const name = props.me?.first_name?.trim();
  return name ? t('home.greeting.named', { name }) : t('home.greeting.anon');
});

const languageLabel = computed(() => {
  const code = (props.me?.target_lang || 'en').toLowerCase();
  if (code === 'de') return t('practiceLanguages.de');
  return t('practiceLanguages.en');
});

const levelLabel = computed(() => {
  const level = (props.me?.level || 'b1').toString().toUpperCase();
  return level;
});

const planLabel = computed(() => {
  const tier = (props.me?.plan_tier || 'free').toString().toLowerCase();
  if (tier !== 'pro' && tier !== 'plus' && tier !== 'free') return t('plans.tiers.free');
  return t(`plans.tiers.${tier}`);
});
</script>

<style scoped>
.shell {
  width: min(900px, 100%);
  padding: 44px 22px 76px;
  display: grid;
  gap: 24px;
}

.hero {
  display: grid;
  gap: 10px;
}

.kicker {
  text-transform: uppercase;
  letter-spacing: 0.26em;
  font-size: 11px;
  color: var(--accent-2);
}

.hero h1 {
  font-family: var(--font-display);
  margin: 0;
  font-size: clamp(30px, 5vw, 52px);
  letter-spacing: -0.02em;
  line-height: 1;
}

.sub {
  margin: 0;
  max-width: 62ch;
  color: var(--muted);
  font-size: 16px;
  line-height: 1.6;
}

.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 6px;
}

.chip {
  border: 1px solid var(--stroke);
  background: rgba(255, 255, 255, 0.55);
  box-shadow: 0 14px 30px var(--shadow);
  border-radius: 999px;
  padding: 10px 14px;
  cursor: pointer;
  font-weight: 600;
  letter-spacing: 0.01em;
  color: var(--ink);
  transition: transform 120ms ease, box-shadow 120ms ease;
}

.chip:active {
  transform: translateY(1px);
  box-shadow: 0 10px 22px var(--shadow);
}

.locale-switch {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  border: 1px solid var(--stroke);
  background: rgba(255, 255, 255, 0.55);
  box-shadow: 0 14px 30px var(--shadow);
  border-radius: 999px;
  padding: 7px 8px 7px 12px;
}

.locale-label {
  font-weight: 650;
  letter-spacing: 0.01em;
  color: var(--ink);
  white-space: nowrap;
}

.locale-btn {
  border: 1px solid rgba(30, 26, 22, 0.14);
  background: rgba(255, 255, 255, 0.35);
  border-radius: 999px;
  padding: 7px 10px;
  cursor: pointer;
  font-weight: 800;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--ink);
  opacity: 0.82;
  transition: transform 120ms ease, background 120ms ease, opacity 120ms ease;
}

.locale-btn.active {
  background: rgba(31, 107, 99, 0.18);
  border-color: rgba(31, 107, 99, 0.32);
  opacity: 1;
}

.locale-btn:active {
  transform: translateY(1px);
}

.menu {
  display: grid;
  gap: 14px;
}

.menu-card {
  width: 100%;
  display: grid;
  grid-template-columns: auto 1fr auto;
  gap: 14px;
  align-items: center;
  text-align: left;
  padding: 18px 18px;
  border-radius: 20px;
  border: 1px solid var(--stroke);
  background: rgba(255, 255, 255, 0.65);
  box-shadow: 0 18px 45px var(--shadow);
  cursor: pointer;
  transition: transform 120ms ease, box-shadow 120ms ease, border-color 120ms ease;
}

.menu-card.featured {
  padding: 28px 18px;
  border-color: rgba(199, 90, 36, 0.25);
  background:
    radial-gradient(130% 140% at 10% 0%, rgba(199, 90, 36, 0.18), transparent 50%),
    radial-gradient(120% 160% at 110% 10%, rgba(31, 107, 99, 0.2), transparent 55%),
    rgba(255, 255, 255, 0.65);
}

.menu-card.featured .emoji {
  width: 50px;
  height: 50px;
  font-size: 24px;
}

.menu-card.featured .title {
  font-size: 19px;
}

.menu-card:active {
  transform: translateY(2px);
  box-shadow: 0 12px 30px var(--shadow);
}

.emoji {
  width: 44px;
  height: 44px;
  border-radius: 14px;
  display: grid;
  place-items: center;
  font-size: 22px;
  background: rgba(255, 255, 255, 0.55);
  border: 1px solid rgba(30, 26, 22, 0.08);
}

.title-row {
  display: flex;
  gap: 10px;
  align-items: baseline;
  flex-wrap: wrap;
}

.title {
  font-weight: 800;
  letter-spacing: -0.01em;
  font-size: 18px;
}

.desc {
  margin: 6px 0 0;
  color: var(--muted);
  line-height: 1.5;
  font-size: 14px;
  max-width: 62ch;
}

.pill,
.meta {
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--ink);
  opacity: 0.75;
}

.pill {
  padding: 6px 10px;
  border-radius: 999px;
  border: 1px solid rgba(30, 26, 22, 0.12);
  background: rgba(255, 255, 255, 0.45);
}

.arrow {
  font-size: 18px;
  opacity: 0.65;
}

@media (max-width: 440px) {
  .menu-card {
    padding: 16px 16px;
  }
  .menu-card.featured {
    padding: 26px 16px;
  }
}
</style>
