import { serve } from '@hono/node-server';
import { Hono } from 'hono';

const app = new Hono();

app.get('/health', (c) =>
  c.json({
    status: 'ok',
    service: 'edu-agent-server',
    time: new Date().toISOString(),
  }),
);

const port = Number(process.env.PORT ?? 3000);

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`[edu-agent] server listening on http://localhost:${info.port}`);
});

export default app;