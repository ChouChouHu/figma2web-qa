#!/usr/bin/env node
/**
 * Real mouse-wheel scrolling test. For every page, scroll from top to bottom and back with
 * wheel events dispatched at several horizontal positions (e.g. over a map, over a side panel),
 * and report what users would hit:
 *
 *   stuck      wheel events that moved nothing while the page is not at the bottom (scroll trap)
 *   no-bottom  the page never reached its end / the footer never became visible
 *   cut        an inner scroll container under the pointer never reached its own end
 *              (content clipped — e.g. a JS "pinned" section with a wrong scroll distance)
 *   no-top     scrolling back up did not return to the top
 *
 *   node scroll-test.mjs --config qa.config.json [--pages a,b] [--width 1440] [--height 900]
 *                        [--x 0.25,0.75] [--footer footer] [--shots]
 *
 * --shots saves a viewport screenshot every few steps to <out>-scroll/<page>/ for visual review
 * (sticky headers covering content, half-rendered sections, overlays popping up…).
 */

import fs from "node:fs";
import path from "node:path";
import { launch, loadConfig, installMocks, seedStorage, openPage, parseArgs, sleep } from "./lib/cdp.mjs";

const args = parseArgs();
const cfg = loadConfig(args.config);
const only = args.pages ? String(args.pages).split(",") : null;
const W = Number(args.width ?? 1440);
const H = Number(args.height ?? cfg.height);
const xs = String(args.x ?? "0.25,0.5,0.75").split(",").map(Number);
const footerSel = args.footer ?? cfg.footerSelector ?? "footer";
const outDir = cfg._rel(`${cfg.out}-scroll`);
const STEP = 120;
const MAX_STEPS = 400;

const cdp = await launch();
await installMocks(cdp, cfg);
await seedStorage(cdp, cfg);

const STATE = `(() => {
  const sc = [...document.querySelectorAll('*')].filter((e) => {
    const s = getComputedStyle(e);
    return /(auto|scroll)/.test(s.overflowY) && e.scrollHeight > e.clientHeight + 2;
  });
  const f = document.querySelector(${JSON.stringify(footerSel)});
  return {
    y: Math.round(scrollY),
    max: document.documentElement.scrollHeight - innerHeight,
    inner: sc.map((e) => [Math.round(e.scrollTop), e.scrollHeight - e.clientHeight]),
    footer: f ? f.getBoundingClientRect().top < innerHeight : null,
  };
})()`;
const sig = (s) => s.y + "|" + s.inner.map((i) => i[0]).join(",");

const wheel = (x, y, dy) =>
  cdp.send("Input.dispatchMouseEvent", { type: "mouseWheel", x, y, deltaX: 0, deltaY: dy });

let failures = 0;
for (const page of cfg.pages) {
  if (only && !only.includes(page.name)) continue;
  const url = new URL(page.path, cfg.baseUrl).href;
  for (const fx of xs) {
    await openPage(cdp, cfg, url, W, H);
    const x = Math.round(W * fx);
    const y = Math.round(H * 0.6);
    const issues = [];
    let s = await cdp.eval(STATE);
    let stuck = 0;
    let steps = 0;

    // ↓ down
    for (; steps < MAX_STEPS; steps++) {
      const before = sig(s);
      await wheel(x, y, STEP);
      await sleep(60);
      s = await cdp.eval(STATE);
      if (args.shots && steps % 6 === 0) await shot(page.name, `x${fx}-down-${String(steps).padStart(3, "0")}`);
      if (sig(s) === before) {
        if (s.y < s.max - 2) stuck++;
        else break; // at bottom and nothing else moves
      } else stuck = 0;
      if (stuck >= 5) {
        issues.push(`stuck at y=${s.y}/${s.max}`);
        break;
      }
    }
    if (s.y < s.max - 2) issues.push(`no-bottom (y=${s.y}/${s.max})`);
    if (s.footer === false) issues.push(`footer "${footerSel}" never visible`);
    s.inner.forEach(([top, max], i) => {
      if (top < max - 2) issues.push(`cut: scroll container #${i} stopped at ${top}/${max}`);
    });

    // ↑ up
    for (let i = 0; i < MAX_STEPS && s.y > 0; i++) {
      await wheel(x, y, -STEP);
      await sleep(40);
      s = await cdp.eval(STATE);
    }
    await sleep(200);
    s = await cdp.eval(STATE);
    if (s.y > 0) issues.push(`no-top (y=${s.y})`);

    failures += issues.length;
    console.log(`${issues.length ? "✗" : "✓"} ${page.name} @x=${fx}  ${steps} steps  ${issues.join(" · ")}`);
  }
}

async function shot(name, label) {
  const { data } = await cdp.send("Page.captureScreenshot", { format: "png" });
  const file = path.join(outDir, name, `${label}.png`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.from(data, "base64"));
}

cdp.close();
process.exit(failures ? 1 : 0);
