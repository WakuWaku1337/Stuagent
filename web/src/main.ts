import { createApp } from 'vue';
import { createPinia } from 'pinia';
import ElementPlus from 'element-plus';
import zhCn from 'element-plus/es/locale/lang/zh-cn';
import 'element-plus/dist/index.css';
import 'katex/dist/katex.min.css';
import './styles/app.css';
import App from './App.vue';
import router from './router';
import { useAuthStore } from './stores/auth';

const app = createApp(App);
const pinia = createPinia();
app.use(pinia);

const auth = useAuthStore(pinia);

window.addEventListener('edupi:unauthorized', () => {
  auth.user = null;
  const current = router.currentRoute.value;
  if (current.meta.public !== true) {
    void router.push({ name: 'login', query: { redirect: current.fullPath } });
  }
});

app
  .use(router)
  .use(ElementPlus, { locale: zhCn })
  .mount('#app');
