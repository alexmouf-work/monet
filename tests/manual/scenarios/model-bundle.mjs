/**
 * Loading a Minecraft model from the user's own files — docs/11 §4.5 (owner request).
 *
 * Route 1: pick a model JSON, be told which textures it wants, supply one, placeholder the
 * other, open it, paint on the placeholder, and download the zip with the edit inside.
 * Route 2: point at a folder and have the textures found relative to the model.
 *
 * Both file pickers are stubbed the way the file-handler scenario stubs handles: the browser's
 * native dialogs cannot be driven, but everything downstream of them is the real code.
 */
import { makePng } from '../fixtures/jar.mjs';

export function beforeLoad() {
  delete window.showOpenFilePicker;
  delete window.showSaveFilePicker;
  delete window.showDirectoryPicker;
}

/** A model with two texture vars, one of which we will deliberately not supply. */
const MODEL = {
  parent: 'minecraft:block/cube_all',
  textures: { all: 'mymod:block/gear' },
};
const TWO_VAR_MODEL = {
  textures: { top: 'mymod:block/gear', side: 'mymod:block/missing_side' },
  elements: [
    {
      from: [0, 0, 0],
      to: [16, 16, 16],
      faces: {
        up: { texture: '#top' },
        north: { texture: '#side' },
        south: { texture: '#side' },
        east: { texture: '#side' },
        west: { texture: '#side' },
        down: { texture: '#top' },
      },
    },
  ],
};

export default async function ({ page, shot, log }) {
  // Fixture bytes, built here and handed to the stubbed pickers as real File objects.
  const gearPng = [
    ...makePng(16, 16, (x, y) =>
      ((x >> 2) + (y >> 2)) % 2 ? [40, 160, 90, 255] : [20, 90, 50, 255],
    ),
  ];

  /** Replace <input type=file> clicks with a fixed set of files. */
  const stubFilePicker = (files) =>
    page.evaluate((spec) => {
      const make = (f) =>
        new File([new Uint8Array(f.bytes)], f.name, {
          type: f.name.endsWith('.json') ? 'application/json' : 'image/png',
        });
      const list = spec.map(make);
      if (spec.some((f) => f.relative)) {
        list.forEach((f, i) => {
          Object.defineProperty(f, 'webkitRelativePath', { value: spec[i].relative });
        });
      }
      HTMLInputElement.prototype.click = function () {
        Object.defineProperty(this, 'files', { value: list, configurable: true });
        this.onchange?.(new Event('change'));
      };
    }, files);

  const bytesOf = (obj) => [...new TextEncoder().encode(JSON.stringify(obj))];

  // ---- route 1: pick the JSON --------------------------------------------------------
  await stubFilePicker([{ name: 'gear.json', bytes: bytesOf(TWO_VAR_MODEL) }]);
  await page.click('.topbar__menu');
  await page.click('text=Open Minecraft model…');
  await page.waitForTimeout(300);
  await page.click('.dialog .btn:has-text("Choose model JSON…")');
  await page.waitForTimeout(600);

  const rows = () => page.locator('.needlist__row').allInnerTexts();
  log('needs after picking the JSON:', JSON.stringify(await rows()));
  const missingCount = await page.locator('.needlist__dot.is-missing').count();
  log(
    (await page.locator('.needlist__row').count()) === 2 && missingCount === 2
      ? '✓ the dialog asks for exactly the two textures the model references'
      : `✗ needs list wrong (${missingCount} missing)`,
  );
  await shot('1-needs');

  // Supply one texture for the specific row that wants it…
  await stubFilePicker([{ name: 'gear.png', bytes: gearPng }]);
  await page
    .locator('.needlist__row', { hasText: 'gear.png' })
    .locator('.btn:has-text("Add file…")')
    .click();
  await page.waitForTimeout(500);
  const found = await page.locator('.needlist__dot.is-found').count();
  log(
    'found after adding gear.png:',
    found,
    found === 1 ? '✓ matched to the row that wanted it' : '✗',
  );

  // …and placeholder the one we do not have.
  await page
    .locator('.needlist__row', { hasText: 'missing_side' })
    .locator('.btn:has-text("Placeholder")')
    .click();
  await page.waitForTimeout(400);
  log(
    (await page.locator('.needlist__dot.is-placeholder').count()) === 1
      ? '✓ the missing texture takes the magenta/black placeholder'
      : '✗ placeholder not applied',
  );
  await shot('2-supplied');

  // ---- open it -----------------------------------------------------------------------
  await page.click('.dialog__actions .btn--primary');
  await page.waitForTimeout(1500);
  const model = await page.evaluate(() => window.__monet.model());
  log(
    'opened model:',
    JSON.stringify({
      name: model?.name,
      elements: model?.elements,
      textures: model?.textures,
      missing: model?.missing,
    }),
  );
  log(
    model &&
      model.elements === 1 &&
      model.missing.length === 0 &&
      Object.keys(model.textures).length === 2
      ? '✓ the model opened with both textures resolved — no unresolved refs'
      : '✗ the model did not open cleanly',
  );
  const px = await page.evaluate(() => window.__monet.modelCenterPixel());
  log('centre framebuffer pixel:', JSON.stringify(px));
  log(px && (px[0] > 20 || px[1] > 20) ? '✓ it renders' : '✗ black viewport');
  await shot('3-opened');

  // ---- paint on the placeholder face, then export the bundle -------------------------
  await page.keyboard.press('Digit1'); // front ortho — the south face uses #side (the placeholder)
  await page.waitForTimeout(300);
  await page.keyboard.press('KeyB');
  await page.keyboard.press('BracketRight');
  await page.keyboard.press('BracketRight');
  // A colour that is in neither the placeholder (magenta/black) nor the gear texture (greens).
  await page.locator('.colorpanel .swatches').first().locator('.swatch').nth(3).click(); // red
  await page.waitForTimeout(150);
  const box = await page.locator('.workspace--model .workspace__canvas').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 20, box.y + box.height / 2, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(600);
  log('painted on the placeholder face');

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    (async () => {
      await page.click('.topbar__right .iconbtn[title^="Export"]');
      await page.waitForTimeout(400);
      await page.selectOption('.dialog select', {
        label: 'Model bundle (.zip — model + every texture)',
      });
      await page.click('.dialog__actions .btn--primary');
    })(),
  ]);
  const { readFileSync } = await import('node:fs');
  const zipBytes = readFileSync(await download.path());
  log('bundle:', download.suggestedFilename(), `${zipBytes.length} bytes`);

  // Read the zip back and check it carries everything, with the paint in it.
  const { default: JSZip } = await import('jszip');
  const zip = await JSZip.loadAsync(zipBytes);
  // JSZip lists directory entries too; only the files matter.
  const names = Object.keys(zip.files)
    .filter((n) => !zip.files[n].dir)
    .sort();
  log('zip contents:', JSON.stringify(names));
  const modelJson = JSON.parse(
    await zip.file(names.find((n) => n.endsWith('.json'))).async('string'),
  );
  const sidePng = await zip
    .file('assets/mymod/textures/block/missing_side.png')
    ?.async('uint8array');
  log(
    names.length === 3 &&
      names.some((n) => n.endsWith('gear.png')) &&
      names.some((n) => n.endsWith('missing_side.png')) &&
      !!modelJson.elements
      ? '✓ the zip holds the model JSON and both textures at their asset paths'
      : '✗ zip contents wrong',
  );
  // Decode the exported placeholder in the page and look for the red we painted, so this is a
  // real "my edit came back out" check rather than a byte-length guess.
  const redInExport = await page.evaluate(
    async (bytes) => {
      const blob = new Blob([new Uint8Array(bytes)], { type: 'image/png' });
      const bmp = await createImageBitmap(blob);
      const c = new OffscreenCanvas(bmp.width, bmp.height);
      const ctx = c.getContext('2d');
      ctx.drawImage(bmp, 0, 0);
      const { data } = ctx.getImageData(0, 0, bmp.width, bmp.height);
      let red = 0;
      for (let i = 0; i < data.length; i += 4) {
        if (data[i] > 180 && data[i + 1] < 80 && data[i + 2] < 80) red++;
      }
      return { red, w: bmp.width, h: bmp.height };
    },
    [...(sidePng ?? [])],
  );
  log('exported placeholder:', JSON.stringify(redInExport));
  log(
    redInExport.red > 0
      ? '✓ the paint I put on the placeholder came back out in the zip'
      : '✗ the export lost the edit',
  );
  await shot('4-exported');

  // ---- route 2: a folder, textures found relative to the model ------------------------
  await stubFilePicker([
    {
      name: 'gear.json',
      bytes: bytesOf(MODEL),
      relative: 'pack/assets/mymod/models/block/gear.json',
    },
    { name: 'gear.png', bytes: gearPng, relative: 'pack/assets/mymod/textures/block/gear.png' },
  ]);
  await page.click('.topbar__menu');
  await page.click('text=Open Minecraft model…');
  await page.waitForTimeout(300);
  await page.click('.dialog .btn:has-text("Choose the folder it lives in…")');
  await page.waitForTimeout(800);
  const folderMissing = await page.locator('.needlist__dot.is-missing').count();
  const folderFound = await page.locator('.needlist__dot.is-found').count();
  log('folder route — found:', folderFound, 'missing:', folderMissing);
  log(
    folderFound === 1 && folderMissing === 0
      ? '✓ the texture next to the model was found automatically, nothing to ask for'
      : '✗ folder resolution failed',
  );
  await shot('5-folder');
  await page.click('.dialog__actions .btn--primary');
  await page.waitForTimeout(1200);
  const m2 = await page.evaluate(() => window.__monet.model());
  log('second model:', JSON.stringify({ name: m2?.name, missing: m2?.missing }));
  log(
    m2 && m2.missing.length === 0
      ? '✓ it opened straight from the folder with its parent chain resolved'
      : '✗ the folder model did not open cleanly',
  );
  await shot('6-folder-opened');
}
