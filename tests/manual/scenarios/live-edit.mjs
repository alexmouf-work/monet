/**
 * Four owner reports (2026-08-11), all about seeing the truth on screen while editing:
 *
 * 1. the highlighted pixel is not the one that gets edited (the paint is right, the outline is not)
 * 2. a stroke only appears on pointer-UP, not while drawing — same for pasted content
 * 3. transparent pixels in pasted content erase what is behind instead of showing it through
 * 4. selected pixels should drag and drop; cut+paste shows an outline then leaves TWO copies
 *
 * Every check reads the VISIBLE canvas, not the document model: "it is in the buffer" was true
 * for all of these already — the complaint is that the screen disagreed.
 */

/** Count pixels close to a colour on the real viewport canvas (what the user is looking at). */
const screenCount = (page, rgb, tol = 40) =>
  page.evaluate(
    ([want, t]) => {
      const el = document.querySelector('.workspace:not(.workspace--model) .workspace__canvas');
      const ctx = el.getContext('2d');
      const { data } = ctx.getImageData(0, 0, el.width, el.height);
      let n = 0;
      for (let i = 0; i < data.length; i += 4) {
        if (
          Math.abs(data[i] - want[0]) <= t &&
          Math.abs(data[i + 1] - want[1]) <= t &&
          Math.abs(data[i + 2] - want[2]) <= t &&
          data[i + 3] > 128
        )
          n++;
      }
      return n;
    },
    [rgb, tol],
  );

const RED = [237, 28, 36];
const BLUE = [0, 162, 232];

/** Matching pixels in the raster layers alone — no float, no stroke overlay, no background. */
const layerCount = (page, hex) => page.evaluate((h) => window.__monet.layerColorCount(h, 40), hex);

const RED_HEX = '#ED1C24';
const BLUE_HEX = '#00A2E8';

export default async function ({ page, ui, shot, state, log }) {
  await ui.newDoc(32);
  await ui.tab('Brushes');
  await ui.tool('Pixel pen');

  // ---- 1. the outlined pixel must be the painted pixel -------------------------------
  // Read the outline where the pointer actually is, then click WITHOUT MOVING and compare it
  // with the pixels that landed. Comparing against an idealised doc coordinate would not do:
  // screen→doc rounding puts the real hover a fraction away from the requested one, and it is
  // the real one both the outline and the stamp must agree about.
  await ui.paletteColor(3); // red
  let outlineOk = 0;
  const sizes = [1, 2, 3, 4, 5];
  for (const size of sizes) {
    await ui.setNumber('Size', size);
    const p = await ui.atDoc(6.7 + size * 3, 5.4 + size * 2);
    await page.mouse.move(p.x, p.y);
    await page.waitForTimeout(150);
    const outline = await page.evaluate(() => window.__monet.brushOutline());
    await page.mouse.down();
    await page.mouse.up();
    await page.waitForTimeout(250);
    const painted = await page.evaluate(() => window.__monet.layerBounds());
    const hit =
      !!outline &&
      !!painted &&
      painted.x === outline.x &&
      painted.y === outline.y &&
      painted.w === size &&
      painted.h === size;
    if (hit) outlineOk++;
    log(
      `size ${size}: outlined ${JSON.stringify(outline)} · painted ${JSON.stringify(painted)}`,
      hit ? '✓' : '✗ the outline is not on the pixel that gets painted',
    );
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(200);
  }
  log(
    outlineOk === sizes.length
      ? '✓ every tip size outlines exactly the pixels it paints'
      : `✗ ${sizes.length - outlineOk}/${sizes.length} sizes highlight the wrong pixel`,
  );
  await shot('1-outline');

  // ---- 2. the stroke must be on screen DURING the drag -------------------------------
  await ui.setNumber('Size', 6);
  await ui.paletteColor(3); // red
  const a = await ui.atDoc(4, 4);
  const b = await ui.atDoc(28, 4);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 12 });
  await page.waitForTimeout(250); // still HELD DOWN
  const midDrag = await screenCount(page, RED);
  await page.mouse.up();
  await page.waitForTimeout(300);
  const afterUp = await screenCount(page, RED);
  log('red on screen mid-drag:', midDrag, '· after mouse-up:', afterUp);
  log(
    midDrag > 0 && midDrag >= afterUp * 0.8
      ? '✓ the stroke is visible while drawing, not only once the button is released'
      : '✗ the stroke only appears on pointer-up',
  );
  await shot('2-mid-drag');

  // Erasing must preview live too.
  await ui.tool('Eraser');
  await ui.setNumber('Size', 8);
  const c = await ui.atDoc(10, 4);
  const d = await ui.atDoc(22, 4);
  await page.mouse.move(c.x, c.y);
  await page.mouse.down();
  await page.mouse.move(d.x, d.y, { steps: 10 });
  await page.waitForTimeout(250);
  const midErase = await screenCount(page, RED);
  await page.mouse.up();
  await page.waitForTimeout(300);
  const afterErase = await screenCount(page, RED);
  log('red on screen mid-erase:', midErase, '· after mouse-up:', afterErase);
  log(
    midErase <= afterErase * 1.2
      ? '✓ the eraser previews live'
      : '✗ the erase only lands on pointer-up',
  );
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(250);
  await shot('3-mid-erase');

  // ---- 3+4. selection: drag to move, live float, no duplicate on cut+paste ------------
  await ui.tool('Pixel pen');
  await ui.paletteColor(7); // blue
  await ui.setNumber('Size', 4);
  await ui.drag(await ui.atDoc(4, 24), await ui.atDoc(28, 24));
  await page.waitForTimeout(250);
  const blueStart = await layerCount(page, BLUE_HEX);
  log('blue texels painted:', blueStart);

  await page.click('.topbar__tools .iconbtn[title^="Select"]');
  await ui.drag(await ui.atDoc(2, 21), await ui.atDoc(30, 27));
  await page.waitForTimeout(200);

  // Drag from inside the marquee: the pixels must come with the pointer, visibly.
  const from = await ui.atDoc(16, 24);
  const to = await ui.atDoc(16, 14);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.waitForTimeout(250); // still HELD
  // Where the blue is ON SCREEN, not just how much of it: a stale composite still shows the
  // old band, so "some blue is visible" would pass while the pixels sit ten rows behind the
  // pointer. The band must have arrived at row 14.
  const blueRow = await page.evaluate(
    ([want, t]) => {
      const el = document.querySelector('.workspace:not(.workspace--model) .workspace__canvas');
      const { data } = el.getContext('2d').getImageData(0, 0, el.width, el.height);
      let sum = 0;
      let n = 0;
      for (let i = 0; i < data.length; i += 4) {
        if (
          data[i + 3] > 128 &&
          Math.abs(data[i] - want[0]) <= t &&
          Math.abs(data[i + 1] - want[1]) <= t &&
          Math.abs(data[i + 2] - want[2]) <= t
        ) {
          sum += Math.floor(i / 4 / el.width);
          n++;
        }
      }
      return n ? { rows: n, mid: Math.round(sum / n), h: el.height } : null;
    },
    [BLUE, 40],
  );
  const floatState = await page.evaluate(() => window.__monet.stores().selection);
  log('blue on screen mid-drag:', JSON.stringify(blueRow), '· sel:', JSON.stringify(floatState));
  // The band was painted at doc row 24 of 32 and dragged to row 14 — so it must now sit ABOVE
  // the middle of the canvas.
  log(
    blueRow &&
      blueRow.rows > blueStart * 0.5 &&
      blueRow.mid < blueRow.h * 0.5 &&
      floatState?.floating
      ? '✓ selected pixels move with the pointer and stay visible at the new place'
      : '✗ dragging a selection does not carry the pixels on screen',
  );
  await page.mouse.up();
  await page.waitForTimeout(200);
  await shot('4-dragged');

  // Clicking outside must ANCHOR the float, not throw the pixels away.
  const away = await ui.atDoc(2, 2);
  await page.mouse.click(away.x, away.y);
  await page.waitForTimeout(300);
  const afterAnchor = await layerCount(page, BLUE_HEX);
  log('blue texels after clicking away:', afterAnchor);
  log(
    afterAnchor >= blueStart * 0.9
      ? '✓ clicking outside anchored the moved pixels instead of discarding them'
      : '✗ the lifted pixels were lost',
  );

  // ---- cut + paste: exactly ONE copy, visible immediately ----------------------------
  await ui.drag(await ui.atDoc(2, 11), await ui.atDoc(30, 17));
  await page.waitForTimeout(200);
  await page.keyboard.press('Control+x');
  await page.waitForTimeout(600);
  const afterCut = await layerCount(page, BLUE_HEX);
  log('blue texels after cut:', afterCut, afterCut === 0 ? '✓ the cut emptied the region' : '✗');

  await page.keyboard.press('Control+v');
  await page.waitForTimeout(1200);
  const pastedOnScreen = await screenCount(page, BLUE);
  log('blue on screen right after paste:', pastedOnScreen);
  log(
    pastedOnScreen > 0
      ? '✓ the pasted pixels are drawn, not just outlined'
      : '✗ paste shows only the marquee outline',
  );
  await shot('5-pasted');

  await page.keyboard.press('Escape'); // anchor
  await page.waitForTimeout(400);
  const afterPaste = await layerCount(page, BLUE_HEX);
  log('blue texels after paste+anchor:', afterPaste, 'vs', blueStart, 'cut');
  log(
    afterPaste > 0 && afterPaste <= blueStart * 1.35
      ? '✓ cut+paste left exactly one copy'
      : `✗ ${(afterPaste / Math.max(1, blueStart)).toFixed(1)}× the pixels — duplicated`,
  );
  await shot('6-anchored');

  // ---- 3. transparent pixels must not erase what is behind ---------------------------
  // On a document with a COLOUR background, which is where this bites: copying used to take
  // the background with it, so every copied block came out fully opaque and stamped a solid
  // rectangle over whatever it landed on.
  await page.click('.doctabs__new');
  await page.locator('.dialog .chipbtn:has-text("32")').click();
  await page.locator('.dialog .segmented button:has-text("Colour")').click();
  await page.click('.dialog__actions .btn--primary');
  await page.waitForTimeout(400);
  log('background:', JSON.stringify((await state.doc()).background));

  await ui.tab('Brushes');
  await ui.tool('Pixel pen');
  await ui.paletteColor(3); // red
  await ui.setNumber('Size', 12);
  await ui.drag(await ui.atDoc(4, 24), await ui.atDoc(28, 24));
  await page.waitForTimeout(300);
  const redField = await layerCount(page, RED_HEX);
  log('red texels painted on the coloured background:', redField);

  // Copy a patch of BARE BACKGROUND — no art in it at all — and drop it on the red band.
  await page.click('.topbar__tools .iconbtn[title^="Select"]');
  await ui.drag(await ui.atDoc(4, 2), await ui.atDoc(28, 10));
  await page.waitForTimeout(200);
  await page.keyboard.press('Control+c');
  await page.waitForTimeout(700);
  await page.keyboard.press('Control+v');
  await page.waitForTimeout(1200);

  const f = await page.evaluate(() => window.__monet.stores().selection);
  log('pasted float:', JSON.stringify(f?.rect));
  const grab = await ui.atDoc(f.rect.x + f.rect.w / 2, f.rect.y + f.rect.h / 2);
  const drop = await ui.atDoc(f.rect.x + f.rect.w / 2, 24);
  await page.mouse.move(grab.x, grab.y);
  await page.mouse.down();
  await page.mouse.move(drop.x, drop.y, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  await page.keyboard.press('Escape'); // anchor it
  await page.waitForTimeout(500);

  const redAfter = await layerCount(page, RED_HEX);
  log(
    'red texels before:',
    redField,
    '· after dropping a bare-background block on them:',
    redAfter,
  );
  log(
    redAfter >= redField * 0.9
      ? '✓ empty space stays transparent when copied — what is behind shows through'
      : '✗ the copy took the background with it and painted over the art underneath',
  );
  await shot('7-transparent');
}
