import axios from 'axios';

export const http = axios.create({ baseURL: '/', timeout: 10000 });

export interface HealthResponse {
  status: string;
  service: string;
  time: string;
}

export async function fetchHealth(): Promise<HealthResponse> {
  const { data } = await http.get<HealthResponse>('/health');
  return data;
}