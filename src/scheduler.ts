import type { Settings, Word, WordProgress } from './types';

// Three-bucket spaced selection:
//   - 60% chance pick a NEW word (never shown)
//   - 30% chance pick from LEARNING (bucket 1)
//   - 10% chance pick from REVIEW (bucket 2 or 3)
// If the chosen bucket is empty, fall through to the next non-empty one.
//
// Inside each bucket: pick uniformly at random among eligible words.
// Eligibility = letterCount within [minLetters, maxLetters].
//
// "Familiar" / "mastered" entries are also throttled by recency: we won't
// re-show a mastered word that was seen in the last hour.

const NEW_WEIGHT = 0.6;
const LEARNING_WEIGHT = 0.3;
// review weight = 1 - others

const RECENT_MASTERED_MS = 60 * 60 * 1000; // 1h

export interface IndexedWords {
  words: Word[];
  // Pre-bucketed indices for fast filtering by letter range.
  byLength: Map<number, number[]>;
}

export function indexWords(words: Word[]): IndexedWords {
  const byLength = new Map<number, number[]>();
  for (let i = 0; i < words.length; i++) {
    const w = words[i]!;
    let arr = byLength.get(w.letterCount);
    if (!arr) {
      arr = [];
      byLength.set(w.letterCount, arr);
    }
    arr.push(i);
  }
  return { words, byLength };
}

function eligibleIndices(idx: IndexedWords, settings: Settings): number[] {
  const out: number[] = [];
  for (const [len, arr] of idx.byLength) {
    if (len < settings.minLetters || len > settings.maxLetters) continue;
    out.push(...arr);
  }
  return out;
}

interface Buckets {
  fresh: number[];      // never seen
  learning: number[];   // bucket 1
  review: number[];     // bucket 2 or 3, not seen recently
}

function partition(
  eligible: number[],
  progress: Map<number, WordProgress>,
  now: number,
): Buckets {
  const fresh: number[] = [];
  const learning: number[] = [];
  const review: number[] = [];
  for (const i of eligible) {
    const p = progress.get(i);
    if (!p) {
      fresh.push(i);
    } else if (p.bucket === 1) {
      learning.push(i);
    } else if (now - p.lastSeenTs > RECENT_MASTERED_MS) {
      review.push(i);
    }
  }
  return { fresh, learning, review };
}

function pickFrom(arr: number[]): number | null {
  if (arr.length === 0) return null;
  return arr[Math.floor(Math.random() * arr.length)]!;
}

export function pickNext(
  idx: IndexedWords,
  progress: Map<number, WordProgress>,
  settings: Settings,
  lastShown: number | null,
): number | null {
  const eligible = eligibleIndices(idx, settings);
  if (eligible.length === 0) return null;

  const { fresh, learning, review } = partition(eligible, progress, Date.now());

  // Order of preference based on weighted dice roll, with fall-through.
  const r = Math.random();
  const order: number[][] =
    r < NEW_WEIGHT
      ? [fresh, learning, review]
      : r < NEW_WEIGHT + LEARNING_WEIGHT
      ? [learning, fresh, review]
      : [review, learning, fresh];

  for (const bucket of order) {
    // Avoid showing the same word twice in a row when we have alternatives.
    const filtered =
      lastShown != null && bucket.length > 1
        ? bucket.filter(i => i !== lastShown)
        : bucket;
    const pick = pickFrom(filtered);
    if (pick != null) return pick;
  }

  // All eligible words are mastered & seen too recently → relax the recency.
  const fallback = eligible.filter(i => i !== lastShown);
  return pickFrom(fallback.length ? fallback : eligible);
}

// Update progress after a self-rating.
export function applyRating(
  prev: WordProgress | undefined,
  knew: boolean,
  now: number,
): WordProgress {
  if (!knew) {
    return {
      bucket: 1,
      streak: 0,
      seen: (prev?.seen ?? 0) + 1,
      lastSeenTs: now,
    };
  }
  const newStreak = (prev?.streak ?? 0) + 1;
  const bucket: 1 | 2 | 3 =
    newStreak >= 3 ? 3 : newStreak >= 2 ? 2 : 1;
  return {
    bucket,
    streak: newStreak,
    seen: (prev?.seen ?? 0) + 1,
    lastSeenTs: now,
  };
}

export interface ProgressStats {
  total: number;
  fresh: number;
  learning: number;
  familiar: number;
  mastered: number;
}

export function computeStats(idx: IndexedWords, progress: Map<number, WordProgress>): ProgressStats {
  let learning = 0, familiar = 0, mastered = 0;
  for (const p of progress.values()) {
    if (p.bucket === 1) learning++;
    else if (p.bucket === 2) familiar++;
    else mastered++;
  }
  const total = idx.words.length;
  const fresh = total - learning - familiar - mastered;
  return { total, fresh, learning, familiar, mastered };
}
