import { http } from './http';
import type { AuthUser } from './auth';

export interface AdminUser extends AuthUser {
  session_count: number;
}

export interface AuditEvent {
  event_id: string;
  user_id: string | null;
  type: string;
  ip: string | null;
  result: string;
  detail: string | null;
  created_at: number;
}

export interface SystemCheck {
  id: string;
  label: string;
  status: 'pass' | 'warn' | 'fail';
  message: string;
}

export interface SystemCheckResult {
  generated_at: number;
  auth_enabled: boolean;
  registration_open: boolean;
  secure_cookie: boolean;
  users: { total: number; active: number; admins: number; sessions: number };
  backup: { file: string; created_at: number; age_hours: number } | null;
  checks: SystemCheck[];
}

export async function listUsers(): Promise<AdminUser[]> {
  const { data } = await http.get<{ users: AdminUser[] }>('/api/admin/users');
  return data.users;
}

export async function createUser(input: {
  username: string;
  password?: string;
  displayName?: string;
  phone?: string;
  email?: string;
  role?: 'admin' | 'user';
}): Promise<{ user: AdminUser; tempPassword: string | null }> {
  const { data } = await http.post<{ user: AdminUser; tempPassword: string | null }>('/api/admin/users', input);
  return data;
}

export async function updateUser(
  userId: string,
  input: {
    status?: 'active' | 'disabled';
    role?: 'admin' | 'user';
    displayName?: string | null;
    phone?: string | null;
    email?: string | null;
  },
): Promise<AdminUser> {
  const { data } = await http.put<{ user: AdminUser }>(`/api/admin/users/${encodeURIComponent(userId)}`, input);
  return data.user;
}

export async function resetUserPassword(userId: string, password?: string): Promise<string> {
  const { data } = await http.post<{ tempPassword: string }>(
    `/api/admin/users/${encodeURIComponent(userId)}/reset-password`,
    password ? { password } : {},
  );
  return data.tempPassword;
}

export async function listAudit(limit = 100): Promise<AuditEvent[]> {
  const { data } = await http.get<{ events: AuditEvent[] }>('/api/admin/audit', { params: { limit } });
  return data.events;
}

export async function fetchSystemCheck(): Promise<SystemCheckResult> {
  const { data } = await http.get<SystemCheckResult>('/api/admin/system-check');
  return data;
}
