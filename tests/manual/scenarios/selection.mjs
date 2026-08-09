/** Selection: marquee → lift → move → anchor, delete, copy/paste, crop, flatten. */
export default async function ({ ui, shot, state, log, page }) {
  await ui.newDoc(64);

  // Paint a distinctive block to select.
  await ui.tab('Brushes');
  await ui.paletteColor(3); // red
  await ui.tool('Pixel pen');
  await ui.setNumber('Size', 10);
  await ui.drag(await ui.atDoc(8, 10), await ui.atDoc(30, 10));
  await ui.paletteColor(7); // blue
  await ui.drag(await ui.atDoc(8, 40), await ui.atDoc(50, 40));
  const redStart = await state.countColor('#ED1C24');
  log('red px:', redStart);
  await shot('1-painted');

  // Marquee round the red band, then drag it down: lift + move.
  await page.click('.topbar__tools .iconbtn[title^="Select"]');
  await ui.drag(await ui.atDoc(2, 3), await ui.atDoc(36, 18));
  await page.waitForTimeout(200);
  log('selection:', JSON.stringify((await state.stores()).selection));
  await shot('2-marquee');

  await ui.drag(await ui.atDoc(18, 10), await ui.atDoc(30, 26), 10);
  await page.waitForTimeout(250);
  log('after lift+move:', JSON.stringify((await state.stores()).selection));
  log('red px while floating:', await state.countColor('#ED1C24'));
  await shot('3-floating');

  // Anchor by pressing Escape, then confirm the pixels landed.
  await page.keyboard.press('Escape');
  await page.waitForTimeout(250);
  log('selection after Esc:', JSON.stringify((await state.stores()).selection));
  log('red px after anchor:', await state.countColor('#ED1C24'));
  log('stack:', JSON.stringify(await state.stack()));
  await shot('4-anchored');

  // Copy the blue band and paste it — the paste arrives as a new float.
  await ui.drag(await ui.atDoc(2, 34), await ui.atDoc(56, 46));
  await page.waitForTimeout(150);
  await page.keyboard.press('Control+c');
  await page.waitForTimeout(400);
  await page.keyboard.press('Control+v');
  await page.waitForTimeout(1200);
  log('selection after paste:', JSON.stringify((await state.stores()).selection));
  log('toasts:', JSON.stringify(await page.locator('.toast').allInnerTexts()));
  await shot('5-pasted');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);

  // Select all then delete: every raster layer must clear.
  await page.keyboard.press('Control+a');
  await page.waitForTimeout(150);
  log('select-all rect:', JSON.stringify((await state.stores()).selection));

  // Crop instead of deleting, so there is something left to look at.
  await ui.drag(await ui.atDoc(10, 10), await ui.atDoc(45, 45));
  await page.waitForTimeout(150);
  await page.keyboard.press('Control+Shift+X');
  await page.waitForTimeout(400);
  log('doc after crop:', JSON.stringify(await state.doc()));
  await shot('6-cropped');

  // Flatten: a shape plus the raster must collapse to one raster layer.
  await ui.tab('Shapes');
  await page.locator('.shapegrid__btn[title="Circle"]').click();
  await ui.drag(await ui.atDoc(4, 4), await ui.atDoc(20, 20));
  await page.waitForTimeout(200);
  log('stack before flatten:', JSON.stringify(await state.stack()));
  await page.keyboard.press('Control+Shift+F');
  await page.waitForTimeout(400);
  log('stack after flatten:', JSON.stringify(await state.stack()));
  await shot('7-flattened');
}
