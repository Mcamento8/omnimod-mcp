# Publishing the OmniMod MCP (and its two engine-source repositories)

> **الغرض (بالعربية):** هذا هو دليل النشر الصحيح خطوة بخطوة: رفع مستودعي المصدر
> (طبقة توافق Forge + نظام الكوماند بلوك) إلى GitHub، ربط روابطهما بسيرفر الـ MCP،
> ثم نشر الـ MCP نفسه ليكون جاهزاً للاستخدام تماماً من أي وكيل ذكاء اصطناعي دون أي
> مشاكل — مع خطة تحقق كاملة قبل وبعد النشر. اتبع الخطوات بالترتيب.

This guide takes you from the current state (everything built and verified
locally) to: two public GitHub repositories + one published MCP that any agent
can install and use.

> **Live status (2026-09-04):** all three repositories are published under
> `Mcamento8` and the MCP pre-links them by default (v1.2.0+), so a fresh
> install works with zero repo configuration:
> `omnimod-forge-compat`, `omnimod-command-blocks`, `omnimod-mcp`.

**Pre-flight (already done, verify again any time):**

```bash
cd mcp
npm install        # once, if node_modules is missing
npm run build      # TypeScript compiles clean
npm run selfcheck  # in-process battery: PASS
npm run e2e        # JSON-RPC session: 51 tools, 13 resources, 5 prompts: PASS
```

---

## Step 1 — Publish the two engine-source repositories

The two publish-ready packages live in `mcp/repos/`. Each one is a standalone
repository seed (README + .gitignore + docs + FILE_MANIFEST.txt + full source
tree).

### Option A — GitHub CLI (fastest, from the OmniMod machine)

```bash
cd "C:\Users\Mr Kimr\Desktop\OmniMod\mcp\repos\omnimod-forge-compat"
git init
git add .
git commit -m "OmniMod Forge 1.20.1 compat layer — engine snapshot"
gh repo create omnimod-forge-compat --public --source=. --push
# live at https://github.com/Mcamento8/omnimod-forge-compat

cd "C:\Users\Mr Kimr\Desktop\OmniMod\mcp\repos\omnimod-command-blocks"
git init
git add .
git commit -m "OmniMod command-block & command-surface system — engine snapshot"
gh repo create omnimod-command-blocks --public --source=. --push
# live at https://github.com/Mcamento8/omnimod-command-blocks
```

(`gh` requires `gh auth login` once. Install from https://cli.github.com.)

### Option B — Web upload (no CLI)

1. Create **two empty repositories** on github.com: `omnimod-forge-compat` and
   `omnimod-command-blocks`.
2. For each folder in `mcp/repos/`: `git init && git add . && git commit -m "engine snapshot"`,
   then add the remote and push:
   `git remote add origin https://github.com/<you>/<repo>.git && git push -u origin main`
   (GitHub web upload of 1,400+ files is unreliable — prefer git push).

### Notes

- **Visibility:** public if you want any agent to read the sources (recommended
  — that is their purpose). Private works too, but agents without repo access
  will get 404s from the links.
- **License:** add a `LICENSE` file to each repo (github.com gives you a
  template picker). Choose deliberately — these trees derive from your engine
  and from EaglercraftX-lineage code.
- **Do not** push the whole OmniMod project — only the two exported folders.
  They are self-contained.

---

## Step 2 — Link the repositories into the MCP

The MCP surfaces both repository URLs through `omni_knowledge {topic:"repos"}`,
the `omnimod://knowledge/repos` resource, and `omni_config`. Configure them with
**env vars** (in every client config block), or at runtime with `omni_config`.

### Claude Desktop / Claude Code / Cursor / Cline / Kilo — add to the env block:

```json
{
  "mcpServers": {
    "omnimod": {
      "command": "node",
      "args": ["C:/Users/Mr Kimr/Desktop/OmniMod/mcp/dist/index.js"],
      "env": {
        "OMNIMOD_HOST": "127.0.0.1",
        "OMNIMOD_FORGE_COMPAT_REPO": "https://github.com/Mcamento8/omnimod-forge-compat",
        "OMNIMOD_COMMAND_BLOCKS_REPO": "https://github.com/Mcamento8/omnimod-command-blocks"
      }
    }
  }
}
```

> Since v1.2.0 these two URLs are the built-in defaults, so the `env` override
> is optional — a fresh install is already linked. Keep it only if you fork a
> mirror.

### At runtime (any client):

```
omni_config { forgeCompatRepoUrl: "https://github.com/Mcamento8/omnimod-forge-compat",
              commandBlocksRepoUrl: "https://github.com/Mcamento8/omnimod-command-blocks" }
```

### Verify the link:

```
omni_knowledge { topic: "repos" }
→ both entries must show status "linked" and the URLs.
```

---

## Step 3 — Publish the MCP itself

Pick ONE route (you can switch later):

### Route A — GitHub repository (recommended first publish)

1. Create a repo, e.g. `omnimod-mcp`.
2. Copy the MCP package (the `mcp/` folder contents) and push:

```bash
cd C:\path\to\omnimod-mcp            # a clean copy of mcp/'s contents
git init && git add . && git commit -m "omnimod-mcp 1.2.0"
git remote add origin https://github.com/Mcamento8/omnimod-mcp.git
git push -u origin main
# live at https://github.com/Mcamento8/omnimod-mcp
```

3. Consumers point their client at the repo:
   - clone → `npm install` → `node dist/index.js`; or
   - GitHub supports `npx` from a git URL once you add a `prepare` build script
     (see Route B prep below).

### Route B — npm package (for `npx omnimod-mcp` / global install)

Before publishing, make these one-time edits to `mcp/package.json`:

```jsonc
{
  "private": false,                  // REQUIRED: npm refuses to publish private:true
  "version": "1.2.0",                // already set in package.json
  "repository": { "type": "git", "url": "https://github.com/Mcamento8/omnimod-mcp" },
  "license": "MIT",
  "files": ["dist", "assets", "docs", "examples", "tools", "README.md", "AGENT_BRIEFING.md", "PUBLISHING.md", ".env.example", "LICENSE"],
  "scripts": {
    "prepare": "npm run build"       // already set — lets git-url installs compile TS
  }
}
```

Then:

```bash
cd mcp
npm run build
npm adduser          # once (or npm login)
npm publish --access public
```

Consumers then use any of:

```json
{ "command": "npx", "args": ["-y", "omnimod-mcp"] }
{ "command": "omnimod-mcp" }
{ "command": "node", "args": ["<global>/node_modules/omnimod-mcp/dist/index.js"] }
```

**Important:** keep `assets/` and `docs/` in the published package (the
map-context-pack bootstrap and the master guide resource read them from disk
relative to the package root — the `files` list above includes them).

---

## Step 4 — Client wiring (what every user of your MCP does)

The server speaks MCP over stdio: `node dist/index.js`. Configs for all major
clients are in `mcp/examples/` (Claude Desktop, Claude Code, Cursor, Cline,
Kilo/ZCode). Connection env vars:

| Var | Default | Meaning |
|---|---|---|
| `OMNIMOD_HOST` | 127.0.0.1 | Device running OmniMod |
| `OMNIMOD_PORT` | 26911 | Agent Dev Link port |
| `OMNIMOD_TOKEN` | (none) | 32-hex pairing token (or use `omni_pair` with the 8-char code) |
| `OMNIMOD_TIMEOUT_MS` | 20000 | Per-request HTTP timeout |
| `OMNIMOD_PROJECT_ROOT` | (none) | Local OmniMod checkout (JAR/docs access) |
| `OMNIMOD_WORLDS_DIR` | (derived) | Where map folders live |
| `OMNIMOD_AUTO_TRANSLATE_BLOCKS` | true | 1.20→1.8 translation on send |
| `OMNIMOD_FORGE_COMPAT_REPO` | (none) | Link to the compat-layer repo |
| `OMNIMOD_COMMAND_BLOCKS_REPO` | (none) | Link to the command-block repo |

---

## Step 5 — Full verification (the "no problems" checklist)

### 5.1 Offline (no game needed)

```bash
cd mcp
npm run build      # exit 0
npm run selfcheck  # "selfcheck PASS"
npm run e2e        # "E2E PASS" — 51 tools, 13 resources, 5 prompts
```

### 5.2 Live (game running with Agent Link)

1. Launch the game, enter a world, enable Agent Link
   (Options → Agent Link Info → Quick Pair Computer → note the 8-char code).
2. Run the live test:

```bash
cd mcp
npm run live-test
# first run tells you to set OMNIMOD_TOKEN — pair once:
#   in your MCP client call omni_pair {code:"XXXXXXXX"}
#   or set OMNIMOD_TOKEN in the env block
npm run live-test
# expect: LIVE TEST PASS — dual-mode tool, knowledge topics, master guide
```

3. Manual dual-mode sanity (what the live test automates):

```
omni_mapdev_mode {}                 → {"mode":"dev"|"play", "map":...}
omni_mapdev_mode {mode:"play"}      → in game: command blocks vanish,
                                       unopenable, unbreakable — logic live
omni_mapdev_mode {mode:"dev"}       → everything returns instantly
```

While in PLAY: trigger a known command-block effect (`omni_command`) and
confirm it still fires — **hiding never disables**.

### 5.3 Repository links

```
omni_knowledge { topic: "repos" }   → both systems "linked" with your URLs
```

Click/GET one URL — it must resolve to the GitHub repo (not 404).

### 5.4 What is verified by what

| Claim | Verified by |
|---|---|
| MCP compiles clean | `npm run build` (exit 0) |
| Registry/translation/shapes/scaffold/inspect/mapdocs | `npm run selfcheck` |
| Full JSON-RPC surface: 51 tools, 13 resources, 5 prompts | `npm run e2e` |
| Master guide served (tool + resource, ~24 KB) | e2e + `omni_map_guide` |
| Dual-mode tool against a real game | `npm run live-test` |
| Game's per-map context pack == MCP pack | byte-identical export check (MapDevWorkspaceDocsExport → mcp/assets/map-context-pack) — verified during this build |
| Game /help catalog includes `/omni/mapdev/mode` | GET /omni/help on the device after the next engine build |

---

## Step 6 — Maintenance policy (keep everything true)

| When this changes | Do this |
|---|---|
| Engine compat layer / command system code | run the sync tool: `python tools/omnimod_sync.py` (re-exports both mirrors, regenerates manifests, runs the MCP test battery, pushes to GitHub — see `tools/README.md`). Manual fallback: `powershell -File _agent_tmp\build_repos.ps1`, then commit the diff in each repo (`FILE_MANIFEST.txt` shows what moved) |
| The per-map context pack (MapDevWorkspaceDocs.java) | bump `DOCS_VERSION`, re-export via `MapDevWorkspaceDocsExport` → `mcp/assets/map-context-pack/` (the harness at `tmp_mapdev_harness/`), re-run selfcheck/e2e |
| The master guide (`mcp/docs/MAP_DEV_MASTER_GUIDE.md`) | edit, re-run e2e (it asserts the guide's section headers) |
| MCP tools/topics | bump `package.json` version, update the tool-count lines in README/AGENT_BRIEFING, extend `scripts/e2e.mjs`, re-run the battery |

---

## Quick answer key (الملخص السريع)

1. انشر المستودعين: `mcp/repos/omnimod-forge-compat` و `mcp/repos/omnimod-command-blocks` — كل واحد مستودع GitHub مستقل (الخطوة 1) — تم: `Mcamento8/omnimod-forge-compat` و `Mcamento8/omnimod-command-blocks`.
2. الروابط مربوطة افتراضياً منذ v1.2.0 — لا حاجة لإعداد (الخطوة 2 للتوثيق فقط).
3. انشر الـ MCP كمستودع GitHub أولاً (`Mcamento8/omnimod-mcp`)، ثم npm عندما تريد `npx omnimod-mcp` (الخطوة 3 — `private:false` و `files` مضبوطان مسبقاً).
4. تحقق دائماً: `build → selfcheck → e2e → live-test` (الخطوة 5).
5. كل تغيير مستقبلي في المحرك = إعادة تصدير المستودعات + إعادة الاختبارات (الخطوة 6).
