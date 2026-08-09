/** Canvas ops: background memory, resize (px/%/lock/scale), rotate/flip alignment, tiling. */
export default async function ({ ui, shot, state, log, page }) {
  await ui.newDoc(32);

  // Something asymmetric, so rotations and flips are obvious.
  await ui.tab('Brushes');
  await ui.paletteColor(3);
  await ui.setNumber('Size', 6);
  await ui.drag(await ui.atDoc(3, 3), await ui.atDoc(28, 3));
  await ui.paletteColor(7);
  await ui.drag(await ui.atDoc(3, 3), await ui.atDoc(3, 20));
  await shot('1-painted');

  // Background: colour → transparent → colour must remember the colour.
  await ui.tab('Canvas');
  await page.locator('.panel .segmented button:has-text("Colour")').click();
  await page.waitForTimeout(150);
  const first = (await state.doc()).background;
  log('bg after Colour:', JSON.stringify(first));
  await ui.setColorField('#204060');
  log('bg after picking:', JSON.stringify((await state.doc()).background));
  await shot('2-bg-colour');
  await page.locator('.panel .segmented button:has-text("Transparent")').click();
  await page.waitForTimeout(150);
  log('bg transparent (colour retained?):', JSON.stringify((await state.doc()).background));
  await page.locator('.panel .segmented button:has-text("Colour")').click();
  await page.waitForTimeout(150);
  log('bg back to colour:', JSON.stringify((await state.doc()).background));

  // Rotate CW then ACW must return the exact document.
  const before = await state.countColor('#ED1C24');
  await page.locator('.panel .iconbtn[title="Rotate 90° clockwise"]').click();
  await page.waitForTimeout(350);
  log('after CW:', JSON.stringify(await state.doc()));
  await shot('3-rotated-cw');
  await page.locator('.panel .iconbtn[title="Rotate 90° anticlockwise"]').click();
  await page.waitForTimeout(350);
  log(
    'after ACW:',
    JSON.stringify(await state.doc()),
    'red px:',
    await state.countColor('#ED1C24'),
    '(was',
    before + ')',
  );

  await page.locator('.panel .iconbtn[title="Flip horizontally"]').click();
  await page.waitForTimeout(300);
  await shot('4-flipped');

  // Resize 32 → 64 with nearest: every pixel should double.
  await page.locator('.panel .btn:has-text("Resize canvas")').click();
  await page.waitForTimeout(250);
  await page.locator('.dialog label:has-text("Width") input').fill('64');
  await page.waitForTimeout(150);
  log('dialog preview:', await page.locator('.dialog .panel__hint').first().innerText());
  await page.click('.dialog__actions .btn--primary');
  await page.waitForTimeout(500);
  log(
    'after resize:',
    JSON.stringify(await state.doc()),
    'red px:',
    await state.countColor('#ED1C24'),
  );
  await shot('5-resized');

  // Tiling preview.
  await page.keyboard.press('Control+t');
  await page.waitForTimeout(400);
  log('tiling:', (await state.stores()).tiling);
  await shot('6-tiling');
  await page.keyboard.press('Control+t');
  await page.waitForTimeout(200);
}
