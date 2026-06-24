<template>
  <div class="home-root">
    <section id="home" class="snap-section hero" data-active="true">
      <div class="parallax-bg" aria-hidden="true" />
      <div class="snap-inner">
        <div class="container hero-inner">
          <div class="hero-copy">
            <div class="hero-kicker reveal-up">
              <span class="hero-kicker-dot" aria-hidden="true" />
              <span>{{ t('home.heroKicker') }}</span>
            </div>

            <h1 class="h1 reveal-up" style="--revealDelay: 50ms;">{{ t('home.headline') }}</h1>
            <p class="muted hero-sub reveal-up" style="--revealDelay: 100ms;">
              {{ t('home.subhead') }}
            </p>

            <div class="hero-actions reveal-up" style="--revealDelay: 150ms;">
              <button type="button" class="btn primary hero-primary" @click="openTryModal">
                <span class="telegram-mark-small" aria-hidden="true" />
                {{ t('cta.tryNow') }}
              </button>
              <RouterLink class="btn hero-secondary" :to="routeWithLocale('practice')">{{ t('cta.start') }}</RouterLink>
            </div>

            <div class="hero-proof-card reveal-up" style="--revealDelay: 210ms;" :aria-label="t('home.heroProofLabel')">
              <div class="hero-proof-head">
                <span class="hero-proof-eyebrow">{{ t('home.heroProofEyebrow') }}</span>
                <span class="hero-proof-note">{{ t('home.heroProofNote') }}</span>
              </div>
              <div class="hero-proof-grid">
                <article v-for="item in heroProofItems" :key="item.id" class="hero-proof-item">
                  <span class="hero-proof-index">{{ item.index }}</span>
                  <span class="hero-proof-content">
                    <span class="hero-proof-value">{{ item.value }}</span>
                    <span class="hero-proof-label">{{ item.label }}</span>
                    <span class="hero-proof-sample">{{ item.sample }}</span>
                  </span>
                </article>
              </div>
            </div>
          </div>

          <div class="hero-demo reveal-up" style="--revealDelay: 180ms;">
            <div class="demo-caption">
              <span class="demo-caption-pill">{{ t('home.demoPill') }}</span>
              <div>
                <div class="demo-caption-title">{{ t('home.demoTitle') }}</div>
                <div class="muted demo-caption-text">{{ t('home.demoSubtitle') }}</div>
              </div>
            </div>
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
              <h2 class="h2">{{ t('home.featuredTeachersTitle') }}</h2>
              <p class="muted">{{ t('home.featuredTeachersSubhead') }}</p>
            </div>
            <RouterLink class="btn ghost" :to="routeWithLocale('practice')">{{ t('home.featuredTeachersCta') }}</RouterLink>
          </div>

          <div v-if="featuredPracticePaths.length" class="grid-3 reveal-up" style="--revealDelay: 120ms;">
            <PracticePathCard v-for="practicePath in featuredPracticePaths" :key="practicePath.slug" :practice-path="practicePath" />
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
              <h2 class="h2">{{ t('home.featuresTitle') }}</h2>
              <p class="muted">{{ t('home.featuresSubhead') }}</p>
            </div>
          </div>

          <div class="grid-2 feature-grid" style="--revealDelay: 120ms;">
            <article v-for="item in featureCards" :key="item.id" class="lux-card feature-card">
              <div class="lux-card-core feature-card-core">
                <div class="feature-tag">{{ item.tag }}</div>
                <h3 class="h3">{{ item.title }}</h3>
                <p class="muted feature-desc">{{ item.desc }}</p>
              </div>
            </article>
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
            <div class="lux-card step-card">
              <div class="lux-card-core step-card-core">
                <div class="step-num">1</div>
                <div class="h3">{{ t('home.steps.oneTitle') }}</div>
                <div class="muted">{{ t('home.steps.oneDesc') }}</div>
              </div>
            </div>
            <div class="lux-card step-card">
              <div class="lux-card-core step-card-core">
                <div class="step-num">2</div>
                <div class="h3">{{ t('home.steps.twoTitle') }}</div>
                <div class="muted">{{ t('home.steps.twoDesc') }}</div>
              </div>
            </div>
            <div class="lux-card step-card">
              <div class="lux-card-core step-card-core">
                <div class="step-num">3</div>
                <div class="h3">{{ t('home.steps.threeTitle') }}</div>
                <div class="muted">{{ t('home.steps.threeDesc') }}</div>
              </div>
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
            <article v-for="item in whyWorksCards" :key="item.id" class="lux-card why-card">
              <div class="lux-card-core why-card-core">
                <h3 class="h3">{{ item.title }}</h3>
                <p class="muted why-desc">{{ item.desc }}</p>
              </div>
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
                <span class="pricing-currency-note">{{ pricingCurrencyNote }}</span>
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
            <div v-for="tier in visiblePricingTiers" :key="tier.id" class="lux-card tier" :class="{ featured: tier.highlight }">
              <div class="lux-card-core tier-core">
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
          <RouterLink v-for="post in posts" :key="post.slug" class="lux-card post" :to="routeWithLocale('blog-post', { slug: post.slug })">
            <div class="lux-card-core post-core">
              <div class="muted meta">
                <span>{{ formatDate(post.publishedAt) }}</span>
                <span v-if="post.readingMinutes"> • {{ t('blog.readingMinutes', { n: post.readingMinutes }) }}</span>
              </div>
              <div class="h3">{{ getLocalized(post.title) }}</div>
              <p class="muted excerpt">{{ getLocalized(post.excerpt) }}</p>
              <div class="read">{{ t('blog.read') }} →</div>
            </div>
          </RouterLink>
        </div>
        <div class="scroll-cue" aria-hidden="true"><div class="scroll-cue-icon">↓</div></div>
      </div>
    </section>

    <section id="about" class="snap-section section">
      <div class="parallax-bg" aria-hidden="true" />
      <div class="snap-inner">
        <div class="container about reveal-up">
          <div class="lux-card about-card">
            <div class="lux-card-core about-card-core">
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
          <article class="lux-card contact-card">
            <div class="lux-card-core contact-card-core">
              <div class="contact-copy">
                <h3 class="h3">{{ t('contact.title') }}</h3>
                <p class="muted contact-subhead">{{ t('contact.subhead') }}</p>
              </div>
              <ContactDiscordForm />
            </div>
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
import { computed, onBeforeUnmount, onMounted, watch } from 'vue';
import { RouterLink } from 'vue-router';
import ChatConversationDemo from '../components/ChatConversationDemo.vue';
import ContactDiscordForm from '../components/ContactDiscordForm.vue';
import PracticePathCard from '../components/PracticePathCard.vue';
import HomeFooterMini from '../components/HomeFooterMini.vue';
import { blogPosts } from '../data/blogPosts.js';
import { featuredPracticePathKeys } from '../data/featuredPracticePaths.js';
import { practicePaths } from '../data/practicePaths.js';
import { pricing } from '../generated/pricing.js';
import { normalizeLocale, routeWithLocale, useI18n } from '../i18n.js';

const { t, tm, locale } = useI18n();
const tryPracticeModalOpen = useState('tryPracticeModalOpen', () => false);
const billingInterval = useState('pricingBillingInterval', () => 'year');
const selectedPricingCurrency = useState(
  'pricingCurrency',
  () => (pricing?.default_currency || pricing?.currency || 'EUR').toString().trim().toUpperCase() || 'EUR'
);
const pricingExpanded = useState('pricingCurrencyExpanded', () => false);
let revealObserver = null;

const posts = computed(() => blogPosts.slice(0, 3));
const heroProofItems = computed(() => {
  const ids = ['transcript', 'correction', 'explanation', 'replyOptions'];
  return ids.map((id, index) => ({
    id,
    index: String(index + 1).padStart(2, '0'),
    value: t(`home.heroProof.${id}.value`),
    label: t(`home.heroProof.${id}.label`),
    sample: t(`home.heroProof.${id}.sample`)
  }));
});
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

const featuredPracticePaths = computed(() => {
  const uiLocale = normalizeLocale(locale.value) || 'en';
  const all = (Array.isArray(practicePaths) ? practicePaths : []).filter((practicePath) => {
    const base = normalizeLocale(practicePath?.baseLanguage) || '';
    return base === uiLocale;
  });

  const byKey = new Map(all.map((practicePath) => [String(practicePath?.botKey || '').toLowerCase(), practicePath]));
  const seen = new Set();
  const result = [];

  for (const rawKey of Array.isArray(featuredPracticePathKeys) ? featuredPracticePathKeys : []) {
    const key = String(rawKey || '').trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    const match = byKey.get(key);
    if (!match) continue;
    seen.add(key);
    result.push(match);
    if (result.length >= 3) return result;
  }

  for (const practicePath of all) {
    const key = String(practicePath?.botKey || '').toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(practicePath);
    if (result.length >= 3) break;
  }

  return result;
});

function openTryModal() {
  tryPracticeModalOpen.value = true;
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

const pricingFallbackCurrency = computed(
  () => normalizeCurrencyCode(pricing?.default_currency || pricing?.currency, 'EUR') || 'EUR'
);
const generatedCurrenciesByBaseLanguage = computed(() => {
  const value = pricing?.currencies_by_base_language;
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
});
const generatedCurrencyDetails = computed(() => {
  const value = pricing?.currency_details;
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
});
const generatedPlansByCurrency = computed(() => {
  const value = pricing?.plans_by_currency;
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  const legacyCurrency = normalizeCurrencyCode(pricing?.currency, null);
  if (legacyCurrency && pricing?.pro) {
    return {
      [legacyCurrency]: {
        ...pricing,
        currency: legacyCurrency
      }
    };
  }
  return {};
});
const pricingBaseLanguage = computed(() => normalizeLocale(locale.value) || 'en');
const pricingCurrencyDetails = computed(() => generatedCurrencyDetails.value);

function availablePricingCurrenciesFor(baseLanguageRaw) {
  const baseLanguage = normalizeLocale(baseLanguageRaw) || '';
  const configuredCurrencies = uniqueCurrencies(generatedCurrenciesByBaseLanguage.value?.[baseLanguage] || []);
  const currenciesWithPrices = uniqueCurrencies(Object.keys(generatedPlansByCurrency.value || {}));
  const filteredConfigured = configuredCurrencies.filter((currency) => currenciesWithPrices.includes(currency));
  if (filteredConfigured.length) return filteredConfigured;
  if (configuredCurrencies.length) return configuredCurrencies;
  if (currenciesWithPrices.includes(pricingFallbackCurrency.value)) return [pricingFallbackCurrency.value];
  return currenciesWithPrices.length ? currenciesWithPrices : [pricingFallbackCurrency.value];
}

const availablePricingCurrencies = computed(() => availablePricingCurrenciesFor(pricingBaseLanguage.value));
const pricingCurrency = computed(() => {
  const selected = normalizeCurrencyCode(selectedPricingCurrency.value, null);
  if (selected && availablePricingCurrencies.value.includes(selected)) return selected;
  return availablePricingCurrencies.value[0] || pricingFallbackCurrency.value;
});
const primaryPricingCurrencies = computed(() => availablePricingCurrencies.value.slice(0, 3));
const overflowPricingCurrencies = computed(() => availablePricingCurrencies.value.slice(3));
const hasOverflowPricingCurrencies = computed(() => overflowPricingCurrencies.value.length > 0);
const showPricingCurrencySelector = computed(() => availablePricingCurrencies.value.length > 1);
const runtimePricing = computed(() => {
  const direct = generatedPlansByCurrency.value?.[pricingCurrency.value];
  if (direct && typeof direct === 'object') return direct;

  const fallback = generatedPlansByCurrency.value?.[pricingFallbackCurrency.value];
  if (fallback && typeof fallback === 'object') return fallback;

  return {
    currency: pricingCurrency.value,
    pro: {
      month: null,
      year: null,
      savings_percent: null
    }
  };
});
const pricingCurrencyNote = computed(() => {
  const details = pricingCurrencyDetails.value[pricingCurrency.value];
  return t('pricing.currency.shownIn', {
    currency: details?.name || pricingCurrency.value
  });
});

function syncSelectedPricingCurrency(baseLanguageRaw, requestedCurrency = null) {
  const availableCurrencies = availablePricingCurrenciesFor(baseLanguageRaw);
  const selectedCurrency = [
    normalizeCurrencyCode(requestedCurrency, null),
    readStoredPricingCurrency(baseLanguageRaw),
    normalizeCurrencyCode(selectedPricingCurrency.value, null),
    availableCurrencies[0],
    pricingFallbackCurrency.value,
    'EUR'
  ].find((currency) => currency && availableCurrencies.includes(currency)) || availableCurrencies[0] || pricingFallbackCurrency.value;

  selectedPricingCurrency.value = selectedCurrency;
  saveStoredPricingCurrency(baseLanguageRaw, selectedCurrency);
  if (overflowPricingCurrencies.value.length === 0) pricingExpanded.value = false;
}

function selectPricingCurrency(currencyRaw) {
  const currency = normalizeCurrencyCode(currencyRaw, null);
  if (!currency) return;
  if (!availablePricingCurrencies.value.includes(currency)) return;
  if (currency === pricingCurrency.value) return;

  selectedPricingCurrency.value = currency;
  saveStoredPricingCurrency(pricingBaseLanguage.value, currency);
  if (hasOverflowPricingCurrencies.value) pricingExpanded.value = false;
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

function setupRevealMotion() {
  if (!import.meta.client) return;
  const targets = Array.from(document.querySelectorAll('.reveal-up, .reveal-left, .reveal-right'));
  if (!targets.length) return;

  const prefersReduced = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
  if (prefersReduced || typeof IntersectionObserver === 'undefined') {
    document.documentElement.classList.remove('reveal-motion');
    for (const target of targets) target.classList.add('is-visible');
    return;
  }

  const initialBottom = window.innerHeight * 1.08;
  for (const target of targets) {
    const rect = target.getBoundingClientRect();
    if (rect.top < initialBottom && rect.bottom > -80) target.classList.add('is-visible');
  }
  document.documentElement.classList.add('reveal-motion');

  revealObserver?.disconnect();
  revealObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add('is-visible');
        revealObserver?.unobserve(entry.target);
      }
    },
    {
      root: null,
      threshold: 0.12,
      rootMargin: '0px 0px -8% 0px'
    }
  );

  for (const target of targets) revealObserver.observe(target);
}

onMounted(() => {
  setupRevealMotion();
  try {
    const saved = window.localStorage.getItem('pricing.billingInterval');
    if (saved === 'month' || saved === 'year') billingInterval.value = saved;
  } catch {
    // ignore
  }
  syncSelectedPricingCurrency(pricingBaseLanguage.value);
  syncBillingIntervalWithAvailability();
});

onBeforeUnmount(() => {
  revealObserver?.disconnect();
  revealObserver = null;
  if (import.meta.client) document.documentElement.classList.remove('reveal-motion');
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
    syncSelectedPricingCurrency(next);
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
    linear-gradient(rgba(17, 17, 17, 0.035) 1px, transparent 1px) 0 0 / 28px 28px,
    linear-gradient(90deg, rgba(17, 17, 17, 0.035) 1px, transparent 1px) 0 0 / 28px 28px,
    linear-gradient(180deg, #ffffff 0%, var(--bg) 42%, #eef0e8 100%);
}

.home-root > .snap-section {
  position: relative;
  z-index: 1;
}

.parallax-bg {
  display: none;
}

.hero {
  padding: clamp(28px, 5vw, 54px) 0 clamp(24px, 4vw, 42px);
}

.hero-inner {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: clamp(28px, 6vw, 76px);
  align-items: center;
}

.hero-copy {
  display: grid;
  gap: 18px;
  max-width: 650px;
}

.hero-kicker {
  width: fit-content;
  display: inline-flex;
  align-items: center;
  gap: 9px;
  border: 1.5px solid var(--fg);
  border-radius: var(--radius-md);
  padding: 8px 12px;
  background: var(--surface);
  color: var(--fg);
  font-size: 13px;
  font-weight: 900;
  box-shadow: 3px 3px 0 var(--accent);
}

.hero-kicker-dot {
  width: 8px;
  height: 8px;
  border-radius: 999px;
  background: var(--fg);
  box-shadow: 0 0 0 5px color-mix(in srgb, var(--accent) 70%, transparent);
}

.hero-sub {
  max-width: 58ch;
  font-size: 18px;
  line-height: 1.6;
  margin: 0;
}

.hero-actions {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}

.hero-primary,
.hero-secondary {
  min-height: 48px;
  padding-inline: 18px;
}

.telegram-mark-small {
  width: 18px;
  height: 18px;
  border-radius: var(--radius-sm);
  background: var(--accent);
  border: 1px solid var(--fg);
  position: relative;
  flex: 0 0 auto;
}

.telegram-mark-small::after {
  content: '';
  position: absolute;
  left: 4px;
  top: 4px;
  width: 9px;
  height: 9px;
  background: var(--fg);
  clip-path: polygon(0 42%, 100% 0, 70% 100%, 47% 62%);
}

.hero-proof-card {
  width: min(100%, 680px);
  border: 1.5px solid var(--fg);
  border-radius: var(--radius-xxl);
  padding: 8px;
  background: var(--surface);
  box-shadow: 8px 8px 0 color-mix(in srgb, var(--fg) 88%, transparent);
  outline: 0;
}

.hero-proof-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding: 10px 12px 14px;
}

.hero-proof-eyebrow {
  color: var(--fg);
  font-size: 11px;
  font-weight: 950;
  letter-spacing: 0.14em;
  line-height: 1.2;
  text-transform: uppercase;
}

.hero-proof-note {
  max-width: 260px;
  color: var(--muted);
  font-size: 12px;
  font-weight: 850;
  line-height: 1.35;
  text-align: right;
}

.hero-proof-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.hero-proof-item {
  min-height: 138px;
  display: grid;
  grid-template-columns: 34px minmax(0, 1fr);
  align-items: start;
  gap: 12px;
  border: 1px solid color-mix(in srgb, var(--fg) 22%, var(--border));
  border-radius: var(--radius-lg);
  padding: 14px;
  background: color-mix(in srgb, var(--surface) 84%, var(--bg));
  box-shadow: none;
  transition:
    transform 620ms var(--motion-spring),
    box-shadow 620ms var(--motion-spring);
}

.hero-proof-item:hover {
  transform: translateY(-3px);
  box-shadow: 4px 4px 0 var(--fg);
}

.hero-proof-index {
  display: inline-grid;
  place-items: center;
  width: 34px;
  height: 34px;
  border-radius: var(--radius-sm);
  background: var(--fg);
  color: var(--bg);
  font-size: 11px;
  font-weight: 950;
  font-variant-numeric: tabular-nums;
  box-shadow: none;
}

.hero-proof-content {
  min-width: 0;
  display: grid;
  gap: 7px;
}

.hero-proof-value,
.hero-proof-label,
.hero-proof-sample {
  display: block;
}

.hero-proof-value {
  color: var(--fg);
  font-size: 15px;
  font-weight: 950;
  line-height: 1.15;
}

.hero-proof-label {
  color: var(--muted);
  font-size: 12px;
  font-weight: 780;
  line-height: 1.42;
}

.hero-proof-sample {
  width: fit-content;
  max-width: 100%;
  overflow: hidden;
  color: var(--fg);
  font-size: 11px;
  font-weight: 850;
  line-height: 1.25;
  text-overflow: ellipsis;
  white-space: nowrap;
  border-radius: var(--radius-sm);
  padding: 6px 8px;
  background: color-mix(in srgb, var(--accent) 54%, #ffffff);
}

.hero-demo {
  width: min(100%, 430px);
  justify-self: center;
  display: grid;
  gap: 12px;
}

.demo-caption {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: center;
  gap: 12px;
  border: 1.5px solid var(--fg);
  border-radius: var(--radius-lg);
  padding: 12px 14px;
  background: var(--surface);
  box-shadow: 4px 4px 0 var(--fg);
}

.demo-caption-pill {
  display: inline-grid;
  place-items: center;
  min-width: 52px;
  min-height: 32px;
  border-radius: var(--radius-sm);
  background: var(--fg);
  color: var(--bg);
  font-size: 12px;
  font-weight: 900;
}

.demo-caption-title {
  font-weight: 900;
  line-height: 1.2;
}

.demo-caption-text {
  margin-top: 2px;
  font-size: 13px;
  line-height: 1.4;
}

.section {
  padding: clamp(78px, 9vw, 132px) 0;
}

.section-head {
  display: flex;
  align-items: end;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 20px;
}

.section-head p {
  max-width: 62ch;
  line-height: 1.7;
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
  border: 1.5px solid var(--fg);
  border-radius: var(--radius-sm);
  padding: 8px 12px;
  background: var(--surface);
  color: var(--fg);
  font-weight: 800;
  font-size: 13px;
  cursor: pointer;
  transition:
    background 520ms var(--motion-spring),
    color 520ms var(--motion-spring),
    border-color 520ms var(--motion-spring),
    transform 520ms var(--motion-spring);
}

.pricing-currency-chip.active {
  background: var(--fg);
  border-color: var(--fg);
  color: var(--bg);
}

.pricing-currency-chip.subtle {
  color: var(--muted);
}

.billing-switch {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 4px;
  border-radius: var(--radius-md);
  border: 1.5px solid var(--fg);
  background: var(--surface);
}

.billing-option {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  border: 0;
  border-radius: var(--radius-sm);
  padding: 8px 12px;
  background: transparent;
  color: color-mix(in srgb, var(--fg) 82%, var(--muted));
  font-weight: 800;
  font-size: 13px;
  letter-spacing: 0.01em;
  cursor: pointer;
  transition:
    background 520ms var(--motion-spring),
    color 520ms var(--motion-spring),
    box-shadow 520ms var(--motion-spring),
    transform 520ms var(--motion-spring);
}

.billing-option:hover {
  color: var(--fg);
}

.billing-option.active {
  background: var(--fg);
  color: var(--bg);
  box-shadow: none;
}

.billing-option:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--fg) 50%, transparent);
  outline-offset: 3px;
}

.save-badge {
  display: inline-flex;
  align-items: center;
  border-radius: var(--radius-sm);
  padding: 2px 8px;
  background: var(--accent);
  border: 1px solid var(--fg);
  color: var(--fg);
  font-size: 11px;
  font-weight: 900;
  letter-spacing: 0.02em;
}

.steps {
  margin-top: 16px;
}

.step-card-core {
  display: grid;
  gap: 10px;
  align-content: start;
}

.feature-grid {
  margin-top: 18px;
}

.why-grid {
  margin-top: 18px;
}

.why-card {
  min-height: 250px;
}

.why-card-core {
  display: grid;
  gap: 10px;
  align-content: start;
}

.why-desc {
  margin: 0;
  line-height: 1.7;
}

.feature-card {
  min-height: 250px;
}

.feature-card-core {
  display: grid;
  gap: 10px;
  align-content: start;
  background: var(--surface);
}

.feature-tag {
  display: inline-flex;
  width: fit-content;
  border: 1.5px solid var(--fg);
  border-radius: var(--radius-sm);
  padding: 4px 10px;
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.01em;
  color: var(--fg);
  background: color-mix(in srgb, var(--accent) 55%, var(--surface));
}

.feature-desc {
  margin: 0;
  line-height: 1.7;
}

.step-num {
  width: 36px;
  height: 36px;
  border-radius: var(--radius-sm);
  background: var(--fg);
  border: 1.5px solid var(--fg);
  color: var(--bg);
  display: grid;
  place-items: center;
  font-family: var(--font-display);
  font-weight: 900;
  margin-bottom: 10px;
}

.pricing-grid {
  margin-top: 18px;
}

.tier {
  min-height: 430px;
}

.tier-core {
  display: grid;
  gap: 14px;
  align-content: start;
}

.tier.featured {
  border-color: var(--fg);
  background: color-mix(in srgb, var(--accent) 18%, var(--surface));
  box-shadow: 8px 8px 0 var(--fg);
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
  font-family: var(--font-display);
  font-weight: 900;
  font-size: 34px;
  letter-spacing: 0;
}

.cadence {
  font-size: 14px;
  font-weight: 700;
}

.features {
  margin: 0;
  padding-left: 18px;
  line-height: 1.7;
  min-height: 142px;
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
  min-height: 260px;
  text-decoration: none;
  transition:
    transform 640ms var(--motion-spring),
    border-color 640ms var(--motion-spring),
    box-shadow 640ms var(--motion-spring);
}

.post-core {
  display: grid;
  gap: 10px;
  align-content: start;
}

.post:hover {
  text-decoration: none;
  transform: translateY(-4px);
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
  margin-top: auto;
  font-weight: 800;
}

.about-card {
  max-width: 920px;
}

.about-card-core {
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
  gap: 10px;
}

.faq-item {
  display: grid;
  gap: 8px;
  border-radius: 0;
  border: 0;
  border-left: 3px solid var(--fg);
  box-shadow: none;
  background: transparent;
  padding: 14px 0 14px 18px;
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
  border-radius: var(--radius-sm);
  border: 1.5px solid var(--fg);
  background: var(--surface);
  font-family: var(--font-display);
  font-size: 18px;
  font-weight: 900;
  line-height: 1;
  animation: cue-bounce 1.3s var(--motion-soft) infinite;
}

.contact-card {
  max-width: 920px;
  margin-inline: auto;
}

.contact-card-core {
  display: grid;
  gap: 20px;
}

.contact-copy {
  display: grid;
  gap: 12px;
}

.contact-subhead {
  margin: 0;
  line-height: 1.7;
  max-width: 68ch;
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

@media (min-width: 920px) {
  .hero-inner {
    grid-template-columns: minmax(0, 1.04fr) minmax(360px, 430px);
  }

  .hero-proof-grid {
    grid-template-columns: 1.05fr 0.95fr;
  }

  .hero-proof-item:first-child {
    grid-row: span 2;
    align-content: center;
    min-height: 158px;
  }

  .feature-grid {
    grid-template-columns: repeat(12, minmax(0, 1fr));
  }

  .feature-card {
    grid-column: span 6;
  }

  .feature-card:nth-child(1),
  .feature-card:nth-child(4) {
    grid-column: span 7;
  }

  .feature-card:nth-child(2),
  .feature-card:nth-child(3) {
    grid-column: span 5;
  }

  .steps {
    grid-template-columns: 0.9fr 1.1fr 0.9fr;
    align-items: start;
  }

  .steps .step-card:nth-child(2) {
    transform: translateY(24px);
  }

  .why-grid {
    grid-template-columns: 1.08fr 0.92fr 1fr;
    align-items: start;
  }

  .why-card:nth-child(1) {
    margin-top: 22px;
  }

  .why-card:nth-child(3) {
    margin-top: 12px;
  }

  .faq-list {
    grid-template-columns: minmax(0, 0.88fr) minmax(0, 1.12fr);
    gap: 12px 28px;
  }

  .faq-item:nth-child(odd) {
    transform: translateY(8px);
  }
}

@media (max-width: 680px) {
  .section {
    padding: 64px 0;
  }

  .hero-proof-grid {
    grid-template-columns: 1fr;
  }

  .hero-proof-item {
    min-height: auto;
  }

  .demo-caption {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 520px) {
  .hero-proof-head {
    align-items: start;
    flex-direction: column;
  }

  .hero-proof-note {
    max-width: none;
    text-align: left;
  }

  .hero-actions {
    display: grid;
  }

  .hero-primary,
  .hero-secondary {
    width: 100%;
  }
}
</style>
