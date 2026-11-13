import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';
import { db } from '../store.ts';
import { BOOTSTRAP_LOCAL_ONLY } from '../config.ts';

export type UserRole = 'admin' | 'user';
export type UserStatus = 'active' | 'disabled';

export interface AuthUser {
  user_id: string;
  username: string;
  display_name: string | null;
  phone: string | null;
  email: string | null;
  role: UserRole;
  status: UserStatus;
  must_change_password: boolean;
  last_login_at: number | null;
  created_at: number;
}

interface UserRow extends AuthUser {
  username_norm: string;
  password_hash: string;
  failed_count: number;
  locked_until: number | null;
  updated_at: number;
}

interface SessionRow {
  session_id: string;
  user_id: string;
  token_hash: string;
  created_at: number;
  last_seen_at: number;
  expires_at: number;
  absolute_expires_at: number;
  ip: string | null;
  user_agent: string | null;
  revoked_at: number | null;
}

export class AuthError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const USERNAME_RE = /^[A-Za-z0-9_-]{3,32}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^[0-9+\-\s()]{5,30}$/;

const SCRYPT_N = 32768;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_MAXMEM = 64 * 1024 * 1024;

function scryptAsync(password: string, salt: Buffer, keylen: number, options: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keylen, options, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt, 32, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: SCRYPT_MAXMEM,
  });
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString('base64url')}$${key.toString('base64url')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, n, r, p, saltText, hashText] = parts;
  const salt = Buffer.from(saltText, 'base64url');
  const expected = Buffer.from(hashText, 'base64url');
  const key = await scryptAsync(password, salt, expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    maxmem: SCRYPT_MAXMEM,
  });
  return key.length === expected.length && timingSafeEqual(key, expected);
}

export function authEnabled(): boolean {
  return process.env.AUTH_ENABLED !== '0';
}

export function registrationOpen(): boolean {
  return process.env.REGISTRATION_OPEN !== '0';
}

export function bootstrapAllowed(): boolean {
  return process.env.AUTH_BOOTSTRAP === '1';
}

export function bootstrapLocalOnly(): boolean {
  return BOOTSTRAP_LOCAL_ONLY;
}

function now(): number {
  return Date.now();
}

function normalizeUsername(username: string): string {
  return username.trim().toLowerCase();
}

function userFromRow(row: UserRow): AuthUser {
  return {
    user_id: row.user_id,
    username: row.username,
    display_name: row.display_name,
    phone: row.phone,
    email: row.email,
    role: row.role,
    status: row.status,
    must_change_password: Boolean(row.must_change_password),
    last_login_at: row.last_login_at,
    created_at: row.created_at,
  };
}

export function countUsers(): number {
  const row = db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number };
  return row.n;
}

export function findUserById(userId: string): AuthUser | undefined {
  const row = db.prepare('SELECT * FROM users WHERE user_id = ?').get(userId) as unknown as UserRow | undefined;
  return row ? userFromRow(row) : undefined;
}

export function findUserByUsername(username: string): UserRow | undefined {
  return db.prepare('SELECT * FROM users WHERE username_norm = ?').get(normalizeUsername(username)) as unknown as
    | UserRow
    | undefined;
}

export function validateRegistrationInput(input: {
  username?: string;
  password?: string;
  phone?: string;
  email?: string;
  displayName?: string;
}): { username: string; password: string; phone: string | null; email: string | null; displayName: string } {
  const username = input.username?.trim() ?? '';
  const password = input.password ?? '';
  const phone = input.phone?.trim() || null;
  const email = input.email?.trim().toLowerCase() || null;
  const displayName = input.displayName?.trim() || username;

  if (!USERNAME_RE.test(username)) {
    throw new AuthError(422, 'USERNAME_INVALID', '用户名需为 3–32 位字母、数字、下划线或中划线');
  }
  if (password.length < 6 || password.length > 128) {
    throw new AuthError(422, 'PASSWORD_INVALID', '密码长度需为 6–128 位');
  }
  if (password.toLowerCase() === username.toLowerCase()) {
    throw new AuthError(422, 'PASSWORD_INVALID', '密码不能与用户名相同');
  }
  if (phone && !PHONE_RE.test(phone)) {
    throw new AuthError(422, 'PHONE_INVALID', '手机号格式不正确');
  }
  if (email && !EMAIL_RE.test(email)) {
    throw new AuthError(422, 'EMAIL_INVALID', '邮箱格式不正确');
  }
  if (displayName.length > 32) {
    throw new AuthError(422, 'DISPLAY_NAME_INVALID', '显示名不能超过 32 个字符');
  }
  return { username, password, phone, email, displayName };
}

function ensureLearnerRow(user: AuthUser): void {
  const existing = db.prepare('SELECT learner_id FROM learners WHERE learner_id = ?').get(user.user_id);
  if (!existing) {
    db.prepare('INSERT INTO learners (learner_id, name, grade, subjects, created_at) VALUES (?, ?, ?, ?, ?)').run(
      user.user_id,
      user.display_name ?? user.username,
      '高中',
      '',
      now(),
    );
  }
}

export async function createUser(input: {
  username: string;
  password: string;
  phone?: string | null;
  email?: string | null;
  displayName?: string | null;
  role?: UserRole;
  mustChangePassword?: boolean;
  userId?: string;
}): Promise<AuthUser> {
  const clean = validateRegistrationInput({
    username: input.username,
    password: input.password,
    phone: input.phone ?? undefined,
    email: input.email ?? undefined,
    displayName: input.displayName ?? undefined,
  });
  if (findUserByUsername(clean.username)) {
    throw new AuthError(409, 'USERNAME_EXISTS', '用户名已存在');
  }
  const userId = input.userId ?? randomUUID();
  const timestamp = now();
  const user: AuthUser = {
    user_id: userId,
    username: clean.username,
    display_name: clean.displayName,
    phone: clean.phone,
    email: clean.email,
    role: input.role ?? 'user',
    status: 'active',
    must_change_password: input.mustChangePassword ?? false,
    last_login_at: null,
    created_at: timestamp,
  };
  db.prepare(
    `INSERT INTO users (user_id, username, username_norm, phone, email, display_name, role, status, password_hash, must_change_password, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)`,
  ).run(
    user.user_id,
    user.username,
    normalizeUsername(user.username),
    user.phone,
    user.email,
    user.display_name,
    user.role,
    await hashPassword(clean.password),
    user.must_change_password ? 1 : 0,
    timestamp,
    timestamp,
  );
  ensureLearnerRow(user);
  recordAuthEvent(user.user_id, 'user_created', 'success', { role: user.role });
  return user;
}

export async function bootstrapAdmin(input: {
  username: string;
  password: string;
  phone?: string | null;
  email?: string | null;
  displayName?: string | null;
}): Promise<AuthUser> {
  if (countUsers() > 0) {
    throw new AuthError(409, 'ALREADY_INITIALIZED', '实例已初始化，不能重复创建首个管理员');
  }
  return createUser({ ...input, role: 'admin', mustChangePassword: false, userId: 'default' });
}

function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function cookieName(secure: boolean): string {
  return secure ? '__Host-edu_session' : 'edu_session';
}

export function parseCookieToken(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;
  const cookies = cookieHeader.split(';');
  for (const item of cookies) {
    const index = item.indexOf('=');
    if (index < 0) continue;
    const name = item.slice(0, index).trim();
    if (name === '__Host-edu_session' || name === 'edu_session') {
      return decodeURIComponent(item.slice(index + 1).trim());
    }
  }
  return null;
}

export function createSession(
  userId: string,
  options: { ip?: string | null; userAgent?: string | null } = {},
): { token: string; sessionId: string; expiresAt: number } {
  const timestamp = now();
  const idleDays = Number(process.env.SESSION_TTL_DAYS ?? 7);
  const absoluteDays = Number(process.env.SESSION_ABSOLUTE_DAYS ?? 30);
  const maxPerUser = Number(process.env.SESSION_MAX_PER_USER ?? 10);
  const expiresAt = timestamp + idleDays * 86400_000;
  const absoluteExpiresAt = timestamp + absoluteDays * 86400_000;
  const token = randomBytes(32).toString('base64url');
  const sessionId = randomUUID();

  const active = db
    .prepare('SELECT session_id FROM sessions WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ? ORDER BY created_at ASC')
    .all(userId, timestamp) as unknown as { session_id: string }[];
  const overflow = active.length - maxPerUser + 1;
  if (overflow > 0) {
    for (const row of active.slice(0, overflow)) {
      db.prepare('UPDATE sessions SET revoked_at = ? WHERE session_id = ?').run(timestamp, row.session_id);
    }
  }

  db.prepare(
    `INSERT INTO sessions (session_id, user_id, token_hash, created_at, last_seen_at, expires_at, absolute_expires_at, ip, user_agent)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(sessionId, userId, tokenHash(token), timestamp, timestamp, expiresAt, absoluteExpiresAt, options.ip ?? null, options.userAgent ?? null);

  return { token, sessionId, expiresAt };
}

export function sessionUser(token: string | null): (AuthUser & { session_id: string }) | null {
  if (!token) return null;
  const timestamp = now();
  const row = db
    .prepare(
      `SELECT s.*, u.*
       FROM sessions s JOIN users u ON u.user_id = s.user_id
       WHERE s.token_hash = ? AND s.revoked_at IS NULL`,
    )
    .get(tokenHash(token)) as unknown as (SessionRow & UserRow) | undefined;
  if (!row) return null;
  if (row.status !== 'active') return null;
  if (row.expires_at <= timestamp || row.absolute_expires_at <= timestamp) return null;
  if (timestamp - row.last_seen_at > 10 * 60_000) {
    const idleDays = Number(process.env.SESSION_TTL_DAYS ?? 7);
    db.prepare('UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE session_id = ?').run(
      timestamp,
      timestamp + idleDays * 86400_000,
      row.session_id,
    );
  }
  return { ...userFromRow(row), session_id: row.session_id };
}

export function revokeSession(sessionId: string, userId: string): boolean {
  const result = db
    .prepare('UPDATE sessions SET revoked_at = ? WHERE session_id = ? AND user_id = ? AND revoked_at IS NULL')
    .run(now(), sessionId, userId);
  return Number(result.changes) > 0;
}

export function revokeAllSessions(userId: string, exceptSessionId?: string): void {
  if (exceptSessionId) {
    db.prepare('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND session_id <> ? AND revoked_at IS NULL').run(
      now(),
      userId,
      exceptSessionId,
    );
  } else {
    db.prepare('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL').run(now(), userId);
  }
}

export function listSessions(userId: string, currentToken: string | null): {
  session_id: string;
  created_at: number;
  last_seen_at: number;
  expires_at: number;
  ip: string | null;
  user_agent: string | null;
  current: boolean;
}[] {
  const currentHash = currentToken ? tokenHash(currentToken) : '';
  const rows = db
    .prepare(
      `SELECT session_id, token_hash, created_at, last_seen_at, expires_at, ip, user_agent
       FROM sessions WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ?
       ORDER BY last_seen_at DESC`,
    )
    .all(userId, now()) as unknown as (SessionRow & { token_hash: string })[];
  return rows.map((row) => ({
    session_id: row.session_id,
    created_at: row.created_at,
    last_seen_at: row.last_seen_at,
    expires_at: row.expires_at,
    ip: row.ip,
    user_agent: row.user_agent,
    current: currentHash !== '' && row.token_hash === currentHash,
  }));
}

export function recordAuthEvent(
  userId: string | null,
  type: string,
  result: string,
  detail?: Record<string, unknown>,
  options: { ip?: string | null; userAgent?: string | null } = {},
): void {
  db.prepare(
    `INSERT INTO auth_events (event_id, user_id, type, ip, user_agent, result, detail, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    randomUUID(),
    userId,
    type,
    options.ip ?? null,
    options.userAgent ?? null,
    result,
    detail ? JSON.stringify(detail) : null,
    now(),
  );
}

export function listAuthEvents(limit = 100): {
  event_id: string;
  user_id: string | null;
  type: string;
  ip: string | null;
  result: string;
  detail: string | null;
  created_at: number;
}[] {
  return db
    .prepare('SELECT event_id, user_id, type, ip, result, detail, created_at FROM auth_events ORDER BY created_at DESC LIMIT ?')
    .all(Math.min(Math.max(limit, 1), 500)) as unknown as {
    event_id: string;
    user_id: string | null;
    type: string;
    ip: string | null;
    result: string;
    detail: string | null;
    created_at: number;
  }[];
}

interface Attempt {
  count: number;
  first: number;
  lockedUntil: number;
}

const loginAttempts = new Map<string, Attempt>();
const registerAttempts = new Map<string, number[]>();

export function loginAttemptKey(ip: string, username: string): string {
  return `${ip}|${normalizeUsername(username)}`;
}

export function loginLockedFor(key: string): number {
  const attempt = loginAttempts.get(key);
  if (!attempt || attempt.lockedUntil <= now()) return 0;
  return attempt.lockedUntil - now();
}

export function noteLoginFailure(key: string): void {
  const timestamp = now();
  const windowMs = Number(process.env.LOGIN_WINDOW_MIN ?? 15) * 60_000;
  const maxFailures = Number(process.env.LOGIN_MAX_FAILURES ?? 5);
  const lockMs = Number(process.env.LOGIN_LOCK_MIN ?? 15) * 60_000;
  const current = loginAttempts.get(key);
  if (!current || timestamp - current.first > windowMs) {
    loginAttempts.set(key, { count: 1, first: timestamp, lockedUntil: 0 });
    return;
  }
  current.count += 1;
  if (current.count >= maxFailures) {
    current.lockedUntil = timestamp + lockMs;
    current.count = 0;
    current.first = timestamp;
  }
}

export function clearLoginFailures(key: string): void {
  loginAttempts.delete(key);
}

export function registrationRateLimited(ip: string): { limited: boolean; retryAfterSec: number } {
  const timestamp = now();
  const windowMs = 60 * 60_000;
  const limit = Number(process.env.REGISTER_MAX_PER_HOUR ?? 10);
  const list = (registerAttempts.get(ip) ?? []).filter((value) => timestamp - value < windowMs);
  list.push(timestamp);
  registerAttempts.set(ip, list);
  if (list.length <= limit) return { limited: false, retryAfterSec: 0 };
  const oldest = list[0] ?? timestamp;
  return { limited: true, retryAfterSec: Math.max(1, Math.ceil((oldest + windowMs - timestamp) / 1000)) };
}

export function markLastLogin(userId: string): void {
  db.prepare('UPDATE users SET last_login_at = ?, failed_count = 0, locked_until = NULL, updated_at = ? WHERE user_id = ?').run(
    now(),
    now(),
    userId,
  );
}

export function setUserPassword(userId: string, passwordHash: string, options: { mustChange?: boolean; revokeOthers?: boolean } = {}): void {
  db.prepare('UPDATE users SET password_hash = ?, must_change_password = ?, failed_count = 0, locked_until = NULL, updated_at = ? WHERE user_id = ?').run(
    passwordHash,
    options.mustChange ? 1 : 0,
    now(),
    userId,
  );
  if (options.revokeOthers) revokeAllSessions(userId);
}

export async function changePassword(userId: string, currentSessionId: string, currentPassword: string, nextPassword: string): Promise<void> {
  const row = db.prepare('SELECT password_hash FROM users WHERE user_id = ?').get(userId) as unknown as { password_hash: string } | undefined;
  if (!row || !(await verifyPassword(currentPassword, row.password_hash))) {
    throw new AuthError(422, 'CURRENT_PASSWORD_INVALID', '当前密码不正确');
  }
  if (nextPassword.length < 6 || nextPassword.length > 128) {
    throw new AuthError(422, 'PASSWORD_INVALID', '密码长度需为 6–128 位');
  }
  setUserPassword(userId, await hashPassword(nextPassword), { mustChange: false });
  revokeAllSessions(userId, currentSessionId);
  recordAuthEvent(userId, 'password_changed', 'success');
}

export function updateUser(
  userId: string,
  patch: { status?: UserStatus; role?: UserRole; displayName?: string | null; phone?: string | null; email?: string | null },
): AuthUser {
  const user = findUserById(userId);
  if (!user) throw new AuthError(404, 'USER_NOT_FOUND', '账号不存在');
  if (patch.phone && !PHONE_RE.test(patch.phone)) {
    throw new AuthError(422, 'PHONE_INVALID', '手机号格式不正确');
  }
  if (patch.email && !EMAIL_RE.test(patch.email)) {
    throw new AuthError(422, 'EMAIL_INVALID', '邮箱格式不正确');
  }
  if (patch.displayName && patch.displayName.length > 32) {
    throw new AuthError(422, 'DISPLAY_NAME_INVALID', '显示名不能超过 32 个字符');
  }
  const nextStatus = patch.status ?? user.status;
  const nextRole = patch.role ?? user.role;
  if (user.role === 'admin' && (nextStatus !== 'active' || nextRole !== 'admin')) {
    const admins = db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND status = 'active'").get() as { n: number };
    if (admins.n <= 1) throw new AuthError(409, 'LAST_ADMIN', '不能停用或降级最后一个管理员');
  }
  db.prepare(
    'UPDATE users SET status = ?, role = ?, display_name = ?, phone = ?, email = ?, updated_at = ? WHERE user_id = ?',
  ).run(
    nextStatus,
    nextRole,
    patch.displayName === undefined ? user.display_name : patch.displayName,
    patch.phone === undefined ? user.phone : patch.phone?.trim() || null,
    patch.email === undefined ? user.email : patch.email?.trim().toLowerCase() || null,
    now(),
    userId,
  );
  if (nextStatus === 'disabled') revokeAllSessions(userId);
  return findUserById(userId)!;
}

export async function resetUserPassword(userId: string, password?: string): Promise<string> {
  const user = findUserById(userId);
  if (!user) throw new AuthError(404, 'USER_NOT_FOUND', '账号不存在');
  const temp = password || randomBytes(9).toString('base64url');
  if (temp.length < 6 || temp.length > 128) {
    throw new AuthError(422, 'PASSWORD_INVALID', '密码长度需为 6–128 位');
  }
  setUserPassword(userId, await hashPassword(temp), { mustChange: true });
  revokeAllSessions(userId);
  recordAuthEvent(userId, 'password_reset', 'success');
  return temp;
}

export function listUsers(): (AuthUser & { session_count: number })[] {
  const rows = db
    .prepare(
      `SELECT u.*, (SELECT COUNT(*) FROM sessions s WHERE s.user_id = u.user_id AND s.revoked_at IS NULL AND s.expires_at > ?) AS session_count
       FROM users u ORDER BY u.created_at ASC`,
    )
    .all(now()) as unknown as (UserRow & { session_count: number })[];
  return rows.map((row) => ({ ...userFromRow(row), session_count: row.session_count }));
}
