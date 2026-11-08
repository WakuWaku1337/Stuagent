<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import {
  createUser,
  fetchSystemCheck,
  listAudit,
  listUsers,
  resetUserPassword,
  updateUser,
  type AdminUser,
  type AuditEvent,
  type SystemCheckResult,
} from '../api/admin';

const users = ref<AdminUser[]>([]);
const events = ref<AuditEvent[]>([]);
const system = ref<SystemCheckResult | null>(null);
const loading = ref(false);
const saving = ref(false);
const createOpen = ref(false);
const editOpen = ref(false);
const credentialOpen = ref(false);
const editingId = ref('');
const credential = reactive({ username: '', password: '' });
const createForm = reactive({
  username: '',
  displayName: '',
  phone: '',
  email: '',
  role: 'user' as 'admin' | 'user',
  password: '',
});
const editForm = reactive({
  displayName: '',
  phone: '',
  email: '',
  role: 'user' as 'admin' | 'user',
  status: 'active' as 'active' | 'disabled',
});

const eventLabels: Record<string, string> = {
  login: '登录',
  logout: '退出',
  register: '注册',
  bootstrap: '初始化',
  user_created: '账号创建',
  password_changed: '修改密码',
  password_reset: '重置密码',
  sessions_revoked: '退出所有设备',
  admin_user_created: '管理员建号',
  admin_user_updated: '管理员改账号',
  admin_password_reset: '管理员重置密码',
};

function fmt(value: number | null): string {
  return value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '—';
}

function statusType(status: string): 'success' | 'info' | 'warning' | 'danger' {
  return status === 'active' ? 'success' : 'danger';
}

function checkType(status: string): 'success' | 'warning' | 'danger' {
  return status === 'pass' ? 'success' : status === 'warn' ? 'warning' : 'danger';
}

async function load(): Promise<void> {
  loading.value = true;
  try {
    const [userList, auditList, systemResult] = await Promise.all([
      listUsers(),
      listAudit(80),
      fetchSystemCheck(),
    ]);
    users.value = userList;
    events.value = auditList;
    system.value = systemResult;
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : String(error));
  } finally {
    loading.value = false;
  }
}

async function refreshCheck(): Promise<void> {
  try {
    system.value = await fetchSystemCheck();
    ElMessage.success('检查已刷新');
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : String(error));
  }
}

function openCreate(): void {
  Object.assign(createForm, { username: '', displayName: '', phone: '', email: '', role: 'user', password: '' });
  createOpen.value = true;
}

async function submitCreate(): Promise<void> {
  if (!/^[A-Za-z0-9_-]{3,32}$/.test(createForm.username.trim())) {
    ElMessage.warning('用户名需为 3–32 位字母、数字、下划线或中划线');
    return;
  }
  saving.value = true;
  try {
    const result = await createUser({
      username: createForm.username.trim(),
      password: createForm.password || undefined,
      displayName: createForm.displayName || undefined,
      phone: createForm.phone || undefined,
      email: createForm.email || undefined,
      role: createForm.role,
    });
    createOpen.value = false;
    if (result.tempPassword) showCredential(result.user.username, result.tempPassword);
    ElMessage.success('账号已创建');
    await load();
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : String(error));
  } finally {
    saving.value = false;
  }
}

function openEdit(user: AdminUser): void {
  editingId.value = user.user_id;
  Object.assign(editForm, {
    displayName: user.display_name ?? '',
    phone: user.phone ?? '',
    email: user.email ?? '',
    role: user.role,
    status: user.status,
  });
  editOpen.value = true;
}

async function submitEdit(): Promise<void> {
  saving.value = true;
  try {
    await updateUser(editingId.value, {
      displayName: editForm.displayName || null,
      phone: editForm.phone || null,
      email: editForm.email || null,
      role: editForm.role,
      status: editForm.status,
    });
    editOpen.value = false;
    ElMessage.success('账号已更新');
    await load();
  } catch (error) {
    ElMessage.error(error instanceof Error ? error.message : String(error));
  } finally {
    saving.value = false;
  }
}

async function toggleStatus(user: AdminUser): Promise<void> {
  const disabling = user.status === 'active';
  try {
    await ElMessageBox.confirm(
      disabling ? `停用后 ${user.username} 将无法登录，已登录会话会立即失效。` : `恢复 ${user.username} 的登录权限？`,
      disabling ? '停用账号' : '启用账号',
      { confirmButtonText: disabling ? '停用' : '启用', cancelButtonText: '取消', type: 'warning' },
    );
    await updateUser(user.user_id, { status: disabling ? 'disabled' : 'active' });
    ElMessage.success(disabling ? '账号已停用' : '账号已启用');
    await load();
  } catch (error) {
    if (error === 'cancel' || error === 'close') return;
    ElMessage.error(error instanceof Error ? error.message : String(error));
  }
}

async function resetPassword(user: AdminUser): Promise<void> {
  try {
    await ElMessageBox.confirm(`重置 ${user.username} 的密码，旧会话会立即失效。`, '重置密码', {
      confirmButtonText: '重置',
      cancelButtonText: '取消',
      type: 'warning',
    });
    const temp = await resetUserPassword(user.user_id);
    showCredential(user.username, temp);
    await load();
  } catch (error) {
    if (error === 'cancel' || error === 'close') return;
    ElMessage.error(error instanceof Error ? error.message : String(error));
  }
}

function showCredential(username: string, password: string): void {
  credential.username = username;
  credential.password = password;
  credentialOpen.value = true;
}

async function copyCredential(): Promise<void> {
  try {
    await navigator.clipboard.writeText(credential.password);
    ElMessage.success('临时密码已复制');
  } catch {
    ElMessage.info('请手动复制临时密码');
  }
}

onMounted(() => {
  void load();
});
</script>

<template>
  <div class="page narrow admin-page">
    <section class="panel overview">
      <div class="panel-head">
        <div>
          <h2 class="panel-title">账号管理</h2>
          <p class="panel-sub">建号、停用、角色与密码重置；管理员不读取他人学习内容</p>
        </div>
        <div class="overview-actions">
          <el-button text :loading="loading" @click="load">刷新</el-button>
          <el-button type="primary" @click="openCreate">新建账号</el-button>
        </div>
      </div>
      <div class="panel-body">
        <div class="stat-grid">
          <div class="stat">
            <span>账号总数</span>
            <strong>{{ system?.users.total ?? '—' }}</strong>
          </div>
          <div class="stat">
            <span>活跃账号</span>
            <strong>{{ system?.users.active ?? '—' }}</strong>
          </div>
          <div class="stat">
            <span>管理员</span>
            <strong>{{ system?.users.admins ?? '—' }}</strong>
          </div>
          <div class="stat">
            <span>活跃会话</span>
            <strong>{{ system?.users.sessions ?? '—' }}</strong>
          </div>
        </div>
      </div>
    </section>

    <section class="panel">
      <div class="panel-head">
        <div>
          <h2 class="panel-title">上线检查</h2>
          <p class="panel-sub">账号、注册、HTTPS 与备份的最低要求</p>
        </div>
        <el-button text @click="refreshCheck">重新检查</el-button>
      </div>
      <div class="panel-body check-list">
        <div v-for="item in system?.checks ?? []" :key="item.id" class="check-row">
          <el-tag :type="checkType(item.status)" effect="plain" size="small">
            {{ item.status === 'pass' ? '通过' : item.status === 'warn' ? '注意' : '未通过' }}
          </el-tag>
          <div class="check-main">
            <strong>{{ item.label }}</strong>
            <span>{{ item.message }}</span>
          </div>
        </div>
        <p v-if="!system" class="empty-note">暂无检查结果</p>
      </div>
    </section>

    <section class="panel">
      <div class="panel-head">
        <div>
          <h2 class="panel-title">账号列表</h2>
          <p class="panel-sub">共 {{ users.length }} 个账号</p>
        </div>
      </div>
      <div class="panel-body table-body">
        <el-table :data="users" row-key="user_id" v-loading="loading">
          <el-table-column label="账号" min-width="190">
            <template #default="{ row }">
              <div class="account-cell">
                <strong>{{ row.display_name || row.username }}</strong>
                <span>@{{ row.username }}</span>
              </div>
            </template>
          </el-table-column>
          <el-table-column label="联系方式" min-width="190">
            <template #default="{ row }">
              <div class="contact-cell">
                <span>{{ row.phone || '未填手机号' }}</span>
                <span>{{ row.email || '未填邮箱' }}</span>
              </div>
            </template>
          </el-table-column>
          <el-table-column label="角色" width="95">
            <template #default="{ row }">
              <el-tag effect="plain" size="small" :type="row.role === 'admin' ? 'warning' : 'info'">
                {{ row.role === 'admin' ? '管理员' : '学生' }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="状态" width="90">
            <template #default="{ row }">
              <el-tag effect="plain" size="small" :type="statusType(row.status)">
                {{ row.status === 'active' ? '正常' : '已停用' }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="最近登录" width="170">
            <template #default="{ row }">{{ fmt(row.last_login_at) }}</template>
          </el-table-column>
          <el-table-column label="会话" width="70">
            <template #default="{ row }">{{ row.session_count }}</template>
          </el-table-column>
          <el-table-column label="操作" width="230" fixed="right">
            <template #default="{ row }">
              <el-button text size="small" @click="openEdit(row as AdminUser)">编辑</el-button>
              <el-button text size="small" @click="resetPassword(row as AdminUser)">重置密码</el-button>
              <el-button text size="small" :type="row.status === 'active' ? 'danger' : 'success'" @click="toggleStatus(row as AdminUser)">
                {{ row.status === 'active' ? '停用' : '启用' }}
              </el-button>
            </template>
          </el-table-column>
        </el-table>
      </div>
    </section>

    <section class="panel">
      <div class="panel-head">
        <div>
          <h2 class="panel-title">认证审计</h2>
          <p class="panel-sub">最近 80 条登录、改密和管理员操作</p>
        </div>
      </div>
      <div class="panel-body table-body">
        <el-table :data="events" row-key="event_id">
          <el-table-column label="时间" width="170">
            <template #default="{ row }">{{ fmt(row.created_at) }}</template>
          </el-table-column>
          <el-table-column label="事件" width="130">
            <template #default="{ row }">{{ eventLabels[row.type] ?? row.type }}</template>
          </el-table-column>
          <el-table-column label="账号" min-width="170">
            <template #default="{ row }">{{ row.user_id || '—' }}</template>
          </el-table-column>
          <el-table-column label="结果" width="80">
            <template #default="{ row }">
              <el-tag size="small" effect="plain" :type="row.result === 'success' ? 'success' : 'danger'">
                {{ row.result === 'success' ? '成功' : '失败' }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="IP" width="140">
            <template #default="{ row }">{{ row.ip || '—' }}</template>
          </el-table-column>
        </el-table>
      </div>
    </section>

    <el-dialog v-model="createOpen" title="新建账号" width="460px">
      <div class="dialog-form">
        <label class="field-label">用户名</label>
        <el-input v-model="createForm.username" placeholder="3–32 位字母、数字、下划线或中划线" />
        <label class="field-label">显示名</label>
        <el-input v-model="createForm.displayName" placeholder="可选" />
        <div class="dialog-grid">
          <div>
            <label class="field-label">手机号</label>
            <el-input v-model="createForm.phone" placeholder="可选" />
          </div>
          <div>
            <label class="field-label">邮箱</label>
            <el-input v-model="createForm.email" placeholder="可选" />
          </div>
        </div>
        <label class="field-label">角色</label>
        <el-select v-model="createForm.role">
          <el-option value="user" label="学生" />
          <el-option value="admin" label="管理员" />
        </el-select>
        <label class="field-label">初始密码</label>
        <el-input v-model="createForm.password" placeholder="留空自动生成临时密码" />
      </div>
      <template #footer>
        <el-button @click="createOpen = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="submitCreate">创建</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="editOpen" title="编辑账号" width="460px">
      <div class="dialog-form">
        <label class="field-label">显示名</label>
        <el-input v-model="editForm.displayName" />
        <div class="dialog-grid">
          <div>
            <label class="field-label">手机号</label>
            <el-input v-model="editForm.phone" />
          </div>
          <div>
            <label class="field-label">邮箱</label>
            <el-input v-model="editForm.email" />
          </div>
        </div>
        <label class="field-label">角色</label>
        <el-select v-model="editForm.role">
          <el-option value="user" label="学生" />
          <el-option value="admin" label="管理员" />
        </el-select>
        <label class="field-label">状态</label>
        <el-select v-model="editForm.status">
          <el-option value="active" label="正常" />
          <el-option value="disabled" label="停用" />
        </el-select>
      </div>
      <template #footer>
        <el-button @click="editOpen = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="submitEdit">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="credentialOpen" title="临时密码" width="440px">
      <p class="credential-tip">请把下面这组凭据交给 {{ credential.username }}，首次登录后会要求修改密码。</p>
      <el-input v-model="credential.password" readonly>
        <template #append>
          <el-button @click="copyCredential">复制</el-button>
        </template>
      </el-input>
      <template #footer>
        <el-button type="primary" @click="credentialOpen = false">知道了</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.admin-page {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.overview-actions {
  display: flex;
  gap: 6px;
}

.stat-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
}

.stat {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 12px 14px;
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  background: #fbfcff;
}

.stat span {
  font-size: 11.5px;
  color: var(--muted);
}

.stat strong {
  font-family: var(--font-serif);
  font-size: 23px;
  font-weight: 600;
  color: var(--ink);
}

.check-list {
  display: flex;
  flex-direction: column;
  gap: 9px;
}

.check-row {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 10px 12px;
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  background: #fbfcff;
}

.check-main {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.check-main strong {
  font-size: 13px;
  color: var(--ink);
}

.check-main span {
  font-size: 12px;
  color: var(--muted);
}

.table-body {
  padding-top: 6px;
}

.account-cell,
.contact-cell {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.account-cell strong {
  font-size: 13px;
  color: var(--ink);
}

.account-cell span,
.contact-cell span {
  font-size: 11.5px;
  color: var(--muted);
}

.empty-note {
  margin: 0;
  font-size: 12.5px;
  color: var(--muted);
}

.dialog-form {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.dialog-form .field-label {
  margin-top: 4px;
  font-size: 12px;
  color: var(--muted);
}

.dialog-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

.credential-tip {
  margin: 0 0 12px;
  font-size: 12.5px;
  line-height: 1.7;
  color: var(--muted);
}

@media (max-width: 720px) {
  .stat-grid {
    grid-template-columns: 1fr 1fr;
  }

  .dialog-grid {
    grid-template-columns: 1fr;
  }
}
</style>
