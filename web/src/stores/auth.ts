import { defineStore } from 'pinia';
import { ref } from 'vue';
import {
  changePassword as apiChangePassword,
  fetchBootstrap,
  fetchMe,
  fetchSessions,
  login as apiLogin,
  logout as apiLogout,
  register as apiRegister,
  revokeAllSessions as apiRevokeAllSessions,
  revokeSession as apiRevokeSession,
  type AuthSession,
  type AuthUser,
} from '../api/auth';

function errorText(error: unknown): string {
  const detail = error as {
    response?: { data?: { error?: string; message?: string } };
    message?: string;
  };
  return (
    detail.response?.data?.error ??
    detail.response?.data?.message ??
    (error instanceof Error ? error.message : String(error))
  );
}

export const useAuthStore = defineStore('auth', () => {
  const user = ref<AuthUser | null>(null);
  const enabled = ref(true);
  const initialized = ref(true);
  const registrationOpen = ref(true);
  const bootstrapAllowed = ref(false);
  const ready = ref(false);
  const loading = ref(false);
  const error = ref('');
  const sessions = ref<AuthSession[]>([]);

  async function bootstrap(): Promise<void> {
    try {
      const info = await fetchBootstrap();
      enabled.value = info.authEnabled;
      initialized.value = info.initialized;
      registrationOpen.value = info.registrationOpen;
      bootstrapAllowed.value = info.bootstrapAllowed;
      if (enabled.value) {
        try {
          const me = await fetchMe();
          user.value = me.user;
        } catch {
          user.value = null;
        }
      } else {
        user.value = null;
      }
    } catch {
      // 服务未启动时仍允许进入界面，登录页会显示后端不可用
      user.value = null;
    } finally {
      ready.value = true;
    }
  }

  async function login(username: string, password: string): Promise<boolean> {
    loading.value = true;
    error.value = '';
    try {
      user.value = await apiLogin(username, password);
      return true;
    } catch (e) {
      error.value = errorText(e);
      return false;
    } finally {
      loading.value = false;
    }
  }

  async function register(input: {
    username: string;
    password: string;
    phone?: string;
    email?: string;
    displayName?: string;
  }): Promise<boolean> {
    loading.value = true;
    error.value = '';
    try {
      user.value = await apiRegister(input);
      initialized.value = true;
      return true;
    } catch (e) {
      error.value = errorText(e);
      return false;
    } finally {
      loading.value = false;
    }
  }

  async function logout(): Promise<void> {
    try {
      await apiLogout();
    } finally {
      user.value = null;
      sessions.value = [];
    }
  }

  async function refresh(): Promise<void> {
    try {
      const me = await fetchMe();
      user.value = me.user;
    } catch {
      user.value = null;
    }
  }

  async function changePassword(currentPassword: string, newPassword: string): Promise<boolean> {
    loading.value = true;
    error.value = '';
    try {
      await apiChangePassword(currentPassword, newPassword);
      if (user.value) user.value = { ...user.value, must_change_password: false };
      return true;
    } catch (e) {
      error.value = errorText(e);
      return false;
    } finally {
      loading.value = false;
    }
  }

  async function loadSessions(): Promise<void> {
    try {
      sessions.value = await fetchSessions();
    } catch {
      sessions.value = [];
    }
  }

  async function revokeSession(sessionId: string): Promise<void> {
    await apiRevokeSession(sessionId);
    await loadSessions();
  }

  async function revokeAllSessions(): Promise<void> {
    await apiRevokeAllSessions();
    user.value = null;
    sessions.value = [];
  }

  return {
    user,
    enabled,
    initialized,
    registrationOpen,
    bootstrapAllowed,
    ready,
    loading,
    error,
    sessions,
    bootstrap,
    login,
    register,
    logout,
    refresh,
    changePassword,
    loadSessions,
    revokeSession,
    revokeAllSessions,
  };
});
