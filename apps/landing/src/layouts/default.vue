<template>
  <div class="app">
    <SiteHeader />
    <main>
      <slot />
    </main>
    <SiteFooter v-if="!isHome" />
  </div>
</template>

<script setup>
import { computed } from 'vue';
import SiteHeader from '~/components/SiteHeader.vue';
import SiteFooter from '~/components/SiteFooter.vue';
import { stripLocalePrefix, useI18n } from '~/i18n.js';

const route = useRoute();
const { locale } = useI18n();

const isHome = computed(() => {
  const suffix = stripLocalePrefix(route.path || '/');
  return suffix === '/';
});

useHead(() => ({
  htmlAttrs: {
    lang: locale.value,
    class: isHome.value ? 'snap-home' : undefined
  }
}));
</script>
