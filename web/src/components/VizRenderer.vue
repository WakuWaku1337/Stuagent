<script setup lang="ts">
import { computed, ref } from 'vue';
import { ElMessage } from 'element-plus';
import type { Visualization } from '../api/visualize';
import { typeLabel } from '../utils/visualize';
import ThreeScene from './viz/ThreeScene.vue';
import FunctionChart from './viz/FunctionChart.vue';
import MoleculeChart from './viz/MoleculeChart.vue';
import ShapeSvg from './viz/ShapeSvg.vue';
import LegacyFrame from './viz/LegacyFrame.vue';

const props = defineProps<{ visualization: Visualization }>();

const showAux = ref(true);
const showLabels = ref(true);
const autoRotate = ref(false);
const child = ref<{ reset: () => void; screenshot: () => Promise<string | null> } | null>(null);
const wrap = ref<HTMLDivElement>();

const is3D = computed(() => ['geometry3d', 'biology', 'function3d', 'terrain'].includes(props.visualization.type));
const hasAux = computed(() => props.visualization.type === 'geometry3d' && Array.isArray(props.visualization.spec.auxiliary));

const component = computed(() => {
  const type = props.visualization.type;
  if (type === 'legacy-html') return LegacyFrame;
  if (type === 'molecule') return MoleculeChart;
  if (type === 'function2d' || type === 'conic') return FunctionChart;
  if (type === 'physics' || type === 'diagram') return ShapeSvg;
  return ThreeScene;
});

async function takeScreenshot() {
  const uri = await child.value?.screenshot();
  if (!uri) {
    ElMessage.info('当前类型不支持截图');
    return;
  }
  const anchor = document.createElement('a');
  anchor.href = uri;
  anchor.download = `${props.visualization.title || 'visualization'}.png`;
  anchor.click();
  ElMessage.success('截图已下载');
}

async function toggleFullscreen() {
  if (!wrap.value) return;
  if (document.fullscreenElement) await document.exitFullscreen();
  else await wrap.value.requestFullscreen();
}
</script>

<template>
  <div ref="wrap" class="viz-renderer">
    <div class="viz-renderer-head">
      <el-tag size="small" effect="plain" type="info">{{ typeLabel(visualization.type) }}</el-tag>
      <span class="viz-renderer-title">{{ visualization.title }}</span>
      <el-tag v-if="visualization.kind === 'preset'" size="small" type="success" effect="plain">预置课件</el-tag>
    </div>

    <div class="viz-toolbar">
      <el-button size="small" @click="child?.reset()">重置视角</el-button>
      <el-button v-if="is3D" size="small" :type="autoRotate ? 'primary' : 'default'" @click="autoRotate = !autoRotate">
        自动旋转
      </el-button>
      <el-button v-if="hasAux" size="small" :type="showAux ? 'primary' : 'default'" @click="showAux = !showAux">
        辅助线/截面
      </el-button>
      <el-button v-if="is3D" size="small" :type="showLabels ? 'primary' : 'default'" @click="showLabels = !showLabels">
        标注
      </el-button>
      <el-button size="small" @click="toggleFullscreen">全屏</el-button>
      <el-button size="small" @click="takeScreenshot">截图</el-button>
    </div>

    <component
      :is="component"
      ref="child"
      :visualization="visualization"
      :show-aux="showAux"
      :show-labels="showLabels"
      :auto-rotate="autoRotate"
    />

    <ul v-if="hasAux && showAux" class="viz-aux-list">
      <li v-for="(item, index) in (visualization.spec.auxiliary as Record<string, unknown>[])" :key="index">
        <strong>{{ item.kind }}</strong>
        <span v-if="item.reason"> — {{ item.reason }}</span>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.viz-renderer {
  min-width: 0;
  background: var(--card, #fff);
}

.viz-renderer-head {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 10px;
}

.viz-renderer-title {
  font-family: var(--font-serif);
  font-size: 17px;
  font-weight: 600;
  color: var(--ink);
}

.viz-toolbar {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 10px;
}

.viz-aux-list {
  margin: 10px 0 0;
  padding-left: 18px;
  font-size: 12px;
  color: var(--muted);
  line-height: 1.7;
}
</style>