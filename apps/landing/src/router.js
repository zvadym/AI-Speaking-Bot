import { createRouter, createWebHistory } from 'vue-router';
import HomePage from './pages/HomePage.vue';
import TeachersPage from './pages/TeachersPage.vue';
import TeacherProfilePage from './pages/TeacherProfilePage.vue';
import NotFoundPage from './pages/NotFoundPage.vue';

const routes = [
  {
    path: '/',
    name: 'home',
    component: HomePage,
    meta: { title: 'AI Language School' }
  },
  {
    path: '/teachers',
    name: 'teachers',
    component: TeachersPage,
    meta: { title: 'Teachers — AI Language School' }
  },
  {
    path: '/teachers/:slug',
    name: 'teacher',
    component: TeacherProfilePage,
    props: true,
    meta: { title: 'Teacher — AI Language School' }
  },
  {
    path: '/:pathMatch(.*)*',
    name: 'not-found',
    component: NotFoundPage,
    meta: { title: 'Not found — AI Language School' }
  }
];

const router = createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior() {
    return { top: 0 };
  }
});

router.afterEach((to) => {
  document.title = (to?.meta?.title || 'AI Language School').toString();
});

export default router;

