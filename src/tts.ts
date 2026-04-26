// Web Speech API wrapper. Voice availability is platform-dependent:
//   - iOS / macOS: usually have at least one ar-* voice ("Maged", "Tarik")
//   - Android: depends on installed TTS engines
//   - Windows: needs an Arabic language pack
//   - Desktop Linux: often nothing.
//
// We pick the best Arabic voice we find on first call and reuse it.

let cachedVoice: SpeechSynthesisVoice | null | undefined;

function pickArabicVoice(): SpeechSynthesisVoice | null {
  const voices = speechSynthesis.getVoices();
  if (voices.length === 0) return null;
  // Prefer ar-SA, then any ar-*, then anything mentioning Arabic.
  const preferred = voices.find(v => v.lang === 'ar-SA');
  if (preferred) return preferred;
  const anyAr = voices.find(v => v.lang.toLowerCase().startsWith('ar'));
  if (anyAr) return anyAr;
  const named = voices.find(v => /arab/i.test(v.name));
  return named ?? null;
}

export function ttsAvailable(): boolean {
  return typeof speechSynthesis !== 'undefined';
}

// Voices may load asynchronously (notably on Chromium). Resolve when they're ready.
export function ensureVoices(timeoutMs = 1500): Promise<void> {
  if (!ttsAvailable()) return Promise.resolve();
  if (speechSynthesis.getVoices().length > 0) return Promise.resolve();
  return new Promise(resolve => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      speechSynthesis.removeEventListener('voiceschanged', finish);
      resolve();
    };
    speechSynthesis.addEventListener('voiceschanged', finish);
    setTimeout(finish, timeoutMs);
  });
}

export function hasArabicVoice(): boolean {
  if (cachedVoice === undefined) cachedVoice = pickArabicVoice();
  return cachedVoice !== null;
}

export function speak(text: string, rate = 0.85): void {
  if (!ttsAvailable()) return;
  if (cachedVoice === undefined) cachedVoice = pickArabicVoice();
  speechSynthesis.cancel();
  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = 'ar-SA';
  utter.rate = rate;
  if (cachedVoice) utter.voice = cachedVoice;
  speechSynthesis.speak(utter);
}
