<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage, ElMessageBox } from 'element-plus';
import { useAuthStore } from '../stores/auth';

const auth = useAuthStore();
const router = useRouter();
const form = reactive({ currentPassword: '', newPassword: '', confirm: '' });
const changing = ref(false);
const message = ref('');

const displayName = computed(() => auth.user?.display_name || auth.user?.username || '');
const contact = computed(() => {
  const parts = [auth.user?.phone, auth.user?.email].filter(Boolean);
  return parts.length ? parts.join(' · ') : '未填写联系方式';
});

function fmt(value: number): string {
  return new Date(value).toLocaleString('zh-CN', { hour12: false });
}

async function submitPassword(): Promise<void> {
  message.value = '';
  if (!form.currentPassword || form.newPassword.length < 6) {
    message.value = '请输入当前密码，新密码至少 6 位';
    return;
  }
  if (form.newPassword !== form.confirm) {
    message.value = '两次输入的新密码不一致';
    return;
  }
  changing.value = true;
  const ok = await auth.changePassword(form.currentPassword, form.newPassword);
  changing.value = false;
  if (!ok) {
    message.value = auth.error;
    return;
  }
  form.currentPassword = '';
  form.newPassword = '';
  form.confirm = '';
  ElMessage.success('密码已更新');
}

async function revoke(sessionId: string): Promise<void> {
  await auth.revokeSession(sessionId);
  ElMessage.success('已撤销该会话');
}

async function revokeAll(): Promise<void> {
  await ElMessageBox.confirm('所有设备都会被退出，需要重新登录。', '退出所有设备', {
    confirmButtonText: '全部退出',
    cancelButtonText: '取消',
    type: 'warning',
  });
  await auth.revokeAllSessions();
  ElMessage.success('已退出所有设备');
  router.replace('/login');
}

async function logout(): Promise<void> {
  await auth.logout();
  router.replace('/login');
}

onMounted(() => {
  void auth.loadSessions();
});
</script>

<template>
  <div class="page narrow account-page">
    <section class="panel">
      <div class="panel-head">
        <div>
          <h2 class="panel-title">账号</h2>
          <p class="panel-sub">账号信息、密码与登录设备</p>
        </div>
        <el-button text @click="logout">退出登录</el-button>
      </div>
      <div class="panel-body account-profile">
        <div class="avatar">{{ displayName.slice(0, 1).toUpperCase() }}</div>
        <div class="account-main">
          <strong>{{ displayName }}</strong>
          <span>@{{ auth.user?.username }}</span>
          <small>{{ contact }}</small>
        </div>
        <el-tag effect="plain" type="info">{{ auth.user?.role === 'admin' ? '管理员' : '学生' }}</el-tag>
      </div>
    </section>

    <el-alert
      v-if="auth.user?.must_change_password"
      class="account-alert"
      type="warning"
      :closable="false"
      show-icon
      title="请先修改临时密码"
      description="管理员重置过密码，修改后才能继续使用其他功能。"
    />

    <section class="panel">
      <div class="panel-head">
        <div>
          <h2 class="panel-title">修改密码</h2>
          <p class="panel-sub">修改后其他设备会退出登录</p>
        </div>
      </div>
      <div class="panel-body">
        <form class="account-form" @submit.prevent="submitPassword">
          <label class="field-label" for="current-password">当前密码</label>
          <el-input id="current-password" v-model="form.currentPassword" type="password" show-password autocomplete="current-password" />
          <label class="field-label" for="new-password">新密码</label>
          <el-input id="new-password" v-model="form.newPassword" type="password" show-password autocomplete="new-password" placeholder="至少 6 位" />
          <label class="field-label" for="confirm-password">确认新密码</label>
          <el-input id="confirm-password" v-model="form.confirm" type="password" show-password autocomplete="new-password" />
          <p v-if="message" class="account-error">{{ message }}</p>
          <el-button type="primary" native-type="submit" :loading="changing">保存新密码</el-button>
        </form>
      </div>
    </section>

    <section class="panel">
      <div class="panel-head">
        <div>
          <h2 class="panel-title">登录设备</h2>
          <p class="panel-sub">只保留你认识的设备</p>
        </div>
        <el-button text type="danger" @click="revokeAll">退出所有设备</el-button>
      </div>
      <div class="panel-body session-list">
        <div v-for="session in auth.sessions" :key="session.session_id" class="session-row">
          <div class="session-main">
            <strong>
              {{ session.user_agent?.split(' ')[0] || '未知设备' }}
              <el-tag v-if="session.current" size="small" effect="plain">当前</el-tag>
            </strong>
            <span>{{ session.ip || '未知地址' }} · 最近活跃 {{ fmt(session.last_seen_at) }}</span>
            <small>创建于 {{ fmt(session.created_at) }} · 到期 {{ fmt(session.expires_at) }}</small>
          </div>
          <el-button v-if="!session.current" text type="danger" @click="revoke(session.session_id)">
            撤销
          </el-button>
        </div>
        <p v-if="auth.sessions.length === 0" class="empty-note">暂无活跃会话</p>
      </div>
    </section>
  </div>
</template>

<style scoped>
.account-page {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.account-profile {
  display: flex;
  align-items: center;
  gap: 14px;
}

.avatar {
  width: 46px;
  height: 46px;
  display: grid;
  place-items: center;
  border-radius: 14px;
  background: #eef3ff;
  color: #2f5bea;
  font-size: 18px;
  font-weight: 700;
}

.account-main {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}

.account-main strong {
  font-size: 15px;
  color: #1f2a44;
}

.account-main span,
.account-main small {
  font-size: 12px;
  color: #8a94a8;
}

.account-main small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.account-alert {
  margin: 0;
}

.account-form {
  display: flex;
  flex-direction: column;
  gap: 9px;
  max-width: 420px;
}

.account-form .field-label {
  margin-top: 4px;
  font-size: 12px;
  color: var(--muted);
}

.account-form .el-button {
  align-self: flex-start;
  margin-top: 6px;
}

.account-error {
  margin: 0;
  font-size: 12.5px;
  color: #c0443b;
}

.session-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.session-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 14px;
  border: 1px solid #e7ebf4;
  border-radius: 11px;
  background: #fbfcff;
}

.session-main {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}

.session-main strong {
  font-size: 13px;
  color: #26324a;
}

.session-main span,
.session-main small {
  font-size: 11.5px;
  color: #8a94a8;
}

.empty-note {
  margin: 0;
  font-size: 12.5px;
  color: #8a94a8;
}
</style>
