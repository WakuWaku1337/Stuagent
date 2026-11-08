import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

const envPath = resolve(import.meta.dirname, '..', '.env');
if (existsSync(envPath)) process.loadEnvFile(envPath);

const { AuthError, countUsers, createUser } = await import('../src/auth/service.ts');

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

if (countUsers() === 0) {
  console.error('实例还没有管理员，请先运行 npm run auth:bootstrap');
  process.exit(1);
}

const usernameArg = arg('username') ?? process.env.USER_CREATE_NAME;
if (!usernameArg && !process.stdin.isTTY) {
  console.error('缺少用户名。非交互模式请使用 --username 或 USER_CREATE_NAME。');
  process.exit(1);
}

const rl = !usernameArg ? createInterface({ input, output }) : null;
const username = usernameArg ?? (await rl!.question('用户名：')).trim();
rl?.close();

const password = arg('password') ?? process.env.USER_CREATE_PASSWORD;
const phone = arg('phone') ?? process.env.USER_CREATE_PHONE ?? '';
const email = arg('email') ?? process.env.USER_CREATE_EMAIL ?? '';
const displayName = arg('display') ?? process.env.USER_CREATE_DISPLAY ?? username;
const role = arg('role') === 'admin' ? 'admin' : 'user';
const tempPassword = password || `edu-${Math.random().toString(36).slice(2, 10)}`;

try {
  const user = await createUser({
    username,
    password: tempPassword,
    phone,
    email,
    displayName,
    role,
    mustChangePassword: true,
  });
  console.log(`已创建 ${user.role} ${user.username}（user_id=${user.user_id}）`);
  if (!password) console.log(`临时密码：${tempPassword}`);
  console.log('用户首次登录需要修改密码。');
} catch (error) {
  if (error instanceof AuthError) {
    console.error(`${error.code}: ${error.message}`);
  } else {
    console.error(error);
  }
  process.exit(1);
}
