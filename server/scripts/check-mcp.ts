import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const dataDir = await mkdtemp(join(tmpdir(), 'edupi-mcp-'));
process.env.EDU_DATA_DIR = dataDir;
process.env.EDUPI_TEST_SECRET = 'do-not-pass';

const { db } = await import('../src/store.ts');
const {
  McpError,
  callMcpTool,
  confirmMcpTool,
  createMcpServer,
  createMcpTools,
  deleteMcpServer,
  listMcpServers,
  mcpTools,
  setMcpToolEnabled,
  syncMcpJson,
  testMcpServer,
  validateMcpUrl,
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
  report(
    tested.server.tools
      .filter((tool) => tool.name !== 'env')
      .every((tool) => tool.side_effect && tool.confirmed_at === null) &&
      tested.server.tools.find((tool) => tool.name === 'env')?.side_effect === false,
    'tools without readOnlyHint are marked side-effect and unconfirmed',
  );

  const readEnv = async (name: string) => {
    const result = await callMcpTool(created.server_id, 'env', { name });
    return result.content
      .map((item) => (item && typeof item === 'object' ? (item as { text?: string }).text : ''))
      .filter(Boolean)
      .join('');
  };
  const sentinel = await readEnv('EDUPI_TEST_SECRET');
  const explicit = await readEnv('MOCK_TOKEN');
  report(
    sentinel === 'EDUPI_TEST_SECRET=<unset>',
    'stdio child does not inherit instance env',
    sentinel,
  );
  report(explicit === 'MOCK_TOKEN=super-secret-token', 'explicit MCP env reaches child', explicit);

  const rejects = (url: string) => {
    try {
      validateMcpUrl(url);
      return false;
    } catch (error) {
      return error instanceof McpError;
    }
  };
  report(
    rejects('') && rejects('file:///etc/passwd') && rejects('javascript:alert(1)') && rejects('not a url'),
    'invalid MCP URLs are rejected',
  );
  report(
    validateMcpUrl('http://127.0.0.1:8080/mcp') === 'http://127.0.0.1:8080/mcp' &&
      validateMcpUrl('https://example.com/sse') === 'https://example.com/sse',
    'http/https MCP URLs are accepted',
  );
  let badTransport = false;
  try {
    createMcpServer({ name: 'bad-transport', transport: 'tcp' as never, command: process.execPath });
  } catch (error) {
    badTransport = error instanceof McpError && error.code === 'MCP_TRANSPORT_INVALID';
  }
  report(badTransport, 'invalid transport is rejected');

  let confirmationError = false;
  try {
    await callMcpTool(created.server_id, 'echo', { text: 'hello' });
  } catch (error) {
    confirmationError = error instanceof McpError && error.code === 'MCP_CONFIRMATION_REQUIRED';
  }
  report(confirmationError, 'side-effect tool requires confirmation');

  const confirmed = confirmMcpTool(created.server_id, 'echo');
  report(
    confirmed.tools.find((tool) => tool.name === 'echo')?.confirmed_at !== null,
    'confirm side-effect tool',
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
  const synced = config.mcpServers?.mock ?? {};
  report(
    synced.command === process.execPath &&
      !('env' in synced) &&
      !JSON.stringify(config).includes('super-secret-token'),
    'mcp.json synced without decrypted secrets',
  );

  report(deleteMcpServer(created.server_id) === true && listMcpServers().length === 0, 'delete server');
  const confirmationsLeft = db
    .prepare('SELECT COUNT(*) AS n FROM mcp_tool_confirmations')
    .get() as { n: number };
  report(confirmationsLeft.n === 0, 'delete server clears confirmations');
  await syncMcpJson();
  const afterDelete = JSON.parse(await readFile(join(dataDir, 'pi-agent', 'mcp.json'), 'utf8'));
  report(!afterDelete.mcpServers?.mock, 'mcp.json removes deleted server');

  // B1-4b：升级前已授权的存量工具，经一次性回填后无需重新确认即可调用。
  const { planMcpConfirmationBackfill, applyMcpConfirmationBackfill } = await import(
    '../src/mcp/backfill.ts'
  );
  const legacy = createMcpServer({
    name: 'legacy',
    transport: 'stdio',
    command: process.execPath,
    args: [mockPath],
    env: { MOCK_TOKEN: 'super-secret-token' },
    enabled: true,
  });
  await testMcpServer(legacy.server_id);
  const beforeBackfill = mcpTools().filter((entry) => entry.server.server_id === legacy.server_id);
  report(
    beforeBackfill.length > 0 && beforeBackfill.every((entry) => entry.tool.confirmed_at === null),
    'legacy tools start unconfirmed',
    `${beforeBackfill.length} tools`,
  );

  const plan = planMcpConfirmationBackfill();
  report(
    plan.length === beforeBackfill.length && plan.every((item) => item.server === 'legacy'),
    'backfill plan covers only pre-existing authorized tools',
    `${plan.length} tools`,
  );
  report(applyMcpConfirmationBackfill(plan) === plan.length, 'backfill writes confirmations');
  report(
    mcpTools()
      .filter((entry) => entry.server.server_id === legacy.server_id)
      .every((entry) => entry.tool.confirmed_at !== null),
    'backfilled tools are marked confirmed',
  );
  const legacyCall = await callMcpTool(legacy.server_id, 'echo', { text: 'legacy' });
  const legacyText = legacyCall.content
    .map((item) => (item && typeof item === 'object' ? (item as { text?: string }).text : ''))
    .filter(Boolean)
    .join('');
  report(legacyText === 'echo:legacy', 'legacy tool is callable without re-confirmation', legacyText);
  report(planMcpConfirmationBackfill().length === 0, 'backfill is idempotent');
  deleteMcpServer(legacy.server_id);

  console.log(failures === 0 ? 'ALL PASS' : `---\n${failures} FAILED`);
  process.exitCode = failures === 0 ? 0 : 1;
} finally {
  db.close();
  await rm(dataDir, { recursive: true, force: true });
}
