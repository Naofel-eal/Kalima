// Build a unique-words dataset from the Tanzil Uthmani Quran text.
//
// Output: data/words.json — array of { word, occurence: [{surah, ayah, position}], letterCount }
//
// Normalization (to match the user-facing example بِسْمِ — close to Tanzil "simple-enhanced"):
//   ٱ (alef wasla, U+0671)        → ا (alef, U+0627)
//   ٰ (dagger alef, U+0670)        → removed (purely a recitation hint)
//   ـ (tatweel, U+0640)            → removed (typographic stretching)
//   U+06D6..U+06ED (quranic stop / small letter marks) → removed
//   U+200C..U+200F (zero-width / bidi marks)            → removed
//
// Letter count: counts only "base" Arabic letters (U+0621..U+064A and ٱ U+0671 if any
// survives). Vocalization marks (fathah/kasrah/dammah/sukun/shaddah/tanwin/maddah) are
// excluded from the count, so بِسْمِ → 3 and رَبِّ → 2 (the shaddah is one shape, not two).

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const SRC = resolve(ROOT, 'data/raw/quran-uthmani-tanzil.txt');
// Full dataset (with occurrences) is generated locally for inspection only;
// it is gitignored. The PWA reads the lite version from public/.
const OUT_FULL = resolve(ROOT, 'data/words.json');
const OUT_PUBLIC = resolve(ROOT, 'public/words.lite.json');

// Standard count of verses per surah (1..114). Sum = 6236.
const VERSES_PER_SURAH = [
  7, 286, 200, 176, 120, 165, 206, 75, 129, 109,
  123, 111, 43, 52, 99, 128, 111, 110, 98, 135,
  112, 78, 118, 64, 77, 227, 93, 88, 69, 60,
  34, 30, 73, 54, 45, 83, 182, 88, 75, 85,
  54, 53, 89, 59, 37, 35, 38, 29, 18, 45,
  60, 49, 62, 55, 78, 96, 29, 22, 24, 13,
  14, 11, 11, 18, 12, 12, 30, 52, 52, 44,
  28, 28, 20, 56, 40, 31, 50, 40, 46, 42,
  29, 19, 36, 25, 22, 17, 19, 26, 30, 20,
  15, 21, 11, 8, 8, 19, 5, 8, 8, 11,
  11, 8, 3, 9, 5, 4, 7, 3, 6, 3,
  5, 4, 5, 6,
];

const TOTAL_VERSES = VERSES_PER_SURAH.reduce((a, b) => a + b, 0); // 6236

// Build a flat lookup: line index (0-based) → [surah, ayah]
function buildVerseIndex() {
  const index = new Array(TOTAL_VERSES);
  let i = 0;
  for (let s = 0; s < VERSES_PER_SURAH.length; s++) {
    const n = VERSES_PER_SURAH[s];
    for (let a = 1; a <= n; a++) index[i++] = [s + 1, a];
  }
  return index;
}

const STOP_MARK_RE = /[ۖ-ۭ]/g;          // small high marks + ayah/sajdah marks
const ZERO_WIDTH_RE = /[‌-‏﻿]/g;
const TATWEEL_RE = /ـ/g;
const DAGGER_ALEF_RE = /ٰ/g;
const ALEF_WASLA_RE = /ٱ/g;

function normalize(word) {
  return word
    .replace(ALEF_WASLA_RE, 'ا')
    .replace(DAGGER_ALEF_RE, '')
    .replace(TATWEEL_RE, '')
    .replace(STOP_MARK_RE, '')
    .replace(ZERO_WIDTH_RE, '');
}

// A "letter" is anything in the Arabic letter range U+0621..U+064A.
// Diacritics (U+064B..U+065F) and ٱ/ٰ have already been normalized away.
function countLetters(word) {
  let n = 0;
  for (const ch of word) {
    const c = ch.codePointAt(0);
    if (c >= 0x0621 && c <= 0x064A) n++;
  }
  return n;
}

async function main() {
  const raw = await readFile(SRC, 'utf8');
  // Stop at the Tanzil license block: it starts with a `#` line, but contains
  // continuation lines that don't (e.g. `//tanzil.info`, version strings).
  const verses = [];
  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (t === '') continue;
    if (t.startsWith('#')) break;
    verses.push(t);
  }

  if (verses.length !== TOTAL_VERSES) {
    throw new Error(
      `Expected ${TOTAL_VERSES} verse lines, got ${verses.length}. ` +
      `Source file may be a different Tanzil edition.`,
    );
  }

  const verseIndex = buildVerseIndex();
  // Preserve insertion order so words appear in mushaf order on first sight.
  const words = new Map(); // normalized word → { word, occurence: [...], letterCount }

  for (let i = 0; i < verses.length; i++) {
    const [surah, ayah] = verseIndex[i];
    const tokens = verses[i].split(/\s+/);
    let position = 0;
    for (const tok of tokens) {
      const w = normalize(tok);
      if (!w) continue;
      // Skip tokens with no actual Arabic letters (defensive).
      const letterCount = countLetters(w);
      if (letterCount === 0) continue;
      position++;
      let entry = words.get(w);
      if (!entry) {
        entry = { word: w, occurence: [], letterCount };
        words.set(w, entry);
      }
      entry.occurence.push({ surah, ayah, position });
    }
  }

  const out = Array.from(words.values());

  await writeFile(OUT_FULL, JSON.stringify(out, null, 2) + '\n', 'utf8');

  // Lite version: just { word, letterCount } for the PWA's main loop.
  const lite = out.map(({ word, letterCount }) => ({ word, letterCount }));
  await writeFile(OUT_PUBLIC, JSON.stringify(lite) + '\n', 'utf8');

  // Summary
  const totalOccurrences = out.reduce((n, w) => n + w.occurence.length, 0);
  const byLen = new Map();
  for (const w of out) byLen.set(w.letterCount, (byLen.get(w.letterCount) ?? 0) + 1);
  const lenBuckets = [...byLen.entries()].sort((a, b) => a[0] - b[0]);

  console.log(`verses parsed:        ${verses.length}`);
  console.log(`unique words:         ${out.length}`);
  console.log(`total occurrences:    ${totalOccurrences}`);
  console.log(`letter-count buckets: ${lenBuckets.map(([k, v]) => `${k}:${v}`).join(' ')}`);
  console.log(`output (full):        ${OUT_FULL}`);
  console.log(`output (lite):        ${OUT_PUBLIC}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
