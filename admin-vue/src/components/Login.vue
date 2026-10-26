<script setup lang="ts">
import { ref } from 'vue';
import { useStore } from '../store';

const store = useStore();
const mode = ref<'login' | 'register'>('login');
const username = ref('');
const password = ref('');
const err = ref('');
const loading = ref(false);

async function submit() {
  err.value = '';
  loading.value = true;
  try {
    if (mode.value === 'login') await store.login(username.value, password.value);
    else await store.register(username.value, password.value);
  } catch (e: any) { err.value = e.message; }
  loading.value = false;
}
</script>

<template>
  <div class="sp-login">
    <div class="sp-card">
      <h1>{{ mode === 'login' ? '登录管理后台' : '注册管理后台' }}</h1>
      <p class="tip">{{ mode === 'login' ? '使用管理员账号登录' : '首次使用请注册（唯一 owner 账号）' }}</p>
      <el-form @submit.prevent="submit" label-position="top">
        <el-form-item label="用户名">
          <el-input v-model="username" placeholder="3-20 位字母/数字/下划线" autocomplete="username" />
        </el-form-item>
        <el-form-item label="密码">
          <el-input v-model="password" type="password" placeholder="至少 8 位" autocomplete="current-password" @keyup.enter="submit" />
        </el-form-item>
        <div v-if="err" class="err">{{ err }}</div>
        <el-button type="success" native-type="submit" :loading="loading" style="width:100%;margin-top:4px">
          {{ mode === 'login' ? '登录' : '注册' }}
        </el-button>
      </el-form>
      <div style="text-align:center;margin-top:16px;font-size:13px">
        <el-link type="primary" :underline="'never'" @click="mode = mode === 'login' ? 'register' : 'login'">
          {{ mode === 'login' ? '还没有账号？注册' : '已有账号？登录' }}
        </el-link>
      </div>
    </div>
  </div>
</template>

<style scoped>
  .err { color: #f78989; font-size: 13px; margin: 0 0 10px; }
</style>
