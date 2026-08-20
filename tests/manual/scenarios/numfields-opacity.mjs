/**
 * Two owner requests (2026-08-11):
 *
 * 1. Numeric fields must be emptiable while typing. Backspacing the last digit used to leave
 *    it there, because `+'' === 0` was committed straight back through the controlled value.
 *    Leaving the field empty resolves to a sensible default — 1 for the brush size, 255 for an
 *    opacity — not to whatever the field said before.
 * 2. Recolour gained an Opacity mode: multiply the alpha of one colour by 0–255.
 *
 * Everything is read from the field itself and from the store, so "it looks right" is not
 * mistaken for "the value went through".
 */

const fieldValue = (locator) => locator.inputValue();

/** Empty a field the way a user does: click in, select all, backspace. */
async function clearField(page, locator) {
  await locator.click();
  await locator.press('Control+a');
  await locator.press('Backspace');
  await page.waitForTimeout(150);
}

export default async function ({ page, ui, shot, state, log }) {
  await ui.newDoc(32);
  await ui.tab('Brushes');
  await ui.tool('Pixel pen');

  // ---- 1. the brush size field ---------------------------------------------------------
  const size = page.locator('.panel .slider:has-text("Size") .slider__num');
  await ui.setNumber('Size', 8);
  log('size after typing 8:', await fieldValue(size), '· store:', (await state.stores()).brushSize);

  await clearField(page, size);
  const whileEmpty = await fieldValue(size);
  const storeWhileEmpty = (await state.stores()).brushSize;
  log('after backspacing:', JSON.stringify(whileEmpty), '· store still:', storeWhileEmpty);
  log(
    whileEmpty === '' && storeWhileEmpty === 8
      ? '✓ the field can be emptied while typing, and nothing is committed until it parses'
      : `✗ the field would not empty (showed ${JSON.stringify(whileEmpty)})`,
  );
  await shot('1-size-empty');

  // Typing into the emptied field commits normally.
  await size.type('12');
  await page.waitForTimeout(200);
  log('after typing 12 into the empty field · store:', (await state.stores()).brushSize);
  log(
    (await state.stores()).brushSize === 12
      ? '✓ typing into the emptied field works'
      : '✗ the typed value did not commit',
  );

  // Empty it again and click away: it must land on 1, not back on 12.
  await clearField(page, size);
  await page.locator('.panel__title').click();
  await page.waitForTimeout(250);
  log('after blurring an empty size field:', await fieldValue(size));
  log(
    (await fieldValue(size)) === '1' && (await state.stores()).brushSize === 1
      ? '✓ an empty brush size falls back to 1 on blur'
      : `✗ empty size resolved to ${await fieldValue(size)}`,
  );

  // ---- the opacity selector: typeable, 0–255, falls back to 255 -------------------------
  const alpha = page.locator('.colorpanel__alphanum');
  log('alpha field present:', await alpha.count());
  await alpha.fill('128');
  await alpha.press('Enter');
  await page.waitForTimeout(250);
  const alphaStore = (await state.stores()).alpha;
  log('typed 128 → store alpha:', alphaStore.toFixed(3));
  log(
    Math.abs(alphaStore - 128 / 255) < 0.01
      ? '✓ the opacity selector is a click-and-type field on the 0–255 scale'
      : '✗ typing into the alpha field did not take',
  );
  // The slider and the box are the same value.
  const alphaRange = page.locator('.colorpanel__alpha input[type="range"]');
  log('slider reads:', await fieldValue(alphaRange));
  log(
    (await fieldValue(alphaRange)) === '128'
      ? '✓ the slider and the field track each other'
      : '✗ slider and field disagree',
  );

  await clearField(page, alpha);
  log('alpha while empty:', JSON.stringify(await fieldValue(alpha)));
  await page.locator('.colorpanel__hex').click();
  await page.waitForTimeout(250);
  log('alpha after blurring empty:', await fieldValue(alpha));
  log(
    (await fieldValue(alpha)) === '255' && (await state.stores()).alpha === 1
      ? '✓ an empty opacity falls back to 255'
      : `✗ empty opacity resolved to ${await fieldValue(alpha)}`,
  );
  await shot('2-alpha');

  // ---- 2. Recolour → Opacity -----------------------------------------------------------
  await ui.tool('Pixel pen');
  await ui.setNumber('Size', 10);
  await ui.paletteColor(3); // red
  await ui.drag(await ui.atDoc(4, 8), await ui.atDoc(28, 8));
  await ui.paletteColor(7); // blue
  await ui.drag(await ui.atDoc(4, 22), await ui.atDoc(28, 22));
  const opaqueRed = await page.evaluate(() => window.__monet.alphaHistogram('#ED1C24'));
  log('red texels and their alpha:', JSON.stringify(opaqueRed));
  await shot('3-two-bands');

  await ui.tab('Recolour');
  await page.waitForTimeout(300);
  await page.locator('.panel .segmented button:has-text("Opacity")').click();
  await page.waitForTimeout(250);
  await page.locator('.chiprow__hex').first().fill('#ED1C24');
  await page.waitForTimeout(300);

  const defaultOpacity = await fieldValue(
    page.locator('.panel .slider:has-text("Opacity") .slider__num'),
  );
  log('opacity defaults to:', defaultOpacity);
  log(
    defaultOpacity === '255'
      ? '✓ the multiplier starts at 255 — the identity, so opening the mode changes nothing'
      : '✗ the multiplier does not default to 255',
  );

  await ui.setNumber('Opacity', 128);
  await page.waitForTimeout(400);
  const halved = await page.evaluate(() => window.__monet.alphaHistogram('#ED1C24'));
  const blueUntouched = await page.evaluate(() => window.__monet.alphaHistogram('#00A2E8'));
  log('red after ×128/255:', JSON.stringify(halved), '· blue:', JSON.stringify(blueUntouched));
  log(
    halved.alphas.length === 1 &&
      Math.abs(halved.alphas[0] - 128) <= 1 &&
      halved.count === opaqueRed.count &&
      blueUntouched.alphas[0] === 255
      ? '✓ the red is at half alpha, keeps its colour, and the blue is untouched'
      : '✗ the opacity multiply did not land',
  );
  await shot('4-opacity-preview');

  await page.click('.panel .btn--primary');
  await page.waitForTimeout(400);
  const baked = await page.evaluate(() => window.__monet.alphaHistogram('#ED1C24'));
  const afterBakeField = await fieldValue(
    page.locator('.panel .slider:has-text("Opacity") .slider__num'),
  );
  log('after bake:', JSON.stringify(baked), '· multiplier now:', afterBakeField);
  log(
    baked.alphas.length === 1 && Math.abs(baked.alphas[0] - 128) <= 1 && afterBakeField === '255'
      ? '✓ baking keeps it at half alpha — the bake consumes the multiplier'
      : '✗ the bake re-applied the multiply',
  );

  // 0 makes the colour vanish entirely.
  await ui.setNumber('Opacity', 0);
  await page.waitForTimeout(400);
  const gone = await page.evaluate(() => window.__monet.alphaHistogram('#ED1C24'));
  log('at ×0:', JSON.stringify(gone));
  log(
    gone.count === 0 || gone.alphas.every((a) => a === 0)
      ? '✓ ×0 makes exactly that colour invisible'
      : '✗ ×0 left something behind',
  );
  await shot('5-opacity-zero');
}
