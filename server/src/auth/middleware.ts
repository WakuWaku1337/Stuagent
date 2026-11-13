import type { Context, MiddlewareHandler } from 'hono';
import { deleteCookie, setCookie } from 'hono/cookie';
import { getConnInfo } from '@hono/node-server/conninfo';
import {
  authEnabled,
  bootstrapLocalOnly,
  cookieName,
  parseCookieToken,
  sessionUser,
  type AuthUser,
} from './service.ts';
import { LEGACY_LEARNER, runWithLearner } from '../learning/context.ts';

export type AuthContext = AuthUser & { session_id: string };

const requestUsers = new WeakMap<Context, AuthContext>();

export function requestIp(c: Context): string {
  if (process.env.TRUST_PROXY !== '0') {
    const forwarded = c.req.header('x-forwarded-for');
    if (forwarded) return forwarded.split(',')[0].trim();
  }
  return c.req.header('x-real-ip')?.trim() || 'local';
}

export function requestUserAgent(c: Context): string {
  return c.req.header('user-agent')?.slice(0, 300) || 'unknown';
}

const FORWARDING_HEADERS = [
  'x-forwarded-for',
  'x-forwarded-host',
  'x-forwarded-proto',
  'x-real-ip',
  'forwarded',
];

function isLoopback(address: string | undefined): boolean {
  if (!address) return false;
  const value = address.trim().toLowerCase();
  return (
    value === '127.0.0.1' ||
    value === '::1' ||
    value === '::ffff:127.0.0.1' ||
    value.startsWith('127.')
  );
}

/**
 * 首个管理员只能从本机连接创建。
 * 不复用 requestIp()：它会信任可伪造的 x-forwarded-for；这里只看连接层地址，
 * 且任何携带转发头的请求一律拒绝。
 */
export function bootstrapSourceAllowed(c: Context): { allowed: boolean; reason?: string } {
  if (!bootstrapLocalOnly()) return { allowed: true };
  if (FORWARDING_HEADERS.some((name) => Boolean(c.req.header(name)))) {
    return { allowed: false, reason: 'bootstrap 请求不得经过反向代理转发' };
  }
  try {
    const info = getConnInfo(c);
    if (isLoopback(info.remote.address)) return { allowed: true };
    return { allowed: false, reason: '首个管理员只能在本机创建' };
  } catch {
    return { allowed: false, reason: '无法确认请求来源，已拒绝 bootstrap' };
  }
}

export function secureCookie(c: Context): boolean {
  const setting = (process.env.COOKIE_SECURE ?? 'auto').toLowerCase();
  if (setting === '1' || setting === 'true') return true;
  if (setting === '0' || setting === 'false') return false;
  const forwarded = c.req.header('x-forwarded-proto');
  if (forwarded) return forwarded.split(',')[0].trim() === 'https';
  return new URL(c.req.url).protocol === 'https:';
}

export function requestSessionToken(c: Context): string | null {
  return parseCookieToken(c.req.header('cookie') ?? null);
}

export function currentSession(c: Context): AuthContext | null {
  return sessionUser(requestSessionToken(c));
}

export function currentUser(c: Context): AuthContext | null {
  return requestUsers.get(c) ?? null;
}

export function setCurrentUser(c: Context, user: AuthContext): void {
  requestUsers.set(c, user);
}

export function setSessionCookie(c: Context, token: string): void {
  const absoluteDays = Number(process.env.SESSION_ABSOLUTE_DAYS ?? 30);
  const secure = secureCookie(c);
  setCookie(c, cookieName(secure), token, {
    httpOnly: true,
    sameSite: 'Lax',
    secure,
    path: '/',
    maxAge: absoluteDays * 86400,
  });
}

export function clearSessionCookie(c: Context): void {
  deleteCookie(c, cookieName(true), { path: '/', secure: true, httpOnly: true, sameSite: 'Lax' });
  deleteCookie(c, cookieName(false), { path: '/', httpOnly: true, sameSite: 'Lax' });
}

export const requireAuth: MiddlewareHandler = async (c, next) => {
  if (!authEnabled()) {
    return runWithLearner({ learnerId: LEGACY_LEARNER, userId: LEGACY_LEARNER, role: 'admin' }, next);
  }
  if (c.req.path.startsWith('/api/auth/')) {
    await next();
    return;
  }
  const user = currentSession(c);
  if (!user) {
    return c.json({ code: 'UNAUTHORIZED', error: '未登录或登录已过期', message: '未登录或登录已过期' }, 401);
  }
  setCurrentUser(c, user);
  return runWithLearner({ learnerId: user.user_id, userId: user.user_id, role: user.role }, next);
};

export const requireAdmin: MiddlewareHandler = async (c, next) => {
  if (!authEnabled()) {
    await next();
    return;
  }
  const user = currentUser(c);
  if (!user) {
    return c.json({ code: 'UNAUTHORIZED', error: '未登录或登录已过期', message: '未登录或登录已过期' }, 401);
  }
  if (user.role !== 'admin') {
    return c.json({ code: 'FORBIDDEN', error: '需要管理员权限', message: '需要管理员权限' }, 403);
  }
  await next();
};

export function websocketUser(cookieHeader: string | null): AuthContext | null {
  return sessionUser(parseCookieToken(cookieHeader));
}
