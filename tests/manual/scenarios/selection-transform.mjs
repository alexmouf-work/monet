/**
 * Rotating and flipping a live selection — docs/06 §4.1 (owner request 2026-08-11): the wheel
 * turns it, `F` mirrors it, both while it is still selected and before anything is committed.
 *
 * The shape painted is deliberately asymmetric in BOTH axes (an L), so a flip is provable from
 * where the pixels end up rather than merely from the bounding box changing size.
 */

/** Bounding box of everything opaque in the raster layers — the float is not in there. */
const layerBounds = (page) => page.evaluate(() => window.__monet.layerBounds());

const selection = (page) => page.evaluate(() => window.__monet.stores().selection);

/** The float's own pixels, as a coarse occupancy grid, so a mirror is visible in the data. */
const floatGrid = (page) =>
  page.evaluate(() => {
    const f = window.__monet.floatPixels();
    if (!f) return null;
    const rows = [];
    for (let y = 0; y < f.h; y++) {
      let row = '';
      for (let x = 0; x < f.w; x++) row += f.pixels[(y * f.w + x) * 4 + 3] > 128 ? '#' : '.';
      rows.push(row);
    }
    return { w: f.w, h: f.h, rows };
  });

export default async function ({ page, ui, shot, state, log }) {
  await ui.newDoc(32);
  await ui.tab('Brushes');
  await ui.tool('Pixel pen');
  await ui.setNumber('Size', 4);
  await ui.paletteColor(3); // red

  // An L: a tall stroke down the left and a short foot along the bottom.
  await ui.drag(await ui.atDoc(8, 6), await ui.atDoc(8, 20));
  await ui.drag(await ui.atDoc(8, 20), await ui.atDoc(18, 20));
  const painted = await layerBounds(page);
  log('painted L:', JSON.stringify(painted));
  await shot('1-painted');

  // Marquee it, then lift by nudging — the transform actions lift a plain marquee themselves,
  // which is what the next step proves.
  await page.click('.topbar__tools .iconbtn[title^="Select"]');
  await ui.drag(await ui.atDoc(4, 2), await ui.atDoc(24, 26));
  await page.waitForTimeout(250);
  log('marquee (not yet lifted):', JSON.stringify(await selection(page)));

  // ---- wheel rotates -----------------------------------------------------------------
  const canvas = await page.locator('.workspace:not(.workspace--model) .workspace__canvas');
  const box = await canvas.boundingBox();
  const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(centre.x, centre.y);
  await page.mouse.wheel(0, 120); // one notch down = +15° clockwise
  await page.waitForTimeout(300);

  const afterOne = await selection(page);
  const zoomAfter = (await state.stores()).view?.zoom;
  log('after one notch:', JSON.stringify(afterOne), '· zoom:', zoomAfter);
  log(
    afterOne?.floating
      ? '✓ the wheel lifted the marquee and turned it instead of zooming'
      : '✗ the wheel did not rotate the selection',
  );

  // Wind back to 0° and take the lifted size as the baseline for everything below.
  await page.mouse.wheel(0, -120);
  await page.waitForTimeout(300);
  const lifted = await floatGrid(page);
  log('lifted float:', lifted.w, '×', lifted.h);

  // Six notches = 90°, which must be the exact transpose: the box swaps sides.
  for (let i = 0; i < 6; i++) await page.mouse.wheel(0, 120);
  await page.waitForTimeout(400);
  const at90 = await selection(page);
  const grid90 = await floatGrid(page);
  log('at 90°:', JSON.stringify(at90?.rect), '· float', grid90.w, '×', grid90.h);
  log(
    grid90.w === lifted.h && grid90.h === lifted.w
      ? '✓ six notches make exactly 90° and the selection box transposes'
      : `✗ expected ${lifted.h}×${lifted.w} at 90°, got ${grid90.w}×${grid90.h}`,
  );
  await shot('2-rotated-90');

  // Back to square one: six notches the other way must restore the original exactly.
  for (let i = 0; i < 6; i++) await page.mouse.wheel(0, -120);
  await page.waitForTimeout(400);
  const back = await floatGrid(page);
  log('after winding back:', back.w, '×', back.h);
  log(
    back.w === lifted.w &&
      back.h === lifted.h &&
      JSON.stringify(back.rows) === JSON.stringify(lifted.rows)
      ? '✓ rotating back returns the original pixels — angles accumulate, resampling does not'
      : `✗ ${back.w}×${back.h} after a round trip`,
  );

  // An off-axis angle must grow the box without losing the art.
  await page.mouse.wheel(0, 120);
  await page.mouse.wheel(0, 120);
  await page.mouse.wheel(0, 120); // 45°
  await page.waitForTimeout(400);
  const at45 = await floatGrid(page);
  const solid45 = at45.rows.join('').split('#').length - 1;
  log('at 45°:', at45.w, '×', at45.h, '· opaque texels:', solid45);
  log(
    at45.w > lifted.w && at45.h > lifted.h && solid45 > 0
      ? '✓ an off-axis angle grows the bounding box and keeps the art'
      : '✗ the 45° rotation lost the shape',
  );
  await shot('3-rotated-45');

  // Wind back to 0 so the flip checks read a clean shape.
  for (let i = 0; i < 3; i++) await page.mouse.wheel(0, -120);
  await page.waitForTimeout(400);

  // ---- F flips -----------------------------------------------------------------------
  const before = await floatGrid(page);
  await page.keyboard.press('KeyF');
  await page.waitForTimeout(400);
  const flippedY = await floatGrid(page);
  /** Which rows carry any art — an L is asymmetric, so a mirror moves this window. */
  const band = (g) => {
    const on = g.rows.map((r, i) => (r.includes('#') ? i : -1)).filter((i) => i >= 0);
    return `rows ${on[0]}–${on[on.length - 1]} of ${g.rows.length}, widest ${Math.max(
      ...g.rows.map((r) => r.split('#').length - 1),
    )}`;
  };
  log(
    'before F:',
    band(before),
    '· first inked row:',
    before.rows.find((r) => r.includes('#')),
  );
  log(
    'after  F:',
    band(flippedY),
    '· first inked row:',
    flippedY.rows.find((r) => r.includes('#')),
  );
  log(
    JSON.stringify(flippedY.rows) === JSON.stringify([...before.rows].reverse())
      ? '✓ F mirrors across the horizontal axis — top and bottom swap'
      : '✗ F did not flip top-to-bottom',
  );
  // …and the tool did NOT change: F still means bucket only when nothing is selected.
  log('tool after F:', (await state.stores()).tool);
  log(
    (await state.stores()).tool === 'select'
      ? '✓ F was claimed by the selection, not by the bucket'
      : '✗ F selected the bucket while a selection was live',
  );
  await shot('4-flipped');

  await page.keyboard.press('KeyF'); // flip back
  await page.waitForTimeout(300);
  const unflipped = await floatGrid(page);
  log(
    JSON.stringify(unflipped.rows) === JSON.stringify(before.rows)
      ? '✓ F again puts it back'
      : '✗ the flip does not undo itself',
  );

  await page.keyboard.press('Shift+KeyF');
  await page.waitForTimeout(400);
  const flippedX = await floatGrid(page);
  log(
    JSON.stringify(flippedX.rows) ===
      JSON.stringify(before.rows.map((r) => [...r].reverse().join('')))
      ? '✓ Shift+F mirrors the other way — left and right swap'
      : '✗ Shift+F did not flip left-to-right',
  );
  await shot('5-flipped-x');

  // ---- it all lands when anchored ----------------------------------------------------
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  const anchored = await layerBounds(page);
  log('anchored bounds:', JSON.stringify(anchored), 'vs painted', JSON.stringify(painted));
  log(
    anchored && anchored.w > 0 && (await selection(page)) === null
      ? '✓ the transformed pixels anchored into the layer'
      : '✗ nothing landed',
  );
  await shot('6-anchored');

  // With no selection the wheel is the zoom again.
  const zoomBefore = (await state.stores()).view.zoom;
  await page.mouse.move(centre.x, centre.y);
  await page.mouse.wheel(0, -120);
  await page.waitForTimeout(300);
  const zoomNow = (await state.stores()).view.zoom;
  log('zoom', zoomBefore, '→', zoomNow);
  log(
    zoomNow > zoomBefore
      ? '✓ with nothing selected the wheel zooms as it always did'
      : '✗ the wheel stopped zooming',
  );
}
