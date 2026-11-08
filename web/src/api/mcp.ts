export type McpTransport = 'stdio' | 'http' | 'sse';
export type McpExposure = 'direct' | 'deferred' | 'codemode' | 'hidden';

export interface McpToolInfo {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  enabled: boolean;
}

export interface McpServerView {
  server_id: string;
  name: string;
  transport: McpTransport;
  command: string | null;
  args: string[];
  url: string | null;
  env_keys: string[];
  header_keys: string[];
  enabled: boolean;
  exposure: McpExposure;
  status: 'unknown' | 'connected' | 'error' | 'disabled';
  last_error: string | null;
  tools: McpToolInfo[];
  created_at: number;
  updated_at: number;
}

export interface McpServerInput {
  name: string;
  transport: McpTransport;
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
  headers?: Record<string, string>;
  enabled?: boolean;
  exposure?: McpExposure;
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.message ?? data?.error ?? `请求失败（${res.status}）`);
  return data as T;
}

export function fetchMcpServers(): Promise<{ servers: McpServerView[] }> {
  return request('/api/mcp/servers');
}

export function createMcpServer(input: McpServerInput): Promise<{ server: McpServerView }> {
  return request('/api/mcp/servers', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
}

export function updateMcpServer(
  id: string,
  input: Partial<McpServerInput>,
): Promise<{ server: McpServerView }> {
  return request(`/api/mcp/servers/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
}

export function deleteMcpServer(id: string): Promise<{ deleted: string }> {
  return request(`/api/mcp/servers/${id}`, { method: 'DELETE' });
}

export function testMcpServer(id: string): Promise<{ server: McpServerView; latency_ms: number }> {
  return request(`/api/mcp/servers/${id}/test`, { method: 'POST' });
}

export function toggleMcpTool(
  serverId: string,
  toolName: string,
  enabled: boolean,
): Promise<{ server: McpServerView }> {
  return request(`/api/mcp/servers/${serverId}/tools/${encodeURIComponent(toolName)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled }),
  });
}
