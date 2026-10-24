# Gym Bro · Phase 1 clickable prototype (front end only)

Vue 3 + Vite + TypeScript + vue-router, same stack/versions as `gym-bro/frontend` (Vue 3.5, Vite 7, TS strict, vue-tsc).
No backend, no auth: example data lives in `src/store.ts` (reactive, persisted to localStorage, "reset example data" on Profile).

    npm install
    npm run dev        # http://localhost:5174 (also on LAN with --host)
    npm run build      # typecheck + dist/ (relative base, hash routes: any sub-path) + gymbro-prototype.html (single file, opens from disk)
    npm run shots      # mobile screenshots -> shots/ (needs Chrome at /usr/bin/google-chrome or $CHROME); then python3 scripts/compare.py

Add `?statusbar` to the URL to draw a fake iPhone status bar / home indicator (used for screenshots; on by default on desktop, which also shows a phone frame).

Layout: `src/lib` (dates, nutrition maths: Mifflin-St Jeor, activity factors, macro split), `src/data` (foods per 100 g, seed data),
`src/store.ts` (profile, weigh-ins, food log, trend, targets), `src/ui.ts` (sheets, toasts), `src/components`, `src/views`.
Design tokens in `src/styles/main.css` use the Figma variable names (`--color-surface`, `--text-secondary`, `--chart-line` …).
Demo "today" is fixed to Sat 24 Oct 2026 (`DEMO_TODAY` in `src/lib/dates.ts`) so the example data lines up with the Figma file.

## Responsive
Phone (<600 px) is the primary design. Tablet 600–1023: bottom tabs, centred wider column, 2-column cards, centred bottom sheet.
Desktop ≥1024: sidebar (Add food / Log weight + nav), dashboard Today (3 columns ≥1280, 2 below), food/weight sheets become a right-hand panel,
real keyboard entry instead of the numeric keypad, hover Copy/Delete on log rows. Shortcuts: N or / add food, Q quick add, W weight, Esc back/close,
↑↓ + Enter (Shift+Enter = usual amount) in search. Breakpoints live in `src/lib/viewport.ts` (`vp`, `keyboardEntry`, `cameraCapable` for future scan features).
`node scripts/shots-desktop.mjs` -> shots/desktop/ (1440×900, 1100×860, 820×1180).

## Timeline, groups, macro balance and states (24 Oct 2026)
- **No meal types.** Every entry has a local time (`HH:MM`, "now" by default, editable in the edit sheet). Log is a timeline; entries within 45 min form a visual cluster (time range + kcal, no names).
- **Select:** hold a row (touch) or click its circle / Ctrl-⌘-click / Shift-click (mouse), or the "Select" button. Bar: Copy to… (today, last 7 days, any past date; times kept), Save as group, Delete (undo).
- **Groups:** foods added in one Add-food session can be saved as a named group (session bar), or from Select mode. Saved groups sit above Recent in Add food; + re-adds all items at the chosen time.
- **Macro balance:** Profile → Macro balance (collapsed, "Default"). Protein Less/Normal/More 1.6/2.0/2.4 g/kg, fat 20/25/30 %, carbs the rest; Exact numbers (1.2–3.0 g/kg, 15–40 %); Reset to default.
- **Trend (S8 / decision 34):** exponentially smoothed (each reading moves it 10 % of the way), always shown from the first weigh-in; gaps up to 28 days get straight-line gap readings, longer gaps are a fresh start; a grey low-accuracy dot under 2 weigh-ins in 7 days (maths in `src/lib/trend.ts`, checks in `scripts/unit-trend.mjs`). Each day is judged against the target that applied that day (see Target history). Over target = hatched / dashed neutral style, never a tick or red.
- **Input device, not width:** typed numbers and hover actions follow `(hover: hover) and (pointer: fine)`; a touch screen at any width keeps the keypad and swipe.
- **Demo states:** Profile → "Prototype · Demo states" (or `?demo=onboarding|empty|lowacc|fresh|typo|loading|offline|unreachable|down|manual|goalreached`). `?now=HH:MM` pins "now" for screenshots.
- Screenshots: `node scripts/shots.mjs`, `node scripts/shots-desktop.mjs`, `node scripts/shots-states.mjs`, then `python3 scripts/compare.py` (grids).

## Specs batch: trend hint, S1–S5, S7 (24 Oct 2026)
- **Trend hint (item 0):** an ⓘ on the Today weight card opens a popover explaining the trend; the weight sheet shows a one-line hint under the trend.
- **S1 Target history:** every target change is stored as a row (setup, weekly update, profile/goal change, macro change, mode switch, own number changed). Each day uses the last row dated on or before it; days before the first target show "No target" and aren't counted in Progress. Profile shows "Current target since …", the next weekly update, and a read-only history (newest first, Show all).
- **S2 Units and servings:** g, ml for liquids, the food's servings (piece, slice, scoop, pot …) and your own private servings (+ Serving). Recents remember the last unit. Entries store amount, unit, grams and a nutrition snapshot, so editing a food never changes past entries.
- **S3 Custom foods:** Add food → "My foods" / "+ New food". Per 100 g or per serving, optional brand and barcode digits, 4/9/4 kcal hint. Edit applies to future logs only; delete hides the food and keeps old entries (Undo). Quick Add can "Also save as my food".
- **S4 App shell:** manifest, icons and a network-first service worker (dist build only), plus a full-screen "Can't reach Gym Bro" / "You're offline" state with Try again and a read-only "View last synced data" mode with a banner.
- **S5 Accessibility (WCAG AA):** contrast tokens raised (`a11y/contrast.md`, 33/33 pass), axe clean on 26 phone/desktop screens (`a11y/axe.md`), 44 pt targets, visible focus rings, sr-only text for status, tick/hatch so status never relies on colour, layout survives 200 % text, reduced motion respected.
- **S7 Own calorie number:** Profile → Goal → "By rate" | "My own number" (1,200–5,000 kcal, steps of 10; accepts 2000 / 2 000 / 2,000). Info line shows daily burn and the implied kg/week; neutral notes when below BMR or when protein + fat don't fit (fat is cut, carbs 0). A "Manual" tag appears wherever the target shows. Reaching the goal weight asks: keep your number, or switch to Maintain.
- **Demo states (Profile → Prototype · Demo states, or `?demo=`):** `manual`, `goalreached`, `down` (full screen), `unreachable` (saving fails) plus the earlier ones.

### Scripts
- `npm run build` → `dist/` and the single-file `gymbro-prototype.html` (icons inlined; no manifest/service worker in the single file).
- `node scripts/test.mjs` (end-to-end, needs `python3 -m http.server 8765` in /tmp/sub with dist in /tmp/sub/some/path), `node scripts/unit.mjs`, `node scripts/contrast.mjs`, `node scripts/a11y.mjs`.
- Shots: `scripts/shots.mjs`, `shots-desktop.mjs`, `shots-states.mjs`, `shots-specs.mjs` → `shots/…`; grids via `python3 scripts/compare.py`.
- Icons: icon B (weight plate with a cut-out G on a barbell) is the app icon. `scripts/icons.mjs` renders it with size-specific variants (`icon-b.svg` ≥101 px, `icon-b-md.svg` 44–100, `icon-b-sm.svg` 24–43 with the barbell dropped, `icon-b-xs.svg` ≤23 = favicon) and copies manifest PNGs, apple-touch-icon and favicon; `scripts/icon-b-sizes.mjs` → `icons/icon-b-sizes.png` check sheet.

### Deploy note
Install-to-home-screen (manifest + service worker) only works when serving `dist/` over https. The single HTML file still works anywhere but is not installable.

## Approved 24 Oct 2026 (afternoon)
- **Icon B** everywhere: manifest, apple-touch-icon, favicon, sidebar and onboarding mark.
- **Target history:** all changes made on one day merge into one row (latest values, every reason listed, e.g. "Goal change · Profile change"); a change undone the same day drops out.
- **Own number:** "2,000" / "2 000" = two thousand (thousands separator); decimals are rejected.
- **Custom foods per serving** without a gram weight are allowed (logged by serving only).
- **Desktop 200 %:** browser zoom is the supported path (reflows to the tablet/phone layout).

## Dynamic Type (iOS text size)
- 1 rem = the body size: on iOS the root uses `font: -apple-system-body`, so Settings → Text Size / Larger Text applies when you return to the app; elsewhere 1 rem = 17 px × the browser's font setting.
- Big display numbers are capped (kcal left ≤ 88 px, weight ≤ 60 px, totals ≤ 40 px, titles ≤ 52 px); week strip / calendar numbers and keypad digits cap because their cells are fixed. Body, labels and numbers in lists scale fully.
- At ≥ 22 px body (`html.dt-l`) truncation turns into wrapping and the food detail / Quick Add sheets scroll as a whole; at ≥ 28 px (`html.dt-xl`, AX sizes) rows wrap, segmented controls stack, macro tiles go 2 × 2, the weight chart labels only top/bottom values, history values move under the reason.
- Try it in any browser with `?dt=23` (xxxLarge), `?dt=34`, `?dt=53` (AX5). Check: `node scripts/dynamic-type.mjs` (Chrome) and `ENGINE=webkit PWC=<playwright-core with WebKit> node scripts/dynamic-type.mjs` → `a11y/dynamic-type*.md`, `shots/dynamic-type/`.

## S8 Part A: trend always on (24 Oct 2026)
- Trend always shown; "Trend not ready" / "N of 3 · provisional" removed. Grey low-accuracy dot (button, 44 pt, spoken reason) on Today, the weight sheet and the sidebar; Profile shows "trend · low accuracy". Tap → "Low accuracy" sheet with the reason.
- Fresh start after more than 28 days: trend = the new weigh-in, chart line broken across the gap, week/30-day change shown as "—", Today card "Recalculate your targets from today's weight?" (Recalculate → target row today, reason `fresh_start`; Not now → nothing).
- Typo guard: more than 3.0 kg from the previous day's trend → "Is 38.6 kg right?" inline in the weight sheet (Fix it = primary, saves nothing; Yes, save). Not for the first weigh-in.
- Setup step "Your starting weight" = the first weigh-in. Goal reached is only judged on the latest real weigh-in.
- Demo states: `?demo=lowacc`, `?demo=fresh`, `?demo=typo`. Screenshots: `node scripts/shots-s8.mjs` → shots/s8/.
