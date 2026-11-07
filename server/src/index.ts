import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { chat, getModelInfo } from './pi.ts';

const serverRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const envPath = resolve(serverRoot, '.env');
if (existsSync(envPath)) process.loadEnvFile(envPath);

const app = new Hono();

app.get('/health', (c) =>
  c.json({
    status: 'ok',
    service: 'edu-agent-server',
    time: new Date().toISOString(),
  }),
);

app.get('/api/model', async (c) => {
  try {
    return c.json(await getModelInfo());
  } catch (e) {
    return c.json({ configured: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

app.post('/api/chat', async (c) => {
  const body = await c.req.json<{ message?: string; sessionId?: string; stream?: boolean }>().catch(() => null);
  const message = body?.message?.trim();
  if (!message) return c.json({ error: 'message 不能为空' }, 400);
  const sessionId = body?.sessionId || 'default';

  if (body?.stream) {
    return streamSSE(c, async (stream) => {
      try {
        await chat(
          sessionId,
          message,
          (event) => {
            void stream.writeSSE({ event: event.type, data: JSON.stringify(event) });
          },
          c.req.raw.signal,
        );
      } catch (e) {
        await stream.writeSSE({
          event: 'error',
          data: JSON.stringify({ type: 'error', message: e instanceof Error ? e.message : String(e) }),
        });
      }
    });
  }

  try {
    const text = await chat(sessionId, message, () => {}, c.req.raw.signal);
    return c.json({ sessionId, reply: text });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 502);
  }
});

const port = Number(process.env.PORT ?? 3000);

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`[edu-agent] server listening on http://localhost:${info.port}`);
});

export default app;