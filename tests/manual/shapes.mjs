/** Manual check: create several shapes, rotate one, transform another, verify chrome + undo. */
import { chromium } from '@playwright/test';
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH });
const p = await b.newPage({ viewport: { width: 1280, height: 800 } });
const errs = [];
p.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message));
await p.goto('http://127.0.0.1:4319/', { waitUntil: 'networkidle' });

// A 64×64 canvas gives shapes room to breathe.
await p.click('.empty .btn--primary');
await p.locator('.dialog .chipbtn:has-text("64")').click();
await p.click('.dialog__actions .btn--primary');
await p.waitForTimeout(400);

const box = await p.locator('.workspace__canvas').boundingBox();
const at = (fx, fy) => ({ x: box.x + box.width * fx, y: box.y + box.height * fy });
const drag = async (a, b2, steps = 8) => {
  await p.mouse.move(a.x, a.y);
  await p.mouse.down();
  await p.mouse.move(b2.x, b2.y, { steps });
  await p.mouse.up();
  await p.waitForTimeout(150);
};

await p.click('.tab:has-text("Shapes")');
await p.waitForTimeout(200);

// Hexagon, then a pentagon stretched wide (uniform outline check), then an arrow.
await p.locator('.shapegrid__btn[title="Hexagon"]').click();
await drag(at(0.08, 0.08), at(0.32, 0.34));
await p.locator('.shapegrid__btn[title="Pentagon"]').click();
await drag(at(0.4, 0.08), at(0.92, 0.3));
await p.locator('.shapegrid__btn[title="Arrow"]').click();
await drag(at(0.08, 0.45), at(0.55, 0.62));
await p.locator('.shapegrid__btn[title="Circle"]').click();
await drag(at(0.62, 0.42), at(0.8, 0.72)); // circle must come out square
await p.waitForTimeout(200);

// Spline: click four points then Enter.
await p.locator('.shapegrid__btn[title="Spline"]').click();
for (const [fx, fy] of [[0.1, 0.9], [0.3, 0.74], [0.55, 0.94], [0.8, 0.78]]) {
  await p.mouse.click(at(fx, fy).x, at(fx, fy).y);
  await p.waitForTimeout(80);
}
await p.keyboard.press('Enter');
await p.waitForTimeout(250);
await p.screenshot({ path: (process.argv[2] || '/tmp/shapes.png').replace('.png', '-created.png') });

// Rotate the selected spline via the numeric field, then check the panel reports it.
const rotNum = p.locator('.panel .slider:has-text("Rotation") input[type="number"]');
await rotNum.fill('30');
await rotNum.blur();
await p.waitForTimeout(250);
console.log('ROTATION FIELD:', await rotNum.inputValue());

// Select the circle and confirm W == H (circle constraint), then scale it with a handle.
await p.click('.topbar__tools .iconbtn[title^="Select"]');
await p.mouse.click(at(0.71, 0.57).x, at(0.71, 0.57).y);
await p.waitForTimeout(250);
const wNum = p.locator('.panel .field-row label:has-text("W") input');
const hNum = p.locator('.panel .field-row label:has-text("H") input');
console.log('CIRCLE W/H:', await wNum.inputValue(), await hNum.inputValue());
console.log('SELECTED:', await p.locator('.panel__hint:has-text("Selected")').innerText().catch(() => 'none'));

await p.screenshot({ path: process.argv[2] || '/tmp/shapes.png' });

// Undo everything: each shape (+ the rotate) should peel off one at a time.
for (let i = 0; i < 8; i++) {
  await p.keyboard.press('Control+z');
  await p.waitForTimeout(90);
}
await p.screenshot({ path: (process.argv[2] || '/tmp/shapes.png').replace('.png', '-undone.png') });
console.log('ERRORS:', errs.length ? errs.join('\n') : 'none');
await b.close();
