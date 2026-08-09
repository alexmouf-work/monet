/** Default scenario: a tour of everything built so far, one shot per area. */
export default async function ({ ui, shot, state, log, page }) {
  await shot('empty');

  await ui.newDoc(64);
  log('doc:', JSON.stringify(await state.doc()));
  await shot('new-doc');

  // Brushes: pen, marker with alpha, bucket, eraser.
  await ui.tab('Brushes');
  await ui.paletteColor(3);
  await ui.tool('Pixel pen');
  await ui.setNumber('Size', 3);
  await ui.drag(await ui.atDoc(4, 4), await ui.atDoc(58, 20));

  await ui.tool('Marker');
  await ui.paletteColor(7);
  await ui.setNumber('Size', 10);
  await ui.drag(await ui.atDoc(6, 40), await ui.atDoc(56, 46));

  await ui.tool('Paint bucket');
  await ui.paletteColor(15);
  await ui.setNumber('Tolerance', 5);
  await ui.click(await ui.atDoc(58, 60));
  await shot('brushes');

  await ui.tool('Eraser');
  await ui.setNumber('Size', 8);
  await ui.drag(await ui.atDoc(30, 2), await ui.atDoc(30, 30));
  await shot('eraser');

  // Shapes.
  await ui.tab('Shapes');
  await page.locator('.shapegrid__btn[title="Hexagon"]').click();
  await ui.drag(await ui.atDoc(6, 6), await ui.atDoc(26, 26));
  await page.locator('.shapegrid__btn[title="Arrow"]').click();
  await ui.drag(await ui.atDoc(30, 34), await ui.atDoc(60, 50));
  await shot('shapes');

  // Text.
  await ui.tab('Text');
  await ui.setNumber('Size', 14);
  await ui.paletteColor(0);
  await ui.click(await ui.atDoc(4, 52));
  await page.waitForTimeout(200);
  await page.keyboard.type('Hi');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(250);
  await shot('text');

  log('stack:', JSON.stringify(await state.stack()));
  log('stores:', JSON.stringify(await state.stores()));

  // View: zoom out with the wheel, toggle the grid, then fit.
  const c = await ui.canvasBox();
  await page.mouse.move(c.x + c.width / 2, c.y + c.height / 2);
  await page.mouse.wheel(0, 240);
  await page.waitForTimeout(200);
  log('view after wheel down:', JSON.stringify((await state.stores()).view));
  await page.keyboard.press('Control+0');
  await page.waitForTimeout(200);
  await shot('view');

  // Undo everything.
  for (let i = 0; i < 12; i++) await page.keyboard.press('Control+z');
  await page.waitForTimeout(300);
  log('stack after undo-all:', JSON.stringify(await state.stack()));
  await shot('undone');
}
