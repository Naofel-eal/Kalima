import type { DailyStats, Settings, StreakState, WordProgress } from './types';

// Two persistence layers:
//   - localStorage for small things (settings, streak, daily aggregates):
//     synchronous, easy. Daily aggregates stay tiny (~50B/day).
//   - IndexedDB for the per-word progress map: can grow to ~18k entries,
//     and we want fast reads/writes without parsing a giant JSON every time.

const LS_SETTINGS = 'kalima:settings';
const LS_STREAK = 'kalima:streak';
const LS_DAILY = 'kalima:daily';
const DB_NAME = 'kalima';
const DB_VERSION = 1;
const STORE_PROGRESS = 'progress';

export const DEFAULT_SETTINGS: Settings = {
  minLetters: 3,
  maxLetters: 8,
  autoTts: false,
  autoAdvance: false,
  autoAdvanceMs: 2500,
  ttsRate: 0.85,
  reveal: false,
};

export const DEFAULT_STREAK: StreakState = {
  lastDay: '',
  streak: 0,
  todayCount: 0,
  dailyGoal: 30,
};

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(LS_SETTINGS);
    if (!raw) return { ...DEFAULT_SETTINGS };
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s: Settings) {
  localStorage.setItem(LS_SETTINGS, JSON.stringify(s));
}

export function loadStreak(): StreakState {
  try {
    const raw = localStorage.getItem(LS_STREAK);
    if (!raw) return { ...DEFAULT_STREAK };
    return { ...DEFAULT_STREAK, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_STREAK };
  }
}

export function saveStreak(s: StreakState) {
  localStorage.setItem(LS_STREAK, JSON.stringify(s));
}

export function loadDailyStats(): DailyStats {
  try {
    const raw = localStorage.getItem(LS_DAILY);
    return raw ? (JSON.parse(raw) as DailyStats) : {};
  } catch {
    return {};
  }
}

export function saveDailyStats(s: DailyStats) {
  localStorage.setItem(LS_DAILY, JSON.stringify(s));
}

export function clearDailyStats() {
  localStorage.removeItem(LS_DAILY);
}

// ---------- IndexedDB ----------

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_PROGRESS)) {
        // key: word index (number)
        db.createObjectStore(STORE_PROGRESS);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

export async function loadAllProgress(): Promise<Map<number, WordProgress>> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_PROGRESS, 'readonly');
    const store = tx.objectStore(STORE_PROGRESS);
    const out = new Map<number, WordProgress>();
    const req = store.openCursor();
    req.onsuccess = () => {
      const cursor = req.result;
      if (cursor) {
        out.set(cursor.key as number, cursor.value as WordProgress);
        cursor.continue();
      } else {
        resolve(out);
      }
    };
    req.onerror = () => reject(req.error);
  });
}

export async function saveProgress(index: number, p: WordProgress): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_PROGRESS, 'readwrite');
    tx.objectStore(STORE_PROGRESS).put(p, index);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function clearProgress(): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_PROGRESS, 'readwrite');
    tx.objectStore(STORE_PROGRESS).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
