<template>
  <section class="page">
    <div class="container">
      <article v-if="practicePath && content" class="profile-page">
        <header class="card hero">
          <div class="hero-top">
            <RomiAvatar :practice-path="practicePath" :size="96" loading="eager" fetchpriority="high" :alt="heroAlt" />

            <div class="hero-meta">
              <p class="hero-kicker">{{ t('nav.practice') }}</p>
              <h1 class="h1 hero-title">{{ content.title }}</h1>
              <p class="muted hero-lead">{{ content.heroLead }}</p>
              <p class="muted hero-outcome">{{ content.heroOutcome }}</p>
            </div>
          </div>

          <ul class="hero-bullets">
            <li v-for="bullet in content.coreBullets" :key="bullet">{{ bullet }}</li>
          </ul>

          <div class="actions">
            <a v-if="telegramUrl" class="btn primary telegram-btn" :href="telegramUrl" target="_blank" rel="noreferrer">
              <span>{{ t('practice.cardCta') }}</span>
            </a>
          </div>
        </header>

        <section class="card section" aria-labelledby="how-title">
          <h2 id="how-title" class="h2">{{ content.howTitle }}</h2>
          <div class="steps-grid">
            <article v-for="step in content.howSteps" :key="step.title" class="step-item">
              <h3 class="h3">{{ step.title }}</h3>
              <p class="muted">{{ step.description }}</p>
            </article>
          </div>
        </section>

        <section class="card section" aria-labelledby="for-who-title">
          <h2 id="for-who-title" class="h2">{{ content.forWhoTitle }}</h2>
          <p class="muted section-intro">{{ content.forWhoIntro }}</p>
          <div class="for-who-grid">
            <article v-for="item in content.forWhoItems" :key="item.title" class="focus-item">
              <h3 class="h3">{{ item.title }}</h3>
              <p class="muted">{{ item.description }}</p>
            </article>
          </div>
        </section>

        <section class="card section" aria-labelledby="dialogues-title">
          <h2 id="dialogues-title" class="h2">{{ content.dialoguesTitle }}</h2>
          <p class="muted section-intro">{{ content.dialoguesIntro }}</p>
          <div class="dialogues-grid">
            <ChatConversationDemo scenario-id="jobInterview" :base-locale="practicePath.baseLanguage" :target-by-base-locale="chatTargetByBaseLocale" />
          </div>
        </section>

        <section class="card section" aria-labelledby="deep-dive-title">
          <h2 id="deep-dive-title" class="h2">{{ content.deepDiveTitle }}</h2>
          <div class="deep-dive">
            <p v-for="paragraph in content.deepDiveParagraphs" :key="paragraph" class="muted deep-paragraph">{{ paragraph }}</p>
          </div>
        </section>

        <section class="card section" aria-labelledby="faq-title">
          <h2 id="faq-title" class="h2">{{ content.faqTitle }}</h2>
          <div class="faq-list">
            <article v-for="item in content.faqItems" :key="item.question" class="faq-item">
              <h3 class="h3 faq-question">{{ item.question }}</h3>
              <p class="muted faq-answer">{{ item.answer }}</p>
            </article>
          </div>
        </section>

        <section class="card section" aria-labelledby="related-title">
          <h2 id="related-title" class="h2">{{ content.relatedTitle }}</h2>
          <div class="grid-2">
            <PracticePathCard v-for="row in relatedPracticePaths" :key="row.slug" :practice-path="row" />
          </div>
        </section>
      </article>

      <div v-else class="card">
        <h2 class="h2">{{ t('notFound.title') }}</h2>
        <p class="muted">{{ t('notFound.desc') }}</p>
        <RouterLink class="btn" :to="routeWithLocale('practice')">{{ t('nav.practice') }}</RouterLink>
      </div>
    </div>
  </section>
</template>

<script setup>
import { computed } from 'vue';
import { RouterLink } from 'vue-router';
import ChatConversationDemo from '../components/ChatConversationDemo.vue';
import PracticePathCard from '../components/PracticePathCard.vue';
import RomiAvatar from '../components/RomiAvatar.vue';
import { getAlternatePracticePaths } from '../data/practicePathSlugs.js';
import { getPracticePathSeoContent } from '../data/seoPracticePathContent.js';
import { getLandingStartPayload, getPracticePathTelegramUrl } from '../lib/telegram.js';
import { routeWithLocale, supportedLocales, useI18n } from '../i18n.js';

const props = defineProps({
  practicePath: {
    type: Object,
    default: null
  }
});

const { t, locale } = useI18n();
const route = useRoute();

const content = computed(() => getPracticePathSeoContent(props.practicePath, locale.value, t));
const startPayload = computed(() => getLandingStartPayload(route.query));
const telegramUrl = computed(() => getPracticePathTelegramUrl(props.practicePath, startPayload.value));
const relatedPracticePaths = computed(() => getAlternatePracticePaths(props.practicePath).slice(0, 4));
const chatTargetByBaseLocale = computed(() => supportedLocales.reduce((acc, localeCode) => {
  acc[localeCode] = props.practicePath?.targetLanguage || 'en';
  return acc;
}, {}));
const heroAlt = computed(() => props.practicePath ? `Romi for ${content.value?.title || 'practice path'}` : 'Romi');
</script>

<style scoped>
.page {
  padding: 54px 0 84px;
}

.profile-page {
  display: grid;
  gap: 26px;
}

.hero {
  display: grid;
  gap: 24px;
  padding: clamp(20px, 2vw, 30px);
  background:
    radial-gradient(130% 160% at 0% 0%, color-mix(in srgb, #229ed9 18%, var(--surface)), transparent 58%),
    radial-gradient(130% 140% at 100% 6%, color-mix(in srgb, #1d4ed8 11%, var(--surface)), transparent 52%),
    var(--bg);
}

.hero-top {
  display: grid;
  gap: 20px;
  align-items: start;
}

.hero-kicker {
  margin: 0 0 8px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--muted);
}

.hero-title {
  font-size: clamp(30px, 4.2vw, 54px);
  line-height: 1.1;
}

.hero-lead,
.hero-outcome {
  margin-top: 10px;
  font-size: clamp(16px, 1.45vw, 19px);
  line-height: 1.72;
}

.hero-bullets {
  margin: 0;
  padding-left: 20px;
  display: grid;
  gap: 10px;
  line-height: 1.6;
}

.section {
  padding: clamp(20px, 2vw, 28px);
}

.steps-grid,
.for-who-grid,
.faq-list {
  display: grid;
  gap: 18px;
}

.dialogues-grid,
.deep-dive {
  margin-top: 12px;
}

.section-intro,
.deep-paragraph {
  line-height: 1.7;
}
</style>
