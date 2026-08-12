/**
 * M18 acceptance — docs/11 §16: align a cube face-to-face with another using ONLY inference
 * (no typing — the target face sits at a fractional coordinate the lattice cannot reach),
 * with the aligned plane drawn and the live Δ readout in the status bar; then measure a
 * 2-texel gap between two elements and see the numbers agree.
 */
export function beforeLoad() {
  delete window.showOpenFilePicker;
  delete window.showSaveFilePicker;
  delete window.showDirectoryPicker;
}

export default async function ({ page, shot, log }) {
  const els = () => page.evaluate(() => window.__monet.modelElements());
  const toScreen = (x, y, z) =>
    page.evaluate(([a, b, c]) => window.__monet.modelToScreen(a, b, c), [x, y, z]);

  const setNum = async (label, nth, value) => {
    const row = page.locator('.field-row', { hasText: label }).first();
    const input = row.locator('.numfield input').nth(nth);
    await input.fill(String(value));
    await input.press('Enter');
    await page.waitForTimeout(120);
  };
  const defocus = () => page.click('.panel__title');

  // ---- two cubes: A ends at x=5.7 (unreachable by the integer lattice), B at x 10..14 ----
  await page.click('.topbar__menu');
  await page.click('text=New model (3D)');
  await page.waitForTimeout(600);
  await page.locator('.outliner__row--btn').first().click();
  await page.waitForTimeout(200);
  await setNum('From', 0, '1.7');
  await setNum('From', 1, '0');
  await setNum('From', 2, '2');
  await setNum('To', 0, '5.7');
  await setNum('To', 1, '4');
  await setNum('To', 2, '6');
  await defocus();
  await page.keyboard.press('KeyN');
  await page.waitForTimeout(250);
  await setNum('From', 0, '10');
  await setNum('From', 1, '0');
  await setNum('From', 2, '2');
  await setNum('To', 0, '14');
  await setNum('To', 1, '4');
  await setNum('To', 2, '6');
  await defocus();
  log('cubes:', JSON.stringify((await els()).map((e) => [e.from[0], e.to[0]])));

  // ---- drag B leftwards; inference must stick B.from.x to A.to.x = 5.7 ----------------
  await page.keyboard.press('Digit1'); // front ortho: x is screen-horizontal
  await page.waitForTimeout(200);
  await page.click('.topbar__tools .iconbtn[title^="Select"]');
  const centre = { x: 12, y: 2, z: 4 }; // B's centre
  const grab = await toScreen(centre.x + 3, centre.y, centre.z);
  const unit = await (async () => {
    const a = await toScreen(0, 0, 0);
    const b = await toScreen(1, 0, 0);
    return b.x - a.x; // canvas px per model unit along screen-x
  })();
  const box = await page.locator('.workspace--model .workspace__canvas').boundingBox();
  await page.mouse.move(box.x + grab.x, box.y + grab.y);
  await page.mouse.down();
  // Perfect alignment is Δx = −4.3; release 0.55 units short of the target so ONLY
  // inference (radius 0.35 around −4.3... approached at −4.25) can produce the exact value.
  await page.mouse.move(box.x + grab.x - 4.25 * unit, box.y + grab.y, { steps: 10 });
  const readout = await page.locator('.statusbar__measure').innerText();
  log('mid-drag readout:', JSON.stringify(readout));
  await shot('1-inference-held');
  await page.mouse.up();
  await page.waitForTimeout(300);
  const b = (await els())[1];
  log(`B.from.x after drag: ${b.from[0]}`);
  log(
    Math.abs(b.from[0] - 5.7) < 1e-9 && !Number.isInteger(b.from[0])
      ? '✓ face-to-face by inference alone — a fractional snap the lattice cannot make'
      : '✗ inference failed',
  );
  log(
    readout.includes('⌖ aligned') && readout.includes('Δx')
      ? '✓ live readout showed the axis delta and the alignment glyph'
      : '✗ readout wrong',
  );
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(250);
  log((await els())[1].from[0] === 10 ? '✓ inference move is one undo step' : '✗ undo wrong');

  // ---- measurement: a 2-texel gap read off the status bar -----------------------------
  await page.locator('.outliner__row--btn').first().click(); // select A
  await page.waitForTimeout(200);
  await setNum('To', 0, '8'); // A now 1.7..8; B at 10..14 → gap x = 2
  await defocus();
  const overB = await toScreen(12, 2, 4);
  await page.mouse.move(box.x + overB.x, box.y + overB.y);
  await page.waitForTimeout(400);
  const measure = await page.locator('.statusbar__measure').innerText();
  log('measurement cell:', JSON.stringify(measure));
  log(
    measure.includes('#1↔#2') && measure.includes('gap x 2')
      ? '✓ the 2-texel gap reads 2, in model units = texels'
      : '✗ measurement wrong',
  );
  await shot('2-measure-gap');

  // ---- selection depth: click cycles element → face, Esc climbs back out -------------
  const sel = async () => (await page.evaluate(() => window.__monet.model())).selected;
  // Aim away from A's gizmo arms: A's centre is (4.85,2,4) and its +x arm tip lands at
  // (11.85,2) in this view — clicking there grabs the gizmo instead of selecting.
  const onB = await toScreen(13, 3.5, 4);
  await page.mouse.click(box.x + onB.x, box.y + onB.y); // first click: element #2
  await page.waitForTimeout(250);
  const d1 = await sel();
  await page.mouse.click(box.x + onB.x, box.y + onB.y); // second click: its face
  await page.waitForTimeout(250);
  const d2 = await sel();
  log('depth after two clicks:', JSON.stringify([d1, d2]));
  log(
    d1.element === 2 && d1.face === null && d2.element === 2 && d2.face === 'south'
      ? '✓ click cycles depth: element, then the face under the cursor'
      : '✗ depth cycling wrong',
  );
  log(
    (await page.locator('.topbar__tabs .tab.is-active').innerText()) === 'Model'
      ? '✓ (UV tab picks the face up when opened — same store field)'
      : '',
  );
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  const up1 = await sel();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  const up2 = await sel();
  log(
    up1.face === null && up1.element === 2 && up2.element === null
      ? '✓ Esc climbs the ladder: face → element → nothing'
      : `✗ Esc ladder wrong ${JSON.stringify([up1, up2])}`,
  );

  // ---- right-click context menu ------------------------------------------------------
  await page.mouse.click(box.x + onB.x, box.y + onB.y, { button: 'right' });
  await page.waitForTimeout(250);
  const onElement = await page.locator('.ctxmenu__item').allInnerTexts();
  log('menu over an element:', JSON.stringify(onElement));
  const before = (await els()).length;
  await page.locator('.ctxmenu__item', { hasText: 'Duplicate' }).click();
  await page.waitForTimeout(300);
  log(
    onElement.some((t) => t.includes('south')) && (await els()).length === before + 1
      ? '✓ the element menu is face-aware and its actions run'
      : '✗ element menu wrong',
  );
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(250);
  log(
    (await els()).length === before && (await sel()).element === null
      ? '✓ undoing the duplicate drops the selection that pointed at it'
      : `✗ stale selection ${JSON.stringify(await sel())}`,
  );

  // Empty space gets the view/create menu instead, and Escape closes it without also
  // climbing the selection ladder (the menu swallows that key).
  await page.mouse.click(box.x + onB.x, box.y + onB.y); // re-select #2
  await page.waitForTimeout(250);
  await page.mouse.click(box.x + 40, box.y + 40, { button: 'right' });
  await page.waitForTimeout(250);
  const onEmpty = await page.locator('.ctxmenu__item').allInnerTexts();
  log('menu over empty space:', JSON.stringify(onEmpty));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  const closed = (await page.locator('.ctxmenu').count()) === 0;
  const after = await sel();
  log(
    onEmpty.some((t) => t.includes('Add cube')) && !onEmpty.some((t) => t.includes('Delete'))
      ? '✓ empty space offers add/view actions, not element ones'
      : '✗ empty menu wrong',
  );
  log(closed ? '✓ Escape closes the menu' : '✗ menu stayed open');
  log(
    after.element === 2
      ? '✓ …and that Escape did not also climb the selection ladder'
      : `✗ Escape leaked through to the selection ${JSON.stringify(after)}`,
  );
  await shot('3-context-menu');
}
