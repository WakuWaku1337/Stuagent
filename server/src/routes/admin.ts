import { Hono, type Context } from 'hono';
import { readdir, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  AuthError,
  authEnabled,
  createUser,
  listAuthEvents,
  listUsers,
  recordAuthEvent,
  registrationOpen,
  resetUserPassword,
  updateUser,
  type UserRole,
  type UserStatus,
} from '../auth/service.ts';
import { currentUser, requireAdmin, secureCookie } from '../auth/middleware.ts';
import { dbPath } from '../store.ts';

const admin = new Hono();
admin.use('*', requireAdmin);

function errorResponse(c: Context, error: unknown) {
  if (error instanceof AuthError) {
    return c.json({ code: error.code, error: error.message }, error.status as 400);
  }
  return c.json({ code: 'ADMIN_ERROR', error: error instanceof Error ? error.message : String(error) }, 500);
}

admin.get('/users', (c) => c.json({ users: listUsers() }));

admin.post('/users', async (c) => {
  const actor = currentUser(c)!;
  const body = await c.req
    .json<{
      username?: string;
      password?: string;
      phone?: string;
      email?: string;
      displayName?: string;
      role?: UserRole;
    }>()
    .catch(() => null);
  if (!body?.username) return c.json({ code: 'INVALID_BODY', error: '缺少用户名' }, 400);
  const generated = body.password ? null : `edu-${Math.random().toString(36).slice(2, 10)}`;
  try {
    const user = await createUser({
      username: body.username,
      password: body.password ?? generated!,
      phone: body.phone,
      email: body.email,
      displayName: body.displayName,
      role: body.role === 'admin' ? 'admin' : 'user',
      mustChangePassword: true,
    });
    recordAuthEvent(actor.user_id, 'admin_user_created', 'success', { target: user.user_id });
    return c.json({ user, tempPassword: generated }, 201);
  } catch (error) {
    return errorResponse(c, error);
  }
});

admin.put('/users/:id', async (c) => {
  const actor = currentUser(c)!;
  const body = await c.req
    .json<{
      status?: UserStatus;
      role?: UserRole;
      displayName?: string | null;
      phone?: string | null;
      email?: string | null;
    }>()
    .catch(() => null);
  if (!body) return c.json({ code: 'INVALID_BODY', error: '请求体必须是 JSON' }, 400);
  if (body.status && !['active', 'disabled'].includes(body.status)) {
    return c.json({ code: 'INVALID_STATUS', error: '账号状态无效' }, 422);
  }
  if (body.role && !['admin', 'user'].includes(body.role)) {
    return c.json({ code: 'INVALID_ROLE', error: '角色无效' }, 422);
  }
  try {
    const user = updateUser(c.req.param('id'), body);
    recordAuthEvent(actor.user_id, 'admin_user_updated', 'success', {
      target: user.user_id,
      status: user.status,
      role: user.role,
    });
    return c.json({ user });
  } catch (error) {
    return errorResponse(c, error);
  }
});

admin.post('/users/:id/reset-password', async (c) => {
  const actor = currentUser(c)!;
  const body = await c.req.json<{ password?: string }>().catch(() => null);
  try {
    const tempPassword = await resetUserPassword(c.req.param('id'), body?.password);
    recordAuthEvent(actor.user_id, 'admin_password_reset', 'success', { target: c.req.param('id') });
    return c.json({ tempPassword });
  } catch (error) {
    return errorResponse(c, error);
  }
});

admin.get('/audit', (c) => c.json({ events: listAuthEvents(Number(c.req.query('limit') ?? 100)) }));

admin.get('/system-check', async (c) => {
  const users = listUsers();
  const adminCount = users.filter((user) => user.role === 'admin' && user.status === 'active').length;
  const activeUsers = users.filter((user) => user.status === 'active').length;
  const backupDir = join(dirname(dbPath()), 'backups');
  let latestBackup: { file: string; created_at: number } | null = null;
  try {
    const files = (await readdir(backupDir)).filter((name) => /^edu-.*\.db$/.test(name));
    for (const file of files) {
      const info = await stat(join(backupDir, file)).catch(() => null);
      if (info && (!latestBackup || info.mtimeMs > latestBackup.created_at)) {
        latestBackup = { file, created_at: info.mtimeMs };
      }
    }
  } catch {
    // 备份目录不存在时下方检查项会给出提示
  }
  const backupAgeHours = latestBackup ? (Date.now() - latestBackup.created_at) / 3_600_000 : null;
  const secure = secureCookie(c);

  const checks: { id: string; label: string; status: 'pass' | 'warn' | 'fail'; message: string }[] = [
    {
      id: 'auth',
      label: '账号认证',
      status: authEnabled() ? 'pass' : 'fail',
      message: authEnabled() ? '已开启登录校验' : 'AUTH_ENABLED=0，公网禁止',
    },
    {
      id: 'admin',
      label: '管理员账号',
      status: adminCount > 0 ? 'pass' : 'fail',
      message: adminCount > 0 ? `活跃管理员 ${adminCount} 个` : '没有可用管理员',
    },
    {
      id: 'registration',
      label: '注册入口',
      status: registrationOpen() ? 'warn' : 'pass',
      message: registrationOpen() ? '公开注册已开启，请确认数据隔离与配额' : '公开注册已关闭，仅管理员建号',
    },
    {
      id: 'https',
      label: 'HTTPS / Cookie',
      status: secure ? 'pass' : 'warn',
      message: secure ? '当前请求为 HTTPS，会话 Cookie 带 Secure' : '当前请求不是 HTTPS；公网部署必须配置证书',
    },
    {
      id: 'backup',
      label: '最近备份',
      status:
        backupAgeHours === null ? 'fail' : backupAgeHours <= 7 * 24 ? 'pass' : 'warn',
      message:
        backupAgeHours === null
          ? '没有找到 data/backups/edu-*.db，请运行 npm run backup'
          : `最近备份 ${latestBackup!.file}，${backupAgeHours.toFixed(1)} 小时前`,
    },
  ];

  return c.json({
    generated_at: Date.now(),
    auth_enabled: authEnabled(),
    registration_open: registrationOpen(),
    secure_cookie: secure,
    users: {
      total: users.length,
      active: activeUsers,
      admins: adminCount,
      sessions: users.reduce((sum, user) => sum + user.session_count, 0),
    },
    backup: latestBackup
      ? { file: latestBackup.file, created_at: latestBackup.created_at, age_hours: Number(backupAgeHours!.toFixed(1)) }
      : null,
    checks,
  });
});

export default admin;
