import { createApp } from 'vue';
import { createPinia } from 'pinia';
import ElementPlus from 'element-plus';
import 'element-plus/dist/index.css';
import 'element-plus/theme-chalk/dark/css-vars.css';
import './styles/theme.css';
import App from './App.vue';
import { applyTheme, watchThemeFromParent } from './lib/theme';

// 主题：默认深色（防闪白），随后被 /api/public/config 或父页 postMessage 覆盖
applyTheme('dark');
watchThemeFromParent();

const app = createApp(App);
app.use(createPinia());
app.use(ElementPlus, { size: 'default' });
app.mount('#app');

// 隐藏 loading 骨架
document.getElementById('boot')?.remove();
