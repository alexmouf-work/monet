# Monet as a GitHub App — setup

Owner-side steps. Until they are done, the "Sign in with GitHub" button is hidden and Monet
falls back to a personal access token, which is exactly how it behaved before (nothing breaks
while this sits unconfigured).

## Why a server is involved at all

Signing in requires exchanging the OAuth `code` for a user access token at
`https://github.com/login/oauth/access_token`. That request needs the App's **client secret**,
which cannot ship in a browser bundle, and the endpoint sends **no CORS headers**, so a browser
cannot call it even for a public client — GitHub supports neither PKCE nor any browser-only flow.
So there is exactly one server-side file, `api/github/token.ts`, a stateless Vercel Edge Function
that holds the secret and forwards nothing else. Everything else stays client-side.

## 1. Create the App

<https://github.com/settings/apps/new> (or an organisation's *Developer settings → GitHub Apps*).

| Field | Value |
| ----- | ----- |
| **GitHub App name** | `Monet` (must be globally unique; note the resulting URL slug) |
| **Homepage URL** | `https://monet.mouftools.com` |
| **Callback URL** | `https://monet.mouftools.com/` — then *Add callback URL* for `http://localhost:5173/` (dev) and `http://localhost:4173/` (preview) |
| **Request user authorization (OAuth) during installation** | ✅ on |
| **Expire user authorization tokens** | ✅ on (8-hour tokens + refresh tokens; Monet refreshes them itself) |
| **Setup URL** | leave blank |
| **Webhook → Active** | ❌ off — Monet polls nothing and receives nothing |
| **Repository permissions → Contents** | **Read and write** (Metadata read-only is added automatically) |
| Every other permission | leave at *No access* |
| **Where can this GitHub App be installed?** | **Any account**, so other people can use Monet on their own repos |

Nothing else is needed: no private key, no webhook secret. Monet only ever acts *as the signed-in
user* (user-to-server), never as the App itself, so the App's private key is never used and should
not be generated.

## 2. Collect two values

From the App's settings page: **Client ID** (public, e.g. `Iv23li…`) and a freshly generated
**client secret** (shown once — treat it as a password).

## 3. Configure Vercel

Project → Settings → Environment Variables, for Production **and** Preview:

| Name | Value | Notes |
| ---- | ----- | ----- |
| `GITHUB_CLIENT_ID` | the Client ID | server-side, read by the function |
| `GITHUB_CLIENT_SECRET` | the secret | server-side; **never** name it `VITE_*` |
| `VITE_GITHUB_CLIENT_ID` | the same Client ID | inlined into the bundle, which is fine — it is public |
| `VITE_GITHUB_APP_SLUG` | the slug from the App's URL | only used to build "Repository access" links |

Then redeploy (env changes do not rebuild by themselves). `.env.example` is the same list for
local work.

## 4. Check it

1. `https://monet.mouftools.com/api/github/token` with a GET should answer **405**
   `method_not_allowed` — that proves the function deployed. A 404 means Vercel is not building
   `api/`; add `"functions": { "api/**/*.ts": { "runtime": "edge" } }` to `vercel.json` and
   redeploy.
2. Settings → **Sign in with GitHub** → authorise → you land back on Monet signed in, with your
   avatar and `@login` shown.
3. Sources → **+ → GitHub repository** lists the repositories the App can reach. Empty list means
   the App is installed on no repositories yet — use **Repository access**.
4. Open a texture from a connected repo, edit, `Ctrl+S`: one commit on the `monet` branch.

## Which credentials Monet uses

`auth.authToken()` decides, in this order:

1. a signed-in App session (refreshed automatically ~5 minutes before expiry);
2. otherwise the personal access token from Settings.

So a PAT stays a first-class route — for self-hosting, for offline-ish use, and for anyone who
would rather not install an App. Signing in is preferable because the App's reach is bounded by
its installation (Contents, on repositories the user picks) rather than by whatever scopes a
hand-made token happened to be given.

## What is stored where

| Thing | Where | Notes |
| ----- | ----- | ----- |
| user access token + refresh token | `localStorage['monet.github.session']` | this browser only |
| CSRF state, for one round trip | `sessionStorage['monet.github.oauthState']` | deleted on return |
| PAT (fallback) | `localStorage['monet.github.token']` | unchanged from before |
| client secret | Vercel env var | never reaches the browser |

The token is in the browser because Monet has no backend of its own to keep it in; that is the
same trade-off the PAT already made, with a smaller blast radius and an expiry.
