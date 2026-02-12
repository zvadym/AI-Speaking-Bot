import { createRouter, createWebHistory } from 'vue-router';
import HomePage from './pages/HomePage.vue';
import TeachersPage from './pages/TeachersPage.vue';
import TeacherProfilePage from './pages/TeacherProfilePage.vue';
import BlogPostPage from './pages/BlogPostPage.vue';
import NotFoundPage from './pages/NotFoundPage.vue';
import { getInitialLocale, supportedLocales } from './i18n.js';

const LOCALE_PATTERN = supportedLocales.join('|');

function getRedirectLocale() {
  return getInitialLocale();
}

const routes = [
  {
    path: `/:locale(${LOCALE_PATTERN})`,
    name: 'home',
    component: HomePage
  },
  {
    path: `/:locale(${LOCALE_PATTERN})/teachers`,
    name: 'teachers',
    component: TeachersPage
  },
  {
    path: `/:locale(${LOCALE_PATTERN})/teachers/:slug`,
    name: 'teacher',
    component: TeacherProfilePage,
    props: (route) => ({ slug: (route.params.slug || '').toString() })
  },
  {
    path: `/:locale(${LOCALE_PATTERN})/blog/:slug`,
    name: 'blog-post',
    component: BlogPostPage,
    props: (route) => ({ slug: (route.params.slug || '').toString() })
  },
  {
    path: '/',
    redirect: (to) => ({
      name: 'home',
      params: { locale: getRedirectLocale() },
      query: to.query,
      hash: to.hash
    })
  },
  {
    path: '/teachers',
    redirect: (to) => ({
      name: 'teachers',
      params: { locale: getRedirectLocale() },
      query: to.query,
      hash: to.hash
    })
  },
  {
    path: '/teachers/:slug',
    redirect: (to) => ({
      name: 'teacher',
      params: { locale: getRedirectLocale(), slug: to.params.slug },
      query: to.query,
      hash: to.hash
    })
  },
  {
    path: '/blog/:slug',
    redirect: (to) => ({
      name: 'blog-post',
      params: { locale: getRedirectLocale(), slug: to.params.slug },
      query: to.query,
      hash: to.hash
    })
  },
  {
    path: `/:locale(${LOCALE_PATTERN})/:pathMatch(.*)*`,
    name: 'not-found',
    component: NotFoundPage
  },
  {
    path: '/:pathMatch(.*)*',
    redirect: (to) => ({
      name: 'not-found',
      params: {
        locale: getRedirectLocale(),
        pathMatch: to.params.pathMatch
      },
      query: to.query,
      hash: to.hash
    })
  }
];

const router = createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior(to, _from, savedPosition) {
    if (savedPosition) return savedPosition;
    if (to.hash) {
      return {
        el: to.hash,
        top: 88,
        behavior: 'smooth'
      };
    }
    return { top: 0 };
  }
});

export default router;
