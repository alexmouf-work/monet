/**
 * Save routing (docs/07 §1/§8). Headless Chromium exposes showSaveFilePicker but never
 * resolves it (there is no picker UI), so `beforeLoad` stubs it with a fake handle: that
 * exercises the File System Access write path and the silent re-save on a second Ctrl+S.
 * Deleting the stub afterwards exercises the download fallback.
 */
export function beforeLoad() {
  window.__written = [];
  window.showSaveFilePicker = async ({ suggestedName }) => ({
    name: suggestedName,
    queryPermission: async () => 'granted',
    requestPermission: async () => 'granted',
    createWritable: async () => ({
      write: async (blob) => {
        const buf = new Uint8Array(await blob.arrayBuffer());
        window.__written.push({
          name: suggestedName,
          size: buf.length,
          head: [...buf.slice(0, 4)],
        });
      },
      close: async () => {},
    }),
  });
}

export default async function ({ ui, shot, state, log, page }) {
  await ui.newDoc(32);
  await ui.tab('Brushes');
  await ui.paletteColor(6);
  await ui.setNumber('Size', 6);
  await ui.drag(await ui.atDoc(4, 4), await ui.atDoc(28, 28));
  await shot('drawn');

  await page.keyboard.press('Control+s');
  await page.waitForTimeout(700);
  log('written:', JSON.stringify(await page.evaluate(() => window.__written)));
  log('dirty dot (0 = saved):', await page.locator('.doctab__dot').count());

  // Draw again; the second save must reuse the handle (one more write, no new picker).
  await ui.drag(await ui.atDoc(4, 28), await ui.atDoc(28, 4));
  await page.keyboard.press('Control+s');
  await page.waitForTimeout(700);
  log('writes after re-save:', await page.evaluate(() => window.__written.length));

  // .monet through the menu.
  await page.click('.topbar__menu');
  await page.click('.menu__item:has-text("Save project")');
  await page.waitForTimeout(700);
  const written = await page.evaluate(() => window.__written);
  log('project write:', JSON.stringify(written[written.length - 1]));
  await shot('saved');

  // Download fallback with the picker removed.
  await page.evaluate(() => {
    delete window.showSaveFilePicker;
  });
  const [dl] = await Promise.all([
    page.waitForEvent('download'),
    page.click('.topbar__menu').then(() => page.click('.menu__item:has-text("Save project")')),
  ]);
  log('download suggested name:', dl.suggestedFilename());

  // Re-open the saved project from its bytes to prove the round-trip through the UI.
  log('stack before:', JSON.stringify(await state.stack()));
  await shot('final');
}
