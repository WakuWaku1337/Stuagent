import { existsSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { serveStatic } from '@hono/node-server/serve-static';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import { createNodeWebSocket } from '@hono/node-ws';
import { Hono } from 'hono';
import { cancelTask, enqueue, getTask, listTasks, startQueue, taskEvents, type TaskType } from './tasks/queue.ts';
import { getModelInfo } from './pi.ts';
import documents from './routes/documents.ts';
import learning from './routes/learning.ts';
import reviews from './routes/reviews.ts';
import courseware from './routes/courseware.ts';
import settingsRoutes from './routes/settings.ts';
import usageRoutes from './routes/usage.ts';
import conversations from './routes/conversations.ts';
import media from './routes/media.ts';
import { handleChat, type ChatBody } from './chat/handler.ts';
import { searchKnowledge } from './rag/service.ts';
import { AGENTS } from './agents/roles.ts';

const serverRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const envPath = resolve(serverRoot, '.env');
if (existsSync(envPath)) process.loadEnvFile(envPath);

const app = new Hono();
const { upgradeWebSocket, injectWebSocket } = createNodeWebSocket({ app });
const wsClients = new Set<{ send: (data: string) => void; readyState: number }>();

app.get(
  '/ws',
  upgradeWebSocket(() => ({
    onOpen(_evt, ws) {
      wsClients.add(ws);
      ws.send(JSON.stringify({ type: 'connected', at: Date.now() }));
    },
    onClose(_evt, ws) {
      wsClients.delete(ws);
    },
    onMessage(evt, ws) {
      if (typeof evt.data === 'string' && evt.data === 'ping') ws.send(JSON.stringify({ type: 'pong' }));
    },
  })),
);

taskEvents.on('task', (task) => {
  const data = JSON.stringify({ type: 'task', task });
  for (const client of wsClients) {
    if (client.readyState === 1) client.send(data);
  }
});

app.get('/api/tasks', (c) => c.json({ tasks: listTasks() }));
app.get('/api/tasks/:id', (c) => {
  const task = getTask(c.req.param('id'));
  return task ? c.json(task) : c.json({ error: '任务不存在' }, 404);
});
app.post('/api/tasks', async (c) => {
  const body = await c.req.json<{ type?: TaskType; payload?: Record<string, unknown> }>().catch(() => null);
  if (body?.type !== 'quiz' && body?.type !== 'analysis') {
    return c.json({ error: 'type 必须是 quiz 或 analysis' }, 400);
  }
  const task = enqueue(body.type, body.payload ?? {});
  return c.json(task, 202);
});
app.post('/api/tasks/:id/cancel', (c) => {
  const task = cancelTask(c.req.param('id'));
  return task ? c.json(task) : c.json({ error: '任务不存在' }, 404);
});

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

app.route('/api/documents', documents);
app.route('/api', learning);
app.route('/api/reviews', reviews);
app.route('/api/courseware', courseware);
app.route('/api/settings', settingsRoutes);
app.route('/api/usage', usageRoutes);
app.route('/api/conversations', conversations);
app.route('/api/media', media);

app.post('/api/knowledge/search', async (c) => {
  const body = await c.req.json<{ query?: string; topK?: number; subject?: string }>().catch(() => null);
  const query = body?.query?.trim();
  if (!query) return c.json({ error: 'query 不能为空' }, 400);
  try {
    const result = await searchKnowledge(query, { topK: body?.topK, subject: body?.subject });
    return c.json(result);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 502);
  }
});

app.get('/api/agents', (c) =>
  c.json({ agents: Object.values(AGENTS).map(({ id, name, description }) => ({ id, name, description })) }),
);

app.post('/api/chat', async (c) => {
  const body = await c.req.json<ChatBody>().catch(() => null);
  if (!body) return c.json({ error: '请求体必须是 JSON' }, 400);
  return handleChat(c, body);
});

const webDist = resolve(serverRoot, '..', 'web', 'dist');
const spaIndex = resolve(webDist, 'index.html');
if (existsSync(spaIndex)) {
  app.use('/*', serveStatic({ root: webDist }));
  app.get('*', (c) => {
    if (c.req.path.startsWith('/api/')) return c.json({ error: 'Not Found' }, 404);
    return c.html(readFileSync(spaIndex, 'utf8'));
  });
  console.log(`[edu-agent] serving built web from ${webDist}`);
}

const port = Number(process.env.PORT ?? 3000);

const server = serve({ fetch: app.fetch, port }, (info) => {
  console.log(`[edu-agent] server listening on http://localhost:${info.port}`);
});
injectWebSocket(server);
startQueue();

export default app;