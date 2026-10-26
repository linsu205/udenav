import { createApp } from 'vue';
import { createPinia } from 'pinia';
import ElementPlus from 'element-plus';
import 'element-plus/dist/index.css';
import 'element-plus/theme-chalk/dark/css-vars.css';
import './styles/theme.css';
import App from './App.vue';

// 激活 Element Plus 暗色模式（不加这个控件全是白底）
document.documentElement.classList.add('dark');

const app = createApp(App);
app.use(createPinia());
app.use(ElementPlus, { size: 'default' });
app.mount('#app');

// 隐藏 loading 骨架
document.getElementById('boot')?.remove();
