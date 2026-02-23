<template>
  <div class="home-root">
    <section id="home" class="snap-section hero" data-active="true">
      <div class="parallax-bg" aria-hidden="true" />
      <div class="snap-inner">
        <div class="container hero-inner">
          <h1 class="h1 reveal-up">{{ t('home.headline') }}</h1>
          <p class="muted hero-sub reveal-up" style="--revealDelay: 80ms;">
            {{ t('home.subhead') }}
          </p>

          <div class="hero-actions reveal-up" style="--revealDelay: 140ms;">
            <button type="button" class="btn primary" @click="openTryModal">{{ t('cta.tryNow') }}</button>
            <RouterLink class="btn" :to="routeWithLocale('teachers')">{{ t('cta.start') }}</RouterLink>
          </div>

          <div class="shot card reveal-up" style="--revealDelay: 220ms;">
            <ChatConversationDemo scenario-id="jobInterview" />
          </div>
        </div>
        <div class="scroll-cue" aria-hidden="true"><div class="scroll-cue-icon">↓</div></div>
      </div>
    </section>

    <section id="features" class="snap-section section">
      <div class="parallax-bg" aria-hidden="true" />
      <div class="snap-inner">
        <div class="container reveal-up">
          <div class="section-head stacked">
            <div>
              <h2 class="h2">{{ t('home.featuresTitle') }}</h2>
              <p class="muted">{{ t('home.featuresSubhead') }}</p>
            </div>
          </div>

          <div class="grid-2 feature-grid" style="--revealDelay: 120ms;">
            <article v-for="item in featureCards" :key="item.id" class="card feature-card">
              <div class="feature-tag">{{ item.tag }}</div>
              <h3 class="h3">{{ item.title }}</h3>
              <p class="muted feature-desc">{{ item.desc }}</p>
            </article>
          </div>
        </div>
        <div class="scroll-cue" aria-hidden="true"><div class="scroll-cue-icon">↓</div></div>
      </div>
    </section>

    <section class="snap-section section">
      <div class="parallax-bg" aria-hidden="true" />
      <div class="snap-inner">
        <div class="container reveal-up">
          <div class="section-head stacked">
            <div>
              <h2 class="h2">{{ t('home.featuredTeachersTitle') }}</h2>
              <p class="muted">{{ t('home.featuredTeachersSubhead') }}</p>
            </div>
            <RouterLink class="btn ghost" :to="routeWithLocale('teachers')">{{ t('home.featuredTeachersCta') }}</RouterLink>
          </div>

          <div v-if="featuredTeachers.length" class="grid-3 reveal-up" style="--revealDelay: 120ms;">
            <TeacherCard v-for="teacher in featuredTeachers" :key="teacher.teacherKey || teacher.slug" :teacher="teacher" />
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

    <section class="snap-section section">
      <div class="parallax-bg" aria-hidden="true" />
      <div class="snap-inner">
        <div class="container reveal-up">
          <div class="section-head stacked">
            <div>
              <h2 class="h2">{{ t('home.whyWorksTitle') }}</h2>
              <p class="muted">{{ t('home.whyWorksSubhead') }}</p>
            </div>
          </div>

          <div class="grid-3 reveal-up why-grid" style="--revealDelay: 120ms;">
            <article v-for="item in whyWorksCards" :key="item.id" class="card why-card">
              <h3 class="h3">{{ item.title }}</h3>
              <p class="muted why-desc">{{ item.desc }}</p>
            </article>
          </div>
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
                <div class="tier-headline">
                  <div class="h3">{{ t(`pricing.tiers.${tier.plan}.name`) }}</div>
                  <span v-if="tier.plan === 'pro'" class="billing-chip">
                    {{ billingIntervalLabel(tier.billingInterval) }}
                  </span>
                </div>
                <div class="muted tier-desc">{{ t(`pricing.tiers.${tier.plan}.desc`) }}</div>
              </div>

              <div class="price">
                <span v-if="tier.plan === 'free'" class="amount">{{ t('pricing.freePrice') }}</span>
                <template v-else>
                  <span class="amount">{{ formatPrice(tier.price) }}</span>
                  <span class="muted cadence">/ {{ billingIntervalLabel(tier.billingInterval) }}</span>
                </template>
              </div>

              <ul class="muted features">
                <li v-for="(key, idx) in t(`pricing.tiers.${tier.plan}.features`).split('||')" :key="idx">
                  {{ key }}
                </li>
              </ul>

              <p v-if="tier.billingInterval === 'year'" class="muted annual-note">
                {{ t('pricing.annualNote', { total: formatPrice(tier.price), perMonth: formatPrice(tier.monthlyEquivalent), save: tier.savingsPercent }) }}
              </p>

              <button v-if="tier.plan === 'free'" class="btn" type="button" @click="openTryModal">{{ t('pricing.ctaTry') }}</button>
              <button v-else class="btn primary" type="button" @click="openTryModal">{{ t('pricing.ctaChooseTeacher') }}</button>
            </div>
          </div>
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

    <section id="faq" class="snap-section section">
      <div class="parallax-bg" aria-hidden="true" />
      <div class="snap-inner">
        <div class="container reveal-up">
          <h2 class="h2">{{ t('faq.title') }}</h2>
          <p class="muted faq-subhead">{{ t('faq.subhead') }}</p>

          <div class="faq-list" style="--revealDelay: 120ms;">
            <article v-for="item in faqItems" :key="item.q" class="card faq-item">
              <h3 class="h3 faq-question">{{ item.q }}</h3>
              <p class="muted faq-answer">{{ item.a }}</p>
            </article>
          </div>
        </div>
        <div class="scroll-cue" aria-hidden="true"><div class="scroll-cue-icon">↓</div></div>
      </div>
    </section>

    <section id="contact" class="snap-section section">
      <div class="parallax-bg" aria-hidden="true" />
      <div class="snap-inner contact-inner">
        <div class="container reveal-up contact-main">
          <article class="card contact-card">
            <h3 class="h3">{{ t('contact.title') }}</h3>
            <p class="muted contact-subhead">{{ t('contact.subhead') }}</p>
            <ol class="muted contact-steps">
              <li>{{ t('contact.stepOpenBot') }}</li>
              <li>{{ t('contact.stepTypeCommand') }} <code>/feedback</code></li>
              <li>{{ t('contact.stepSend') }}</li>
            </ol>
          </article>
        </div>
        <div class="container reveal-up contact-footer-wrap" style="--revealDelay: 120ms;">
          <HomeFooterMini />
        </div>
      </div>
    </section>
  </div>
</template>

<script setup>
import { computed } from 'vue';
import { RouterLink } from 'vue-router';
import ChatConversationDemo from '../components/ChatConversationDemo.vue';
import TeacherCard from '../components/TeacherCard.vue';
import HomeFooterMini from '../components/HomeFooterMini.vue';
import { blogPosts } from '../data/blogPosts.js';
import { pricingTiers } from '../data/pricing.js';
import { teachers } from '../data/teachers.js';
import { featuredTeacherKeys } from '../data/featuredTeachers.js';
import { routeWithLocale, useI18n } from '../i18n.js';

const { t, tm, locale } = useI18n();
const tryTeacherModalOpen = useState('tryTeacherModalOpen', () => false);

const posts = computed(() => blogPosts.slice(0, 3));
const featureCards = computed(() => {
  const ids = ['voice', 'translation', 'followUp', 'memory'];
  return ids.map((id) => ({
    id,
    tag: t(`home.featureCards.${id}.tag`),
    title: t(`home.featureCards.${id}.title`),
    desc: t(`home.featureCards.${id}.desc`)
  }));
});
const faqItems = computed(() => {
  const raw = tm('faq.items');
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => ({
      q: (item?.q || '').toString().trim(),
      a: (item?.a || '').toString().trim()
    }))
    .filter((item) => item.q && item.a);
});

const whyWorksCards = computed(() => {
  const ids = ['noScheduling', 'telegram', 'reusableCorrections'];
  return ids.map((id) => ({
    id,
    title: t(`home.whyWorksItems.${id}.title`),
    desc: t(`home.whyWorksItems.${id}.desc`)
  }));
});

const featuredTeachers = computed(() => {
  const all = Array.isArray(teachers) ? teachers : [];
  const byKey = new Map(all.map((teacher) => [String(teacher?.teacherKey || '').toLowerCase(), teacher]));
  const seen = new Set();
  const result = [];

  for (const rawKey of Array.isArray(featuredTeacherKeys) ? featuredTeacherKeys : []) {
    const key = String(rawKey || '').trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    const match = byKey.get(key);
    if (!match) continue;
    seen.add(key);
    result.push(match);
    if (result.length >= 3) return result;
  }

  for (const teacher of all) {
    const key = String(teacher?.teacherKey || '').toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(teacher);
    if (result.length >= 3) break;
  }

  return result;
});

function openTryModal() {
  tryTeacherModalOpen.value = true;
}

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

function formatPrice(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return '';
  try {
    return new Intl.NumberFormat(locale.value, {
      style: 'currency',
      currency: 'EUR',
      minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
      maximumFractionDigits: 2
    }).format(amount);
  } catch {
    return `€${amount}`;
  }
}

function billingIntervalLabel(intervalRaw) {
  return intervalRaw === 'year' ? t('pricing.perYear') : t('pricing.perMonth');
}
</script>

<style scoped>
.home-root {
  position: relative;
  isolation: isolate;
}

.home-root::before {
  content: '';
  position: fixed;
  inset: 0;
  z-index: 0;
  pointer-events: none;
  background:
    radial-gradient(70vw 70vw at 12% 10%, color-mix(in srgb, var(--surface) 45%, #60a5fa) 0%, transparent 65%),
    radial-gradient(68vw 68vw at 88% 84%, color-mix(in srgb, var(--surface) 48%, #34d399) 0%, transparent 66%),
    linear-gradient(180deg, color-mix(in srgb, var(--bg) 88%, var(--surface)), var(--bg) 35%, color-mix(in srgb, var(--bg) 92%, var(--surface)));
}

.home-root > .snap-section {
  position: relative;
  z-index: 1;
}

.parallax-bg {
  display: none;
}

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
  min-height: 280px;
  height: auto;
  display: grid;
  place-items: start center;
  background: var(--surface);
  overflow: hidden;
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

.feature-grid {
  margin-top: 18px;
}

.why-grid {
  margin-top: 18px;
}

.why-card {
  display: grid;
  gap: 10px;
}

.why-desc {
  margin: 0;
  line-height: 1.7;
}

.feature-card {
  display: grid;
  gap: 8px;
}

.feature-tag {
  display: inline-flex;
  width: fit-content;
  border: 1px solid color-mix(in srgb, var(--fg) 16%, var(--border));
  border-radius: 999px;
  padding: 4px 10px;
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: color-mix(in srgb, var(--fg) 80%, var(--muted));
  background: color-mix(in srgb, var(--surface) 72%, var(--bg));
}

.feature-desc {
  margin: 0;
  line-height: 1.7;
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

.tier-headline {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.billing-chip {
  display: inline-flex;
  align-items: center;
  border: 1px solid var(--border);
  border-radius: 999px;
  padding: 4px 10px;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.02em;
  text-transform: uppercase;
  background: color-mix(in srgb, var(--surface) 72%, var(--bg));
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

.annual-note {
  margin: -4px 0 0;
  font-size: 14px;
  line-height: 1.6;
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

.faq-subhead {
  margin-top: 10px;
  max-width: 68ch;
  line-height: 1.7;
}

.faq-list {
  margin-top: 18px;
  display: grid;
  gap: 12px;
}

.faq-item {
  display: grid;
  gap: 8px;
}

.faq-question {
  margin: 0;
}

.faq-answer {
  margin: 0;
  line-height: 1.75;
}

.scroll-cue {
  display: none;
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

.contact-card {
  display: grid;
  gap: 12px;
}

.contact-subhead {
  margin: 0;
  line-height: 1.7;
  max-width: 68ch;
}

.contact-steps {
  margin: 0;
  padding-left: 20px;
  display: grid;
  gap: 8px;
  line-height: 1.7;
}

.contact-steps code {
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 2px 8px;
  background: color-mix(in srgb, var(--surface) 75%, var(--bg));
  font-size: 0.95em;
}

.contact-inner {
  display: grid;
  gap: 10px;
}

.contact-footer-wrap {
  padding-top: 0;
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
