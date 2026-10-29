<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useStore } from '../store';

const store = useStore();
/* 单租户：已有账号时注册入口永久关闭，直接进登录态 */
const mode = ref<'login' | 'register'>(store.needSetup ? 'register' : 'login');
const username = ref('');
const password = ref('');
/* 登录有效期：day=一天 week=一周 long=长期；默认一天，与后端 SESSION_HOURS 一致 */
const duration = ref<'day' | 'week' | 'long'>('day');
const err = ref('');
const loading = ref(false);

/* 记住上一个登录人员：仅存用户名 + 有效期选择（不存密码），下次自动回填，
   纯本地 localStorage，与服务器端会话 Cookie 无关。 */
const LS_KEY = 'udenav:lastLogin';
function loadRemembered() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return;
    const d = JSON.parse(raw) as { username?: string; duration?: string };
    if (d.username) username.value = d.username;
    if (d.duration === 'day' || d.duration === 'week' || d.duration === 'long') duration.value = d.duration;
  } catch { /* 脏值忽略 */ }
}
function remember() {
  try { localStorage.setItem(LS_KEY, JSON.stringify({ username: username.value, duration: duration.value })); } catch { /* 隐私模式等忽略 */ }
}

onMounted(loadRemembered);

/**
 * 登录/注册成功后的去向：不留在后台界面，直接回导航页。
 *   内嵌在导航页弹窗里 → 关掉弹窗（instant：别让后台面板跟着淡出露一帧）
 *   独立访问 /admin    → 回站点首页
 * 想管理的时候再点工具条上的「管理后台」，那时已登录，直接进面板。
 */
function leaveToNav() {
  loading.value = false;
  const w = window as any;
  if (typeof w.__udenavClose === 'function') { w.__udenavClose(true); return; }
  location.replace('/');
}

async function submit() {
  /* 防重复提交：el-form 的 @submit 与密码框回车都会触发本函数，
     不加守卫会在一次回车里连发两次登录请求，弹出两条「欢迎回来」。 */
  if (loading.value) return;
  err.value = '';
  loading.value = true;
  try {
    if (mode.value === 'login') await store.login(username.value, password.value, duration.value);
    else await store.register(username.value, password.value);
    remember();
    leaveToNav();
  } catch (e: any) {
    err.value = e.message;
    loading.value = false;
  }
}
</script>

<template>
  <div class="sp-login">
    <div class="sp-card">
      <div class="brand">
        <svg class="brand-logo" viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <defs>
            <linearGradient id="udenavG" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stop-color="#66b1ff" />
              <stop offset="1" stop-color="#337ecc" />
            </linearGradient>
          </defs>
          <rect x="3" y="3" width="42" height="42" rx="13" fill="url(#udenavG)" />
          <path d="M24 10 L28.6 28 L24 25 L19.4 28 Z" fill="#fff" />
          <circle cx="24" cy="24" r="2.4" fill="#fff" opacity="0.9" />
        </svg>
        <div class="brand-text">
          <div class="brand-name">UDeNav</div>
          <div class="brand-sub">导航面板 · 管理后台</div>
        </div>
      </div>
      <h1>{{ mode === 'login' ? '登录管理后台' : '注册管理后台' }}</h1>
      <p class="tip">{{ mode === 'login' ? '使用管理员账号登录' : '首次使用请注册唯一管理员账号' }}</p>
      <el-form @submit.prevent="submit" label-position="top">
        <el-form-item label="用户名">
          <el-input v-model="username" placeholder="3-20 位字母/数字/下划线" autocomplete="username" />
        </el-form-item>
        <el-form-item label="密码">
          <el-input v-model="password" type="password" placeholder="至少 4 位" autocomplete="current-password" />
        </el-form-item>
        <el-form-item v-if="mode === 'login'" label="登录有效期" class="exp-row">
          <el-radio-group v-model="duration">
            <el-radio-button value="day">一天</el-radio-button>
            <el-radio-button value="week">一周</el-radio-button>
            <el-radio-button value="long">长期</el-radio-button>
          </el-radio-group>
        </el-form-item>
        <div v-if="err" class="err">{{ err }}</div>
        <el-button type="primary" native-type="submit" :loading="loading" style="width:100%;margin-top:4px">
          {{ mode === 'login' ? '登录' : '注册' }}
        </el-button>
      </el-form>
      <div v-if="store.needSetup" style="text-align:center;margin-top:16px;font-size:13px">
        <el-link type="primary" :underline="'never'" @click="mode = mode === 'login' ? 'register' : 'login'">
          {{ mode === 'login' ? '还没有账号？注册' : '已有账号？登录' }}
        </el-link>
      </div>
    </div>
  </div>
</template>

<style scoped>
  .err { color: var(--sp-danger); font-size: 13px; margin: 0 0 10px; }
  .exp-row :deep(.el-radio-group) { flex-wrap: wrap; }
</style>
