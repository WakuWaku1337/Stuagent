export type VisualizationType =
  | 'geometry3d'
  | 'function2d'
  | 'function3d'
  | 'conic'
  | 'molecule'
  | 'terrain'
  | 'biology'
  | 'physics'
  | 'diagram'
  | 'legacy-html';

export interface Visualization {
  visualization_id: string;
  type: VisualizationType;
  title: string;
  spec: Record<string, unknown>;
  source: string | null;
  created_at: number;
  kind?: 'preset' | 'generated' | 'legacy';
  html_url?: string;
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.message ?? data?.error ?? `请求失败（${res.status}）`);
  return data as T;
}

export function fetchVisualizations(type?: VisualizationType): Promise<{ visualizations: Visualization[] }> {
  return request(`/api/visualize${type ? `?type=${type}` : ''}`);
}

export function fetchVisualization(id: string): Promise<{ visualization: Visualization }> {
  return request(`/api/visualize/${id}`);
}

export function createVisualization(input: {
  type: VisualizationType;
  title: string;
  spec: Record<string, unknown>;
}): Promise<{ visualization: Visualization }> {
  return request('/api/visualize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
}

export function deleteVisualization(id: string): Promise<{ deleted: string }> {
  return request(`/api/visualize/${id}`, { method: 'DELETE' });
}

export function generateVisualization(input: {
  question: string;
  subject?: string;
}): Promise<{ visualization: Visualization | null; matched: string }> {
  return request('/api/visualize/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
}
