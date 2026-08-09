/**
 * Three owner requests (2026-08-09):
 *  - the eyedropper lives in the colour panel and hands the previous tool back after a pick
 *  - a shape with its outline switched off is still outlined, in the fill colour
 *  - copy/paste works on a shape or text object, not just on a pixel selection
 */
export function beforeLoad() {
  // Headless Chromium never resolves the clipboard permission prompt, so the async clipboard
  // must be absent for the internal fallback to be what we are testing.
  delete Object.getPrototypeOf(navigator).clipboard;
}

export default async function ({ page, ui, state, log, shot }) {
  await ui.newDoc(32);
  await ui.tab('Brushes');

  // --- eyedropper: not in the tool grid any more, and momentary -------------------
  const gridTools = await page.locator('.toolgrid__btn').allInnerTexts();
  log('brush tool grid:', JSON.stringify(gridTools.map((t) => t.replace(/\s+/g, ' ').trim())));
  log('eyedropper button in colour panel:', await page.locator('.colorpanel__pick').count());

  await ui.paletteColor(3); // red
  await ui.drag(await ui.atDoc(4, 4), await ui.atDoc(28, 24));
  await ui.paletteColor(10); // white — so the pick has to change it back
  log('tool before pick:', (await state.stores()).tool, '| colour:', (await state.stores()).color);

  await page.click('.colorpanel__pick');
  log('tool while picking:', (await state.stores()).tool);
  await shot('1-picking');
  await ui.click(await ui.atDoc(16, 14));
  const after = await state.stores();
  log('after pick — tool:', after.tool, '| colour:', after.color);
  log(
    after.tool === 'pen' && after.color === '#ED1C24'
      ? '✓ sampled the stroke and handed the pen back'
      : '✗ expected pen + #ED1C24',
  );

  // The I shortcut is momentary too, and Esc gives up on an armed pick.
  await page.keyboard.press('KeyI');
  log('after I:', (await state.stores()).tool);
  await page.keyboard.press('Escape');
  log('after Esc:', (await state.stores()).tool);

  // --- shapes: outline off still draws an edge, in the fill colour ----------------
  await ui.newDoc(32);
  await ui.tab('Shapes');
  await ui.setColorField('#22B14C', 0); // fill
  await ui.setColorField('#000000', 1); // outline
  await ui.drag(await ui.atDoc(6, 6), await ui.atDoc(26, 24));
  await page.waitForTimeout(200);
  const withOutline = {
    black: await state.countColor('#000000'),
    green: await state.countColor('#22B14C'),
  };
  log('outline on  →', JSON.stringify(withOutline));
  await shot('2-outline-on');

  const outlineBox = page.locator('.panel .check:has-text("Outline") input[type="checkbox"]');
  await outlineBox.uncheck();
  await page.waitForTimeout(250);
  const withoutOutline = {
    black: await state.countColor('#000000'),
    green: await state.countColor('#22B14C'),
  };
  log('outline off →', JSON.stringify(withoutOutline));
  log(
    withoutOutline.black === 0 && withoutOutline.green >= withOutline.green + withOutline.black - 4
      ? '✓ the outline became fill-coloured (same footprint, no black left)'
      : '✗ footprint changed',
  );
  await shot('3-outline-off-same-footprint');

  // A line has no fill to fall back on, so with the outline off it used to vanish entirely.
  // Escape first: with an object selected the panel patches that object, not the defaults.
  await ui.newDoc(32);
  await page.keyboard.press('Escape');
  await ui.setColorField('#22B14C', 0);
  await page.click('.shapegrid__btn[title^="Line"]');
  await page.waitForTimeout(120);
  await page.locator('.panel .check:has-text("Outline") input[type="checkbox"]').uncheck();
  await page.waitForTimeout(120);
  await ui.drag(await ui.atDoc(4, 6), await ui.atDoc(28, 26));
  await page.waitForTimeout(250);
  const linePx = await state.countColor('#22B14C');
  log('line with outline off — green px:', linePx, linePx > 0 ? '✓ still visible' : '✗ invisible');
  await shot('4-line-outline-off');

  // --- clipboard: copy and paste an object ---------------------------------------
  await ui.newDoc(64);
  await ui.tab('Shapes');
  // Back to a fillable type: the Fill controls are disabled while Line is selected.
  await page.click('.shapegrid__btn[title^="Rectangle"]');
  await page.waitForTimeout(120);
  await ui.setColorField('#00A2E8', 0);
  await ui.drag(await ui.atDoc(6, 6), await ui.atDoc(22, 20));
  await page.waitForTimeout(200);
  log('stack before copy:', JSON.stringify(await state.stack()));

  await page.keyboard.press('Control+c');
  await page.waitForTimeout(250);
  await page.keyboard.press('Control+v');
  await page.waitForTimeout(400);
  const stack = await state.stack();
  log('stack after paste:', JSON.stringify(stack));
  const shapes = stack.filter((i) => i.kind === 'shape');
  log(
    shapes.length === 2 && shapes[1].detail === shapes[0].detail.replace(/rot \d+$/, 'rot 0')
      ? '✓ pasted a second live shape'
      : `shapes: ${shapes.length} (pasted as an object, still editable: ${shapes.length === 2})`,
  );
  log('selected after paste:', (await state.stores()).selectedObjectId);
  await shot('5-pasted-object');

  // Cut removes the object and paste brings it back.
  await page.keyboard.press('Control+x');
  await page.waitForTimeout(300);
  log('shapes after cut:', (await state.stack()).filter((i) => i.kind === 'shape').length);
  await page.keyboard.press('Control+v');
  await page.waitForTimeout(400);
  log('shapes after paste:', (await state.stack()).filter((i) => i.kind === 'shape').length);

  // Text objects travel the same way.
  await ui.tab('Text');
  await ui.click(await ui.atDoc(6, 40));
  await page.keyboard.type('AB');
  await page.waitForTimeout(150);
  await ui.click(await ui.atDoc(52, 56));
  await page.waitForTimeout(250);
  await page.click('.topbar__tools .iconbtn[title^="Select"]');
  await page.waitForTimeout(200);
  // Count after switching tools: the click that commits the first text opens a second, empty
  // edit, and that placeholder is only removed once the text tool hands over.
  const before = (await state.stack()).filter((i) => i.kind === 'text').length;
  await ui.click(await ui.atDoc(8, 42));
  await page.waitForTimeout(150);
  await page.keyboard.press('Control+c');
  await page.waitForTimeout(250);
  await page.keyboard.press('Control+v');
  await page.waitForTimeout(400);
  log('text objects:', before, '→', (await state.stack()).filter((i) => i.kind === 'text').length);
  log('final stack:', JSON.stringify(await state.stack()));
  await shot('6-text-copied');

  // A rectangular pixel selection must still copy as pixels, not as an object.
  await ui.newDoc(32);
  await ui.tab('Brushes');
  await ui.paletteColor(3);
  await ui.drag(await ui.atDoc(2, 2), await ui.atDoc(14, 14));
  await page.click('.topbar__tools .iconbtn[title^="Select"]');
  await ui.drag(await ui.atDoc(1, 1), await ui.atDoc(16, 16));
  await page.waitForTimeout(150);
  await page.keyboard.press('Control+c');
  await page.waitForTimeout(250);
  await page.keyboard.press('Control+v');
  await page.waitForTimeout(400);
  const s = await state.stores();
  log('pixel paste — floating:', s.selection?.floating, '| stack:', (await state.stack()).length);
  await shot('7-pixel-paste-still-works');
}
