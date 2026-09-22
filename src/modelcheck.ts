/**
 * modelcheck.ts — validate a 3D model an agent AUTHORED, before it ships.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The 3D library gives an agent models that were already measured. This module
 * covers the other half: the model the agent wrote itself. Hand-authored meshes
 * fail in ways that are invisible in a text editor and obvious in the game —
 * faces wound the wrong way, a concave quad that the engine's fan triangulation
 * tears apart, a texture bound but no UVs, a model whose base is 30 blocks below
 * its own origin, a 40 000-triangle prop on a device that budgets 30 000.
 *
 * So this parses the OBJ the way the ENGINE parses it and then reports both the
 * measurements and the defects.
 *
 * FIDELITY NOTE — read this before trusting a number.
 * `parseObj` deliberately mirrors `ObjModelLoader.java` + `ObjModelData.java`:
 *   - `v`/`vt`/`vn`, `f` with `v`, `v/vt`, `v//vn`, `v/vt/vn`
 *   - negative (relative) indices resolve against the count seen SO FAR
 *   - faces are fan-triangulated from the first vertex (n-gons included)
 *   - the `flip_xz` axis fix negates x and z on positions AND normals
 *   - a display group is created per (o/g name x usemtl name) pair
 *   - UVs are emitted for EVERY vertex if the file contains ANY `vt`, else for
 *     none; a vertex with no `vt` index gets (0.5, 0.5). Same rule for normals,
 *     which default to (0, 1, 0).
 * The engine remains authoritative: the selfcheck cross-checks this parser
 * against the Java one on real library models, so a drift shows up as a failure
 * rather than as a confident wrong answer.
 */
import { readFile, stat } from "node:fs/promises";
import { dirname, join } from "node:path";

// ---------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface MeshGroup {
  groupName: string;
  materialName: string;
  /** Flat triangle list: 9 floats per triangle (3 vertices x xyz). */
  positions: number[];
  normals: number[];
  uvs: number[];
}

export interface ParsedMaterial {
  name: string;
  r: number;
  g: number;
  b: number;
  alpha: number;
  textureRef: string | null;
  doubleSided: boolean;
  defined: boolean;
}

export interface ParsedModel {
  groups: MeshGroup[];
  materials: Map<string, ParsedMaterial>;
  groupNames: string[];
  min: Vec3;
  max: Vec3;
  /** Source line numbers of each face, parallel to the emitted triangles. */
  triangleSource: number[];
  /** Faces seen in the file, with their vertex count (for n-gon reporting). */
  faceVertexCounts: number[];
  /**
   * Source line numbers of faces that are NOT convex.
   *
   * This matters more than the n-gon count: the engine fan-triangulates every
   * face from its first vertex, and a fan is only geometrically correct for a
   * convex polygon. A concave quad or n-gon gets torn into triangles that spill
   * outside the original outline, which shows up in game as holes, spikes or
   * faces poking through a wall.
   */
  concaveFaces: number[];
  /** True when the file contains at least one `vt`. */
  hasAnyVt: boolean;
  /** True when the file contains at least one `vn`. */
  hasAnyVn: boolean;
  /** usemtl names referenced by faces. */
  usedMaterials: Set<string>;
  warnings: string[];
}

export type Severity = "error" | "warning" | "note";

export interface Finding {
  severity: Severity;
  /** Stable id so an agent can recognise the same defect across runs. */
  id: string;
  message: string;
  /** What to do about it. */
  fix?: string;
}

export interface ModelReport {
  ok: boolean;
  file: string;
  /** Everything the engine will see after parsing. */
  engine: {
    triangles: number;
    vertices: number;
    groups: number;
    groupNames: string[];
    materials: Array<{
      name: string;
      colour: string;
      alpha: number;
      texture: string | null;
      doubleSided: boolean;
    }>;
    bounds: { min: Vec3; max: Vec3 };
    sizeBlocks: Vec3;
    /** Anchor is the model's base centre, so minY should be ~0. */
    baseOffsetY: number;
    withinBudget: boolean;
    budget: number;
  };
  findings: Finding[];
  counts: { errors: number; warnings: number; notes: number };
  verdict: string;
}

const BUDGET = 30000;
const EPS = 1e-6;
/** One Minecraft pixel. Features smaller than this read as "mixels". */
const MINECRAFT_PIXEL = 1 / 16;

// ---------------------------------------------------------------------
// OBJ parsing — mirrors ObjModelLoader
// ---------------------------------------------------------------------

function splitLines(text: string): string[] {
  const out: string[] = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c === 10 || c === 13) {
      if (i > start) out.push(text.slice(start, i));
      start = i + 1;
    }
  }
  if (text.length > start) out.push(text.slice(start));
  return out;
}

/** Read up to `count` floats from a line, skipping the leading keyword. */
function readFloats(line: string, count: number): number[] | null {
  const out: number[] = [];
  let i = 0;
  while (i < line.length && line[i] !== " " && line[i] !== "\t") i++;
  while (i < line.length && out.length < count) {
    while (i < line.length && (line[i] === " " || line[i] === "\t")) i++;
    if (i >= line.length) break;
    const start = i;
    while (i < line.length && line[i] !== " " && line[i] !== "\t") i++;
    const v = Number.parseFloat(line.slice(start, i));
    if (!Number.isFinite(v)) return null;
    out.push(v);
  }
  return out.length === count ? out : null;
}

/** Token by index (0 = first token). */
function token(line: string, index: number): string | null {
  let found = 0;
  let i = 0;
  while (i < line.length) {
    while (i < line.length && (line[i] === " " || line[i] === "\t")) i++;
    if (i >= line.length) return null;
    const start = i;
    while (i < line.length && line[i] !== " " && line[i] !== "\t") i++;
    if (found === index) return line.slice(start, i);
    found++;
  }
  return null;
}

function resolveIndex(raw: number, count: number): number {
  if (raw > 0) return raw; // 1-based
  if (raw < 0 && count + raw >= 0) return count + raw + 1; // relative from the end
  return 0;
}

/** One parsed face vertex: [vIndex, vtIndex, vnIndex] (1-based, 0 = absent). */
type FaceVertex = [number, number, number];

function parseFace(line: string, vCount: number, vtCount: number, vnCount: number): FaceVertex[] {
  const out: FaceVertex[] = [];
  let i = 1;
  while (i < line.length) {
    while (i < line.length && (line[i] === " " || line[i] === "\t")) i++;
    if (i >= line.length) break;
    const start = i;
    while (i < line.length && line[i] !== " " && line[i] !== "\t") i++;
    const vertex = line.slice(start, i);
    const s1 = vertex.indexOf("/");
    let vi = 0;
    let ti = 0;
    let ni = 0;
    if (s1 < 0) {
      vi = resolveIndex(Number.parseInt(vertex, 10), vCount);
    } else {
      vi = resolveIndex(Number.parseInt(vertex.slice(0, s1), 10), vCount);
      const s2 = vertex.indexOf("/", s1 + 1);
      if (s2 < 0) {
        if (s1 + 1 < vertex.length) ti = resolveIndex(Number.parseInt(vertex.slice(s1 + 1), 10), vtCount);
      } else {
        if (s2 > s1 + 1) ti = resolveIndex(Number.parseInt(vertex.slice(s1 + 1, s2), 10), vtCount);
        if (s2 + 1 < vertex.length) ni = resolveIndex(Number.parseInt(vertex.slice(s2 + 1), 10), vnCount);
      }
    }
    if (Number.isNaN(vi) || Number.isNaN(ti) || Number.isNaN(ni)) continue;
    if (vi > 0) out.push([vi, ti, ni]);
  }
  return out;
}

export interface ParseOptions {
  /** The engine's default. "none" disables the axis fix. */
  axisFix?: string;
}

export function parseObj(objText: string, mtlText: string | null, opts: ParseOptions = {}): ParsedModel {
  const flip = (opts.axisFix ?? "flip_xz").toLowerCase() !== "none";
  const vx: number[] = [];
  const vy: number[] = [];
  const vz: number[] = [];
  const vtx: number[] = [];
  const vty: number[] = [];
  const vnx: number[] = [];
  const vny: number[] = [];
  const vnz: number[] = [];

  const materials = new Map<string, ParsedMaterial>();
  if (mtlText) parseMtl(mtlText, materials);

  const groups: MeshGroup[] = [];
  const groupByKey = new Map<string, MeshGroup>();
  const groupNames: string[] = ["default"];
  const triangleSource: number[] = [];
  const faceVertexCounts: number[] = [];
  const concaveFaces: number[] = [];
  const usedMaterials = new Set<string>();
  const warnings: string[] = [];

  let currentGroup = "default";
  let currentMaterial = "default";
  let hasAnyVt = false;
  let hasAnyVn = false;

  const lines = splitLines(objText);
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li].trim();
    if (line.length === 0 || line[0] === "#") continue;
    const c0 = line[0];
    if (c0 === "v") {
      const c1 = line.length > 1 ? line[1] : " ";
      if (c1 === " " || c1 === "\t") {
        const f = readFloats(line, 3);
        if (f) {
          vx.push(flip ? -f[0] : f[0]);
          vy.push(f[1]);
          vz.push(flip ? -f[2] : f[2]);
        } else warnings.push(`line ${li + 1}: malformed "v" — ignored`);
      } else if (c1 === "t") {
        const f = readFloats(line, 2);
        if (f) {
          vtx.push(f[0]);
          vty.push(1 - f[1]);
          hasAnyVt = true;
        } else warnings.push(`line ${li + 1}: malformed "vt" — ignored`);
      } else if (c1 === "n") {
        const f = readFloats(line, 3);
        if (f) {
          vnx.push(flip ? -f[0] : f[0]);
          vny.push(f[1]);
          vnz.push(flip ? -f[2] : f[2]);
          hasAnyVn = true;
        } else warnings.push(`line ${li + 1}: malformed "vn" — ignored`);
      }
    } else if (c0 === "f") {
      const face = parseFace(line, vx.length, vtx.length, vnx.length);
      faceVertexCounts.push(face.length);
      if (face.length < 3) continue;
      if (face.length > 3 && !isConvexFace(face, vx, vy, vz)) concaveFaces.push(li + 1);
      const key = `${currentGroup}\u0000${currentMaterial}`;
      let group = groupByKey.get(key);
      if (!group) {
        group = { groupName: currentGroup, materialName: currentMaterial, positions: [], normals: [], uvs: [] };
        groupByKey.set(key, group);
        groups.push(group);
      }
      usedMaterials.add(currentMaterial);
      // fan triangulation from the first vertex — same as the engine
      for (let t = 1; t + 1 < face.length; t++) {
        for (const idx of [face[0], face[t], face[t + 1]]) {
          const vi = idx[0] - 1;
          group.positions.push(vx[vi], vy[vi], vz[vi]);
          if (hasAnyVt) {
            if (idx[1] > 0 && idx[1] - 1 < vtx.length) group.uvs.push(vtx[idx[1] - 1], vty[idx[1] - 1]);
            else group.uvs.push(0.5, 0.5);
          }
          if (hasAnyVn) {
            if (idx[2] > 0 && idx[2] - 1 < vnx.length) group.normals.push(vnx[idx[2] - 1], vny[idx[2] - 1], vnz[idx[2] - 1]);
            else group.normals.push(0, 1, 0);
          }
        }
        triangleSource.push(li + 1);
      }
    } else if (c0 === "u") {
      if (line.startsWith("usemtl")) {
        const m = token(line, 1);
        currentMaterial = m && m.length > 0 ? m : "default";
      }
    } else if (c0 === "o" || c0 === "g") {
      const c1 = line.length > 1 ? line[1] : " ";
      if (c1 === " " || c1 === "\t") {
        const g = token(line, 1);
        if (g && g.length > 0 && g !== "default") {
          currentGroup = g;
          if (!groupNames.includes(g)) groupNames.push(g);
        }
      }
    }
  }

  // Bounds
  let minX = 0, minY = 0, minZ = 0, maxX = 1, maxY = 1, maxZ = 1;
  let first = true;
  for (const g of groups) {
    for (let i = 0; i + 2 < g.positions.length; i += 3) {
      const x = g.positions[i], y = g.positions[i + 1], z = g.positions[i + 2];
      if (first) {
        minX = maxX = x; minY = maxY = y; minZ = maxZ = z; first = false;
      } else {
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
        if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
      }
    }
  }

  return {
    groups,
    materials,
    groupNames,
    min: { x: minX, y: minY, z: minZ },
    max: { x: maxX, y: maxY, z: maxZ },
    triangleSource,
    faceVertexCounts,
    concaveFaces,
    hasAnyVt,
    hasAnyVn,
    usedMaterials,
    warnings,
  };
}

export function parseMtl(mtlText: string, out: Map<string, ParsedMaterial>): void {
  let cur: ParsedMaterial | null = null;
  for (const raw of splitLines(mtlText)) {
    const line = raw.trim();
    if (line.length === 0 || line[0] === "#") continue;
    if (line.startsWith("newmtl")) {
      const name = token(line, 1);
      if (name) {
        cur = { name, r: 0.8, g: 0.8, b: 0.8, alpha: 1, textureRef: null, doubleSided: false, defined: true };
        out.set(name, cur);
      }
    } else if (cur) {
      if (line.startsWith("Kd")) {
        const f = readFloats(line, 3);
        if (f) {
          cur.r = clamp01(f[0]);
          cur.g = clamp01(f[1]);
          cur.b = clamp01(f[2]);
        }
      } else if (line.startsWith("map_Kd")) {
        const p = token(line, 1);
        if (p) cur.textureRef = p.replace(/\\/g, "/");
      } else if (line.startsWith("d") && (line.length === 1 || line[1] === " ")) {
        const f = readFloats(line, 1);
        if (f) cur.alpha = clamp01(f[0]);
      } else if (line.startsWith("Tr")) {
        const f = readFloats(line, 1);
        if (f) cur.alpha = clamp01(1 - f[0]);
      }
    }
  }
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

// ---------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------

function triArea(p: number[], o: number): number {
  const ax = p[o + 3] - p[o], ay = p[o + 4] - p[o + 1], az = p[o + 5] - p[o + 2];
  const bx = p[o + 6] - p[o], by = p[o + 7] - p[o + 1], bz = p[o + 8] - p[o + 2];
  const cx = ay * bz - az * by;
  const cy = az * bx - ax * bz;
  const cz = ax * by - ay * bx;
  return 0.5 * Math.sqrt(cx * cx + cy * cy + cz * cz);
}

function triNormal(p: number[], o: number): Vec3 {
  const ax = p[o + 3] - p[o], ay = p[o + 4] - p[o + 1], az = p[o + 5] - p[o + 2];
  const bx = p[o + 6] - p[o], by = p[o + 7] - p[o + 1], bz = p[o + 8] - p[o + 2];
  let nx = ay * bz - az * by;
  let ny = az * bx - ax * bz;
  let nz = ax * by - ay * bx;
  const l = Math.sqrt(nx * nx + ny * ny + nz * nz);
  if (l < EPS) return { x: 0, y: 0, z: 0 };
  nx /= l; ny /= l; nz /= l;
  return { x: nx, y: ny, z: nz };
}

const vkey = (p: number[], o: number) =>
  `${p[o].toFixed(5)},${p[o + 1].toFixed(5)},${p[o + 2].toFixed(5)}`;

/**
 * Is a polygon convex?
 *
 * Projected onto its own best-fit plane, a convex polygon turns the same way at
 * every corner, so all consecutive cross products share a sign. A concave corner
 * flips it. Coplanarity is not assumed — the test is run against the polygon's
 * own normal, which is what makes it correct for the slightly non-planar quads
 * that real exporters emit.
 */
function isConvexFace(face: FaceVertex[], vx: number[], vy: number[], vz: number[]): boolean {
  const pts: Array<[number, number, number]> = face.map((f) => [
    vx[f[0] - 1] ?? 0,
    vy[f[0] - 1] ?? 0,
    vz[f[0] - 1] ?? 0,
  ]);
  const n = pts.length;
  // Newell's method for the polygon normal — stable for non-planar polygons.
  let nx = 0, ny = 0, nz = 0;
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    nx += (a[1] - b[1]) * (a[2] + b[2]);
    ny += (a[2] - b[2]) * (a[0] + b[0]);
    nz += (a[0] - b[0]) * (a[1] + b[1]);
  }
  const len = Math.hypot(nx, ny, nz);
  if (len < 1e-9) return true; // degenerate face; reported separately
  nx /= len; ny /= len; nz /= len;

  let sign = 0;
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const c = pts[(i + 2) % n];
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const wx = c[0] - b[0], wy = c[1] - b[1], wz = c[2] - b[2];
    // cross(u, w) . n  — the signed turn at corner b
    const turn = (uy * wz - uz * wy) * nx + (uz * wx - ux * wz) * ny + (ux * wy - uy * wx) * nz;
    if (Math.abs(turn) < 1e-12) continue; // collinear corner, no information
    const s = Math.sign(turn);
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  return true;
}

// ---------------------------------------------------------------------
// The check battery
// ---------------------------------------------------------------------

export interface CheckContext {
  /** What the agent says the model is for, e.g. "a 3x3 wooden crate". */
  intent?: string;
  /** Directory the OBJ lives in (for texture existence checks). */
  baseDir?: string;
  /** Files present next to the model, when the caller already knows. */
  siblingFiles?: string[];
  /** Blocks the model is expected to occupy, for a scale sanity check. */
  expectedSizeBlocks?: number;
}

export function runChecks(m: ParsedModel, ctx: CheckContext = {}): Finding[] {
  const f: Finding[] = [];
  const triCount = m.groups.reduce((n, g) => n + g.positions.length / 9, 0);

  // ---- geometry -------------------------------------------------------
  let degenerate = 0;
  let tiny = 0;
  const seenTriangles = new Map<string, number>();
  let duplicate = 0;
  const edgeUse = new Map<string, number>();
  const edgeDir = new Map<string, number>();

  for (const g of m.groups) {
    const p = g.positions;
    for (let t = 0; t + 8 < p.length; t += 9) {
      const area = triArea(p, t);
      if (area < 1e-9) degenerate++;
      else if (area < 1e-6) tiny++;
      const k = [vkey(p, t), vkey(p, t + 3), vkey(p, t + 6)].sort().join("|");
      seenTriangles.set(k, (seenTriangles.get(k) ?? 0) + 1);
      // directed edges, for manifold + winding analysis
      const ids = [vkey(p, t), vkey(p, t + 3), vkey(p, t + 6)];
      for (let e = 0; e < 3; e++) {
        const a = ids[e];
        const b = ids[(e + 1) % 3];
        const und = a < b ? `${a}~${b}` : `${b}~${a}`;
        edgeUse.set(und, (edgeUse.get(und) ?? 0) + 1);
        edgeDir.set(`${a}>${b}`, (edgeDir.get(`${a}>${b}`) ?? 0) + 1);
      }
    }
  }
  for (const n of seenTriangles.values()) if (n > 1) duplicate += n - 1;

  if (triCount === 0) {
    f.push({
      severity: "error",
      id: "no_geometry",
      message: "The file produced zero triangles — the engine will refuse to register it.",
      fix: "Check that faces use `f v v v` with 1-based indices into existing `v` lines.",
    });
  }
  if (degenerate > 0) {
    f.push({
      severity: "error",
      id: "degenerate_triangles",
      message: `${degenerate} triangle(s) have zero area (collinear or repeated vertices).`,
      fix: "Delete them. They cost render time, produce NaN normals, and can break collision voxelization.",
    });
  }
  if (tiny > 0) {
    f.push({
      severity: "warning",
      id: "tiny_triangles",
      message: `${tiny} triangle(s) are nearly zero-area (< 1e-6).`,
      fix: "Merge their vertices or remove them; they contribute nothing but cost fill.",
    });
  }
  if (duplicate > 0) {
    f.push({
      severity: "warning",
      id: "duplicate_triangles",
      message: `${duplicate} duplicate triangle(s) sit on top of another face.`,
      fix: "Remove them — coplanar duplicates z-fight and flicker.",
    });
  }

  const nGons = m.faceVertexCounts.filter((n) => n > 4).length;
  const quads = m.faceVertexCounts.filter((n) => n === 4).length;
  if (nGons > 0) {
    f.push({
      severity: "warning",
      id: "ngon_faces",
      message: `${nGons} face(s) have more than 4 vertices. The engine fan-triangulates them from the first vertex.`,
      fix: "Triangulate them yourself. A fan is only correct for convex polygons.",
    });
  }
  if (m.concaveFaces.length > 0) {
    f.push({
      severity: "error",
      id: "concave_faces",
      message:
        `${m.concaveFaces.length} face(s) are CONCAVE (line ${m.concaveFaces.slice(0, 5).join(", ")}` +
        `${m.concaveFaces.length > 5 ? ", …" : ""}). Fan triangulation is only correct for convex polygons, ` +
        "so these will be torn into triangles that spill outside the original outline.",
      fix: "Triangulate these faces yourself with ear clipping (or Blender's Triangulate modifier), or split the concave corner into two faces.",
    });
  }
  if (quads > 0) {
    f.push({
      severity: "note",
      id: "quad_faces",
      message: `${quads} quad(s) will be fan-triangulated. That is correct for convex quads.`,
      fix: "For a concave quad, split it yourself along the correct diagonal.",
    });
  }

  let boundary = 0;
  let nonManifold = 0;
  for (const n of edgeUse.values()) {
    if (n === 1) boundary++;
    else if (n > 2) nonManifold++;
  }
  if (nonManifold > 0) {
    f.push({
      severity: "warning",
      id: "non_manifold_edges",
      message: `${nonManifold} edge(s) are shared by more than two triangles.`,
      fix: "Usually harmless for a decorative prop, but it breaks collision voxelization and any boolean operation. Split the shared faces.",
    });
  }
  if (boundary > 0 && triCount > 0) {
    const ratio = boundary / (triCount * 1.5);
    f.push({
      severity: ratio > 0.5 ? "note" : "note",
      id: "open_edges",
      message: `${boundary} edge(s) belong to only one triangle (an open surface).`,
      fix: "Fine for flat planes and foliage. For a solid prop, close the shell so the inside is never visible.",
    });
  }

  // Inconsistent winding: an edge used in the same direction by two triangles
  // means the two faces disagree about which side is out.
  let flippedPairs = 0;
  for (const [k, n] of edgeDir.entries()) {
    if (n > 1) flippedPairs++;
  }
  if (flippedPairs > 0 && triCount > 0) {
    f.push({
      severity: flippedPairs > triCount * 0.05 ? "warning" : "note",
      id: "inconsistent_winding",
      message: `${flippedPairs} edge(s) are traversed the same way by two faces, so those faces disagree about which side is outward.`,
      fix: "Recompute outward normals in your tool (Blender: Shift+N with all faces selected). Mixed winding makes lighting look patchy.",
    });
  }

  // ---- UVs ------------------------------------------------------------
  const hasTexture = [...m.materials.values()].some((x) => x.textureRef);
  const anyUv = m.groups.some((g) => g.uvs.length > 0);
  if (hasTexture && !anyUv) {
    f.push({
      severity: "error",
      id: "texture_without_uv",
      message: "A texture is bound in the MTL but the OBJ has no `vt` lines, so every texel lookup is undefined.",
      fix: "Add UVs, or drop the map_Kd and colour the model with Kd instead.",
    });
  }
  if (anyUv) {
    // Mixed: some faces carry vt, others do not. The engine fills (0.5, 0.5)
    // for the missing ones, which paints them with whatever sits at the centre
    // of the texture.
    const missing = m.groups.some((g) => {
      for (let i = 0; i + 1 < g.uvs.length; i += 2) {
        if (Math.abs(g.uvs[i] - 0.5) < EPS && Math.abs(g.uvs[i + 1] - 0.5) < EPS) return true;
      }
      return false;
    });
    if (missing) {
      f.push({
        severity: "warning",
        id: "partial_uvs",
        message: "Some vertices have no `vt` index; the engine fills those with (0.5, 0.5).",
        fix: "Give every face a vt, or the affected parts will sample the centre pixel of the texture.",
      });
    }
    let outOfRange = 0;
    for (const g of m.groups) {
      for (let i = 0; i + 1 < g.uvs.length; i += 2) {
        if (g.uvs[i] < -EPS || g.uvs[i] > 1 + EPS || g.uvs[i + 1] < -EPS || g.uvs[i + 1] > 1 + EPS) outOfRange++;
      }
    }
    if (outOfRange > 0) {
      f.push({
        severity: "note",
        id: "uvs_out_of_range",
        message: `${outOfRange} UV coordinate(s) lie outside 0..1.`,
        fix: "Intentional for tiling, otherwise a sign of a broken unwrap. The engine clamps at sample time.",
      });
    }
  }

  // ---- normals --------------------------------------------------------
  if (!m.hasAnyVn) {
    f.push({
      severity: "note",
      id: "no_normals",
      message: "The OBJ has no `vn` lines; the engine substitutes (0, 1, 0) for every vertex.",
      fix: "Export normals for anything with a curve or a slope, or lighting will look flat and wrong.",
    });
  } else {
    const bad: number[] = [];
    for (const g of m.groups) {
      for (let i = 0; i + 2 < g.normals.length; i += 3) {
        const len = Math.hypot(g.normals[i], g.normals[i + 1], g.normals[i + 2]);
        if (Math.abs(len - 1) > 0.02) bad.push(len);
      }
    }
    if (bad.length > 0) {
      f.push({
        severity: "warning",
        id: "unnormalised_normals",
        message: `${bad.length} normal(s) are not unit length (first length ${bad[0].toFixed(3)}).`,
        fix: "Re-export with normals normalised; a scaled normal produces uneven lighting.",
      });
    }
  }

  // ---- materials ------------------------------------------------------
  for (const name of m.usedMaterials) {
    if (name === "default") continue;
    const mat = m.materials.get(name);
    if (!mat) {
      f.push({
        severity: "warning",
        id: "material_undefined",
        message: `Face material "${name}" is not defined in the MTL.`,
        fix: "Add a `newmtl ${name}` block, or the engine falls back to white.",
      });
    } else if (mat.r > 0.98 && mat.g > 0.98 && mat.b > 0.98 && !mat.textureRef) {
      f.push({
        severity: "note",
        id: "material_white",
        message: `Material "${name}" is pure white with no texture.`,
        fix: "Pick a real colour — pure white reads as 'untextured' next to the map's palette.",
      });
    }
  }
  if (m.materials.size === 0 && triCount > 0) {
    f.push({
      severity: "warning",
      id: "no_materials",
      message: "No MTL material is defined, so the whole model renders in one default colour.",
      fix: "Add an MTL with at least one `newmtl` + `Kd r g b`, or `map_Kd <texture>`.",
    });
  }
  const colours = new Set(
    [...m.materials.values()].map((x) => `${x.r.toFixed(3)}|${x.g.toFixed(3)}|${x.b.toFixed(3)}`),
  );
  if (colours.size > 24) {
    f.push({
      severity: "note",
      id: "many_colours",
      message: `${colours.size} distinct material colours.`,
      fix: "A small palette reads as deliberate; dozens of colours read as noise. Consider a texture atlas instead.",
    });
  }

  // ---- engine fit -----------------------------------------------------
  if (triCount > BUDGET) {
    f.push({
      severity: "error",
      id: "over_budget",
      message: `${triCount} triangles exceeds the engine's ${BUDGET} per-model budget.`,
      fix: "Decimate the mesh or split it into several models.",
    });
  }
  const baseY = m.min.y;
  if (Math.abs(baseY) > 0.02) {
    f.push({
      severity: "warning",
      id: "base_not_at_origin",
      message: `The model's lowest point is at y=${baseY.toFixed(3)}, not y=0.`,
      fix: "Placement anchors the model by its base centre, so a non-zero base makes it float or sink. Shift the mesh so minY = 0, or set profile.offsetY.",
    });
  }
  const sizeY = m.max.y - m.min.y;
  const sizeX = m.max.x - m.min.x;
  const sizeZ = m.max.z - m.min.z;
  if (Math.abs(sizeX) < EPS && Math.abs(sizeZ) < EPS) {
    f.push({
      severity: "warning",
      id: "zero_footprint",
      message: "The model has no horizontal extent — it is a line.",
      fix: "Check the vertex data; a model with zero footprint has no collision and is invisible edge-on.",
    });
  }
  const maxHorizontal = Math.max(sizeX, sizeZ);
  if (maxHorizontal < MINECRAFT_PIXEL && sizeY > MINECRAFT_PIXEL) {
    f.push({
      severity: "note",
      id: "mixel_risk",
      message: `The footprint (${maxHorizontal.toFixed(4)} blocks) is smaller than one Minecraft pixel (${MINECRAFT_PIXEL}).`,
      fix: "In a Minecraft-styled map a feature thinner than 1/16 block reads as a mistake. Thicken it or accept it as a deliberate detail.",
    });
  }

  if (ctx.expectedSizeBlocks) {
    const got = Math.max(sizeX, sizeY, sizeZ);
    const want = ctx.expectedSizeBlocks;
    if (got > want * 1.5 || got < want / 1.5) {
      f.push({
        severity: "warning",
        id: "scale_mismatch",
        message: `Largest dimension is ${got.toFixed(2)} blocks but you expected about ${want}.`,
        fix: "1 OBJ unit = 1 block. Rescale in your tool, or set profile.scale (it multiplies the mesh AND its collision).",
      });
    }
  }

  // ---- texture existence ---------------------------------------------
  const missingTex: string[] = [];
  for (const mat of m.materials.values()) {
    if (!mat.textureRef) continue;
    if (ctx.siblingFiles && ctx.siblingFiles.length > 0) {
      const leaf = mat.textureRef.split("/").pop() as string;
      const found = ctx.siblingFiles.some(
        (s) => s === mat.textureRef || s.endsWith(`/${leaf}`) || s === leaf,
      );
      if (!found) missingTex.push(mat.textureRef);
    }
  }
  if (missingTex.length > 0) {
    f.push({
      severity: "warning",
      id: "texture_missing",
      message: `Texture file(s) referenced but not present next to the model: ${missingTex.join(", ")}.`,
      fix: "The engine falls back to the material colour, so the model still renders — but it will not look like the texture you designed.",
    });
  }

  // ---- style ----------------------------------------------------------
  const groups = m.groups.length;
  const namedParts = m.groupNames.filter((n) => n !== "default").length;
  if (namedParts === 0 && triCount > 0) {
    f.push({
      severity: "note",
      id: "no_named_parts",
      message: "No `o`/`g` groups, so only the whole model can be animated.",
      fix: "If any part should move (a door, a wheel, a lid), wrap it in `o <name>`.",
    });
  } else if (namedParts > 0) {
    f.push({
      severity: "note",
      id: "named_parts",
      message: `${namedParts} named part(s) available for per-part animation: ${m.groupNames.filter((n) => n !== "default").join(", ")}.`,
    });
  }

  return f;
}

// ---------------------------------------------------------------------
// Templates — a CORRECT starting structure, so the boring parts are never wrong
// ---------------------------------------------------------------------

export type TemplateKind = "box" | "slab" | "ramp" | "pillar" | "plane" | "box_with_parts";

export interface TemplateOptions {
  /** Footprint width in blocks (x). */
  width?: number;
  /** Height in blocks (y). */
  height?: number;
  /** Footprint depth in blocks (z). */
  depth?: number;
  /** Material name written into the MTL. */
  material?: string;
  /** Base colour, 0..1 per channel. */
  colour?: [number, number, number];
}

export interface TemplateResult {
  obj: string;
  mtl: string;
  note: string;
}

const num = (v: number) => {
  const r = Math.round(v * 10000) / 10000;
  return Number.isInteger(r) ? String(r) : r.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
};

/**
 * Emit a starting OBJ that is already correct where correctness is boring and
 * easy to get wrong: outward winding on every face, the base sitting exactly on
 * y = 0 (the engine anchors a model by its base centre), 1 unit = 1 block, and
 * `o` groups for anything that may need to move.
 *
 * These are starting points, not finished art: the agent is expected to move
 * vertices, add detail and set real colours. What they guarantee is that the
 * STRUCTURE will not be the reason the model looks broken in game.
 */
export function buildTemplate(kind: TemplateKind, opts: TemplateOptions = {}): TemplateResult {
  const w = opts.width ?? 1;
  const h = opts.height ?? 1;
  const d = opts.depth ?? 1;
  const mat = opts.material ?? "main";
  const [cr, cg, cb] = opts.colour ?? [0.62, 0.45, 0.28];
  const mtl = `# ${kind}\nnewmtl ${mat}\nKd ${num(cr)} ${num(cg)} ${num(cb)}\n`;

  const boxFaces = (o: number, skip: { top?: boolean; bottom?: boolean } = {}) =>
    [
      skip.bottom ? null : `f ${o + 1} ${o + 2} ${o + 3} ${o + 4}`, // bottom  -Y
      skip.top ? null : `f ${o + 5} ${o + 8} ${o + 7} ${o + 6}`, // top     +Y
      `f ${o + 4} ${o + 3} ${o + 7} ${o + 8}`, // front   +Z
      `f ${o + 1} ${o + 5} ${o + 6} ${o + 2}`, // back    -Z
      `f ${o + 1} ${o + 4} ${o + 8} ${o + 5}`, // left    -X
      `f ${o + 2} ${o + 6} ${o + 7} ${o + 3}`, // right   +X
    ]
      .filter((x): x is string => x !== null)
      .join("\n");

  const boxVerts = (y0: number, y1: number) =>
    [
      `v 0 ${num(y0)} 0`,
      `v ${num(w)} ${num(y0)} 0`,
      `v ${num(w)} ${num(y0)} ${num(d)}`,
      `v 0 ${num(y0)} ${num(d)}`,
      `v 0 ${num(y1)} 0`,
      `v ${num(w)} ${num(y1)} 0`,
      `v ${num(w)} ${num(y1)} ${num(d)}`,
      `v 0 ${num(y1)} ${num(d)}`,
    ].join("\n");

  const header = (extra: string[] = []) =>
    ["# OmniMod starter model", "# 1 unit = 1 block, base on y = 0, outward winding", ...extra].join("\n");

  switch (kind) {
    case "box":
      return {
        obj: `${header(["mtllib model.mtl", "o box", `usemtl ${mat}`])}\n${boxVerts(0, h)}\n${boxFaces(0)}\n`,
        mtl,
        note: "A rectangular box. Move the vertices to shape it; keep the winding (counter-clockwise seen from outside).",
      };

    case "slab":
      return {
        obj: `${header(["mtllib model.mtl", "o slab", `usemtl ${mat}`])}\n${boxVerts(0, Math.min(h, 0.25))}\n${boxFaces(0)}\n`,
        mtl,
        note: "A thin floor/ceiling tile. Sit it flush on y=0 and keep it at least 1/16 block thick so it is not a mixel.",
      };

    case "pillar": {
      const pw = opts.width ?? 0.5;
      const pd = opts.depth ?? 0.5;
      const verts = [
        `v 0 0 0`, `v ${num(pw)} 0 0`, `v ${num(pw)} 0 ${num(pd)}`, `v 0 0 ${num(pd)}`,
        `v 0 ${num(h)} 0`, `v ${num(pw)} ${num(h)} 0`, `v ${num(pw)} ${num(h)} ${num(pd)}`, `v 0 ${num(h)} ${num(pd)}`,
      ].join("\n");
      return {
        obj: `${header(["mtllib model.mtl", "o pillar", `usemtl ${mat}`])}\n${verts}\n${boxFaces(0)}\n`,
        mtl,
        note: "A square column. For a round column, add an octagonal cross-section instead of many small boxes — one element, not a stack.",
      };
    }

    case "ramp": {
      // Right triangular prism: full height at z=0, ground level at z=d.
      const verts = [
        `v 0 0 0`, `v ${num(w)} 0 0`, `v ${num(w)} 0 ${num(d)}`, `v 0 0 ${num(d)}`,
        `v 0 ${num(h)} 0`, `v ${num(w)} ${num(h)} 0`,
      ].join("\n");
      const faces = [
        `f 1 2 3 4`, // bottom -Y
        `f 1 5 6 2`, // back   -Z
        `f 5 4 3 6`, // slope  +Y +Z
        `f 2 6 3`, // right  +X
        `f 1 4 5`, // left   -X
      ].join("\n");
      return {
        obj: `${header(["mtllib model.mtl", "o ramp", `usemtl ${mat}`])}\n${verts}\n${faces}\n`,
        mtl,
        note: "A wedge for slopes and stairs. Collision voxelizes the real surface, so a player walks up it.",
      };
    }

    case "plane":
      return {
        obj: `${header([
          "mtllib model.mtl",
          "o plane",
          `usemtl ${mat}`,
          "# A single quad. Set profile.disableCull = true, or the back face is invisible.",
        ])}\nv 0 0 0\nv ${num(w)} 0 0\nv ${num(w)} 0 ${num(d)}\nv 0 0 ${num(d)}\nf 1 2 3 4\n`,
        mtl,
        note: "A flat plane. One-sided by default — a model made only of planes needs profile.disableCull = true.",
      };

    case "box_with_parts": {
      const lidH = Math.min(0.2, h / 4);
      const bodyH = h - lidH;
      // The two halves must NOT share a face. If the body kept its top and the
      // lid kept its bottom they would be coincident and coplanar: duplicate
      // geometry that z-fights, and an edge owned by four triangles. So each
      // half is an open shell and the interface is left out.
      return {
        obj: `${header([
          "mtllib model.mtl",
          "# Two named parts: animate 'lid' (e.g. rotX) to open the box.",
          "# The interface is left open on purpose — a shared face would z-fight.",
        ])}\no body\nusemtl ${mat}\n${boxVerts(0, bodyH)}\n${boxFaces(0, { top: true })}\no lid\nusemtl ${mat}\n${boxVerts(bodyH, h)}\n${boxFaces(8, { bottom: true })}\n`,
        mtl,
        note:
          "A box split into `body` and `lid` groups. Each `o` name becomes an animation node, so " +
          "`omni_3d_animate { clip }` can move the lid alone (the pivot is the group's own bounds centre). " +
          "The touching faces are omitted: two coincident coplanar faces are the classic z-fighting bug.",
      };
    }
  }
}

// ---------------------------------------------------------------------
// Top level
// ---------------------------------------------------------------------

export async function validateModelFile(objPath: string, ctx: CheckContext = {}): Promise<ModelReport> {
  const objText = await readFile(objPath, "utf8");
  let mtlText: string | null = null;
  const base = objPath.replace(/\.obj$/i, "");
  try {
    mtlText = await readFile(`${base}.mtl`, "utf8");
  } catch {
    /* no MTL is legal */
  }
  let siblings: string[] = ctx.siblingFiles ?? [];
  if (siblings.length === 0) {
    try {
      const dir = dirname(objPath);
      const s = await stat(dir);
      if (s.isDirectory()) {
        const { readdir } = await import("node:fs/promises");
        siblings = await readdir(dir);
      }
    } catch {
      /* best effort */
    }
  }
  return buildReport(objPath, objText, mtlText, { ...ctx, siblingFiles: siblings });
}

export function buildReport(
  label: string,
  objText: string,
  mtlText: string | null,
  ctx: CheckContext = {},
): ModelReport {
  const m = parseObj(objText, mtlText);
  const findings = runChecks(m, ctx);

  const triCount = m.groups.reduce((n, g) => n + g.positions.length / 9, 0);
  const verts = m.groups.reduce((n, g) => n + g.positions.length / 3, 0);
  const size = { x: m.max.x - m.min.x, y: m.max.y - m.min.y, z: m.max.z - m.min.z };
  const errors = findings.filter((x) => x.severity === "error").length;
  const warnings = findings.filter((x) => x.severity === "warning").length;
  const notes = findings.filter((x) => x.severity === "note").length;

  const verdict =
    triCount === 0
      ? "REJECTED — the engine cannot load this file."
      : errors > 0
        ? `NOT READY — ${errors} blocking defect(s). Fix them before shipping.`
        : warnings > 0
          ? `USABLE WITH ISSUES — ${warnings} warning(s). It will render, but check each one.`
          : "READY — no blocking defect and no warning.";

  const round = (v: number) => Math.round(v * 1000) / 1000;

  return {
    ok: errors === 0 && triCount > 0,
    file: label,
    engine: {
      triangles: triCount,
      vertices: verts,
      groups: m.groups.length,
      groupNames: m.groupNames.filter((n) => n !== "default"),
      materials: [...m.materials.values()].map((x) => ({
        name: x.name,
        colour: `#${[x.r, x.g, x.b].map((c) => Math.round(c * 255).toString(16).padStart(2, "0")).join("")}`,
        alpha: round(x.alpha),
        texture: x.textureRef,
        doubleSided: x.doubleSided,
      })),
      bounds: {
        min: { x: round(m.min.x), y: round(m.min.y), z: round(m.min.z) },
        max: { x: round(m.max.x), y: round(m.max.y), z: round(m.max.z) },
      },
      sizeBlocks: { x: round(size.x), y: round(size.y), z: round(size.z) },
      baseOffsetY: round(m.min.y),
      withinBudget: triCount <= BUDGET,
      budget: BUDGET,
    },
    findings,
    counts: { errors, warnings, notes },
    verdict,
  };
}
