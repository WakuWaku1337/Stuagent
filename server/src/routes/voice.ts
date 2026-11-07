import { Hono, type Context } from 'hono';
import {
  ASR_MODEL_NAME,
  VoiceError,
  asrModelReady,
  transcribeWav,
} from '../voice/asr.ts';

const voice = new Hono();

function voiceErrorResponse(c: Context, error: unknown) {
  if (error instanceof VoiceError) {
    return c.json({ code: error.code, error: error.message }, error.status as 400);
  }
  return c.json({ error: error instanceof Error ? error.message : String(error) }, 500);
}

voice.get('/asr', (c) =>
  c.json({
    ready: asrModelReady(),
    model: ASR_MODEL_NAME,
    hint: asrModelReady() ? null : '在 server 目录运行 npm run asr:model 下载语音模型',
  }),
);

voice.post('/asr', async (c) => {
  let body: Record<string, unknown>;
  try {
    body = await c.req.parseBody({ all: true });
  } catch {
    return c.json({ code: 'PARSE_FAILED', error: '无法解析上传表单' }, 422);
  }
  const raw = body.audio;
  const file = raw instanceof File ? raw : Array.isArray(raw) ? raw.find((item) => item instanceof File) : undefined;
  if (!(file instanceof File)) return c.json({ code: 'AUDIO_EMPTY', error: '缺少 audio 字段' }, 400);
  if (file.size === 0) return c.json({ code: 'AUDIO_EMPTY', error: '音频为空' }, 400);
  if (file.size > 10 * 1024 * 1024) {
    return c.json({ code: 'AUDIO_TOO_LARGE', error: '音频不能超过 10MB' }, 413);
  }
  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    return c.json(await transcribeWav(buffer));
  } catch (error) {
    return voiceErrorResponse(c, error);
  }
});

function ttsMode(): 'server' | 'browser' {
  return process.env.TTS_BASE_URL?.trim() && process.env.TTS_MODEL?.trim() ? 'server' : 'browser';
}

voice.get('/tts', (c) =>
  c.json({
    mode: ttsMode(),
    note:
      ttsMode() === 'server'
        ? '使用服务端 TTS（OpenAI 兼容 /audio/speech）'
        : '使用浏览器 speechSynthesis（系统语音，音色与语速可调）',
  }),
);

voice.post('/tts', async (c) => {
  const body = await c.req.json<{ text?: string; rate?: number }>().catch(() => null);
  const text = body?.text?.trim();
  if (!text) return c.json({ error: 'text 不能为空' }, 400);
  if (text.length > 5000) return c.json({ error: '朗读文本不能超过 5000 字' }, 400);

  if (ttsMode() === 'browser') {
    return c.json({
      mode: 'browser',
      reason: '未配置服务端 TTS，使用浏览器语音合成',
    });
  }

  const base = process.env.TTS_BASE_URL!.trim().replace(/\/+$/, '');
  const model = process.env.TTS_MODEL!.trim();
  const apiKey = process.env.TTS_API_KEY || process.env.LLM_API_KEY || '';
  const voiceName = process.env.TTS_VOICE?.trim() || 'alloy';
  const rate = Math.min(2, Math.max(0.5, Number(body?.rate) || 1));
  try {
    const response = await fetch(`${base}/audio/speech`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({ model, input: text, voice: voiceName, speed: rate }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!response.ok) {
      const detail = (await response.text().catch(() => '')).slice(0, 200);
      return c.json(
        { mode: 'browser', error: `服务端 TTS 失败（${response.status}）${detail ? `：${detail}` : ''}` },
        502,
      );
    }
    const audio = Buffer.from(await response.arrayBuffer());
    if (audio.length === 0) return c.json({ mode: 'browser', error: '服务端 TTS 返回空音频' }, 502);
    return c.body(audio, 200, {
      'Content-Type': response.headers.get('content-type') || 'audio/mpeg',
      'Cache-Control': 'no-store',
      'X-TTS-Mode': 'server',
    });
  } catch (error) {
    return c.json(
      {
        mode: 'browser',
        error: `服务端 TTS 请求失败：${error instanceof Error ? error.message : String(error)}`,
      },
      502,
    );
  }
});

export default voice;
