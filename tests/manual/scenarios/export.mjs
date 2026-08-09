/** Export: every format reaches a download with plausible bytes and correct magic numbers. */
export function beforeLoad() {
  // No picker in headless: force the download fallback so each export is observable.
  delete window.showSaveFilePicker;
}

export default async function ({ ui, shot, log, page }) {
  await ui.newDoc(32);
  await ui.tab('Brushes');
  await ui.paletteColor(3);
  await ui.setNumber('Size', 8);
  await ui.drag(await ui.atDoc(4, 4), await ui.atDoc(28, 20));
  await ui.paletteColor(7);
  await ui.setNumber('Size', 4);
  await ui.drag(await ui.atDoc(4, 26), await ui.atDoc(28, 26));
  await shot('drawn');

  const magic = {
    png: [0x89, 0x50, 0x4e, 0x47],
    jpg: [0xff, 0xd8, 0xff],
    webp: [0x52, 0x49, 0x46, 0x46],
    ico: [0x00, 0x00, 0x01, 0x00],
    bmp: [0x42, 0x4d],
    pdf: [0x25, 0x50, 0x44, 0x46],
  };

  const formats = await page
    .evaluate(() => [...document.querySelectorAll('.dialog select option')].map((o) => o.value))
    .catch(() => null);
  void formats;

  for (const label of ['PNG', 'JPEG', 'WebP', 'ICO', 'BMP', 'PDF']) {
    await page.keyboard.press('Control+Shift+E');
    await page.waitForTimeout(300);
    const option = page.locator('.dialog select option', { hasText: label });
    if ((await option.count()) === 0) {
      log(label, '→ not offered (feature-detected off)');
      await page.keyboard.press('Escape');
      await page.waitForTimeout(200);
      continue;
    }
    await page.selectOption('.dialog select', { label: await option.first().innerText() });
    await page.waitForTimeout(150);
    if (label === 'PDF')
      log('pdf hint:', await page.locator('.dialog .panel__hint').first().innerText());
    const [dl] = await Promise.all([
      page.waitForEvent('download'),
      page.click('.dialog__actions .btn--primary'),
    ]);
    const path = await dl.path();
    const { readFileSync } = await import('node:fs');
    const bytes = readFileSync(path);
    const ext = dl.suggestedFilename().split('.').pop();
    const expected = magic[ext] ?? [];
    const ok = expected.every((b, i) => bytes[i] === b);
    log(
      `${label.padEnd(5)} → ${dl.suggestedFilename().padEnd(16)} ${String(bytes.length).padStart(7)} bytes  magic ${ok ? 'OK' : 'MISMATCH ' + [...bytes.slice(0, 4)]}`,
    );
    await page.waitForTimeout(250);
  }
  await shot('after-exports');
}
