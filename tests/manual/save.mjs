/**
 * Manual check for docs/07 §1/§8 save routing. Headless Chromium exposes
 * showSaveFilePicker but never resolves it (no picker UI), so this stubs the picker two
 * ways: a fake handle (exercises the File System Access write path, including the silent
 * re-save on the second Ctrl+S) and no picker at all (exercises the download fallback).
 */
import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';

const b = await chromium.launch({ executablePath: process.env.CHROME_PATH });
const p = await b.newPage({ viewport: { width: 1280, height: 800 }, acceptDownloads: true });
const errs = [];
p.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message));

await p.addInitScript(() => {
  window.__written = [];
  window.showSaveFilePicker = async ({ suggestedName }) => ({
    name: suggestedName,
    queryPermission: async () => 'granted',
    requestPermission: async () => 'granted',
    createWritable: async () => ({
      write: async (blob) => {
        const buf = new Uint8Array(await blob.arrayBuffer());
        window.__written.push({ name: suggestedName, size: buf.length, head: [...buf.slice(0, 4)] });
      },
      close: async () => {},
    }),
  });
});

await p.goto('http://127.0.0.1:4319/', { waitUntil: 'networkidle' });
await p.click('.empty .btn--primary');
await p.click('.dialog__actions .btn--primary');
await p.waitForTimeout(400);

const box = await p.locator('.workspace__canvas').boundingBox();
await p.mouse.move(box.x + box.width * 0.4, box.y + box.height * 0.4);
await p.mouse.down();
await p.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.6, { steps: 10 });
await p.mouse.up();
await p.waitForTimeout(300);

await p.keyboard.press('Control+s');
await p.waitForTimeout(800);
console.log('AFTER SAVE:', JSON.stringify(await p.evaluate(() => window.__written)));
console.log('DIRTY DOT:', await p.locator('.doctab__dot').count(), '(0 = saved)');

// Second save must reuse the remembered handle: no new picker, one more write.
await p.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.3);
await p.waitForTimeout(200);
await p.keyboard.press('Control+s');
await p.waitForTimeout(800);
console.log('AFTER RESAVE:', (await p.evaluate(() => window.__written.length)), 'writes');

// .monet through the menu, still via the fake handle.
await p.click('.topbar__menu');
await p.click('.menu__item:has-text("Save project")');
await p.waitForTimeout(800);
const written = await p.evaluate(() => window.__written);
console.log('MONET:', JSON.stringify(written[written.length - 1]));

// Download fallback: remove the picker entirely.
await p.evaluate(() => {
  delete window.showSaveFilePicker;
});
const p2 = p;
await p2.mouse.click(box.x + box.width * 0.45, box.y + box.height * 0.45);
await p2.waitForTimeout(200);
const [dl] = await Promise.all([
  p2.waitForEvent('download'),
  p2.click('.topbar__menu').then(() => p2.click('.menu__item:has-text("Save project")')),
]);
const bytes = readFileSync(await dl.path());
console.log('DOWNLOAD:', dl.suggestedFilename(), bytes.length, 'zip magic:', bytes.subarray(0, 2).toString('ascii'));

await p.keyboard.press('Shift+Slash');
await p.waitForTimeout(300);
console.log('SHORTCUTS DIALOG:', await p.locator('.shortcuts').count());
await p.screenshot({ path: process.argv[2] || '/tmp/save.png' });
console.log('ERRORS:', errs.length ? errs.join('\n') : 'none');
await b.close();
