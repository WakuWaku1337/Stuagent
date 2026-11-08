const BASE = (process.env.BASE_URL ?? 'http://127.0.0.1:3000').replace(/\/+$/, '');
const ADMIN_USER = process.env.AUTH_TEST_USER ?? 'admin';
const ADMIN_PASSWORD = process.env.AUTH_TEST_PASSWORD ?? 'admin12345';
const stamp = Date.now().toString(36);
let failures = 0;

function cookieFrom(response: Response): string {
  return (response.headers.getSetCookie?.()[0] ?? response.headers.get('set-cookie') ?? '').split(';')[0];
}

async function req(path: string, init: RequestInit = {}, cookie = ''): Promise<{ status: number; body: any }> {
  const headers = new Headers(init.headers);
  if (init.body) headers.set('content-type', 'application/json');
  if (cookie) headers.set('cookie', cookie);
  const response = await fetch(BASE + path, { ...init, headers });
  const text = await response.text();
  let body: any = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: response.status, body };
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
  if (!response.ok) throw new Error(`登录失败 ${username}: ${response.status}`);
  return cookieFrom(response);
}

const adminCookie = await login(ADMIN_USER, ADMIN_PASSWORD);
const username = `adm_${stamp}`;
let userId = '';
let tempPassword = '';
let userCookie = '';

await check('admin creates account', async () => {
  const { status, body } = await req(
    '/api/admin/users',
    { method: 'POST', body: JSON.stringify({ username, displayName: 'Admin Check' }) },
    adminCookie,
  );
  userId = body.user?.user_id ?? '';
  tempPassword = body.tempPassword ?? '';
  return status === 201 && Boolean(userId) && tempPassword.length >= 10;
});

await check('new account changes temp password', async () => {
  userCookie = await login(username, tempPassword);
  const { status } = await req(
    '/api/auth/password',
    { method: 'PUT', body: JSON.stringify({ currentPassword: tempPassword, newPassword: 'admincheck12345' }) },
    userCookie,
  );
  return status === 200;
});

await check('disabled account loses session immediately', async () => {
  const disable = await req(`/api/admin/users/${userId}`, { method: 'PUT', body: JSON.stringify({ status: 'disabled' }) }, adminCookie);
  const me = await req('/api/auth/me', {}, userCookie);
  return disable.status === 200 && me.status === 401;
});

await check('disabled account cannot login', async () => {
  const response = await fetch(BASE + '/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password: 'admincheck12345' }),
  });
  return response.status === 401;
});

await check('re-enabled account can login', async () => {
  const enable = await req(`/api/admin/users/${userId}`, { method: 'PUT', body: JSON.stringify({ status: 'active' }) }, adminCookie);
  userCookie = await login(username, 'admincheck12345');
  return enable.status === 200 && Boolean(userCookie);
});

await check('last admin cannot be disabled', async () => {
  const { status, body } = await req(
    '/api/admin/users/default',
    { method: 'PUT', body: JSON.stringify({ status: 'disabled' }) },
    adminCookie,
  );
  return status === 409 && body.code === 'LAST_ADMIN';
});

await check('system check reports required checks', async () => {
  const { status, body } = await req('/api/admin/system-check', {}, adminCookie);
  const ids = (body.checks ?? []).map((item: { id: string }) => item.id);
  return (
    status === 200 &&
    ['auth', 'admin', 'registration', 'https', 'backup'].every((id) => ids.includes(id)) &&
    typeof body.users?.total === 'number'
  );
});

console.log('---');
if (failures > 0) {
  console.log(`FAILURES: ${failures}`);
  process.exit(1);
}
console.log('ALL PASS');
