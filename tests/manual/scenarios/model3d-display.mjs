/**
 * M19a acceptance — docs/11 §16's second clause: the `gui` display preview matches what
 * Minecraft would draw. Verified geometrically rather than by eye: with the camera in a known
 * ortho view, previewing `gui` must scale the model by vanilla's 0.625 about the block centre
 * and spin it 30°/225°, so the model's on-screen extent shrinks by that factor and the
 * projected corners move to where the slot matrix says. Editing a slot is undoable and lands
 * in the saved JSON.
 */
export function beforeLoad() {
  delete window.showOpenFilePicker;
  delete window.showSaveFilePicker;
  delete window.showDirectoryPicker;
}

export default async function ({ page, shot, log }) {
  const model = () => page.evaluate(() => window.__monet.model());
  // Opaque-pixel count of a clean render = the model's on-screen area, which is what a scale
  // preview must change.
  const area = () =>
    page.evaluate(() => {
      const f = window.__monet.modelFrame();
      if (!f) return 0;
      let n = 0;
      for (let i = 3; i < f.pixels.length; i += 4) if (f.pixels[i] > 200) n++;
      return n;
    });

  await page.click('.topbar__menu');
  await page.click('text=New model (3D)');
  await page.waitForTimeout(600);
  await page.keyboard.press('Digit1'); // front ortho — flat, easy to measure
  await page.waitForTimeout(300);

  const slot = (label) => page.locator('.segmented button', { hasText: label }).last();
  const preview = () => page.locator('button', { hasText: 'Preview' }).first();

  const plain = await area();
  log('area with no preview:', plain);

  // ---- preview gui: vanilla's default is scale 0.625 + rotation 30/225 --------------
  await slot('GUI').click();
  await page.waitForTimeout(200);
  await preview().click();
  await page.waitForTimeout(400);
  const previewed = await area();
  const ratio = previewed / plain;
  log(`area while previewing gui: ${previewed} (ratio ${ratio.toFixed(3)})`);
  // 0.625 scale shrinks a projected area by ~0.39; the 30°/225° spin shows three faces of the
  // cube instead of one, so the bound is a range rather than an exact number.
  log(
    ratio > 0.25 && ratio < 0.75
      ? '✓ the gui preview applies vanilla’s 0.625 scale (area shrank by the right order)'
      : `✗ preview did not transform the model (ratio ${ratio.toFixed(3)})`,
  );
  await shot('1-gui-preview');

  // The transform is the SLOT matrix, checked against the maths rather than eyeballed. `fixed`
  // (item frames) is vanilla's pure-scale slot — 0.5 about the centre — so the far corner has
  // one predictable answer: 16 → 12. (gui also spins 30°/225°, which is not a round number.)
  await slot('Frame').click();
  await page.waitForTimeout(300);
  const corner = await page.evaluate(() => window.__monet.displayPreviewPoint(16, 16, 16));
  log('fixed-slot corner (16,16,16) →', JSON.stringify(corner));
  log(
    corner && Math.abs(corner.x - 12) < 0.001 && Math.abs(corner.y - 12) < 0.001
      ? '✓ the preview matrix is vanilla’s slot transform, scaled about the block centre'
      : '✗ the preview matrix is wrong',
  );
  await slot('GUI').click();
  await page.waitForTimeout(300);

  // ---- editing is paused while previewing (pick geometry no longer matches) ---------
  const box = await page.locator('.workspace--model .workspace__canvas').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(300);
  const hover = (await model()).hover;
  log('hover while previewing:', JSON.stringify(hover));
  log(hover === null ? '✓ picking stands down during a preview' : '✗ stale hover reported');

  await preview().click(); // back to editing
  await page.waitForTimeout(400);
  const restored = await area();
  log(
    Math.abs(restored - plain) < plain * 0.02
      ? '✓ turning the preview off restores the untransformed model'
      : `✗ viewport not restored (${restored} vs ${plain})`,
  );

  // ---- edit a slot: undoable, and it reaches the saved JSON --------------------------
  await slot('Head').click();
  await page.waitForTimeout(200);
  const rotate = page.locator('.field-row', { hasText: 'Rotate' }).first();
  const ry = rotate.locator('.numfield input').nth(1);
  await ry.fill('45');
  await ry.press('Enter');
  await page.waitForTimeout(250);
  const afterEdit = (await model()).display;
  log('display after editing head:', JSON.stringify(afterEdit));
  await page.click('.panel__title');
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(250);
  const afterUndo = (await model()).display;
  log('after undo:', JSON.stringify(afterUndo));
  log(
    afterEdit?.head?.rotation?.y === 45 && !afterUndo?.head
      ? '✓ a slot edit is one undoable command'
      : '✗ slot edit/undo wrong',
  );
  await page.keyboard.press('Control+y');
  await page.waitForTimeout(250);

  const [dl] = await Promise.all([page.waitForEvent('download'), page.keyboard.press('Control+s')]);
  const { readFileSync } = await import('node:fs');
  const saved = JSON.parse(readFileSync(await dl.path(), 'utf8'));
  log('saved display:', JSON.stringify(saved.display));
  log(
    saved.display?.head?.rotation?.[1] === 45
      ? '✓ the slot is written into the model JSON Minecraft reads'
      : '✗ display not saved',
  );
  await shot('2-slot-edited');
}
