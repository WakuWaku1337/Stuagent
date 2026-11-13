import type { Context, MiddlewareHandler } from 'hono';
import { CSRF_ALLOWED_ORIGINS, CSRF_ENABLED } from '../config.ts';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * B1-2 豁免清单（显式枚举，禁止「无 Origin 一律放行」）：
 *  1. 安全方法 GET / HEAD / OPTIONS：见 SAFE_METHODS。
 *  2. 不在 /api/* 作用域内：GET /health、WebSocket /ws 握手、SPA 静态资源。
 *  3. SSE 流式响应：浏览器同源 fetch 发起，仍走 Origin 校验；不单独豁免。
 *  4. 无 Origin / Referer 的非浏览器写请求：仅限 CLI_AUTH_PATHS 下列 CLI 认证入口。
 *  5. MCP stdio / HTTP：服务端出站调用，不经过本中间件。
 * 挂载点见 server/src/index.ts 的 app.use('/api/*', csrfGuard)。
 */
const CLI_AUTH_PATHS = new Set(['/api/auth/login', '/api/auth/register', '/api/auth/bootstrap']);

function normalizeOrigin(value: string): string {
  return value.trim().replace(/\/+$/, '').toLowerCase();
}

function hostOf(value: string): string | null {
  try {
    return new URL(value.includes('://') ? value : `http://${value}`).host.toLowerCase();
  } catch {
    return null;
  }
}

function requestHost(c: Context): string {
  if (process.env.TRUST_PROXY !== '0') {
    const forwarded = c.req.header('x-forwarded-host');
    if (forwarded) return forwarded.split(',')[0].trim().toLowerCase();
  }
  return (c.req.header('host') ?? new URL(c.req.url).host).toLowerCase();
}

function trustedOrigin(c: Context, value: string): boolean {
  const normalized = normalizeOrigin(value);
  if (CSRF_ALLOWED_ORIGINS.some((item) => normalizeOrigin(item) === normalized)) return true;
  const host = hostOf(value);
  return Boolean(host && host === requestHost(c));
}

export const csrfGuard: MiddlewareHandler = async (c, next) => {
  if (!CSRF_ENABLED || SAFE_METHODS.has(c.req.method)) return next();

  const origin = c.req.header('origin');
  if (origin) {
    if (origin === 'null' || !trustedOrigin(c, origin)) {
      return c.json(
        {
          code: 'CSRF_REJECTED',
          error: '跨站请求被拒绝',
          message: '跨站请求被拒绝',
        },
        403,
      );
    }
    return next();
  }

  const referer = c.req.header('referer');
  if (referer) {
    if (!trustedOrigin(c, referer)) {
      return c.json(
        {
          code: 'CSRF_REJECTED',
          error: '跨站请求被拒绝',
          message: '跨站请求被拒绝',
        },
        403,
      );
    }
    return next();
  }

  if (CLI_AUTH_PATHS.has(c.req.path)) return next();

  return c.json(
    {
      code: 'CSRF_REJECTED',
      error: '缺少同源 Origin / Referer，已拒绝非幂等请求',
      message: '缺少同源 Origin / Referer，已拒绝非幂等请求',
    },
    403,
  );
};
