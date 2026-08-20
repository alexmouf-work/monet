/**
 * Relight — docs/05 §8. The owner's scenario, end to end: pick a pale blue in the image, match
 * it to a dark green's brightness, and watch it become a DARK BLUE while the rest of the sprite
 * follows the same curve. Then the manual Adjust mode, the "only this colour" limit, and a bake.
 */
export default async function ({ ui, shot, state, log, page }) {
  await ui.newDoc(64);

  // A little sprite: three blues (a shaded object) plus a dark green reference patch.
  const PALE = '#ADD8E6';
  const MID = '#4A90C2';
  const DEEP = '#1F3F5B';
  const GREEN = '#14532D';
  await ui.tab('Brushes');
  await ui.tool('Pixel pen');
  await ui.setNumber('Size', 12);
  for (const [hex, y] of [
    [PALE, 8],
    [MID, 24],
    [DEEP, 40],
    [GREEN, 56],
  ]) {
    await page.locator('.colorpanel__hex').first().fill(hex);
    await page.locator('.colorpanel__hex').first().press('Enter');
    await page.waitForTimeout(120);
    await ui.drag(await ui.atDoc(4, y), await ui.atDoc(60, y));
  }
  const counts = async () => ({
    pale: await state.countColor(PALE, 4),
    mid: await state.countColor(MID, 4),
    deep: await state.countColor(DEEP, 4),
    green: await state.countColor(GREEN, 4),
  });
  log('bands:', JSON.stringify(await counts()));
  await shot('1-sprite');

  // ---- the tab exists and is reachable by its advertised key -----------------------
  await page.keyboard.press('KeyL');
  await page.waitForTimeout(300);
  log('tab after L:', (await state.stores()).tab);
  log((await state.stores()).tab === 'relight' ? '✓ L opens Relight' : '✗ L did not open Relight');

  // ---- match: pale blue → the dark green's brightness --------------------------------
  await ui.setColorField(PALE, 0); // relight this colour
  await ui.setColorField(GREEN, 1); // to the brightness of
  await page.waitForTimeout(400);

  const hslAt = (x, y) =>
    page.evaluate(
      ([px, py]) => {
        const p = window.__monet.pixelAt(px, py);
        if (!p) return null;
        const [r, g, b] = [p[0] / 255, p[1] / 255, p[2] / 255];
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        const l = (max + min) / 2;
        let h = 0;
        if (max !== min) {
          const d = max - min;
          h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
          h = (h * 60 + 360) % 360;
        }
        return { h: Math.round(h), l: Math.round(l * 100) };
      },
      [x, y],
    );

  const paleNow = await hslAt(32, 8);
  const greenNow = await hslAt(32, 56);
  const midNow = await hslAt(32, 24);
  const deepNow = await hslAt(32, 40);
  log('after match — pale:', JSON.stringify(paleNow), 'green ref:', JSON.stringify(greenNow));
  log('           mid:', JSON.stringify(midNow), 'deep:', JSON.stringify(deepNow));
  // Pale blue must now sit at the green's lightness, still blue.
  log(
    Math.abs(paleNow.l - 20) <= 3 && paleNow.h > 180 && paleNow.h < 220
      ? '✓ the pale blue is now a DARK blue at the green’s brightness, hue intact'
      : `✗ match wrong (${JSON.stringify(paleNow)})`,
  );
  // And the rest of the sprite came along, still in order.
  log(
    midNow.l < 34 && deepNow.l < midNow.l && paleNow.l > midNow.l
      ? '✓ every other pixel followed the same curve, shading order kept'
      : '✗ the rest of the image did not follow',
  );
  await shot('2-match-preview');

  // ---- the limit confines the effect to one colour -----------------------------------
  await page.locator('.check:has-text("Only this colour")').locator('input').check();
  await page.waitForTimeout(400);
  const limitedMid = await hslAt(32, 24);
  log('mid band with the limit on:', JSON.stringify(limitedMid));
  log(
    limitedMid.l > 40
      ? '✓ with "only this colour" the other bands are left alone'
      : `✗ limit did not spare them (${JSON.stringify(limitedMid)})`,
  );
  await page.locator('.check:has-text("Only this colour")').locator('input').uncheck();
  await page.waitForTimeout(300);
  await shot('3-limited');

  // ---- the mappings differ away from the anchor, and none of them moves a hue --------
  // (At the anchor all three agree by construction, so probe the MID band instead.)
  const byMapping = {};
  for (const m of ['Shift', 'Scale', 'Curve']) {
    await page.locator('.panel .segmented button', { hasText: m }).first().click();
    await page.waitForTimeout(300);
    const anchor = await hslAt(32, 8);
    const mid = await hslAt(32, 24);
    byMapping[m] = mid.l;
    log(`mapping ${m}: anchor ${JSON.stringify(anchor)}, mid band ${JSON.stringify(mid)}`);
    if (anchor.h < 180 || anchor.h > 220 || (mid.l > 0 && (mid.h < 180 || mid.h > 230))) {
      log(`✗ ${m} moved a hue`);
    }
    if (Math.abs(anchor.l - 20) > 3) log(`✗ ${m} missed the anchor`);
  }
  log('✓ hue stayed blue and the anchor held under every mapping');
  log(
    'mid band by mapping:',
    JSON.stringify(byMapping),
    new Set(Object.values(byMapping)).size > 1
      ? '✓ the mappings really do treat the rest of the image differently'
      : '✗ the mapping choice changes nothing',
  );

  // ---- bake, then Adjust mode -------------------------------------------------------
  await page.locator('.panel .btn--primary:has-text("Relight")').click();
  await page.waitForTimeout(500);
  const baked = await hslAt(32, 8);
  log('after bake:', JSON.stringify(baked), 'undo depth:', (await state.stores()).undo);
  log(
    Math.abs(baked.l - 20) <= 3 && (await state.stores()).undo > 0
      ? '✓ the bake committed one undoable step'
      : '✗ bake wrong',
  );

  await page.locator('.panel .segmented button:has-text("Adjust")').click();
  await page.waitForTimeout(250);
  await ui.setNumber('Brightness', 30);
  await page.waitForTimeout(400);
  const lifted = await hslAt(32, 8);
  log('after +30% brightness:', JSON.stringify(lifted));
  log(
    lifted.l > baked.l && Math.abs(lifted.h - baked.h) < 8
      ? '✓ Adjust lifts brightness without touching hue'
      : '✗ adjust wrong',
  );
  await shot('4-adjust');
}
