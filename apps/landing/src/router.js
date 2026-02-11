import { createRouter, createWebHistory } from 'vue-router';
import HomePage from './pages/HomePage.vue';
import TeachersPage from './pages/TeachersPage.vue';
import TeacherProfilePage from './pages/TeacherProfilePage.vue';
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
    path: '/:pathMatch(.*)*',
    name: 'not-found',
    component: NotFoundPage
  }
];

const router = createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior() {
    return { top: 0 };
  }
});

export default router;
