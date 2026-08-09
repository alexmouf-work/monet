/** Manual check: draw with the pen at high zoom, then read pixels back off the canvas. */
import { chromium } from '@playwright/test';
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH });
const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
const errs = [];
p.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message));
await p.goto('http://127.0.0.1:4319/', { waitUntil: 'networkidle' });
await p.click('.empty .btn--primary');
await p.click('.dialog__actions .btn--primary');
await p.waitForTimeout(500);

const box = await p.locator('.workspace__canvas').boundingBox();
// Drag a diagonal across the middle of the canvas with the default 1px pen.
await p.mouse.move(box.x + box.width * 0.35, box.y + box.height * 0.35);
await p.mouse.down();
for (let i = 1; i <= 12; i++) {
  await p.mouse.move(box.x + box.width * (0.35 + i * 0.02), box.y + box.height * (0.35 + i * 0.02));
}
await p.mouse.up();
await p.waitForTimeout(400);
console.log('DIRTY:', await p.locator('.doctab__dot').count());
console.log('STATUS:', (await p.locator('.statusbar').innerText()).replace(/\n/g, ' | '));
await p.screenshot({ path: process.argv[2] || '/tmp/draw.png' });
// Undo must clear it again.
await p.keyboard.press('Control+z');
await p.waitForTimeout(300);
await p.screenshot({ path: (process.argv[2] || '/tmp/draw.png').replace('.png', '-undo.png') });
console.log('ERRORS:', errs.length ? errs.join('\n') : 'none');
await b.close();
