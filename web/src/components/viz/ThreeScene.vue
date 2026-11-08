<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { Visualization } from '../../api/visualize';
import { compileExpression } from '../../utils/expression';
import { geometryOf } from '../../utils/visualize';

const props = defineProps<{
  visualization: Visualization;
  showAux: boolean;
  showLabels: boolean;
  autoRotate: boolean;
}>();

const host = ref<HTMLDivElement>();
let renderer: THREE.WebGLRenderer | undefined;
let scene: THREE.Scene | undefined;
let camera: THREE.PerspectiveCamera | undefined;
let controls: OrbitControls | undefined;
let content: THREE.Group | undefined;
let auxGroup: THREE.Group | undefined;
let labelGroup: THREE.Group | undefined;
let frame = 0;
let homePosition = new THREE.Vector3(3, 2.4, 3.4);
let homeTarget = new THREE.Vector3(0, 0, 0);

function labelSprite(text: string, position: THREE.Vector3, scale: number): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  ctx.font = '600 40px "Microsoft YaHei", sans-serif';
  ctx.fillStyle = '#15202b';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 64, 32);
  const texture = new THREE.CanvasTexture(canvas);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false }));
  sprite.position.copy(position);
  sprite.scale.set(scale * 2, scale, 1);
  return sprite;
}

function dashedLine(a: THREE.Vector3, b: THREE.Vector3, color: string): THREE.Line {
  const geometry = new THREE.BufferGeometry().setFromPoints([a, b]);
  const line = new THREE.Line(
    geometry,
    new THREE.LineDashedMaterial({ color, dashSize: 0.08, gapSize: 0.05 }),
  );
  line.computeLineDistances();
  return line;
}

function polygonMesh(coords: THREE.Vector3[], color: string, opacity: number): THREE.Mesh {
  const positions: number[] = [];
  for (let index = 1; index < coords.length - 1; index += 1) {
    for (const vertex of [coords[0], coords[index], coords[index + 1]]) {
      positions.push(vertex.x, vertex.y, vertex.z);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return new THREE.Mesh(
    geometry,
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity, side: THREE.DoubleSide, depthWrite: false }),
  );
}

function buildGeometry(spec: Record<string, unknown>) {
  const data = geometryOf(spec);
  const byId = new Map(data.points.map((point) => [point.id, new THREE.Vector3(...point.coord)]));
  const edgePositions: number[] = [];
  for (const [a, b] of data.edges) {
    const pa = byId.get(a);
    const pb = byId.get(b);
    if (pa && pb) edgePositions.push(pa.x, pa.y, pa.z, pb.x, pb.y, pb.z);
  }
  const edgeGeometry = new THREE.BufferGeometry();
  edgeGeometry.setAttribute('position', new THREE.Float32BufferAttribute(edgePositions, 3));
  content!.add(new THREE.LineSegments(edgeGeometry, new THREE.LineBasicMaterial({ color: '#2f5bea' })));
  for (const face of data.faces) {
    const coords = face.map((id) => byId.get(id)).filter((v): v is THREE.Vector3 => Boolean(v));
    if (coords.length >= 3) content!.add(polygonMesh(coords, '#2f5bea', 0.12));
  }
  for (const point of data.points) {
    const position = byId.get(point.id)!;
    const sphere = new THREE.Mesh(
      new THREE.SphereGeometry(0.035, 16, 16),
      new THREE.MeshBasicMaterial({ color: '#1f45c7' }),
    );
    sphere.position.copy(position);
    content!.add(sphere);
    if (spec.labels !== false) {
      labelGroup!.add(labelSprite(point.id, position.clone().add(new THREE.Vector3(0.06, 0.08, 0)), 0.12));
    }
  }
  const auxiliary = Array.isArray(spec.auxiliary) ? spec.auxiliary : [];
  for (const raw of auxiliary) {
    if (!raw || typeof raw !== 'object') continue;
    const item = raw as Record<string, unknown>;
    const ids = (Array.isArray(item.points) ? item.points : []).map(String);
    const coords = ids.map((id) => byId.get(id)).filter((v): v is THREE.Vector3 => Boolean(v));
    if (!coords.length) continue;
    const style = (item.style ?? {}) as Record<string, unknown>;
    const color = typeof style.color === 'string' ? style.color : '#e6a23c';
    const opacity = typeof style.opacity === 'number' ? style.opacity : 0.35;
    if (item.kind === 'plane' && coords.length >= 3) {
      auxGroup!.add(polygonMesh(coords, color, opacity));
    } else if (coords.length >= 2) {
      auxGroup!.add(dashedLine(coords[0], coords[1], color));
    } else {
      const marker = new THREE.Mesh(new THREE.SphereGeometry(0.05, 16, 16), new THREE.MeshBasicMaterial({ color }));
      marker.position.copy(coords[0]);
      auxGroup!.add(marker);
    }
  }
}

function buildBiology(spec: Record<string, unknown>) {
  const parts = Array.isArray(spec.parts) ? spec.parts : [];
  for (const raw of parts) {
    if (!raw || typeof raw !== 'object') continue;
    const part = raw as Record<string, unknown>;
    const coord = (Array.isArray(part.coord) ? part.coord : [0, 0, 0]).map(Number);
    const radius = typeof part.radius === 'number' ? part.radius : 0.3;
    const color = typeof part.color === 'string' ? part.color : '#8ec5ff';
    const position = new THREE.Vector3(coord[0], coord[1], coord[2]);
    const sphere = new THREE.Mesh(
      new THREE.SphereGeometry(radius, 32, 32),
      new THREE.MeshPhongMaterial({ color, transparent: true, opacity: 0.75 }),
    );
    sphere.position.copy(position);
    content!.add(sphere);
    labelGroup!.add(
      labelSprite(String(part.label ?? part.id ?? ''), position.clone().add(new THREE.Vector3(0, radius + 0.15, 0)), 0.22),
    );
  }
}

function buildSurface(spec: Record<string, unknown>) {
  const grid = spec.grid;
  let heights: number[][];
  if (Array.isArray(grid) && grid.length >= 2) {
    heights = grid.map((row) => (Array.isArray(row) ? row.map(Number) : [0, 0]));
  } else {
    const expression = typeof spec.expression === 'string' ? spec.expression : '0';
    const range = Array.isArray(spec.range) ? (spec.range.map(Number) as [number, number]) : [-6, 6];
    const fn = compileExpression(expression);
    const size = 48;
    heights = [];
    for (let row = 0; row <= size; row += 1) {
      const y = range[0] + ((range[1] - range[0]) * row) / size;
      const line: number[] = [];
      for (let col = 0; col <= size; col += 1) {
        const x = range[0] + ((range[1] - range[0]) * col) / size;
        const value = fn(x, y);
        line.push(Number.isFinite(value) ? value : 0);
      }
      heights.push(line);
    }
  }
  const rows = heights.length;
  const cols = heights[0].length;
  const positions: number[] = [];
  const indices: number[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      positions.push(col - cols / 2, heights[row][col], row - rows / 2);
    }
  }
  for (let row = 0; row < rows - 1; row += 1) {
    for (let col = 0; col < cols - 1; col += 1) {
      const a = row * cols + col;
      const b = a + 1;
      const c = a + cols;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  content!.add(new THREE.Mesh(geometry, new THREE.MeshPhongMaterial({ color: '#2f5bea', side: THREE.DoubleSide, flatShading: true })));
  content!.add(new THREE.LineSegments(new THREE.WireframeGeometry(geometry), new THREE.LineBasicMaterial({ color: '#9db4f5', transparent: true, opacity: 0.35 })));
}

function rebuild() {
  if (!scene) return;
  if (content) scene.remove(content);
  if (auxGroup) scene.remove(auxGroup);
  if (labelGroup) scene.remove(labelGroup);
  content = new THREE.Group();
  auxGroup = new THREE.Group();
  labelGroup = new THREE.Group();
  const spec = props.visualization.spec;
  const type = props.visualization.type;
  if (type === 'geometry3d') buildGeometry(spec);
  else if (type === 'biology') buildBiology(spec);
  else buildSurface(spec);
  scene.add(content, auxGroup, labelGroup);
  auxGroup.visible = props.showAux;
  labelGroup.visible = props.showLabels;

  const box = new THREE.Box3().setFromObject(content);
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3()).length() || 2;
  homeTarget = center;
  homePosition = center.clone().add(new THREE.Vector3(size * 0.7, size * 0.5, size * 0.8));
  reset();
}

function reset() {
  if (!camera || !controls) return;
  camera.position.copy(homePosition);
  controls.target.copy(homeTarget);
  controls.update();
}

async function screenshot(): Promise<string | null> {
  if (!renderer || !scene || !camera) return null;
  renderer.render(scene, camera);
  return renderer.domElement.toDataURL('image/png');
}

function resize() {
  if (!host.value || !renderer || !camera) return;
  const width = host.value.clientWidth;
  const height = host.value.clientHeight;
  renderer.setSize(width, height);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}

onMounted(() => {
  if (!host.value) return;
  scene = new THREE.Scene();
  scene.background = new THREE.Color('#fbfcfc');
  camera = new THREE.PerspectiveCamera(50, 1, 0.01, 500);
  renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  host.value.appendChild(renderer.domElement);
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  scene.add(new THREE.AmbientLight(0xffffff, 0.9));
  const directional = new THREE.DirectionalLight(0xffffff, 1.1);
  directional.position.set(4, 6, 5);
  scene.add(directional);
  resize();
  rebuild();
  const loop = () => {
    frame = requestAnimationFrame(loop);
    if (controls) {
      controls.autoRotate = props.autoRotate;
      controls.update();
    }
    if (renderer && scene && camera) renderer.render(scene, camera);
  };
  loop();
  window.addEventListener('resize', resize);
});

watch(() => [props.visualization, props.showAux, props.showLabels] as const, rebuild, { deep: false });
watch(() => props.showAux, (value) => { if (auxGroup) auxGroup.visible = value; });
watch(() => props.showLabels, (value) => { if (labelGroup) labelGroup.visible = value; });

onBeforeUnmount(() => {
  cancelAnimationFrame(frame);
  window.removeEventListener('resize', resize);
  controls?.dispose();
  renderer?.dispose();
  renderer?.domElement.remove();
});

defineExpose({ reset, screenshot });
</script>

<template>
  <div ref="host" class="three-host" />
</template>

<style scoped>
.three-host {
  width: 100%;
  height: 420px;
  border: 1px solid var(--line);
  border-radius: 14px;
  overflow: hidden;
  touch-action: none;
}
</style>