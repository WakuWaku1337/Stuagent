import { Hono, type Context } from 'hono';
import {
  McpError,
  confirmMcpTool,
  createMcpServer,
  deleteMcpServer,
  listMcpServers,
  mcpTools,
  setMcpToolEnabled,
  testMcpServer,
  updateMcpServer,
  type McpExposure,
  type McpTransport,
} from '../mcp/service.ts';
import { requireAdmin } from '../auth/middleware.ts';

const mcp = new Hono();
mcp.use('*', requireAdmin);

function errorResponse(c: Context, error: unknown) {
  if (error instanceof McpError) {
    return c.json({ code: error.code, error: error.message, message: error.message }, error.status as 400);
  }
  const message = error instanceof Error ? error.message : String(error);
  return c.json({ code: 'MCP_ERROR', error: message, message }, 500);
}

mcp.get('/servers', (c) => c.json({ servers: listMcpServers() }));

mcp.post('/servers', async (c) => {
  const body = await c.req
    .json<{
      name?: string;
      transport?: McpTransport;
      command?: string;
      args?: string[];
      url?: string;
      env?: Record<string, string>;
      headers?: Record<string, string>;
      enabled?: boolean;
      exposure?: McpExposure;
    }>()
    .catch(() => null);
  if (!body) return c.json({ code: 'INVALID_BODY', message: '请求体必须是 JSON' }, 400);
  try {
    const server = createMcpServer({
      name: body.name ?? '',
      transport: body.transport,
      command: body.command,
      args: body.args,
      url: body.url,
      env: body.env,
      headers: body.headers,
      enabled: body.enabled,
      exposure: body.exposure,
    });
    return c.json({ server }, 201);
  } catch (error) {
    return errorResponse(c, error);
  }
});

mcp.put('/servers/:id', async (c) => {
  const body = await c.req
    .json<{
      name?: string;
      transport?: McpTransport;
      command?: string;
      args?: string[];
      url?: string;
      env?: Record<string, string>;
      headers?: Record<string, string>;
      enabled?: boolean;
      exposure?: McpExposure;
    }>()
    .catch(() => null);
  if (!body) return c.json({ code: 'INVALID_BODY', message: '请求体必须是 JSON' }, 400);
  try {
    return c.json({ server: updateMcpServer(c.req.param('id'), body) });
  } catch (error) {
    return errorResponse(c, error);
  }
});

mcp.delete('/servers/:id', (c) => {
  const deleted = deleteMcpServer(c.req.param('id'));
  return deleted
    ? c.json({ deleted: c.req.param('id') })
    : c.json({ code: 'MCP_NOT_FOUND', message: 'MCP 服务不存在' }, 404);
});

mcp.post('/servers/:id/test', async (c) => {
  try {
    return c.json(await testMcpServer(c.req.param('id')));
  } catch (error) {
    return errorResponse(c, error);
  }
});

mcp.get('/tools', (c) => c.json({ tools: mcpTools() }));

mcp.put('/servers/:id/tools/:toolName', async (c) => {
  const body = await c.req.json<{ enabled?: boolean }>().catch(() => null);
  if (!body || typeof body.enabled !== 'boolean') {
    return c.json({ code: 'INVALID_ENABLED', error: 'enabled 必须是布尔值', message: 'enabled 必须是布尔值' }, 400);
  }
  try {
    return c.json({ server: setMcpToolEnabled(c.req.param('id'), c.req.param('toolName'), body.enabled) });
  } catch (error) {
    return errorResponse(c, error);
  }
});

mcp.post('/servers/:id/tools/:toolName/confirm', (c) => {
  try {
    return c.json({ server: confirmMcpTool(c.req.param('id'), c.req.param('toolName')) });
  } catch (error) {
    return errorResponse(c, error);
  }
});

export default mcp;
