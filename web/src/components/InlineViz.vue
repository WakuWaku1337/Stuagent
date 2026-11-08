<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import VizRenderer from './VizRenderer.vue';
import { fetchVisualization, type Visualization } from '../api/visualize';

const props = defineProps<{
  visualization?: Visualization;
  visualizationId?: string | null;
}>();

const loaded = ref<Visualization | null>(props.visualization ?? null);
const failed = ref(false);

async function load(id: string) {
  try {
    const data = await fetchVisualization(id);
    loaded.value = data.visualization;
    failed.value = false;
  } catch {
    failed.value = true;
  }
}

onMounted(() => {
  if (!loaded.value && props.visualizationId) void load(props.visualizationId);
});

watch(
  () => [props.visualization, props.visualizationId] as const,
  ([item, id]) => {
    if (item) loaded.value = item;
    else if (id) void load(id);
  },
);
</script>

<template>
  <div v-if="loaded" class="inline-viz">
    <VizRenderer :visualization="loaded" />
    <router-link class="inline-viz-link" :to="`/visualize?id=${loaded.visualization_id}`">在统一可视化中打开</router-link>
  </div>
  <div v-else-if="failed" class="inline-viz-missing">这条回答的可视化已被删除，可在统一可视化页重新生成。</div>
</template>

<style scoped>
.inline-viz {
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px solid var(--line);
}

.inline-viz-link {
  display: inline-block;
  margin-top: 8px;
  font-size: 12px;
  color: var(--accent);
}

.inline-viz-missing {
  margin-top: 14px;
  padding: 10px 12px;
  border: 1px dashed var(--line);
  border-radius: var(--radius-sm);
  font-size: 12px;
  color: var(--muted);
}
</style>