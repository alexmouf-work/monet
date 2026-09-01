/**
 * Three owner requests (2026-08-11):
 *
 * 1. Negative values where the amount is symmetric — noise intensity and rotation, the tint
 *    and relight amounts. A negative reads the effect the other way round rather than doing
 *    nothing.
 * 2. The noise field pans by dragging the canvas, with an editable coordinate offset.
 * 3. The colour picker's SV square and hue strip show WHICH colour is selected. They had no
 *    marker at all; the native picker behind ColorField always had one, which is why this was
 *    "not an issue everywhere".
 */

const offsetFields = (page) =>
  page.evaluate(() => {
    const boxes = [...document.querySelectorAll('.panel .field-row label')]
      .filter((l) => /^[XY]$/.test(l.textContent.trim()[0]))
      .map((l) => l.querySelector('input'));
    return boxes.map((b) => b.value);
  });

/** Mean lightness of the composite — the number a noise preview moves. */
const meanLightness = (page) =>
  page.evaluate(() => {
    const el = document.querySelector('.workspace:not(.workspace--model) .workspace__canvas');
    const { data } = el.getContext('2d').getImageData(0, 0, el.width, el.height);
    let sum = 0;
    let n = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 128) continue;
      sum += (data[i] + data[i + 1] + data[i + 2]) / 3;
      n++;
    }
    return n ? Math.round(sum / n) : 0;
  });

/** A coarse signature of the visible canvas, so "the pattern moved" is provable. */
const signature = (page) =>
  page.evaluate(() => {
    const el = document.querySelector('.workspace:not(.workspace--model) .workspace__canvas');
    const { data } = el.getContext('2d').getImageData(0, 0, el.width, el.height);
    let h = 0;
    for (let i = 0; i < data.length; i += 64) h = (h * 31 + data[i]) | 0;
    return h;
  });

export default async function ({ page, ui, shot, state, log }) {
  await ui.newDoc(64);

  // A flat mid-grey field, so noise is the only thing that changes the picture.
  await ui.tab('Brushes');
  await ui.tool('Paint bucket');
  await ui.brushColor('#808080');
  await ui.click(await ui.atDoc(32, 32));
  await page.waitForTimeout(300);
  log('flat grey mean:', await meanLightness(page));
  await shot('1-grey');

  // ---- 3. the picker markers ------------------------------------------------------------
  const dot = page.locator('.colorpanel__dot');
  const hueDot = page.locator('.colorpanel__huedot');
  log('sv marker:', await dot.count(), '· hue marker:', await hueDot.count());
  const at = async (loc) => {
    const b = await loc.boundingBox();
    const w = await page.locator('.colorpanel__sv').boundingBox();
    return { x: (b.x + b.width / 2 - w.x) / w.width, y: (b.y + b.height / 2 - w.y) / w.height };
  };
  const greyPos = await at(dot);
  log('marker at grey #808080:', JSON.stringify(greyPos));

  await ui.brushColor('#FF0000'); // full saturation, full value → top-right of the square
  await page.waitForTimeout(250);
  const redPos = await at(dot);
  log('marker at red #FF0000:', JSON.stringify(redPos));
  log(
    (await dot.count()) === 1 &&
      (await hueDot.count()) === 1 &&
      redPos.x > 0.9 &&
      redPos.y < 0.1 &&
      greyPos.x < 0.1
      ? '✓ the picker shows which colour is selected, and the marker tracks it'
      : '✗ the picker marker is missing or in the wrong place',
  );
  await shot('2-picker-markers');

  // ---- 1+2. noise ------------------------------------------------------------------------
  await ui.tab('Noise');
  await page.waitForTimeout(400);
  log('tool while the Noise tab is open:', (await state.stores()).tool);
  log(
    (await state.stores()).tool === 'noisePan'
      ? '✓ opening Noise hands the canvas to the pan tool'
      : '✗ the noise pan tool did not take over',
  );

  await ui.setNumber('Intensity', 80);
  await page.waitForTimeout(500);
  const positive = await signature(page);
  const posMean = await meanLightness(page);
  log('intensity +80 · mean:', posMean);
  await shot('3-noise-positive');

  await ui.setNumber('Intensity', -80);
  await page.waitForTimeout(500);
  const negative = await signature(page);
  const negMean = await meanLightness(page);
  log('intensity −80 · mean:', negMean);
  log(
    negative !== positive
      ? '✓ a negative intensity is accepted and inverts the field'
      : '✗ the negative intensity did nothing',
  );
  await shot('4-noise-negative');

  await ui.setNumber('Intensity', 80);
  await page.waitForTimeout(400);

  // The offset boxes start at the origin…
  log('offset fields:', JSON.stringify(await offsetFields(page)));
  log(
    JSON.stringify(await offsetFields(page)) === '["0","0"]'
      ? '✓ the coordinate offset is shown, and starts at the origin'
      : '✗ no offset readout',
  );

  // …and dragging the canvas moves them, and the pattern with them.
  const beforeDrag = await signature(page);
  const a = await ui.atDoc(20, 20);
  const b = await ui.atDoc(44, 34);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(600);
  const dragged = await offsetFields(page);
  log('offset after dragging +24,+14:', JSON.stringify(dragged));
  log(
    Number(dragged[0]) === -24 &&
      Number(dragged[1]) === -14 &&
      (await signature(page)) !== beforeDrag
      ? '✓ dragging the canvas pans the noise, and the readout follows'
      : '✗ the drag did not pan the field',
  );
  await shot('5-noise-panned');

  // Typing into the offset moves it too — same state, either way in.
  const xBox = page.locator('.panel .field-row label:has-text("X") input');
  await xBox.fill('40');
  await xBox.press('Enter');
  await page.waitForTimeout(500);
  log('offset after typing X=40:', JSON.stringify(await offsetFields(page)));
  log(
    (await offsetFields(page))[0] === '40'
      ? '✓ the offset is editable as well as draggable'
      : '✗ typing the offset did not take',
  );

  // Negative coordinates are fine.
  await xBox.fill('-15');
  await xBox.press('Enter');
  await page.waitForTimeout(500);
  log('offset after typing X=−15:', JSON.stringify(await offsetFields(page)));
  log(
    (await offsetFields(page))[0] === '-15'
      ? '✓ the offset takes negative coordinates'
      : '✗ a negative coordinate was rejected',
  );
  await shot('6-noise-typed-offset');

  // ---- negative amounts elsewhere --------------------------------------------------------
  await ui.tab('Recolour');
  await page.waitForTimeout(300);
  await page.locator('.panel .segmented button:has-text("Tint")').click();
  await page.waitForTimeout(250);
  await ui.setColorField('#3FA7D6');
  await ui.setNumber('Amount', 100);
  await page.waitForTimeout(400);
  const tintPos = await page.evaluate(() => window.__monet.pixelAt(32, 32));
  await ui.setNumber('Amount', -100);
  await page.waitForTimeout(400);
  const tintNeg = await page.evaluate(() => window.__monet.pixelAt(32, 32));
  log('tint +100:', JSON.stringify(tintPos), '· −100:', JSON.stringify(tintNeg));
  log(
    JSON.stringify(tintPos) !== JSON.stringify(tintNeg) && tintNeg[2] < tintPos[2]
      ? '✓ a negative tint amount pushes away from the colour instead of doing nothing'
      : '✗ the negative tint amount was ignored',
  );

  await ui.tab('Relight');
  await page.waitForTimeout(300);
  // Brightness/Contrast live in Adjust mode; Match is the default.
  await page.locator('.panel .segmented button:has-text("Adjust")').click();
  await page.waitForTimeout(300);
  await ui.setNumber('Brightness', 40);
  await ui.setNumber('Amount', 100);
  await page.waitForTimeout(400);
  const relitUp = await meanLightness(page);
  await ui.setNumber('Amount', -100);
  await page.waitForTimeout(400);
  const relitDown = await meanLightness(page);
  log('relight amount +100 mean:', relitUp, '· −100 mean:', relitDown);
  log(
    relitDown < relitUp
      ? '✓ a negative relight amount is the opposite relight'
      : '✗ the negative relight amount was ignored',
  );
  await shot('7-negative-amounts');
}
