/**
 * "Sign in with GitHub" end to end, against a mocked App + API (docs/08 §4.1).
 *
 * A real OAuth round trip needs the owner's App credentials and a browser on github.com, so
 * everything outside our own code is mocked: the authorize page (asserting the URL we send the
 * user to), our `/api/github/token` exchange, and the user-to-server endpoints. What is actually
 * under test is our half — state handling, storage, refresh, identity, the repo picker.
 */
const TOKEN_ENDPOINT = '**/api/github/token';

export function beforeLoad() {
  // No build-time env in the harness: configure the App at runtime.
  window.__MONET_GITHUB__ = {
    clientId: 'Iv1.harness',
    appSlug: 'monet-harness',
    tokenEndpoint: '/api/github/token',
  };
}

export default async function ({ page, ui, state, log, shot }) {
  const calls = [];

  // Our serverless exchange. First call = code→token (short-lived, so refresh is exercised),
  // later calls = refresh.
  await page.route(TOKEN_ENDPOINT, async (route) => {
    const body = JSON.parse(route.request().postData() ?? '{}');
    calls.push(body.code ? { grant: 'code', code: body.code } : { grant: 'refresh' });
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        access_token: body.code ? 'ghu_first' : 'ghu_refreshed',
        token_type: 'bearer',
        // 4 minutes: inside the 5-minute refresh skew, so the next API call must refresh.
        expires_in: body.code ? 240 : 28_800,
        refresh_token: 'ghr_token',
        refresh_token_expires_in: 15_897_600,
      }),
    });
  });

  const authHeaders = [];
  await page.route('https://api.github.com/**', async (route) => {
    const url = new URL(route.request().url());
    authHeaders.push({
      path: url.pathname,
      auth: route.request().headers()['authorization'],
    });
    const json = (data) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });

    if (url.pathname === '/user') {
      return json({
        login: 'octocat',
        avatar_url: 'data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACwAAAAAAQABAAACAkQBADs=',
      });
    }
    if (url.pathname === '/user/installations') {
      return json({
        installations: [
          { id: 41, account: { login: 'octocat' }, repository_selection: 'selected' },
          { id: 42, account: { login: 'acme' }, repository_selection: 'selected' },
        ],
      });
    }
    if (url.pathname === '/user/installations/41/repositories') {
      return json({
        repositories: [
          { full_name: 'octocat/textures', default_branch: 'main', permissions: { push: true } },
          { full_name: 'octocat/readonly', default_branch: 'trunk', permissions: { push: false } },
        ],
      });
    }
    if (url.pathname === '/user/installations/42/repositories') {
      return json({
        repositories: [
          { full_name: 'acme/mod', default_branch: 'dev', permissions: { push: true } },
        ],
      });
    }
    return route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
  });

  // Where "Sign in with GitHub" sends the user. Intercepted so the browser never leaves the app;
  // the request URL is the assertion.
  let authorizeUrl = null;
  await page.route('https://github.com/login/oauth/authorize**', async (route) => {
    authorizeUrl = route.request().url();
    await route.fulfill({ status: 200, contentType: 'text/html', body: '<p>github</p>' });
  });

  await ui.newDoc(32);

  // --- signed out ---------------------------------------------------------------
  await page.click('.topbar .iconbtn[title^="Settings"]');
  await page.waitForTimeout(300);
  log('sign-in button:', await page.locator('.account .btn--primary').count());
  log('token field hidden behind a disclosure:', await page.locator('details summary').count());
  await shot('1-settings-signed-out');

  await page.click('.account .btn--primary');
  await page.waitForTimeout(400);
  const u = new URL(authorizeUrl);
  log('authorize host+path:', `${u.origin}${u.pathname}`);
  log('  client_id:', u.searchParams.get('client_id'));
  log('  redirect_uri:', u.searchParams.get('redirect_uri'));
  log('  scope:', u.searchParams.get('scope') ?? '(none — GitHub Apps carry their own)');
  const sentState = u.searchParams.get('state');
  log('  state length:', sentState?.length);

  // --- the callback -------------------------------------------------------------
  // GitHub would redirect back to redirect_uri?code=…&state=…; go there ourselves. The state in
  // sessionStorage survives because it is the same tab and origin.
  await page.goto(`${u.searchParams.get('redirect_uri')}?code=abc123&state=${sentState}`);
  await page.waitForFunction(() => !!window.__monet, null, { timeout: 15_000 });
  await page.waitForTimeout(700);

  log('exchange calls:', JSON.stringify(calls));
  log('address bar cleaned:', JSON.stringify(await page.evaluate(() => location.search)));
  const session = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('monet.github.session') ?? 'null'),
  );
  log('stored session:', JSON.stringify({ ...session, avatarUrl: !!session?.avatarUrl }));
  log(
    'state consumed:',
    await page.evaluate(() => localStorage.getItem('monet.github.oauthState')),
  );
  log('identity call auth header:', authHeaders.find((h) => h.path === '/user')?.auth);
  await shot('2-signed-in');

  // --- the account block shows the signed-in user -------------------------------
  await page.click('.topbar .iconbtn[title^="Settings"]');
  await page.waitForTimeout(300);
  log('account name:', await page.locator('.account__name').innerText());
  log('avatar shown:', await page.locator('.account__avatar').count());
  await shot('3-settings-signed-in');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);

  // --- repositories come from the installations, and refresh happens on the way -
  await page.click('.sources__header .iconbtn');
  await page.click('.sources__add .btn:has-text("GitHub repository")');
  await page.waitForTimeout(900);
  const listed = await page.locator('.repolist__item .repolist__name').allInnerTexts();
  log('repos offered:', JSON.stringify(listed));
  log('read-only marked:', JSON.stringify(await page.locator('.repolist__meta').allInnerTexts()));
  log('exchange calls after listing:', JSON.stringify(calls));
  const bearer = [...new Set(authHeaders.map((h) => h.auth))];
  log('bearers used:', JSON.stringify(bearer));
  log(
    calls.some((c) => c.grant === 'refresh') && bearer.includes('Bearer ghu_refreshed')
      ? '✓ the near-expiry token was refreshed and the new one used'
      : '✗ expected a refresh',
  );

  await page.locator('.repolist__item').first().click();
  await page.waitForTimeout(200);
  log(
    'picked into the field:',
    await page.locator('.dialog input[type="text"]').first().inputValue(),
  );
  await shot('4-repo-picker');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);

  // --- sign out clears the session ---------------------------------------------
  await page.click('.topbar .iconbtn[title^="Settings"]');
  await page.waitForTimeout(300);
  await page.locator('.account .btn', { hasText: 'Sign out' }).click();
  await page.waitForTimeout(300);
  log(
    'session after sign out:',
    await page.evaluate(() => localStorage.getItem('monet.github.session')),
  );
  log('sign-in offered again:', await page.locator('.account .btn--primary').count());
  await shot('5-signed-out-again');

  // --- a callback with the wrong state must be refused -------------------------
  await page.goto(`${u.searchParams.get('redirect_uri')}?code=evil&state=not-the-state`);
  await page.waitForFunction(() => !!window.__monet, null, { timeout: 15_000 });
  await page.waitForTimeout(600);
  const after = await page.evaluate(() => localStorage.getItem('monet.github.session'));
  log('forged callback → session:', after);
  log('exchange attempted?:', JSON.stringify(calls.filter((c) => c.code === 'evil')));
  log(
    after === null && !calls.some((c) => c.code === 'evil')
      ? '✓ refused without exchanging the code'
      : '✗ a forged callback was accepted',
  );
  await shot('6-forged-callback-refused');
}
