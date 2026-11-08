import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const dataDir = await mkdtemp(join(tmpdir(), 'edupi-mcp-'));
process.env.EDU_DATA_DIR = dataDir;

const { db } = await import('../src/store.ts');
const {
  McpError,
  callMcpTool,
  createMcpServer,
  createMcpTools,
  deleteMcpServer,
  listMcpServers,
  mcpTools,
  setMcpToolEnabled,
  syncMcpJson,
  testMcpServer,
} = await import('../src/mcp/service.ts');

const mockPath = resolve(fileURLToPath(new URL('.', import.meta.url)), 'mock-mcp-server.mjs');
let failures = 0;

function report(ok: boolean, name: string, detail = ''): void {
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`);
}

try {
  const created = createMcpServer({
    name: 'mock',
    transport: 'stdio',
    command: process.execPath,
    args: [mockPath],
    env: { MOCK_TOKEN: 'super-secret-token' },
    enabled: true,
  });
  const listed = listMcpServers();
  const row = db.prepare('SELECT secrets FROM mcp_servers WHERE server_id = ?').get(created.server_id) as {
    secrets: string;
  };
  report(
    created.name === 'mock' &&
      created.transport === 'stdio' &&
      created.env_keys.includes('MOCK_TOKEN') &&
      !JSON.stringify(created).includes('super-secret-token') &&
      !row.secrets.includes('super-secret-token'),
    'create server with encrypted secrets',
  );

  const tested = await testMcpServer(created.server_id);
  report(
    tested.server.status === 'connected' &&
      tested.server.tools.some((tool) => tool.name === 'echo') &&
      tested.server.tools.some((tool) => tool.name === 'sum'),
    'connect and discover tools',
    `${tested.server.tools.length} tools, ${tested.latency_ms}ms`,
  );

  const called = await callMcpTool(created.server_id, 'echo', { text: 'hello' });
  const text = called.content
    .map((item) => (item && typeof item === 'object' ? (item as { text?: string }).text : ''))
    .filter(Boolean)
    .join('');
  report(text === 'echo:hello', 'call discovered tool', text);

  const disabled = setMcpToolEnabled(created.server_id, 'echo', false);
  report(
    disabled.tools.find((tool) => tool.name === 'echo')?.enabled === false &&
      mcpTools().every((entry) => !(entry.server.server_id === created.server_id && entry.tool.name === 'echo')),
    'disable individual tool',
  );
  let disabledError = false;
  try {
    await callMcpTool(created.server_id, 'echo', { text: 'blocked' });
  } catch (error) {
    disabledError = error instanceof McpError && error.code === 'MCP_TOOL_DISABLED';
  }
  report(disabledError, 'disabled tool is not callable');
  setMcpToolEnabled(created.server_id, 'echo', true);

  const tools = await createMcpTools();
  report(
    tools.some((tool) => tool.name === 'mcp__mock__echo'),
    'MCP tools are registered for Pi',
    tools.map((tool) => tool.name).join(', '),
  );

  await syncMcpJson();
  const config = JSON.parse(await readFile(join(dataDir, 'pi-agent', 'mcp.json'), 'utf8'));
  report(
    config.mcpServers?.mock?.command === process.execPath &&
      config.mcpServers?.mock?.env?.MOCK_TOKEN === 'super-secret-token',
    'mcp.json synced for Pi',
  );

  report(deleteMcpServer(created.server_id) === true && listMcpServers().length === 0, 'delete server');
  await syncMcpJson();
  const afterDelete = JSON.parse(await readFile(join(dataDir, 'pi-agent', 'mcp.json'), 'utf8'));
  report(!afterDelete.mcpServers?.mock, 'mcp.json removes deleted server');

  console.log(failures === 0 ? 'ALL PASS' : `---\n${failures} FAILED`);
  process.exitCode = failures === 0 ? 0 : 1;
} finally {
  db.close();
  await rm(dataDir, { recursive: true, force: true });
}
