import { createApp } from 'vue';
import App from './App.vue';
import './style.css';
import { i18n } from './i18n.js';
import { initAnalytics } from './lib/metrics.js';

initAnalytics();
createApp(App).use(i18n).mount('#app');
