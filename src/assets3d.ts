/**
 * assets3d.ts — the OmniMod CC0 3D model library, as an MCP-side capability.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * An agent building a map or a mod regularly needs a 3D model: a creature, a
 * building, a piece of furniture, a prop. Before this module the agent had two
 * bad options — hand-author an OBJ (slow, and it will not look good) or guess a
 * model id and upload something it has never seen.
 *
 * This module gives the missing loop:
 *
 *     search  ->  inspect  ->  fetch  ->  (verify)  ->  upload  ->  place
 *
 * The design rule that makes it cheap: **one small file answers everything.**
 * `catalog/index.min.json` (about 3 MB, fetched once and cached on disk) already
 * carries, for every model, the engine-measured triangle count, the real size in
 * BLOCKS, the number of independently animatable parts, whether it is textured,
 * its material colours and texture paths, its exact bounding box, and the
 * SHA-256 of the OBJ. So the agent can decide and verify without downloading a
 * single mesh, and a full clone of a 230 MB repository is never required.
 *
 * The numbers in that catalogue were produced by running the TARGET ENGINE'S OWN
 * OBJ parser (ObjModelLoader) over every file, so they describe what the game
 * will actually load — not what some third-party tool reports.
 *
 * Performance contract (the agent's context is the scarce resource):
 *   - the catalogue is fetched lazily, only when a 3D tool is actually used
 *   - it is cached on disk, so a session pays for it at most once
 *   - every tool returns a COMPACT projection; the 3 MB blob never reaches the
 *     agent's context, only the handful of rows it asked for
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { config } from "./config.js";

/** One catalogue row — the projection an agent searches over. */
export interface LibModel {
  id: string;
  name: string;
  source: string;
  pack: string;
  category: string;
  tags: string[];
  /** Triangles, measured by the engine's own OBJ parser. */
  tri: number;
  /** Display groups (independently animatable parts, including the default one). */
  grp: number;
  /** whole-model | two-part | per-part */
  anim: string;
  uv: boolean;
  tex: boolean;
  /** Real size in BLOCKS (1 OBJ unit == 1 block). */
  size: [number, number, number];
  /** Exact bounds: [minX,minY,minZ,maxX,maxY,maxZ] in blocks. */
  bb: [number, number, number, number, number, number];
  /** Materials: {n:name, c:#rrggbb, t:texture path} */
  mat: Array<{ n: string; c: string; t?: string }>;
  /** Named o/g groups (the animation nodes). */
  gr: string[];
  /** SHA-256 of the OBJ — verification, not decoration. */
  sha: string;
  /** Path inside the library, relative to its models/ root. */
  file: string;
  bytes: number;
}

export interface LibCatalog {
  /** Catalogue revision. Bumped when a field's meaning changes. */
  schema?: number;
  /** How `sha` was computed. "sha256-lf" = content with CRLF collapsed to LF. */
  hashAlgo?: string;
  count: number;
  models: LibModel[];
}

/** The hash convention this build knows how to verify. */
export const EXPECTED_HASH_ALGO = "sha256-lf";

export class AssetLibraryError extends Error {
  constructor(message: string, readonly hint?: string) {
    super(message);
    this.name = "AssetLibraryError";
  }
}

// ---------------------------------------------------------------------
// Locating the library: local checkout first, HTTPS mirror second
// ---------------------------------------------------------------------

/** Raw-content base URL derived from the repository URL. */
function rawBase(): string {
  const url = config.assetLibraryRepoUrl;
  if (!url) {
    throw new AssetLibraryError(
      "The 3D asset library is unlinked.",
      "Set OMNIMOD_ASSET_LIBRARY_REPO (or pass a repo URL to omni_config) to re-link it.",
    );
  }
  const m = /^https?:\/\/(?:www\.)?github\.com\/([^/]+)\/([^/#?]+)/i.exec(url);
  if (m) {
    const repo = m[2].replace(/\.git$/i, "");
    return `https://raw.githubusercontent.com/${m[1]}/${repo}/HEAD`;
  }
  return url.replace(/\/+$/, "");
}

function localRoot(): string | null {
  const p = config.assetLibraryLocalPath;
  return p ? resolve(p) : null;
}

/** Human-readable description of where the catalogue comes from. */
export function librarySource(): string {
  const local = localRoot();
  if (local) return `local checkout: ${local}`;
  return `HTTPS mirror: ${rawBase()}`;
}

function catalogCachePath(): string {
  return join(config.assetCacheDir, "index.min.json");
}

async function readText(rel: string): Promise<string> {
  const local = localRoot();
  if (local) {
    return readFile(join(local, ...rel.split("/")), "utf8");
  }
  const url = `${rawBase()}/${rel}`;
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) {
    throw new AssetLibraryError(
      `GET ${url} -> HTTP ${res.status}`,
      res.status === 404
        ? "The library layout may have changed; re-check catalog/index.min.json exists in the repository."
        : "Check network access, or set OMNIMOD_ASSET_LIBRARY_PATH to a local clone to work offline.",
    );
  }
  return res.text();
}

async function readBytes(rel: string): Promise<Buffer> {
  const local = localRoot();
  if (local) {
    return readFile(join(local, ...rel.split("/")));
  }
  const url = `${rawBase()}/${rel}`;
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) {
    throw new AssetLibraryError(`GET ${url} -> HTTP ${res.status}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

// ---------------------------------------------------------------------
// Catalogue: lazy, cached, disk-backed
// ---------------------------------------------------------------------

let cached: LibCatalog | null = null;

/**
 * A catalogue revision is usable when it declares the hash convention this build
 * verifies against AND carries the fields the tools promise. An older cached
 * copy — published before the index was enriched, or before the hash was made
 * line-ending independent — is treated as stale and refetched, so an agent never
 * gets a false "integrity mismatch" out of a stale cache.
 */
function catalogIsComplete(c: unknown): c is LibCatalog {
  if (!c || typeof c !== "object") return false;
  const cat = c as LibCatalog;
  if (cat.hashAlgo !== EXPECTED_HASH_ALGO) return false;
  const models = cat.models;
  if (!Array.isArray(models) || models.length === 0) return false;
  const first = models[0] as Partial<LibModel>;
  return (
    typeof first.id === "string" &&
    typeof first.sha === "string" &&
    Array.isArray(first.gr) &&
    Array.isArray(first.mat) &&
    Array.isArray(first.bb)
  );
}

/**
 * Load the catalogue. The first call downloads it (or reads a local clone) and
 * writes it to the cache directory; later calls in the same process are free.
 * `refresh: true` bypasses both the in-memory and the on-disk copy.
 */
export async function loadCatalog(opts: { refresh?: boolean } = {}): Promise<LibCatalog> {
  if (cached && !opts.refresh) return cached;

  const cacheFile = catalogCachePath();
  if (!opts.refresh) {
    try {
      const raw = await readFile(cacheFile, "utf8");
      const parsed: unknown = JSON.parse(raw);
      if (catalogIsComplete(parsed)) {
        cached = parsed;
        return cached;
      }
      /* stale revision — fall through and refetch */
    } catch {
      /* no cache yet — fall through and fetch */
    }
  }

  const text = await readText("catalog/index.min.json");
  const parsed = JSON.parse(text) as LibCatalog;
  if (!catalogIsComplete(parsed)) {
    throw new AssetLibraryError(
      "catalog/index.min.json did not parse into a usable model list.",
      "Re-run the library build, or point OMNIMOD_ASSET_LIBRARY_REPO at the correct repository.",
    );
  }
  cached = parsed;
  try {
    await mkdir(dirname(cacheFile), { recursive: true });
    await writeFile(cacheFile, text, "utf8");
  } catch {
    /* a read-only cache dir must never break a search */
  }
  return parsed;
}

export function catalogIsWarm(): boolean {
  return cached !== null;
}

// ---------------------------------------------------------------------
// Search and filter
// ---------------------------------------------------------------------

export interface SearchFilters {
  query?: string;
  tag?: string[];
  category?: string;
  source?: string;
  pack?: string;
  /** whole-model | two-part | per-part */
  anim?: string;
  maxTri?: number;
  minTri?: number;
  /** Max horizontal footprint in blocks. */
  maxSize?: number;
  textured?: boolean;
  limit?: number;
}

/**
 * Score a row against free-text terms. Identity hits (id/name/pack) outrank tag
 * and category hits, so "chair" returns chairs before things merely tagged
 * furniture.
 */
function score(m: LibModel, terms: string[]): number {
  if (terms.length === 0) return 0;
  const ident = `${m.id} ${m.name}`.toLowerCase();
  const tagText = m.tags.join(" ").toLowerCase();
  const cat = m.category.toLowerCase();
  let s = 0;
  for (const t of terms) {
    if (ident.includes(t)) {
      s += 10;
      if (new RegExp(`\\b${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).test(ident)) s += 5;
    }
    if (tagText.includes(t)) s += 3;
    if (cat.includes(t)) s += 2;
    if (m.pack.toLowerCase().includes(t)) s += 2;
    // Defensive: an older catalogue revision may predate the `gr` field.
    if ((m.gr ?? []).some((g) => g.toLowerCase().includes(t))) s += 1;
  }
  return s;
}

/** Apply the structured filters, then rank by free-text relevance. */
export function searchCatalog(cat: LibCatalog, f: SearchFilters): LibModel[] {
  const out: LibModel[] = [];
  for (const m of cat.models) {
    if (f.tag && f.tag.length > 0 && !f.tag.every((t) => m.tags.includes(t))) continue;
    if (f.category && m.category !== f.category) continue;
    if (f.source && m.source !== f.source) continue;
    if (f.pack && !m.pack.includes(f.pack)) continue;
    if (f.anim && m.anim !== f.anim) continue;
    if (f.maxTri !== undefined && m.tri > f.maxTri) continue;
    if (f.minTri !== undefined && m.tri < f.minTri) continue;
    if (f.textured && !m.tex) continue;
    if (f.maxSize !== undefined && Math.max(m.size[0], m.size[2]) > f.maxSize) continue;
    out.push(m);
  }

  const terms = (f.query ?? "")
    .toLowerCase()
    .split(/[\s,]+/)
    .filter((t) => t.length > 0);

  if (terms.length > 0) {
    const scored: Array<{ s: number; m: LibModel }> = [];
    for (const m of out) {
      const s = score(m, terms);
      if (s > 0) scored.push({ s, m });
    }
    // Relevance first, then cheapest to render.
    scored.sort((a, b) => (b.s - a.s) || (a.m.tri - b.m.tri) || a.m.id.localeCompare(b.m.id));
    return scored.map((x) => x.m);
  }

  out.sort((a, b) => (a.category.localeCompare(b.category)) || (a.tri - b.tri) || a.id.localeCompare(b.id));
  return out;
}

/** Exact id lookup, tolerating the `<pack>/<name>` short form. */
export function findModel(cat: LibCatalog, id: string): LibModel | null {
  const want = id.trim();
  for (const m of cat.models) if (m.id === want) return m;
  const suffix = `/${want}`;
  const hits = cat.models.filter((m) => m.id.endsWith(suffix) || m.name === want);
  if (hits.length === 1) return hits[0];
  return null;
}

/** Ambiguous short ids are reported rather than guessed. */
export function findModelCandidates(cat: LibCatalog, id: string, limit = 12): LibModel[] {
  const want = id.trim();
  const exact = cat.models.filter((m) => m.id === want);
  if (exact.length > 0) return exact;
  const suffix = `/${want}`;
  const bySuffix = cat.models.filter((m) => m.id.endsWith(suffix) || m.name === want);
  return bySuffix.slice(0, limit);
}

/** The compact row an agent sees — never the whole record with every field. */
export function project(m: LibModel) {
  return {
    id: m.id,
    name: m.name,
    category: m.category,
    tags: m.tags,
    tri: m.tri,
    sizeBlocks: m.size,
    anim: m.anim,
    animParts: m.grp,
    textured: m.tex,
    hasUV: m.uv,
    bytes: m.bytes,
  };
}

/**
 * Engine-fit assessment — the part of "is this really what I want?" that can be
 * answered from measurements alone. BUDGET mirrors the OmniMod OMNI3D contract
 * (<= 30000 triangles per model).
 */
export function assess(m: LibModel) {
  const notes: string[] = [];
  const parts = m.gr ?? [];
  if (m.tri > 30000) notes.push(`OVER BUDGET: ${m.tri} triangles (engine budget is 30000)`);
  if (!m.uv) notes.push("no texture coordinates — it will render as flat material colour");
  if (!m.tex && m.uv) notes.push("UVs present but no texture bound — flat material colour");
  if (m.anim === "whole-model") {
    notes.push("no named parts: only the whole model can be moved/rotated/scaled, not a door or a limb");
  } else {
    notes.push(`animatable parts: ${parts.join(", ")}`);
  }
  const h = Math.max(m.size[0], m.size[2]);
  if (h > 64) notes.push(`very large footprint (${h.toFixed(0)} blocks) — check the scene budget`);
  if (m.size[1] < 0.05 && h > 0.5) notes.push("flat: this is a decal/ground tile, not a volume");
  return {
    engineBudgetTriangles: 30000,
    withinBudget: m.tri <= 30000,
    animationMode: m.anim,
    namedParts: parts,
    sizeBlocks: { x: m.size[0], y: m.size[1], z: m.size[2] },
    materials: (m.mat ?? []).map((x) => ({ name: x.n, colour: x.c, texture: x.t ?? null })),
    notes,
  };
}

// ---------------------------------------------------------------------
// Fetch: pull only the chosen model, then VERIFY it
// ---------------------------------------------------------------------

export interface FetchedModel {
  id: string;
  dir: string;
  files: string[];
  /** True when the downloaded OBJ's SHA-256 matches the catalogue. */
  verified: boolean;
  sha256: string;
  expectedSha256: string;
  profilePath: string;
  note: string;
}

/**
 * SHA-256 over the model content with CRLF collapsed to LF.
 *
 * The hash identifies the MESH, not the checkout's line endings: the same OBJ is
 * CRLF in a Windows working tree and LF in the git object store. The library
 * pins `* -text` in .gitattributes so a clone reproduces the stored bytes
 * exactly, and the recorder (AnalyzeModels.java) normalises identically — so a
 * fetch over HTTPS and a fetch from a local clone agree.
 */
function sha256(buf: Buffer): string {
  const out = Buffer.allocUnsafe(buf.length);
  let n = 0;
  for (let i = 0; i < buf.length; i++) {
    const b = buf[i];
    if (b === 0x0d && i + 1 < buf.length && buf[i + 1] === 0x0a) continue;
    out[n++] = b;
  }
  return createHash("sha256").update(out.subarray(0, n)).digest("hex");
}

/**
 * Exposed for the selfcheck battery: the hash is the contract between the
 * recorder and the verifier, so it must be testable without the network.
 */
export function hashModelContent(buf: Buffer): string {
  return sha256(buf);
}

/** Exposed for the selfcheck battery (cache staleness detection). */
export function catalogIsUsable(c: unknown): boolean {
  return catalogIsComplete(c);
}

/** Relative texture paths an MTL actually references. */
function mtlTextureRefs(mtl: string): string[] {
  const refs: string[] = [];
  for (const line of mtl.split(/\r?\n/)) {
    const s = line.trim();
    for (const key of ["map_Kd", "map_Ka", "map_bump", "bump", "map_d", "disp", "map_Ks"]) {
      if (s.startsWith(`${key} `) || s.startsWith(`${key}\t`)) {
        const parts = s.split(/\s+/);
        if (parts.length > 1) refs.push(parts[parts.length - 1].replace(/\\/g, "/"));
        break;
      }
    }
  }
  return refs;
}

/**
 * Download one model (OBJ + its MTL + the textures the MTL references) into
 * `destRoot/<source>__<pack>__<name>/` and write the OmniMod `.model3d.json`
 * profile next to it.
 *
 * The OBJ is hashed and compared with the catalogue's recorded SHA-256, so the
 * agent gets a real integrity answer instead of a hope.
 */
export async function fetchModel(
  m: LibModel,
  destRoot: string,
  opts: { withProfile?: boolean } = {},
): Promise<FetchedModel> {
  const outDir = join(destRoot, m.id.replace(/\//g, "__"));
  await mkdir(outDir, { recursive: true });
  const files: string[] = [];

  const objBytes = await readBytes(`models/${m.file}`);
  await writeFile(join(outDir, `${m.name}.obj`), objBytes);
  files.push(`${m.name}.obj`);

  const actualSha = sha256(objBytes);
  const verified = actualSha === m.sha;

  const mtlRel = m.file.replace(/\.obj$/i, ".mtl");
  let mtlText: string | null = null;
  try {
    const mtlBytes = await readBytes(`models/${mtlRel}`);
    mtlText = mtlBytes.toString("utf8");
    await writeFile(join(outDir, `${m.name}.mtl`), mtlBytes);
    files.push(`${m.name}.mtl`);
  } catch {
    /* a model without an MTL is legal — the catalogue marks it as untextured */
  }

  if (mtlText) {
    const dirOfObj = m.file.includes("/") ? m.file.slice(0, m.file.lastIndexOf("/")) : "";
    for (const ref of mtlTextureRefs(mtlText)) {
      const leaf = ref.split("/").pop() as string;
      const candidates = [
        `models/${ref}`,
        `models/${dirOfObj}/Textures/${leaf}`,
        `models/${dirOfObj}/${ref}`,
      ];
      for (const c of candidates) {
        try {
          const data = await readBytes(c);
          await mkdir(join(outDir, "Textures"), { recursive: true });
          await writeFile(join(outDir, "Textures", leaf), data);
          files.push(`Textures/${leaf}`);
          break;
        } catch {
          /* try the next candidate path */
        }
      }
    }
  }

  let profilePath = "";
  if (opts.withProfile !== false) {
    const profile = {
      id: `omni3d:${m.name}`,
      displayName: m.name,
      scale: 1.0,
      collision: "auto",
      axisFix: "flip_xz",
      _source: {
        library: "omnimod-3d-library",
        modelId: m.id,
        licence: "CC0-1.0",
        triangles: m.tri,
        sizeBlocks: m.size,
        animatableParts: m.grp,
        sha256: m.sha,
      },
    };
    profilePath = join(outDir, `${m.name}.obj.model3d.json`);
    await writeFile(profilePath, JSON.stringify(profile, null, 2), "utf8");
    files.push(`${m.name}.obj.model3d.json`);
  }

  return {
    id: m.id,
    dir: outDir,
    files,
    verified,
    sha256: actualSha,
    expectedSha256: m.sha,
    profilePath,
    note: verified
      ? "SHA-256 matches the catalogue: this is byte-identical to the model that was measured."
      : "SHA-256 MISMATCH — the file differs from the measured catalogue entry. Do not trust the recorded triangle count / size for this copy.",
  };
}

/** Read a local OBJ back and confirm it still matches the catalogue. */
export async function verifyLocalFile(
  m: LibModel,
  objPath: string,
): Promise<{ exists: boolean; verified: boolean; sha256: string | null; bytes: number }> {
  try {
    const st = await stat(objPath);
    if (!st.isFile()) return { exists: false, verified: false, sha256: null, bytes: 0 };
    const buf = await readFile(objPath);
    const sha = sha256(buf);
    return { exists: true, verified: sha === m.sha, sha256: sha, bytes: buf.length };
  } catch {
    return { exists: false, verified: false, sha256: null, bytes: 0 };
  }
}

// ---------------------------------------------------------------------
// Reporting helpers (small, so they never bloat the agent's context)
// ---------------------------------------------------------------------

export function librarySummary(cat: LibCatalog) {
  const byCategory = new Map<string, number>();
  const bySource = new Map<string, number>();
  let tris = 0;
  let perPart = 0;
  for (const m of cat.models) {
    byCategory.set(m.category, (byCategory.get(m.category) ?? 0) + 1);
    bySource.set(m.source, (bySource.get(m.source) ?? 0) + 1);
    tris += m.tri;
    if (m.anim === "per-part") perPart++;
  }
  const sorted = [...cat.models].map((m) => m.tri).sort((a, b) => a - b);
  return {
    models: cat.count,
    bySource: Object.fromEntries(bySource),
    byCategory: Object.fromEntries(byCategory),
    totalTriangles: tris,
    medianTriangles: sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0,
    maxTriangles: sorted.length ? sorted[sorted.length - 1] : 0,
    partAnimatables: perPart,
    licence: "CC0-1.0 (public domain) — commercial use allowed, no attribution required",
    source: librarySource(),
  };
}
