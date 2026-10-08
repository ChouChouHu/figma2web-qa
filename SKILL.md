---
name: figma2web-qa
description: Pixel-level QA of a website against its Figma design across all responsive breakpoints. Exports frames from the Figma desktop app with computer use, screenshots the site at each width, diffs them pixel by pixel and fixes the code, then re-verifies every width, stress-tests text overflow and real wheel scrolling. Use when asked to make pages "pixel perfect", match a Figma design, or QA a build against design frames.
---

# figma2web QA

`$S` = the `scripts/` folder next to this file (needs Node 22+, Chrome, Python 3 + Pillow). Run from the
project root. Full docs: README.md.

## 1. Export the design (computer use → Figma desktop)
- Ask the user which Figma page/frames are the hand-off source. Never measure draft pages.
- Frames should be named `<page>/<width>` (e.g. `home/390`) so the export lands in folders.
- Select frames → right panel **Export** → `+` → PNG, **1x** → Export → save into `qa/design/`.
  The save sheet usually needs full-screen control; `⌘⇧G` then type the folder path.
- If exported images are wider than the canvas (sections/padding): `python3 $S/compare.py trim qa/design 390,768,…`.
- Do not burn Figma REST API quota to probe; one full-file fetch is the only sane API use.

## 2. Configure
Copy the skill's `examples/qa.config.json` to the project root: base URL, widths, pages, cookie keys in
`localStorage`, dev overlays in `removeSelectors`, loading markers in `busySelectors`.
For data-driven pages add `mocks` with fixtures holding **the same copy as the design**, otherwise
line wraps and list lengths make heights incomparable.

## 3. Fix loop — one width at a time, smallest first
1. `node $S/shoot.mjs --config qa.config.json --widths <w>`
2. `python3 $S/compare.py report --config qa.config.json --widths <w>` → Δh, diff %, box Δ.
3. Per page: `compare.py boxes` → first card whose top/height differs; `compare.py bands` inside it
   → first text row whose Δy changes = the bug. `compare.py zoom` / `color` to read exact px/colour.
4. Change code using measured values only (map to existing tokens; no rounding). Re-shoot, repeat
   until ±1px. Commit per page.

Classic Figma→CSS gaps: inside strokes don't add size (CSS border adds 2px → use inset ring or
padding −1); `minmax(0,1fr)` rows/fixed heights clip long text (use `min-h`, `1fr`); icon/text
baseline offsets; spacing that differs per breakpoint; mobile using a different layout, not a
squeezed desktop one.

## 4. Regression pass (mandatory)
After every width is done, re-shoot **all pages × all widths** and re-run `report`. Any width that
got worse was broken by a later breakpoint fix — fix it, then run the full pass again.

## 5. Overflow stress
`shoot.mjs` always checks that text stays inside boxed elements and that there is no horizontal
page scroll. Then run `--stress repeat` (all text ×3) and `--stress unbroken` (long URL-like token).
Fix real breakage (`overflow-wrap:anywhere`, `min-w-0`, `min-h` instead of `h`); report the rest.

## 6. Scroll test
`node $S/scroll-test.mjs --config qa.config.json --width 1440 --shots` — wheel at several x
positions; fails on scroll traps, unreachable page bottom/footer, inner containers that never reach
their end, or not returning to top. Review `--shots` frames for sticky/overlay glitches. Repeat at a
short viewport (`--height 700`).

## 7. Report
Table per page × width: remaining Δ and the reason — data differs from the mock, design flaw
(overlapping text, missing breakpoint), platform text shaping (CJK line breaks), or open question.
Ask the user before inventing visuals the design does not have.
