<script setup lang="ts">
import { onMounted, watch } from 'vue';
import { useStore } from './store';
import Login from './components/Login.vue';
import Dashboard from './components/Dashboard.vue';

const store = useStore();
onMounted(async () => {
  await store.checkLogin();
  if (store.loggedIn) await store.loadAll();
  else store.loading = false;
});
watch(() => store.loggedIn, async v => { if (v) await store.loadAll(); });
</script>

<template>
  <div v-if="store.loading" class="booting">
    <div class="spin"></div>
    <span>加载中…</span>
  </div>
  <Login v-else-if="!store.loggedIn" />
  <Dashboard v-else />
</template>

<style scoped>
  .booting {
    min-height: 100vh; display: flex; align-items: center; justify-content: center; gap: 12px;
    color: var(--sp-dim, #9aa3ab); font-size: 14px; background: #17191c;
  }
  .spin {
    width: 18px; height: 18px; border-radius: 50%;
    border: 2px solid #2e343a; border-top-color: #2fbf6b;
    animation: r .8s linear infinite;
  }
  @keyframes r { to { transform: rotate(360deg); } }
</style>
