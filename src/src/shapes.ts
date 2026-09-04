/**
 * Geometry primitives that compile into MapDev ops.
 *
 * This is the "professional builder" layer: an agent should not have to emit
 * thousands of place_block ops by hand, and it should not have to rediscover
 * how to rasterize a sphere. Every generator here emits the smallest set of
 * fill_area ops it can (fills are one engine call for up to 1,000,000 blocks,
 * so a box shell as 6 fills is dramatically cheaper than 500 place_blocks).
 */
import type { Op, Vec3 } from "./ops.js";

export interface Box {
  from: Vec3;
  to: Vec3;
}

function norm(a: Vec3, b: Vec3): { min: Vec3; max: Vec3 } {
  return {
    min: [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.min(a[2], b[2])],
    max: [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.max(a[2], b[2])],
  };
}

const fill = (block: string, meta: number, from: Vec3, to: Vec3): Op => ({
  op: "fill_area",
  block,
  meta,
  from,
  to,
});

const place = (block: string, meta: number, p: Vec3): Op => ({
  op: "place_block",
  block,
  meta,
  x: p[0],
  y: p[1],
  z: p[2],
});

/** Solid cuboid — a single fill_area. */
export function solidBox(block: string, meta: number, a: Vec3, b: Vec3): Op[] {
  const { min, max } = norm(a, b);
  return [fill(block, meta, min, max)];
}

/**
 * Hollow cuboid shell as 6 fills (walls + floor + ceiling), each face optional.
 * Faces are inclusive of the bounding box, so the interior is the box inset by 1.
 */
export function hollowBox(
  block: string,
  meta: number,
  a: Vec3,
  b: Vec3,
  faces: { floor?: boolean; ceiling?: boolean; walls?: boolean } = {},
): Op[] {
  const { min, max } = norm(a, b);
  const [x0, y0, z0] = min;
  const [x1, y1, z1] = max;
  const wantFloor = faces.floor !== false;
  const wantCeiling = faces.ceiling !== false;
  const wantWalls = faces.walls !== false;
  const ops: Op[] = [];

  if (wantFloor) ops.push(fill(block, meta, [x0, y0, z0], [x1, y0, z1]));
  if (wantCeiling && y1 !== y0) ops.push(fill(block, meta, [x0, y1, z0], [x1, y1, z1]));

  if (wantWalls) {
    const wy0 = wantFloor ? Math.min(y0 + 1, y1) : y0;
    const wy1 = wantCeiling ? Math.max(y1 - 1, y0) : y1;
    if (wy1 >= wy0) {
      ops.push(fill(block, meta, [x0, wy0, z0], [x1, wy1, z0])); // north wall
      ops.push(fill(block, meta, [x0, wy0, z1], [x1, wy1, z1])); // south wall
      if (z1 - z0 >= 2) {
        ops.push(fill(block, meta, [x0, wy0, z0 + 1], [x0, wy1, z1 - 1])); // west
        ops.push(fill(block, meta, [x1, wy0, z0 + 1], [x1, wy1, z1 - 1])); // east
      }
    }
  }
  return ops;
}

/** Straight line between two points (3D Bresenham), one place_block per step. */
export function line(block: string, meta: number, a: Vec3, b: Vec3): Op[] {
  const ops: Op[] = [];
  let [x, y, z] = a;
  const [x1, y1, z1] = b;
  const dx = Math.abs(x1 - x), dy = Math.abs(y1 - y), dz = Math.abs(z1 - z);
  const sx = x1 > x ? 1 : -1, sy = y1 > y ? 1 : -1, sz = z1 > z ? 1 : -1;
  const n = Math.max(dx, dy, dz);
  if (n === 0) return [place(block, meta, a)];
  let ex = n / 2, ey = n / 2, ez = n / 2;
  for (let step = 0; step <= n; step++) {
    ops.push(place(block, meta, [x, y, z]));
    ex -= dx; ey -= dy; ez -= dz;
    if (ex < 0) { ex += n; x += sx; }
    if (ey < 0) { ey += n; y += sy; }
    if (ez < 0) { ez += n; z += sz; }
  }
  return ops;
}

/**
 * Cylinder (vertical axis) — rasterized per y-layer as horizontal runs, so a
 * wide cylinder costs a few fills per row instead of one op per block.
 */
export function cylinder(
  block: string,
  meta: number,
  center: Vec3,
  radius: number,
  height: number,
  hollow = false,
): Op[] {
  const ops: Op[] = [];
  const [cx, cy, cz] = center;
  const r2 = radius * radius;
  const inner = Math.max(0, radius - 1);
  const inner2 = inner * inner;

  for (let dz = -radius; dz <= radius; dz++) {
    // Horizontal run for this z-row: x from -w..w where dx^2+dz^2 <= r^2.
    const w = Math.floor(Math.sqrt(Math.max(0, r2 - dz * dz)));
    if (w < 0) continue;
    if (!hollow) {
      ops.push(fill(block, meta, [cx - w, cy, cz + dz], [cx + w, cy + height - 1, cz + dz]));
      continue;
    }
    const iw = inner2 - dz * dz >= 0 ? Math.floor(Math.sqrt(inner2 - dz * dz)) : -1;
    if (iw < 0) {
      ops.push(fill(block, meta, [cx - w, cy, cz + dz], [cx + w, cy + height - 1, cz + dz]));
    } else {
      ops.push(fill(block, meta, [cx - w, cy, cz + dz], [cx - iw - 1, cy + height - 1, cz + dz]));
      ops.push(fill(block, meta, [cx + iw + 1, cy, cz + dz], [cx + w, cy + height - 1, cz + dz]));
    }
  }
  return ops;
}

/** Sphere / ellipsoid, rasterized as x-runs per (y,z) row. */
export function sphere(
  block: string,
  meta: number,
  center: Vec3,
  radius: number | Vec3,
  hollow = false,
): Op[] {
  const [rx, ry, rz] = typeof radius === "number" ? [radius, radius, radius] : radius;
  const [cx, cy, cz] = center;
  const ops: Op[] = [];
  const inside = (dx: number, dy: number, dz: number, shrink: number) => {
    const ax = rx - shrink, ay = ry - shrink, az = rz - shrink;
    if (ax <= 0 || ay <= 0 || az <= 0) return false;
    return (dx * dx) / (ax * ax) + (dy * dy) / (ay * ay) + (dz * dz) / (az * az) <= 1.0;
  };

  for (let dy = -ry; dy <= ry; dy++) {
    for (let dz = -rz; dz <= rz; dz++) {
      let runStart: number | null = null;
      for (let dx = -rx; dx <= rx + 1; dx++) {
        const on = dx <= rx && inside(dx, dy, dz, 0) && (!hollow || !inside(dx, dy, dz, 1));
        if (on && runStart === null) runStart = dx;
        if (!on && runStart !== null) {
          ops.push(fill(block, meta, [cx + runStart, cy + dy, cz + dz], [cx + dx - 1, cy + dy, cz + dz]));
          runStart = null;
        }
      }
    }
  }
  return ops;
}

/** Stepped pyramid, one fill per layer. `hollow` skips the interior of each layer. */
export function pyramid(
  block: string,
  meta: number,
  center: Vec3,
  baseRadius: number,
  hollow = false,
): Op[] {
  const [cx, cy, cz] = center;
  const ops: Op[] = [];
  for (let layer = 0; layer <= baseRadius; layer++) {
    const r = baseRadius - layer;
    const y = cy + layer;
    if (!hollow || r === 0) {
      ops.push(fill(block, meta, [cx - r, y, cz - r], [cx + r, y, cz + r]));
    } else {
      ops.push(fill(block, meta, [cx - r, y, cz - r], [cx + r, y, cz - r]));
      ops.push(fill(block, meta, [cx - r, y, cz + r], [cx + r, y, cz + r]));
      ops.push(fill(block, meta, [cx - r, y, cz - r + 1], [cx - r, y, cz + r - 1]));
      ops.push(fill(block, meta, [cx + r, y, cz - r + 1], [cx + r, y, cz + r - 1]));
    }
  }
  return ops;
}

/**
 * Gable roof over a footprint. Ridge runs along the given axis; each course is
 * two fills (both slopes), so a 20x12 roof is ~12 ops rather than 240.
 */
export function gableRoof(
  block: string,
  meta: number,
  a: Vec3,
  b: Vec3,
  ridgeAxis: "x" | "z" = "x",
  overhang = 1,
): Op[] {
  const { min, max } = norm(a, b);
  const ops: Op[] = [];
  const y = max[1];
  const x0 = min[0] - overhang, x1 = max[0] + overhang;
  const z0 = min[2] - overhang, z1 = max[2] + overhang;

  if (ridgeAxis === "x") {
    const span = Math.floor((z1 - z0) / 2);
    for (let i = 0; i <= span; i++) {
      const yy = y + i;
      ops.push(fill(block, meta, [x0, yy, z0 + i], [x1, yy, z0 + i]));
      if (z1 - i !== z0 + i) ops.push(fill(block, meta, [x0, yy, z1 - i], [x1, yy, z1 - i]));
    }
  } else {
    const span = Math.floor((x1 - x0) / 2);
    for (let i = 0; i <= span; i++) {
      const yy = y + i;
      ops.push(fill(block, meta, [x0 + i, yy, z0], [x0 + i, yy, z1]));
      if (x1 - i !== x0 + i) ops.push(fill(block, meta, [x1 - i, yy, z0], [x1 - i, yy, z1]));
    }
  }
  return ops;
}

/** Flat-top pyramid roof (hip roof) over a footprint. */
export function hipRoof(block: string, meta: number, a: Vec3, b: Vec3, overhang = 1): Op[] {
  const { min, max } = norm(a, b);
  const ops: Op[] = [];
  let x0 = min[0] - overhang, x1 = max[0] + overhang;
  let z0 = min[2] - overhang, z1 = max[2] + overhang;
  let y = max[1];
  while (x1 >= x0 && z1 >= z0) {
    ops.push(fill(block, meta, [x0, y, z0], [x1, y, z0]));
    if (z1 !== z0) ops.push(fill(block, meta, [x0, y, z1], [x1, y, z1]));
    if (x1 > x0 && z1 - z0 >= 2) {
      ops.push(fill(block, meta, [x0, y, z0 + 1], [x0, y, z1 - 1]));
      ops.push(fill(block, meta, [x1, y, z0 + 1], [x1, y, z1 - 1]));
    }
    x0++; x1--; z0++; z1--; y++;
  }
  return ops;
}

/** Carves an opening (fills with air) — doors, windows, arches. */
export function carve(a: Vec3, b: Vec3): Op[] {
  const { min, max } = norm(a, b);
  return [fill("minecraft:air", 0, min, max)];
}

/**
 * A complete building shell: foundation, walls, floor, roof, a door opening and
 * a regular window band. This is the single most common "build me a house"
 * request, expressed once and correctly.
 */
export interface BuildingSpec {
  origin: Vec3;
  /** Footprint size including walls. */
  width: number;
  depth: number;
  /** Interior wall height (floor to ceiling), excluding roof. */
  height: number;
  wallBlock: string;
  wallMeta?: number;
  floorBlock?: string;
  floorMeta?: number;
  foundationBlock?: string;
  foundationMeta?: number;
  roof?: { style: "gable" | "hip" | "flat"; block: string; meta?: number; ridgeAxis?: "x" | "z"; overhang?: number };
  /** Door on the given side, centered. */
  door?: { side: "north" | "south" | "east" | "west"; width?: number; height?: number };
  /** Window band: y offset from floor, and spacing along each wall. */
  windows?: { yOffset?: number; spacing?: number; height?: number; block?: string; meta?: number };
}

export function building(spec: BuildingSpec): Op[] {
  const [ox, oy, oz] = spec.origin;
  const w = Math.max(3, spec.width);
  const d = Math.max(3, spec.depth);
  const h = Math.max(2, spec.height);
  const x0 = ox, x1 = ox + w - 1;
  const z0 = oz, z1 = oz + d - 1;
  const wallMeta = spec.wallMeta ?? 0;
  const ops: Op[] = [];

  if (spec.foundationBlock) {
    ops.push(fill(spec.foundationBlock, spec.foundationMeta ?? 0, [x0, oy - 1, z0], [x1, oy - 1, z1]));
  }
  ops.push(fill(spec.floorBlock ?? spec.wallBlock, spec.floorMeta ?? spec.wallMeta ?? 0, [x0, oy, z0], [x1, oy, z1]));

  // Walls from oy+1 up to oy+h.
  const wy0 = oy + 1, wy1 = oy + h;
  ops.push(fill(spec.wallBlock, wallMeta, [x0, wy0, z0], [x1, wy1, z0]));
  ops.push(fill(spec.wallBlock, wallMeta, [x0, wy0, z1], [x1, wy1, z1]));
  ops.push(fill(spec.wallBlock, wallMeta, [x0, wy0, z0 + 1], [x0, wy1, z1 - 1]));
  ops.push(fill(spec.wallBlock, wallMeta, [x1, wy0, z0 + 1], [x1, wy1, z1 - 1]));

  // Roof.
  const roof = spec.roof;
  if (roof && roof.style !== "flat") {
    const ridgeTop: Vec3 = [x1, wy1 + 1, z1];
    const base: Vec3 = [x0, wy1 + 1, z0];
    ops.push(
      ...(roof.style === "gable"
        ? gableRoof(roof.block, roof.meta ?? 0, base, ridgeTop, roof.ridgeAxis ?? (w >= d ? "x" : "z"), roof.overhang ?? 1)
        : hipRoof(roof.block, roof.meta ?? 0, base, ridgeTop, roof.overhang ?? 1)),
    );
  } else if (roof) {
    const o = roof.overhang ?? 0;
    ops.push(fill(roof.block, roof.meta ?? 0, [x0 - o, wy1 + 1, z0 - o], [x1 + o, wy1 + 1, z1 + o]));
  }

  // Windows: a band punched through both wall pairs at a regular spacing.
  const win = spec.windows;
  if (win) {
    const wyStart = oy + 1 + (win.yOffset ?? 1);
    const wh = Math.max(1, win.height ?? 2);
    const step = Math.max(2, win.spacing ?? 3);
    const wBlock = win.block ?? "minecraft:glass_pane";
    const wMeta = win.meta ?? 0;
    for (let x = x0 + 2; x <= x1 - 2; x += step) {
      ops.push(fill(wBlock, wMeta, [x, wyStart, z0], [x, wyStart + wh - 1, z0]));
      ops.push(fill(wBlock, wMeta, [x, wyStart, z1], [x, wyStart + wh - 1, z1]));
    }
    for (let z = z0 + 2; z <= z1 - 2; z += step) {
      ops.push(fill(wBlock, wMeta, [x0, wyStart, z], [x0, wyStart + wh - 1, z]));
      ops.push(fill(wBlock, wMeta, [x1, wyStart, z], [x1, wyStart + wh - 1, z]));
    }
  }

  // Door opening, centered on the chosen wall.
  const door = spec.door;
  if (door) {
    const dw = Math.max(1, door.width ?? 1);
    const dh = Math.max(2, door.height ?? 2);
    const cx = Math.floor((x0 + x1) / 2);
    const cz = Math.floor((z0 + z1) / 2);
    const half = Math.floor((dw - 1) / 2);
    if (door.side === "north") ops.push(...carve([cx - half, oy + 1, z0], [cx - half + dw - 1, oy + dh, z0]));
    if (door.side === "south") ops.push(...carve([cx - half, oy + 1, z1], [cx - half + dw - 1, oy + dh, z1]));
    if (door.side === "west") ops.push(...carve([x0, oy + 1, cz - half], [x0, oy + dh, cz - half + dw - 1]));
    if (door.side === "east") ops.push(...carve([x1, oy + 1, cz - half], [x1, oy + dh, cz - half + dw - 1]));
  }

  return ops;
}

/** Interior clear-out — useful after a solid box, or to hollow terrain. */
export function clearInterior(a: Vec3, b: Vec3): Op[] {
  const { min, max } = norm(a, b);
  if (max[0] - min[0] < 2 || max[1] - min[1] < 2 || max[2] - min[2] < 2) return [];
  return carve([min[0] + 1, min[1] + 1, min[2] + 1], [max[0] - 1, max[1] - 1, max[2] - 1]);
}
