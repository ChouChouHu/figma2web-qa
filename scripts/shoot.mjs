#!/usr/bin/env node
/**
 * Full-page screenshots of every page × width, plus automatic text-overflow checks.
 *
 *   node shoot.mjs --config qa.config.json
 *   node shoot.mjs --config qa.config.json --pages home,about --widths 390,1440
 *   node shoot.mjs --config qa.config.json --stress repeat     # make every text ×3 first
 *   node shoot.mjs --config qa.config.json --stress unbroken   # append a long unbroken token
 *
 * Output: <out>/<page>/<width>.png and <out>/report.json
 * Exit code 1 when any overflow is found (useful in CI).
 */

import fs from "node:fs";
import path from "node:path";
import { launch, loadConfig, installMocks, seedStorage, openPage, parseArgs } from "./lib/cdp.mjs";
import { OVERFLOW_CHECK, STRESS } from "./lib/overflow.mjs";

const args = parseArgs();
const cfg = loadConfig(args.config);
const only = args.pages ? String(args.pages).split(",") : null;
const widths = args.widths ? String(args.widths).split(",").map(Number) : cfg.widths;
const stress = args.stress === true ? "repeat" : args.stress;
const out = cfg._rel(args.out ?? (stress ? `${cfg.out}-stress-${stress}` : cfg.out));

const cdp = await launch();
await installMocks(cdp, cfg);
await seedStorage(cdp, cfg);

const report = [];
let problems = 0;
for (const width of widths) {
  for (const page of cfg.pages) {
    if (only && !only.includes(page.name)) continue;
    const url = new URL(page.path, cfg.baseUrl).href;
    const settled = await openPage(cdp, cfg, url, width);
    if (stress) await cdp.eval(STRESS(stress));
    const overflow = await cdp.eval(OVERFLOW_CHECK);
    const height = await cdp.eval("document.documentElement.scrollHeight");

    const { data } = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
    const file = path.join(out, page.name, `${width}.png`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, Buffer.from(data, "base64"));

    problems += overflow.length;
    report.push({ page: page.name, width, height, settled, overflow });
    const warn = [!settled && "⚠️ not settled (still loading?)", overflow.length && `⚠️ ${overflow.length} overflow`]
      .filter(Boolean)
      .join("  ");
    console.log(`✓ ${page.name} ${width}px  h=${height}  ${warn}`);
    for (const o of overflow) console.log(`    · "${o.text}" overflows ${o.box} by ${o.dx}×${o.dy}px`);
  }
}

fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
console.log(`\n${report.length} screenshots → ${path.relative(process.cwd(), out)}  (${problems} overflow issues)`);
cdp.close();
process.exit(problems ? 1 : 0);
