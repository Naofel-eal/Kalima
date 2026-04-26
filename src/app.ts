import {
  DEFAULT_SETTINGS,
  clearProgress,
  loadAllProgress,
  loadSettings,
  loadStreak,
  saveProgress,
  saveSettings,
  saveStreak,
} from './store';
import {
  applyRating,
  computeStats,
  indexWords,
  pickNext,
  type IndexedWords,
} from './scheduler';
import { tickStreak } from './streak';
import { ensureVoices, hasArabicVoice, speak, ttsAvailable } from './tts';
import type { Settings, StreakState, Word, WordProgress } from './types';

interface AppState {
  idx: IndexedWords;
  progress: Map<number, WordProgress>;
  settings: Settings;
  streak: StreakState;
  current: number | null;
  ttsOk: boolean;
}

export async function bootstrap(root: HTMLElement) {
  root.innerHTML = `<div class="center-msg">Chargement…</div>`;

  let words: Word[];
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}words.lite.json`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    words = await res.json();
  } catch (err) {
    root.innerHTML = `<div class="center-msg">Erreur de chargement du dictionnaire.<br>${(err as Error).message}</div>`;
    return;
  }

  const idx = indexWords(words);
  const [progress, settings, streak] = [
    await loadAllProgress(),
    loadSettings(),
    loadStreak(),
  ];

  // Clamp settings against the dataset bounds.
  const lengths = [...idx.byLength.keys()];
  const minLen = Math.min(...lengths);
  const maxLen = Math.max(...lengths);
  settings.minLetters = clamp(settings.minLetters, minLen, maxLen);
  settings.maxLetters = clamp(settings.maxLetters, settings.minLetters, maxLen);

  await ensureVoices();
  const state: AppState = {
    idx,
    progress,
    settings,
    streak,
    current: null,
    ttsOk: ttsAvailable() && hasArabicVoice(),
  };

  render(root, state, { minLen, maxLen });
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

interface Bounds { minLen: number; maxLen: number; }

function render(root: HTMLElement, state: AppState, bounds: Bounds) {
  root.innerHTML = `
    <header class="header">
      <div class="streak" id="streak"></div>
      <button class="icon-btn" id="settings-btn" aria-label="Réglages">⚙</button>
    </header>
    <main class="stage">
      <div class="meta" id="meta"></div>
      <div class="word" id="word" lang="ar" dir="rtl"></div>
    </main>
    <div class="actions">
      <button class="btn miss" id="miss">Pas su</button>
      <button class="btn tts ${state.ttsOk ? '' : 'disabled'}" id="tts" aria-label="Écouter">🔊</button>
      <button class="btn know" id="know">Su</button>
    </div>
    <div class="scrim" id="scrim"></div>
    <aside class="panel" id="panel" aria-hidden="true"></aside>
  `;

  const wordEl = root.querySelector<HTMLElement>('#word')!;
  const metaEl = root.querySelector<HTMLElement>('#meta')!;
  const streakEl = root.querySelector<HTMLElement>('#streak')!;
  const missBtn = root.querySelector<HTMLButtonElement>('#miss')!;
  const knowBtn = root.querySelector<HTMLButtonElement>('#know')!;
  const ttsBtn = root.querySelector<HTMLButtonElement>('#tts')!;
  const settingsBtn = root.querySelector<HTMLButtonElement>('#settings-btn')!;
  const scrim = root.querySelector<HTMLElement>('#scrim')!;
  const panel = root.querySelector<HTMLElement>('#panel')!;

  let advanceTimer: number | null = null;

  const renderStreak = () => {
    const goal = state.streak.dailyGoal;
    const today = state.streak.todayCount;
    streakEl.innerHTML = `
      <span title="Série en cours">🔥 ${state.streak.streak}</span>
      <span class="progress">· ${today}/${goal}</span>
    `;
  };

  const showCurrent = () => {
    const i = state.current;
    if (i == null) {
      wordEl.textContent = '—';
      metaEl.textContent = 'Aucun mot dans la plage choisie.';
      return;
    }
    const w = state.idx.words[i]!;
    wordEl.textContent = w.word;
    const p = state.progress.get(i);
    const tag = !p ? 'nouveau' : p.bucket === 1 ? 'apprentissage' : p.bucket === 2 ? 'familier' : 'maîtrisé';
    metaEl.textContent = `${w.letterCount} lettres · ${tag}`;
  };

  const advance = () => {
    if (advanceTimer != null) {
      clearTimeout(advanceTimer);
      advanceTimer = null;
    }
    state.current = pickNext(state.idx, state.progress, state.settings, state.current);
    showCurrent();
    if (state.settings.autoTts && state.current != null && state.ttsOk) {
      speak(state.idx.words[state.current]!.word, state.settings.ttsRate);
    }
    if (state.settings.autoAdvance && state.current != null) {
      advanceTimer = window.setTimeout(() => rate(true), state.settings.autoAdvanceMs);
    }
  };

  const rate = async (knew: boolean) => {
    if (state.current == null) return;
    const i = state.current;
    const next = applyRating(state.progress.get(i), knew, Date.now());
    state.progress.set(i, next);
    saveProgress(i, next).catch(console.error);
    state.streak = tickStreak(state.streak);
    saveStreak(state.streak);
    renderStreak();
    advance();
  };

  missBtn.addEventListener('click', () => rate(false));
  knowBtn.addEventListener('click', () => rate(true));
  ttsBtn.addEventListener('click', () => {
    if (!state.ttsOk || state.current == null) return;
    speak(state.idx.words[state.current]!.word, state.settings.ttsRate);
  });

  // Keyboard shortcuts (desktop): ← miss, → know, space TTS
  window.addEventListener('keydown', e => {
    if (panel.classList.contains('open')) return;
    if (e.key === 'ArrowLeft') { e.preventDefault(); rate(false); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); rate(true); }
    else if (e.key === ' ') { e.preventDefault(); ttsBtn.click(); }
  });

  // Settings panel
  const openSettings = () => {
    renderSettingsPanel(panel, state, bounds, () => {
      // Re-pick if the eligibility range changed.
      advance();
    });
    scrim.classList.add('open');
    panel.classList.add('open');
    panel.setAttribute('aria-hidden', 'false');
  };
  const closeSettings = () => {
    scrim.classList.remove('open');
    panel.classList.remove('open');
    panel.setAttribute('aria-hidden', 'true');
  };
  settingsBtn.addEventListener('click', openSettings);
  scrim.addEventListener('click', closeSettings);
  panel.addEventListener('click', e => {
    const t = e.target as HTMLElement;
    if (t.dataset.action === 'close') closeSettings();
  });

  renderStreak();
  advance();
}

function renderSettingsPanel(
  panel: HTMLElement,
  state: AppState,
  bounds: Bounds,
  onChange: () => void,
) {
  const s = state.settings;
  const stats = computeStats(state.idx, state.progress);
  panel.innerHTML = `
    <h2>Réglages</h2>

    <div class="stats">
      <div class="stat"><span class="n">${stats.fresh}</span><span class="l">Inédits</span></div>
      <div class="stat"><span class="n">${stats.learning}</span><span class="l">Appris</span></div>
      <div class="stat"><span class="n">${stats.familiar}</span><span class="l">Familiers</span></div>
      <div class="stat"><span class="n">${stats.mastered}</span><span class="l">Maîtrisés</span></div>
    </div>

    <div class="field">
      <div class="field-row">
        <label for="minLet">Lettres min</label>
        <input type="number" id="minLet" min="${bounds.minLen}" max="${bounds.maxLen}" value="${s.minLetters}">
      </div>
      <input type="range" id="minLetR" min="${bounds.minLen}" max="${bounds.maxLen}" value="${s.minLetters}">
    </div>

    <div class="field">
      <div class="field-row">
        <label for="maxLet">Lettres max</label>
        <input type="number" id="maxLet" min="${bounds.minLen}" max="${bounds.maxLen}" value="${s.maxLetters}">
      </div>
      <input type="range" id="maxLetR" min="${bounds.minLen}" max="${bounds.maxLen}" value="${s.maxLetters}">
    </div>

    <div class="field">
      <div class="field-row">
        <label for="goal">Objectif quotidien</label>
        <input type="number" id="goal" min="5" max="500" step="5" value="${state.streak.dailyGoal}">
      </div>
      <span class="hint">Nombre de mots à voir par jour pour conserver la série.</span>
    </div>

    <div class="field">
      <div class="field-row">
        <label for="autoTts">Lecture audio auto</label>
        <input type="checkbox" id="autoTts" class="toggle" ${s.autoTts ? 'checked' : ''} ${state.ttsOk ? '' : 'disabled'}>
      </div>
      <span class="hint">${state.ttsOk ? 'Énonce le mot dès qu\'il s\'affiche.' : 'Aucune voix arabe détectée sur cet appareil.'}</span>
    </div>

    <div class="field">
      <div class="field-row">
        <label for="ttsRate">Vitesse TTS</label>
        <span class="hint" id="ttsRateLbl">${s.ttsRate.toFixed(2)}×</span>
      </div>
      <input type="range" id="ttsRate" min="0.5" max="1.3" step="0.05" value="${s.ttsRate}" ${state.ttsOk ? '' : 'disabled'}>
    </div>

    <div class="field">
      <div class="field-row">
        <label for="autoAdv">Avance auto (mode rapide)</label>
        <input type="checkbox" id="autoAdv" class="toggle" ${s.autoAdvance ? 'checked' : ''}>
      </div>
      <span class="hint">Passe au mot suivant sans cliquer.</span>
    </div>

    <div class="field">
      <div class="field-row">
        <label for="advMs">Délai avance auto</label>
        <span class="hint"><span id="advMsLbl">${(s.autoAdvanceMs / 1000).toFixed(1)}</span>s</span>
      </div>
      <input type="range" id="advMs" min="800" max="6000" step="100" value="${s.autoAdvanceMs}">
    </div>

    <button class="danger" id="reset">Réinitialiser ma progression</button>

    <div class="field" style="border:none;padding-top:1rem">
      <button class="btn" data-action="close" style="min-height:2.75rem">Fermer</button>
    </div>
  `;

  const $ = <T extends HTMLElement = HTMLElement>(sel: string) =>
    panel.querySelector(sel) as T;

  const minNum = $<HTMLInputElement>('#minLet');
  const maxNum = $<HTMLInputElement>('#maxLet');
  const minR = $<HTMLInputElement>('#minLetR');
  const maxR = $<HTMLInputElement>('#maxLetR');

  const sync = () => {
    let mi = clamp(parseInt(minNum.value, 10) || bounds.minLen, bounds.minLen, bounds.maxLen);
    let ma = clamp(parseInt(maxNum.value, 10) || bounds.maxLen, bounds.minLen, bounds.maxLen);
    if (mi > ma) ma = mi;
    minNum.value = String(mi);
    maxNum.value = String(ma);
    minR.value = String(mi);
    maxR.value = String(ma);
    state.settings.minLetters = mi;
    state.settings.maxLetters = ma;
    saveSettings(state.settings);
    onChange();
  };
  minNum.addEventListener('change', sync);
  maxNum.addEventListener('change', sync);
  minR.addEventListener('input', () => { minNum.value = minR.value; sync(); });
  maxR.addEventListener('input', () => { maxNum.value = maxR.value; sync(); });

  const goal = $<HTMLInputElement>('#goal');
  goal.addEventListener('change', () => {
    const v = clamp(parseInt(goal.value, 10) || 30, 5, 500);
    goal.value = String(v);
    state.streak.dailyGoal = v;
    saveStreak(state.streak);
  });

  const autoTts = $<HTMLInputElement>('#autoTts');
  autoTts.addEventListener('change', () => {
    state.settings.autoTts = autoTts.checked;
    saveSettings(state.settings);
  });

  const ttsRate = $<HTMLInputElement>('#ttsRate');
  const ttsRateLbl = $('#ttsRateLbl');
  ttsRate.addEventListener('input', () => {
    state.settings.ttsRate = parseFloat(ttsRate.value);
    ttsRateLbl.textContent = `${state.settings.ttsRate.toFixed(2)}×`;
    saveSettings(state.settings);
  });

  const autoAdv = $<HTMLInputElement>('#autoAdv');
  autoAdv.addEventListener('change', () => {
    state.settings.autoAdvance = autoAdv.checked;
    saveSettings(state.settings);
    onChange();
  });

  const advMs = $<HTMLInputElement>('#advMs');
  const advMsLbl = $('#advMsLbl');
  advMs.addEventListener('input', () => {
    state.settings.autoAdvanceMs = parseInt(advMs.value, 10);
    advMsLbl.textContent = (state.settings.autoAdvanceMs / 1000).toFixed(1);
    saveSettings(state.settings);
  });

  $('#reset').addEventListener('click', async () => {
    if (!confirm('Réinitialiser toute la progression ?')) return;
    await clearProgress();
    state.progress.clear();
    saveSettings({ ...DEFAULT_SETTINGS });
    onChange();
    // Re-render the panel so stats update.
    renderSettingsPanel(panel, state, bounds, onChange);
  });
}
