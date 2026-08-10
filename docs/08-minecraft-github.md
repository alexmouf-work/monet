# 08 — Minecraft & GitHub integration

The **Sources sidebar** ([09 §4]) hosts everything here. A *source* provides
textures to browse/open and (if writable) receives saves.

```ts
type SourceEntry =
  | { kind: 'jar';    id: string; label: string; }                       // read-only
  | { kind: 'folder'; id: string; label: string; }                       // FS Access, writable
  | { kind: 'repo';   id: string; label: string; owner: string; repo: string;
      baseBranch: string; workBranch: string; }                          // writable via API
```

All source metadata persists in IndexedDB; jar bytes and folder handles too.

## 1. Common browser UI

Every source renders the same **texture tree**: folders → PNG leaves, with
lazy 48-px nearest-neighbour thumbnails (decode ≤ 64 at a time, LRU cache 512), a
filter-as-you-type box (substring on full path), and file count badges. Jar
sources group by `assets/<namespace>/textures/<category>/…`; repo/folder sources
show their real folder structure filtered to `*.png`. Leaves with a `.monet`
mirror ([§6.2]) show a small layered-stack badge. Double-click (or Enter) opens a
document; already-open paths focus the existing tab.

## 2. Jar / mod sources (read-only)

- **Add**: "Add Minecraft/mod jar" → file picker or drag-drop accepting
  `.jar`/`.zip`. Typical pick: `%AppData%/.minecraft/versions/<v>/<v>.jar` or a
  mod build. The raw bytes go to IndexedDB (`jar:<id>`), so sources survive
  reloads without re-picking (show total cached size + per-jar Remove in the
  sidebar).
- **Parse** (jszip `loadAsync` on the stored bytes, on demand): index entries
  matching `^assets/[^/]+/textures/.+\.png$` into the tree; everything else
  matching `\.png$` lands under a collapsed "other images" group. A vanilla
  1.21 jar (~25 MB, ~5 000 textures) must index in < 2 s (index = paths only; no
  decoding).
- Entries with a sibling `<name>.png.mcmeta` get an "animated" badge; opening one
  opens the full vertical strip (v1 does nothing more with mcmeta).
- **Read-only**: documents opened from a jar have no `binding`; `Ctrl+S` routes to
  Save-As. The Save-As dialog's repo/folder targets **pre-fill the jar-relative
  path** appended to a detected assets root (§6.3) — the "edit vanilla texture →
  save into my mod repo" fast path.

## 3. Local folder sources (writable; Chromium only)

- "Add folder" → `showDirectoryPicker({ mode: 'readwrite' })`; walk on refresh
  collecting `**/*.png` (skip `.git`, `node_modules`, `.monet`; depth ≤ 12; cap
  20 000 entries). Persist the handle (IndexedDB stores handles natively); after
  a reload a "Reconnect" button calls `requestPermission({ mode: 'readwrite' })`.
- Open → doc with `binding = { sourceId, path }`.
- Save → write the PNG at `path` and the project to
  `<folderRoot>/.monet/<path minus .png>.monet` (D6 mirror; create directories
  with `getDirectoryHandle(name, { create: true })`).
- Hidden when the FS Access API is unavailable (D7).

## 4. GitHub: auth & API wrapper — `integrations/github/api.ts`

Two ways in. `auth.authToken()` picks, in order: a **signed-in GitHub App session**, else the
**personal access token**. Everything downstream (`gh()`, sources, save, sync) is unaware of
which one it got.

### 4.1 Sign in with GitHub — GitHub App, user-to-server (owner request 2026-08-10)

Monet is a **GitHub App** and acts only ever *as the signed-in user* on the repositories that
user has installed it on. It never authenticates as the App itself, so the App has no private
key and no webhook. Owner setup: **`docs/GITHUB-APP.md`**.

**One server-side file, and only because GitHub forces it.** The `code`→token exchange needs the
client secret (cannot ship in a bundle) and `github.com/login/oauth/access_token` sends no CORS
headers (so the browser cannot call it even as a public client — GitHub supports no PKCE and no
browser-only flow). `api/github/token.ts` is therefore a stateless Vercel Edge Function that
holds the secret, exchanges or refreshes, and stores nothing. It supersedes docs/00 D1's "no
serverless functions"; nothing else moved server-side.

Flow — `integrations/github/oauth.ts` (pure) + `auth.ts` (stateful):

1. **Begin**: random 24-byte hex `state` → `sessionStorage`, then navigate to
   `github.com/login/oauth/authorize?client_id&redirect_uri&state`. **No `scope`** — a GitHub
   App's permissions come from the App.
2. **Return**: GitHub redirects to `redirect_uri?code&state`. On boot, `completeSignIn()` reads
   the query, compares `state` against the stored one (**mismatch or missing ⇒ refuse without
   exchanging the code**), consumes it, and strips the query with `replaceState`.
3. **Exchange**: `POST {tokenEndpoint} {code}` → `{access_token, expires_in: 28800,
   refresh_token, refresh_token_expires_in}` → absolute deadlines in
   `localStorage['monet.github.session']`.
4. **Identity**: `GET /user` → cache `login` + `avatar_url` on the session so the UI can name the
   account without a round trip.
5. **Refresh**: `authToken()` refreshes ~5 min before expiry (`REFRESH_SKEW_MS`), single-flight,
   so a save can never straddle an expiry. A dead refresh token clears the session and says so.
6. **Sign out** clears the session. A `401` from any API call clears it too (`invalidateSession`),
   so the UI cannot keep claiming to be signed in. `404` deliberately does **not**: for an App it
   usually means "that repo is not in the installation", which is a different fix.

**Repository access is the installation.** `GET /user/installations` →
`/user/installations/{id}/repositories` gives exactly what Monet may touch; the Connect dialog
lists it (deduplicated, sorted, `push: false` marked read-only) instead of asking the user to
type a name and find out later. "Repository access" links to
`github.com/apps/<slug>/installations/new`.

**Config** — `githubAppConfig()`: `VITE_GITHUB_CLIENT_ID`, `VITE_GITHUB_APP_SLUG`,
`VITE_GITHUB_TOKEN_ENDPOINT` (default `/api/github/token`), each overridable at runtime via
`window.__MONET_GITHUB__` for self-hosting and for the harness. **No client id ⇒ sign-in is
hidden entirely** and the PAT is the only route, which is what a plain static self-host gets.

### 4.2 Personal access token (fallback, unchanged)

Settings → *Use a token instead*, stored at `localStorage['monet.github.token']`, with a "Forget
token" button and this exact guidance text: *fine-grained personal access token → Repository
access: the repos you'll connect → Permissions → Contents: Read and write (Metadata is added
automatically). Classic tokens with `repo` scope also work.* Ignored while signed in. Tokens of
either kind are only ever sent to `https://api.github.com`.

Every call goes through one helper:

```ts
async function gh<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token()}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new GhError(res.status, await res.json().catch(() => ({})));
  return res.status === 204 ? (undefined as T) : res.json();
}
```

Error mapping (toast + inline in the sidebar): 401 → "token invalid/expired";
403/429 → "rate-limited, retry in a minute" (respect `retry-after` if present);
404 → "repo not found or token lacks access"; anything else → status + API
`message`. Base64 helpers: `bytesToB64`/`b64ToBytes` via `FileReader`/`atob`
chunked (blob contents come back base64 **with embedded newlines — strip them**).

## 5. Connecting a repo

Dialog: URL or `owner/repo` + working-branch name (default **`monet`**, A5) +
base branch (dropdown, default = repo's default branch).

1. `GET /repos/{o}/{r}` → must have `permissions.push`; store `default_branch`.
2. `GET /repos/{o}/{r}/git/ref/heads/{base}` → base commit SHA.
   404 on a **commit-less repo** → error: "repository has no commits — create an
   initial commit on GitHub first" (no init flow in v1).
3. Create the working branch: `POST /repos/{o}/{r}/git/refs`
   `{ ref: 'refs/heads/monet', sha: baseSha }`. A 422 "Reference already exists"
   is fine → reuse the existing branch as-is.
4. Load the tree (§6.1). Source appears in the sidebar with branch badges
   `monet ← main`.

## 6. Repo browse, open, save

### 6.1 Browse

```
GET /git/ref/heads/{work}        → commit SHA          (cache as head)
GET /git/commits/{sha}           → tree SHA
GET /git/trees/{treeSha}?recursive=1 → entries[path, type, sha, size], truncated
```

Filter blobs to `\.png$` for the tree UI; also collect `^\.monet/.*\.monet$` into
a path→sha map for badges. If `truncated` is true (repos beyond ~100 k entries),
show "tree too large — search by exact path" input (edge case, no more support
than that). **Refresh** button redoes this chain.

### 6.2 Open

`GET /git/blobs/{sha}` → base64 → bytes. If `.monet/<path minus .png>.monet`
exists, open **it** (full layered project [07 §7]); else decode the PNG as a
single-layer doc. `binding = { sourceId, path }`.

### 6.3 Save = one commit + push (the required push-on-save)

Files per save: the PNG at `binding.path` **and** the project at
`.monet/<path minus .png>.monet` (D6). Sequence, with `head` = cached working-
branch commit:

```
1. POST /git/blobs { content: b64(png),   encoding: 'base64' } → pngSha
2. POST /git/blobs { content: b64(monet), encoding: 'base64' } → monetSha
3. GET  /git/commits/{head} → baseTreeSha                  (refetch head first if stale)
4. POST /git/trees { base_tree: baseTreeSha,
        tree: [ { path, mode: '100644', type: 'blob', sha: pngSha },
                { path: mirrorPath, mode: '100644', type: 'blob', sha: monetSha } ] } → treeSha
5. POST /git/commits { message, tree: treeSha, parents: [head] } → newSha
6. PATCH /git/refs/heads/{work} { sha: newSha }            (force absent ⇒ fast-forward only)
```

Commit message: `monet: update <path>` (`add` when the tree lacked the path), body
line `+ <mirrorPath>`. On 422 at step 6 (someone else moved the branch): refetch
the ref, rerun 3–6 (max 3 attempts) — our commit re-parents cleanly because steps
1–2 are content-addressed. Surface persistent failure as a toast with Retry;
the document keeps `dirty` until a save lands. Status-bar badge cycles
`● unsaved → ⇡ pushing → ✓ pushed @abc1234` per doc.

Saving a **new** file into a repo (Save-As): a path picker over the repo tree with
an assets-root suggester — candidate prefixes are tree paths ending in `assets/`
(e.g. `src/main/resources/assets/…` ⇒ prefix `src/main/resources`); jar-born docs
pre-fill prefix + original jar path.

## 7. Sync ("merge / fast-forward other branches to the same state")

Toolbar **Sync** button (enabled for the active doc's repo source, or per-source
in the sidebar). Dialog:

- Target branch dropdown: `GET /branches?per_page=100`, default **`main`** if it
  exists, else the repo's default branch.
- Status line via `GET /compare/{target}...{work}` → "`monet` is N ahead, M behind
  `target`".
- **Sync** button executes:

```
PATCH /git/refs/heads/{target} { sha: workHeadSha }        // no force ⇒ server-side ff-only
  → 200: done — target now equals the working branch.      // the default, clean path
  → 422 "not a fast forward" (M > 0): offer **Merge** instead:
      POST /merges { base: target, head: work, commit_message: 'Merge monet into <target>' }
        → 201 { sha: mergeSha }: then PATCH /git/refs/heads/{work} { sha: mergeSha }
          (fast-forward — the merge commit's parents include our head) so both
          branches end at the same state, satisfying the invariant.
        → 409 merge conflict: error dialog — "target and monet edited the same
          files; resolve in git/GitHub, then Sync again" + a link to
          github.com/{o}/{r}/compare/{target}...{work}.
```

Never force-push anything, anywhere. After success, refresh head/tree and show
"`target` ✓ up to date with `monet`".

## 8. Acceptance

- Jar: add a real 1.21.x jar → namespace tree under `assets/minecraft/textures/…`
  with thumbnails and working search; survives a reload from IndexedDB; open
  `item/diamond_sword.png` → 16×16 doc; `Ctrl+S` → Save-As with the jar path
  pre-filled for repo targets.
- Folder: connect, open, edit, save → PNG updated on disk + `.monet/` mirror
  created; reconnect flow after reload works.
- Repo (use a scratch repo): connect creates branch `monet` from `main`; opening,
  editing and `Ctrl+S` produces exactly one new commit on `monet` containing both
  files, visible on GitHub; a second save while the tree cache is stale still
  lands (retry loop); Sync fast-forwards `main` to `monet` (verify SHAs equal);
  after pushing a commit to `main` from outside, Sync offers Merge, and after
  merging both branches point at the merge commit; a conflicting outside edit
  yields the conflict dialog and no ref moves.
- Token: wrong token → friendly 401 handling; Forget clears storage; no network
  requests carry the token to any host other than `api.github.com` (assert in a
  fetch-spy unit test).
- The owner's end-to-end workflow: connect mod repo → open a texture → recolour →
  `Ctrl+S` → commit visible on branch `monet` → Sync → `main` fast-forwarded. One
  E2E test against a fixture repo (mock `api.github.com` with recorded responses;
  Playwright route interception).
