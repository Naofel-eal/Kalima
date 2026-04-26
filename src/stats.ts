import type { DailyStats, DayStats } from './types';

// We keep timing only when it falls in a plausible reading window.
// Faster than this is rage-click; slower means the user got distracted.
export const MIN_READ_MS = 100;
export const MAX_READ_MS = 20_000;

export function todayKey(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Returns the date `n` days before `from` as YYYY-MM-DD.
export function dayOffset(from: Date, n: number): string {
  const d = new Date(from.getFullYear(), from.getMonth(), from.getDate() - n);
  return todayKey(d);
}

// Always returns a fresh empty record, even if the day isn't tracked yet.
export function getDay(stats: DailyStats, key: string): DayStats {
  return stats[key] ?? { words: 0, letters: 0, ms: 0 };
}

// Mutates `stats` in place. Returns it for chaining.
export function recordRead(
  stats: DailyStats,
  letterCount: number,
  ms: number,
): DailyStats {
  const key = todayKey();
  const cur = getDay(stats, key);
  if (ms >= MIN_READ_MS && ms <= MAX_READ_MS) {
    stats[key] = {
      words: cur.words + 1,
      letters: cur.letters + letterCount,
      ms: cur.ms + ms,
    };
  } else {
    // Out-of-window read: count the word (daily count must stay truthful) but
    // drop letters and ms together, so ms/letter remains a clean ratio computed
    // only from in-window reads.
    stats[key] = {
      words: cur.words + 1,
      letters: cur.letters,
      ms: cur.ms,
    };
  }
  return stats;
}

export interface Aggregate {
  words: number;
  letters: number;
  ms: number;
  msPerLetter: number | null; // null when there's no timed data yet
}

function toAggregate(d: DayStats): Aggregate {
  return {
    words: d.words,
    letters: d.letters,
    ms: d.ms,
    msPerLetter: d.letters > 0 && d.ms > 0 ? d.ms / d.letters : null,
  };
}

export function aggregateRange(stats: DailyStats, days: number, from = new Date()): Aggregate {
  const acc: DayStats = { words: 0, letters: 0, ms: 0 };
  for (let i = 0; i < days; i++) {
    const k = dayOffset(from, i);
    const d = stats[k];
    if (!d) continue;
    acc.words += d.words;
    acc.letters += d.letters;
    acc.ms += d.ms;
  }
  return toAggregate(acc);
}

export function aggregateAll(stats: DailyStats): Aggregate {
  const acc: DayStats = { words: 0, letters: 0, ms: 0 };
  for (const d of Object.values(stats)) {
    acc.words += d.words;
    acc.letters += d.letters;
    acc.ms += d.ms;
  }
  return toAggregate(acc);
}

// Last `n` days as an ordered list (oldest → newest), 0-filling absent days.
export function lastDays(stats: DailyStats, n: number, from = new Date()): { day: string; words: number }[] {
  const out: { day: string; words: number }[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const k = dayOffset(from, i);
    out.push({ day: k, words: stats[k]?.words ?? 0 });
  }
  return out;
}
