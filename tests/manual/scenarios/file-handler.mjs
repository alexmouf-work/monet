/**
 * "Open with Monet" from the OS file manager — docs/07 §10.
 *
 * The real association is made by Chromium at PWA install time and exercised by Explorer, neither
 * of which a headless run can do. What *is* ours and testable: the `launchQueue` consumer, opening
 * each delivered handle as a document, and — the part that makes this worth having — `Ctrl+S`
 * writing back to the handle the OS gave us, with no dialog.
 *
 * The fakes below stand in for Chromium's launch: handles that produce real PNG Files and record
 * what gets written to them.
 */
export function beforeLoad() {
  window.__written = [];

  const makeHandle = (name, w, h, color) => ({
    name,
    kind: 'file',
    async getFile() {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const ctx = c.getContext('2d');
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, w, h);
      const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
      return new File([blob], name, { type: 'image/png' });
    },
    async queryPermission() {
      return 'granted';
    },
    async requestPermission() {
      return 'granted';
    },
    async createWritable() {
      const chunks = [];
      return {
        async write(data) {
          chunks.push(data);
        },
        async close() {
          const bytes = new Uint8Array(await new Blob(chunks).arrayBuffer());
          // Record the PNG signature too: writing *something* is not the same as writing a PNG.
          window.__written.push({
            name,
            size: bytes.byteLength,
            png: [...bytes.slice(0, 4)].join(','),
          });
        },
      };
    },
  });

  // defineProperty, not assignment: Chromium already defines `launchQueue` and `LaunchParams`
  // as prototype accessors with no setter, so `window.launchQueue = …` fails silently and the
  // native queue (which never receives a launch here) stays in place.
  Object.defineProperty(window, 'LaunchParams', {
    value: function LaunchParams() {},
    configurable: true,
  });
  Object.defineProperty(window, 'launchQueue', {
    configurable: true,
    value: {
      setConsumer(fn) {
        window.__consumerSet = true;
        // A queued launch is delivered as soon as a consumer appears.
        fn({
          files: [
            makeHandle('stone.png', 16, 16, '#ED1C24'),
            makeHandle('apple.png', 32, 32, '#22B14C'),
          ],
        });
      },
    },
  });

  // Any real picker would hang headless — and reaching one at all would be the bug under test.
  delete window.showSaveFilePicker;
  delete window.showOpenFilePicker;
}

export default async function ({ page, state, log, shot }) {
  await page.waitForTimeout(900);

  log(
    'launch API present:',
    JSON.stringify(
      await page.evaluate(() => ({
        launchQueue: 'launchQueue' in window,
        LaunchParams: 'LaunchParams' in window,
        faked: !!window.__written,
      })),
    ),
  );
  log('consumer registered:', await page.evaluate(() => window.__consumerSet === true));

  // Both launched files should be open as documents, sized from their contents.
  log('document tabs:', JSON.stringify(await page.locator('.doctab__name').allInnerTexts()));
  log('active doc:', JSON.stringify(await state.doc()));
  const stores = await state.stores();
  log('docs open:', stores.docs);
  await shot('1-launched-with-two-files');

  const doc = await state.doc();
  log(
    stores.docs === 2 && doc.width === 32 && doc.height === 32 && doc.name === 'apple'
      ? '✓ both files opened; the last one is active, named and sized from the file'
      : '✗ unexpected launch result',
  );
  log('red pixels in the first doc are not in this one:', await state.countColor('#22B14C'));

  // --- the payoff: Ctrl+S goes back to the file the OS handed us --------------------
  await page.keyboard.press('Control+s');
  await page.waitForTimeout(700);
  log('written:', JSON.stringify(await page.evaluate(() => window.__written)));
  const written = await page.evaluate(() => window.__written);
  const first = written[0];
  log(
    written.length === 1 && first.name === 'apple.png' && first.png === '137,80,78,71'
      ? '✓ saved straight back to apple.png as a PNG, no dialog'
      : '✗ did not write back to the launched handle',
  );
  log('dirty flag after save (0 = saved):', (await state.doc()).dirty ? 1 : 0);
  log('toasts mention the filename:', JSON.stringify(await page.locator('.toast').allInnerTexts()));
  await shot('2-saved-in-place');

  // Editing then saving again must reuse the same handle rather than escalating to a picker.
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(150);
  const box = await page
    .locator('.workspace:not(.workspace--model) .workspace__canvas')
    .boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(200);
  await page.keyboard.press('Control+s');
  await page.waitForTimeout(700);
  log('writes after a second save:', (await page.evaluate(() => window.__written)).length);
  log('no page dialog appeared:', (await page.locator('.dialog').count()) === 0);
  await shot('3-second-save');
}
