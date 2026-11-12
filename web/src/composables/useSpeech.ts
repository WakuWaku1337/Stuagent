import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { synthesizeSpeech } from '../api/voice';
import { toSpeechText } from '../utils/speech';

const VOICE_KEY = 'edupi.tts.voice';
const RATE_KEY = 'edupi.tts.rate';
const VOLUME_KEY = 'edupi.tts.volume';
const SENTENCE_MAX = 220;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function storedRate(): number {
  try {
    const value = Number(localStorage.getItem(RATE_KEY));
    return Number.isFinite(value) && value > 0 ? clamp(value, 0.6, 1.6) : 1;
  } catch {
    return 1;
  }
}

function storedVolume(): number {
  try {
    const value = Number(localStorage.getItem(VOLUME_KEY));
    return Number.isFinite(value) ? clamp(value, 0, 1) : 1;
  } catch {
    return 1;
  }
}

/** 逐句跟读：按句末标点切分，超长句再按窗口切开 */
function splitSentences(text: string): string[] {
  const parts = text.match(/[^。！？!?；;\n]+[。！？!?；;]?/g) ?? [text];
  const sentences: string[] = [];
  for (const part of parts) {
    const clean = part.trim();
    if (!clean) continue;
    if (clean.length <= SENTENCE_MAX) {
      sentences.push(clean);
      continue;
    }
    for (let start = 0; start < clean.length; start += SENTENCE_MAX) {
      sentences.push(clean.slice(start, start + SENTENCE_MAX));
    }
  }
  return sentences.length > 0 ? sentences : [text];
}

export function useSpeech() {
  const supported = ref(typeof window !== 'undefined' && 'speechSynthesis' in window);
  const voices = ref<SpeechSynthesisVoice[]>([]);
  let storedVoice = '';
  try {
    storedVoice = localStorage.getItem(VOICE_KEY) ?? '';
  } catch {
    storedVoice = '';
  }
  const voiceURI = ref(storedVoice);
  const rate = ref(storedRate());
  const volume = ref(storedVolume());
  const speaking = ref(false);
  const speakingKey = ref<string | number | null>(null);
  const error = ref('');
  let autoSelected = !storedVoice;

  let audio: HTMLAudioElement | null = null;
  let session = 0;

  function defaultVoice(list: SpeechSynthesisVoice[]): string {
    const chinese = list.filter((voice) => voice.lang?.toLowerCase().startsWith('zh'));
    const preferred =
      chinese.find((voice) => voice.localService) ??
      chinese[0] ??
      list.find((voice) => voice.default) ??
      list[0];
    return preferred?.voiceURI ?? '';
  }

  function refreshVoices() {
    if (!supported.value) return;
    const list = speechSynthesis.getVoices();
    if (list.length === 0) return;
    voices.value = list;
    if (!voiceURI.value || !list.some((voice) => voice.voiceURI === voiceURI.value)) {
      voiceURI.value = defaultVoice(list);
      return;
    }
    if (autoSelected) {
      const current = list.find((voice) => voice.voiceURI === voiceURI.value);
      const preferred = defaultVoice(list);
      const preferredVoice = list.find((voice) => voice.voiceURI === preferred);
      if (current && !current.localService && preferredVoice?.localService) {
        voiceURI.value = preferred;
      }
    }
  }

  function selectVoice(uri: string) {
    autoSelected = false;
    voiceURI.value = uri;
  }

  const voiceGroups = computed(() => {
    const zh: SpeechSynthesisVoice[] = [];
    const en: SpeechSynthesisVoice[] = [];
    const other: SpeechSynthesisVoice[] = [];
    for (const voice of voices.value) {
      const lang = (voice.lang ?? '').toLowerCase();
      if (lang.startsWith('zh')) zh.push(voice);
      else if (lang.startsWith('en')) en.push(voice);
      else other.push(voice);
    }
    return [
      { label: '中文', items: zh },
      { label: '英语', items: en },
      { label: '其他', items: other },
    ].filter((group) => group.items.length > 0);
  });

  function finish(current: number) {
    if (current !== session) return;
    speaking.value = false;
    speakingKey.value = null;
    audio = null;
  }

  function playBrowser(text: string, current: number): Promise<boolean> {
    return new Promise((resolve) => {
      if (current !== session || !supported.value) {
        resolve(false);
        return;
      }
      const utterance = new SpeechSynthesisUtterance(text);
      const voice = voices.value.find((item) => item.voiceURI === voiceURI.value);
      if (voice) utterance.voice = voice;
      utterance.lang = voice?.lang || 'zh-CN';
      utterance.rate = rate.value;
      utterance.volume = volume.value;

      let settled = false;
      const settle = (ok: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(ok);
      };
      const expected = Math.max(6000, (text.length * 260) / rate.value) + 5000;
      const timer = setTimeout(() => {
        if (current === session) {
          try {
            speechSynthesis.cancel();
          } catch {
            // ignore
          }
        }
        settle(false);
      }, expected);

      utterance.onend = () => settle(true);
      utterance.onerror = (event) => {
        const code = (event as SpeechSynthesisErrorEvent).error;
        if (code !== 'canceled' && code !== 'interrupted' && current === session) {
          error.value = `朗读失败：${code}`;
        }
        settle(false);
      };
      try {
        speechSynthesis.speak(utterance);
      } catch (e) {
        if (current === session) error.value = e instanceof Error ? e.message : '朗读失败';
        settle(false);
      }
    });
  }

  function playAudio(url: string, current: number): Promise<boolean> {
    return new Promise((resolve) => {
      if (current !== session) {
        URL.revokeObjectURL(url);
        resolve(false);
        return;
      }
      const element = new Audio(url);
      audio = element;
      element.volume = volume.value;
      let settled = false;
      const settle = (ok: boolean) => {
        if (settled) return;
        settled = true;
        URL.revokeObjectURL(url);
        if (audio === element) audio = null;
        resolve(ok);
      };
      element.onended = () => settle(true);
      element.onerror = () => settle(false);
      void element.play().catch(() => settle(false));
    });
  }

  async function speak(text: string, key: string | number): Promise<boolean> {
    const plain = toSpeechText(text);
    if (!plain) return false;
    stop();
    const current = ++session;
    error.value = '';
    speaking.value = true;
    speakingKey.value = key;

    void (async () => {
      for (const sentence of splitSentences(plain)) {
        if (current !== session) return;
        let played = false;
        try {
          const result = await synthesizeSpeech(sentence, rate.value, volume.value);
          if (current !== session) {
            if (result.audioUrl) URL.revokeObjectURL(result.audioUrl);
            return;
          }
          if (result.mode === 'server' && result.audioUrl) {
            played = await playAudio(result.audioUrl, current);
          }
        } catch {
          // 服务端 TTS 不可用时逐句回退浏览器
        }
        if (current !== session) return;
        if (!played) played = await playBrowser(sentence, current);
        if (!played && !error.value) {
          error.value = supported.value ? '朗读失败' : '当前浏览器不支持语音合成';
        }
        if (error.value) break;
      }
      if (current === session) finish(current);
    })();

    return true;
  }

  function stop() {
    session += 1;
    if (supported.value) {
      try {
        speechSynthesis.cancel();
      } catch {
        // ignore
      }
    }
    if (audio) {
      audio.pause();
      audio = null;
    }
    speaking.value = false;
    speakingKey.value = null;
  }

  async function preview(): Promise<boolean> {
    return speak('同学们好，我是智学主讲。这是一段语音播报示例。', 'preview');
  }

  watch(voiceURI, (value) => {
    if (autoSelected) return;
    try {
      localStorage.setItem(VOICE_KEY, value);
    } catch {
      // ignore
    }
  });
  watch(rate, (value) => {
    try {
      localStorage.setItem(RATE_KEY, String(value));
    } catch {
      // ignore
    }
  });
  watch(volume, (value) => {
    try {
      localStorage.setItem(VOLUME_KEY, String(value));
    } catch {
      // ignore
    }
  });

  if (supported.value) {
    refreshVoices();
    speechSynthesis.addEventListener('voiceschanged', refreshVoices);
  }

  onBeforeUnmount(() => {
    if (supported.value) {
      speechSynthesis.removeEventListener('voiceschanged', refreshVoices);
    }
    stop();
  });

  return {
    supported,
    voices,
    voiceGroups,
    voiceURI,
    rate,
    volume,
    speaking,
    speakingKey,
    error,
    speak,
    preview,
    stop,
    selectVoice,
  };
}
