# Kalima

A small PWA for practicing fluent reading of vocalized Quranic words.

Live: **<https://naofel-eal.github.io/Kalima/>**

The app cycles through unique vocalized words extracted from the Quran. For each
word you tap **Got it** or **Missed**; an internal scheduler then favors words
you don't know yet, revisits the ones you missed, and occasionally re-tests the
ones you've mastered. An optional text-to-speech button reads the word aloud
(when an Arabic voice is available on the device) so you can self-check.

## Features

- 18,761 unique vocalized words from the Quran
- Three-bucket scheduler: ~60% fresh / ~30% learning / ~10% review
- Min/max letter-count filters
- Self-rating with two buttons; keyboard shortcuts (`←` Missed, `→` Got it, `space` listen)
- Web Speech TTS (`ar-SA`), with adjustable rate
- Optional auto-advance ("speed mode")
- Daily streak with configurable goal
- Per-word progress tracked in IndexedDB
- Fully offline after first load (service worker via Workbox)
- Installable on iOS / Android / desktop
- Light + dark theme (follows OS)

## Tech

- Vite + TypeScript (no UI framework)
- `vite-plugin-pwa` for the manifest and service worker
- Self-hosted Amiri Quran font for accurate diacritic rendering
- IndexedDB for the per-word progress map; localStorage for settings & streak

Build size: ~14 KB JS (5 KB gzipped) + 5 KB CSS. Service worker pre-caches the
font (~58 KB) and the words file (~870 KB).

## How the dataset is built

Source: [Tanzil](https://tanzil.net) Uthmani text, version 1.0.2 (mirrored from
[`luthfi/Quran`](https://github.com/luthfi/Quran/blob/master/tanzil_quran.txt)).
Stored under `data/raw/` and redistributed verbatim per the Tanzil license.

`scripts/build-words.mjs`:

1. Reads the raw text (one verse per line, 6,236 verses total).
2. Maps each line to a `(surah, ayah)` pair via the standard verse counts.
3. Tokenizes each verse on whitespace.
4. Normalizes each token toward the Tanzil "simple-enhanced" style:
   - `ٱ` (alef wasla, U+0671) → `ا`
   - `ٰ` (dagger alef, U+0670) → removed
   - `ـ` (tatweel, U+0640) → removed
   - Quranic stop / small-letter marks (U+06D6..U+06ED) → removed
   - Zero-width / bidi marks → removed
5. Counts base Arabic letters only (U+0621..U+064A), excluding all diacritics.
   So `بِسْمِ` → 3 letters, and `رَبِّ` → 2 (the shaddah is a single glyph).
6. Emits two outputs:
   - `data/words.json` — full version with occurrences, gitignored, kept locally
     for inspection. Shape: `{ word, occurence: [{surah, ayah, position}], letterCount }`.
   - `public/words.lite.json` — minified `{ word, letterCount }` array consumed
     by the PWA.

Regenerate with `npm run build:words` (only needed if `data/raw/` changes).

## Development

```bash
npm install
npm run dev          # Vite dev server
npm run build        # production build into dist/
npm run preview      # serve the built dist/
npm run build:words  # regenerate the words dataset
```

TypeScript is strict (`strict`, `noUnusedLocals`, `noUncheckedIndexedAccess`).
There are no runtime dependencies.

## Project layout

```
.github/workflows/deploy.yml   GitHub Pages deploy
data/
  raw/quran-uthmani-tanzil.txt Tanzil Uthmani source
  raw/SOURCE.md                attribution
public/
  icon.svg                     PWA icon
  words.lite.json              dataset consumed at runtime
  fonts/AmiriQuran.woff2       self-hosted font
scripts/
  build-words.mjs              dataset generator
src/
  main.ts                      entry + SW registration
  app.ts                       UI orchestration
  scheduler.ts                 three-bucket word selection
  store.ts                     IndexedDB + localStorage persistence
  streak.ts                    daily streak tracking
  tts.ts                       Web Speech wrapper
  types.ts
  style.css
index.html
vite.config.ts
```

## Deployment

Pushes to `main` trigger `.github/workflows/deploy.yml`, which builds the app
and publishes `dist/` to GitHub Pages. No `gh-pages` branch is used; the deploy
goes straight to the Pages environment.

The site is served from a sub-path (`/Kalima/`), so `vite.config.ts` sets
`base: '/Kalima/'` and the manifest's `start_url` / `scope` match. If the repo
is renamed, update `BASE` in `vite.config.ts` accordingly (the GitHub Pages
sub-path is case-sensitive).

## Caveats

- TTS quality depends entirely on the device. iOS and macOS ship competent
  Arabic voices; Windows and most Linux desktops do not.
- The bismillah at the start of each surah (except surah 9) is preserved as the
  first token of verse 1, matching Tanzil's structure. This means `بِسْمِ`
  appears with 115 occurrences in the full dataset.
- The dataset is built from the Uthmani edition; some words still carry the
  `ـٓـ` (maddah above) sign. This is intentional and part of standard
  vocalization.

## Attribution

Quran text © [Tanzil Project](https://tanzil.net), used and redistributed under
the Tanzil license. The text must not be modified; any application using it
must clearly indicate Tanzil as the source.

Font: [Amiri Quran](https://fonts.google.com/specimen/Amiri+Quran) (SIL Open
Font License).
