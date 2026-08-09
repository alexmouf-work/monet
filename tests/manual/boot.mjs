/**
 * Manual boot check: builds are served on :4319, this drives the real app in Chromium and
 * screenshots it. Usage: npx vite build && npx vite preview --port 4319 & node tests/manual/boot.mjs out.png
 * CHROME_PATH overrides the browser binary (this sandbox ships one at /opt/pw-browsers).
 */
import { chromium } from '@playwright/test';
const executablePath = process.env.CHROME_PATH || undefined;
const b = await chromium.launch({ executablePath });
const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
const errs = [];
p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
p.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
await p.goto('http://127.0.0.1:4319/', { waitUntil: 'networkidle' });
await p.click('.empty .btn--primary');
await p.waitForSelector('dialog.dialog');
await p.click('.dialog__actions .btn--primary');
await p.waitForTimeout(600);
await p.screenshot({ path: process.argv[2] || '/tmp/m1.png' });
console.log('DOC TABS:', await p.locator('.doctab').count());
console.log('CANVAS:', await p.locator('.workspace__canvas').count());
console.log('STATUS:', (await p.locator('.statusbar').innerText()).replace(/\n/g, ' | '));
console.log('ERRORS:', errs.length ? errs.join('\n') : 'none');
await b.close();
