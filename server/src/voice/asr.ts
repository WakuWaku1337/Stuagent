import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const serverRoot = resolve(fileURLToPath(new URL('.', import.meta.url)), '../..');
export const asrModelDir = join(serverRoot, 'models', 'sherpa-onnx-paraformer-zh-small');
const MODEL_FILE = join(asrModelDir, 'model.int8.onnx');
const TOKENS_FILE = join(asrModelDir, 'tokens.txt');
export const ASR_MODEL_NAME = 'sherpa-onnx-paraformer-zh-small';

interface OfflineStream {
  acceptWaveform(input: { samples: Float32Array; sampleRate: number }): void;
}

interface OfflineRecognizer {
  createStream(): OfflineStream;
  decodeAsync(stream: OfflineStream): Promise<{ text?: string }>;
}

interface SherpaModule {
  OfflineRecognizer: {
    createAsync(config: unknown): Promise<OfflineRecognizer>;
  };
}

export class VoiceError extends Error {
  code: string;
  status: number;

  constructor(code: string, message: string, status = 422) {
    super(message);
    this.name = 'VoiceError';
    this.code = code;
    this.status = status;
  }
}

let recognizerPromise: Promise<OfflineRecognizer> | null = null;

export function asrModelReady(): boolean {
  return existsSync(MODEL_FILE) && existsSync(TOKENS_FILE);
}

async function getRecognizer(): Promise<OfflineRecognizer> {
  if (!asrModelReady()) {
    throw new VoiceError(
      'ASR_MODEL_MISSING',
      '语音识别模型未安装：请在 server 目录运行 npm run asr:model',
      503,
    );
  }
  if (!recognizerPromise) {
    let sherpa: SherpaModule;
    try {
      sherpa = require('sherpa-onnx-node') as SherpaModule;
    } catch (error) {
      throw new VoiceError(
        'ASR_ENGINE_MISSING',
        `语音引擎加载失败：${error instanceof Error ? error.message : String(error)}`,
        503,
      );
    }
    recognizerPromise = sherpa.OfflineRecognizer.createAsync({
      featConfig: { sampleRate: 16000, featureDim: 80 },
      modelConfig: {
        paraformer: { model: MODEL_FILE },
        tokens: TOKENS_FILE,
        numThreads: 2,
        provider: 'cpu',
        debug: 0,
      },
    }).catch((error) => {
      recognizerPromise = null;
      throw new VoiceError(
        'ASR_LOAD_FAILED',
        `语音模型加载失败：${error instanceof Error ? error.message : String(error)}`,
        500,
      );
    });
  }
  return recognizerPromise;
}

interface WavData {
  samples: Float32Array;
  sampleRate: number;
  channels: number;
  durationMs: number;
}

export function parseWav(buffer: Buffer): WavData {
  if (
    buffer.length < 44 ||
    buffer.toString('ascii', 0, 4) !== 'RIFF' ||
    buffer.toString('ascii', 8, 12) !== 'WAVE'
  ) {
    throw new VoiceError('ASR_FORMAT', '请上传 WAV 格式的语音', 422);
  }
  let offset = 12;
  let format: { audioFormat: number; channels: number; sampleRate: number; bits: number } | null = null;
  let data: Buffer | null = null;
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString('ascii', offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (body + size > buffer.length) break;
    if (id === 'fmt ' && size >= 16) {
      format = {
        audioFormat: buffer.readUInt16LE(body),
        channels: buffer.readUInt16LE(body + 2),
        sampleRate: buffer.readUInt32LE(body + 4),
        bits: buffer.readUInt16LE(body + 14),
      };
    }
    if (id === 'data') {
      data = buffer.subarray(body, body + size);
      break;
    }
    offset = body + size + (size % 2);
  }
  if (!format || !data) throw new VoiceError('ASR_FORMAT', 'WAV 缺少 fmt/data 段', 422);
  if (format.audioFormat !== 1 || format.bits !== 16) {
    throw new VoiceError('ASR_FORMAT', '仅支持 16-bit PCM WAV 音频', 422);
  }
  if (format.channels < 1 || format.channels > 2) {
    throw new VoiceError('ASR_FORMAT', '仅支持单声道或双声道音频', 422);
  }
  if (format.sampleRate < 8000 || format.sampleRate > 48000) {
    throw new VoiceError('ASR_FORMAT', '采样率需在 8kHz~48kHz 之间', 422);
  }

  const frameCount = Math.floor(data.length / (2 * format.channels));
  const samples = new Float32Array(frameCount);
  for (let frame = 0; frame < frameCount; frame += 1) {
    let sum = 0;
    for (let channel = 0; channel < format.channels; channel += 1) {
      sum += data.readInt16LE((frame * format.channels + channel) * 2);
    }
    samples[frame] = sum / format.channels / 32768;
  }
  const durationMs = Math.round((frameCount / format.sampleRate) * 1000);
  if (durationMs < 500) throw new VoiceError('ASR_TOO_SHORT', '录音太短，请至少说 1 秒', 422);
  if (durationMs > 60_000) throw new VoiceError('ASR_TOO_LONG', '录音不能超过 60 秒', 422);
  return { samples, sampleRate: format.sampleRate, channels: format.channels, durationMs };
}

export function cleanTranscript(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .replace(/(?<=[\u4e00-\u9fff])\s+(?=[\u4e00-\u9fff])/g, '')
    .trim();
}

export async function transcribeWav(buffer: Buffer) {
  const wav = parseWav(buffer);
  const recognizer = await getRecognizer();
  const start = Date.now();
  const stream = recognizer.createStream();
  stream.acceptWaveform({ samples: wav.samples, sampleRate: wav.sampleRate });
  const result = await recognizer.decodeAsync(stream);
  const text = cleanTranscript(result.text ?? '');
  if (!text) throw new VoiceError('ASR_EMPTY', '没有识别到语音，请靠近麦克风重试', 422);
  return {
    text,
    model: ASR_MODEL_NAME,
    duration_ms: wav.durationMs,
    latency_ms: Date.now() - start,
    sample_rate: wav.sampleRate,
  };
}
