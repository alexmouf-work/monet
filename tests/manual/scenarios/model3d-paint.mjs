/**
 * M15 acceptance — docs/11 §16: the 2D brushes paint on the model. One drag = one undo step
 * even across faces of one texture; a jump between faces must NOT interpolate; painting with
 * no texture doc open creates one silently in the background; eraser punches a cutout hole;
 * bucket, eyedropper and Ctrl+Z all work while the model stays the active tab.
 */
import { writeModelJar } from '../fixtures/jar.mjs';

export function beforeLoad() {
  delete window.showOpenFilePicker;
  delete window.showSaveFilePicker;
  delete window.showDirectoryPicker;
}

export default async function ({ page, shot, state, log }) {
  await writeModelJar('/tmp/monet-3d.jar');
  const model = () => page.evaluate(() => window.__monet.model());
  const centerPx = () => page.evaluate(() => window.__monet.modelCenterPixel());
  const modelTab = () => page.locator('.doctab').filter({ hasText: 'stone' }).nth(0);
  const textureTab = () => page.locator('.doctab').filter({ hasText: 'stone' }).nth(1);

  await page.click('.sources__header .iconbtn');
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.click('.sources__add .btn:has-text("Minecraft / mod jar")'),
  ]);
  await chooser.setFiles('/tmp/monet-3d.jar');
  await page.waitForTimeout(900);
  await page.locator('.srctree--models .srctree__item:has-text("stone.json")').first().click();
  await page.waitForTimeout(1000);

  await page.keyboard.press('Digit1'); // front ortho, target untouched at (8,8,8)
  await page.waitForTimeout(200);
  const box = await page.locator('.workspace--model .workspace__canvas').boundingBox();
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;

  // Red + pen size 3, so the stroke reliably covers the exact centre texel.
  await page.locator('.colorpanel .swatches').first().locator('.swatch').nth(3).click();
  await page.keyboard.press('KeyB');
  await page.keyboard.press('BracketRight');
  await page.keyboard.press('BracketRight');
  await page.waitForTimeout(150);
  log('tool:', (await state.stores()).tool);
  log(
    'cursor:',
    await page.locator('.workspace--model .workspace__canvas').evaluate((el) => el.style.cursor),
  );

  // ---- paint a horizontal drag straight through the centre --------------------------
  await page.mouse.move(cx - 70, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 70, cy, { steps: 16 });
  await page.mouse.up();
  await page.waitForTimeout(400);

  const px1 = await centerPx();
  log('3D centre after stroke:', JSON.stringify(px1));
  log(px1 && px1[0] - px1[1] > 60 ? '✓ the model shows the stroke live' : '✗ no paint');
  log('active is still the model:', (await model()) !== null ? '✓' : '✗');
  const tabs = await page.locator('.doctab__name').allInnerTexts();
  log('tabs:', JSON.stringify(tabs), tabs.length === 2 ? '✓ background texture doc' : '✗');
  await shot('1-stroke-on-model');

  // ---- one drag = one undo step on the texture document ----------------------------
  await textureTab().click();
  await page.waitForTimeout(300);
  log('texture doc undo depth:', (await state.stores()).undo);
  const redInTexture = await state.countColor('#ED1C24');
  log('red texels painted:', redInTexture, redInTexture > 20 ? '✓' : '✗');
  await shot('2-texture-doc-behind');

  // ---- Ctrl+Z FROM THE MODEL TAB undoes the texture stroke -------------------------
  await modelTab().click();
  await page.waitForTimeout(250);
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(400);
  const undone = await centerPx();
  log('after model-tab Ctrl+Z, centre:', JSON.stringify(undone));
  log(
    undone[0] < 150 && undone[0] > 60 && Math.abs(undone[0] - undone[1]) < 6
      ? '✓ undo routed to the texture document; the stone is grey again'
      : '✗ undo did not route',
  );
  await textureTab().click();
  await page.waitForTimeout(200);
  log('red texels after undo:', await state.countColor('#ED1C24'));

  // ---- cross-face segmentation ------------------------------------------------------
  await modelTab().click();
  await page.waitForTimeout(250);
  await page.keyboard.press('Digit1');
  await page.waitForTimeout(150);
  // Orbit so west AND south faces are both on screen.
  await page.mouse.move(cx, cy);
  await page.mouse.down({ button: 'middle' });
  await page.mouse.move(cx + 90, cy, { steps: 6 });
  await page.mouse.up({ button: 'middle' });
  await page.waitForTimeout(200);
  // Pen back to size 1 so texel counts are crisp.
  await page.keyboard.press('BracketLeft');
  await page.keyboard.press('BracketLeft');

  // Same-face jump: Bresenham fills the gap.
  await page.mouse.move(cx + 50, cy - 55);
  await page.mouse.down();
  await page.mouse.move(cx + 85, cy + 45); // one jump, no steps
  await page.mouse.up();
  await page.waitForTimeout(300);
  await textureTab().click();
  await page.waitForTimeout(250);
  const sameFace = await state.countColor('#ED1C24');
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(250);

  // Cross-face jump: west → south in one jump. No chord, and still ONE undo step.
  await modelTab().click();
  await page.waitForTimeout(250);
  await page.mouse.move(cx - 90, cy - 10);
  await page.mouse.down();
  await page.mouse.move(cx + 80, cy - 10); // one jump across the corner
  await page.mouse.up();
  await page.waitForTimeout(300);
  await textureTab().click();
  await page.waitForTimeout(250);
  const crossFace = await state.countColor('#ED1C24');
  const crossUndo = (await state.stores()).undo;
  log(`same-face jump painted ${sameFace}; cross-face jump painted ${crossFace}`);
  log(
    sameFace > 4 && crossFace <= 4 && crossFace >= 1
      ? '✓ same face interpolates; crossing a face stamps both ends only — no chord'
      : '✗ segmentation wrong',
  );
  log('cross-face undo depth:', crossUndo, crossUndo === 1 ? '✓ one stroke, one step' : '✗');
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(250);
  await shot('3-segmentation');

  // ---- eraser punches a cutout hole -------------------------------------------------
  await modelTab().click();
  await page.waitForTimeout(250);
  await page.keyboard.press('Digit1');
  await page.waitForTimeout(150);
  await page.keyboard.press('KeyE');
  await page.keyboard.press('BracketRight');
  await page.keyboard.press('BracketRight');
  await page.keyboard.press('BracketRight');
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 4, cy, { steps: 2 });
  await page.mouse.up();
  await page.waitForTimeout(400);
  const hole = await centerPx();
  log('after eraser, centre:', JSON.stringify(hole));
  // Alpha < 0.1 discards, so the surround shows through the hole: dark grey, not stone.
  log(hole[0] < 80 ? '✓ erased texels discard — a real hole in the model' : '✗ no hole');
  await shot('4-eraser-hole');
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(300);

  // ---- bucket and eyedropper --------------------------------------------------------
  await page.locator('.colorpanel .swatches').first().locator('.swatch').nth(7).click(); // blue
  await page.keyboard.press('KeyF');
  await page.mouse.click(cx, cy);
  await page.waitForTimeout(400);
  const afterFill = await centerPx();
  log('after bucket fill:', JSON.stringify(afterFill));
  log(afterFill[2] > 120 ? '✓ bucket filled the face texture' : '✗');

  await page.keyboard.press('KeyI');
  await page.mouse.click(cx, cy);
  await page.waitForTimeout(250);
  const picked = (await state.stores()).color;
  log('eyedropper picked:', picked, picked === '#00A2E8' ? '✓ the fill colour' : '✗');
  const toolAfter = (await state.stores()).tool;
  log('tool after pick:', toolAfter, toolAfter === 'bucket' ? '✓ momentary, hands back' : '✗');
  await shot('5-bucket-and-pick');

  // ---- marker parity: graded stroke works too --------------------------------------
  await page.locator('.colorpanel .swatches').first().locator('.swatch').nth(6).click(); // green
  await page.keyboard.press('KeyM');
  await page.mouse.move(cx - 40, cy - 30);
  await page.mouse.down();
  await page.mouse.move(cx + 40, cy + 30, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(400);
  await textureTab().click();
  await page.waitForTimeout(250);
  const greenish = await state.countColor('#22B14C', 90);
  log('marker painted green-ish texels:', greenish, greenish > 10 ? '✓' : '✗');
  await shot('6-marker');

  // ---- mixed histories: geometry after paint — undo takes the newest edit first ------
  const els = () => page.evaluate(() => window.__monet.modelElements().length);
  await modelTab().click();
  await page.waitForTimeout(250);
  const elsBefore = await els();
  await page.keyboard.press('KeyN'); // add cube: a geometry edit, newer than every stroke
  await page.waitForTimeout(250);
  const elsAdded = await els();
  await page.keyboard.press('Control+z'); // must remove the cube, not the older marker stroke
  await page.waitForTimeout(250);
  const elsUndone = await els();
  await textureTab().click();
  await page.waitForTimeout(250);
  const greenStill = await state.countColor('#22B14C', 90);
  log(`elements ${elsBefore} → ${elsAdded} → ${elsUndone}; green texels still ${greenStill}`);
  log(
    elsAdded === elsBefore + 1 && elsUndone === elsBefore && greenStill === greenish
      ? '✓ Ctrl+Z after a geometry edit undoes the geometry, not the older stroke'
      : '✗ mixed-history undo order wrong',
  );
  // With the cube gone the marker stroke is the newest edit — the next undo reaches it.
  await modelTab().click();
  await page.waitForTimeout(250);
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(250);
  await textureTab().click();
  await page.waitForTimeout(250);
  const greenGone = await state.countColor('#22B14C', 90);
  log(
    greenGone === 0
      ? '✓ next undo reaches back across histories to the stroke'
      : `✗ ${greenGone} green texels left`,
  );
  await shot('7-mixed-undo');
}
