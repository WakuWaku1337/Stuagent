/**
 * CLI 验收脚本的同源声明：非幂等请求带上目标地址的 Origin，供 CSRF 中间件校验。
 * 浏览器请求不经过本文件；脚本显式设置的 Origin / Referer 不会被覆盖。
 */
const originalFetch = globalThis.fetch;

function resolveOrigin(input: RequestInfo | URL): string | null {
  try {
    if (input instanceof URL) return input.origin;
    if (typeof input === 'string') return new URL(input).origin;
    return new URL(input.url).origin;
  } catch {
    return null;
  }
}

globalThis.fetch = ((input: RequestInfo | URL, init: RequestInit = {}) => {
  const headers = new Headers(init.headers);
  const skip = headers.get('x-edupi-no-origin') === '1';
  headers.delete('x-edupi-no-origin');
  if (!skip && !headers.has('origin') && !headers.has('referer')) {
    const origin = resolveOrigin(input);
    if (origin) headers.set('origin', origin);
  }
  return originalFetch(input, { ...init, headers });
}) as typeof fetch;

export {};
