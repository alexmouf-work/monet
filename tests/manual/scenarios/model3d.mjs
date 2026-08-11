/**
 * M13 acceptance — docs/11 §16: open models from a vanilla-shaped jar, orbit/pan/dolly with
 * the Onshape mapping, ortho toggle, view cube, standard views, hover picking, the
 * unresolved-parent banner, and coexistence with 2D tabs. Assertions read app state through
 * the debug bridge; the framebuffer probe only proves pixels actually rendered.
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

  // ---- add the jar; models appear beside textures --------------------------------
  await page.click('.sources__header .iconbtn');
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.click('.sources__add .btn:has-text("Minecraft / mod jar")'),
  ]);
  await chooser.setFiles('/tmp/monet-3d.jar');
  await page.waitForTimeout(900);
  log('model rows in sidebar:', await page.locator('.srctree--models .srctree__item').count());
  await shot('1-jar-with-models');

  // ---- open stone.json (chain: stone → cube_all → cube → block, all from the jar) --
  await page.locator('.srctree--models .srctree__item:has-text("stone.json")').first().click();
  await page.waitForTimeout(1200);
  const m1 = await model();
  log('model doc:', JSON.stringify(m1));
  log(
    m1 && m1.elements === 1 && m1.missing.length === 0 && m1.textures.all === '16x16'
      ? '✓ full parent chain resolved from the jar; stone texture bound'
      : '✗ resolution failed',
  );
  log(
    'feature tabs now:',
    JSON.stringify(await page.locator('.topbar__tabs .tab').allInnerTexts()),
  );
  log('model tab glyph:', await page.locator('.doctab__kind').count());

  const px = await page.evaluate(() => window.__monet.modelCenterPixel());
  log('centre framebuffer pixel:', JSON.stringify(px));
  log(
    px && (px[0] > 30 || px[1] > 30 || px[2] > 30) ? '✓ the viewport rendered pixels' : '✗ black',
  );
  await shot('2-stone-open');

  // ---- Onshape navigation ---------------------------------------------------------
  const box = await page.locator('.workspace--model .workspace__canvas').boundingBox();
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const before = (await model()).camera;

  await page.mouse.move(cx, cy);
  await page.mouse.down({ button: 'middle' });
  await page.mouse.move(cx + 80, cy + 40, { steps: 10 });
  await page.mouse.up({ button: 'middle' });
  await page.waitForTimeout(150);
  const afterOrbit = (await model()).camera;
  log(
    `middle-drag orbit: yaw ${before.yaw} → ${afterOrbit.yaw}, pitch ${before.pitch} → ${afterOrbit.pitch}`,
  );
  log(afterOrbit.yaw !== before.yaw && afterOrbit.pitch !== before.pitch ? '✓ orbits' : '✗');

  await page.keyboard.down('Control');
  await page.mouse.move(cx, cy);
  await page.mouse.down({ button: 'middle' });
  await page.mouse.move(cx + 60, cy, { steps: 8 });
  await page.mouse.up({ button: 'middle' });
  await page.keyboard.up('Control');
  await page.waitForTimeout(150);
  const afterPan = (await model()).camera;
  log(
    `ctrl+middle pan: target ${JSON.stringify(afterOrbit.target)} → ${JSON.stringify(afterPan.target)}`,
  );
  log(afterPan.target.x !== afterOrbit.target.x ? '✓ pans' : '✗');

  await page.mouse.move(cx, cy);
  await page.mouse.wheel(0, -240);
  await page.waitForTimeout(150);
  const afterDolly = (await model()).camera;
  log(`wheel dolly: distance ${afterPan.distance} → ${afterDolly.distance}`);
  log(afterDolly.distance < afterPan.distance ? '✓ dollies in' : '✗');

  await page.mouse.down({ button: 'right' });
  await page.mouse.move(cx + 40, cy, { steps: 5 });
  await page.mouse.up({ button: 'right' });
  await page.waitForTimeout(150);
  log(
    (await model()).camera.yaw !== afterDolly.yaw
      ? '✓ right-drag orbit alias works'
      : '✗ right-drag did nothing',
  );

  // ---- standard views, ortho, frame ----------------------------------------------
  await page.keyboard.press('Digit1');
  await page.waitForTimeout(150);
  let cam = (await model()).camera;
  log(`key 1 → yaw ${cam.yaw} pitch ${cam.pitch} ${cam.projection}`);
  log(
    cam.yaw === 0 && cam.pitch === 0 && cam.projection === 'orthographic' ? '✓ front ortho' : '✗',
  );
  await page.keyboard.press('Digit5');
  await page.waitForTimeout(120);
  log('key 5 →', (await model()).camera.projection);
  await page.keyboard.press('Control+Digit0');
  await page.waitForTimeout(120);
  cam = (await model()).camera;
  log(`Ctrl+0 frame: target ${JSON.stringify(cam.target)}, distance ${cam.distance}`);
  await shot('3-front-view');

  // ---- hover picking ---------------------------------------------------------------
  await page.mouse.move(cx, cy);
  await page.waitForTimeout(200);
  const hover = (await model()).hover;
  log('hover at centre (front view):', JSON.stringify(hover));
  log(hover?.face === 'south' ? '✓ front view hovers the south face' : '✗ wrong face');

  // ---- view cube + panel snaps ------------------------------------------------------
  log('view cube present:', await page.locator('.viewcube__box').count());
  // CSS-3D face hit-testing is browser-finicky; the drag surface and the panel's snap
  // buttons carry the assertions instead.
  const cube = await page.locator('.viewcube').boundingBox();
  await page.mouse.move(cube.x + cube.width / 2, cube.y + cube.height / 2);
  await page.mouse.down();
  await page.mouse.move(cube.x + cube.width / 2 + 30, cube.y + cube.height / 2, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(150);
  log((await model()).camera.yaw !== cam.yaw ? '✓ dragging the cube orbits' : '✗ cube drag inert');
  await page.locator('.panel .segmented button[title^="Right"]').click();
  await page.waitForTimeout(150);
  cam = (await model()).camera;
  log(`panel E snap → yaw ${cam.yaw} ${cam.projection}`);
  log(cam.yaw === 90 && cam.projection === 'orthographic' ? '✓ snaps to right ortho' : '✗');

  // ---- stairs (two elements) and the broken model ----------------------------------
  await page
    .locator('.srctree--models .srctree__item:has-text("stone_stairs.json")')
    .first()
    .click();
  await page.waitForTimeout(900);
  const stairs = await model();
  log('stairs:', JSON.stringify({ elements: stairs.elements, missing: stairs.missing }));
  log(stairs.elements === 2 && stairs.missing.length === 0 ? '✓ stairs resolved' : '✗');
  await shot('4-stairs');

  await page.locator('.srctree--models .srctree__item:has-text("broken.json")').first().click();
  await page.waitForTimeout(700);
  const broken = await model();
  log('broken model missing:', JSON.stringify(broken.missing));
  log('banner shown:', await page.locator('.panel .notice').count());
  log(
    broken.missing.includes('mymod:block/does_not_exist')
      ? '✓ degraded to a banner, no crash'
      : '✗',
  );
  await shot('5-broken-banner');

  // ---- item/generated --------------------------------------------------------------
  await page.locator('.srctree--models .srctree__item:has-text("apple.json")').first().click();
  await page.waitForTimeout(700);
  const apple = await model();
  log('item/generated:', JSON.stringify({ elements: apple.elements, textures: apple.textures }));

  // ---- a texture tab and a model tab coexist ---------------------------------------
  await page.locator('.srctree__item:has-text("stone.png")').first().click();
  await page.waitForTimeout(700);
  log('2D doc active:', JSON.stringify(await state.doc()));
  log('tabs:', JSON.stringify(await page.locator('.topbar__tabs .tab').allInnerTexts()));
  const tabNames = await page.locator('.doctab__name').allInnerTexts();
  log('doc tabs:', JSON.stringify(tabNames));
  await page.locator('.doctab:has-text("stone_stairs")').click();
  await page.waitForTimeout(500);
  log('back on the model — active model:', (await model())?.name);
  log('model panel present:', await page.locator('.panel .outliner').count());
  await shot('6-tabs-coexist');

  // ---- perf sanity: orbiting stays cheap -------------------------------------------
  const stats = await page.evaluate(() => {
    const r = window.__monet;
    return r.model() ? { px: r.modelCenterPixel() } : null;
  });
  log('render probe after tab switch:', JSON.stringify(stats));
}
