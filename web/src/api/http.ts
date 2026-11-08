import axios from 'axios';

export const http = axios.create({ baseURL: '/', timeout: 10000 });

http.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = (error as { response?: { status?: number } }).response?.status;
    const url = String((error as { config?: { url?: string } }).config?.url ?? '');
    const publicAuthUrl =
      url.startsWith('/api/auth/login') ||
      url.startsWith('/api/auth/register') ||
      url.startsWith('/api/auth/bootstrap') ||
      url.startsWith('/api/auth/me');
    if (status === 401 && !publicAuthUrl) {
      window.dispatchEvent(new Event('edupi:unauthorized'));
    }
    return Promise.reject(error);
  },
);

export interface HealthResponse {
  status: string;
  service: string;
  time: string;
}

export async function fetchHealth(): Promise<HealthResponse> {
  const { data } = await http.get<HealthResponse>('/health');
  return data;
}