<template>
  <section class="page">
    <div class="container">
      <article v-if="teacher && content" class="profile-page">
        <header class="card hero" id="teacher-hero">
          <div class="hero-top">
            <TeacherAvatar
              :teacher="teacher"
              :name="name"
              :size="96"
              loading="eager"
              fetchpriority="high"
            />

            <div class="hero-meta">
              <p class="hero-kicker">{{ t('nav.teachers') }}</p>
              <h1 class="h1 hero-title">{{ content.h1 }}</h1>
              <p class="muted hero-lead">{{ content.heroLead }}</p>
              <p class="muted hero-outcome">{{ content.heroOutcome }}</p>
            </div>
          </div>

          <ul class="hero-bullets">
            <li v-for="bullet in content.coreBullets" :key="bullet">{{ bullet }}</li>
          </ul>

          <div class="actions">
            <a
              v-if="telegramUrl"
              class="btn primary telegram-btn"
              :href="telegramUrl"
              target="_blank"
              rel="noreferrer"
            >
              <span class="telegram-mark" aria-hidden="true">
                <svg viewBox="0 0 24 24" focusable="false">
                  <path d="M20.66 4.21a2.05 2.05 0 0 0-2.08-.24L3.61 10.3a1.17 1.17 0 0 0 .09 2.18l3.08 1.06 1.16 4.38a1.19 1.19 0 0 0 2.02.51l2.2-2.26 4.24 3.14a1.77 1.77 0 0 0 2.78-1.01l2.46-12.3a2.05 2.05 0 0 0-.98-1.79Z" />
                  <path d="m8.01 13.14 8.99-5.49a.45.45 0 0 1 .57.67l-7.39 7.36-.47 2.34-.95-3.55a1.46 1.46 0 0 1-.75-1.33Z" />
                </svg>
              </span>
              <span>{{ t('cta.openTelegram') }}</span>
            </a>
          </div>

          <div class="muted teacher-line">
            {{ teachesLine }}
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
            <ChatConversationDemo
              scenario-id="jobInterview"
              :base-locale="teacherChatBaseLocale"
              :target-by-base-locale="teacherChatTargetByBaseLocale"
            />
            <ChatConversationDemo
              scenario-id="doctorVisit"
              :base-locale="teacherChatBaseLocale"
              :target-by-base-locale="teacherChatTargetByBaseLocale"
            />
          </div>
        </section>

        <section class="card section" aria-labelledby="deep-dive-title">
          <h2 id="deep-dive-title" class="h2">{{ content.deepDiveTitle }}</h2>
          <div class="deep-dive">
            <p v-for="paragraph in content.deepDiveParagraphs" :key="paragraph" class="muted deep-paragraph">
              {{ paragraph }}
            </p>
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

        <section id="other-teachers" class="card section" aria-labelledby="other-teachers-title">
          <h2 id="other-teachers-title" class="h2">{{ content.otherTeachersTitle }}</h2>
          <div class="grid-2">
            <TeacherCard v-for="row in otherTeachers" :key="row.teacherKey || row.slug" :teacher="row" />
          </div>
        </section>
      </article>

      <div v-else class="card">
        <h2 class="h2">{{ t('notFound.title') }}</h2>
        <p class="muted">{{ t('notFound.desc') }}</p>
        <RouterLink class="btn" :to="routeWithLocale('teachers')">{{ t('nav.teachers') }}</RouterLink>
      </div>
    </div>
  </section>
</template>

<script setup>
import { computed } from 'vue';
import { RouterLink } from 'vue-router';
import ChatConversationDemo from '../components/ChatConversationDemo.vue';
import TeacherAvatar from '../components/TeacherAvatar.vue';
import TeacherCard from '../components/TeacherCard.vue';
import { teachers, getTeacherName } from '../data/teachers.js';
import { getLandingStartPayload, getTeacherTelegramUrl } from '../lib/telegram.js';
import { normalizeLocale, routeWithLocale, supportedLocales, useI18n } from '../i18n.js';
import { getTeacherSeoContent } from '../data/seoTeacherContent.js';

const props = defineProps({
  teacher: {
    type: Object,
    default: null
  }
});

const { t, locale } = useI18n();
const route = useRoute();

const content = computed(() => {
  if (!props.teacher) return null;
  return getTeacherSeoContent(props.teacher, locale.value);
});

const name = computed(() => getTeacherName(props.teacher, locale.value));
const localizedTagline = computed(() => (props.teacher?.taglines?.[locale.value] || '').toString().trim());
const teachesLine = computed(() => {
  if (!props.teacher) return '';
  const parts = [];
  parts.push(`${t('teacher.teachesPrefix')} ${t(`languageName.${props.teacher.learningLanguage}`)}`);
  if (localizedTagline.value) parts.push(localizedTagline.value);
  return parts.join(' • ');
});

const startPayload = computed(() => getLandingStartPayload(route.query));
const telegramUrl = computed(() => getTeacherTelegramUrl(props.teacher, startPayload.value));
const otherTeachers = computed(() => (Array.isArray(teachers) ? teachers : []));
const teacherChatBaseLocale = computed(() => normalizeLocale(props.teacher?.baseLanguage) || 'en');
const teacherChatTargetLocale = computed(() => normalizeLocale(props.teacher?.learningLanguage) || 'en');
const teacherChatTargetByBaseLocale = computed(() =>
  supportedLocales.reduce((acc, localeCode) => {
    acc[localeCode] = teacherChatTargetLocale.value;
    return acc;
  }, {})
);

useHead(() => {
  if (!props.teacher?.avatarImage) return {};
  const links = [];

  if (props.teacher.avatarSources?.avif) {
    links.push({
      rel: 'preload',
      as: 'image',
      href: props.teacher.avatarSources.avif,
      type: 'image/avif',
      fetchpriority: 'high'
    });
  }

  if (props.teacher.avatarSources?.webp) {
    links.push({
      rel: 'preload',
      as: 'image',
      href: props.teacher.avatarSources.webp,
      type: 'image/webp',
      fetchpriority: 'high'
    });
  }

  links.push({
    rel: 'preload',
    as: 'image',
    href: props.teacher.avatarImage,
    fetchpriority: 'high'
  });

  return {
    link: links
  };
});
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

.hero-meta {
  min-width: 0;
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

.actions {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}

.telegram-btn {
  min-width: 210px;
  border-color: #229ed9;
  background: linear-gradient(135deg, #229ed9, #1c74e9);
  color: #fff;
}

.telegram-btn:hover {
  text-decoration: none;
  border-color: #1c74e9;
  background: linear-gradient(135deg, #1f96cf, #1866cd);
}

.telegram-mark {
  width: 22px;
  height: 22px;
  border-radius: 999px;
  display: inline-grid;
  place-items: center;
  background: #229ed9;
}

.telegram-mark svg {
  width: 15px;
  height: 15px;
  display: block;
  fill: #fff;
}

.teacher-line {
  font-size: 14px;
  line-height: 1.55;
}

.section {
  display: grid;
  gap: 16px;
  padding: clamp(20px, 1.8vw, 28px);
}

.section-intro {
  margin: 0;
  line-height: 1.65;
}

.steps-grid,
.for-who-grid,
.dialogues-grid {
  display: grid;
  gap: 12px;
}

.dialogues-grid {
  position: relative;
  align-items: start;
}

.step-item,
.focus-item,
.dialogue-item,
.faq-item {
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  padding: 16px;
  background: color-mix(in srgb, var(--surface) 55%, var(--bg));
}

.dialogue-line {
  margin: 10px 0 0;
  line-height: 1.6;
}

.label {
  font-weight: 700;
}

.dialogue-note {
  margin-top: 10px;
}

.deep-dive {
  display: grid;
  gap: 12px;
}

.deep-paragraph {
  margin: 0;
  line-height: 1.7;
}

.faq-list {
  display: grid;
  gap: 12px;
}

.faq-question {
  font-size: 18px;
}

.faq-answer {
  margin-top: 8px;
  line-height: 1.65;
}

@media (min-width: 860px) {
  .hero-top {
    grid-template-columns: 96px minmax(0, 1fr);
  }

  .steps-grid,
  .for-who-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .dialogues-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    column-gap: 24px;
    row-gap: 12px;
  }

  .dialogues-grid::before {
    content: '';
    position: absolute;
    top: 0;
    bottom: 0;
    left: 50%;
    width: 1px;
    transform: translateX(-0.5px);
    background: color-mix(in srgb, var(--fg) 16%, var(--border));
    pointer-events: none;
  }
}

@media (max-width: 620px) {
  .page {
    padding-top: 46px;
    padding-bottom: 64px;
  }

  .profile-page {
    gap: 18px;
  }

  .hero {
    gap: 18px;
    padding: 16px;
  }

  .hero-bullets {
    gap: 8px;
  }

  .section {
    gap: 12px;
    padding: 16px;
  }
}
</style>
