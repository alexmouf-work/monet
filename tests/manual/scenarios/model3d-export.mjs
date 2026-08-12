/**
 * M19 acceptance — docs/11 §16: read → edit → write a vanilla model and diff cleanly against
 * the original except for the intended change; plus the other export routes (Bedrock geometry,
 * `.monet_model`, render-to-PNG from the live camera).
 */
import { writeModelJar } from '../fixtures/jar.mjs';
import { readFileSync } from 'node:fs';

export function beforeLoad() {
  delete window.showOpenFilePicker;
  delete window.showSaveFilePicker;
  delete window.showDirectoryPicker;
}

export default async function ({ page, shot, log, outDir }) {
  await writeModelJar('/tmp/monet-3d.jar');
  const original = JSON.parse(
    // The fixture's stone.json: parent + one texture var, no elements of its own.
    '{"parent":"minecraft:block/cube_all","textures":{"all":"minecraft:block/stone"}}',
  );

  const download = async (fn) => {
    const [dl] = await Promise.all([page.waitForEvent('download'), fn()]);
    return { name: dl.suggestedFilename(), path: await dl.path() };
  };
  const exportAs = (label) =>
    download(async () => {
      await page.click('.topbar__right .iconbtn[title^="Export"]');
      await page.waitForTimeout(300);
      await page.selectOption('.dialog select', { label });
      await page.click('.dialog__actions .btn--primary');
    });

  // ---- open stone.json (a parent-only model) ---------------------------------------
  await page.click('.sources__header .iconbtn');
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.click('.sources__add .btn:has-text("Minecraft / mod jar")'),
  ]);
  await chooser.setFiles('/tmp/monet-3d.jar');
  await page.waitForTimeout(900);
  await page.locator('.srctree--models .srctree__item:has-text("stone.json")').first().click();
  await page.waitForTimeout(1200);

  // ---- save with NO edit: the file must come back as it went in --------------------
  const clean = await download(() => page.keyboard.press('Control+s'));
  const cleanJson = JSON.parse(readFileSync(clean.path, 'utf8'));
  log('untouched save:', JSON.stringify(cleanJson));
  log(
    JSON.stringify(cleanJson) === JSON.stringify(original)
      ? '✓ read → write with no edit reproduces the original exactly (parent kept, no flattening)'
      : '✗ untouched save differs from the source',
  );

  // ---- edit one number, save again: only that changes -------------------------------
  await page.click('.topbar__tabs .tab:has-text("Model")');
  await page.locator('.outliner__row--btn').first().click();
  await page.waitForTimeout(200);
  const row = page.locator('.field-row', { hasText: 'To' }).first();
  const input = row.locator('.numfield input').nth(1); // to.y
  await input.fill('12');
  await input.press('Enter');
  await page.waitForTimeout(250);
  const edited = await download(() => page.keyboard.press('Control+s'));
  const editedJson = JSON.parse(readFileSync(edited.path, 'utf8'));
  log('edited save keys:', JSON.stringify(Object.keys(editedJson)));
  log('element to:', JSON.stringify(editedJson.elements?.[0]?.to));
  log(
    editedJson.parent === original.parent &&
      JSON.stringify(editedJson.textures) === JSON.stringify(original.textures) &&
      editedJson.elements?.length === 1 &&
      JSON.stringify(editedJson.elements[0].to) === '[16,12,16]'
      ? '✓ the edit added elements and changed only the edited number'
      : '✗ edited save wrong',
  );
  await shot('1-java-round-trip');

  // ---- Bedrock geometry -------------------------------------------------------------
  const geo = await exportAs('Bedrock geometry (.geo.json)');
  const geoJson = JSON.parse(readFileSync(geo.path, 'utf8'));
  const cube = geoJson['minecraft:geometry']?.[0]?.bones?.[0]?.cubes?.[0];
  log('geo file:', geo.name, 'format:', geoJson.format_version);
  log('cube:', JSON.stringify({ origin: cube?.origin, size: cube?.size }));
  log(
    geo.name.endsWith('.geo.json') &&
      geoJson.format_version === '1.12.0' &&
      JSON.stringify(cube?.origin) === '[-8,0,-8]' &&
      JSON.stringify(cube?.size) === '[16,12,16]' &&
      cube?.uv?.north?.uv_size?.[0] === 16
      ? '✓ Bedrock geometry converted: mirrored origin, size, per-face uv in pixels'
      : '✗ bedrock export wrong',
  );

  // ---- .monet_model project ---------------------------------------------------------
  const proj = await exportAs('Monet project (.monet_model)');
  const bytes = readFileSync(proj.path);
  log('project file:', proj.name, `${bytes.length} bytes`);
  log(
    proj.name.endsWith('.monet_model') && bytes[0] === 0x50 && bytes[1] === 0x4b
      ? '✓ .monet_model is a real zip container'
      : '✗ project export wrong',
  );

  // ---- render to PNG from the live camera -------------------------------------------
  await page.keyboard.press('Digit1'); // front ortho, so the render is a flat face
  await page.waitForTimeout(300);
  const png = await exportAs('Render to PNG (current camera)');
  const pngBytes = readFileSync(png.path);
  const sig = [...pngBytes.subarray(0, 8)].join(',');
  const width = pngBytes.readUInt32BE(16);
  const height = pngBytes.readUInt32BE(20);
  log('render:', png.name, `${width}×${height}`, `${pngBytes.length} bytes`);
  log(
    sig === '137,80,78,71,13,10,26,10' && width > 200 && height > 200
      ? '✓ render-to-PNG produced a real PNG at framebuffer size'
      : '✗ png render wrong',
  );
  // The render must be the MODEL, not the editor: transparent corner (no surround), and the
  // block's own colour rather than the accent tint of the still-selected element.
  const probe = await page.evaluate(
    async ([dataLen]) => {
      void dataLen;
      const frame = window.__monet.modelFrame();
      if (!frame) return null;
      const at = (x, y) => {
        const i = (y * frame.width + x) * 4;
        return [frame.pixels[i], frame.pixels[i + 1], frame.pixels[i + 2], frame.pixels[i + 3]];
      };
      return {
        corner: at(2, 2),
        centre: at(frame.width >> 1, frame.height >> 1),
        opaque: frame.pixels.filter((_, i) => i % 4 === 3 && frame.pixels[i] > 200).length,
      };
    },
    [pngBytes.length],
  );
  log('render probe:', JSON.stringify(probe));
  const [cr, cg, cb] = probe?.centre ?? [];
  log(
    probe && probe.corner[3] === 0 && probe.centre[3] === 255 && Math.abs(cr - cb) < 12 && cg >= cr
      ? '✓ clean render: transparent background, block colour not the selection tint'
      : '✗ the render carried editor chrome',
  );
  // Keep the render next to the shots: downloads live in a temp dir the browser wipes on
  // close, and a render feature is worth eyeballing rather than only byte-checking.
  const { writeFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  writeFileSync(join(outDir, 'render.png'), pngBytes);
  log('kept the render at render.png');
  await shot('2-exports');
}
