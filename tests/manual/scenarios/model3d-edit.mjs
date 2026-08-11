/**
 * M16 acceptance — docs/11 §16: build a four-legged stool from scratch through the real UI
 * (numeric fields + duplicate + mirror), drag the translate gizmo with snapping, watch
 * vanillaMode snap an illegal rotation, undo geometry, and save vanilla JSON that parses
 * back to the same five elements.
 */
export function beforeLoad() {
  delete window.showOpenFilePicker;
  delete window.showSaveFilePicker;
  delete window.showDirectoryPicker;
}

export default async function ({ page, shot, state, log }) {
  const model = () => page.evaluate(() => window.__monet.model());
  const elements = () => page.evaluate(() => window.__monet.modelElements());

  // ---- new model from the menu ------------------------------------------------------
  await page.click('.topbar__menu');
  await page.click('text=New model (3D)');
  await page.waitForTimeout(600);
  let m = await model();
  log('new model:', JSON.stringify({ name: m?.name, elements: m?.elements }));
  log('tabs:', JSON.stringify(await page.locator('.topbar__tabs .tab').allInnerTexts()));

  const setNum = async (label, nth, value) => {
    const row = page.locator('.field-row', { hasText: label }).first();
    const input = row.locator('.numfield input').nth(nth);
    await input.fill(String(value));
    await input.press('Enter');
    await page.waitForTimeout(120);
  };
  // Keyboard shortcuts are (correctly) suppressed while a field has focus — Enter leaves
  // the caret in the number input, so park focus on the panel title first.
  const defocus = () => page.click('.panel__title');

  // ---- seat via numeric fields (with arithmetic) ------------------------------------
  await page.locator('.outliner__row--btn').first().click();
  await page.waitForTimeout(200);
  await setNum('From', 0, '2');
  await setNum('From', 1, '7');
  await setNum('From', 2, '2');
  await setNum('To', 0, '14');
  await setNum('To', 1, '8+1'); // arithmetic: 9
  await setNum('To', 2, '14');
  let els = await elements();
  log('seat:', JSON.stringify(els[0]));
  log(els[0].to[1] === 9 ? '✓ arithmetic field committed 8+1 → 9' : '✗ arithmetic failed');

  // ---- first leg: N adds a cube -----------------------------------------------------
  await defocus();
  await page.keyboard.press('KeyN');
  await page.waitForTimeout(250);
  await setNum('From', 0, '2');
  await setNum('From', 1, '0');
  await setNum('From', 2, '2');
  await setNum('To', 0, '4');
  await setNum('To', 1, '7');
  await setNum('To', 2, '4');

  // ---- legs 2–4: duplicate + mirror -------------------------------------------------
  await defocus();
  await page.keyboard.press('Control+d');
  await page.waitForTimeout(200);
  await page.locator('.segmented button:has-text("⇋x")').click();
  await page.waitForTimeout(200);
  await page.keyboard.press('Control+d');
  await page.waitForTimeout(200);
  await page.locator('.segmented button:has-text("⇋z")').click();
  await page.waitForTimeout(200);
  await page.keyboard.press('Control+d');
  await page.waitForTimeout(200);
  await page.locator('.segmented button:has-text("⇋x")').click();
  await page.waitForTimeout(200);
  m = await model();
  els = await elements();
  log('stool elements:', m.elements, m.elements === 5 ? '✓ seat + four legs' : '✗');
  log('leg corners:', JSON.stringify(els.slice(1).map((e) => [e.from[0], e.from[2]])));
  await shot('1-stool-built');

  // ---- translate gizmo: +x drag with lattice snapping -------------------------------
  await page.keyboard.press('Digit1'); // front ortho: world +x is screen right
  await page.waitForTimeout(200);
  await page.click('.topbar__tools .iconbtn[title^="Select"]'); // gizmo lives on the select tool
  await page.locator('.outliner__row--btn').nth(1).click(); // leg 1, from (2,0,2)
  await page.waitForTimeout(200);
  const legBefore = (await elements())[1];
  const centre = {
    x: (legBefore.from[0] + legBefore.to[0]) / 2,
    y: (legBefore.from[1] + legBefore.to[1]) / 2,
    z: (legBefore.from[2] + legBefore.to[2]) / 2,
  };
  // Grab a point on the +x gizmo arm, 3 units from the centre.
  const grab = await page.evaluate(
    ([c]) => window.__monet.modelToScreen(c.x + 3, c.y, c.z),
    [centre],
  );
  const box = await page.locator('.workspace--model .workspace__canvas').boundingBox();
  await page.mouse.move(box.x + grab.x, box.y + grab.y);
  await page.mouse.down();
  await page.mouse.move(box.x + grab.x + 60, box.y + grab.y, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  const legAfter = (await elements())[1];
  const dx = legAfter.from[0] - legBefore.from[0];
  log(`gizmo drag moved leg by dx=${dx}`);
  log(
    dx > 0 && Number.isInteger(dx) && legAfter.from[1] === legBefore.from[1]
      ? '✓ dragged along x only, snapped to the lattice'
      : '✗ gizmo drag wrong',
  );
  log(
    'undo depth after drag:',
    'toolbar:',
    await page.locator('.toolbar .tbtn[title^="Undo"]').isEnabled(),
  );
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(200);
  const legUndone = (await elements())[1];
  log(
    legUndone.from[0] === legBefore.from[0]
      ? '✓ gizmo move is one undoable command'
      : '✗ undo failed',
  );
  await shot('2-gizmo');

  // ---- vanillaMode snaps an illegal rotation ---------------------------------------
  // "Rotation" by exact accessible name — hasText would also match "…(snap illegal rotations)".
  await page.getByRole('checkbox', { name: 'Rotation', exact: true }).check();
  await page.waitForTimeout(200);
  const angleInput = page.locator('.numfield', { hasText: 'angle' }).locator('input');
  await angleInput.fill('30');
  await angleInput.press('Enter');
  await page.waitForTimeout(250);
  const rotRow = await page.locator('.outliner__row--btn').nth(1).innerText();
  log('outliner after asking for 30°:', JSON.stringify(rotRow.trim()));
  log(rotRow.includes('22.5') ? '✓ vanillaMode snapped 30 → 22.5' : '✗ not snapped');
  // Free mode flags instead of snapping.
  await page.locator('.check', { hasText: 'Vanilla mode' }).locator('input').uncheck();
  await angleInput.fill('30');
  await angleInput.press('Enter');
  await page.waitForTimeout(250);
  log('free-mode warning shown:', await page.locator('.outliner__warn').count());
  await page.locator('.check', { hasText: 'Vanilla mode' }).locator('input').check();
  // Clean up: rotation off (two patches → two undos).
  await page.getByRole('checkbox', { name: 'Rotation', exact: true }).uncheck();
  await page.waitForTimeout(200);
  await shot('3-vanilla-snap');

  // ---- save: vanilla JSON download parses back to five elements --------------------
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.keyboard.press('Control+s'),
  ]);
  const path = await download.path();
  const { readFileSync } = await import('node:fs');
  const json = JSON.parse(readFileSync(path, 'utf8'));
  log('saved file:', download.suggestedFilename());
  log('saved elements:', json.elements?.length, json.elements?.length === 5 ? '✓' : '✗');
  const firstFace = json.elements?.[0]?.faces ?? {};
  log('a face:', JSON.stringify(firstFace[Object.keys(firstFace)[0]]));
  log('doc tab dirty dot:', await page.locator('.doctab__dot').count(), '(0 = saved)');
  await shot('4-saved');
}
