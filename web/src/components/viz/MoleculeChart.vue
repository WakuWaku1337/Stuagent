<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import * as $3Dmol from '3dmol';
import type { Visualization } from '../../api/visualize';

const props = defineProps<{ visualization: Visualization }>();
const host = ref<HTMLDivElement>();
const error = ref('');
let viewer: any;

function build() {
  if (!host.value) return;
  error.value = '';
  host.value.innerHTML = '';
  try {
    viewer = $3Dmol.createViewer(host.value, { backgroundColor: 'white', antialias: true });
    const spec = props.visualization.spec;
    const format = String(spec.format ?? 'xyz');
    viewer.addModel(String(spec.data ?? ''), format);
    const style = String(spec.style ?? 'stick');
    if (style === 'sphere') viewer.setStyle({}, { sphere: { scale: 0.3 } });
    else if (style === 'line') viewer.setStyle({}, { line: {} });
    else viewer.setStyle({}, { stick: { radius: 0.15 }, sphere: { scale: 0.25 } });
    viewer.zoomTo();
    viewer.render();
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  }
}

function reset() {
  if (!viewer) return;
  viewer.zoomTo();
  viewer.render();
}

async function screenshot(): Promise<string | null> {
  if (!viewer) return null;
  return new Promise((resolve) => {
    try {
      viewer.png((uri: string) => resolve(uri ?? null));
      setTimeout(() => resolve(null), 1500);
    } catch {
      resolve(null);
    }
  });
}

onMounted(build);
watch(() => props.visualization, build);
onBeforeUnmount(() => {
  try {
    viewer?.clear();
  } catch {
    // viewer 已销毁
  }
  if (host.value) host.value.innerHTML = '';
});

defineExpose({ reset, screenshot });
</script>

<template>
  <div class="mol-wrap">
    <div v-if="error" class="mol-error">{{ error }}</div>
    <div ref="host" class="mol-host" />
    <p class="mol-note">拖动旋转 · 滚轮缩放 · 球棍模型展示键角与空间构型</p>
  </div>
</template>

<style scoped>
.mol-host {
  position: relative;
  width: 100%;
  height: 420px;
  border: 1px solid var(--line);
  border-radius: 14px;
  overflow: hidden;
}

.mol-error {
  margin-bottom: 8px;
  padding: 10px 12px;
  border: 1px solid #e9c7c4;
  border-radius: var(--radius-sm);
  background: var(--danger-soft);
  color: var(--danger);
  font-size: 12px;
}

.mol-note {
  margin-top: 8px;
  font-size: 11.5px;
  color: var(--faint);
}
</style>