/**
 * The pixel under the cursor is the pixel that gets painted (owner report 2026-08-11: a click
 * landed one right and one below whenever the cursor sat past a pixel's midpoint).
 *
 * Every other scenario aims at pixel CENTRES (ui.atDoc adds 0.5), which is exactly where the
 * old rounding still gave the right answer — so this one deliberately clicks the corners and
 * edges of a pixel, where the bug lived.
 */
export default async function ({ ui, page, shot, state, log }) {
  await ui.newDoc(16);
  await ui.tab('Brushes');
  await ui.tool('Pixel pen');
  await ui.setNumber('Size', 1);
  await ui.paletteColor(0); // black

  const box = await ui.canvasBox();
  const view = async () => (await state.stores()).view;
  const v = await view();
  log(`zoom ${v.zoom}, pan ${v.panX},${v.panY}`);

  /** Screen point at fraction (fx, fy) INSIDE doc pixel (px, py). */
  const pointIn = (px, py, fx, fy) => ({
    x: box.x + v.panX + (px + fx) * v.zoom,
    y: box.y + v.panY + (py + fy) * v.zoom,
  });

  /** Every painted (dark) pixel in the document. */
  const painted = () =>
    page.evaluate(() => {
      const d = window.__monet.doc();
      const out = [];
      for (let y = 0; y < d.height; y++)
        for (let x = 0; x < d.width; x++) {
          const p = window.__monet.pixelAt(x, y);
          if (p && p[3] > 128 && p[0] < 40 && p[1] < 40 && p[2] < 40) out.push([x, y]);
        }
      return out;
    });

  // ---- clicks anywhere inside a pixel paint THAT pixel ------------------------------
  const cases = [
    { px: 4, py: 4, fx: 0.5, fy: 0.5, where: 'centre' },
    { px: 7, py: 3, fx: 0.9, fy: 0.9, where: 'bottom-right corner' },
    { px: 2, py: 9, fx: 0.1, fy: 0.9, where: 'bottom-left corner' },
    { px: 11, py: 6, fx: 0.6, fy: 0.55, where: 'just past the midpoint' },
  ];
  const wrong = [];
  for (const c of cases) {
    // One click at a time, undone after: `painted()` returns scan order, so with several
    // pixels down "the last one" is the bottom-most, not the newest.
    await ui.click(pointIn(c.px, c.py, c.fx, c.fy));
    await page.waitForTimeout(150);
    const hits = await painted();
    const ok = hits.length === 1 && hits[0][0] === c.px && hits[0][1] === c.py;
    if (!ok) wrong.push(`${c.where} → ${JSON.stringify(hits)}`);
    log(
      `click at the ${c.where} of (${c.px},${c.py}) → painted ${JSON.stringify(hits)}`,
      ok ? '✓' : '✗',
    );
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(150);
  }
  log(
    wrong.length === 0
      ? '✓ every click painted the pixel under the cursor'
      : `✗ still offset: ${wrong.join('; ')}`,
  );
  await shot('1-clicks');

  // ---- a drag paints from the pixel it starts on to the pixel it ends on ------------
  log('canvas is clear again:', (await painted()).length, 'painted px');

  await ui.drag(pointIn(3, 12, 0.8, 0.8), pointIn(12, 12, 0.8, 0.8));
  await page.waitForTimeout(250);
  const line = await painted();
  const xs = line.map((h) => h[0]).sort((a, b) => a - b);
  const rows = [...new Set(line.map((h) => h[1]))];
  log(
    `drag painted ${line.length} px, x ${xs[0]}..${xs[xs.length - 1]}, rows ${JSON.stringify(rows)}`,
  );
  log(
    xs[0] === 3 && xs[xs.length - 1] === 12 && rows.length === 1 && rows[0] === 12
      ? '✓ the drag runs from the pixel it started on to the pixel it ended on, one row'
      : '✗ drag endpoints are offset',
  );
  await shot('2-drag');

  // ---- the status bar and the paint agree ------------------------------------------
  const probe = pointIn(9, 2, 0.85, 0.85);
  await page.mouse.move(probe.x, probe.y);
  await page.waitForTimeout(200);
  const readout = await page.locator('.statusbar__coords').innerText();
  await ui.click(probe);
  await page.waitForTimeout(200);
  const last = (await painted()).filter((h) => h[1] === 2);
  log(`status bar says ${JSON.stringify(readout)}; paint landed at ${JSON.stringify(last)}`);
  log(
    readout.trim() === '9, 2' && last.length === 1 && last[0][0] === 9
      ? '✓ the status bar and the brush name the same pixel'
      : '✗ readout and paint disagree',
  );
  await shot('3-readout');
}
