import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

const envPath = resolve(import.meta.dirname, '..', '.env');
if (existsSync(envPath)) process.loadEnvFile(envPath);

const { AuthError, bootstrapAdmin, countUsers } = await import('../src/auth/service.ts');

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

if (countUsers() > 0) {
  console.error('实例已有账号，不能重复创建首个管理员。');
  process.exit(1);
}

const usernameArg = arg('username') ?? process.env.AUTH_BOOTSTRAP_USER;
const passwordArg = arg('password') ?? process.env.AUTH_BOOTSTRAP_PASSWORD;
const displayName = arg('display') ?? process.env.AUTH_BOOTSTRAP_DISPLAY ?? '';
const phone = arg('phone') ?? process.env.AUTH_BOOTSTRAP_PHONE ?? '';
const email = arg('email') ?? process.env.AUTH_BOOTSTRAP_EMAIL ?? '';

if ((!usernameArg || !passwordArg) && !process.stdin.isTTY) {
  console.error('缺少账号或密码。非交互模式请使用 --username/--password 或 AUTH_BOOTSTRAP_USER/AUTH_BOOTSTRAP_PASSWORD。');
  process.exit(1);
}

const rl = !usernameArg || !passwordArg ? createInterface({ input, output }) : null;
const username = usernameArg ?? (await rl!.question('管理员用户名：')).trim();
const password = passwordArg ?? (await rl!.question('管理员密码（至少 10 位）：')).trim();
rl?.close();

try {
  const user = await bootstrapAdmin({ username, password, displayName, phone, email });
  console.log(`已创建管理员 ${user.username}（user_id=${user.user_id}）`);
  console.log('现在可以登录：npm run dev');
} catch (error) {
  if (error instanceof AuthError) {
    console.error(`${error.code}: ${error.message}`);
  } else {
    console.error(error);
  }
  process.exit(1);
}
