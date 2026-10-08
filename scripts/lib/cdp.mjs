/**
 * Minimal Chrome DevTools Protocol helper — zero dependencies (Node 22+ has WebSocket built in).
 * Launches a headless Chrome that can render WebGL (SwiftShader) and stays "visible"
 * (headless tabs can be treated as hidden, which pauses requestAnimationFrame and
 * leaves canvas/WebGL content such as maps unfinished).
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const candidates = {
    darwin: [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
    ],
    win32: [
      "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
      "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    ],
    linux: ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"],
  }[process.platform] ?? [];
  const hit = candidates.find((p) => fs.existsSync(p));
  if (!hit) throw new Error("Chrome not found. Set CHROME_PATH.");
  return hit;
}

export async function launch() {
  const port = 9300 + Math.floor(Math.random() * 600);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "figma2web-qa-"));
  const chrome = spawn(
    findChrome(),
    [
      "--headless=new",
      "--use-angle=swiftshader",
      "--enable-unsafe-swiftshader",
      "--hide-scrollbars",
      "--force-device-scale-factor=1",
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profile}`,
      "about:blank",
    ],
    { stdio: "ignore" },
  );
  // Always kill Chrome — a leftover process keeps the port busy and hangs the next run.
  const cleanup = () => {
    chrome.kill();
    try {
      fs.rmSync(profile, { recursive: true, force: true });
    } catch {} // Chrome may still be writing; the OS temp dir is cleaned eventually
  };
  process.on("exit", cleanup);
  process.on("SIGINT", () => process.exit(130));

  let page;
  for (let i = 0; i < 60 && !page; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      page = list.find((t) => t.type === "page");
    } catch {}
    if (!page) await sleep(250);
  }
  if (!page) throw new Error("Chrome remote debugging port did not respond");

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.addEventListener("open", res);
    ws.addEventListener("error", rej);
  });
  let id = 0;
  const pending = new Map();
  const listeners = new Map();
  ws.addEventListener("message", (e) => {
    const msg = JSON.parse(e.data);
    if (msg.method) listeners.get(msg.method)?.(msg.params);
    const p = pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);
    msg.error ? p.reject(new Error(JSON.stringify(msg.error))) : p.resolve(msg.result);
  });

  const cdp = {
    send: (method, params = {}) =>
      new Promise((resolve, reject) => {
        const n = ++id;
        pending.set(n, { resolve, reject });
        ws.send(JSON.stringify({ id: n, method, params }));
      }),
    on: (method, fn) => listeners.set(method, fn),
    eval: async (expression) => {
      const r = await cdp.send("Runtime.evaluate", {
        expression,
        awaitPromise: true,
        returnByValue: true,
      });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + " " + expression.slice(0, 80));
      return r.result?.value;
    },
    close: () => ws.close(),
  };

  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Page.bringToFront");
  await cdp.send("Emulation.setFocusEmulationEnabled", { enabled: true });
  return cdp;
}

/** Load qa.config.json (paths resolved relative to the config file). */
export function loadConfig(file = "qa.config.json") {
  const abs = path.resolve(file);
  const cfg = JSON.parse(fs.readFileSync(abs, "utf8"));
  const dir = path.dirname(abs);
  const rel = (p) => (p ? path.resolve(dir, p) : p);
  return {
    baseUrl: "http://localhost:3000",
    widths: [390, 768, 1024, 1440, 1920],
    height: 900,
    out: "qa/shots",
    design: "qa/design/{page}/{width}.png",
    busySelectors: ['[aria-busy="true"]'],
    removeSelectors: [],
    localStorage: {},
    mocks: [],
    settleTimeoutMs: 20000,
    ...cfg,
    _dir: dir,
    _rel: rel,
  };
}

/** Intercept requests and answer them with local fixture files (same content as the design). */
export async function installMocks(cdp, cfg) {
  if (!cfg.mocks?.length) return;
  const mocks = cfg.mocks.map((m) => ({
    match: m.match,
    body: fs.readFileSync(cfg._rel(m.file), "utf8"),
    type: m.contentType ?? (m.file.endsWith(".json") ? "application/json; charset=utf-8" : "text/plain; charset=utf-8"),
  }));
  await cdp.send("Fetch.enable", { patterns: [{ urlPattern: "*" }] });
  cdp.on("Fetch.requestPaused", ({ requestId, request }) => {
    const m = mocks.find((x) => request.url.includes(x.match));
    const p = m
      ? cdp.send("Fetch.fulfillRequest", {
          requestId,
          responseCode: 200,
          responseHeaders: [
            { name: "Content-Type", value: m.type },
            { name: "Access-Control-Allow-Origin", value: "*" },
          ],
          body: Buffer.from(m.body).toString("base64"),
        })
      : cdp.send("Fetch.continueRequest", { requestId });
    p.catch(() => {}); // request cancelled by navigation
  });
}

/** Wait until busy markers are gone, fonts are loaded and the network is quiet. */
export async function settle(cdp, cfg) {
  const sel = JSON.stringify(cfg.busySelectors.join(","));
  const started = Date.now();
  let last = -1;
  let quiet = 0;
  while (Date.now() - started < cfg.settleTimeoutMs) {
    const s = await cdp.eval(`(async () => {
      await document.fonts?.ready;
      return {
        busy: ${sel} ? document.querySelectorAll(${sel}).length : 0,
        res: performance.getEntriesByType('resource').length,
        ready: document.readyState,
      };
    })()`);
    quiet = s.res === last ? quiet + 1 : 0;
    last = s.res;
    if (s.busy === 0 && s.ready === "complete" && quiet >= 3) {
      await sleep(400);
      return true;
    }
    await sleep(300);
  }
  return false;
}

export async function openPage(cdp, cfg, url, width, height = cfg.height) {
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: width < 768,
  });
  await cdp.send("Page.navigate", { url });
  await sleep(800);
  const settled = await settle(cdp, cfg);
  if (cfg.removeSelectors.length)
    await cdp.eval(
      `document.querySelectorAll(${JSON.stringify(cfg.removeSelectors.join(","))}).forEach(n => n.remove())`,
    );
  return settled;
}

/** Visit the site once to seed localStorage (e.g. dismiss cookie banners). */
export async function seedStorage(cdp, cfg) {
  const entries = Object.entries(cfg.localStorage ?? {});
  if (!entries.length) return;
  await cdp.send("Page.navigate", { url: cfg.baseUrl });
  await sleep(1200);
  await cdp.eval(
    entries.map(([k, v]) => `localStorage.setItem(${JSON.stringify(k)}, ${JSON.stringify(v)})`).join(";"),
  );
}

export function parseArgs(argv = process.argv.slice(2)) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const [k, v] = a.slice(2).split("=");
    args[k] = v ?? (argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : true);
  }
  return args;
}
