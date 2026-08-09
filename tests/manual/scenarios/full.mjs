/** Whole-app pass: every feature tab, exports, and a final look at the finished UI. */
export default async function ({ ui, shot, state, log, page }) {
  await ui.newDoc(64);

  // Paint a small scene: bucket base, pen detail, marker shading.
  await ui.tab('Brushes');
  await ui.paletteColor(12); // brown
  await ui.tool('Paint bucket');
  await ui.setNumber('Tolerance', 100);
  await ui.click(await ui.atDoc(32, 32));
  await ui.tool('Marker');
  await ui.paletteColor(0);
  await ui.setNumber('Size', 14);
  await ui.drag(await ui.atDoc(6, 54), await ui.atDoc(58, 58));
  await ui.tool('Pixel pen');
  await ui.paletteColor(15);
  await ui.setNumber('Size', 2);
  await ui.drag(await ui.atDoc(4, 12), await ui.atDoc(60, 12));

  // Noise for texture.
  await ui.tab('Noise');
  await page.selectOption('.panel select', 'clouds');
  await ui.setNumber('Intensity', 45);
  await page.waitForTimeout(300);
  await page.click('.panel .btn--primary');
  await page.waitForTimeout(300);

  // A shape and some text on top.
  await ui.tab('Shapes');
  await page.locator('.shapegrid__btn[title="Hexagon"]').click();
  await ui.drag(await ui.atDoc(36, 20), await ui.atDoc(58, 42));
  await ui.tab('Text');
  await ui.setNumber('Size', 12);
  await ui.paletteColor(10); // white
  await ui.click(await ui.atDoc(4, 28));
  await page.waitForTimeout(250);
  await page.keyboard.type('ORE');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);

  log('stack:', JSON.stringify(await state.stack()));
  await shot('1-composed');

  // Tiling preview to check the seam.
  await page.keyboard.press('Control+t');
  await page.waitForTimeout(350);
  await shot('2-tiling');
  await page.keyboard.press('Control+t');
  await page.waitForTimeout(200);

  // Recolour the whole thing.
  await ui.tab('Recolour');
  await page.click('.panel .segmented button:has-text("Tint")');
  await ui.setColorField('#3FA7D6');
  await ui.setNumber('Amount', 70);
  await page.waitForTimeout(400);
  await shot('3-tinted-preview');
  await page.click('.panel .btn--primary');
  await page.waitForTimeout(300);

  // Canvas tab: rotate, then resize up.
  await ui.tab('Canvas');
  await page.locator('.panel .iconbtn[title="Rotate 90° clockwise"]').click();
  await page.waitForTimeout(350);
  await shot('4-rotated');

  log('final doc:', JSON.stringify(await state.doc()));
  log('undo depth:', (await state.stores()).undo);
  await page.keyboard.press('Shift+Slash');
  await page.waitForTimeout(300);
  await shot('5-shortcuts');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  await shot('6-final');
}
