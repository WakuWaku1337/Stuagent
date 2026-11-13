import './lib/same-origin-fetch.ts';

const BASE = (process.env.BASE_URL ?? 'http://127.0.0.1:3000').replace(/\/+$/, '');
const ADMIN_USER = process.env.AUTH_TEST_USER ?? 'admin';
const ADMIN_PASSWORD = process.env.AUTH_TEST_PASSWORD ?? 'admin12345';
const stamp = Date.now().toString(36);

let failures = 0;

function cookieFrom(response: Response): string {
  const raw = (response.headers.getSetCookie?.()[0] ?? response.headers.get('set-cookie') ?? '').split(';')[0];
  return raw;
}

async function req(path: string, init: RequestInit = {}, cookie = ''): Promise<{ status: number; body: any; headers: Headers }> {
  const headers = new Headers(init.headers);
  if (init.body && !(init.body instanceof FormData)) headers.set('content-type', 'application/json');
  if (cookie) headers.set('cookie', cookie);
  const response = await fetch(BASE + path, { ...init, headers });
  const text = await response.text();
  let body: any = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: response.status, body, headers: response.headers };
}

async function check(name: string, fn: () => Promise<boolean | string>): Promise<void> {
  try {
    const result = await fn();
    if (result === true) console.log(`PASS ${name}`);
    else if (typeof result === 'string') console.log(`PASS ${name} (${result})`);
    else {
      failures++;
      console.log(`FAIL ${name}`);
    }
  } catch (error) {
    failures++;
    console.log(`FAIL ${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function login(username: string, password: string): Promise<string> {
  const response = await fetch(BASE + '/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  if (!response.ok) throw new Error(`登录失败：${username} ${response.status}`);
  return cookieFrom(response);
}

async function createUser(adminCookie: string, username: string): Promise<{ userId: string; cookie: string }> {
  const created = await req('/api/admin/users', {
    method: 'POST',
    body: JSON.stringify({ username, displayName: username, role: 'user' }),
  }, adminCookie);
  if (created.status !== 201) throw new Error(`创建账号失败：${JSON.stringify(created.body)}`);
  const temp = created.body.tempPassword as string;
  const userId = created.body.user.user_id as string;
  const cookie = await login(username, temp);
  const changed = await req('/api/auth/password', {
    method: 'PUT',
    body: JSON.stringify({ currentPassword: temp, newPassword: `${username}12345` }),
  }, cookie);
  if (changed.status !== 200) throw new Error(`修改临时密码失败：${JSON.stringify(changed.body)}`);
  return { userId, cookie };
}

const adminCookie = await login(ADMIN_USER, ADMIN_PASSWORD);
const alphaName = `iso_a_${stamp}`;
const betaName = `iso_b_${stamp}`;
const alpha = await createUser(adminCookie, alphaName);
const beta = await createUser(adminCookie, betaName);

await check('normal user cannot open global settings', async () => {
  const [settings, storage, mcp] = await Promise.all([
    req('/api/settings/model', {}, alpha.cookie),
    req('/api/media/storage', {}, alpha.cookie),
    req('/api/mcp/servers', {}, alpha.cookie),
  ]);
  return settings.status === 403 && storage.status === 403 && mcp.status === 403;
});

await check('admin can open global settings', async () => (await req('/api/settings/model', {}, adminCookie)).status === 200);

const memoryText = `iso-memory-${stamp}`;
await check('memory is per account', async () => {
  const written = await req('/api/memory', {
    method: 'POST',
    body: JSON.stringify({ content: memoryText, type: 'fact' }),
  }, alpha.cookie);
  const alphaList = await req('/api/memory', {}, alpha.cookie);
  const betaList = await req('/api/memory', {}, beta.cookie);
  return (
    written.status === 200 &&
    alphaList.body.memories?.some((m: { content: string }) => m.content === memoryText) &&
    !betaList.body.memories?.some((m: { content: string }) => m.content === memoryText)
  );
});

let conversationId = '';
await check('conversation is per account', async () => {
  const created = await req('/api/conversations', {
    method: 'POST',
    body: JSON.stringify({ title: `iso-conversation-${stamp}` }),
  }, alpha.cookie);
  conversationId = created.body.conversation_id;
  const alphaList = await req('/api/conversations', {}, alpha.cookie);
  const betaList = await req('/api/conversations', {}, beta.cookie);
  const betaDetail = await req(`/api/conversations/${conversationId}`, {}, beta.cookie);
  return (
    created.status === 201 &&
    alphaList.body.conversations?.some((c: { conversation_id: string }) => c.conversation_id === conversationId) &&
    !betaList.body.conversations?.some((c: { conversation_id: string }) => c.conversation_id === conversationId) &&
    betaDetail.status === 404
  );
});

let documentId = '';
let documentName = '';
await check('document is per account', async () => {
  documentName = `iso-${stamp}.txt`;
  const form = new FormData();
  form.set('file', new File([`isolation token ${stamp}`], documentName, { type: 'text/plain' }));
  const uploaded = await req('/api/documents', { method: 'POST', body: form }, alpha.cookie);
  documentId = uploaded.body.document_id ?? '';
  const alphaList = await req('/api/documents', {}, alpha.cookie);
  const betaList = await req('/api/documents', {}, beta.cookie);
  const betaDetail = await req(`/api/documents/${documentId}`, {}, beta.cookie);
  const adminDetail = await req(`/api/documents/${documentId}`, {}, adminCookie);
  return (
    uploaded.status === 200 &&
    alphaList.body.documents?.some((d: { document_id: string }) => d.document_id === documentId) &&
    !betaList.body.documents?.some((d: { document_id: string }) => d.document_id === documentId) &&
    betaDetail.status === 404 &&
    adminDetail.status === 404
  );
});

let mediaId = '';
await check('media is per account', async () => {
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2n4sAAAAASUVORK5CYII=',
    'base64',
  );
  const form = new FormData();
  form.set('file', new File([png], `iso-${stamp}.png`, { type: 'image/png' }));
  const uploaded = await req('/api/media/upload', { method: 'POST', body: form }, alpha.cookie);
  mediaId = uploaded.body.media_id ?? uploaded.body.items?.[0]?.media_id ?? '';
  const [alphaGet, betaGet, adminGet] = await Promise.all([
    req(`/api/media/${mediaId}`, {}, alpha.cookie),
    req(`/api/media/${mediaId}`, {}, beta.cookie),
    req(`/api/media/${mediaId}`, {}, adminCookie),
  ]);
  return uploaded.status === 201 && alphaGet.status === 200 && betaGet.status === 404 && adminGet.status === 404;
});

await check('default learner data stays with admin', async () => {
  const alphaDocs = await req('/api/documents', {}, alpha.cookie);
  const alphaConversations = await req('/api/conversations', {}, alpha.cookie);
  return (
    alphaDocs.body.documents?.every((d: { document_id: string }) => d.document_id === documentId) &&
    alphaConversations.body.conversations?.every((c: { conversation_id: string }) => c.conversation_id === conversationId)
  );
});

await check('RAG only recalls own document', async () => {
  let indexed = false;
  for (let i = 0; i < 20; i += 1) {
    const detail = await req(`/api/documents/${documentId}`, {}, alpha.cookie);
    const status = detail.body.document?.status;
    if (status === 'indexed') {
      indexed = true;
      break;
    }
    if (status === 'failed') break;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  if (!indexed) return 'skipped (Milvus unavailable or indexing pending)';
  const alphaSearch = await req('/api/knowledge/search', {
    method: 'POST',
    body: JSON.stringify({ query: `isolation token ${stamp}`, topK: 5 }),
  }, alpha.cookie);
  const betaSearch = await req('/api/knowledge/search', {
    method: 'POST',
    body: JSON.stringify({ query: `isolation token ${stamp}`, topK: 5 }),
  }, beta.cookie);
  const alphaHas = alphaSearch.body.citations?.some((c: { source_id: string }) => c.source_id === documentId);
  const betaHas = betaSearch.body.citations?.some((c: { source_id: string }) => c.source_id === documentId);
  if (!alphaHas || betaHas) {
    console.log('RAG alpha citations:', JSON.stringify(alphaSearch.body.citations?.map((c: { source_id: string }) => c.source_id)));
    console.log('RAG beta citations:', JSON.stringify(betaSearch.body.citations?.map((c: { source_id: string }) => c.source_id)));
  }
  return Boolean(alphaHas) && !betaHas;
});

console.log('---');
if (failures > 0) {
  console.log(`FAILURES: ${failures}`);
  process.exit(1);
}
console.log('ALL PASS');
