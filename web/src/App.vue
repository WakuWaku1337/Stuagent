<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { Menu } from '@element-plus/icons-vue';
import SideNav from './components/SideNav.vue';
import { api } from './api/data';

const route = useRoute();
const navOpen = ref(false);
const online = ref<boolean | null>(null);
const modelLabel = ref('');

const title = computed(() => (route.meta.title as string | undefined) ?? '学习台');
const subtitle = computed(() => (route.meta.subtitle as string | undefined) ?? '');
const isChat = computed(() => route.name === 'chat');
const now = new Date();
const today = `${now.getMonth() + 1}月${now.getDate()}日 · ${
  ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][now.getDay()]
}`;

const statusText = computed(() => {
  if (online.value === null) return '检测中';
  return online.value ? '服务在线' : '服务离线';
});

let timer: ReturnType<typeof setInterval> | undefined;

async function probe() {
  const [health, model] = await Promise.allSettled([api.health(), api.model()]);
  online.value = health.status === 'fulfilled';
  if (model.status === 'fulfilled' && model.value.configured && model.value.model) {
    modelLabel.value = model.value.model;
  }
}

onMounted(() => {
  void probe();
  timer = setInterval(probe, 30000);
});

onBeforeUnmount(() => {
  if (timer) clearInterval(timer);
});
</script>

<template>
  <div class="shell">
    <aside class="rail">
      <SideNav />
    </aside>

    <el-drawer
      v-model="navOpen"
      direction="ltr"
      size="244px"
      :with-header="false"
      class="nav-drawer"
    >
      <SideNav @navigate="navOpen = false" />
    </el-drawer>

    <div class="workspace">
      <header class="topbar">
        <el-button
          class="mobile-menu"
          :icon="Menu"
          circle
          text
          aria-label="打开导航"
          @click="navOpen = true"
        />
        <div>
          <h1 class="topbar-title">{{ title }}</h1>
          <p v-if="subtitle" class="topbar-sub">{{ subtitle }}</p>
        </div>
        <div class="topbar-spacer" />
        <span class="topbar-date">{{ today }}</span>
        <el-tooltip
          :content="modelLabel ? `模型 ${modelLabel} · 数据保存在本机` : '后端 API 与本地服务状态'"
          placement="bottom"
        >
          <span class="status-pill">
            <span class="status-dot" :class="{ on: online, off: online === false }" />
            <span class="status-text">{{ statusText }}</span>
          </span>
        </el-tooltip>
      </header>

      <main class="canvas" :class="{ 'is-chat': isChat }">
        <router-view />
      </main>
    </div>
  </div>
</template>

<style>
.nav-drawer .el-drawer__body {
  background: var(--rail);
  overflow: hidden;
}

.nav-drawer .nav-shell {
  width: 100%;
}
</style>
