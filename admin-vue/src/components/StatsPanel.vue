<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { get } from '../api';

const stats = ref<any>({});

async function load() {
  stats.value = await get('/api/admin/stats');
}
onMounted(load);
</script>

<template>
  <div class="sp-page">
    <div class="sp-page-head">
      <div>
        <h2>访问统计</h2>
        <div class="sub">来自访客打开首页时的请求计数</div>
      </div>
      <el-button @click="load">刷新</el-button>
    </div>

    <div class="stat-grid">
      <div class="sp-card stat-card">
        <div class="stat-label">累计访问</div>
        <div class="stat-num">{{ stats.total_visits || 0 }}</div>
      </div>
      <div class="sp-card stat-card">
        <div class="stat-label">最近 24 小时</div>
        <div class="stat-num">{{ stats.visits_24h || 0 }}</div>
      </div>
      <div class="sp-card stat-card">
        <div class="stat-label">分组</div>
        <div class="stat-num">{{ stats.groups || 0 }}</div>
      </div>
      <div class="sp-card stat-card">
        <div class="stat-label">卡片</div>
        <div class="stat-num">{{ stats.icons || 0 }}</div>
      </div>
    </div>

    <div class="sp-card">
      <div class="sp-card-title">说明</div>
      <div class="note">
        访问计数来自访客打开首页时的 /api/public/panel 请求，只记 IP 哈希不记明文，
        不收集任何个人信息。
      </div>
    </div>
  </div>
</template>

<style scoped>
  .stat-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; margin-bottom: 2px; }
  .stat-card { margin-bottom: 0; padding: 18px 20px; }
  .stat-label { color: var(--sp-dim); font-size: 13px; margin-bottom: 8px; }
  .stat-num { font-size: 28px; font-weight: 700; color: var(--sp-text); letter-spacing: .5px; }
  .note { color: var(--sp-faint); font-size: 12.5px; line-height: 1.8; }
  @media (max-width: 768px) { .stat-grid { grid-template-columns: repeat(2, 1fr); } }
</style>
