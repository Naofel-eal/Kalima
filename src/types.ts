export interface Word {
  word: string;
  letterCount: number;
}

// Per-word progress.
// bucket:
//   0 = new (never seen — implicit, not stored)
//   1 = learning (seen but missed at some point, or only seen 1×)
//   2 = familiar (got it right twice in a row)
//   3 = mastered (got it right ≥3 times in a row)
// On a miss, we drop back to 1.
export interface WordProgress {
  bucket: 1 | 2 | 3;
  streak: number;       // consecutive "su"
  seen: number;         // total times shown
  lastSeenTs: number;   // ms epoch
}

export interface Settings {
  minLetters: number;
  maxLetters: number;
  autoTts: boolean;
  autoAdvance: boolean;
  autoAdvanceMs: number;
  ttsRate: number;      // 0.5–1.5
  reveal: boolean;      // hide diacritics on first display, show on tap (advanced mode — off by default)
}

export interface StreakState {
  lastDay: string;       // YYYY-MM-DD (local time)
  streak: number;        // consecutive days meeting goal
  todayCount: number;    // words shown today
  dailyGoal: number;     // words per day to count for streak
}

// Per-day reading stats. Keyed by YYYY-MM-DD (local time).
export interface DayStats {
  words: number;
  letters: number;
  ms: number;            // cumulative read time
}
export type DailyStats = Record<string, DayStats>;

// Elo-like reading rating. Goes up when reads beat expectation for the word's
// difficulty, down when slower than expected. Decays when you stop training.
export interface RatingState {
  rating: number;        // current rating
  bestRating: number;    // peak rating ever reached
  totalReads: number;    // for provisional K
  lastSeenDay: string;   // YYYY-MM-DD; '' if never trained
  // Highest tier index ever shown to the user. We use this to decide whether
  // a tier crossing is a fresh promotion (worth a celebration) vs a
  // re-crossing after a demotion.
  shownTier: number;
}
