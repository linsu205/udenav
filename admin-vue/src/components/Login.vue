<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { User, Lock } from '@element-plus/icons-vue';
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
      <!-- 品牌区：项目内置 logo（蓝底 U + 上升箭头，与站点 favicon 同一枚）+ 两行品牌文字 -->
      <div class="brand">
        <svg class="brand-logo" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
          <rect width="64" height="64" rx="16" fill="#409EFF" />
          <path d="M22 22 V36 Q22 46 32 46 Q42 46 42 36 V14" fill="none" stroke="#FFFFFF" stroke-width="7" stroke-linecap="round" />
          <path d="M34 22 L42 12 L50 22" fill="none" stroke="#FFFFFF" stroke-width="6" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
        <div class="brand-text">
          <span class="brand-name">UDeNav</span>
          <span class="brand-sub">导航面板 · 管理后台</span>
        </div>
      </div>
      <h1>{{ mode === 'login' ? '登录管理后台' : '注册管理后台' }}</h1>
      <el-form @submit.prevent="submit" label-position="top" class="login-form">
        <!-- 用户名 / 密码：label 内嵌在输入框左侧（图标 + 文字 + 竖分隔线） -->
        <el-form-item class="field">
          <el-input v-model="username" size="large" placeholder="请输入用户名" autocomplete="username">
            <template #prefix>
              <span class="in-label"><el-icon><User /></el-icon><span>用户名</span></span>
            </template>
          </el-input>
        </el-form-item>
        <el-form-item class="field">
          <el-input v-model="password" size="large" type="password" placeholder="请输入密码" autocomplete="current-password" show-password>
            <template #prefix>
              <!-- 「密码」二字之间补两个半角空格（约 7px），既不太挤也不会像两个字被拉开 -->
              <span class="in-label"><el-icon><Lock /></el-icon><span>密&nbsp;&nbsp;码</span></span>
            </template>
          </el-input>
        </el-form-item>
        <el-form-item v-if="mode === 'login'" class="exp-row">
          <el-radio-group v-model="duration" size="small">
            <el-radio-button value="day">一天</el-radio-button>
            <el-radio-button value="week">一周</el-radio-button>
            <el-radio-button value="long">长期</el-radio-button>
          </el-radio-group>
        </el-form-item>
        <div v-if="err" class="err">{{ err }}</div>
        <el-button type="primary" native-type="submit" :loading="loading" class="submit-btn">
          {{ mode === 'login' ? '登录' : '注册' }}
        </el-button>
      </el-form>
      <div v-if="store.needSetup" class="switch-row">
        <el-link type="primary" :underline="'never'" @click="mode = mode === 'login' ? 'register' : 'login'">
          {{ mode === 'login' ? '还没有账号？注册' : '已有账号？登录' }}
        </el-link>
      </div>
    </div>
  </div>
</template>
