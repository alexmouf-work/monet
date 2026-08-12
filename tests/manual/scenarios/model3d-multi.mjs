/**
 * M18's remaining clauses — docs/11 §10.1 item 3: multi-select and multi-select transforms.
 * Build three cubes, select them by box-drag and by Ctrl-click, move them together with one
 * gizmo drag (one undo step), duplicate and delete as a set, and check the selection filter
 * sends a single click straight to a face.
 */
export function beforeLoad() {
  delete window.showOpenFilePicker;
  delete window.showSaveFilePicker;
  delete window.showDirectoryPicker;
}

export default async function ({ page, shot, log }) {
  const els = () => page.evaluate(() => window.__monet.modelElements());
  const sel = async () => (await page.evaluate(() => window.__monet.model())).selected;
  const selIds = () => page.evaluate(() => window.__monet.selectedElements());
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

  // ---- three cubes in a row: x 0..4, 6..10, 12..16 ----------------------------------
  await page.click('.topbar__menu');
  await page.click('text=New model (3D)');
  await page.waitForTimeout(600);
  await page.locator('.outliner__row--btn').first().click();
  await page.waitForTimeout(200);
  const shape = async (x0, x1) => {
    await setNum('From', 0, x0);
    await setNum('From', 1, '0');
    await setNum('From', 2, '6');
    await setNum('To', 0, x1);
    await setNum('To', 1, '4');
    await setNum('To', 2, '10');
  };
  await shape(0, 4);
  for (const [a, b] of [
    [6, 10],
    [12, 16],
  ]) {
    await defocus();
    await page.keyboard.press('KeyN');
    await page.waitForTimeout(250);
    await shape(a, b);
  }
  await defocus();
  log('cubes:', JSON.stringify((await els()).map((e) => [e.from[0], e.to[0]])));

  await page.keyboard.press('Digit1'); // front ortho
  await page.waitForTimeout(250);
  await page.click('.topbar__tools .iconbtn[title^="Select"]');

  // ---- box-select over everything ----------------------------------------------------
  const box = await page.locator('.workspace--model .workspace__canvas').boundingBox();
  const drag = async (from, to, mods = []) => {
    for (const m of mods) await page.keyboard.down(m);
    await page.mouse.move(box.x + from.x, box.y + from.y);
    await page.mouse.down();
    await page.mouse.move(box.x + to.x, box.y + to.y, { steps: 8 });
    await page.mouse.up();
    for (const m of mods) await page.keyboard.up(m);
    await page.waitForTimeout(300);
  };
  // From an EMPTY corner across the whole viewport: a drag that starts on geometry orbits
  // (Onshape's rule — only a manipulator grabs), so the marquee must begin off the model.
  await drag({ x: 6, y: 6 }, { x: box.width - 6, y: box.height - 6 });
  log('after box-select:', JSON.stringify(await selIds()));
  log(
    (await selIds()).length === 3
      ? '✓ box-select took all three elements'
      : `✗ box-select wrong (${JSON.stringify(await selIds())})`,
  );
  // Selection has to be VISIBLE, not just held in a store: every selected element is outlined
  // in the accent colour. Count accent pixels on the real canvas, with the selection and
  // without, rather than trusting a screenshot by eye.
  const accentPixels = () =>
    page.evaluate(() => {
      const canvas = document.querySelector('.workspace--model .workspace__canvas');
      const off = document.createElement('canvas');
      off.width = canvas.width;
      off.height = canvas.height;
      const ctx = off.getContext('2d');
      ctx.drawImage(canvas, 0, 0);
      const { data } = ctx.getImageData(0, 0, off.width, off.height);
      // --accent in the dark theme is #4fb3e0.
      let n = 0;
      for (let i = 0; i < data.length; i += 4) {
        if (
          Math.abs(data[i] - 79) < 20 &&
          Math.abs(data[i + 1] - 179) < 20 &&
          Math.abs(data[i + 2] - 224) < 20
        )
          n++;
      }
      return n;
    });
  const outlined = await accentPixels();
  await shot('1-box-select');

  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  const bare = await accentPixels();
  log(`accent pixels: ${outlined} selected vs ${bare} cleared`);
  log(
    outlined > bare + 100
      ? '✓ every selected element is outlined in the viewport'
      : '✗ selection is invisible on screen',
  );
  // Put the selection back for the transform checks.
  await drag({ x: 6, y: 6 }, { x: box.width - 6, y: box.height - 6 });

  // ---- one gizmo drag moves all three, as ONE undo step ------------------------------
  const before = await els();
  const primary = (await sel()).element;
  const el = before.find((e) => e.id === primary);
  const centre = {
    x: (el.from[0] + el.to[0]) / 2,
    y: (el.from[1] + el.to[1]) / 2,
    z: (el.from[2] + el.to[2]) / 2,
  };
  const grab = await toScreen(centre.x, centre.y + 3, centre.z); // +y arm
  const unit = await (async () => {
    const a = await toScreen(0, 0, 0);
    const b = await toScreen(0, 1, 0);
    return a.y - b.y; // px per unit upward
  })();
  await drag(grab, { x: grab.x, y: grab.y - 2 * unit });
  const after = await els();
  const dys = after.map((e, i) => e.from[1] - before[i].from[1]);
  log('per-element dy:', JSON.stringify(dys));
  log(
    dys.length === 3 && dys.every((d) => d === dys[0] && d > 0)
      ? '✓ one drag moved every selected element by the same amount'
      : '✗ multi-move wrong',
  );
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(250);
  const undone = (await els()).map((e, i) => e.from[1] - before[i].from[1]);
  log(
    undone.every((d) => d === 0)
      ? '✓ moving three elements is ONE undo step'
      : `✗ undo left ${JSON.stringify(undone)}`,
  );
  await shot('2-moved-together');

  // ---- Ctrl-click builds a selection; Ctrl+A takes everything ------------------------
  const at = async (e) => {
    const p = await toScreen((e.from[0] + e.to[0]) / 2, 2, 8);
    return { x: box.x + p.x, y: box.y + p.y };
  };
  const first = await at(before[0]);
  const third = await at(before[2]);
  await page.mouse.click(first.x, first.y);
  await page.waitForTimeout(200);
  await page.keyboard.down('Control');
  await page.mouse.click(third.x, third.y);
  await page.keyboard.up('Control');
  await page.waitForTimeout(250);
  const pair = await selIds();
  log('after ctrl-click:', JSON.stringify(pair));
  log(
    pair.length === 2 && pair.includes(before[0].id) && pair.includes(before[2].id)
      ? '✓ Ctrl-click adds to the selection without taking the middle one'
      : '✗ ctrl-click wrong',
  );
  // Ctrl-clicking the same element again removes it.
  await page.keyboard.down('Control');
  await page.mouse.click(third.x, third.y);
  await page.keyboard.up('Control');
  await page.waitForTimeout(250);
  log((await selIds()).length === 1 ? '✓ Ctrl-click again removes it' : '✗ toggle-off wrong');
  await page.keyboard.press('Control+a');
  await page.waitForTimeout(250);
  log((await selIds()).length === 3 ? '✓ Ctrl+A selects every element' : '✗ select-all wrong');

  // ---- duplicate and delete act on the whole selection, one step each ----------------
  await page.keyboard.press('Control+d');
  await page.waitForTimeout(350);
  const dupCount = (await els()).length;
  log(
    dupCount === 6 && (await selIds()).length === 3
      ? '✓ duplicate copied all three and selected the copies'
      : `✗ duplicate wrong (${dupCount} elements)`,
  );
  await page.keyboard.press('Delete');
  await page.waitForTimeout(300);
  const afterDelete = (await els()).length;
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(300);
  log(
    afterDelete === 3 && (await els()).length === 6
      ? '✓ delete removed the three copies in one step, and undo brought them back'
      : `✗ delete wrong (${afterDelete} then ${(await els()).length})`,
  );
  await shot('3-duplicate-delete');

  // ---- the selection filter sends one click to a face --------------------------------
  await page.locator('.segmented button:has-text("Faces")').click();
  await page.waitForTimeout(200);
  await page.mouse.click(first.x, first.y);
  await page.waitForTimeout(250);
  const faceSel = await sel();
  log('filter=faces, one click:', JSON.stringify(faceSel));
  log(
    faceSel.face === 'south'
      ? '✓ with the Faces filter a single click lands on the face'
      : '✗ face filter wrong',
  );
  await page.locator('.segmented button:has-text("Elements")').click();
  await page.waitForTimeout(200);
  await page.keyboard.press('Escape'); // face → element
  await page.keyboard.press('Escape'); // element → nothing
  await page.waitForTimeout(200);
  await page.mouse.click(first.x, first.y);
  await page.waitForTimeout(250);
  const back = await sel();
  log('filter=elements, one click:', JSON.stringify(back));
  log(
    back.element !== null && back.face === null
      ? '✓ back on Elements, a click selects the element and stops there'
      : '✗ filter did not switch back',
  );
  await shot('4-face-filter');
}
