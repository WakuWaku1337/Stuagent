<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { fetchHealth, type HealthResponse } from '../api/http';

const health = ref<HealthResponse | null>(null);
const error = ref('');

onMounted(async () => {
  try {
    health.value = await fetchHealth();
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  }
});
</script>

<template>
  <main style="max-width: 720px; margin: 80px auto; padding: 0 24px">
    <h1>智学 EduPi</h1>
    <p>本地优先的高中学习智能体 · 工程骨架（阶段 A）</p>
    <section v-if="health" style="background: #fff; border-radius: 8px; padding: 16px 20px">
      <strong style="color: #16a34a">后端已联通</strong>
      <pre style="margin: 8px 0 0">{{ JSON.stringify(health, null, 2) }}</pre>
    </section>
    <section v-else-if="error" style="background: #fff; border-radius: 8px; padding: 16px 20px">
      <strong style="color: #dc2626">后端未联通</strong>
      <p>{{ error }}</p>
      <p>请先运行 <code>npm run dev:server</code>（端口 3000）。</p>
    </section>
    <p v-else>正在检查后端连接…</p>
    <p style="margin-top: 24px">
      <router-link to="/chat" style="color: #2563eb">进入对话页 →</router-link>
      &nbsp;&nbsp;
      <router-link to="/documents" style="color: #2563eb">资料库 →</router-link>
      &nbsp;&nbsp;
      <router-link to="/quiz" style="color: #2563eb">智能出题 →</router-link>
      &nbsp;&nbsp;
      <router-link to="/wrongbook" style="color: #2563eb">错题本 →</router-link>
      &nbsp;&nbsp;
      <router-link to="/mastery" style="color: #2563eb">掌握度 →</router-link>
      &nbsp;&nbsp;
      <router-link to="/exam" style="color: #2563eb">模拟考试 →</router-link>
      &nbsp;&nbsp;
      <router-link to="/tasks" style="color: #2563eb">后台任务 →</router-link>
    </p>
  </main>
</template>