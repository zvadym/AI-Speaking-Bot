<template>
  <div ref="root">
    <section id="home" class="snap-section hero" data-active="true">
      <div class="parallax-bg" aria-hidden="true" />
      <div class="snap-inner">
        <div class="container hero-inner">
          <div class="badge">{{ t('home.badge') }}</div>

          <h1 class="h1 reveal-up">{{ t('home.headline') }}</h1>
          <p class="muted hero-sub reveal-up" style="--revealDelay: 80ms;">
            {{ t('home.subhead') }}
          </p>

          <div class="hero-actions reveal-up" style="--revealDelay: 140ms;">
            <RouterLink class="btn primary" :to="routeWithLocale('teachers')">{{ t('cta.start') }}</RouterLink>
          </div>

          <div class="shot card reveal-up" style="--revealDelay: 220ms;">
            <div class="chat">
              <div class="bubble you">
                <div class="muted mini">{{ t('home.chat.you') }}</div>
                <div>{{ t('home.chat.youMsg') }}</div>
              </div>
              <div class="bubble bot">
                <div class="muted mini">{{ t('home.chat.bot') }}</div>
                <div>{{ t('home.chat.botMsg') }}</div>
              </div>
              <div class="bubble tip">
                <div class="muted mini">{{ t('home.chat.tip') }}</div>
                <div>{{ t('home.chat.tipMsg') }}</div>
              </div>
            </div>
          </div>
        </div>
        <div class="scroll-cue" aria-hidden="true"><div class="scroll-cue-icon">↓</div></div>
      </div>
    </section>

    <section id="how" class="snap-section section">
      <div class="parallax-bg" aria-hidden="true" />
      <div class="snap-inner">
        <div class="container reveal-up">
          <h2 class="h2">{{ t('home.howTitle') }}</h2>
          <div class="grid-3 steps" style="--revealDelay: 120ms;">
            <div class="card">
              <div class="step-num">1</div>
              <div class="h3">{{ t('home.steps.oneTitle') }}</div>
              <div class="muted">{{ t('home.steps.oneDesc') }}</div>
            </div>
            <div class="card">
              <div class="step-num">2</div>
              <div class="h3">{{ t('home.steps.twoTitle') }}</div>
              <div class="muted">{{ t('home.steps.twoDesc') }}</div>
            </div>
            <div class="card">
              <div class="step-num">3</div>
              <div class="h3">{{ t('home.steps.threeTitle') }}</div>
              <div class="muted">{{ t('home.steps.threeDesc') }}</div>
            </div>
          </div>
        </div>
        <div class="scroll-cue" aria-hidden="true"><div class="scroll-cue-icon">↓</div></div>
      </div>
    </section>

    <section id="teachers" class="snap-section section">
      <div class="parallax-bg" aria-hidden="true" />
      <div class="snap-inner">
        <div class="container section-head reveal-up">
          <div>
            <h2 class="h2">{{ t('home.teachersTitle') }}</h2>
            <p class="muted">{{ t('home.teachersDesc') }}</p>
          </div>
          <RouterLink class="btn" :to="routeWithLocale('teachers')">{{ t('cta.allTeachers') }}</RouterLink>
        </div>

        <div class="container grid-2 reveal-up" style="--revealDelay: 120ms;">
          <TeacherCard v-for="teacher in previewTeachers" :key="teacher.slug" :teacher="teacher" />
        </div>
        <div class="scroll-cue" aria-hidden="true"><div class="scroll-cue-icon">↓</div></div>
      </div>
    </section>

    <section id="pricing" class="snap-section section">
      <div class="parallax-bg" aria-hidden="true" />
      <div class="snap-inner">
        <div class="container">
          <div class="section-head stacked reveal-up">
            <div>
              <h2 class="h2">{{ t('pricing.title') }}</h2>
              <p class="muted">{{ t('pricing.subhead') }}</p>
            </div>
          </div>

          <div class="grid-3 pricing-grid reveal-up" style="--revealDelay: 120ms;">
            <div v-for="tier in pricingTiers" :key="tier.id" class="card tier" :class="{ featured: tier.highlight }">
              <div class="tier-top">
                <div class="h3">{{ t(`pricing.tiers.${tier.id}.name`) }}</div>
                <div class="muted tier-desc">{{ t(`pricing.tiers.${tier.id}.desc`) }}</div>
              </div>

              <div class="price">
                <span v-if="tier.id === 'free'" class="amount">{{ t('pricing.freePrice') }}</span>
                <span v-else class="amount">€{{ tier.price }}</span>
                <span v-if="tier.id !== 'free'" class="muted cadence">/ {{ t('pricing.perMonth') }}</span>
              </div>

              <ul class="muted features">
                <li v-for="(key, idx) in t(`pricing.tiers.${tier.id}.features`).split('||')" :key="idx">
                  {{ key }}
                </li>
              </ul>

              <RouterLink v-if="tier.id === 'free'" class="btn" :to="routeWithLocale('teachers')">{{ t('pricing.ctaTry') }}</RouterLink>
              <RouterLink v-else class="btn primary" :to="routeWithLocale('teachers')">{{ t('pricing.ctaChooseTeacher') }}</RouterLink>
            </div>
          </div>

          <div class="muted note reveal-up" style="--revealDelay: 200ms;">{{ t('pricing.yearlySoon') }}</div>
        </div>
        <div class="scroll-cue" aria-hidden="true"><div class="scroll-cue-icon">↓</div></div>
      </div>
    </section>

    <section id="blog" class="snap-section section">
      <div class="parallax-bg" aria-hidden="true" />
      <div class="snap-inner">
        <div class="container section-head reveal-up">
          <div>
            <h2 class="h2">{{ t('blog.title') }}</h2>
            <p class="muted">{{ t('blog.subhead') }}</p>
          </div>
        </div>

        <div class="container grid-3 blog-grid reveal-up" style="--revealDelay: 120ms;">
          <RouterLink v-for="post in posts" :key="post.slug" class="card post" :to="routeWithLocale('blog-post', { slug: post.slug })">
            <div class="muted meta">
              <span>{{ formatDate(post.publishedAt) }}</span>
              <span v-if="post.readingMinutes"> • {{ t('blog.readingMinutes', { n: post.readingMinutes }) }}</span>
            </div>
            <div class="h3">{{ getLocalized(post.title) }}</div>
            <p class="muted excerpt">{{ getLocalized(post.excerpt) }}</p>
            <div class="read">{{ t('blog.read') }} →</div>
          </RouterLink>
        </div>
        <div class="scroll-cue" aria-hidden="true"><div class="scroll-cue-icon">↓</div></div>
      </div>
    </section>

    <section id="about" class="snap-section section">
      <div class="parallax-bg" aria-hidden="true" />
      <div class="snap-inner">
        <div class="container about reveal-up">
          <div class="card about-card">
            <h2 class="h2">{{ t('about.title') }}</h2>
            <p class="muted about-p">{{ t('about.p1') }}</p>
            <p class="muted about-p">{{ t('about.p2') }}</p>
            <ul class="muted about-list">
              <li>{{ t('about.bullets.one') }}</li>
              <li>{{ t('about.bullets.two') }}</li>
              <li>{{ t('about.bullets.three') }}</li>
            </ul>
          </div>
        </div>
        <div class="scroll-cue" aria-hidden="true"><div class="scroll-cue-icon">↓</div></div>
      </div>
    </section>

    <section id="contact" class="snap-section section">
      <div class="parallax-bg" aria-hidden="true" />
      <div class="snap-inner contact-inner">
        <div class="container reveal-up contact-main">
          <ContactForm />
        </div>
        <div class="container reveal-up contact-footer-wrap" style="--revealDelay: 120ms;">
          <HomeFooterMini />
        </div>
      </div>
    </section>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { RouterLink } from 'vue-router';
import TeacherCard from '../components/TeacherCard.vue';
import ContactForm from '../components/ContactForm.vue';
import HomeFooterMini from '../components/HomeFooterMini.vue';
import { teachers } from '../data/teachers.js';
import { blogPosts } from '../data/blogPosts.js';
import { pricingTiers } from '../data/pricing.js';
import { routeWithLocale, useI18n } from '../i18n.js';
import { setupParallax } from '../lib/parallax.js';
import { setupSectionReveal } from '../lib/reveal.js';

const { t, locale } = useI18n();
const previewTeachers = computed(() => teachers.slice(0, 2));
const posts = computed(() => blogPosts.slice(0, 3));

const root = ref(null);
let cleanupParallax = null;
let cleanupReveal = null;

function getLocalized(map) {
  const l = locale.value;
  if (!map || typeof map !== 'object') return '';
  return (map[l] || map.en || map.uk || map.it || '').toString();
}

function formatDate(value) {
  const d = new Date((value || '').toString());
  if (!Number.isFinite(d.getTime())) return (value || '').toString();
  try {
    return new Intl.DateTimeFormat(locale.value, { year: 'numeric', month: 'short', day: 'numeric' }).format(d);
  } catch {
    return (value || '').toString();
  }
}

onMounted(() => {
  const host = root.value;
  const sections = host ? Array.from(host.querySelectorAll('.snap-section')) : [];
  cleanupParallax = setupParallax(sections);
  cleanupReveal = setupSectionReveal(sections);
});

onBeforeUnmount(() => {
  if (cleanupParallax) cleanupParallax();
  if (cleanupReveal) cleanupReveal();
});
</script>

<style scoped>
.hero {
  padding: 56px 0 18px;
}

.hero-inner {
  display: grid;
  gap: 18px;
}

.hero-sub {
  max-width: 52ch;
  font-size: 18px;
  line-height: 1.6;
}

.hero-actions {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}

.shot {
  height: 280px;
  display: grid;
  place-items: center;
  background: var(--surface);
  overflow: hidden;
}

.chat {
  width: min(680px, 100%);
  display: grid;
  gap: 10px;
}

.bubble {
  width: fit-content;
  max-width: 78%;
  padding: 12px 14px;
  border-radius: var(--radius-lg);
  border: 1px solid var(--border);
  background: var(--bg);
  box-shadow: var(--shadow);
  line-height: 1.55;
}

.mini {
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.02em;
  text-transform: uppercase;
  margin-bottom: 4px;
}

.you {
  justify-self: start;
}

.bot {
  justify-self: end;
  background: color-mix(in srgb, var(--bg) 70%, var(--surface));
}

.tip {
  justify-self: start;
  background: color-mix(in srgb, var(--surface) 65%, var(--bg));
}

.section {
  padding: 56px 0;
}

.section-head {
  display: flex;
  align-items: end;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 16px;
}

.stacked {
  align-items: start;
}

.steps {
  margin-top: 16px;
}

.step-num {
  width: 36px;
  height: 36px;
  border-radius: 999px;
  background: var(--surface);
  border: 1px solid var(--border);
  display: grid;
  place-items: center;
  font-family: Outfit, Inter, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif;
  font-weight: 900;
  margin-bottom: 10px;
}

.pricing-grid {
  margin-top: 18px;
}

.tier {
  display: grid;
  gap: 14px;
}

.tier.featured {
  border-color: color-mix(in srgb, var(--fg) 22%, var(--border));
}

.tier-desc {
  margin-top: 6px;
  line-height: 1.6;
}

.price {
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.amount {
  font-family: Outfit, Inter, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif;
  font-weight: 900;
  font-size: 34px;
  letter-spacing: -0.02em;
}

.cadence {
  font-size: 14px;
  font-weight: 700;
}

.features {
  margin: 0;
  padding-left: 18px;
  line-height: 1.7;
}

.note {
  margin-top: 14px;
  font-size: 14px;
}

.blog-grid {
  margin-top: 18px;
}

.post {
  display: grid;
  gap: 10px;
  transition: transform 120ms ease, border-color 120ms ease;
}

.post:hover {
  text-decoration: none;
  transform: translateY(-1px);
  border-color: color-mix(in srgb, var(--fg) 22%, var(--border));
}

.post .meta {
  font-size: 13px;
}

.excerpt {
  margin: 0;
  line-height: 1.7;
}

.read {
  margin-top: 4px;
  font-weight: 800;
}

.about-card {
  display: grid;
  gap: 12px;
}

.about-p {
  margin: 0;
  line-height: 1.8;
}

.about-list {
  margin: 0;
  padding-left: 18px;
  line-height: 1.8;
}

.scroll-cue {
  margin-top: auto;
  width: 100%;
  display: flex;
  justify-content: center;
  align-items: center;
  padding-top: 10px;
  padding-bottom: 2px;
}

.scroll-cue-icon {
  width: 36px;
  height: 36px;
  display: grid;
  place-items: center;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--bg);
  font-family: Outfit, Inter, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif;
  font-size: 18px;
  font-weight: 900;
  line-height: 1;
  animation: cue-bounce 1.3s ease-in-out infinite;
}

.contact-inner {
  min-height: calc(100svh - 104px);
  display: flex;
  flex-direction: column;
}

.contact-footer-wrap {
  margin-top: auto;
  padding-top: 10px;
}

@keyframes cue-bounce {
  0%,
  100% {
    transform: translateY(0);
  }
  50% {
    transform: translateY(4px);
  }
}
</style>
