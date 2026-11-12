import './lib/same-origin-fetch.ts';

const BASE = (process.env.BASE_URL ?? 'http://127.0.0.1:3000').replace(/\/+$/, '');
const USERNAME = process.env.AUTH_TEST_USER ?? 'admin';
const PASSWORD = process.env.AUTH_TEST_PASSWORD ?? 'admin12345';

let failures = 0;
let cookie = '';
let userCookie = '';

function cookieFrom(response: Response): string {
  const values = response.headers.getSetCookie?.() ?? [];
  const raw = values[0] ?? response.headers.get('set-cookie') ?? '';
  return raw.split(';')[0];
}

async function req(
  path: string,
  init: RequestInit = {},
  useCookie = cookie,
): Promise<{ status: number; body: any; headers: Headers }> {
  const headers = new Headers(init.headers);
  if (init.body) headers.set('content-type', 'application/json');
  if (useCookie) headers.set('cookie', useCookie);
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

let registeredUserId = '';
let registeredUsername = '';
let registeredPassword = '';
let tempPassword = '';

await check('bootstrap config', async () => {
  const { status, body } = await req('/api/auth/bootstrap', {}, '');
  return status === 200 && body.authEnabled === true && typeof body.initialized === 'boolean';
});

if ((await req('/api/auth/bootstrap', {}, '')).body?.initialized === false) {
  await check('bootstrap rejects forwarded request', async () => {
    const { status, body } = await req(
      '/api/auth/register',
      {
        method: 'POST',
        headers: { 'x-forwarded-for': '8.8.8.8' },
        body: JSON.stringify({ username: `boot_${Date.now().toString(36)}`, password: 'secret123' }),
      },
      '',
    );
    return status === 403 && body?.code === 'BOOTSTRAP_LOCAL_ONLY';
  });
}

await check('unauthenticated API returns 401', async () => {
  const { status } = await req('/api/model', {}, '');
  return status === 401;
});

await check('admin login', async () => {
  const response = await fetch(BASE + '/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: USERNAME, password: PASSWORD }),
  });
  cookie = cookieFrom(response);
  const body = await response.json();
  return response.status === 200 && Boolean(cookie) && body.user?.role === 'admin';
});

await check('me with session', async () => {
  const { status, body } = await req('/api/auth/me');
  return status === 200 && body.user?.username === USERNAME && body.user?.must_change_password === false;
});

await check('protected API with session', async () => {
  const { status } = await req('/api/model');
  return status === 200;
});

await check('session list has current', async () => {
  const { status, body } = await req('/api/auth/sessions');
  return status === 200 && body.sessions?.some((item: { current: boolean }) => item.current);
});

const bootstrap = await req('/api/auth/bootstrap', {}, '');
if (bootstrap.body?.registrationOpen === true) {
  registeredUsername = `student_${Date.now().toString(36)}`;
  registeredPassword = 'student12345';
  await check('register with phone/email', async () => {
    const response = await fetch(BASE + '/api/auth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        username: registeredUsername,
        password: registeredPassword,
        displayName: '测试同学',
        phone: '13800138000',
        email: 'student@example.com',
      }),
    });
    userCookie = cookieFrom(response);
    const body = await response.json();
    registeredUserId = body.user?.user_id ?? '';
    return response.status === 201 && Boolean(userCookie) && body.user?.phone === '13800138000' && body.user?.email === 'student@example.com';
  });

  await check('registered user can access own session', async () => {
    const { status, body } = await req('/api/auth/me', {}, userCookie);
    return status === 200 && body.user?.username === registeredUsername;
  });

  await check('normal user cannot access admin API', async () => {
    const { status } = await req('/api/admin/users', {}, userCookie);
    return status === 403;
  });

  await check('admin list includes new user', async () => {
    const { status, body } = await req('/api/admin/users');
    return status === 200 && body.users?.some((item: { user_id: string }) => item.user_id === registeredUserId);
  });

  await check('admin reset password', async () => {
    const { status, body } = await req(`/api/admin/users/${registeredUserId}/reset-password`, { method: 'POST', body: '{}' });
    tempPassword = body.tempPassword ?? '';
    return status === 200 && tempPassword.length >= 10;
  });

  await check('old session revoked after reset', async () => {
    const { status } = await req('/api/auth/me', {}, userCookie);
    return status === 401;
  });

  await check('login with temp password requires change', async () => {
    const response = await fetch(BASE + '/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: registeredUsername, password: tempPassword }),
    });
    userCookie = cookieFrom(response);
    const body = await response.json();
    return response.status === 200 && body.user?.must_change_password === true;
  });

  await check('change password', async () => {
    const { status } = await req(
      '/api/auth/password',
      { method: 'PUT', body: JSON.stringify({ currentPassword: tempPassword, newPassword: 'student54321' }) },
      userCookie,
    );
    return status === 200;
  });

  await check('login with new password', async () => {
    const response = await fetch(BASE + '/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: registeredUsername, password: 'student54321' }),
    });
    const body = await response.json();
    return response.status === 200 && body.user?.must_change_password === false;
  });

  await check('logout invalidates session', async () => {
    await req('/api/auth/logout', { method: 'POST' }, userCookie);
    const { status } = await req('/api/auth/me', {}, userCookie);
    return status === 401;
  });
} else {
  console.log('SKIP register tests (registration closed)');
}

await check('login rate limit', async () => {
  let last: { status: number; headers: Headers } = { status: 0, headers: new Headers() };
  for (let i = 0; i < 6; i += 1) {
    last = await req(
      '/api/auth/login',
      { method: 'POST', body: JSON.stringify({ username: 'nobody_rate_limit', password: 'wrong-password' }) },
      '',
    );
  }
  const retryAfter = Number(last.headers.get('retry-after') ?? 0);
  return last.status === 429 && retryAfter > 0 ? `Retry-After ${retryAfter}s` : false;
});

await check('csrf rejects cross-site write', async () => {
  const { status, body } = await req('/api/auth/logout', {
    method: 'POST',
    headers: { origin: 'https://evil.example' },
  });
  return status === 403 && body?.code === 'CSRF_REJECTED';
});

await check('csrf rejects null origin', async () => {
  const { status, body } = await req('/api/auth/logout', {
    method: 'POST',
    headers: { origin: 'null' },
  });
  return status === 403 && body?.code === 'CSRF_REJECTED';
});

await check('csrf rejects write without origin', async () => {
  const { status, body } = await req('/api/auth/logout', {
    method: 'POST',
    headers: { 'x-edupi-no-origin': '1' },
  });
  return status === 403 && body?.code === 'CSRF_REJECTED';
});

await check('csrf allows same-origin write', async () => {
  const { status } = await req('/api/auth/login', { method: 'POST', body: '{}' }, '');
  return status === 400;
});

await check('logout admin session', async () => {
  const { status } = await req('/api/auth/logout', { method: 'POST' });
  const after = await req('/api/auth/me');
  return status === 200 && after.status === 401;
});

console.log('---');
if (failures > 0) {
  console.log(`FAILURES: ${failures}`);
  process.exit(1);
}
console.log('ALL PASS');
