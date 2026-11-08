<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ArrowDown, Menu, SwitchButton, User } from '@element-plus/icons-vue';
import { ElNotification } from 'element-plus';
import SideNav from './components/SideNav.vue';
import { api } from './api/data';
import { useAuthStore } from './stores/auth';

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const navOpen = ref(false);
const online = ref<boolean | null>(null);
const modelLabel = ref('');
const dueReviews = ref(0);

const isPublic = computed(() => route.meta.public === true);
const userInitial = computed(() => (auth.user?.display_name || auth.user?.username || '?').slice(0, 1).toUpperCase());

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
  const [health, model, wrongbook] = await Promise.allSettled([
    api.health(),
    api.model(),
    api.wrongbook(),
  ]);
  online.value = health.status === 'fulfilled';
  if (model.status === 'fulfilled' && model.value.configured && model.value.model) {
    modelLabel.value = model.value.model;
  }
  if (wrongbook.status === 'fulfilled') {
    dueReviews.value = wrongbook.value.due;
    remindReviews();
  }
}

function remindReviews() {
  if (dueReviews.value <= 0) return;
  const today = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  const key = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
  if (localStorage.getItem('edupi.review.reminded') === key) return;
  localStorage.setItem('edupi.review.reminded', key);
  ElNotification({
    title: '今日复习提醒',
    message: `有 ${dueReviews.value} 道错题到期，去错题本完成复习。`,
    type: 'warning',
    position: 'bottom-right',
    duration: 8000,
    onClick: () => router.push('/wrongbook'),
  });
}

function startProbe() {
  if (timer) return;
  void probe();
  timer = setInterval(probe, 30000);
}

function stopProbe() {
  if (!timer) return;
  clearInterval(timer);
  timer = undefined;
}

watch(
  [() => auth.ready, () => auth.enabled, () => auth.user?.user_id],
  () => {
    stopProbe();
    if (!auth.ready) return;
    if (auth.enabled && !auth.user) {
      online.value = null;
      modelLabel.value = '';
      dueReviews.value = 0;
      return;
    }
    startProbe();
  },
  { immediate: true },
);

async function onUserCommand(command: string): Promise<void> {
  if (command === 'account') {
    await router.push('/account');
    return;
  }
  if (command === 'logout') {
    await auth.logout();
    await router.replace('/login');
  }
}

onBeforeUnmount(stopProbe);
</script>

<template>
  <div v-if="!auth.ready" class="boot-screen">正在加载账号状态…</div>
  <router-view v-else-if="isPublic" />
  <div v-else class="shell">
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
        <router-link v-if="dueReviews > 0" to="/wrongbook" class="review-pill">
          待复习 {{ dueReviews }}
        </router-link>
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
        <el-dropdown v-if="auth.user" trigger="click" @command="onUserCommand">
          <button class="user-pill" type="button" aria-label="账号菜单">
            <span class="user-avatar">{{ userInitial }}</span>
            <span class="user-name">{{ auth.user.display_name || auth.user.username }}</span>
            <el-icon><ArrowDown /></el-icon>
          </button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item command="account">
                <el-icon><User /></el-icon>
                账号
              </el-dropdown-item>
              <el-dropdown-item command="logout" divided>
                <el-icon><SwitchButton /></el-icon>
                退出登录
              </el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
      </header>

      <main class="canvas" :class="{ 'is-chat': isChat }">
        <router-view />
      </main>
    </div>
  </div>
</template>

<style>
.review-pill {
  display: inline-flex;
  align-items: center;
  padding: 4px 10px;
  border: 1px solid #ead3b4;
  border-radius: 999px;
  background: var(--warning-soft);
  color: var(--warning);
  font-size: 11.5px;
  white-space: nowrap;
}

.boot-screen {
  min-height: 100vh;
  display: grid;
  place-items: center;
  color: #8a94a8;
  font-size: 13px;
  background: #f5f7fb;
}

.user-pill {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 4px 9px 4px 5px;
  border: 1px solid #e3e8f2;
  border-radius: 999px;
  background: #fff;
  color: #38445c;
  cursor: pointer;
}

.user-pill:hover {
  border-color: #c9d4ea;
  background: #f8faff;
}

.user-avatar {
  width: 24px;
  height: 24px;
  display: grid;
  place-items: center;
  border-radius: 50%;
  background: #eef3ff;
  color: #2f5bea;
  font-size: 11px;
  font-weight: 700;
}

.user-name {
  max-width: 110px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
}

@media (max-width: 720px) {
  .user-name {
    display: none;
  }
}

.nav-drawer .el-drawer__body {
  background: var(--rail);
  overflow: hidden;
}

.nav-drawer .nav-shell {
  width: 100%;
}
</style>
