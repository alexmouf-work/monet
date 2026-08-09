/** Toolbar reachability, dark mode in all three states, and the brush cursor staying visible. */
export default async function ({ ui, shot, state, log, page }) {
  log('toolbar buttons:', await page.locator('.toolbar .tbtn').count());
  log('groups:', await page.locator('.toolbar__group').count());

  await ui.newDoc(64);
  await ui.tab('Brushes');
  await ui.paletteColor(3);
  await ui.setNumber('Size', 5);
  await ui.drag(await ui.atDoc(8, 8), await ui.atDoc(50, 40));

  // The brush must no longer hide the pointer.
  const cursor = await page.locator('.workspace__canvas').evaluate((el) => el.style.cursor);
  log('brush cursor style:', JSON.stringify(cursor), cursor === 'crosshair' ? '✓ visible' : '✗');
  await shot('1-light');

  // Canvas transforms straight off the toolbar — no menu, no tab switch.
  await page.click('.toolbar .tbtn[title^="Rotate 90° clockwise"]');
  await page.waitForTimeout(300);
  await page.click('.toolbar .tbtn[title^="Flip horizontally"]');
  await page.waitForTimeout(300);
  log('after toolbar transforms:', JSON.stringify(await state.doc()));
  await page.click('.toolbar .tbtn[title^="Undo"]');
  await page.click('.toolbar .tbtn[title^="Undo"]');
  await page.waitForTimeout(300);
  log('undo depth after toolbar undos:', (await state.stores()).undo);
  await page.click('.toolbar .tbtn[title^="Pixel grid"]');
  await page.click('.toolbar .tbtn[title^="Tiling"]');
  await page.waitForTimeout(300);
  log('grid/tiling via toolbar:', (await state.stores()).grid, (await state.stores()).tiling);
  await shot('2-toolbar-actions');
  await page.click('.toolbar .tbtn[title^="Tiling"]');
  await page.waitForTimeout(200);

  // Theme: system → light → dark.
  const themeBtn = page.locator('.toolbar .tbtn[title^="Theme"]');
  log('theme now:', await themeBtn.getAttribute('title'));
  await themeBtn.click();
  await page.waitForTimeout(250);
  log(
    'after 1 click:',
    await themeBtn.getAttribute('title'),
    '| data-theme:',
    await page.evaluate(() => document.documentElement.dataset.theme ?? '(none)'),
  );
  await shot('3-light-explicit');
  await themeBtn.click();
  await page.waitForTimeout(350);
  log(
    'after 2 clicks:',
    await themeBtn.getAttribute('title'),
    '| data-theme:',
    await page.evaluate(() => document.documentElement.dataset.theme ?? '(none)'),
  );
  log(
    'panel bg:',
    await page.evaluate(() => getComputedStyle(document.querySelector('.options')).backgroundColor),
  );
  await page.waitForTimeout(1500);
  log(
    '1.5s later — data-theme:',
    await page.evaluate(() => document.documentElement.dataset.theme ?? '(none)'),
    '| topbar bg:',
    await page.evaluate(() => getComputedStyle(document.querySelector('.topbar')).backgroundColor),
  );
  log(
    'surround the canvas paints:',
    await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--surround').trim(),
    ),
  );
  await shot('4-dark');

  // Dark mode across the panels and a dialog.
  await ui.tab('Shapes');
  await page.waitForTimeout(200);
  await shot('5-dark-shapes');
  await page.click('.toolbar .tbtn[title^="Resize canvas"]');
  await page.waitForTimeout(300);
  await shot('6-dark-dialog');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);

  // Persistence: the choice survives a reload.
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => !!window.__monet);
  await page.waitForTimeout(600);
  log(
    'after reload — data-theme:',
    await page.evaluate(() => document.documentElement.dataset.theme ?? '(none)'),
  );
  await shot('7-dark-after-reload');
}
