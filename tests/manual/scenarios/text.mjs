/** Text: place, type, style, re-edit, and confirm keystrokes reach the editor. */
export default async function ({ ui, shot, state, log, page }) {
  await ui.newDoc(64);
  await ui.tab('Text');
  await ui.setNumber('Size', 20);

  await ui.click(await ui.atDoc(4, 14));
  await page.waitForTimeout(250);
  log('editing id:', await state.editingTextId());
  log(
    'focused:',
    await page.evaluate(() => document.activeElement?.className || document.activeElement?.tagName),
  );

  await page.keyboard.type('AB\nCD');
  await page.waitForTimeout(250);
  log('stack while editing:', JSON.stringify(await state.stack()));
  await shot('editing');

  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  log('stack after commit:', JSON.stringify(await state.stack()));
  log('stores:', JSON.stringify(await state.stores()));
  await shot('committed');

  // Style it: bold + centre + rotate.
  await page.locator('.panel .segmented button', { hasText: 'B' }).first().click();
  await page.locator('.panel .segmented button[title="Centre"]').click();
  await ui.setNumber('Rotation', 20);
  await page.waitForTimeout(250);
  await shot('styled');
  log('stack styled:', JSON.stringify(await state.stack()));

  // Re-edit by double-clicking it with the select tool.
  await page.click('.topbar__tools .iconbtn[title^="Select"]');
  await ui.click(await ui.atDoc(10, 20));
  await page.waitForTimeout(200);
  await page
    .dblclick('.workspace:not(.workspace--model) .workspace__canvas', { position: { x: 0, y: 0 } })
    .catch(() => {});
  log('re-edit id after dblclick at origin (expect null):', await state.editingTextId());
  await shot('final');
}
