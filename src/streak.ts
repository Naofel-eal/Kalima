import { todayKey } from './stats';
import type { StreakState } from './types';

function daysBetween(a: string, b: string): number {
  // "a" and "b" are YYYY-MM-DD; treat as local dates.
  const [ay, am, ad] = a.split('-').map(Number) as [number, number, number];
  const [by, bm, bd] = b.split('-').map(Number) as [number, number, number];
  const da = new Date(ay, am - 1, ad).getTime();
  const db = new Date(by, bm - 1, bd).getTime();
  return Math.round((db - da) / (24 * 60 * 60 * 1000));
}

// Call this after each word is shown. Returns the (possibly updated) state.
export function tickStreak(s: StreakState): StreakState {
  const today = todayKey();
  if (s.lastDay !== today) {
    // New day. If yesterday's session reached the goal, the streak continues;
    // otherwise it resets. Either way, today starts fresh.
    const wasYesterday = s.lastDay && daysBetween(s.lastDay, today) === 1;
    const yesterdayMet = s.todayCount >= s.dailyGoal;
    const carry = wasYesterday && yesterdayMet ? s.streak : 0;
    s = { ...s, lastDay: today, streak: carry, todayCount: 1 };
  } else {
    const newCount = s.todayCount + 1;
    // The moment we cross the goal today, bump the streak by 1 (if not already today).
    if (s.todayCount < s.dailyGoal && newCount >= s.dailyGoal) {
      s = { ...s, todayCount: newCount, streak: s.streak + 1 };
    } else {
      s = { ...s, todayCount: newCount };
    }
  }
  return s;
}
