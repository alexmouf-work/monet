/**
 * Sources — docs/08. Adds a jar (read-only browse) and a GitHub repo whose API is mocked at
 * the network layer, then drives the whole owner workflow: open a texture, edit it, Ctrl+S
 * (one commit + push of PNG *and* .monet mirror), and Sync (fast-forward, then merge).
 */
/** Headless Chromium exposes the FS Access pickers but never resolves them, so force the
 *  <input type=file> fallback that Playwright's filechooser event can drive. */
export function beforeLoad() {
  delete window.showOpenFilePicker;
  delete window.showSaveFilePicker;
  delete window.showDirectoryPicker;
}

export default async function ({ page, ui, shot, state, log }) {
  // ---- mock api.github.com ------------------------------------------------------------
  const server = {
    branches: { main: 'sha_main_1', monet: 'sha_main_1' },
    commits: { sha_main_1: { tree: 'tree_1' } },
    trees: {
      tree_1: [
        {
          path: 'src/main/resources/assets/star/textures/item/sword.png',
          sha: 'blob_sword',
          type: 'blob',
          size: 120,
        },
        { path: 'README.md', sha: 'blob_readme', type: 'blob', size: 10 },
      ],
    },
    blobs: {},
    commitLog: [],
    diverge: false,
  };
  await page.exposeFunction('__ghState', () =>
    JSON.parse(
      JSON.stringify({
        branches: server.branches,
        commitLog: server.commitLog,
      }),
    ),
  );
  await page.exposeFunction('__ghDiverge', () => {
    // Simulate someone pushing to main so a fast-forward becomes impossible.
    server.branches.main = 'sha_main_outside';
    server.commits.sha_main_outside = { tree: 'tree_1' };
    server.diverge = true;
    return true;
  });

  // A tiny valid PNG for the mocked blob, produced in-page.
  const pngB64 = await page.evaluate(async () => {
    const c = document.createElement('canvas');
    c.width = c.height = 16;
    const x = c.getContext('2d');
    x.fillStyle = '#3fa7d6';
    x.fillRect(0, 0, 16, 16);
    const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
    const buf = new Uint8Array(await blob.arrayBuffer());
    let s = '';
    for (const b of buf) s += String.fromCharCode(b);
    return btoa(s);
  });
  server.blobs.blob_sword = pngB64;

  await page.route('https://api.github.com/**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname.replace('/repos/alexmouf-work/monet-demo', '');
    const body = req.postData() ? JSON.parse(req.postData()) : null;
    const json = (status, data) =>
      route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) });

    // repo metadata
    if (path === '' || path === '/')
      return json(200, {
        full_name: 'alexmouf-work/monet-demo',
        default_branch: 'main',
        permissions: { push: true },
      });
    let m;
    if ((m = path.match(/^\/git\/ref\/heads\/(.+)$/))) {
      const sha = server.branches[decodeURIComponent(m[1])];
      return sha
        ? json(200, { ref: `refs/heads/${m[1]}`, object: { sha } })
        : json(404, { message: 'Not Found' });
    }
    if (path === '/git/refs' && req.method() === 'POST') {
      const name = body.ref.replace('refs/heads/', '');
      if (server.branches[name]) return json(422, { message: 'Reference already exists' });
      server.branches[name] = body.sha;
      return json(201, { ref: body.ref, object: { sha: body.sha } });
    }
    if ((m = path.match(/^\/git\/refs\/heads\/(.+)$/)) && req.method() === 'PATCH') {
      const name = decodeURIComponent(m[1]);
      // Fast-forward only: refuse when the target is not an ancestor of the new sha.
      const isFF = !server.diverge || name === 'monet';
      if (!isFF) return json(422, { message: 'Update is not a fast forward' });
      server.branches[name] = body.sha;
      return json(200, { ref: `refs/heads/${name}`, object: { sha: body.sha } });
    }
    if ((m = path.match(/^\/git\/commits\/(.+)$/)) && req.method() === 'GET') {
      const c = server.commits[m[1]];
      return c
        ? json(200, { sha: m[1], tree: { sha: c.tree } })
        : json(404, { message: 'Not Found' });
    }
    if ((m = path.match(/^\/git\/trees\/([^?]+)/)) && req.method() === 'GET') {
      return json(200, { sha: m[1], tree: server.trees[m[1]] ?? [], truncated: false });
    }
    if (path === '/git/trees' && req.method() === 'POST') {
      const sha = `tree_${Object.keys(server.trees).length + 1}`;
      const base = server.trees[body.base_tree] ?? [];
      const merged = [...base];
      for (const e of body.tree) {
        const i = merged.findIndex((x) => x.path === e.path);
        const entry = { path: e.path, sha: e.sha, type: 'blob', size: 100 };
        if (i >= 0) merged[i] = entry;
        else merged.push(entry);
      }
      server.trees[sha] = merged;
      return json(201, { sha });
    }
    if (path === '/git/blobs' && req.method() === 'POST') {
      const sha = `blob_${Object.keys(server.blobs).length + 1}`;
      server.blobs[sha] = body.content;
      return json(201, { sha });
    }
    if ((m = path.match(/^\/git\/blobs\/(.+)$/))) {
      const content = server.blobs[m[1]];
      return content
        ? json(200, { content, encoding: 'base64' })
        : json(404, { message: 'Not Found' });
    }
    if (path === '/git/commits' && req.method() === 'POST') {
      const sha = `commit_${server.commitLog.length + 1}`;
      server.commits[sha] = { tree: body.tree };
      server.commitLog.push({ sha, message: body.message, tree: body.tree, parents: body.parents });
      return json(201, { sha });
    }
    if (path.startsWith('/branches')) {
      return json(
        200,
        Object.keys(server.branches).map((n) => ({ name: n, commit: { sha: server.branches[n] } })),
      );
    }
    if (path.startsWith('/compare/')) {
      return json(200, {
        ahead_by: server.commitLog.length,
        behind_by: server.diverge ? 1 : 0,
        status: 'ahead',
      });
    }
    if (path === '/merges' && req.method() === 'POST') {
      const sha = `merge_${server.commitLog.length + 1}`;
      server.commits[sha] = { tree: server.commits[server.branches.monet]?.tree ?? 'tree_1' };
      server.commitLog.push({ sha, message: body.commit_message, merge: true });
      server.branches[body.base] = sha;
      server.diverge = false;
      return json(201, { sha });
    }
    return json(404, { message: `unmocked ${req.method()} ${path}` });
  });

  // ---- jar source ---------------------------------------------------------------------
  await page.evaluate(() => localStorage.setItem('monet.github.token', 'ghp_faketoken'));
  await page.addInitScript(() => {
    delete window.showOpenFilePicker;
    delete window.showSaveFilePicker;
    delete window.showDirectoryPicker;
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForFunction(() => !!window.__monet);

  await page.click('.sources__header .iconbtn');
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.click('.sources__add .btn:has-text("Minecraft / mod jar")'),
  ]);
  await chooser.setFiles('/tmp/fake.jar');
  await page.waitForTimeout(900);
  log('jar textures listed:', await page.locator('.srctree__item').count());
  log('jar paths:', JSON.stringify(await page.locator('.srctree__path').allInnerTexts()));
  await shot('1-jar-added');

  // Open a vanilla texture: read-only, so no binding.
  await page.locator('.srctree__item:has-text("stone.png")').click();
  await page.waitForTimeout(600);
  log('opened doc:', JSON.stringify(await state.doc()));
  await shot('2-jar-texture-open');

  // ---- repo source -------------------------------------------------------------------
  await page.click('.sources__header .iconbtn');
  await page.click('.sources__add .btn:has-text("GitHub repository")');
  await page.waitForTimeout(300);
  await page.locator('.dialog input[type="text"]').first().fill('alexmouf-work/monet-demo');
  await page.click('.dialog__actions .btn--primary');
  await page.waitForTimeout(900);
  log(
    'branches after connect:',
    JSON.stringify((await page.evaluate(() => window.__ghState())).branches),
  );
  log(
    'repo textures:',
    JSON.stringify(
      await page.locator('.srcblock:has-text("monet-demo") .srctree__path').allInnerTexts(),
    ),
  );
  await shot('3-repo-connected');

  // Open the repo texture (bound), paint on it, then Ctrl+S.
  await page.locator('.srcblock:has-text("monet-demo") .srctree__item').first().click();
  await page.waitForTimeout(800);
  log('bound doc:', JSON.stringify(await state.doc()));
  await ui.tab('Brushes');
  await ui.paletteColor(5);
  await ui.setNumber('Size', 6);
  await ui.drag(await ui.atDoc(2, 8), await ui.atDoc(13, 8));
  await page.keyboard.press('Control+s');
  await page.waitForTimeout(1200);
  const st1 = await page.evaluate(() => window.__ghState());
  log('commit log:', JSON.stringify(st1.commitLog.map((c) => c.message)));
  log('branches:', JSON.stringify(st1.branches));
  log('dirty dot after push (0 = saved):', await page.locator('.doctab__dot').count());
  log('toasts:', JSON.stringify(await page.locator('.toast').allInnerTexts()));
  await shot('4-pushed');

  // Sync: fast-forward main to monet.
  await page.locator('.srcblock:has-text("monet-demo") .iconbtn[title="Sync branches"]').click();
  await page.waitForTimeout(800);
  log('sync dialog status:', await page.locator('.dialog .panel__hint').first().innerText());
  await page.click('.dialog__actions .btn--primary');
  await page.waitForTimeout(900);
  const st2 = await page.evaluate(() => window.__ghState());
  log(
    'after ff — main:',
    st2.branches.main,
    'monet:',
    st2.branches.monet,
    st2.branches.main === st2.branches.monet ? '✓ equal' : '✗ differ',
  );
  await shot('5-synced');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);

  // Diverge main, then Sync again: must fall back to a merge and end level.
  await page.evaluate(() => window.__ghDiverge());
  await page.locator('.srcblock:has-text("monet-demo") .iconbtn[title="Sync branches"]').click();
  await page.waitForTimeout(800);
  await page.click('.dialog__actions .btn--primary');
  await page.waitForTimeout(1000);
  const st3 = await page.evaluate(() => window.__ghState());
  log(
    'after merge — main:',
    st3.branches.main,
    'monet:',
    st3.branches.monet,
    st3.branches.main === st3.branches.monet ? '✓ equal' : '✗ differ',
  );
  log(
    'merge commit present:',
    st3.commitLog.some((c) => c.merge),
  );
  await shot('6-merged');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);

  // The owner's other key path: edit a VANILLA texture, then Save As into the mod repo.
  const jarDocTab = page.locator('.doctab:has-text("stone")');
  await jarDocTab.click();
  await page.waitForTimeout(400);
  await ui.tab('Brushes');
  await ui.paletteColor(4);
  await ui.setNumber('Size', 4);
  await ui.drag(await ui.atDoc(2, 2), await ui.atDoc(13, 13));
  await page.keyboard.press('Control+Shift+s');
  await page.waitForTimeout(700);
  log(
    'save-as target options:',
    JSON.stringify(await page.locator('.dialog select option').allInnerTexts()),
  );
  const pathInput = page.locator('.dialog input[type="text"]').first();
  log('suggested path:', await pathInput.inputValue());
  await pathInput.fill('src/main/resources/assets/star/textures/block/custom_stone.png');
  await shot('7-save-as');
  await page.click('.dialog__actions .btn--primary');
  await page.waitForTimeout(1200);
  const st4 = await page.evaluate(() => window.__ghState());
  log(
    'commits now:',
    JSON.stringify(st4.commitLog.map((c) => (c.merge ? 'MERGE' : c.message.split('\n')[0]))),
  );
  log('toasts:', JSON.stringify(await page.locator('.toast').allInnerTexts()));
  await shot('8-vanilla-saved-to-repo');
}
