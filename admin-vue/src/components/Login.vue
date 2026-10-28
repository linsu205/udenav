<script setup lang="ts">
import { ref } from 'vue';
import { useStore } from '../store';

const store = useStore();
/* 单租户：已有账号时注册入口永久关闭，直接进登录态 */
const mode = ref<'login' | 'register'>(store.needSetup ? 'register' : 'login');
const username = ref('');
const password = ref('');
const err = ref('');
const loading = ref(false);

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
  err.value = '';
  loading.value = true;
  try {
    if (mode.value === 'login') await store.login(username.value, password.value);
    else await store.register(username.value, password.value);
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
      <h1>{{ mode === 'login' ? '登录管理后台' : '注册管理后台' }}</h1>
      <p class="tip">{{ mode === 'login' ? '使用管理员账号登录' : '首次使用请注册唯一管理员账号' }}</p>
      <el-form @submit.prevent="submit" label-position="top">
        <el-form-item label="用户名">
          <el-input v-model="username" placeholder="3-20 位字母/数字/下划线" autocomplete="username" />
        </el-form-item>
        <el-form-item label="密码">
          <el-input v-model="password" type="password" placeholder="至少 8 位" autocomplete="current-password" @keyup.enter="submit" />
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
</style>
