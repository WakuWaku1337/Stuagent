<script setup lang="ts">
import type { Component } from 'vue';

withDefaults(
  defineProps<{
    label: string;
    value: number | string;
    suffix?: string;
    hint?: string;
    icon?: Component;
    tone?: 'ink' | 'accent' | 'success' | 'warning';
  }>(),
  { tone: 'ink' },
);
</script>

<template>
  <div class="metric" :class="`tone-${tone}`">
    <div class="metric-head">
      <span class="metric-label">{{ label }}</span>
      <span v-if="icon" class="metric-icon">
        <el-icon><component :is="icon" /></el-icon>
      </span>
    </div>
    <div class="metric-value">
      <el-statistic v-if="typeof value === 'number'" :value="value">
        <template v-if="suffix" #suffix>
          <span class="metric-suffix">{{ suffix }}</span>
        </template>
      </el-statistic>
      <span v-else class="metric-text">{{ value }}</span>
    </div>
    <p v-if="hint" class="metric-hint">{{ hint }}</p>
  </div>
</template>
