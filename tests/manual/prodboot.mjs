/**
 * Production-output check: serves `dist/` exactly as a static host would (this is what Vercel
 * serves) and confirms the app boots, the manifest and service worker resolve, and a document
 * can be created. Run: npx vite build && node tests/manual/prodboot.mjs
 */
import { chromium } from '@playwright/test';
import { preview } from 'vite';
import { globSync } from 'node:fs';

/** Same browser the harness uses; Playwright's own default path is the headless shell, absent here. */
const chromePath =
  process.env.CHROME_PATH ||
  globSync('/opt/pw-browsers/chromium-*/chrome-linux/chrome')[0] ||
  undefined;

const server = await preview({ preview: { port: 4321, host: '127.0.0.1' }, logLevel: 'error' });
const browser = await chromium.launch({ executablePath: chromePath });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const problems = [];
page.on('pageerror', (e) => problems.push(`PAGEERROR ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error' && !m.text().includes('favicon')) problems.push(`CONSOLE ${m.text()}`);
});
page.on('response', (r) => {
  if (r.status() >= 400) problems.push(`HTTP ${r.status()} ${new URL(r.url()).pathname}`);
});

await page.goto('http://127.0.0.1:4321/', { waitUntil: 'networkidle' });
console.log('title:', await page.title());
console.log('shell rendered:', await page.locator('.app').count());

const manifestHref = await page.getAttribute('link[rel=manifest]', 'href');
console.log('manifest link:', manifestHref);
const manifest = await page.evaluate(async (href) => {
  const res = await fetch(href);
  return { status: res.status, json: await res.json() };
}, manifestHref);
console.log(
  'manifest:',
  manifest.status,
  manifest.json.name,
  '| icons:',
  manifest.json.icons.length,
);

// The OS file association is built entirely from these manifest members, so a build that drops
// them silently loses "Open with → Monet" (docs/07 §10).
const handlers = manifest.json.file_handlers ?? [];
const extensions = handlers.flatMap((h) => Object.values(h.accept ?? {}).flat());
console.log(
  'file_handlers:',
  handlers.length,
  '| extensions:',
  extensions.join(' '),
  '| actions:',
  [...new Set(handlers.map((h) => h.action))].join(','),
);
console.log('launch_handler:', JSON.stringify(manifest.json.launch_handler));
for (const want of ['.png', '.jpg', '.webp', '.bmp', '.gif', '.ico', '.monet']) {
  if (!extensions.includes(want)) problems.push(`MANIFEST missing file handler for ${want}`);
}
// An action outside the served paths would 404 on launch: there is no catch-all rewrite.
for (const h of handlers) {
  const res = await page.evaluate(
    async (a) => (await fetch(a, { method: 'GET' })).status,
    new URL(h.action, 'http://127.0.0.1:4321/').href,
  );
  if (res >= 400) problems.push(`MANIFEST file handler action ${h.action} → HTTP ${res}`);
}

const sw = await page.evaluate(async () => {
  const res = await fetch('./sw.js');
  const reg = await navigator.serviceWorker?.getRegistration();
  return { status: res.status, registered: !!reg, scope: reg?.scope ?? null };
});
console.log('sw.js:', sw.status, '| registered:', sw.registered, '| scope:', sw.scope);

// Prove the app is actually usable from the production bundle.
await page.click('.empty .btn--primary');
await page.click('.dialog__actions .btn--primary');
await page.waitForTimeout(600);
const box = await page
  .locator('.workspace:not(.workspace--model) .workspace__canvas')
  .boundingBox();
await page.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.4);
await page.mouse.down();
await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.6, { steps: 8 });
await page.mouse.up();
await page.waitForTimeout(300);
console.log(
  'doc tabs:',
  await page.locator('.doctab').count(),
  '| dirty:',
  await page.locator('.doctab__dot').count(),
);
await page.screenshot({ path: process.argv[2] || '/tmp/prodboot.png' });

console.log(
  problems.length ? 'PROBLEMS:\n  ' + problems.join('\n  ') : 'no errors, no failed requests',
);
await browser.close();
await server.close();
