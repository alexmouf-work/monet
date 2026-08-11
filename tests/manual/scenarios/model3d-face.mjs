/**
 * M14 acceptance — docs/11 §16: face → texture (double-click, middle-click, Enter,
 * viewport-centre fallback), the uv-rect selection, re-focus instead of duplicate tabs,
 * and the LIVE two-way link: painting the 2D texture recolours the 3D model without a save.
 */
import { writeModelJar } from '../fixtures/jar.mjs';

export function beforeLoad() {
  delete window.showOpenFilePicker;
  delete window.showSaveFilePicker;
  delete window.showDirectoryPicker;
}

export default async function ({ page, ui, shot, state, log }) {
  await writeModelJar('/tmp/monet-3d.jar');
  const model = () => page.evaluate(() => window.__monet.model());

  await page.click('.sources__header .iconbtn');
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.click('.sources__add .btn:has-text("Minecraft / mod jar")'),
  ]);
  await chooser.setFiles('/tmp/monet-3d.jar');
  await page.waitForTimeout(900);
  await page.locator('.srctree--models .srctree__item:has-text("stone.json")').first().click();
  await page.waitForTimeout(1000);

  // Front view so geometry is predictable: the whole south face fills the viewport centre.
  await page.keyboard.press('Digit1');
  await page.waitForTimeout(200);
  const box = await page.locator('.workspace--model .workspace__canvas').boundingBox();
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;

  // ---- double-click a face opens its texture with the uv rect selected -------------
  await page.mouse.dblclick(cx, cy);
  await page.waitForTimeout(800);
  const doc = await state.doc();
  const stores = await state.stores();
  log('opened doc:', JSON.stringify(doc));
  log('selection:', JSON.stringify(stores.selection));
  log(
    doc?.name === 'stone' && stores.selection?.rect.w === 16 && stores.selection.rect.h === 16
      ? '✓ double-click opened stone.png with the full-face rect selected'
      : '✗',
  );
  log('tabs:', JSON.stringify(await page.locator('.doctab__name').allInnerTexts()));
  await shot('1-dblclick-opens-texture');

  // ---- the live link: paint red in 2D, the 3D model recolours, no save -------------
  await ui.tab('Brushes');
  await ui.paletteColor(3); // #ED1C24
  await ui.setNumber('Size', 16);
  await ui.click(await ui.atDoc(8, 8));
  await page.waitForTimeout(400);
  log('red px in 2D doc:', await state.countColor('#ED1C24'));

  await page.locator('.doctab:has-text("stone")').first().click(); // back to the model tab
  await page.waitForTimeout(500);
  const px = await page.evaluate(() => window.__monet.modelCenterPixel());
  log('3D centre pixel after painting in 2D:', JSON.stringify(px));
  log(
    px && px[0] > 120 && px[1] < 90
      ? '✓ the model shows the red paint live — no save involved'
      : '✗ model not updated',
  );
  await shot('2-live-link-red');

  // ---- Enter with nothing under the cursor: the face at the viewport centre --------
  await page.mouse.move(box.x + 8, box.y + 8); // hover empty surround
  await page.waitForTimeout(250);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(500);
  const backOnTexture = await state.doc();
  log('Enter → active doc:', backOnTexture?.name);
  log(backOnTexture?.name === 'stone' ? '✓ centre-of-viewport face resolved and re-focused' : '✗');
  const tabCount = (await page.locator('.doctab__name').allInnerTexts()).filter(
    (t) => t === 'stone',
  ).length;
  log('stone tabs (model + texture):', tabCount, tabCount === 2 ? '✓ no duplicate' : '✗ dup!');

  // ---- middle-click (no drag) opens too; drag still orbits -------------------------
  await page.locator('.doctab:has-text("stone")').first().click();
  await page.waitForTimeout(400);
  const camBefore = (await model()).camera;
  await page.mouse.move(cx + 40, cy);
  await page.mouse.down({ button: 'middle' });
  await page.mouse.up({ button: 'middle' });
  await page.waitForTimeout(500);
  log('middle-click → doc:', (await state.doc())?.name ?? '(none)');
  await page.locator('.doctab:has-text("stone")').first().click();
  await page.waitForTimeout(300);
  await page.mouse.move(cx, cy);
  await page.mouse.down({ button: 'middle' });
  await page.mouse.move(cx + 60, cy + 30, { steps: 8 });
  await page.mouse.up({ button: 'middle' });
  await page.waitForTimeout(300);
  const camAfter = (await model()).camera;
  log(
    camAfter.yaw !== camBefore.yaw && (await state.doc()) === null
      ? '✓ middle-DRAG still orbits without opening anything'
      : '✗ drag misbehaved',
  );

  // ---- UV guides shown in the 2D editor --------------------------------------------
  await page.keyboard.press('Digit1');
  await page.waitForTimeout(200);
  await page.mouse.dblclick(cx, cy);
  await page.waitForTimeout(500);
  await shot('3-uv-guides-over-texture');

  // ---- stairs: the side face selects its half-height rect --------------------------
  await page
    .locator('.srctree--models .srctree__item:has-text("stone_stairs.json")')
    .first()
    .click();
  await page.waitForTimeout(900);
  await page.keyboard.press('Digit1');
  await page.waitForTimeout(250);
  // South face of the base slab (lower half of the block): click below centre.
  await page.mouse.dblclick(cx, box.y + box.height * 0.72);
  await page.waitForTimeout(700);
  const sel2 = (await state.stores()).selection;
  log('stairs side-face selection:', JSON.stringify(sel2));
  log(
    sel2 && sel2.rect.y === 8 && sel2.rect.h === 8
      ? '✓ the slab side selected the lower-half uv rect'
      : '✗ wrong rect',
  );
  await shot('4-stairs-face-rect');
}
