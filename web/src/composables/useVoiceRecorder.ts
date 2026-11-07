import { onBeforeUnmount, ref } from 'vue';
import { transcribeAudio } from '../api/voice';
import { toWav16k } from '../utils/audio';

interface RecorderOptions {
  onText: (text: string) => void;
  onError: (message: string) => void;
}

const MAX_SECONDS = 60;
const MIN_SECONDS = 0.8;
const BAR_COUNT = 28;

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

function micError(error: unknown): string {
  const name = (error as { name?: string } | null)?.name;
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return '未获得麦克风权限，请在浏览器地址栏允许麦克风后重试';
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
    return '没有检测到麦克风，请检查设备连接';
  }
  if (name === 'NotReadableError' || name === 'TrackStartError') {
    return '麦克风被其他程序占用，请关闭后重试';
  }
  return errorText(error) || '无法启动录音';
}

export function useVoiceRecorder(options: RecorderOptions) {
  const supported = ref(
    typeof navigator !== 'undefined' &&
      Boolean(navigator.mediaDevices?.getUserMedia) &&
      typeof MediaRecorder !== 'undefined' &&
      typeof AudioContext !== 'undefined' &&
      typeof OfflineAudioContext !== 'undefined',
  );
  const recording = ref(false);
  const recognizing = ref(false);
  const seconds = ref(0);
  const levels = ref<number[]>(Array.from({ length: BAR_COUNT }, () => 0.06));

  let stream: MediaStream | null = null;
  let recorder: MediaRecorder | null = null;
  let audioContext: AudioContext | null = null;
  let analyser: AnalyserNode | null = null;
  let sourceNode: MediaStreamAudioSourceNode | null = null;
  let raf = 0;
  let timer: ReturnType<typeof setInterval> | undefined;
  let chunks: Blob[] = [];
  let startedAt = 0;
  let cancelled = false;

  function stopTimers() {
    if (timer) clearInterval(timer);
    timer = undefined;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  }

  function resetLevels() {
    levels.value = Array.from({ length: BAR_COUNT }, () => 0.06);
  }

  function cleanupStream() {
    stream?.getTracks().forEach((track) => track.stop());
    stream = null;
    sourceNode?.disconnect();
    sourceNode = null;
    analyser?.disconnect();
    analyser = null;
    recorder = null;
    if (audioContext) {
      void audioContext.close();
      audioContext = null;
    }
  }

  function drawWaveform() {
    if (!analyser) return;
    const data = new Uint8Array(analyser.fftSize);
    analyser.getByteTimeDomainData(data);
    const segment = Math.max(1, Math.floor(data.length / BAR_COUNT));
    const next = new Array<number>(BAR_COUNT);
    for (let bar = 0; bar < BAR_COUNT; bar += 1) {
      let peak = 0;
      for (let i = 0; i < segment; i += 1) {
        const value = Math.abs(data[bar * segment + i] - 128);
        if (value > peak) peak = value;
      }
      next[bar] = Math.max(0.12, Math.min(1, peak / 22));
    }
    levels.value = levels.value.map((level, index) => level * 0.4 + next[index] * 0.6);
    raf = requestAnimationFrame(drawWaveform);
  }

  function stopRecorder(): Promise<void> {
    return new Promise((resolve) => {
      const current = recorder;
      if (!current || current.state === 'inactive') {
        resolve();
        return;
      }
      current.onstop = () => resolve();
      try {
        current.stop();
      } catch {
        resolve();
      }
    });
  }

  async function start() {
    if (recording.value || recognizing.value) return;
    if (!supported.value) {
      options.onError('当前浏览器不支持录音，请使用 Edge 或 Chrome');
      return;
    }
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch (error) {
      options.onError(micError(error));
      return;
    }
    try {
      audioContext = new AudioContext();
      await audioContext.resume();
      sourceNode = audioContext.createMediaStreamSource(stream);
      analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      sourceNode.connect(analyser);
      const mimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'].find((type) =>
        MediaRecorder.isTypeSupported(type),
      );
      recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      chunks = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data);
      };
      recorder.start(250);
      startedAt = Date.now();
      cancelled = false;
      seconds.value = 0;
      recording.value = true;
      resetLevels();
      drawWaveform();
      timer = setInterval(() => {
        seconds.value = (Date.now() - startedAt) / 1000;
        if (seconds.value >= MAX_SECONDS) void stop();
      }, 200);
    } catch (error) {
      cleanupStream();
      options.onError(`录音初始化失败：${errorText(error)}`);
    }
  }

  async function stop() {
    if (!recording.value || !recorder) return;
    const activeRecorder = recorder;
    const duration = (Date.now() - startedAt) / 1000;
    recording.value = false;
    stopTimers();
    resetLevels();
    await stopRecorder();
    const blob = new Blob(chunks, { type: activeRecorder.mimeType || 'audio/webm' });
    chunks = [];
    cleanupStream();
    if (cancelled) {
      cancelled = false;
      return;
    }
    if (duration < MIN_SECONDS) {
      options.onError('录音太短，请至少说 1 秒');
      return;
    }
    recognizing.value = true;
    try {
      const wav = await toWav16k(blob);
      const text = await transcribeAudio(wav);
      options.onText(text);
    } catch (error) {
      options.onError(errorText(error));
    } finally {
      recognizing.value = false;
    }
  }

  async function cancel() {
    if (!recording.value) return;
    cancelled = true;
    recording.value = false;
    stopTimers();
    resetLevels();
    await stopRecorder();
    chunks = [];
    cleanupStream();
    cancelled = false;
  }

  onBeforeUnmount(() => {
    stopTimers();
    if (recording.value) {
      cancelled = true;
      recording.value = false;
      void stopRecorder().finally(() => cleanupStream());
    } else {
      cleanupStream();
    }
  });

  return { supported, recording, recognizing, seconds, levels, start, stop, cancel };
}
