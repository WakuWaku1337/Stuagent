<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import * as echarts from 'echarts';

interface MasteryItem {
  knowledge_point: string;
  probability: number;
  percent: number;
  mastered: boolean;
  correct_count: number;
  wrong_count: number;
}

const items = ref<MasteryItem[]>([]);
const chartEl = ref<HTMLElement>();
let chart: echarts.ECharts | null = null;

async function load() {
  const res = await fetch('/api/mastery');
  const data = await res.json();
  items.value = data.mastery ?? [];
}

function render() {
  if (!chartEl.value) return;
  chart ??= echarts.init(chartEl.value);
  chart.setOption({
    grid: { left: 120, right: 30, top: 20, bottom: 30 },
    xAxis: { type: 'value', min: 0, max: 100, name: '%' },
    yAxis: { type: 'category', data: items.value.map((i) => i.knowledge_point) },
    tooltip: { trigger: 'axis' },
    series: [
      {
        type: 'bar',
        data: items.value.map((i) => ({
          value: i.percent,
          itemStyle: { color: i.mastered ? '#16a34a' : i.percent >= 50 ? '#2563eb' : '#f59e0b' },
        })),
        barWidth: 18,
        label: { show: true, position: 'right', formatter: '{c}%' },
      },
    ],
  });
}

watch(items, render, { deep: true });
onMounted(async () => {
  await load();
  render();
});
</script>

<template>
  <main class="page">
    <header class="head">
      <router-link to="/" class="back">← 首页</router-link>
      <h2>掌握度</h2>
      <router-link to="/quiz" class="back">去练习 →</router-link>
    </header>
    <section class="panel">
      <div ref="chartEl" class="chart"></div>
    </section>
    <section class="panel">
      <h3>薄弱知识点</h3>
      <p v-if="items.length === 0" class="empty">还没有数据，去做几道题吧。</p>
      <ul>
        <li v-for="i in items.filter((x) => !x.mastered).slice(0, 8)" :key="i.knowledge_point">
          <span class="kp">{{ i.knowledge_point }}</span>
          <span class="pct">{{ i.percent }}%</span>
          <span class="counts">对 {{ i.correct_count }} / 错 {{ i.wrong_count }}</span>
        </li>
      </ul>
    </section>
  </main>
</template>

<style scoped>
.page { max-width: 820px; margin: 0 auto; padding: 24px 20px; }
.head { display: flex; align-items: center; gap: 16px; }
.head h2 { flex: 1; margin: 0; font-size: 20px; }
.back { color: #2563eb; text-decoration: none; }
.panel { background: #fff; border-radius: 10px; padding: 16px; margin: 14px 0; }
.chart { height: 320px; }
h3 { margin: 0 0 10px; font-size: 16px; }
ul { list-style: none; padding: 0; margin: 0; }
li { display: flex; gap: 14px; padding: 8px 0; border-bottom: 1px solid #f0f1f3; }
.kp { flex: 1; }
.pct { color: #b45309; width: 60px; }
.counts { color: #6b7280; font-size: 13px; }
.empty { color: #6b7280; }
</style>