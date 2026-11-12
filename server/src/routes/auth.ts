import { Hono, type Context } from 'hono';
import {
  AuthError,
  authEnabled,
  bootstrapAdmin,
  bootstrapAllowed,
  bootstrapLocalOnly,
  changePassword,
  clearLoginFailures,
  countUsers,
  createSession,
  createUser,
  findUserByUsername,
  loginAttemptKey,
  loginLockedFor,
  markLastLogin,
  noteLoginFailure,
  recordAuthEvent,
  registrationOpen,
  registrationRateLimited,
  revokeAllSessions,
  revokeSession,
  listSessions,
  verifyPassword,
} from '../auth/service.ts';
import {
  clearSessionCookie,
  bootstrapSourceAllowed,
  currentSession,
  requestIp,
  requestSessionToken,
  requestUserAgent,
  setSessionCookie,
} from '../auth/middleware.ts';

const auth = new Hono();

function errorResponse(c: Context, error: unknown) {
  if (error instanceof AuthError) {
    return c.json({ code: error.code, error: error.message, message: error.message }, error.status as 400);
  }
  const message = error instanceof Error ? error.message : String(error);
  return c.json({ code: 'AUTH_ERROR', error: message, message }, 500);
}

auth.get('/bootstrap', (c) =>
  c.json({
    authEnabled: authEnabled(),
    initialized: countUsers() > 0,
    registrationOpen: registrationOpen(),
    bootstrapAllowed: bootstrapAllowed(),
    bootstrapLocalOnly: bootstrapLocalOnly(),
  }),
);

auth.post('/register', async (c) => {
  if (!authEnabled()) return c.json({ code: 'AUTH_DISABLED', error: '认证已关闭' }, 400);
  const ip = requestIp(c);
  const userAgent = requestUserAgent(c);
  const rate = registrationRateLimited(ip);
  if (rate.limited) {
    c.header('Retry-After', String(rate.retryAfterSec));
    return c.json(
      {
        code: 'RATE_LIMITED',
        error: '注册过于频繁，请稍后再试',
        message: '注册过于频繁，请稍后再试',
      },
      429,
    );
  }
  const body = await c.req
    .json<{
      username?: string;
      password?: string;
      phone?: string;
      email?: string;
      displayName?: string;
    }>()
    .catch(() => null);
  if (!body) return c.json({ code: 'INVALID_BODY', error: '请求体必须是 JSON' }, 400);

  try {
    const initialized = countUsers() > 0;
    if (!initialized && !bootstrapAllowed()) {
      return c.json(
        {
          code: 'NOT_INITIALIZED',
          error: '实例尚未初始化，请先运行 npm run auth:bootstrap',
          message: '实例尚未初始化，请先运行 npm run auth:bootstrap',
        },
        409,
      );
    }
    if (!initialized) {
      const source = bootstrapSourceAllowed(c);
      if (!source.allowed) {
        recordAuthEvent(null, 'bootstrap', 'blocked', { reason: source.reason }, { ip, userAgent });
        return c.json(
          {
            code: 'BOOTSTRAP_LOCAL_ONLY',
            error: source.reason ?? '首个管理员只能在本机创建',
            message: source.reason ?? '首个管理员只能在本机创建',
          },
          403,
        );
      }
    }
    if (initialized && !registrationOpen()) {
      return c.json(
        { code: 'REGISTRATION_CLOSED', error: '当前未开放注册', message: '当前未开放注册' },
        403,
      );
    }

    const user = initialized
      ? await createUser({
          username: body.username ?? '',
          password: body.password ?? '',
          phone: body.phone,
          email: body.email,
          displayName: body.displayName,
        })
      : await bootstrapAdmin({
          username: body.username ?? '',
          password: body.password ?? '',
          phone: body.phone,
          email: body.email,
          displayName: body.displayName,
        });

    const session = createSession(user.user_id, { ip, userAgent });
    setSessionCookie(c, session.token);
    recordAuthEvent(user.user_id, initialized ? 'register' : 'bootstrap', 'success', {}, { ip, userAgent });
    return c.json({ authEnabled: true, user }, 201);
  } catch (error) {
    recordAuthEvent(null, 'register', 'failed', { message: error instanceof Error ? error.message : String(error) }, { ip, userAgent });
    return errorResponse(c, error);
  }
});

auth.post('/login', async (c) => {
  if (!authEnabled()) return c.json({ code: 'AUTH_DISABLED', error: '认证已关闭' }, 400);
  const body = await c.req
    .json<{ username?: string; password?: string }>()
    .catch(() => null);
  if (!body?.username || !body.password) {
    return c.json({ code: 'INVALID_BODY', error: '请输入用户名和密码' }, 400);
  }
  const ip = requestIp(c);
  const userAgent = requestUserAgent(c);
  const key = loginAttemptKey(ip, body.username);
  const locked = loginLockedFor(key);
  if (locked > 0) {
    c.header('Retry-After', String(Math.max(1, Math.ceil(locked / 1000))));
    return c.json(
      {
        code: 'LOGIN_LOCKED',
        error: `登录尝试过多，请 ${Math.ceil(locked / 60000)} 分钟后再试`,
        message: `登录尝试过多，请 ${Math.ceil(locked / 60000)} 分钟后再试`,
      },
      429,
    );
  }

  const row = findUserByUsername(body.username);
  if (!row || row.status !== 'active' || !(await verifyPassword(body.password, row.password_hash))) {
    noteLoginFailure(key);
    recordAuthEvent(row?.user_id ?? null, 'login', 'failed', { username: body.username }, { ip, userAgent });
    return c.json({ code: 'LOGIN_FAILED', error: '用户名或密码错误' }, 401);
  }

  clearLoginFailures(key);
  markLastLogin(row.user_id);
  const session = createSession(row.user_id, { ip, userAgent });
  setSessionCookie(c, session.token);
  recordAuthEvent(row.user_id, 'login', 'success', {}, { ip, userAgent });
  const user = {
    user_id: row.user_id,
    username: row.username,
    display_name: row.display_name,
    phone: row.phone,
    email: row.email,
    role: row.role,
    status: row.status,
    must_change_password: Boolean(row.must_change_password),
    last_login_at: Date.now(),
    created_at: row.created_at,
  };
  return c.json({ authEnabled: true, user });
});

auth.post('/logout', (c) => {
  const current = currentSession(c);
  const token = requestSessionToken(c);
  if (current && token) {
    revokeSession(current.session_id, current.user_id);
    recordAuthEvent(current.user_id, 'logout', 'success', {}, { ip: requestIp(c), userAgent: requestUserAgent(c) });
  }
  clearSessionCookie(c);
  return c.json({ ok: true });
});

auth.get('/me', (c) => {
  if (!authEnabled()) return c.json({ authEnabled: false, user: null });
  const current = currentSession(c);
  if (!current) return c.json({ code: 'UNAUTHORIZED', error: '未登录或登录已过期' }, 401);
  const { session_id: _sessionId, ...user } = current;
  return c.json({ authEnabled: true, user });
});

auth.put('/password', async (c) => {
  const current = currentSession(c);
  if (!current) return c.json({ code: 'UNAUTHORIZED', error: '未登录或登录已过期' }, 401);
  const body = await c.req
    .json<{ currentPassword?: string; newPassword?: string }>()
    .catch(() => null);
  if (!body?.currentPassword || !body.newPassword) {
    return c.json({ code: 'INVALID_BODY', error: '请输入当前密码和新密码' }, 400);
  }
  try {
    await changePassword(current.user_id, current.session_id, body.currentPassword, body.newPassword);
    recordAuthEvent(current.user_id, 'password_changed', 'success', {}, { ip: requestIp(c), userAgent: requestUserAgent(c) });
    return c.json({ ok: true });
  } catch (error) {
    return errorResponse(c, error);
  }
});

auth.get('/sessions', (c) => {
  const current = currentSession(c);
  if (!current) return c.json({ code: 'UNAUTHORIZED', error: '未登录或登录已过期' }, 401);
  return c.json({ sessions: listSessions(current.user_id, requestSessionToken(c)) });
});

auth.delete('/sessions/:id', (c) => {
  const current = currentSession(c);
  if (!current) return c.json({ code: 'UNAUTHORIZED', error: '未登录或登录已过期' }, 401);
  const ok = revokeSession(c.req.param('id'), current.user_id);
  if (!ok) return c.json({ code: 'SESSION_NOT_FOUND', error: '会话不存在' }, 404);
  return c.json({ ok: true });
});

auth.post('/sessions/revoke-all', (c) => {
  const current = currentSession(c);
  if (!current) return c.json({ code: 'UNAUTHORIZED', error: '未登录或登录已过期' }, 401);
  revokeAllSessions(current.user_id);
  clearSessionCookie(c);
  recordAuthEvent(current.user_id, 'sessions_revoked', 'success', {}, { ip: requestIp(c), userAgent: requestUserAgent(c) });
  return c.json({ ok: true });
});

export default auth;
