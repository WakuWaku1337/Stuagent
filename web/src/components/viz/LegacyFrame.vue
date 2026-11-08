<script setup lang="ts">
import type { Visualization } from '../../api/visualize';

defineProps<{ visualization: Visualization }>();

function reset() {
  // 旧版单文件课件在沙箱 iframe 内自管交互
}

async function screenshot(): Promise<string | null> {
  return null;
}

defineExpose({ reset, screenshot });
</script>

<template>
  <div class="legacy-wrap">
    <iframe
      class="legacy-frame"
      :src="visualization.html_url"
      sandbox="allow-scripts"
      title="旧版交互课件"
    />
    <p class="legacy-note">旧版单文件 HTML 课件（合并前生成），在沙箱中离线运行；新生成的可视化已改用统一渲染器。</p>
  </div>
</template>

<style scoped>
.legacy-frame {
  width: 100%;
  height: 480px;
  border: 1px solid var(--line);
  border-radius: 14px;
  background: #fff;
}

.legacy-note {
  margin-top: 8px;
  font-size: 11.5px;
  color: var(--faint);
}
</style>