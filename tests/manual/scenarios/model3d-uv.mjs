/**
 * M17 acceptance — docs/11 §16: box-UV a cube onto a 64×32 sheet and see all six faces land
 * in the right places in both the UV panel and the 3D view. Plus the per-face editors:
 * numeric rects, rotation cycling, mirror-by-endpoint-swap, fit-to-face, copy/paste, face
 * on/off, and dragging rects on the panel canvas with texel snapping.
 */
import { writeModelJar } from '../fixtures/jar.mjs';

export function beforeLoad() {
  delete window.showOpenFilePicker;
  delete window.showSaveFilePicker;
  delete window.showDirectoryPicker;
}

export default async function ({ page, shot, state, log }) {
  await writeModelJar('/tmp/monet-3d.jar');

  const faces = async () => (await page.evaluate(() => window.__monet.modelElements()))[0].faces;
  const uvOf = async (face) => (await faces())[face]?.uv;
  const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  // ---- open gauge.json: a full cube whose #all is a 64×32 sheet ---------------------
  await page.click('.sources__header .iconbtn');
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.click('.sources__add .btn:has-text("Minecraft / mod jar")'),
  ]);
  await chooser.setFiles('/tmp/monet-3d.jar');
  await page.waitForTimeout(900);
  await page.locator('.srctree--models .srctree__item:has-text("gauge.json")').first().click();
  await page.waitForTimeout(1200);
  const m = await page.evaluate(() => window.__monet.model());
  log('gauge:', JSON.stringify(m));
  log(m?.textures?.all === '64x32' ? '✓ 64×32 sheet bound' : '✗ sheet not bound');
  log('north before box-UV:', JSON.stringify(await uvOf('north')));

  // ---- box-UV the element from the UV tab -------------------------------------------
  await page.click('.topbar__tabs .tab:has-text("UV")');
  await page.waitForTimeout(300);
  await page
    .locator('.field-row', { hasText: 'Box-UV' })
    .locator('button:has-text("Apply")')
    .click();
  await page.waitForTimeout(300);
  const after = await faces();
  const want = {
    up: [4, 0, 8, 8],
    down: [8, 0, 12, 8],
    east: [0, 8, 4, 16],
    north: [4, 8, 8, 16],
    west: [8, 8, 12, 16],
    south: [12, 8, 16, 16],
  };
  const allRight = Object.entries(want).every(([f, uv]) => eq(after[f]?.uv, uv));
  log(
    'after box-UV:',
    JSON.stringify(Object.fromEntries(Object.entries(after).map(([k, v]) => [k, v.uv]))),
  );
  log(allRight ? '✓ all six faces land at the classic cross positions' : '✗ box-UV wrong');
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(250);
  const undone = eq(await uvOf('north'), [0, 0, 16, 16]);
  await page.keyboard.press('Control+y');
  await page.waitForTimeout(250);
  log(
    undone && eq(await uvOf('north'), want.north)
      ? '✓ box-UV is ONE undo step (all six rects together)'
      : '✗ box-UV undo wrong',
  );
  await shot('1-box-uv');

  // ---- the 3D view agrees: fill the south face, the paint lands in south's rect -----
  await page.keyboard.press('Digit1'); // front ortho faces south
  await page.waitForTimeout(250);
  await page.keyboard.press('KeyF'); // bucket
  const box = await page.locator('.workspace--model .workspace__canvas').boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(400);
  await page.keyboard.press('Enter'); // open the sheet behind the face I'm looking at
  await page.waitForTimeout(600);
  const filled = await state.countColor('#000000'); // default colour; the sheet has no black
  const inRect = await page.evaluate(() => window.__monet.pixelAt(56, 24));
  const outRect = await page.evaluate(() => window.__monet.pixelAt(24, 24));
  log(
    `filled texels after bucket on south: ${filled}; sheet(56,24)=${JSON.stringify(inRect)} sheet(24,24)=${JSON.stringify(outRect)}`,
  );
  log(
    filled === 256 && inRect[0] === 0 && outRect[0] === 150
      ? '✓ the fill covers exactly south’s 16×16 box-UV cell — 3D and UV agree'
      : '✗ paint landed outside the mapped rect',
  );
  await shot('2-fill-lands-in-rect');

  // ---- back on the model: rotation, mirror, fit, copy/paste, face off/on ------------
  await page.locator('.doctab', { hasText: 'gauge' }).first().click();
  await page.waitForTimeout(300);
  await page.click('.topbar__tabs .tab:has-text("UV")');
  await page.waitForTimeout(300);
  await page.locator('.segmented button:has-text("⇋u")').click();
  await page.waitForTimeout(200);
  log(eq(await uvOf('north'), [8, 8, 4, 16]) ? '✓ mirror U swaps the endpoints' : '✗ mirror');
  await page.locator('button[title="Rotate the face texture 90°"]').click();
  await page.waitForTimeout(200);
  log((await faces()).north.rotation === 90 ? '✓ rotation cycles to 90°' : '✗ rotation');
  await page.locator('button:has-text("Fit")').click();
  await page.waitForTimeout(200);
  log(
    eq(await uvOf('north'), [0, 0, 16, 16]) && (await faces()).north.rotation === 90
      ? '✓ fit-to-face resets the rect to the vanilla projection (rotation kept)'
      : '✗ fit wrong',
  );
  await page.locator('button:has-text("Copy UV")').click();
  await page.locator('.segmented button[title^="south"]').click();
  await page.waitForTimeout(200);
  await page.locator('button:has-text("Paste UV")').click();
  await page.waitForTimeout(200);
  const south = (await faces()).south;
  log(
    eq(south.uv, [0, 0, 16, 16]) && south.rotation === 90
      ? '✓ copy/paste carries rect + rotation across faces'
      : '✗ paste wrong',
  );
  await page.locator('button:has-text("Off")').click();
  await page.waitForTimeout(200);
  const offGone = (await faces()).south === undefined;
  await page.locator('button:has-text("+ Add face")').click();
  await page.waitForTimeout(200);
  const back = (await faces()).south;
  log(
    offGone && back && eq(back.uv, [0, 0, 16, 16]) && back.texture === 'all'
      ? '✓ face off removes it; add face returns it at the fitted rect on #all'
      : '✗ face on/off wrong',
  );
  await shot('3-face-editors');

  // ---- drag the north rect on the panel canvas, texel-snapped, one undo step --------
  await page.locator('.segmented button[title^="north"]').click();
  await page.waitForTimeout(200);
  await page
    .locator('.field-row', { hasText: 'Box-UV' })
    .locator('button:has-text("Apply")')
    .click();
  await page.waitForTimeout(250); // north back to [4,8,8,16]
  await page.locator('.uvcanvas').scrollIntoViewIfNeeded();
  const cv = await page.locator('.uvcanvas').boundingBox();
  const texX = (t) => cv.x + (t / 64) * cv.width;
  const texY = (t) => cv.y + (t / 32) * cv.height;
  log(
    'grab point hits:',
    await page.evaluate(
      ([x, y]) => document.elementFromPoint(x, y)?.className ?? 'nothing',
      [texX(24), texY(24)],
    ),
  );
  await page.mouse.move(texX(24), texY(24)); // north rect centre (texels)
  await page.mouse.down();
  await page.mouse.move(texX(28), texY(24), { steps: 6 }); // +4 texels = +1 uv unit
  await page.mouse.up();
  await page.waitForTimeout(300);
  const dragged = await uvOf('north');
  log('north after +4-texel drag:', JSON.stringify(dragged));
  log(eq(dragged, [5, 8, 9, 16]) ? '✓ rect drag moves on the texel lattice' : '✗ drag wrong');
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(250);
  log(
    eq(await uvOf('north'), [4, 8, 8, 16])
      ? '✓ the whole drag is one undoable command'
      : '✗ drag undo wrong',
  );
  await shot('4-rect-drag');
}
