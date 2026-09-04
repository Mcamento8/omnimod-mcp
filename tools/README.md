# OmniMod Sync Tool — `tools/omnimod_sync.py`

> **الأداة الاحترافية المحلية (Python):** كلما عدّلت نظام توافق اللعبة مع
> المودات، أو نظام الكوماند بلوك / تطوير المابات — شغّل هذه الأداة وهي تتكفل
> بالباقي: تحديث ملفات الـ MCP إلى أحدث نسخة، ثم رفعها على GitHub لتحل الجديدة
> محل القديمة.

The professional local sync tool. Run it after **any** change to the Forge
compat layer or the command-block / map-dev system. It automatically:

1. **Re-exports** the engine packages into `mcp/repos/omnimod-forge-compat`
   and `mcp/repos/omnimod-command-blocks` (preserving `.git`, `README.md`,
   `LICENSE`, `.gitattributes` — only `src/`, `docs/` and `FILE_MANIFEST.txt`
   are refreshed).
2. **Regenerates** `FILE_MANIFEST.txt` in each mirror.
3. **Verifies** the MCP (`npm run build` → `selfcheck` → `e2e`).
4. **Commits + pushes** each mirror to GitHub (new files replace old ones;
   history is kept so every update stays reviewable).
5. Optionally (`--include-mcp`) commits + pushes the MCP repo itself.

## Requirements

- Python 3.10+ (Windows: `python`; macOS/Linux: `python3`) — standard library
  only, nothing to install.
- Node.js 18+ (for the test battery), `git`, and `gh` logged in
  (`gh auth login` once).

## Usage

```bash
# Preview everything without pushing anything (safe to try first):
python tools/omnimod_sync.py --dry-run

# Full sync + push with confirmation prompt:
python tools/omnimod_sync.py

# Full sync + push without prompting (for scripts):
python tools/omnimod_sync.py --yes

# Only one mirror:
python tools/omnimod_sync.py --only forge
python tools/omnimod_sync.py --only cmd

# Skip the npm battery (faster, not recommended):
python tools/omnimod_sync.py --skip-tests

# Also push the MCP repository itself:
python tools/omnimod_sync.py --include-mcp

# Custom commit message:
python tools/omnimod_sync.py --commit-msg "Fix armor texture bridge + re-export"
```

## When to run it

| You changed... | Run... |
|---|---|
| Anything under `sources/.../forge/`, `ModManager.java`, Forge/library shims, compat pipeline docs (`docs/project_map/01-28,36`) | `python tools/omnimod_sync.py --only forge` (or full sync) |
| Parity commands, Brigadier shims, command-block files, `MapModeRuntime`, command docs (`29`, `37`) | `python tools/omnimod_sync.py --only cmd` (or full sync) |
| The map-dev workspace docs (per-map context pack) | Re-export via `MapDevWorkspaceDocsExport` → `mcp/assets/map-context-pack/`, then `npm run selfcheck`, then push the MCP repo |
| MCP tools / guide / examples | Bump `package.json` version, run the battery, push the MCP repo |

Exit code `0` = success. Any test failure aborts **before** pushing, so GitHub
never receives a broken snapshot.
