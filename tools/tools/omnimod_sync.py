#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
OmniMod Engine -> GitHub sync tool  |  اداة مزامنة محرك OmniMod مع GitHub
=========================================================================
PROFESSIONAL LOCAL TOOL — run it after ANY change to:
  1. the Forge 1.20.1 mod-compatibility layer, or
  2. the command-block / command-surface / map-dev system.

What it does, automatically:
  [1] Re-exports the engine packages from the OmniMod checkout into
      mcp/repos/omnimod-forge-compat  and  mcp/repos/omnimod-command-blocks
      (same package selection as _agent_tmp/build_repos.ps1, but it PRESERVES
      .git, README.md, LICENSE, .gitattributes and .gitignore).
  [2] Regenerates FILE_MANIFEST.txt in each mirror (sorted, LF, UTF-8).
  [3] Runs the MCP verification battery (npm run build/selfcheck/e2e)
      unless --skip-tests is given.
  [4] Commits the diff and pushes each mirror to GitHub, REPLACING the old
      files with the new ones (normal git commit+push — history is kept so
      every update is reviewable; FILE_MANIFEST.txt makes the change set
      obvious at a glance).
  [5] Optionally (--include-mcp) commits + pushes the MCP repository itself.

USAGE (Windows):
    python tools\\omnimod_sync.py --dry-run      :: preview only, push nothing
    python tools\\omnimod_sync.py --yes           :: full sync + push, no prompt
    python tools\\omnimod_sync.py --only forge    :: only the compat mirror
    python tools\\omnimod_sync.py --skip-tests    :: skip the npm battery

USAGE (macOS/Linux):
    python3 tools/omnimod_sync.py --dry-run

REQUIREMENTS: Python 3.10+, Node.js 18+ (for the test battery), git, gh
(logged in: `gh auth login`). Standard library only — nothing to pip-install.

EXIT CODES: 0 = success (or clean dry-run), 1 = nothing to do / failure.
"""

from __future__ import annotations

import argparse
import datetime as _dt
import os
import shutil
import subprocess
import sys
from pathlib import Path

# --------------------------------------------------------------------------
# Constants — the export contract (mirrors _agent_tmp/build_repos.ps1)
# --------------------------------------------------------------------------

FORGE_REPO = "omnimod-forge-compat"
CMD_REPO = "omnimod-command-blocks"

FORGE_DIRS = [
    r"net\lax1dude\eaglercraft\v1_8\forge",
    r"net\minecraftforge",
    r"net\minecraft",
    r"com\cinemamod",
    r"com\google",
    r"com\simibubi",
    r"com\tterrag",
    r"dev\architectury",
    r"dev\redstudio",
    r"dev\toma",
    r"mezz\jei",
    r"vazkii\patchouli",
    r"wily",
    r"top",
    r"brachy\modularui",
    r"software\bernie",
    r"terrablender",
]
FORGE_SINGLE_FILES = [
    # (source relative to sources/main/java, destination relative to repo src/main/java)
    (r"net\lax1dude\eaglercraft\v1_8\minecraft\ModManager.java",
     r"net\lax1dude\eaglercraft\v1_8\minecraft\ModManager.java"),
]
FORGE_DOCS = [
    "01_ITEM_MODEL_PIPELINE.md", "02_ARMOR_RENDERING_PIPELINE.md",
    "03_BLOCK_RENDERING_PIPELINE.md", "04_KEY_FILES_AND_METHODS.md",
    "05_COMMON_PITFALLS.md", "06_MOD_TESTING_GUIDE.md", "07_FIX_HISTORY.md",
    "08_FORGE_1201_VS_18_DIFFERENCES.md", "09_VFS_AND_RESOURCE_SYSTEM.md",
    "10_REGISTRATION_AND_LIFECYCLE.md", "11_LOOT_DROPS_PIPELINE.md",
    "12_ENTITY_BEHAVIOR_PIPELINE.md", "13_BROWSER_DISPLAY_PIPELINE.md",
    "14_PER_ELEMENT_COMPAT_TESTING.md",
    "15_BLOCK_COMPAT_INTERACTION_DISPATCH_PIPELINE.md",
    "16_JSON_GUI_DISPATCH_PIPELINE.md", "18_CUSTOM_3D_ITEM_RENDER_PIPELINE.md",
    "19_GECKOLIB_ENTITY_RENDER_PIPELINE.md", "20_GUI_SCREEN_MENU_PIPELINE.md",
    "21_TERRAIN_MESH_COMPAT_PIPELINE.md", "22_BLOCK_CAPABILITY_PIPELINE.md",
    "23_HOVER_INFO_HUD_PIPELINE.md", "25_ARMOR_BEHAVIOR_PIPELINE.md",
    "26_MULTIBLOCK_FORMATION_PIPELINE.md", "27_RECIPE_CRAFTING_PIPELINE.md",
    "28_EXPLOSION_CONVERSION_PIPELINE.md", "36_OMNIMOD_PACK_LOADER.md",
    "README.md",
]

CMD_MAIN_DIRS = [
    r"com\mojang\brigadier",
    r"net\minecraft\commands",
    r"net\minecraft\world\phys",
    r"net\lax1dude\eaglercraft\v1_8\forge\command",
]
CMD_MAIN_FILES = [
    (r"net\lax1dude\eaglercraft\v1_8\sp\MapModeRuntime.java",
     r"net\lax1dude\eaglercraft\v1_8\sp\MapModeRuntime.java"),
    (r"net\lax1dude\eaglercraft\v1_8\sp\ClientMapModeRuntime.java",
     r"net\lax1dude\eaglercraft\v1_8\sp\ClientMapModeRuntime.java"),
    (r"net\lax1dude\eaglercraft\v1_8\sp\server\EaglerMinecraftServer.java",
     r"net\lax1dude\eaglercraft\v1_8\sp\server\EaglerMinecraftServer.java"),
]
CMD_CLIENT_DIRS = [
    r"net\minecraft\command",
]
CMD_CLIENT_FILES = [
    (r"net\minecraft\block\BlockCommandBlock.java",
     r"net\minecraft\block\BlockCommandBlock.java"),
    (r"net\minecraft\tileentity\TileEntityCommandBlock.java",
     r"net\minecraft\tileentity\TileEntityCommandBlock.java"),
    (r"net\minecraft\network\NetHandlerPlayServer.java",
     r"net\minecraft\network\NetHandlerPlayServer.java"),
    (r"net\minecraft\client\network\NetHandlerPlayClient.java",
     r"net\minecraft\client\network\NetHandlerPlayClient.java"),
    (r"net\minecraft\server\management\ItemInWorldManager.java",
     r"net\minecraft\server\management\ItemInWorldManager.java"),
    (r"net\minecraft\server\management\ServerConfigurationManager.java",
     r"net\minecraft\server\management\ServerConfigurationManager.java"),
]
CMD_DOCS = ["29_COMMAND_BLOCK_PIPELINE.md", "37_MAP_MODE_PIPELINE.md"]

# Root files the tool must NEVER delete inside a mirror checkout.
PRESERVE_ROOT = {".git", "README.md", "LICENSE", ".gitattributes", ".gitignore",
                 "FILE_MANIFEST.txt"}

GIT_CANDIDATES = [
    "git",
    r"C:\Program Files\Git\bin\git.exe",
    r"C:\Program Files\Git\cmd\git.exe",
]

# --------------------------------------------------------------------------
# Small helpers
# --------------------------------------------------------------------------

try:  # Windows consoles default to cp1252 — force UTF-8 for Arabic logs.
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass


def log(msg: str) -> None:
    print(msg, flush=True)


def find_exe(candidates: list[str], label: str) -> str | None:
    for c in candidates:
        p = shutil.which(c) or (c if Path(c).is_file() else None)
        if p:
            return p
    log(f"[WARN] {label} not found on PATH. Some steps will be skipped. | "
        f"تعذر العثور على {label}.")
    return None


def run(cmd: list[str], cwd: Path | None = None,
        capture: bool = False) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, cwd=str(cwd) if cwd else None,
                          capture_output=capture, text=True,
                          encoding="utf-8", errors="replace")


def win_rel(parts: str) -> Path:
    """'a\\b\\c' -> Path('a','b','c') on any OS."""
    return Path(*parts.split("\\"))


def copy_dir(src: Path, dst: Path) -> int:
    """Copy a package dir (overwrite). Returns files copied."""
    if not src.is_dir():
        return 0
    dst.mkdir(parents=True, exist_ok=True)
    n = 0
    for root, _dirs, files in os.walk(src):
        rel = Path(root).relative_to(src)
        target_dir = dst / rel
        target_dir.mkdir(parents=True, exist_ok=True)
        for f in files:
            shutil.copy2(Path(root) / f, target_dir / f)
            n += 1
    return n


def clear_tree_keep_meta(repo: Path) -> None:
    """Delete everything in the mirror EXCEPT preserved root files + .git,
    then recreate the src/docs skeletons."""
    for child in repo.iterdir():
        if child.name in PRESERVE_ROOT:
            continue
        if child.is_dir():
            shutil.rmtree(child)
        else:
            child.unlink()


def write_manifest(repo: Path) -> tuple[int, int]:
    """Regenerate FILE_MANIFEST.txt (sorted rel-path + TAB + size, LF, UTF-8).
    Returns (files listed, total bytes)."""
    entries: list[str] = []
    total = 0
    for root, _dirs, files in os.walk(repo):
        if ".git" in Path(root).parts:
            continue
        for f in files:
            if f == "FILE_MANIFEST.txt":
                continue
            full = Path(root) / f
            rel = full.relative_to(repo).as_posix()
            size = full.stat().st_size
            total += size
            entries.append(f"{rel}\t{size}")
    entries.sort()
    (repo / "FILE_MANIFEST.txt").write_text("\n".join(entries) + "\n",
                                            encoding="utf-8", newline="\n")
    return len(entries), total


# --------------------------------------------------------------------------
# Export
# --------------------------------------------------------------------------

def export_forge(root: Path, repo: Path) -> tuple[int, int]:
    src_main = root / "sources" / "main" / "java"
    docs_src = root / "docs" / "project_map"
    if not src_main.is_dir():
        raise SystemExit(f"[ERROR] engine sources not found: {src_main}")
    clear_tree_keep_meta(repo)
    dest = repo / "src" / "main" / "java"
    n = 0
    for d in FORGE_DIRS:
        n += copy_dir(src_main / win_rel(d), dest / win_rel(d))
    for src_rel, dst_rel in FORGE_SINGLE_FILES:
        src = src_main / win_rel(src_rel)
        if src.is_file():
            dst = dest / win_rel(dst_rel)
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(src, dst)
            n += 1
        else:
            log(f"[WARN] missing engine file (skipped): {src_rel}")
    docs_dst = repo / "docs"
    docs_dst.mkdir(parents=True, exist_ok=True)
    nd = 0
    for d in FORGE_DOCS:
        src = docs_src / d
        if src.is_file():
            shutil.copy2(src, docs_dst / d)
            nd += 1
        else:
            log(f"[WARN] missing pipeline doc (skipped): {d}")
    listed, total = write_manifest(repo)
    log(f"[OK] {FORGE_REPO}: {n} engine files + {nd} docs "
        f"-> manifest lists {listed} files ({total:,} bytes).")
    return listed, total


def export_cmd(root: Path, repo: Path) -> tuple[int, int]:
    src_main = root / "sources" / "main" / "java"
    src_client = root / "sources" / "minecraft-client" / "java"
    docs_src = root / "docs" / "project_map"
    if not src_main.is_dir() or not src_client.is_dir():
        raise SystemExit(f"[ERROR] engine sources not found under {root}/sources")
    clear_tree_keep_meta(repo)
    main_dst = repo / "src" / "main" / "java"
    client_dst = repo / "src" / "minecraft-client" / "java"
    n = 0
    for d in CMD_MAIN_DIRS:
        n += copy_dir(src_main / win_rel(d), main_dst / win_rel(d))
    for src_rel, dst_rel in CMD_MAIN_FILES:
        src = src_main / win_rel(src_rel)
        if src.is_file():
            dst = main_dst / win_rel(dst_rel)
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(src, dst)
            n += 1
        else:
            log(f"[WARN] missing engine file (skipped): {src_rel}")
    for d in CMD_CLIENT_DIRS:
        n += copy_dir(src_client / win_rel(d), client_dst / win_rel(d))
    for src_rel, dst_rel in CMD_CLIENT_FILES:
        src = src_client / win_rel(src_rel)
        if src.is_file():
            dst = client_dst / win_rel(dst_rel)
            dst.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(src, dst)
            n += 1
        else:
            log(f"[WARN] missing engine file (skipped): {src_rel}")
    docs_dst = repo / "docs"
    docs_dst.mkdir(parents=True, exist_ok=True)
    nd = 0
    for d in CMD_DOCS:
        src = docs_src / d
        if src.is_file():
            shutil.copy2(src, docs_dst / d)
            nd += 1
        else:
            log(f"[WARN] missing pipeline doc (skipped): {d}")
    listed, total = write_manifest(repo)
    log(f"[OK] {CMD_REPO}: {n} engine files + {nd} docs "
        f"-> manifest lists {listed} files ({total:,} bytes).")
    return listed, total


# --------------------------------------------------------------------------
# Git
# --------------------------------------------------------------------------

def git_status_short(git: str, repo: Path) -> str:
    r = run([git, "-C", str(repo), "status", "--short"], capture=True)
    return r.stdout.strip() if r.returncode == 0 else ""


def commit_and_push(git: str, repo: Path, message: str, dry: bool) -> bool:
    """Stage everything, commit if there is a diff, push. Returns True if pushed."""
    if run([git, "-C", str(repo), "add", "-A"]).returncode != 0:
        log(f"[ERROR] git add failed in {repo.name}")
        return False
    diff = run([git, "-C", str(repo), "status", "--short"], capture=True).stdout.strip()
    if not diff:
        log(f"[OK] {repo.name}: no changes — already in sync. | لا توجد تغييرات.")
        return False
    changed = len(diff.splitlines())
    log(f"[INFO] {repo.name}: {changed} changed files.")
    if dry:
        log(f"[DRY-RUN] would commit + push {repo.name}: {message}")
        return False
    r = run([git, "-C", str(repo), "-c", "user.name=Mcamento8",
             "-c", "user.email=Mcamento8@users.noreply.github.com",
             "commit", "-m", message], capture=True)
    if r.returncode != 0:
        log(f"[ERROR] git commit failed in {repo.name}:\n{r.stdout}\n{r.stderr}")
        return False
    log(f"[OK] committed {repo.name}.")
    r = run([git, "-C", str(repo), "push"], capture=True)
    if r.returncode != 0:
        log(f"[ERROR] git push failed in {repo.name}:\n{r.stdout}\n{r.stderr}")
        log("       Fix: check `gh auth status`, then re-run this tool.")
        return False
    log(f"[OK] pushed {repo.name} — GitHub now serves the new files. | تم الرفع.")
    return True


# --------------------------------------------------------------------------
# Main
# --------------------------------------------------------------------------

def main() -> int:
    ap = argparse.ArgumentParser(
        description="OmniMod engine -> GitHub sync (mirrors + MCP battery).")
    ap.add_argument("--root", default=None,
                    help="OmniMod checkout root (default: two levels above this script, "
                         "or OMNIMOD_PROJECT_ROOT).")
    ap.add_argument("--only", choices=["forge", "cmd"], default=None,
                    help="Sync only one mirror.")
    ap.add_argument("--dry-run", action="store_true",
                    help="Re-export + test, but commit/push nothing.")
    ap.add_argument("--no-push", action="store_true",
                    help="Commit locally but do not push.")
    ap.add_argument("--skip-tests", action="store_true",
                    help="Skip the npm build/selfcheck/e2e battery.")
    ap.add_argument("--include-mcp", action="store_true",
                    help="Also commit+push the MCP repository itself (if mcp/ is a git checkout).")
    ap.add_argument("--yes", "-y", action="store_true",
                    help="Do not ask for confirmation before pushing.")
    ap.add_argument("--commit-msg", default=None,
                    help="Custom commit message (default: auto with date).")
    args = ap.parse_args()

    here = Path(__file__).resolve()
    mcp_dir = here.parent.parent            # .../mcp
    root = Path(args.root) if args.root else Path(
        os.environ.get("OMNIMOD_PROJECT_ROOT", mcp_dir.parent))
    repos = mcp_dir / "repos"
    stamp = _dt.datetime.now().strftime("%Y-%m-%d")
    msg = args.commit_msg or f"Engine snapshot {stamp} — sync from OmniMod checkout"

    log("=" * 70)
    log(" OmniMod sync — مزامنة المحرك مع GitHub")
    log(f" Root : {root}")
    log(f" MCP  : {mcp_dir}")
    log(f" Mode : {'DRY-RUN (no push)' if (args.dry_run or args.no_push) else 'LIVE (push enabled)'}")
    log("=" * 70)

    if not (root / "sources").is_dir() or not mcp_dir.is_dir():
        log(f"[ERROR] bad root. Expected <root>/sources and <root>/mcp. Got: {root}")
        return 1

    targets = []
    if args.only in (None, "forge"):
        targets.append((FORGE_REPO, export_forge))
    if args.only in (None, "cmd"):
        targets.append((CMD_REPO, export_cmd))

    # -- [1] re-export -----------------------------------------------------
    for name, fn in targets:
        repo = repos / name
        repo.mkdir(parents=True, exist_ok=True)
        fn(root, repo)

    # -- [2] test battery ---------------------------------------------------
    if not args.skip_tests:
        npm = shutil.which("npm") or shutil.which("npm.cmd")
        if not npm:
            log("[WARN] npm not found — skipping test battery. | تم تخطي الاختبارات.")
        else:
            for step in (["run", "build"], ["run", "selfcheck"], ["run", "e2e"]):
                log(f"[TEST] npm {' '.join(step)} ...")
                r = run([npm, *step], cwd=mcp_dir)
                if r.returncode != 0:
                    log(f"[ERROR] npm {' '.join(step)} FAILED — fix before pushing. "
                        f"| فشل الاختبار، أصلح المشكلة قبل الرفع.")
                    return 1
            log("[OK] MCP battery green: build + selfcheck + e2e. | الاختبارات خضراء.")
    else:
        log("[SKIP] test battery skipped (--skip-tests).")

    # -- [3] confirm ---------------------------------------------------------
    live_push = not (args.dry_run or args.no_push)
    if live_push and not args.yes:
        try:
            ans = input("Push the mirrors to GitHub now? (y/N) | رفع الملفات الآن؟ ")
        except EOFError:
            ans = "n"
        if ans.strip().lower() not in ("y", "yes", "نعم"):
            log("[CANCEL] push cancelled — files are re-exported locally only.")
            return 0

    # -- [4] commit + push ----------------------------------------------------
    git = find_exe(GIT_CANDIDATES, "git")
    if not git:
        log("[ERROR] git is required for commit/push. Install Git and re-run.")
        return 1
    pushed_any = False
    for name, _fn in targets:
        repo = repos / name
        if not (repo / ".git").is_dir():
            log(f"[WARN] {name} is not a git checkout — skipping push "
                f"(clone it from GitHub first).")
            continue
        if args.dry_run or args.no_push:
            commit_and_push(git, repo, msg, dry=True)
        else:
            pushed_any |= commit_and_push(git, repo, msg, dry=False)

    # -- [5] MCP repo itself ---------------------------------------------------
    if args.include_mcp:
        if (mcp_dir / ".git").is_dir():
            if args.dry_run or args.no_push:
                commit_and_push(git, mcp_dir, f"omnimod-mcp sync {stamp}", dry=True)
            else:
                commit_and_push(git, mcp_dir, f"omnimod-mcp sync {stamp}", dry=False)
        else:
            log("[WARN] mcp/ is not a git checkout — cannot push MCP itself.")

    log("=" * 70)
    if args.dry_run:
        log(" DRY-RUN complete — nothing was pushed. | انتهت المعاينة دون رفع.")
    elif pushed_any:
        log(" SYNC COMPLETE — GitHub serves the new files. | اكتملت المزامنة والرفع.")
    else:
        log(" DONE — mirrors already in sync (or push skipped). | لا جديد للمزامنة.")
    log("=" * 70)
    return 0


if __name__ == "__main__":
    sys.exit(main())
