#!/usr/bin/env node
/**
 * Monet GUI harness — drive the real app in a real browser, screenshot every step, and read
 * app state back out of the page.
 *
 * Everything (dev server + browser + scenario) runs inside ONE process, because detached
 * processes do not survive between shell calls in the agent sandbox.
 *
 *   node tests/manual/harness.mjs <scenario.mjs> [--out DIR] [--headed] [--slow MS] [--keep]
 *
 *   scenario.mjs default-exports `async ({ page, ui, shot, state, log }) => { ... }`.
 *
 * Output: DIR/NN-label.png per shot plus DIR/contact.png, a contact sheet of every shot, so
 * a whole interaction can be reviewed in a single image.
 *
 * --headed runs a real (non-headless) Chromium; the wrapper script `harness.sh` supplies an
 * X server via xvfb-run. CHROME_PATH overrides the browser binary.
 * --verbose forwards all page console output (console.log in app code shows up in the run).
 */
import { chromium } from '@playwright/test';
import { createServer } from 'vite';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const scenarioPath = args.find((a) => !a.startsWith('--')) ?? 'tests/manual/scenarios/smoke.mjs';
const flag = (name) => args.includes(`--${name}`);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const outDir = path.resolve(opt('out', 'tests/manual/out'));
const headed = flag('headed');
const slowMo = Number(opt('slow', headed ? 120 : 0));
const keepOpen = flag('keep');

if (!existsSync(scenarioPath)) {
  console.error(`scenario not found: ${scenarioPath}`);
  process.exit(2);
}

await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });

// ---------------------------------------------------------------- dev server (hot reload)
const server = await createServer({
  configFile: 'vite.config.ts',
  server: { port: 5178, host: '127.0.0.1', strictPort: true },
  logLevel: 'error',
});
await server.listen();
const base = 'http://127.0.0.1:5178/';

// ---------------------------------------------------------------- browser
const browser = await chromium.launch({
  headless: !headed,
  executablePath: process.env.CHROME_PATH || undefined,
  slowMo,
  args: ['--force-device-scale-factor=1'],
});
const context = await browser.newContext({
  viewport: { width: Number(opt('width', 1280)), height: Number(opt('height', 800)) },
  acceptDownloads: true,
});
const page = await context.newPage();

const problems = [];
page.on('pageerror', (e) => problems.push(`PAGEERROR ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error' && !m.text().includes('favicon')) problems.push(`CONSOLE ${m.text()}`);
  // --verbose forwards every page log, which is how you trace tool/render code paths.
  if (flag('verbose')) console.log(`  [page:${m.type()}] ${m.text()}`);
});

// ---------------------------------------------------------------- helpers given to scenarios
let shotIndex = 0;
const shots = [];

const shot = async (label = `step-${shotIndex}`) => {
  const name = `${String(++shotIndex).padStart(2, '0')}-${label.replace(/[^\w.-]+/g, '-')}.png`;
  const file = path.join(outDir, name);
  await page.screenshot({ path: file });
  shots.push({ label, file });
  console.log(`  shot ${name}`);
  return file;
};

/** Read app state out of the page (see src/app/debugBridge.ts). */
const state = {
  doc: () => page.evaluate(() => window.__monet.doc()),
  stack: () => page.evaluate(() => window.__monet.stack()),
  stores: () => page.evaluate(() => window.__monet.stores()),
  editingTextId: () => page.evaluate(() => window.__monet.editingTextId()),
  countColor: (hex, tol) => page.evaluate(([h, t]) => window.__monet.countColor(h, t), [hex, tol]),
  pixelAt: (x, y) => page.evaluate(([x2, y2]) => window.__monet.pixelAt(x2, y2), [x, y]),
};

/** Canvas-relative helpers: fractional coordinates, doc pixel coordinates, drags. */
const ui = {
  page,
  async canvasBox() {
    return page.locator('.workspace__canvas').boundingBox();
  },
  /** Screen point from a fraction of the canvas. */
  async at(fx, fy) {
    const b = await ui.canvasBox();
    return { x: b.x + b.width * fx, y: b.y + b.height * fy };
  },
  /** Screen point for a document pixel — exact, via the live view transform. */
  async atDoc(dx, dy) {
    const b = await ui.canvasBox();
    const v = (await state.stores()).view;
    return { x: b.x + v.panX + (dx + 0.5) * v.zoom, y: b.y + v.panY + (dy + 0.5) * v.zoom };
  },
  async click(pt) {
    await page.mouse.click(pt.x, pt.y);
    await page.waitForTimeout(60);
  },
  async drag(a, b2, steps = 12) {
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b2.x, b2.y, { steps });
    await page.mouse.up();
    await page.waitForTimeout(90);
  },
  async newDoc(size) {
    await page.click('.empty .btn--primary, .doctabs__new');
    if (size) await page.locator(`.dialog .chipbtn:has-text("${size}")`).click();
    await page.click('.dialog__actions .btn--primary');
    await page.waitForTimeout(350);
  },
  async tab(name) {
    await page.click(`.tab:text-is("${name}")`);
    await page.waitForTimeout(120);
  },
  async tool(name) {
    await page.click(`.toolgrid__btn:has-text("${name}")`);
    await page.waitForTimeout(80);
  },
  async paletteColor(index) {
    await page.locator('.colorpanel .swatches').first().locator('.swatch').nth(index).click();
    await page.waitForTimeout(80);
  },
  /** Set a numeric field inside the options panel by its slider label. */
  async setNumber(label, value) {
    const input = page.locator(`.panel .slider:has-text("${label}") input[type="number"]`);
    await input.fill(String(value));
    await input.blur();
    await page.waitForTimeout(120);
  },
};

const log = (...a) => console.log(' ', ...a);

// ---------------------------------------------------------------- run
console.log(`harness: ${scenarioPath} → ${outDir} (${headed ? 'headed' : 'headless'})`);
await page.goto(base, { waitUntil: 'networkidle' });
await page.waitForFunction(() => !!window.__monet, null, { timeout: 15_000 });

let failure = null;
try {
  const mod = await import(path.resolve(scenarioPath));
  // `beforeLoad` runs as an init script before the app boots — used to stub browser APIs
  // (e.g. the File System Access picker) that headless Chromium cannot present.
  if (mod.beforeLoad) {
    await page.addInitScript(mod.beforeLoad);
    await page.goto(base, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => !!window.__monet, null, { timeout: 15_000 });
  }
  await scenarioRun(mod.default);
} catch (err) {
  failure = err;
  console.error('SCENARIO FAILED:', err.message);
  await shot('failure').catch(() => {});
}

async function scenarioRun(fn) {
  if (typeof fn !== 'function') throw new Error('scenario must default-export a function');
  await fn({ page, ui, shot, state, log, outDir, context });
}

// ---------------------------------------------------------------- contact sheet
if (shots.length > 1) {
  const cols = Math.min(3, shots.length);
  const rows = Math.ceil(shots.length / cols);
  const cell = { w: 480, h: 300 };
  const sheet = await context.newPage();
  // Inline as data URIs: a page created with setContent cannot load file:// images.
  const items = (
    await Promise.all(
      shots.map(async (s, i) => {
        const b64 = (await readFile(s.file)).toString('base64');
        return `<figure><img src="data:image/png;base64,${b64}"><figcaption>${i + 1}. ${s.label}</figcaption></figure>`;
      }),
    )
  ).join('');
  await sheet.setViewportSize({ width: cols * cell.w + 24, height: rows * (cell.h + 26) + 24 });
  await sheet.setContent(
    `<style>
      body{margin:0;background:#1b1c1f;color:#e6e7ea;font:12px system-ui;padding:8px;
           display:grid;grid-template-columns:repeat(${cols},1fr);gap:8px}
      figure{margin:0}
      img{width:100%;display:block;border:1px solid #3b3d42}
      figcaption{padding:3px 2px;color:#9aa0a6}
     </style>${items}`,
  );
  await sheet.waitForTimeout(500);
  await sheet.screenshot({ path: path.join(outDir, 'contact.png'), fullPage: true });
  await sheet.close();
  console.log(`  contact sheet → ${path.join(outDir, 'contact.png')}`);
}

await writeFile(
  path.join(outDir, 'report.json'),
  JSON.stringify({ scenario: scenarioPath, shots: shots.map((s) => s.label), problems }, null, 2),
);

if (problems.length) {
  console.log('PAGE PROBLEMS:');
  for (const p of problems) console.log('  ' + p);
} else {
  console.log('no page errors');
}

if (keepOpen) {
  console.log('--keep: browser stays open for 10 minutes (or until this call ends)');
  await page.waitForTimeout(600_000);
}

await browser.close();
await server.close();
console.log((await readdir(outDir)).length + ' files in ' + outDir);
process.exit(failure ? 1 : 0);
