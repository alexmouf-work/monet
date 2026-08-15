/** Recolour: replace with multiple targets + tolerance, tint with amount, preview and bake. */
export default async function ({ ui, shot, state, log, page }) {
  await ui.newDoc(64);

  // Three bands so replace has something specific to hit.
  await ui.tab('Brushes');
  await ui.tool('Pixel pen');
  await ui.setNumber('Size', 12);
  await ui.paletteColor(6); // #22B14C green
  await ui.drag(await ui.atDoc(4, 10), await ui.atDoc(60, 10));
  await ui.paletteColor(3); // #ED1C24 red
  await ui.drag(await ui.atDoc(4, 30), await ui.atDoc(60, 30));
  await ui.paletteColor(12); // #B97A57 brown
  await ui.drag(await ui.atDoc(4, 50), await ui.atDoc(60, 50));
  log(
    'green/red/brown px:',
    await state.countColor('#22B14C'),
    await state.countColor('#ED1C24'),
    await state.countColor('#B97A57'),
  );
  await shot('1-bands');

  await ui.tab('Recolour');
  await page.waitForTimeout(300);

  // Replace green → blue, leaving the others alone.
  await page.locator('.chiprow__hex').first().fill('#22B14C');
  await ui.setColorField('#0000FF');
  await page.waitForTimeout(400);
  log(
    'preview: green left',
    await state.countColor('#22B14C'),
    'blue now',
    await state.countColor('#0000FF'),
  );
  log('red untouched:', await state.countColor('#ED1C24'));
  await shot('2-replace-preview');

  // Add a second target so red goes too.
  await page.click('.panel .btn:has-text("Add target")');
  await page.locator('.chiprow__hex').nth(1).fill('#ED1C24');
  await page.waitForTimeout(400);
  log(
    'two targets → blue px:',
    await state.countColor('#0000FF'),
    'red left:',
    await state.countColor('#ED1C24'),
  );
  await shot('3-two-targets');

  // Preview off shows the untouched document.
  await page.locator('.panel .check:has-text("Preview") input').uncheck();
  await page.waitForTimeout(300);
  log(
    'preview off → green px:',
    await state.countColor('#22B14C'),
    'undo depth:',
    (await state.stores()).undo,
  );
  await page.locator('.panel .check:has-text("Preview") input').check();
  await page.waitForTimeout(250);

  // Bake it.
  await page.click('.panel .btn--primary');
  await page.waitForTimeout(400);
  log(
    'after bake: blue',
    await state.countColor('#0000FF'),
    'green',
    await state.countColor('#22B14C'),
    'undo',
    (await state.stores()).undo,
  );
  await shot('4-replace-baked');

  // Tint mode at 100% then 50%.
  await page.click('.panel .segmented button:has-text("Tint")');
  await page.waitForTimeout(300);
  await ui.setColorField('#3FA7D6');
  await page.waitForTimeout(400);
  await shot('5-tint-100');
  await ui.setNumber('Amount', 50);
  await page.waitForTimeout(400);
  await shot('6-tint-50');
  await ui.setNumber('Amount', 100);
  await page.click('.panel .btn--primary');
  await page.waitForTimeout(400);
  log('after tint bake, undo depth:', (await state.stores()).undo);
  const p = await state.pixelAt(32, 50);
  log('pixel in the (formerly brown) band after tint:', JSON.stringify(p));
  await shot('7-tint-baked');

  // ---- shading survives a swap (owner request 2026-08-11) ----------------------------
  // Two shades of the same green. Aim the tolerance at the lighter one and swap it for a
  // dark purple: the darker shade must become a DARKER purple, not the same purple.
  await ui.newDoc(64);
  await ui.tab('Brushes');
  await ui.tool('Pixel pen');
  await ui.setNumber('Size', 12);
  await ui.brushColor('#1F5C1F'); // dark green
  await ui.drag(await ui.atDoc(4, 16), await ui.atDoc(60, 16));
  await ui.brushColor('#0F2E0F'); // very dark green
  await ui.drag(await ui.atDoc(4, 44), await ui.atDoc(60, 44));
  const greens = [await state.countColor('#1F5C1F'), await state.countColor('#0F2E0F')];
  log('two shades of green:', JSON.stringify(greens));
  await shot('8-two-greens');

  await ui.tab('Recolour');
  await page.waitForTimeout(300);
  await page.locator('.chiprow__hex').first().fill('#1F5C1F');
  await ui.setColorField('#5C1F5C'); // dark purple
  await ui.setNumber('Tolerance', 20);
  await page.waitForTimeout(500);

  const onTarget = await state.countColor('#5C1F5C', 2);
  const darker = await state.countColor('#2E0F2E', 6);
  const stillGreen = (await state.countColor('#1F5C1F')) + (await state.countColor('#0F2E0F'));
  log('dark purple:', onTarget, '· very dark purple:', darker, '· green left:', stillGreen);
  log(
    onTarget >= greens[0] * 0.9 && darker >= greens[1] * 0.9 && stillGreen === 0
      ? '✓ the dark green became dark purple and the very dark green became VERY dark purple'
      : '✗ the shades did not carry across',
  );
  await shot('9-relative');

  // The old behaviour is still one click away.
  await page.locator('.panel .segmented button:has-text("Flatten to one")').click();
  await page.waitForTimeout(500);
  const flattened = await state.countColor('#5C1F5C', 2);
  log('flatten → pixels on the result colour:', flattened, 'of', greens[0] + greens[1]);
  log(
    flattened >= (greens[0] + greens[1]) * 0.9
      ? '✓ Flatten to one still snaps every matched pixel onto the result'
      : '✗ flatten did not flatten',
  );
  await page.locator('.panel .segmented button:has-text("Keep their differences")').click();
  await page.waitForTimeout(400);
  await page.click('.panel .btn--primary');
  await page.waitForTimeout(400);
  log('after bake — dark purple:', await state.countColor('#5C1F5C', 2));
  await shot('10-shading-baked');
}
