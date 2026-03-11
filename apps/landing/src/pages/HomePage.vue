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
          <div class="section-head stacked reveal-up pricing-head">
            <div>
              <h2 class="h2">{{ t('pricing.title') }}</h2>
              <p class="muted">{{ t('pricing.subhead') }}</p>
            </div>
            <div v-if="showPricingCurrencySelector" class="pricing-currency-panel">
              <div class="pricing-currency-head">
                <span class="pricing-currency-label">{{ t('pricing.currency.label') }}</span>
                <span class="pricing-currency-note">
                  {{ pricingState.loading ? t('pricing.currency.loading') : pricingCurrencyNote }}
                </span>
              </div>
              <div class="pricing-currency-row">
                <button
                  v-for="currency in primaryPricingCurrencies"
                  :key="currency"
                  class="pricing-currency-chip"
                  type="button"
                  :class="{ active: currency === pricingCurrency }"
                  @click="selectPricingCurrency(currency)"
                >
                  {{ pricingCurrencyChipLabel(currency) }}
                </button>
                <button
                  v-if="hasOverflowPricingCurrencies"
                  class="pricing-currency-chip subtle"
                  type="button"
                  :class="{ active: pricingExpanded }"
                  @click="togglePricingCurrencies"
                >
                  {{ pricingExpanded ? t('pricing.currency.less') : t('pricing.currency.more') }}
                </button>
              </div>
              <div v-if="pricingExpanded && overflowPricingCurrencies.length" class="pricing-currency-row pricing-currency-row-secondary">
                <button
                  v-for="currency in overflowPricingCurrencies"
                  :key="currency"
                  class="pricing-currency-chip"
                  type="button"
                  :class="{ active: currency === pricingCurrency }"
                  @click="selectPricingCurrency(currency)"
                >
                  {{ pricingCurrencyChipLabel(currency) }}
                </button>
              </div>
            </div>
            <div
              v-if="showBillingSwitch"
              class="billing-switch"
              role="radiogroup"
              :aria-label="t('pricing.billingSwitch.label')"
            >
              <button
                class="billing-option"
                type="button"
                role="radio"
                :aria-checked="billingInterval === 'month'"
                :class="{ active: billingInterval === 'month' }"
                @click="setBillingInterval('month')"
              >
                {{ t('pricing.billingSwitch.monthly') }}
              </button>
              <button
                class="billing-option"
                type="button"
                role="radio"
                :aria-checked="billingInterval === 'year'"
                :class="{ active: billingInterval === 'year' }"
                @click="setBillingInterval('year')"
              >
                {{ t('pricing.billingSwitch.annually') }}
                <span v-if="annualSavingsPercent" class="save-badge">
                  {{ t('pricing.billingSwitch.save', { save: annualSavingsPercent }) }}
                </span>
              </button>
            </div>
          </div>

          <div class="grid-2 pricing-grid reveal-up" style="--revealDelay: 120ms;">
            <div v-for="tier in visiblePricingTiers" :key="tier.id" class="card tier" :class="{ featured: tier.highlight }">
              <div class="tier-top">
                <div class="tier-headline">
                  <div class="h3">{{ t(`pricing.tiers.${tier.plan}.name`) }}</div>
                </div>
                <div class="muted tier-desc">{{ t(`pricing.tiers.${tier.plan}.desc`) }}</div>
              </div>

              <div class="price">
                <span v-if="tier.plan === 'free'" class="amount">{{ t('pricing.freePrice') }}</span>
                <template v-else>
                  <div v-if="tier.billingInterval === 'year' && proMonthlyTier" class="price-meta">
                    <s class="muted was">{{ formatPrice(proMonthlyTier.price) || '—' }}/{{ t('pricing.perMonth') }}</s>
                  </div>
                  <div class="price-main">
                    <span class="amount">{{
                      formatPrice(tier.billingInterval === 'year' ? tier.monthlyEquivalent : tier.price) || '—'
                    }}</span>
                    <span class="muted cadence">/ {{ t('pricing.perMonth') }}</span>
                  </div>
                </template>
              </div>

              <ul class="muted features">
                <li v-for="(key, idx) in t(`pricing.tiers.${tier.plan}.features`).split('||')" :key="idx">
                  {{ key }}
                </li>
              </ul>

              <p v-if="tier.billingInterval === 'year' && tier.monthlyEquivalent != null" class="muted annual-note">
                {{ t('pricing.annualNote', { total: formatPrice(tier.price) || '—', perMonth: formatPrice(tier.monthlyEquivalent) || '—' }) }}
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
import { computed, onMounted, reactive, watch } from 'vue';
import { RouterLink } from 'vue-router';
import ChatConversationDemo from '../components/ChatConversationDemo.vue';
import TeacherCard from '../components/TeacherCard.vue';
import HomeFooterMini from '../components/HomeFooterMini.vue';
import { blogPosts } from '../data/blogPosts.js';
import { teachers } from '../data/teachers.js';
import { featuredTeacherKeys } from '../data/featuredTeachers.js';
import { pricing } from '../generated/pricing.js';
import { normalizeLocale, routeWithLocale, useI18n } from '../i18n.js';

const { t, tm, locale } = useI18n();
const runtimeConfig = useRuntimeConfig();
const tryTeacherModalOpen = useState('tryTeacherModalOpen', () => false);
const billingInterval = useState('pricingBillingInterval', () => 'year');
const selectedPricingCurrency = useState(
  'pricingCurrency',
  () => (pricing?.currency || 'EUR').toString().trim().toUpperCase() || 'EUR'
);
const pricingExpanded = useState('pricingCurrencyExpanded', () => false);
const pricingState = reactive({
  loading: false,
  data: pricing,
  availableCurrencies: [(pricing?.currency || 'EUR').toString().trim().toUpperCase() || 'EUR'],
  currencyDetails: {},
  lastBaseLanguage: ''
});
const runtimePricing = computed(() => pricingState.data || pricing);
const pricingCurrency = computed(
  () => (runtimePricing.value?.currency || selectedPricingCurrency.value || 'EUR').toString().trim().toUpperCase() || 'EUR'
);
const pricingApiBase = computed(() => normalizeBaseUrl(runtimeConfig.public?.pricingApiBase || ''));
const pricingBaseLanguage = computed(() => normalizeLocale(locale.value) || 'en');
const availablePricingCurrencies = computed(() => {
  const values = Array.isArray(pricingState.availableCurrencies) ? pricingState.availableCurrencies : [];
  const normalized = uniqueCurrencies(values);
  return normalized.length ? normalized : [pricingCurrency.value];
});
const pricingCurrencyDetails = computed(() => (
  pricingState.currencyDetails && typeof pricingState.currencyDetails === 'object'
    ? pricingState.currencyDetails
    : {}
));
const primaryPricingCurrencies = computed(() => availablePricingCurrencies.value.slice(0, 3));
const overflowPricingCurrencies = computed(() => availablePricingCurrencies.value.slice(3));
const hasOverflowPricingCurrencies = computed(() => overflowPricingCurrencies.value.length > 0);
const showPricingCurrencySelector = computed(() => availablePricingCurrencies.value.length > 1);
const pricingCurrencyNote = computed(() => {
  const details = pricingCurrencyDetails.value[pricingCurrency.value];
  return t('pricing.currency.shownIn', {
    currency: details?.name || pricingCurrency.value
  });
});

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
  const uiLocale = normalizeLocale(locale.value) || 'en';
  const all = (Array.isArray(teachers) ? teachers : []).filter((teacher) => {
    const base = normalizeLocale(teacher?.baseLanguage) || '';
    return base === uiLocale;
  });

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

function normalizeBaseUrl(input) {
  return (input || '').toString().trim().replace(/\/+$/, '');
}

function normalizeCurrencyCode(raw, fallback = null) {
  const value = (raw ?? '').toString().trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(value)) return fallback;
  return value;
}

function uniqueCurrencies(values = []) {
  return Array.from(new Set((Array.isArray(values) ? values : []).map((value) => normalizeCurrencyCode(value)).filter(Boolean)));
}

function pricingCurrencyStorageKey(baseLanguage) {
  const normalized = normalizeLocale(baseLanguage) || 'default';
  return `pricing.currency.${normalized}`;
}

function readStoredPricingCurrency(baseLanguage) {
  if (typeof window === 'undefined') return null;
  try {
    return normalizeCurrencyCode(window.localStorage.getItem(pricingCurrencyStorageKey(baseLanguage)));
  } catch {
    return null;
  }
}

function saveStoredPricingCurrency(baseLanguage, currencyRaw) {
  if (typeof window === 'undefined') return;
  const currency = normalizeCurrencyCode(currencyRaw, null);
  if (!currency) return;
  try {
    window.localStorage.setItem(pricingCurrencyStorageKey(baseLanguage), currency);
  } catch {
    // ignore
  }
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
  if (value == null) return '';
  const amount = Number(value);
  if (!Number.isFinite(amount)) return '';
  try {
    return new Intl.NumberFormat(locale.value, {
      style: 'currency',
      currency: pricingCurrency.value,
      minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
      maximumFractionDigits: 2
    }).format(amount);
  } catch {
    return `€${amount}`;
  }
}

function buildPricingFromPlans({ currency, plans, source = 'api/public_plans' }) {
  const normalizedCurrency = normalizeCurrencyCode(currency, 'EUR');
  const rows = Array.isArray(plans) ? plans : [];
  const month = rows.find((plan) => plan?.tier === 'pro' && plan?.billing_interval === 'month' && normalizeCurrencyCode(plan?.currency) === normalizedCurrency);
  const year = rows.find((plan) => plan?.tier === 'pro' && plan?.billing_interval === 'year' && normalizeCurrencyCode(plan?.currency) === normalizedCurrency);
  const monthCents = Number(month?.amount_cents);
  const yearCents = Number(year?.amount_cents);
  const monthlyAmount = Number.isFinite(monthCents) ? monthCents : null;
  const yearlyAmount = Number.isFinite(yearCents) ? yearCents : null;
  const savingsPercent =
    monthlyAmount != null && yearlyAmount != null && monthlyAmount > 0
      ? Math.round((1 - yearlyAmount / (monthlyAmount * 12)) * 100)
      : null;

  return {
    generated_at: new Date().toISOString(),
    source,
    currency: normalizedCurrency,
    pro: {
      month: monthlyAmount == null ? null : { amount_cents: monthlyAmount, billing_interval: 'month' },
      year: yearlyAmount == null ? null : { amount_cents: yearlyAmount, billing_interval: 'year' },
      savings_percent: Number.isFinite(Number(savingsPercent)) && savingsPercent > 0 ? savingsPercent : null
    }
  };
}

async function fetchPricingJson(url) {
  const resp = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return await resp.json().catch(() => ({}));
}

async function fetchPricingCatalog(baseLanguage) {
  if (!pricingApiBase.value) return null;
  const url = new URL(`${pricingApiBase.value}/public/billing/currencies`);
  url.searchParams.set('base_language', baseLanguage);
  return await fetchPricingJson(url.toString());
}

async function fetchPricingForCurrency(currency) {
  if (!pricingApiBase.value) return false;
  const url = new URL(`${pricingApiBase.value}/public/plans`);
  url.searchParams.set('include_all_intervals', 'true');
  url.searchParams.set('currency', currency);
  const payload = await fetchPricingJson(url.toString());
  pricingState.data = buildPricingFromPlans({
    currency,
    plans: payload?.plans,
    source: 'api/public_plans'
  });
  return true;
}

async function refreshPricing(baseLanguage, requestedCurrency = null) {
  const fallbackCurrency = normalizeCurrencyCode(pricingCurrency.value, 'EUR');
  let availableCurrencies = pricingApiBase.value ? ['EUR'] : [fallbackCurrency];
  let currencyDetails = {};

  if (pricingApiBase.value) {
    try {
      const catalog = await fetchPricingCatalog(baseLanguage);
      const options = Array.isArray(catalog?.currency_options) ? catalog.currency_options : [];
      const catalogCurrencies = uniqueCurrencies(options.map((item) => item?.code));
      if (catalogCurrencies.length) availableCurrencies = catalogCurrencies;
      const detailsFromCatalog = catalog?.currency_details && typeof catalog.currency_details === 'object'
        ? catalog.currency_details
        : {};
      currencyDetails = Object.fromEntries(
        availableCurrencies
          .filter((currency) => detailsFromCatalog[currency])
          .map((currency) => [currency, detailsFromCatalog[currency]])
      );
    } catch (err) {
      console.error('pricing currency catalog failed', err);
      availableCurrencies = uniqueCurrencies([normalizeCurrencyCode(selectedPricingCurrency.value), fallbackCurrency, 'EUR']);
    }
  }

  const selectedCurrency = [
    normalizeCurrencyCode(requestedCurrency),
    readStoredPricingCurrency(baseLanguage),
    normalizeCurrencyCode(selectedPricingCurrency.value),
    availableCurrencies[0],
    fallbackCurrency,
    'EUR'
  ].find((currency) => currency && availableCurrencies.includes(currency)) || availableCurrencies[0] || 'EUR';

  pricingState.availableCurrencies = availableCurrencies;
  pricingState.currencyDetails = currencyDetails;
  pricingState.lastBaseLanguage = baseLanguage;
  if (overflowPricingCurrencies.value.length === 0) pricingExpanded.value = false;

  if (!pricingApiBase.value) {
    selectedPricingCurrency.value = selectedCurrency;
    saveStoredPricingCurrency(baseLanguage, selectedCurrency);
    pricingState.data = {
      ...runtimePricing.value,
      currency: selectedCurrency
    };
    return;
  }

  pricingState.loading = true;
  try {
    await fetchPricingForCurrency(selectedCurrency);
    selectedPricingCurrency.value = selectedCurrency;
    saveStoredPricingCurrency(baseLanguage, selectedCurrency);
  } catch (err) {
    console.error('pricing fetch failed', err);
    const stableCurrency = normalizeCurrencyCode(pricingState.data?.currency, null)
      || normalizeCurrencyCode(pricing?.currency, fallbackCurrency)
      || fallbackCurrency;
    selectedPricingCurrency.value = stableCurrency;
    pricingState.availableCurrencies = uniqueCurrencies([stableCurrency, ...availableCurrencies]);
    saveStoredPricingCurrency(baseLanguage, stableCurrency);
  } finally {
    pricingState.loading = false;
  }
}

async function selectPricingCurrency(currencyRaw) {
  const currency = normalizeCurrencyCode(currencyRaw, null);
  if (!currency) return;
  if (!availablePricingCurrencies.value.includes(currency)) return;
  if (currency === pricingCurrency.value) return;

  if (hasOverflowPricingCurrencies.value) pricingExpanded.value = false;

  if (!pricingApiBase.value) {
    selectedPricingCurrency.value = currency;
    saveStoredPricingCurrency(pricingBaseLanguage.value, currency);
    pricingState.data = {
      ...runtimePricing.value,
      currency
    };
    return;
  }

  pricingState.loading = true;
  try {
    await fetchPricingForCurrency(currency);
    selectedPricingCurrency.value = currency;
    saveStoredPricingCurrency(pricingBaseLanguage.value, currency);
  } catch (err) {
    console.error('pricing fetch failed', err);
  } finally {
    pricingState.loading = false;
  }
}

function togglePricingCurrencies() {
  if (!hasOverflowPricingCurrencies.value) return;
  pricingExpanded.value = !pricingExpanded.value;
}

function pricingCurrencyChipLabel(currencyRaw) {
  const currency = normalizeCurrencyCode(currencyRaw, '');
  if (!currency) return '';
  const details = pricingCurrencyDetails.value[currency];
  const symbol = details?.symbol || currency;
  return symbol === currency ? currency : `${symbol} ${currency}`;
}

function normalizeBillingInterval(raw, fallback = null) {
  const value = (raw ?? '').toString().trim().toLowerCase();
  if (value === 'month' || value === 'year') return value;
  return fallback;
}

const proMonthlyPlan = computed(() => runtimePricing.value?.pro?.month || null);
const proAnnualPlan = computed(() => runtimePricing.value?.pro?.year || null);
const showBillingSwitch = computed(() => Boolean(proMonthlyPlan.value && proAnnualPlan.value));
const annualSavingsPercent = computed(() => {
  const pct = Number(runtimePricing.value?.pro?.savings_percent);
  return Number.isFinite(pct) && pct > 0 ? pct : null;
});

const freeTier = computed(() => ({
  id: 'free',
  plan: 'free',
  price: 0,
  billingInterval: 'month',
  highlight: false
}));

const proMonthlyTier = computed(() => {
  const cents = Number(proMonthlyPlan.value?.amount_cents);
  if (!Number.isFinite(cents)) return null;
  return {
    id: 'pro-month',
    plan: 'pro',
    price: cents / 100,
    billingInterval: 'month',
    highlight: false
  };
});

const proAnnualTier = computed(() => {
  const cents = Number(proAnnualPlan.value?.amount_cents);
  if (!Number.isFinite(cents)) return null;
  const monthlyEquivalent = cents / 12 / 100;
  return {
    id: 'pro-year',
    plan: 'pro',
    price: cents / 100,
    billingInterval: 'year',
    highlight: true,
    monthlyEquivalent,
    savingsPercent: annualSavingsPercent.value
  };
});

const proTier = computed(() => {
  if (billingInterval.value === 'year') return proAnnualTier.value || proMonthlyTier.value;
  return proMonthlyTier.value || proAnnualTier.value;
});

const fallbackProTier = computed(() => ({
  id: 'pro',
  plan: 'pro',
  price: null,
  billingInterval: billingInterval.value === 'year' ? 'year' : 'month',
  highlight: billingInterval.value === 'year',
  monthlyEquivalent: null,
  savingsPercent: annualSavingsPercent.value
}));

const visiblePricingTiers = computed(() => {
  const tiers = [freeTier.value];
  tiers.push(proTier.value || fallbackProTier.value);
  return tiers;
});

function syncBillingIntervalWithAvailability() {
  const desired = normalizeBillingInterval(billingInterval.value, 'year');
  const available = new Set();
  if (proMonthlyTier.value) available.add('month');
  if (proAnnualTier.value) available.add('year');
  if (available.size === 0) {
    billingInterval.value = desired;
    return;
  }
  if (available.has(desired)) {
    billingInterval.value = desired;
    return;
  }
  billingInterval.value = available.has('year') ? 'year' : 'month';
}

function setBillingInterval(intervalRaw) {
  const interval = normalizeBillingInterval(intervalRaw, null);
  if (!interval) return;
  if (interval === 'year' && !proAnnualTier.value) return;
  if (interval === 'month' && !proMonthlyTier.value) return;
  billingInterval.value = interval;
}

onMounted(() => {
  try {
    const saved = window.localStorage.getItem('pricing.billingInterval');
    if (saved === 'month' || saved === 'year') billingInterval.value = saved;
  } catch {
    // ignore
  }
  refreshPricing(pricingBaseLanguage.value).finally(() => {
    syncBillingIntervalWithAvailability();
  });
});

watch(billingInterval, (next) => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem('pricing.billingInterval', next);
  } catch {
    // ignore
  }
});

watch([proMonthlyPlan, proAnnualPlan], () => {
  syncBillingIntervalWithAvailability();
}, { immediate: true });

watch(
  () => pricingBaseLanguage.value,
  (next, prev) => {
    if (!next || next === prev) return;
    refreshPricing(next);
  }
);
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

.pricing-head {
  flex-wrap: wrap;
  align-items: end;
}

.pricing-currency-panel {
  display: grid;
  gap: 10px;
}

.pricing-currency-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 12px;
  flex-wrap: wrap;
}

.pricing-currency-label {
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.16em;
  color: var(--muted);
}

.pricing-currency-note {
  font-size: 13px;
  color: var(--muted);
}

.pricing-currency-row {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.pricing-currency-row-secondary {
  margin-top: -2px;
}

.pricing-currency-chip {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  border: 1px solid var(--border);
  border-radius: 999px;
  padding: 8px 12px;
  background: color-mix(in srgb, var(--surface) 76%, var(--bg));
  color: color-mix(in srgb, var(--fg) 88%, var(--muted));
  font-weight: 800;
  font-size: 13px;
  cursor: pointer;
  transition: background 120ms ease, color 120ms ease, border-color 120ms ease;
}

.pricing-currency-chip.active {
  background: rgba(31, 107, 99, 0.92);
  border-color: rgba(31, 107, 99, 0.92);
  color: rgba(255, 255, 255, 0.94);
}

.pricing-currency-chip.subtle {
  color: var(--muted);
}

.billing-switch {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 4px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: color-mix(in srgb, var(--surface) 72%, var(--bg));
}

.billing-option {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  border: 0;
  border-radius: 999px;
  padding: 8px 12px;
  background: transparent;
  color: color-mix(in srgb, var(--fg) 82%, var(--muted));
  font-weight: 800;
  font-size: 13px;
  letter-spacing: 0.01em;
  cursor: pointer;
  transition: background 120ms ease, color 120ms ease, box-shadow 120ms ease;
}

.billing-option:hover {
  color: var(--fg);
}

.billing-option.active {
  background: var(--bg);
  color: var(--fg);
  box-shadow: 0 8px 24px color-mix(in srgb, var(--shadow) 22%, transparent);
}

.billing-option:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--fg) 50%, transparent);
  outline-offset: 3px;
}

.save-badge {
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  padding: 2px 8px;
  background: color-mix(in srgb, #22c55e 16%, transparent);
  border: 1px solid color-mix(in srgb, #22c55e 32%, transparent);
  color: color-mix(in srgb, #16a34a 70%, var(--fg));
  font-size: 11px;
  font-weight: 900;
  letter-spacing: 0.02em;
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

.tier-desc {
  margin-top: 6px;
  line-height: 1.6;
}

.price {
  display: grid;
  gap: 6px;
}

.price-main {
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.price-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
}

.was {
  text-decoration-thickness: 2px;
  text-decoration-color: color-mix(in srgb, var(--muted) 72%, transparent);
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
