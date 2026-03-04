<template>
  <div class="app layout-shell">
    <SiteHeader />
    <main class="layout-main">
      <slot />
    </main>
    <SiteFooter v-if="!isHome" />
  </div>
</template>

<script setup>
import { computed, watchEffect } from 'vue';
import SiteHeader from '~/components/SiteHeader.vue';
import SiteFooter from '~/components/SiteFooter.vue';
import { getLocaleDirection, stripLocalePrefix, useI18n } from '~/i18n.js';
import { persistLandingStartPayloadFromQuery } from '~/lib/telegram.js';

const route = useRoute();
const { locale } = useI18n();

const isHome = computed(() => {
  const suffix = stripLocalePrefix(route.path || '/');
  return suffix === '/';
});

watchEffect(() => {
  persistLandingStartPayloadFromQuery(route.query);
});

useHead(() => ({
  htmlAttrs: {
    lang: locale.value,
    dir: getLocaleDirection(locale.value),
    class: isHome.value ? 'snap-home' : undefined
  }
}));
</script>

<style scoped>
.layout-shell {
  min-height: 100vh;
  min-height: 100svh;
  min-height: 100dvh;
  display: flex;
  flex-direction: column;
}

.layout-main {
  flex: 1 0 auto;
  min-width: 0;
}
</style>
