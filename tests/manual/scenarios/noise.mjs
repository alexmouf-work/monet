/** Noise: live preview, every type renders, rotation/scale/intensity, bake + undo. */
export default async function ({ ui, shot, state, log, page }) {
  await ui.newDoc(64);

  // A flat mid-grey base so brightness noise is obvious.
  await ui.tab('Brushes');
  await ui.paletteColor(11); // #C3C3C3
  await ui.tool('Paint bucket');
  await ui.setNumber('Tolerance', 100);
  await ui.click(await ui.atDoc(32, 32));
  await page.waitForTimeout(200);
  const flat = await state.countColor('#C3C3C3');
  log('flat grey px:', flat);
  await shot('1-base');

  await ui.tab('Noise');
  await page.waitForTimeout(400);
  log('preview active (grey px should drop):', await state.countColor('#C3C3C3'));
  await shot('2-perlin-preview');

  // Undo stack must be untouched by previewing.
  log('undo depth while previewing:', (await state.stores()).undo);

  // Walk a few types to prove they are visibly different.
  for (const type of ['clouds', 'cells', 'stripes', 'zigzag', 'radial', 'gradient', 'white']) {
    await page.selectOption('.panel select', type);
    await page.waitForTimeout(250);
    log(type, 'grey px left:', await state.countColor('#C3C3C3'));
    await shot(`3-${type}`);
  }

  // Rotate + scale a stripe pattern.
  await page.selectOption('.panel select', 'stripes');
  await ui.setNumber('Rotation', 45);
  await page.waitForTimeout(250);
  await shot('4-stripes-rot45');

  // Bake, then check the undo stack grew and the document really changed.
  await page.selectOption('.panel select', 'clouds');
  await ui.setNumber('Intensity', 80);
  await page.waitForTimeout(250);
  const beforeBake = (await state.stores()).undo;
  await page.click('.panel .btn--primary');
  await page.waitForTimeout(400);
  log('undo depth before/after bake:', beforeBake, (await state.stores()).undo);
  log('grey px after bake:', await state.countColor('#C3C3C3'));
  await shot('5-baked');

  // Turn the preview off so the composite shows the real document, not the next preview.
  await page.locator('.panel .check:has-text("Preview") input').uncheck();
  await page.waitForTimeout(300);
  log('grey px with preview off (baked):', await state.countColor('#C3C3C3'));
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(500);
  log('grey px after undo:', await state.countColor('#C3C3C3'), '(flat was', flat + ')');
  await shot('6-undone');
}
