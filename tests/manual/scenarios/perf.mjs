/**
 * Frame-cost measurements for the interactions that felt laggy. Numbers come from
 * `window.__monet.perf()` (the renderer's own timing), not from wall clock, so they are not
 * polluted by Playwright's input pacing. Absolute values depend on the machine — this sandbox
 * runs software GL — so read them as before/after comparisons, not as a spec.
 */
const CANVAS = '.workspace:not(.workspace--model) .workspace__canvas';

async function measure(label, state, log, run) {
  await state.resetPerf();
  const t0 = Date.now();
  await run();
  const wall = Date.now() - t0;
  const p = await state.perf();
  log(
    `${label.padEnd(26)} frames ${String(p.frames).padStart(4)} · avg ${String(p.avgMs).padStart(6)}ms` +
      ` · max ${String(p.maxMs).padStart(7)}ms · composites ${String(p.composites).padStart(4)} · wall ${wall}ms`,
  );
  return p;
}

/**
 * Synchronous cost of N pointermove handlers, dispatched in-page. Playwright's own mouse is
 * paced far slower than a real 500–1000 Hz mouse, so driving it cannot show handler cost;
 * dispatching in a tight loop can, and that loop is what a fast mouse actually produces.
 */
async function handlerCost(label, page, log, n = 300) {
  const ms = await page.evaluate((count) => {
    const el = document.querySelector('.workspace:not(.workspace--model) .workspace__canvas');
    const b = el.getBoundingClientRect();
    const t0 = performance.now();
    for (let i = 0; i < count; i++) {
      el.dispatchEvent(
        new PointerEvent('pointermove', {
          clientX: b.left + 20 + (i % 200),
          clientY: b.top + 20 + ((i * 3) % 150),
          buttons: 1,
          bubbles: true,
          pointerId: 1,
          isPrimary: true,
        }),
      );
    }
    return performance.now() - t0;
  }, n);
  log(`${label.padEnd(26)} ${n} moves in ${ms.toFixed(1)}ms · ${(ms / n).toFixed(3)}ms per event`);
  return ms;
}

export default async function ({ page, ui, state, log, shot }) {
  // A texture-sheet-sized document: big enough that per-frame recompositing shows up.
  await ui.newDoc(256);
  await ui.tab('Brushes');
  await ui.paletteColor(3);
  await ui.setNumber('Size', 6);

  const a = await ui.atDoc(20, 20);
  const b = await ui.atDoc(230, 200);

  await measure('brush stroke (60 steps)', state, log, async () => {
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 60 });
    await page.mouse.up();
    await page.waitForTimeout(120);
  });

  // Same again, but measuring the handlers rather than the frames: a long stroke used to get
  // slower the more of the canvas it had covered.
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await handlerCost('stroke handlers', page, log);
  await handlerCost('stroke handlers (again)', page, log);
  await page.mouse.up();
  await page.waitForTimeout(150);
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(150);

  await measure('wheel zoom (24 notches)', state, log, async () => {
    await page.mouse.move(a.x + 40, a.y + 40);
    for (let i = 0; i < 24; i++) await page.mouse.wheel(0, i % 2 ? 120 : -120);
    await page.waitForTimeout(150);
  });

  await measure('pan drag (40 steps)', state, log, async () => {
    await page.keyboard.down('Space');
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(a.x + 120, a.y + 90, { steps: 40 });
    await page.mouse.up();
    await page.keyboard.up('Space');
    await page.waitForTimeout(120);
  });

  await page.keyboard.press('Control+0');
  await page.waitForTimeout(200);

  // Shapes in crisp mode are the worst case: a thresholded pass per colour, per frame.
  await ui.tab('Shapes');
  const c = await ui.atDoc(40, 40);
  const d = await ui.atDoc(200, 170);
  await ui.drag(c, d, 10);
  await page.waitForTimeout(150);
  log('stack after shape:', JSON.stringify(await state.stack()));

  await page.click('.topbar__tools .iconbtn[title^="Select"]');
  await page.waitForTimeout(100);
  await measure('drag a crisp shape', state, log, async () => {
    const mid = await ui.atDoc(120, 105);
    await page.mouse.move(mid.x, mid.y);
    await page.mouse.down();
    await page.mouse.move(mid.x + 60, mid.y + 40, { steps: 40 });
    await page.mouse.up();
    await page.waitForTimeout(120);
  });

  await ui.tab('Brushes');
  await ui.tool('Eyedropper');
  await measure('eyedropper drag (40)', state, log, async () => {
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 40 });
    await page.mouse.up();
    await page.waitForTimeout(120);
  });
  // Sampling while dragging used to recomposite the whole stack per event.
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await handlerCost('eyedropper handlers', page, log);
  await page.mouse.up();
  await page.waitForTimeout(120);

  // The wheel handler must be able to cancel the page's own scroll, or the workspace
  // scrolls under the cursor while zooming.
  // Read defaultPrevented off the event *after* dispatch: the handler may sit on an ancestor
  // (React delegates to the root), so a probe listener on the canvas itself runs too early.
  const prevented = await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    const evt = new WheelEvent('wheel', { deltaY: 120, bubbles: true, cancelable: true });
    el.dispatchEvent(evt);
    return evt.defaultPrevented;
  }, CANVAS);
  log('wheel preventDefault applied:', prevented, prevented ? '✓' : '✗ page scrolls too');

  await page.keyboard.press('Control+0');
  await page.waitForTimeout(200);
  await shot('perf-final');
}
