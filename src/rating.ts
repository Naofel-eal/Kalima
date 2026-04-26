import type { RatingState } from './types';
import { todayKey } from './stats';

// ----- Tunables -----
// Constants are deliberately concentrated here so balancing the ladder
// doesn't require touching the rest of the codebase.

export const INITIAL_RATING = 600;
export const RATING_FLOOR = 200;

const K_PROVISIONAL = 24;
const K_NORMAL = 12;
const PROVISIONAL_THRESHOLD = 50;

// Word difficulty model: longer words punch harder. The exact constants
// matter less than the slope — letter count is our only difficulty signal.
const D_BASE = 800;
const D_PER_LETTER = 80;

// Score model: ms-per-letter mapped to [0, 1]. 200 ms/letter ≈ 0.5 (median),
// faster shoots toward 1, slower decays toward 0.
const SCORE_TARGET_MPL = 200;
const SCORE_CURVE = 1.5;

// Decay model: skipping training erodes rating, but grace day prevents
// punishing intra-day session scheduling.
export const DECAY_PER_DAY = 15;
export const DECAY_GRACE_DAYS = 1;

// ----- Tiers -----

export interface Tier {
  name: string;
  min: number;
  emoji: string;
  color: string;
}

export const TIERS: Tier[] = [
  { name: 'Iron',     min: 0,    emoji: '⚙️', color: '#6b6b6b' },
  { name: 'Bronze',   min: 500,  emoji: '🥉', color: '#a06d3a' },
  { name: 'Silver',   min: 900,  emoji: '🥈', color: '#9ca3af' },
  { name: 'Gold',     min: 1300, emoji: '🥇', color: '#d4a373' },
  { name: 'Platinum', min: 1700, emoji: '💠', color: '#7ba8a8' },
  { name: 'Diamond',  min: 2100, emoji: '💎', color: '#5fa8d3' },
  { name: 'Master',   min: 2500, emoji: '👑', color: '#b85450' },
];

export function tierIndexFor(rating: number): number {
  for (let i = TIERS.length - 1; i >= 0; i--) {
    if (rating >= TIERS[i]!.min) return i;
  }
  return 0;
}

export function tierFor(rating: number): Tier {
  return TIERS[tierIndexFor(rating)]!;
}

// Where the player sits within their current tier. Used to draw a progress
// bar toward the next promotion. Returns 1 at Master (no next tier).
export function tierProgress(rating: number): number {
  const i = tierIndexFor(rating);
  const cur = TIERS[i]!;
  const next = TIERS[i + 1];
  if (!next) return 1;
  return Math.min(1, Math.max(0, (rating - cur.min) / (next.min - cur.min)));
}

// ----- Default state -----

export function defaultRating(): RatingState {
  return {
    rating: INITIAL_RATING,
    bestRating: INITIAL_RATING,
    totalReads: 0,
    lastSeenDay: '',
    shownTier: tierIndexFor(INITIAL_RATING),
  };
}

// ----- Update logic -----

function difficulty(letterCount: number): number {
  return D_BASE + D_PER_LETTER * letterCount;
}

// Map the read outcome to a [0, 1] score. Speed dominates; "Missed" gets a
// tiny floor (0.05) to keep the math well-behaved on rage-clicks.
export function scoreFromOutcome(knew: boolean, msPerLetter: number | null): number {
  if (!knew) return 0.05;
  if (msPerLetter == null) return 0.5; // no timing signal: neutral score
  return 1 / (1 + Math.pow(msPerLetter / SCORE_TARGET_MPL, SCORE_CURVE));
}

export interface RatingUpdate {
  state: RatingState;
  delta: number;        // signed change applied this read
  promoted: boolean;    // true if this read crossed into a tier never reached
  newTier: Tier;
}

export function applyRead(
  prev: RatingState,
  knew: boolean,
  letterCount: number,
  msPerLetter: number | null,
): RatingUpdate {
  const D = difficulty(letterCount);
  const E = 1 / (1 + Math.pow(10, (D - prev.rating) / 400));
  const S = scoreFromOutcome(knew, msPerLetter);
  const K = prev.totalReads < PROVISIONAL_THRESHOLD ? K_PROVISIONAL : K_NORMAL;

  const raw = prev.rating + K * (S - E);
  const newRating = Math.max(RATING_FLOOR, Math.round(raw));
  const newTierIdx = tierIndexFor(newRating);
  const promoted = newTierIdx > prev.shownTier;

  const next: RatingState = {
    rating: newRating,
    bestRating: Math.max(prev.bestRating, newRating),
    totalReads: prev.totalReads + 1,
    lastSeenDay: todayKey(),
    shownTier: Math.max(prev.shownTier, newTierIdx),
  };

  return {
    state: next,
    delta: newRating - prev.rating,
    promoted,
    newTier: TIERS[newTierIdx]!,
  };
}

// ----- Decay -----

function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map(Number) as [number, number, number];
  const [by, bm, bd] = b.split('-').map(Number) as [number, number, number];
  const da = new Date(ay, am - 1, ad).getTime();
  const db = new Date(by, bm - 1, bd).getTime();
  return Math.round((db - da) / (24 * 60 * 60 * 1000));
}

export interface DecayResult {
  state: RatingState;
  lost: number;
  daysOff: number;
}

// Apply on app load. No-op for first-ever session (lastSeenDay empty) and for
// returning users within the grace period.
export function applyDecay(prev: RatingState, today = todayKey()): DecayResult {
  if (!prev.lastSeenDay) return { state: prev, lost: 0, daysOff: 0 };
  const gap = daysBetween(prev.lastSeenDay, today);
  const decayDays = Math.max(0, gap - DECAY_GRACE_DAYS);
  if (decayDays <= 0) return { state: prev, lost: 0, daysOff: gap };
  const lost = decayDays * DECAY_PER_DAY;
  const newRating = Math.max(RATING_FLOOR, prev.rating - lost);
  return {
    state: {
      ...prev,
      rating: newRating,
      shownTier: Math.min(prev.shownTier, tierIndexFor(newRating)),
    },
    lost: prev.rating - newRating,
    daysOff: gap,
  };
}
