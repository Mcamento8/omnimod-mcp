/**
 * Per-map agent context pack: read, verify, bootstrap, and maintain the
 * `_dev/` documents that the engine writes next to every map's batch folder.
 *
 * Why this lives in the MCP server as well as in the engine
 * --------------------------------------------------------
 * `MapDevWorkspaceDocs.java` is the canonical generator: the game writes the
 * pack into `worlds/<map>/_dev/` on world load (MapDevSyncRuntime.ensureWorkspace).
 * But an agent frequently works on a map folder the running game has not
 * provisioned yet — a copy pulled off a phone, an exported map, a folder synced
 * from another machine, or a Web-target save with no HTTP bridge at all. In
 * those cases the MCP has to be able to produce the identical pack from disk.
 *
 * The pack shipped here is EXPORTED FROM THE ENGINE CLASS, not hand-copied:
 *   tmp_mapdev_harness/MapDevWorkspaceDocsExport.java -> mcp/assets/map-context-pack/
 * with the map name replaced by the MAP_TOKEN sentinel. That keeps one source of
 * truth (§ no duplicated contract text) and makes divergence detectable.
 */
import { readdir, readFile, stat, mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

/** Sentinel the exporter substitutes for the real map name. */
export const MAP_TOKEN = "__OMNIMOD_MAP__";

/**
 * Normalize line endings to LF. Pack templates and map documents may carry
 * CRLF when the MCP package was checked out on Windows (or when a user
 * hand-edits a doc in Notepad); every regex below assumes `\n`, so all text
 * is funneled through here right after it is read from disk.
 */
export const nl = (s: string): string => s.replace(/\r\n/g, "\n");

/** Mirrors MapDevWorkspace / MapDevWorkspaceDocs layout constants. */
export const LAYOUT = {
  DEV_DIR: "_dev",
  BUILD_SUBDIR: "build",
  STATE_SUBDIR: "state",
  AGENT_SUBDIR: "agent",
  TEMPLATES_SUBDIR: "templates",
  VERIFICATION_SUBDIR: "verification",
  MANIFEST_FILE: "dev_manifest.json",
  README_FILE: "README.md",
  LEDGER_FILE: "applied.json",
  LINK_FILE: "link.json",
  START_HERE_FILE: "AGENT_START_HERE.md",
  OVERVIEW_FILE: "MAP_OVERVIEW.md",
  CHANGELOG_FILE: "CHANGE_LOG.md",
  FILEMAP_FILE: "FILE_MAP.md",
} as const;

/** The reading order the pack itself mandates (AGENT_START_HERE.md gate 1). */
export const READ_ORDER: readonly string[] = [
  LAYOUT.START_HERE_FILE,
  `${LAYOUT.AGENT_SUBDIR}/00_AGENT_MANDATE.md`,
  LAYOUT.OVERVIEW_FILE,
  LAYOUT.CHANGELOG_FILE,
  LAYOUT.FILEMAP_FILE,
  `${LAYOUT.AGENT_SUBDIR}/01_MAP_BUILD_SYSTEM.md`,
  `${LAYOUT.AGENT_SUBDIR}/02_BLOCK_NAMES_AND_META.md`,
  `${LAYOUT.AGENT_SUBDIR}/03_DESIGN_AND_GEOMETRY.md`,
  `${LAYOUT.AGENT_SUBDIR}/04_TESTING_MANDATE.md`,
  LAYOUT.README_FILE,
];

/** Reference-only documents: read when the task needs them. */
export const REFERENCE_DOCS: readonly string[] = [
  `${LAYOUT.AGENT_SUBDIR}/05_AGENT_LINK_API.md`,
  `${LAYOUT.AGENT_SUBDIR}/06_MOD_AUTHORING.md`,
  `${LAYOUT.AGENT_SUBDIR}/07_MODS_IN_THIS_MAP.md`,
  `${LAYOUT.AGENT_SUBDIR}/08_TROUBLESHOOTING.md`,
  `${LAYOUT.AGENT_SUBDIR}/09_HANDOFF_PROTOCOL.md`,
];

/** Files the agent owns; the engine seeds them once and never overwrites them. */
export const LIVING_DOCS: readonly string[] = [
  LAYOUT.OVERVIEW_FILE,
  LAYOUT.CHANGELOG_FILE,
  LAYOUT.FILEMAP_FILE,
];

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * `dist/mapdocs.js` sits one level below the package root, so the asset folder
 * is `../assets/map-context-pack`. When running from `src/` under a loader the
 * same relative path holds.
 */
function assetRoot(): string {
  return resolve(HERE, "..", "assets", "map-context-pack");
}

export interface PackFile {
  /** Path relative to `_dev/`. */
  rel: string;
  text: string;
}

export interface PackSource {
  version: string;
  static: PackFile[];
  living: PackFile[];
}

async function readTree(root: string, prefix = ""): Promise<PackFile[]> {
  const out: PackFile[] = [];
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const abs = join(root, e.name);
    const rel = prefix ? `${prefix}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...(await readTree(abs, rel)));
    else out.push({ rel, text: nl(await readFile(abs, "utf8")) });
  }
  return out;
}

/** Load the exported pack from `mcp/assets/map-context-pack/`. */
export async function loadPackSource(): Promise<PackSource> {
  const root = assetRoot();
  let version = "unknown";
  try {
    version = (await readFile(join(root, "version.txt"), "utf8")).trim();
  } catch {
    /* version.txt missing -> reported as unknown; bootstrap still works */
  }
  return {
    version,
    static: await readTree(join(root, "static")),
    living: await readTree(join(root, "living")),
  };
}

/** Substitute the real map name into an exported template. */
export function personalize(text: string, mapName: string): string {
  return text.split(MAP_TOKEN).join(mapName);
}

// =====================================================================
// LOCATING A MAP FOLDER ON DISK
// =====================================================================

async function isDir(p: string): Promise<boolean> {
  try {
    return (await stat(p)).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Resolve a map to a real directory. Accepts, in order of precedence:
 *  1. an absolute path to the map folder itself (contains `level.dat` or `_dev/`)
 *  2. an absolute path to a `worlds` folder plus a map name
 *  3. a map name resolved against `config.worldsDir`
 *  4. a map name resolved against `<projectRoot>/filesystem/worlds`
 *     (the Desktop/LWJGL layout: PlatformFilesystem.filesystemsRoot = "filesystem",
 *      DesktopClientConfigAdapter.getWorldsDB() = "worlds")
 */
export async function resolveMapDir(
  opts: { mapDir?: string; worldsDir?: string; map?: string },
  cfg: { worldsDir: string | null; projectRoot: string | null },
): Promise<{ dir: string; map: string; how: string }> {
  const tried: string[] = [];

  if (opts.mapDir) {
    const d = resolve(opts.mapDir);
    tried.push(d);
    if (await isDir(d)) {
      return { dir: d, map: d.split(sep).filter(Boolean).pop() ?? "map", how: "mapDir" };
    }
  }

  const roots: Array<[string, string]> = [];
  if (opts.worldsDir) roots.push([resolve(opts.worldsDir), "worldsDir argument"]);
  if (cfg.worldsDir) roots.push([cfg.worldsDir, "OMNIMOD_WORLDS_DIR"]);
  if (cfg.projectRoot) {
    roots.push([resolve(cfg.projectRoot, "filesystem", "worlds"), "projectRoot/filesystem/worlds"]);
    roots.push([resolve(cfg.projectRoot, "filesystem", "sp", "worlds"), "projectRoot/filesystem/sp/worlds (legacy)"]);
  }

  if (opts.map) {
    for (const [r, how] of roots) {
      const d = join(r, opts.map);
      tried.push(d);
      if (await isDir(d)) return { dir: d, map: opts.map, how };
    }
  }

  throw new Error(
    [
      "Could not locate the map folder on disk.",
      opts.map ? `map: ${opts.map}` : "no map name given",
      "Tried:",
      ...tried.map((t) => `  - ${t}`),
      "",
      "Fix one of these:",
      "  - pass mapDir with the absolute path of the map folder, or",
      "  - pass worldsDir with the absolute path of the worlds folder, or",
      "  - set OMNIMOD_WORLDS_DIR, or",
      "  - set OMNIMOD_PROJECT_ROOT (Desktop layout: <root>/filesystem/worlds/<map>).",
      "",
      "On Android/Web the save folder is inside the app's storage and is not reachable",
      "from this machine; use the linked-folder workflow (/omni_dev linkset) or the",
      "bridge tool omni_batch_apply instead of direct file access.",
    ].join("\n"),
  );
}

// =====================================================================
// READING THE PACK OUT OF A MAP FOLDER
// =====================================================================

export interface DocState {
  rel: string;
  exists: boolean;
  bytes: number;
  /** Version marker found inside the file, when it is a generated doc. */
  version: string | null;
  /** True when a living document is still in its seeded (unwritten) state. */
  seeded?: boolean;
}

const VERSION_RE = /omnimod-agent-docs-\d+/;

function detectVersion(text: string): string | null {
  const m = VERSION_RE.exec(text);
  return m ? m[0] : null;
}

/** A living doc is "seeded" while it still carries the generator's placeholder banner. */
function looksSeeded(rel: string, text: string): boolean {
  if (rel === LAYOUT.OVERVIEW_FILE) return text.includes("**Status: NOT YET WRITTEN.**");
  if (rel === LAYOUT.FILEMAP_FILE) return text.includes("this is the seeded version");
  if (rel === LAYOUT.CHANGELOG_FILE) return !/^## (?!<yyyy)/m.test(text.replace(/^## <yyyy.*$/gm, ""));
  return false;
}

export interface PackStatus {
  mapDir: string;
  map: string;
  devDir: string;
  packVersionExpected: string;
  docs: DocState[];
  missing: string[];
  outdated: string[];
  unwritten: string[];
  batches: string[];
  verificationReports: string[];
  hasLedger: boolean;
  ok: boolean;
  summary: string;
}

/** Inspect a map folder's `_dev/` pack without modifying anything. */
export async function packStatus(mapDir: string, map: string): Promise<PackStatus> {
  const src = await loadPackSource();
  const dev = join(mapDir, LAYOUT.DEV_DIR);
  const expected = [
    ...src.static.map((f) => f.rel),
    ...src.living.map((f) => f.rel),
    LAYOUT.README_FILE,
    LAYOUT.MANIFEST_FILE,
  ];

  const docs: DocState[] = [];
  const missing: string[] = [];
  const outdated: string[] = [];
  const unwritten: string[] = [];

  for (const rel of expected) {
    const abs = join(dev, ...rel.split("/"));
    let text: string | null = null;
    try {
      text = await readFile(abs, "utf8");
    } catch {
      text = null;
    }
    if (text === null) {
      docs.push({ rel, exists: false, bytes: 0, version: null });
      missing.push(rel);
      continue;
    }
    const version = detectVersion(text);
    const isGenerated = rel !== LAYOUT.README_FILE && rel !== LAYOUT.MANIFEST_FILE;
    const isLiving = (LIVING_DOCS as readonly string[]).includes(rel);
    if (isGenerated && !isLiving && version !== src.version) outdated.push(rel);
    const seeded = isLiving ? looksSeeded(rel, text) : undefined;
    if (seeded) unwritten.push(rel);
    docs.push({ rel, exists: true, bytes: Buffer.byteLength(text, "utf8"), version, ...(seeded !== undefined ? { seeded } : {}) });
  }

  const batches = (await safeList(join(dev, LAYOUT.BUILD_SUBDIR))).filter((n) => n.toLowerCase().endsWith(".json")).sort();
  const verificationReports = (
    await safeList(join(dev, LAYOUT.STATE_SUBDIR, LAYOUT.VERIFICATION_SUBDIR))
  ).sort();
  const hasLedger = await fileExists(join(dev, LAYOUT.STATE_SUBDIR, LAYOUT.LEDGER_FILE));

  const ok = missing.length === 0 && outdated.length === 0;
  const summary = [
    `map: ${map}`,
    `_dev: ${dev}`,
    `pack version expected: ${src.version}`,
    `docs present: ${docs.filter((d) => d.exists).length}/${docs.length}`,
    missing.length ? `MISSING (${missing.length}): ${missing.join(", ")}` : "missing: none",
    outdated.length ? `OUTDATED (${outdated.length}): ${outdated.join(", ")}` : "outdated: none",
    unwritten.length
      ? `STILL SEEDED — an agent must fill these in (${unwritten.length}): ${unwritten.join(", ")}`
      : "living documents: written",
    `batches: ${batches.length}${batches.length ? ` (${batches.join(", ")})` : ""}`,
    `verification reports: ${verificationReports.length}`,
    `ledger: ${hasLedger ? "present" : "absent"}`,
  ].join("\n");

  return {
    mapDir,
    map,
    devDir: dev,
    packVersionExpected: src.version,
    docs,
    missing,
    outdated,
    unwritten,
    batches,
    verificationReports,
    hasLedger,
    ok,
    summary,
  };
}

async function safeList(dir: string): Promise<string[]> {
  try {
    return await readdir(dir);
  } catch {
    return [];
  }
}

async function fileExists(p: string): Promise<boolean> {
  try {
    return (await stat(p)).isFile();
  } catch {
    return false;
  }
}

/** Read one or more pack documents out of a map folder. */
export async function readDocs(mapDir: string, rels: readonly string[]): Promise<Array<{ rel: string; text: string | null }>> {
  const dev = join(mapDir, LAYOUT.DEV_DIR);
  const out: Array<{ rel: string; text: string | null }> = [];
  for (const rel of rels) {
    try {
      out.push({ rel, text: await readFile(join(dev, ...rel.split("/")), "utf8") });
    } catch {
      out.push({ rel, text: null });
    }
  }
  return out;
}

// =====================================================================
// WRITING / REPAIRING THE PACK
// =====================================================================

export interface BootstrapResult {
  mapDir: string;
  map: string;
  version: string;
  written: string[];
  refreshed: string[];
  seeded: string[];
  skipped: string[];
  createdDirs: string[];
}

/**
 * Create or repair the pack in a map folder.
 *
 * Ownership rules match the engine exactly (MapDevSyncRuntime.ensureAgentDocs):
 *  - static knowledge docs are (re)written when missing OR version-stale,
 *  - living documents are written ONLY when absent, never overwritten,
 *  - `build/` and `state/verification/` are created empty if missing.
 *
 * `force` re-writes the static docs even when the version already matches (use
 * after hand-editing them by mistake).
 */
export async function bootstrapPack(
  mapDir: string,
  map: string,
  opts: { force?: boolean } = {},
): Promise<BootstrapResult> {
  const src = await loadPackSource();
  if (src.static.length === 0) {
    throw new Error(
      `The MCP's bundled context pack is empty (${assetRoot()}). Re-export it from the engine class with tmp_mapdev_harness/MapDevWorkspaceDocsExport.java.`,
    );
  }
  const dev = join(mapDir, LAYOUT.DEV_DIR);
  const written: string[] = [];
  const refreshed: string[] = [];
  const seeded: string[] = [];
  const skipped: string[] = [];
  const createdDirs: string[] = [];

  for (const d of [
    dev,
    join(dev, LAYOUT.AGENT_SUBDIR, LAYOUT.TEMPLATES_SUBDIR),
    join(dev, LAYOUT.BUILD_SUBDIR),
    join(dev, LAYOUT.STATE_SUBDIR, LAYOUT.VERIFICATION_SUBDIR),
  ]) {
    if (!(await isDir(d))) {
      await mkdir(d, { recursive: true });
      createdDirs.push(d);
    }
  }

  for (const f of src.static) {
    const abs = join(dev, ...f.rel.split("/"));
    let current: string | null = null;
    try {
      current = await readFile(abs, "utf8");
    } catch {
      current = null;
    }
    const stale = current === null || detectVersion(current) !== src.version;
    if (stale || opts.force) {
      await mkdir(dirname(abs), { recursive: true });
      await writeFile(abs, personalize(f.text, map), "utf8");
      (current === null ? written : refreshed).push(f.rel);
    } else {
      skipped.push(f.rel);
    }
  }

  for (const f of src.living) {
    const abs = join(dev, ...f.rel.split("/"));
    if (await fileExists(abs)) {
      skipped.push(f.rel);
      continue;
    }
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, personalize(f.text, map), "utf8");
    seeded.push(f.rel);
  }

  return { mapDir, map, version: src.version, written, refreshed, seeded, skipped, createdDirs };
}

// =====================================================================
// FILE_MAP.md — regenerated from the real folder contents
// =====================================================================

interface Walked {
  rel: string;
  bytes: number;
  mtime: string;
  dir: boolean;
}

async function walkAll(root: string, prefix = "", depth = 0): Promise<Walked[]> {
  if (depth > 12) return [];
  const out: Walked[] = [];
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const abs = join(root, e.name);
    const rel = prefix ? `${prefix}/${e.name}` : e.name;
    if (e.isDirectory()) {
      out.push({ rel, bytes: 0, mtime: "", dir: true });
      out.push(...(await walkAll(abs, rel, depth + 1)));
    } else {
      let bytes = 0;
      let mtime = "";
      try {
        const st = await stat(abs);
        bytes = st.size;
        mtime = st.mtime.toISOString().slice(0, 16).replace("T", " ");
      } catch {
        /* unreadable entry is still listed, with zeroes */
      }
      out.push({ rel, bytes, mtime, dir: false });
    }
  }
  return out;
}

const OWNERS: Array<[RegExp, string]> = [
  [new RegExp(`^${LAYOUT.AGENT_SUBDIR}/`), "game"],
  [new RegExp(`^${LAYOUT.START_HERE_FILE}$`), "game"],
  [new RegExp(`^${LAYOUT.README_FILE}$`), "game"],
  [new RegExp(`^${LAYOUT.MANIFEST_FILE}$`), "game"],
  [new RegExp(`^${LAYOUT.LINK_FILE}$`), "game"],
  [new RegExp(`^${LAYOUT.STATE_SUBDIR}/${LAYOUT.LEDGER_FILE}$`), "game (never edit)"],
  [new RegExp(`^${LAYOUT.OVERVIEW_FILE}$`), "agents"],
  [new RegExp(`^${LAYOUT.CHANGELOG_FILE}$`), "agents"],
  [new RegExp(`^${LAYOUT.FILEMAP_FILE}$`), "agents"],
  [new RegExp(`^${LAYOUT.BUILD_SUBDIR}/`), "agents"],
  [new RegExp(`^${LAYOUT.STATE_SUBDIR}/${LAYOUT.VERIFICATION_SUBDIR}/`), "agents"],
];

function ownerOf(rel: string): string {
  for (const [re, owner] of OWNERS) if (re.test(rel)) return owner;
  return "unclassified";
}

/** Extract the `batch` label out of a batch file so the index is readable. */
async function batchLabel(abs: string): Promise<string> {
  try {
    const raw = await readFile(abs, "utf8");
    const parsed = JSON.parse(raw) as { batch?: unknown; ops?: unknown[] };
    const label = typeof parsed.batch === "string" ? parsed.batch : "";
    const n = Array.isArray(parsed.ops) ? parsed.ops.length : 0;
    return label ? `${label} (${n} ops)` : `${n} ops`;
  } catch {
    return "UNPARSEABLE JSON — this batch will fail at apply time";
  }
}

export interface FileMapResult {
  path: string;
  entries: number;
  bytes: number;
  text: string;
}

/**
 * Regenerate `FILE_MAP.md` from the real contents of the map folder.
 *
 * The point of this file is that agents stop guessing paths. So it is generated,
 * never hand-maintained: it lists every file under `_dev/`, plus the world data
 * files marked off-limits, plus the sibling mod-staging folders when they exist.
 */
export async function regenerateFileMap(
  mapDir: string,
  map: string,
  opts: { agent?: string; worldsDir?: string } = {},
): Promise<FileMapResult> {
  const dev = join(mapDir, LAYOUT.DEV_DIR);
  const devEntries = await walkAll(dev);
  const rootEntries = await walkAll(mapDir, "", 11);

  const worldData = rootEntries.filter(
    (e) => !e.rel.startsWith(`${LAYOUT.DEV_DIR}/`) && e.rel !== LAYOUT.DEV_DIR && e.rel.split("/").length <= 2,
  );

  const lines: string[] = [];
  const now = new Date().toISOString().slice(0, 16).replace("T", " ");
  lines.push(`# FILE MAP — \`${map}\``);
  lines.push("");
  lines.push("> **Owned by AI agents. GENERATED — do not hand-edit.** Regenerate it after creating,");
  lines.push("> renaming or deleting any file. With the OmniMod MCP: `omni_map_filemap`.");
  lines.push("> Rules: `" + LAYOUT.AGENT_SUBDIR + "/09_HANDOFF_PROTOCOL.md`.");
  lines.push("");
  lines.push(`**Last regenerated:** ${now} (UTC)`);
  lines.push(`**Generated by:** ${opts.agent ?? "omni_map_filemap (OmniMod MCP)"}`);
  lines.push(`**Map folder:** \`${mapDir}\``);
  lines.push("");
  lines.push("All paths below are relative to the map folder unless stated otherwise.");
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("## World data — present, and OFF LIMITS");
  lines.push("");
  if (worldData.length === 0) {
    lines.push("_No world data files found in this folder (is this an unplayed or partial copy?)._");
  } else {
    lines.push("| path | size | modified |");
    lines.push("|---|---|---|");
    for (const e of worldData) {
      lines.push(`| \`${e.rel}${e.dir ? "/" : ""}\` | ${e.dir ? "dir" : fmtBytes(e.bytes)} | ${e.mtime} |`);
    }
  }
  lines.push("");
  lines.push("Never modify these. Corrupting them destroys the user's map.");
  lines.push("");

  lines.push(`## Workspace — \`${LAYOUT.DEV_DIR}/\``);
  lines.push("");
  if (devEntries.length === 0) {
    lines.push("_The `_dev/` workspace does not exist yet. Run `omni_map_bootstrap` or load the map in game._");
  } else {
    lines.push("| path | owner | size | modified |");
    lines.push("|---|---|---|---|");
    for (const e of devEntries) {
      const p = `${LAYOUT.DEV_DIR}/${e.rel}${e.dir ? "/" : ""}`;
      lines.push(`| \`${p}\` | ${e.dir ? "—" : ownerOf(e.rel)} | ${e.dir ? "dir" : fmtBytes(e.bytes)} | ${e.mtime} |`);
    }
  }
  lines.push("");

  const batchFiles = devEntries.filter(
    (e) => !e.dir && e.rel.startsWith(`${LAYOUT.BUILD_SUBDIR}/`) && e.rel.toLowerCase().endsWith(".json"),
  );
  lines.push("## Batches — applied in FILENAME SORT ORDER");
  lines.push("");
  if (batchFiles.length === 0) {
    lines.push("_No batches yet._");
  } else {
    lines.push("| # | path | contents |");
    lines.push("|---|---|---|");
    let i = 1;
    for (const e of batchFiles) {
      const label = await batchLabel(join(dev, ...e.rel.split("/")));
      lines.push(`| ${i++} | \`${LAYOUT.DEV_DIR}/${e.rel}\` | ${label} |`);
    }
  }
  lines.push("");

  const reports = devEntries.filter(
    (e) => !e.dir && e.rel.startsWith(`${LAYOUT.STATE_SUBDIR}/${LAYOUT.VERIFICATION_SUBDIR}/`),
  );
  lines.push("## Verification reports");
  lines.push("");
  if (reports.length === 0) {
    lines.push("_None yet. Every task owes one — see `" + LAYOUT.AGENT_SUBDIR + "/04_TESTING_MANDATE.md`._");
  } else {
    for (const e of reports) lines.push(`- \`${LAYOUT.DEV_DIR}/${e.rel}\` (${fmtBytes(e.bytes)}, ${e.mtime})`);
  }
  lines.push("");

  lines.push("## Related paths outside the map folder");
  lines.push("");
  const worlds = opts.worldsDir ?? dirname(mapDir);
  const siblingRoot = dirname(worlds);
  const siblings: Array<[string, string]> = [
    [join(siblingRoot, "mods", map), "mod JARs staged for this map"],
    [join(siblingRoot, "mods_folders", map), "folder mods for this map"],
    [join(siblingRoot, "mods_translated", map), "engine-generated translated assets"],
  ];
  let anySibling = false;
  lines.push("| path | exists | purpose |");
  lines.push("|---|---|---|");
  for (const [p, why] of siblings) {
    const there = await isDir(p);
    anySibling = anySibling || there;
    lines.push(`| \`${p}\` | ${there ? "yes" : "no"} | ${why} |`);
  }
  if (!anySibling) {
    lines.push("");
    lines.push("_No mod staging folders exist for this map — it is vanilla-only so far._");
  }
  lines.push("");
  lines.push(`<!-- generated-by: omni_map_filemap · entries: ${devEntries.length + worldData.length} -->`);
  lines.push("");

  const text = lines.join("\n");
  const abs = join(dev, LAYOUT.FILEMAP_FILE);
  await mkdir(dirname(abs), { recursive: true });
  await writeFile(abs, text, "utf8");
  return {
    path: abs,
    entries: devEntries.length + worldData.length,
    bytes: Buffer.byteLength(text, "utf8"),
    text,
  };
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

// =====================================================================
// CHANGE_LOG.md — append-only
// =====================================================================

export interface ChangelogEntry {
  title: string;
  agent?: string;
  requested?: string;
  interpretation?: string;
  batches?: Array<{ file: string; ops?: number; placed?: number; failed?: number; what?: string }>;
  blocksUsed?: string[];
  verification?: string[];
  decisions?: string[];
  notes?: string[];
  corrects?: string;
  reportPath?: string;
}

function bullets(items: readonly string[] | undefined, empty: string): string[] {
  if (!items || items.length === 0) return [`- ${empty}`];
  return items.map((s) => `- ${s}`);
}

/**
 * Append one entry to `CHANGE_LOG.md`.
 *
 * Append-only by construction: the existing text is never parsed or rewritten,
 * the new entry is concatenated. A correction to an earlier entry is itself a
 * new entry carrying `corrects`, which is exactly what the handoff protocol
 * requires (never delete history).
 */
export async function appendChangelog(
  mapDir: string,
  map: string,
  entry: ChangelogEntry,
): Promise<{ path: string; appended: string; bytes: number }> {
  const dev = join(mapDir, LAYOUT.DEV_DIR);
  const abs = join(dev, LAYOUT.CHANGELOG_FILE);
  let current: string;
  try {
    current = await readFile(abs, "utf8");
  } catch {
    // No changelog yet (map folder that the game never provisioned). Seed it
    // from the bundled pack so the file keeps its documented header.
    const src = await loadPackSource();
    const seed = src.living.find((f) => f.rel === LAYOUT.CHANGELOG_FILE);
    current = seed ? personalize(seed.text, map) : `# CHANGE LOG — \`${map}\`\n`;
  }

  const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
  const L: string[] = [];
  L.push("");
  L.push(`## ${stamp} — ${entry.title}`);
  L.push("");
  L.push(`**Agent:** ${entry.agent ?? "(unnamed agent)"}`);
  if (entry.corrects) L.push(`**Corrects:** ${entry.corrects}`);
  L.push(`**Requested:** ${entry.requested ?? "(not recorded — record the user's words next time)"}`);
  L.push(`**Interpretation:** ${entry.interpretation ?? "(not recorded)"}`);
  L.push("");
  L.push("### Batches");
  L.push("");
  if (entry.batches && entry.batches.length) {
    L.push("| file | ops | placed | failed | what |");
    L.push("|---|---|---|---|---|");
    for (const b of entry.batches) {
      L.push(
        `| \`${b.file}\` | ${b.ops ?? "?"} | ${b.placed ?? "?"} | ${b.failed ?? "?"} | ${b.what ?? ""} |`,
      );
    }
  } else {
    L.push("_No batches (documentation-only change)._");
  }
  L.push("");
  L.push("### Blocks used (translated to 1.8 names + meta)");
  L.push("");
  L.push(entry.blocksUsed && entry.blocksUsed.length ? entry.blocksUsed.join(", ") : "_none_");
  L.push("");
  L.push("### Verification");
  L.push("");
  L.push(
    ...bullets(
      entry.verification,
      "**NOT VERIFIED** — this is a contract violation; run the battery in " +
        `${LAYOUT.AGENT_SUBDIR}/04_TESTING_MANDATE.md and append a correction entry.`,
    ),
  );
  if (entry.reportPath) L.push(`- Report: \`${entry.reportPath}\``);
  L.push("");
  L.push("### Decisions and deviations");
  L.push("");
  L.push(...bullets(entry.decisions, "none — everything was explicitly specified by the user"));
  L.push("");
  L.push("### Notes for the next agent");
  L.push("");
  L.push(...bullets(entry.notes, "none recorded"));
  L.push("");

  const appended = L.join("\n");
  const next = current.replace(/\s*$/, "\n") + appended;
  await mkdir(dirname(abs), { recursive: true });
  await writeFile(abs, next, "utf8");
  return { path: abs, appended, bytes: Buffer.byteLength(next, "utf8") };
}

// =====================================================================
// MAP_OVERVIEW.md — read / replace whole, or patch one section
// =====================================================================

/** Section headings of MAP_OVERVIEW.md, in order. */
export const OVERVIEW_SECTIONS: readonly string[] = [
  "1. Identity",
  "2. The user's goal",
  "3. Current build specification",
  "4. Coordinate conventions for this map",
  "5. Mods in this map",
  "6. Open items",
  "7. Do not touch",
  "8. Notes for whoever reads this next",
];

/**
 * Replace the body of one `## <n>. <name>` section in MAP_OVERVIEW.md, leaving
 * every other section untouched. Matching is by the leading section number so a
 * previous agent's reworded heading still resolves.
 */
export async function patchOverviewSection(
  mapDir: string,
  map: string,
  sectionNumber: number,
  body: string,
): Promise<{ path: string; heading: string; bytes: number }> {
  const abs = join(mapDir, LAYOUT.DEV_DIR, LAYOUT.OVERVIEW_FILE);
  let text: string;
  try {
    text = nl(await readFile(abs, "utf8"));
  } catch {
    const src = await loadPackSource();
    const seed = src.living.find((f) => f.rel === LAYOUT.OVERVIEW_FILE);
    text = seed ? personalize(seed.text, map) : `# MAP OVERVIEW — \`${map}\`\n`;
  }

  const re = new RegExp(`^## ${sectionNumber}\\. .*$`, "m");
  const m = re.exec(text);
  if (!m) {
    throw new Error(
      `Section ${sectionNumber} not found in ${LAYOUT.OVERVIEW_FILE}. Present headings:\n` +
        (text.match(/^## .*$/gm) ?? ["(none)"]).join("\n"),
    );
  }
  const startOfHeading = m.index;
  const afterHeading = startOfHeading + m[0].length;
  const nextRe = /^## /m;
  const rest = text.slice(afterHeading);
  const nextIdx = nextRe.exec(rest);
  const endOfSection = nextIdx ? afterHeading + nextIdx.index : text.length;

  const next =
    text.slice(0, afterHeading) + "\n\n" + body.replace(/\s*$/, "") + "\n\n" + text.slice(endOfSection);

  // Once any real content lands, the seeded banner is no longer true.
  const cleaned = next.replace(
    /\*\*Status: NOT YET WRITTEN\.\*\*[\s\S]*?failure of the handoff contract\.\n\n/,
    "",
  );

  await mkdir(dirname(abs), { recursive: true });
  await writeFile(abs, cleaned, "utf8");
  return { path: abs, heading: m[0], bytes: Buffer.byteLength(cleaned, "utf8") };
}

// =====================================================================
// Verification reports
// =====================================================================

export async function writeVerificationReport(
  mapDir: string,
  slug: string,
  text: string,
): Promise<{ path: string; bytes: number }> {
  const safe = slug
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "report";
  const date = new Date().toISOString().slice(0, 10);
  const name = safe.startsWith(date) ? `${safe}.md` : `${date}-${safe}.md`;
  const abs = join(mapDir, LAYOUT.DEV_DIR, LAYOUT.STATE_SUBDIR, LAYOUT.VERIFICATION_SUBDIR, name);
  await mkdir(dirname(abs), { recursive: true });
  await writeFile(abs, text.replace(/\s*$/, "\n"), "utf8");
  return { path: abs, bytes: Buffer.byteLength(text, "utf8") };
}

/** Read the apply ledger, for Level 1 verification without the HTTP bridge. */
export async function readLedger(
  mapDir: string,
): Promise<{ path: string; entries: Record<string, { hash: string; appliedAtMs: number; ops: number; placed: number; failed: number }> } | null> {
  const abs = join(mapDir, LAYOUT.DEV_DIR, LAYOUT.STATE_SUBDIR, LAYOUT.LEDGER_FILE);
  try {
    const raw = await readFile(abs, "utf8");
    const parsed = JSON.parse(raw) as {
      entries?: Record<string, { hash: string; appliedAtMs: number; ops: number; placed: number; failed: number }>;
    };
    return { path: abs, entries: parsed.entries ?? {} };
  } catch {
    return null;
  }
}
