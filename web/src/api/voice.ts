import { http } from './http';

export interface AsrStatus {
  ready: boolean;
  model?: string;
  hint?: string | null;
}

export interface SpeechResult {
  mode: 'browser' | 'server';
  audioUrl?: string;
  reason?: string;
  volume?: number;
}

export async function asrStatus(): Promise<AsrStatus> {
  const { data } = await http.get<AsrStatus>('/api/asr', { timeout: 8000 });
  return data;
}

export async function transcribeAudio(audio: Blob): Promise<string> {
  const form = new FormData();
  form.append('audio', audio, 'voice.wav');
  const { data } = await http.post<{ text?: string }>('/api/asr', form, { timeout: 120_000 });
  const text = data?.text?.trim();
  if (!text) throw new Error('没有识别到语音，请重试');
  return text;
}

export async function synthesizeSpeech(
  text: string,
  rate: number,
  volume = 1,
): Promise<SpeechResult> {
  const res = await fetch('/api/tts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, rate, volume }),
  });
  const contentType = res.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    const data = (await res.json().catch(() => null)) as
      | { mode?: string; reason?: string; error?: string; message?: string; volume?: number }
      | null;
    if (!res.ok) throw new Error(data?.error ?? data?.message ?? `语音合成失败（${res.status}）`);
    return {
      mode: data?.mode === 'server' ? 'server' : 'browser',
      reason: data?.reason,
      volume: data?.volume,
    };
  }
  if (!res.ok) throw new Error(`语音合成失败（${res.status}）`);
  const blob = await res.blob();
  return { mode: 'server', audioUrl: URL.createObjectURL(blob) };
}
