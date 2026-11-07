import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { synthesizeSpeech } from '../api/voice';
import { toSpeechText } from '../utils/speech';

const VOICE_KEY = 'edupi.tts.voice';
const RATE_KEY = 'edupi.tts.rate';

function storedRate(): number {
  try {
    const value = Number(localStorage.getItem(RATE_KEY));
    return Number.isFinite(value) && value > 0 ? Math.min(1.6, Math.max(0.6, value)) : 1;
  } catch {
    return 1;
  }
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
  const speaking = ref(false);
  const speakingKey = ref<string | number | null>(null);
  const error = ref('');
  let autoSelected = !storedVoice;

  let audio: HTMLAudioElement | null = null;
  let session = 0;
  let watchdog: ReturnType<typeof setTimeout> | undefined;

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

  function clearWatchdog() {
    if (watchdog) clearTimeout(watchdog);
    watchdog = undefined;
  }

  function finish(current: number, audioUrl?: string) {
    if (current !== session) return;
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    clearWatchdog();
    speaking.value = false;
    speakingKey.value = null;
    audio = null;
  }

  function fail(current: number, message: string) {
    if (current !== session) return;
    error.value = message;
    finish(current);
  }

  function speakBrowser(text: string, current: number) {
    if (current !== session) return;
    if (!supported.value) {
      fail(current, '当前浏览器不支持语音合成');
      return;
    }
    const utterance = new SpeechSynthesisUtterance(text);
    const voice = voices.value.find((item) => item.voiceURI === voiceURI.value);
    if (voice) utterance.voice = voice;
    utterance.lang = voice?.lang || 'zh-CN';
    utterance.rate = rate.value;
    utterance.onend = () => finish(current);
    utterance.onerror = (event) => {
      const code = (event as SpeechSynthesisErrorEvent).error;
      if (code !== 'canceled' && code !== 'interrupted') {
        fail(current, `朗读失败：${code}`);
      } else {
        finish(current);
      }
    };
    try {
      speechSynthesis.cancel();
      speechSynthesis.speak(utterance);
      const expected = Math.max(6000, (text.length * 260) / rate.value) + 5000;
      watchdog = setTimeout(() => finish(current), expected);
    } catch (e) {
      fail(current, e instanceof Error ? e.message : '朗读失败');
    }
  }

  function playAudio(url: string, text: string, current: number) {
    if (current !== session) {
      URL.revokeObjectURL(url);
      return;
    }
    const element = new Audio(url);
    audio = element;
    element.onended = () => finish(current, url);
    element.onerror = () => {
      URL.revokeObjectURL(url);
      if (current === session) speakBrowser(text, current);
    };
    void element.play().catch(() => {
      URL.revokeObjectURL(url);
      if (current === session) speakBrowser(text, current);
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
    try {
      const result = await synthesizeSpeech(plain, rate.value);
      if (current !== session) {
        if (result.audioUrl) URL.revokeObjectURL(result.audioUrl);
        return false;
      }
      if (result.mode === 'server' && result.audioUrl) {
        playAudio(result.audioUrl, plain, current);
      } else {
        speakBrowser(plain, current);
      }
      return true;
    } catch {
      if (current !== session) return false;
      speakBrowser(plain, current);
      return supported.value;
    }
  }

  function stop() {
    session += 1;
    clearWatchdog();
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
    speaking,
    speakingKey,
    error,
    speak,
    preview,
    stop,
    selectVoice,
  };
}
