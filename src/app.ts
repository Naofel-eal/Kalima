import {
  DEFAULT_SETTINGS,
  clearDailyStats,
  clearProgress,
  clearRating,
  loadAllProgress,
  loadDailyStats,
  loadRating,
  loadSettings,
  loadStreak,
  saveDailyStats,
  saveProgress,
  saveRating,
  saveSettings,
  saveStreak,
} from './store';
import {
  applyRating,
  indexWords,
  pickNext,
  type IndexedWords,
} from './scheduler';
import {
  aggregateAll,
  getDay,
  recordRead,
  todayKey,
  trainingDays,
} from './stats';
import {
  applyDecay,
  applyRead,
  defaultRating,
  TIERS,
  tierFor,
  tierIndexFor,
  tierProgress,
} from './rating';
import { tickStreak } from './streak';
import { ensureVoices, hasArabicVoice, speak, ttsAvailable } from './tts';
import type { DailyStats, RatingState, Settings, StreakState, Word, WordProgress } from './types';

interface AppState {
  idx: IndexedWords;
  progress: Map<number, WordProgress>;
  daily: DailyStats;
  rating: RatingState;
  settings: Settings;
  streak: StreakState;
  current: number | null;
  shownAt: number;        // ms epoch when the current word was displayed
  ttsOk: boolean;
  // Pending decay info from app start, surfaced as a banner once.
  pendingDecay: { lost: number; daysOff: number } | null;
}

export async function bootstrap(root: HTMLElement) {
  root.innerHTML = `<div class="center-msg">Loading…</div>`;

  let words: Word[];
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}words.lite.json`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    words = await res.json();
  } catch (err) {
    root.innerHTML = `<div class="center-msg">Failed to load the dictionary.<br>${(err as Error).message}</div>`;
    return;
  }

  const idx = indexWords(words);
  const [progress, settings, streak, daily] = [
    await loadAllProgress(),
    loadSettings(),
    loadStreak(),
    loadDailyStats(),
  ];
  const decayResult = applyDecay(loadRating());
  if (decayResult.lost > 0) saveRating(decayResult.state);

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
    daily,
    rating: decayResult.state,
    settings,
    streak,
    current: null,
    shownAt: 0,
    ttsOk: ttsAvailable() && hasArabicVoice(),
    pendingDecay: decayResult.lost > 0
      ? { lost: decayResult.lost, daysOff: decayResult.daysOff }
      : null,
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
      <div class="header-left">
        <span class="streak" id="streak"></span>
        <span class="rating-badge" id="rating-badge"></span>
      </div>
      <div class="header-actions">
        <button class="icon-btn" id="stats-btn" aria-label="Stats">📊</button>
        <button class="icon-btn" id="settings-btn" aria-label="Settings">⚙</button>
      </div>
    </header>
    <div class="decay-banner" id="decay-banner" hidden></div>
    <main class="stage">
      <div class="meta" id="meta"></div>
      <div class="word" id="word" lang="ar" dir="rtl"></div>
    </main>
    <div class="actions">
      <button class="btn miss" id="miss">Missed</button>
      <button class="btn tts ${state.ttsOk ? '' : 'disabled'}" id="tts" aria-label="Listen">🔊</button>
      <button class="btn know" id="know">Got it</button>
    </div>
    <div class="scrim" id="scrim"></div>
    <aside class="panel" id="panel" aria-hidden="true"></aside>
    <section class="page" id="stats-page" aria-hidden="true"></section>
    <div class="promo-overlay" id="promo-overlay" aria-hidden="true"></div>
  `;

  const wordEl = root.querySelector<HTMLElement>('#word')!;
  const metaEl = root.querySelector<HTMLElement>('#meta')!;
  const streakEl = root.querySelector<HTMLElement>('#streak')!;
  const ratingEl = root.querySelector<HTMLElement>('#rating-badge')!;
  const decayBannerEl = root.querySelector<HTMLElement>('#decay-banner')!;
  const promoOverlay = root.querySelector<HTMLElement>('#promo-overlay')!;
  const missBtn = root.querySelector<HTMLButtonElement>('#miss')!;
  const knowBtn = root.querySelector<HTMLButtonElement>('#know')!;
  const ttsBtn = root.querySelector<HTMLButtonElement>('#tts')!;
  const settingsBtn = root.querySelector<HTMLButtonElement>('#settings-btn')!;
  const statsBtn = root.querySelector<HTMLButtonElement>('#stats-btn')!;
  const scrim = root.querySelector<HTMLElement>('#scrim')!;
  const panel = root.querySelector<HTMLElement>('#panel')!;
  const statsPage = root.querySelector<HTMLElement>('#stats-page')!;

  let advanceTimer: number | null = null;

  const renderStreak = () => {
    streakEl.innerHTML = `<span title="Current streak">🔥 ${state.streak.streak}</span>`;
  };

  const renderRating = () => {
    const t = tierFor(state.rating.rating);
    ratingEl.innerHTML = `
      <span class="tier-emoji" title="${t.name}" style="color:${t.color}">${t.emoji}</span>
      <span class="rating-n" id="rating-n">${state.rating.rating}</span>
      <span class="rating-delta" id="rating-delta"></span>
    `;
  };

  // Briefly show "+N" or "-N" next to the rating after a read.
  const flashDelta = (delta: number) => {
    if (delta === 0) return;
    const el = root.querySelector<HTMLElement>('#rating-delta');
    if (!el) return;
    el.textContent = delta > 0 ? `+${delta}` : `${delta}`;
    el.className = `rating-delta show ${delta > 0 ? 'up' : 'down'}`;
    window.setTimeout(() => {
      el.className = 'rating-delta';
      el.textContent = '';
    }, 1100);
  };

  const showPromotion = (tierName: string, color: string, emoji: string) => {
    promoOverlay.innerHTML = `
      <div class="promo-card">
        <div class="promo-tier-emoji" style="color:${color}">${emoji}</div>
        <div class="promo-label">Promoted to</div>
        <div class="promo-name" style="color:${color}">${tierName}</div>
        <button class="btn promo-continue" data-action="dismiss-promo">Continue</button>
      </div>
    `;
    promoOverlay.classList.add('open');
    promoOverlay.setAttribute('aria-hidden', 'false');
  };
  const dismissPromo = () => {
    promoOverlay.classList.remove('open');
    promoOverlay.setAttribute('aria-hidden', 'true');
  };
  promoOverlay.addEventListener('click', e => {
    const t = e.target as HTMLElement;
    if (t.dataset.action === 'dismiss-promo' || t === promoOverlay) dismissPromo();
  });

  // Decay banner: shown once per app load if rating dropped while away.
  if (state.pendingDecay) {
    const { lost, daysOff } = state.pendingDecay;
    decayBannerEl.textContent = `−${lost} rating after ${daysOff} day${daysOff > 1 ? 's' : ''} off`;
    decayBannerEl.hidden = false;
    decayBannerEl.classList.add('show');
    window.setTimeout(() => {
      decayBannerEl.classList.remove('show');
      window.setTimeout(() => { decayBannerEl.hidden = true; }, 300);
    }, 5000);
    state.pendingDecay = null;
  }

  const showCurrent = () => {
    const i = state.current;
    if (i == null) {
      wordEl.textContent = '—';
      metaEl.textContent = 'No words match the selected range.';
      return;
    }
    const w = state.idx.words[i]!;
    wordEl.textContent = w.word;
    metaEl.textContent = `${w.letterCount} letters`;
    state.shownAt = performance.now();
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
    const w = state.idx.words[i]!;
    const ms = state.shownAt > 0 ? performance.now() - state.shownAt : 0;
    recordRead(state.daily, w.letterCount, ms);
    saveDailyStats(state.daily);
    const next = applyRating(state.progress.get(i), knew, Date.now());
    state.progress.set(i, next);
    saveProgress(i, next).catch(console.error);

    // Elo update: only feed timed reads to keep the rating signal clean.
    // Out-of-window reads (rage-clicks, AFK) are dropped so noise doesn't
    // wreck the ladder.
    const inWindow = ms >= 100 && ms <= 20_000;
    if (inWindow) {
      const upd = applyRead(state.rating, knew, w.letterCount, ms / w.letterCount);
      state.rating = upd.state;
      saveRating(state.rating);
      renderRating();
      flashDelta(upd.delta);
      if (upd.promoted) showPromotion(upd.newTier.name, upd.newTier.color, upd.newTier.emoji);
    }

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

  // Keyboard shortcuts (desktop): ← miss, → know, space TTS, Esc closes overlays
  window.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      if (panel.classList.contains('open')) closeSettings();
      else if (statsPage.classList.contains('open')) closeStats();
      return;
    }
    if (panel.classList.contains('open') || statsPage.classList.contains('open')) return;
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

  // Stats page (full-screen overlay)
  const openStats = () => {
    renderStatsPage(statsPage, state);
    statsPage.classList.add('open');
    statsPage.setAttribute('aria-hidden', 'false');
  };
  const closeStats = () => {
    statsPage.classList.remove('open');
    statsPage.setAttribute('aria-hidden', 'true');
  };
  statsBtn.addEventListener('click', openStats);
  statsPage.addEventListener('click', e => {
    const t = e.target as HTMLElement;
    if (t.dataset.action === 'close-stats') closeStats();
  });

  renderStreak();
  renderRating();
  advance();
}

function renderSettingsPanel(
  panel: HTMLElement,
  state: AppState,
  bounds: Bounds,
  onChange: () => void,
) {
  const s = state.settings;

  panel.innerHTML = `
    <h2>Settings</h2>

    <div class="field">
      <div class="field-row">
        <label for="minLet">Min letters</label>
        <input type="number" id="minLet" min="${bounds.minLen}" max="${bounds.maxLen}" value="${s.minLetters}">
      </div>
      <input type="range" id="minLetR" min="${bounds.minLen}" max="${bounds.maxLen}" value="${s.minLetters}">
    </div>

    <div class="field">
      <div class="field-row">
        <label for="maxLet">Max letters</label>
        <input type="number" id="maxLet" min="${bounds.minLen}" max="${bounds.maxLen}" value="${s.maxLetters}">
      </div>
      <input type="range" id="maxLetR" min="${bounds.minLen}" max="${bounds.maxLen}" value="${s.maxLetters}">
    </div>

    <div class="field">
      <div class="field-row">
        <label for="goal">Daily goal</label>
        <input type="number" id="goal" min="5" max="500" step="5" value="${state.streak.dailyGoal}">
      </div>
      <span class="hint">Number of words to see per day to keep the streak.</span>
    </div>

    <div class="field">
      <div class="field-row">
        <label for="autoTts">Auto-play audio</label>
        <input type="checkbox" id="autoTts" class="toggle" ${s.autoTts ? 'checked' : ''} ${state.ttsOk ? '' : 'disabled'}>
      </div>
      <span class="hint">${state.ttsOk ? 'Speaks the word as soon as it appears.' : 'No Arabic voice detected on this device.'}</span>
    </div>

    <div class="field">
      <div class="field-row">
        <label for="ttsRate">TTS speed</label>
        <span class="hint" id="ttsRateLbl">${s.ttsRate.toFixed(2)}×</span>
      </div>
      <input type="range" id="ttsRate" min="0.5" max="1.3" step="0.05" value="${s.ttsRate}" ${state.ttsOk ? '' : 'disabled'}>
    </div>

    <div class="field">
      <div class="field-row">
        <label for="autoAdv">Auto-advance (speed mode)</label>
        <input type="checkbox" id="autoAdv" class="toggle" ${s.autoAdvance ? 'checked' : ''}>
      </div>
      <span class="hint">Move to the next word without tapping.</span>
    </div>

    <div class="field">
      <div class="field-row">
        <label for="advMs">Auto-advance delay</label>
        <span class="hint"><span id="advMsLbl">${(s.autoAdvanceMs / 1000).toFixed(1)}</span>s</span>
      </div>
      <input type="range" id="advMs" min="800" max="6000" step="100" value="${s.autoAdvanceMs}">
    </div>

    <button class="danger" id="reset">Reset my progress</button>

    <div class="field" style="border:none;padding-top:1rem">
      <button class="btn" data-action="close" style="min-height:2.75rem">Close</button>
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
    if (!confirm('Reset all progress, stats and rating?')) return;
    await clearProgress();
    state.progress.clear();
    clearDailyStats();
    state.daily = {};
    clearRating();
    state.rating = defaultRating();
    saveSettings({ ...DEFAULT_SETTINGS });
    onChange();
    // Re-render the panel so stats update.
    renderSettingsPanel(panel, state, bounds, onChange);
  });
}

function renderStatsPage(page: HTMLElement, state: AppState) {
  const todayK = todayKey();
  const today = getDay(state.daily, todayK);
  const todayMpl = today.letters > 0 && today.ms > 0 ? today.ms / today.letters : null;
  const all = aggregateAll(state.daily);
  const days = trainingDays(state.daily);

  const fmtMs = (v: number | null) => (v == null ? '—' : `${Math.round(v)} ms`);
  const fmtDay = (k: string) => {
    // Show "Apr 27" style for the chart axis title — full ISO in the tooltip.
    const [y, m, d] = k.split('-').map(Number) as [number, number, number];
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${months[m - 1]} ${d} ${y}`;
  };

  const peak = Math.max(1, ...days.map(d => d.msPerLetter));
  const bars = days
    .map(d => {
      const h = (d.msPerLetter / peak) * 100;
      const cls = d.day === todayK ? ' today' : '';
      return `<div class="bar-large${cls}" title="${fmtDay(d.day)}: ${Math.round(d.msPerLetter)} ms/letter (${d.words} words)"><div class="fill" style="height:${h}%"></div></div>`;
    })
    .join('');

  // Empty-state messaging tells the user what to do rather than showing a blank.
  const chartBlock = days.length > 0
    ? `
      <div class="chart-scroll">
        <div class="chart-large" style="--bar-count:${days.length}">${bars}</div>
      </div>
      <div class="chart-legend">
        <span>${days.length} training day${days.length > 1 ? 's' : ''}</span>
        <span>peak: ${Math.round(peak)} ms/letter</span>
      </div>`
    : `<div class="empty">No timed reads yet. Tap “Got it” or “Missed” a few times and your daily ms/letter will appear here.</div>`;

  // ----- Rating block -----
  const r = state.rating;
  const tier = tierFor(r.rating);
  const tierIdx = tierIndexFor(r.rating);
  const nextTier = TIERS[tierIdx + 1];
  const progress = tierProgress(r.rating);
  const progressLabel = nextTier
    ? `${nextTier.min - r.rating} to ${nextTier.name}`
    : 'Top tier reached';

  const ratingBlock = `
    <div class="rating-card">
      <div class="rating-card-head">
        <span class="rating-card-emoji" style="color:${tier.color}">${tier.emoji}</span>
        <div class="rating-card-text">
          <span class="rating-card-tier" style="color:${tier.color}">${tier.name}</span>
          <span class="rating-card-num">${r.rating}</span>
        </div>
        <div class="rating-card-best">
          <span class="dim">Best</span>
          <strong>${r.bestRating}</strong>
        </div>
      </div>
      <div class="tier-bar"><div class="tier-bar-fill" style="width:${progress * 100}%; background:${(nextTier ?? tier).color}"></div></div>
      <div class="tier-bar-label">${progressLabel}</div>
    </div>
  `;

  page.innerHTML = `
    <header class="page-header">
      <button class="icon-btn" data-action="close-stats" aria-label="Back">←</button>
      <h1>Stats</h1>
      <span class="header-spacer"></span>
    </header>
    <div class="page-body">
      ${ratingBlock}
      <div class="kpi">
        <span class="kpi-n">${fmtMs(todayMpl)}</span>
        <span class="kpi-l">per letter — today</span>
      </div>
      <div class="kpi-row">
        <div><span class="dim">Words today</span> <strong>${today.words}</strong></div>
        <div><span class="dim">All-time avg</span> <strong>${fmtMs(all.msPerLetter)}/letter</strong></div>
      </div>
      <h3>ms / letter per day</h3>
      ${chartBlock}
    </div>
  `;
}
