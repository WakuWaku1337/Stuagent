import { http } from './http';

export interface AuthUser {
  user_id: string;
  username: string;
  display_name: string | null;
  phone: string | null;
  email: string | null;
  role: 'admin' | 'user';
  status: 'active' | 'disabled';
  must_change_password: boolean;
  last_login_at: number | null;
  created_at: number;
}

export interface AuthBootstrap {
  authEnabled: boolean;
  initialized: boolean;
  registrationOpen: boolean;
  bootstrapAllowed: boolean;
}

export interface AuthSession {
  session_id: string;
  created_at: number;
  last_seen_at: number;
  expires_at: number;
  ip: string | null;
  user_agent: string | null;
  current: boolean;
}

export async function fetchBootstrap(): Promise<AuthBootstrap> {
  const { data } = await http.get<AuthBootstrap>('/api/auth/bootstrap');
  return data;
}

export async function fetchMe(): Promise<{ authEnabled: boolean; user: AuthUser | null }> {
  const { data } = await http.get<{ authEnabled: boolean; user: AuthUser | null }>('/api/auth/me');
  return data;
}

export async function login(username: string, password: string): Promise<AuthUser> {
  const { data } = await http.post<{ user: AuthUser }>('/api/auth/login', { username, password });
  return data.user;
}

export async function register(input: {
  username: string;
  password: string;
  phone?: string;
  email?: string;
  displayName?: string;
}): Promise<AuthUser> {
  const { data } = await http.post<{ user: AuthUser }>('/api/auth/register', input);
  return data.user;
}

export async function logout(): Promise<void> {
  await http.post('/api/auth/logout');
}

export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  await http.put('/api/auth/password', { currentPassword, newPassword });
}

export async function fetchSessions(): Promise<AuthSession[]> {
  const { data } = await http.get<{ sessions: AuthSession[] }>('/api/auth/sessions');
  return data.sessions;
}

export async function revokeSession(sessionId: string): Promise<void> {
  await http.delete(`/api/auth/sessions/${encodeURIComponent(sessionId)}`);
}

export async function revokeAllSessions(): Promise<void> {
  await http.post('/api/auth/sessions/revoke-all');
}
