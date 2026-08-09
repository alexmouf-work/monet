/** Manual check: palette pick → marker stroke → bucket fill → eyedropper read-back. */
import { chromium } from '@playwright/test';
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH });
const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
const errs = [];
p.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message));
await p.goto('http://127.0.0.1:4319/', { waitUntil: 'networkidle' });
await p.click('.empty .btn--primary');
await p.click('.dialog__actions .btn--primary');
await p.waitForTimeout(400);

// Pick the palette's red (index 3 = #ED1C24) and check the hex field followed.
await p.locator('.colorpanel .swatches').first().locator('.swatch').nth(3).click();
await p.waitForTimeout(200);
console.log('HEX AFTER PALETTE PICK:', await p.locator('.colorpanel__hex').inputValue());

// Marker at 50% alpha across the canvas.
await p.locator('.toolgrid__btn:has-text("Marker")').click();
await p.locator('.colorpanel__alpha input').fill('50');
const box = await p.locator('.workspace__canvas').boundingBox();
await p.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.3);
await p.mouse.down();
await p.mouse.move(box.x + box.width * 0.7, box.y + box.height * 0.5, { steps: 14 });
await p.mouse.up();
await p.waitForTimeout(300);
await p.screenshot({ path: (process.argv[2] || '/tmp/color.png').replace('.png', '-marker.png') });

// Bucket-fill the empty corner with blue at full alpha, tolerance 0.
await p.locator('.colorpanel__alpha input').fill('100');
await p.locator('.colorpanel .swatches').first().locator('.swatch').nth(7).click();
await p.locator('.toolgrid__btn:has-text("Paint bucket")').click();
await p.locator('.panel .slider input[type="number"]').fill('0');
await p.mouse.click(box.x + box.width * 0.12, box.y + box.height * 0.85);
await p.waitForTimeout(400);

// Eyedropper over the filled area must read that blue back.
await p.locator('.toolgrid__btn:has-text("Eyedropper")').click();
await p.mouse.click(box.x + box.width * 0.12, box.y + box.height * 0.85);
await p.waitForTimeout(300);
console.log('HEX AFTER EYEDROP ON FILL:', await p.locator('.colorpanel__hex').inputValue());

// Eyedropper over the half-alpha marker must report a composited colour and partial alpha.
await p.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.4);
await p.waitForTimeout(300);
console.log('HEX AFTER EYEDROP ON MARKER:', await p.locator('.colorpanel__hex').inputValue());
console.log('ALPHA:', await p.locator('.colorpanel__alpha output').innerText());
console.log('RECENTS:', await p.locator('.colorpanel .swatches').last().locator('.swatch').count());
await p.screenshot({ path: process.argv[2] || '/tmp/color.png' });
console.log('ERRORS:', errs.length ? errs.join('\n') : 'none');
await b.close();
