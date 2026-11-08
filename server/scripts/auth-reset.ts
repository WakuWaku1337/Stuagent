import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

const envPath = resolve(import.meta.dirname, '..', '.env');
if (existsSync(envPath)) process.loadEnvFile(envPath);

const { AuthError, findUserByUsername, resetUserPassword } = await import('../src/auth/service.ts');

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const usernameArg = arg('username') ?? process.env.AUTH_RESET_USER;
const passwordArg = arg('password') ?? process.env.AUTH_RESET_PASSWORD;
if (!usernameArg && !process.stdin.isTTY) {
  console.error('缺少用户名。非交互模式请使用 --username 或 AUTH_RESET_USER。');
  process.exit(1);
}

const rl = !usernameArg || (!passwordArg && process.stdin.isTTY) ? createInterface({ input, output }) : null;
const username = usernameArg ?? (await rl!.question('要重置的用户名：')).trim();
const password = passwordArg ?? (rl ? (await rl.question('新密码（留空自动生成）：')).trim() : '');
rl?.close();

const user = findUserByUsername(username);
if (!user) {
  console.error('账号不存在');
  process.exit(1);
}

try {
  const temp = await resetUserPassword(user.user_id, password || undefined);
  console.log(`已重置 ${user.username} 的密码：${temp}`);
  console.log('用户下次登录需要修改密码，其他会话已全部失效。');
} catch (error) {
  if (error instanceof AuthError) {
    console.error(`${error.code}: ${error.message}`);
  } else {
    console.error(error);
  }
  process.exit(1);
}
