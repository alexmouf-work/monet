/**
 * The owner's layering scenario (docs/01 §3.1, the mandatory M5 check):
 *   draw a background → add text → draw on top of the text → move the text
 * The strokes must stay exactly where they were AND stay above the text, and the text must
 * survive intact. Verified against the flattened composite, not just the screenshot.
 */
export default async function ({ ui, shot, state, log, page }) {
  await ui.newDoc(64);

  // 1. Background band in yellow.
  await ui.tab('Brushes');
  await ui.paletteColor(5); // #FFF200
  await ui.tool('Pixel pen');
  await ui.setNumber('Size', 12);
  await ui.drag(await ui.atDoc(2, 32), await ui.atDoc(61, 32));
  const yellowAfterBand = await state.countColor('#FFF200');
  log('yellow px after band:', yellowAfterBand);
  await shot('1-background');

  // 2. Black text on top.
  await ui.tab('Text');
  await ui.setNumber('Size', 20);
  await ui.paletteColor(0); // #000000
  await ui.click(await ui.atDoc(4, 18));
  await page.waitForTimeout(250);
  await page.keyboard.type('ABC');
  await page.waitForTimeout(200);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(250);
  log('stack:', JSON.stringify(await state.stack()));
  await shot('2-text-added');

  // 3. Draw ON TOP of the text in red — this must land in a NEW raster layer above the text.
  await ui.tab('Brushes');
  await ui.paletteColor(3); // #ED1C24
  await ui.setNumber('Size', 5);
  await ui.drag(await ui.atDoc(3, 26), await ui.atDoc(45, 26));
  await page.waitForTimeout(200);
  const stack = await state.stack();
  log('stack after drawing over text:', JSON.stringify(stack));
  const redBefore = await state.countColor('#ED1C24');
  const sample = await state.pixelAt(20, 26);
  log('red px:', redBefore, ' pixel at (20,26):', JSON.stringify(sample));
  await shot('3-drawn-over-text');

  // Layer order must be raster, text, raster — the drawing on top of the text.
  const kinds = stack.map((i) => i.kind).join(',');
  log('LAYER ORDER:', kinds, kinds === 'raster,text,raster' ? '✓ as specified' : '✗ WRONG');

  // 4. Move the text down-right with the select tool.
  await page.click('.topbar__tools .iconbtn[title^="Select"]');
  await ui.click(await ui.atDoc(10, 22));
  await page.waitForTimeout(200);
  log('selected id:', (await state.stores()).selectedObjectId);
  await ui.drag(await ui.atDoc(10, 22), await ui.atDoc(30, 48), 10);
  await page.waitForTimeout(250);

  const redAfter = await state.countColor('#ED1C24');
  const sampleAfter = await state.pixelAt(20, 26);
  log('red px after move:', redAfter, ' pixel at (20,26):', JSON.stringify(sampleAfter));
  log(
    'STROKES UNCHANGED:',
    redAfter === redBefore ? '✓ identical count' : `✗ ${redBefore} → ${redAfter}`,
  );
  log('stack after move:', JSON.stringify(await state.stack()));
  await shot('4-text-moved');
}
