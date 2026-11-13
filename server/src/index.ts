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
import authRoutes from './routes/auth.ts';
import adminRoutes from './routes/admin.ts';
import { requireAuth, websocketUser } from './auth/middleware.ts';
import { csrfGuard } from './auth/csrf.ts';
import { authEnabled } from './auth/service.ts';
import learning from './routes/learning.ts';
import reviews from './routes/reviews.ts';
import courseware from './routes/courseware.ts';
import settingsRoutes from './routes/settings.ts';
import usageRoutes from './routes/usage.ts';
import conversations from './routes/conversations.ts';
import media from './routes/media.ts';
import voice from './routes/voice.ts';
import plan from './routes/plan.ts';
import daily from './routes/daily.ts';
import mcpRoutes from './routes/mcp.ts';
import visualize from './routes/visualize.ts';
import { handleChat, type ChatBody } from './chat/handler.ts';
import { searchKnowledge } from './rag/service.ts';
import { AGENTS } from './agents/roles.ts';
import { startStorageJanitor } from './storage/service.ts';
import { syncMcpJson } from './mcp/service.ts';
import { recoverOcrJobs } from './documents/pdf-ocr.ts';
import { startMaintenance } from './maintenance.ts';

const serverRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const envPath = resolve(serverRoot, '.env');
if (existsSync(envPath)) process.loadEnvFile(envPath);

if (!authEnabled()) {
  if (process.env.NODE_ENV === 'production') throw new Error('生产环境禁止 AUTH_ENABLED=0');
  console.warn('[security] AUTH_ENABLED=0：已关闭认证，仅限隔离测试，禁止用于生产');
}

const app = new Hono();
app.use('/api/*', csrfGuard);
app.use('/api/*', requireAuth);
const { upgradeWebSocket, injectWebSocket } = createNodeWebSocket({ app });
const wsClients = new Set<{ ws: { send: (data: string) => void; readyState: number }; learnerId: string }>();

app.get(
  '/ws',
  upgradeWebSocket((c) => {
    const user = authEnabled() ? websocketUser(c.req.header('cookie') ?? null) : null;
    return {
      onOpen(_evt, ws) {
        if (authEnabled() && !user) {
          ws.close(4401, 'unauthorized');
          return;
        }
        wsClients.add({ ws, learnerId: user?.user_id ?? 'default' });
        ws.send(JSON.stringify({ type: 'connected', at: Date.now() }));
      },
      onClose(_evt, ws) {
        for (const client of wsClients) {
          if (client.ws === ws) wsClients.delete(client);
        }
      },
      onMessage(evt, ws) {
        if (typeof evt.data === 'string' && evt.data === 'ping') ws.send(JSON.stringify({ type: 'pong' }));
      },
    };
  }),
);

taskEvents.on('task', (task) => {
  const data = JSON.stringify({ type: 'task', task });
  for (const client of wsClients) {
    if (client.ws.readyState === 1 && client.learnerId === task.learner_id) client.ws.send(data);
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

app.route('/api/auth', authRoutes);
app.route('/api/admin', adminRoutes);
app.route('/api/documents', documents);
app.route('/api', learning);
app.route('/api/reviews', reviews);
app.route('/api/courseware', courseware);
app.route('/api/settings', settingsRoutes);
app.route('/api/usage', usageRoutes);
app.route('/api/conversations', conversations);
app.route('/api/media', media);
app.route('/api/plan', plan);
app.route('/api/daily', daily);
app.route('/api/mcp', mcpRoutes);
app.route('/api/visualize', visualize);
app.route('/api', voice);

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
recoverOcrJobs();
startStorageJanitor();
startMaintenance();
syncMcpJson().catch((error) => {
  console.error('[mcp] 同步 mcp.json 失败:', error instanceof Error ? error.message : error);
});

export default app;