import { createRouter, createWebHistory } from 'vue-router';
import HomePage from './pages/HomePage.vue';
import TeachersPage from './pages/TeachersPage.vue';
import TeacherProfilePage from './pages/TeacherProfilePage.vue';
import BlogPostPage from './pages/BlogPostPage.vue';
import NotFoundPage from './pages/NotFoundPage.vue';

const routes = [
  {
    path: '/',
    name: 'home',
    component: HomePage
  },
  {
    path: '/teachers',
    name: 'teachers',
    component: TeachersPage
  },
  {
    path: '/teachers/:slug',
    name: 'teacher',
    component: TeacherProfilePage,
    props: true
  },
  {
    path: '/blog/:slug',
    name: 'blog-post',
    component: BlogPostPage,
    props: true
  },
  {
    path: '/:pathMatch(.*)*',
    name: 'not-found',
    component: NotFoundPage
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
