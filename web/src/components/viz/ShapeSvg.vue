<script setup lang="ts">
import { computed } from 'vue';
import type { Visualization } from '../../api/visualize';

const props = defineProps<{ visualization: Visualization }>();

interface Shape {
  kind: string;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  r?: number;
  rotate?: number;
  from?: [number, number];
  to?: [number, number];
  label?: string;
  text?: string;
  color?: string;
}

const shapes = computed<Shape[]>(() => {
  const raw = props.visualization.spec.elements;
  return (Array.isArray(raw) ? raw : []).filter((item): item is Shape => Boolean(item) && typeof item === 'object');
});

function num(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

async function screenshot(): Promise<string | null> {
  const svg = document.getElementById(`shape-${props.visualization.visualization_id}`) as SVGSVGElement | null;
  if (!svg) return null;
  const clone = svg.cloneNode(true) as SVGElement;
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  const blob = new Blob([new XMLSerializer().serializeToString(clone)], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('svg 转图片失败'));
      image.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = 720;
    canvas.height = 420;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 720, 420);
    ctx.drawImage(image, 0, 0, 720, 420);
    return canvas.toDataURL('image/png');
  } finally {
    URL.revokeObjectURL(url);
  }
}

function reset() {
  // SVG 为静态坐标系，无视角状态
}

defineExpose({ reset, screenshot });
</script>

<template>
  <svg
    :id="`shape-${visualization.visualization_id}`"
    class="shape-svg"
    viewBox="0 0 720 420"
    role="img"
    :aria-label="visualization.title"
  >
    <defs>
      <marker id="shape-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
        <path d="M 0 0 L 10 5 L 0 10 z" fill="context-stroke" />
      </marker>
    </defs>
    <rect width="720" height="420" rx="12" fill="#fbfcfc" />
    <template v-for="(shape, index) in shapes" :key="index">
      <line
        v-if="shape.kind === 'line' && shape.from && shape.to"
        :x1="num(shape.from[0])"
        :y1="num(shape.from[1])"
        :x2="num(shape.to[0])"
        :y2="num(shape.to[1])"
        :stroke="shape.color ?? '#5b6b7b'"
        stroke-width="2"
      />
      <line
        v-else-if="shape.kind === 'arrow' && shape.from && shape.to"
        :x1="num(shape.from[0])"
        :y1="num(shape.from[1])"
        :x2="num(shape.to[0])"
        :y2="num(shape.to[1])"
        :stroke="shape.color ?? '#2f5bea'"
        stroke-width="2.4"
        marker-end="url(#shape-arrow)"
      />
      <rect
        v-else-if="shape.kind === 'rect'"
        :x="num(shape.x)"
        :y="num(shape.y)"
        :width="num(shape.w, 60)"
        :height="num(shape.h, 40)"
        :transform="shape.rotate ? `rotate(${num(shape.rotate)} ${num(shape.x) + num(shape.w, 60) / 2} ${num(shape.y) + num(shape.h, 40) / 2})` : undefined"
        fill="rgba(47,91,234,0.12)"
        stroke="#2f5bea"
        stroke-width="2"
        rx="4"
      />
      <circle
        v-else-if="shape.kind === 'circle'"
        :cx="num(shape.x)"
        :cy="num(shape.y)"
        :r="num(shape.r, 20)"
        fill="#fff"
        stroke="#2f5bea"
        stroke-width="2"
      />
      <text
        v-if="shape.label"
        :x="shape.kind === 'rect' ? num(shape.x) + num(shape.w, 60) / 2 : shape.kind === 'circle' ? num(shape.x) : num(shape.to?.[0] ?? shape.from?.[0]) + 8"
        :y="shape.kind === 'rect' ? num(shape.y) + num(shape.h, 40) / 2 + 4 : shape.kind === 'circle' ? num(shape.y) + 4 : num(shape.to?.[1] ?? shape.from?.[1]) - 8"
        text-anchor="middle"
        class="shape-label"
      >{{ shape.label }}</text>
      <text v-if="shape.text" :x="num(shape.x)" :y="num(shape.y)" class="shape-text">{{ shape.text }}</text>
    </template>
  </svg>
</template>

<style scoped>
.shape-svg {
  display: block;
  width: 100%;
  height: auto;
  border: 1px solid var(--line);
  border-radius: 14px;
}

.shape-label {
  fill: #15202b;
  font-size: 15px;
  font-weight: 600;
  font-family: var(--font-sans);
}

.shape-text {
  fill: #5b6b7b;
  font-size: 13px;
  font-family: var(--font-sans);
}
</style>