<template>
  <section class="page">
    <div class="container">
      <div v-if="post" class="post">
        <div class="top">
          <RouterLink class="btn ghost back" to="/#blog">← {{ t('blog.backToBlog') }}</RouterLink>
          <div class="muted meta">
            <span>{{ publishedLabel }}</span>
            <span v-if="post.readingMinutes"> • {{ t('blog.readingMinutes', { n: post.readingMinutes }) }}</span>
          </div>
        </div>

        <h1 class="h1 title">{{ postTitle }}</h1>
        <p class="muted lead">{{ postExcerpt }}</p>

        <article class="card body">
          <template v-for="(block, idx) in blocks" :key="idx">
            <h2 v-if="block.type === 'h2'" class="h2 section-title">{{ block.text }}</h2>
            <p v-else-if="block.type === 'p'" class="para">{{ block.text }}</p>
            <ul v-else-if="block.type === 'ul'" class="list">
              <li v-for="(item, i) in block.items" :key="i">{{ item }}</li>
            </ul>
            <div v-else-if="block.type === 'callout'" class="callout">
              <div class="callout-mark" aria-hidden="true">✦</div>
              <div class="callout-text">{{ block.text }}</div>
            </div>
          </template>
        </article>
      </div>

      <div v-else class="card">
        <h1 class="h2">{{ t('notFound.title') }}</h1>
        <p class="muted">{{ t('notFound.desc') }}</p>
        <RouterLink class="btn" to="/#blog">{{ t('blog.backToBlog') }}</RouterLink>
      </div>
    </div>
  </section>
</template>

<script setup>
import { computed } from 'vue';
import { RouterLink } from 'vue-router';
import { getBlogPostBySlug } from '../data/blogPosts.js';
import { useI18n } from '../i18n.js';

const props = defineProps({
  slug: { type: String, required: true }
});

const { t, locale } = useI18n();
const post = computed(() => getBlogPostBySlug(props.slug));

const postTitle = computed(() => {
  const map = post.value?.title || {};
  return (map[locale.value] || map.en || map.uk || map.it || post.value?.slug || '').toString();
});

const postExcerpt = computed(() => {
  const map = post.value?.excerpt || {};
  return (map[locale.value] || map.en || map.uk || map.it || '').toString();
});

const blocks = computed(() => {
  const content = post.value?.content || {};
  return content[locale.value] || content.en || [];
});

const publishedLabel = computed(() => {
  const dateRaw = (post.value?.publishedAt || '').toString();
  const d = new Date(dateRaw);
  if (!Number.isFinite(d.getTime())) return dateRaw;
  try {
    return new Intl.DateTimeFormat(locale.value, { year: 'numeric', month: 'short', day: 'numeric' }).format(d);
  } catch {
    return dateRaw;
  }
});
</script>

<style scoped>
.page {
  padding: 56px 0;
}

.top {
  display: flex;
  justify-content: space-between;
  gap: 14px;
  flex-wrap: wrap;
  align-items: center;
}

.back {
  padding-left: 0;
  padding-right: 0;
}

.meta {
  font-size: 14px;
}

.title {
  margin-top: 18px;
}

.lead {
  margin: 12px 0 0;
  max-width: 70ch;
  line-height: 1.7;
  font-size: 18px;
}

.body {
  margin-top: 22px;
  padding: 26px;
}

.section-title {
  margin-top: 22px;
}

.section-title:first-child {
  margin-top: 0;
}

.para {
  margin: 12px 0 0;
  line-height: 1.8;
}

.list {
  margin: 12px 0 0;
  padding-left: 18px;
  line-height: 1.8;
}

.callout {
  margin-top: 16px;
  padding: 14px 16px;
  border-radius: var(--radius-lg);
  border: 1px solid var(--border);
  background: color-mix(in srgb, var(--surface) 65%, var(--bg));
  display: grid;
  grid-template-columns: 24px 1fr;
  gap: 10px;
  align-items: start;
}

.callout-mark {
  width: 24px;
  height: 24px;
  border-radius: 999px;
  display: grid;
  place-items: center;
  border: 1px solid var(--border);
  background: var(--bg);
}

.callout-text {
  line-height: 1.7;
}
</style>

