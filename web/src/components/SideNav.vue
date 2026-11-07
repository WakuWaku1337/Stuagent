<script setup lang="ts">
import { useRoute } from 'vue-router';
import {
  ChatDotRound,
  Clock,
  Collection,
  DataAnalysis,
  DataBoard,
  DataLine,
  EditPen,
  Notebook,
  Reading,
  Setting,
  Timer,
  TrendCharts,
} from '@element-plus/icons-vue';
import type { Component } from 'vue';

defineEmits<{ navigate: [] }>();

interface NavItem {
  to: string;
  label: string;
  icon: Component;
}

const groups: { label: string; items: NavItem[] }[] = [
  {
    label: '学习',
    items: [
      { to: '/', label: '学习台', icon: DataBoard },
      { to: '/chat', label: '智学对话', icon: ChatDotRound },
      { to: '/documents', label: '资料库', icon: Collection },
      { to: '/courseware', label: '交互课件', icon: Reading },
    ],
  },
  {
    label: '练习',
    items: [
      { to: '/quiz', label: '智能出题', icon: EditPen },
      { to: '/exam', label: '模拟考试', icon: Timer },
      { to: '/wrongbook', label: '错题本', icon: Notebook },
    ],
  },
  {
    label: '洞察',
    items: [
      { to: '/mastery', label: '掌握度', icon: DataAnalysis },
      { to: '/review', label: '考试复盘', icon: TrendCharts },
      { to: '/tasks', label: '后台任务', icon: Clock },
    ],
  },
  {
    label: '系统',
    items: [
      { to: '/usage', label: '用量统计', icon: DataLine },
      { to: '/settings', label: '模型设置', icon: Setting },
    ],
  },
];

const route = useRoute();

function isActive(to: string) {
  return to === '/' ? route.path === '/' : route.path.startsWith(to);
}
</script>

<template>
  <div class="nav-shell">
    <router-link to="/" class="brand" @click="$emit('navigate')">
      <span class="brand-mark" aria-hidden="true"><span /><span /><span /><span /></span>
      <span>
        <span class="brand-name">智学</span>
        <span class="brand-tag">EDUPI · LOCAL</span>
      </span>
    </router-link>

    <nav class="nav" aria-label="主导航">
      <div v-for="group in groups" :key="group.label" class="nav-group">
        <p class="nav-group-label">{{ group.label }}</p>
        <router-link
          v-for="item in group.items"
          :key="item.to"
          :to="item.to"
          class="nav-item"
          :class="{ active: isActive(item.to) }"
          @click="$emit('navigate')"
        >
          <el-icon class="nav-icon"><component :is="item.icon" /></el-icon>
          <span>{{ item.label }}</span>
        </router-link>
      </div>
    </nav>

    <div class="nav-foot">
      本地优先 · 数据留在本机<br />
      EduPi 0.1 · 高中学习智能体
    </div>
  </div>
</template>
