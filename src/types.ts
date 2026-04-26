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
