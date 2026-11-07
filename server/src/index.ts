import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import { createNodeWebSocket } from '@hono/node-ws';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { cancelTask, enqueue, getTask, listTasks, startQueue, taskEvents, type TaskType } from './tasks/queue.ts';
import { chat, getModelInfo } from './pi.ts';
import documents from './routes/documents.ts';
import learning from './routes/learning.ts';
import reviews from './routes/reviews.ts';
import { searchKnowledge, type Citation } from './rag/service.ts';
import { AGENTS, isAgentId, type AgentId } from './agents/roles.ts';
import { routeMessage } from './agents/router.ts';

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
  const body = await c.req
    .json<{ message?: string; sessionId?: string; stream?: boolean; agent?: string }>()
    .catch(() => null);
  const message = body?.message?.trim();
  if (!message) return c.json({ error: 'message 不能为空' }, 400);
  const sessionId = body?.sessionId || 'default';
  const decision = isAgentId(body?.agent)
    ? { agent: body!.agent as AgentId, reason: '用户指定', source: 'explicit' as const }
    : await routeMessage(message);

  if (body?.stream) {
    return streamSSE(c, async (stream) => {
      try {
        await stream.writeSSE({
          event: 'route',
          data: JSON.stringify({
            type: 'route',
            agent: decision.agent,
            agent_name: AGENTS[decision.agent].name,
            reason: decision.reason,
          }),
        });
        await chat(
          sessionId,
          message,
          (event) => {
            void stream.writeSSE({ event: event.type, data: JSON.stringify(event) });
          },
          c.req.raw.signal,
          decision.agent,
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
    const citations: Citation[] = [];
    const text = await chat(
      sessionId,
      message,
      (event) => {
        if (event.citations) citations.push(...event.citations);
      },
      c.req.raw.signal,
      decision.agent,
    );
    return c.json({
      sessionId,
      agent: decision.agent,
      agent_name: AGENTS[decision.agent].name,
      route_reason: decision.reason,
      reply: text,
      citations,
    });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 502);
  }
});

const port = Number(process.env.PORT ?? 3000);

const server = serve({ fetch: app.fetch, port }, (info) => {
  console.log(`[edu-agent] server listening on http://localhost:${info.port}`);
});
injectWebSocket(server);
startQueue();

export default app;