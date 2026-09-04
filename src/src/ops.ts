/**
 * MapDev batch construction + validation.
 *
 * Engine contract (sources/main/java/net/lax1dude/eaglercraft/v1_8/sp/):
 *   MapDevWorkspace.java:70-76  op name constants
 *   MapDevWorkspace.java:62     MAX_OPS_PER_BATCH = 20000
 *   MapDevWorkspace.java:64     MAX_MESSAGE_CHARS = 256
 *   MapDevWorkspace.java:113-124 batch filename must end .json, <=128 chars,
 *                                no '/', '\', '..'
 *   MapDevWorkspace.java:251-301 validateOp — int fields reject fractions,
 *                                from/to require exactly 3 numeric elements
 *   MapDevSyncRuntime.java:431-521 applyBatch — per-op dispatch
 *   MapBuilderRuntime.java:35-39   COORD_MIN/-30000000, COORD_MAX/29999999,
 *                                  MAX_BULK_PER_CALL = 1_000_000
 *   MapBuilderRuntime.java:90-94   y must be 0..255
 * Bridge caps the batch body at 8 MB (too_large).
 */
import { translateBlock } from "./translate.js";

export const OP_NAMES = [
  "place_block",
  "fill_area",
  "replace_area",
  "set_spawn",
  "chat",
  "command",
  "load_pack",
] as const;
export type OpName = (typeof OP_NAMES)[number];

export const LIMITS = {
  MAX_OPS_PER_BATCH: 20000,
  MAX_MESSAGE_CHARS: 256,
  MAX_BATCH_BYTES: 8 * 1024 * 1024,
  MAX_BULK_PER_CALL: 1_000_000,
  COORD_MIN: -30000000,
  COORD_MAX: 29999999,
  Y_MIN: 0,
  Y_MAX: 255,
} as const;

export type Vec3 = [number, number, number];

export interface Op {
  op: OpName;
  [k: string]: unknown;
}

export interface Batch {
  format: "omnimod-dev-1";
  batch: string;
  ops: Op[];
}

export interface BuildReport {
  batch: Batch;
  /** Blocks the engine will actually touch, summed across bulk ops. */
  estimatedBlocks: number;
  /** JSON byte length of the serialized batch. */
  bytes: number;
  /** Name translations that were applied. */
  translations: string[];
  /** Hard problems — the batch must not be sent as-is. */
  errors: string[];
  /** Soft problems — the batch will apply but something will silently no-op. */
  warnings: string[];
}

function isInt(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n);
}

function checkVec(v: unknown, label: string, errors: string[]): Vec3 | null {
  if (!Array.isArray(v) || v.length !== 3) {
    errors.push(`${label} must be an array of exactly 3 integers, got ${JSON.stringify(v)}`);
    return null;
  }
  const [x, y, z] = v as unknown[];
  if (!isInt(x) || !isInt(y) || !isInt(z)) {
    errors.push(`${label} components must be whole integers (the engine rejects fractions), got ${JSON.stringify(v)}`);
    return null;
  }
  if (x < LIMITS.COORD_MIN || x > LIMITS.COORD_MAX || z < LIMITS.COORD_MIN || z > LIMITS.COORD_MAX) {
    errors.push(`${label} x/z must be within ${LIMITS.COORD_MIN}..${LIMITS.COORD_MAX}`);
    return null;
  }
  if (y < LIMITS.Y_MIN || y > LIMITS.Y_MAX) {
    errors.push(
      `${label} y=${y} is out of range. This is a 1.8 world: y must be ${LIMITS.Y_MIN}..${LIMITS.Y_MAX}. There is no negative-y / y>255 space (no 1.18 world height).`,
    );
    return null;
  }
  return [x, y, z];
}

function volume(from: Vec3, to: Vec3): number {
  return (
    (Math.abs(to[0] - from[0]) + 1) * (Math.abs(to[1] - from[1]) + 1) * (Math.abs(to[2] - from[2]) + 1)
  );
}

/**
 * Validates and normalizes a batch: translates every block name to its 1.8
 * form, checks every engine limit, and reports what will silently no-op.
 */
export function buildBatch(name: string, rawOps: Op[], autoTranslate = true): BuildReport {
  const errors: string[] = [];
  const warnings: string[] = [];
  const translations: string[] = [];
  const ops: Op[] = [];
  let estimatedBlocks = 0;

  const batchName = name.trim() || "agent-batch";
  if (rawOps.length === 0) errors.push("The batch has no ops.");
  if (rawOps.length > LIMITS.MAX_OPS_PER_BATCH) {
    errors.push(
      `${rawOps.length} ops exceeds MAX_OPS_PER_BATCH=${LIMITS.MAX_OPS_PER_BATCH} (MapDevWorkspace.java:62). Split into several batches.`,
    );
  }

  const xlateBlock = (raw: unknown, meta: unknown, label: string): { id: string; meta: number } | null => {
    if (typeof raw !== "string" || !raw.trim()) {
      errors.push(`${label}: "block" is required and must be a string.`);
      return null;
    }
    const m = meta === undefined ? 0 : meta;
    if (!isInt(m) || (m as number) < 0 || (m as number) > 15) {
      errors.push(`${label}: "meta" must be an integer 0..15 (the 1.8 metadata nibble), got ${JSON.stringify(meta)}`);
      return null;
    }
    if (!autoTranslate) return { id: raw.trim(), meta: m as number };
    const t = translateBlock(raw, m as number);
    if (t.translated && t.note) translations.push(`${label}: ${t.note}`);
    if (t.unresolved && t.note) warnings.push(`${label}: ${t.note}`);
    return { id: t.id, meta: t.meta };
  };

  rawOps.forEach((raw, idx) => {
    const label = `op[${idx}] ${String(raw?.op ?? "?")}`;
    const opName = raw?.op;
    if (typeof opName !== "string" || !(OP_NAMES as readonly string[]).includes(opName)) {
      errors.push(`${label}: unknown op. The engine understands exactly: ${OP_NAMES.join(", ")}`);
      return;
    }

    switch (opName as OpName) {
      case "place_block": {
        const blk = xlateBlock(raw.block, raw.meta, label);
        const pos = checkVec([raw.x, raw.y, raw.z], `${label} x/y/z`, errors);
        if (!blk || !pos) return;
        ops.push({ op: "place_block", block: blk.id, meta: blk.meta, x: pos[0], y: pos[1], z: pos[2] });
        estimatedBlocks += 1;
        return;
      }
      case "fill_area": {
        const blk = xlateBlock(raw.block, raw.meta, label);
        const from = checkVec(raw.from, `${label} from`, errors);
        const to = raw.to === undefined ? from : checkVec(raw.to, `${label} to`, errors);
        if (!blk || !from || !to) return;
        const v = volume(from, to);
        if (v > LIMITS.MAX_BULK_PER_CALL) {
          errors.push(
            `${label}: region is ${v.toLocaleString()} blocks, over MAX_BULK_PER_CALL=${LIMITS.MAX_BULK_PER_CALL.toLocaleString()} (MapBuilderRuntime.java:39). Split the region.`,
          );
          return;
        }
        ops.push({ op: "fill_area", block: blk.id, meta: blk.meta, from, to });
        estimatedBlocks += v;
        return;
      }
      case "replace_area": {
        const blk = xlateBlock(raw.block, raw.meta, label);
        const fromBlk = xlateBlock(raw.fromBlock, 0, `${label} fromBlock`);
        const from = checkVec(raw.from, `${label} from`, errors);
        const to = raw.to === undefined ? from : checkVec(raw.to, `${label} to`, errors);
        if (!blk || !fromBlk || !from || !to) return;
        const v = volume(from, to);
        if (v > LIMITS.MAX_BULK_PER_CALL) {
          errors.push(
            `${label}: region is ${v.toLocaleString()} blocks, over MAX_BULK_PER_CALL=${LIMITS.MAX_BULK_PER_CALL.toLocaleString()}. Split the region.`,
          );
          return;
        }
        ops.push({ op: "replace_area", fromBlock: fromBlk.id, block: blk.id, meta: blk.meta, from, to });
        estimatedBlocks += v;
        return;
      }
      case "set_spawn": {
        const src = raw.pos !== undefined ? raw.pos : raw.from;
        const pos = checkVec(src, `${label} pos`, errors);
        if (!pos) return;
        ops.push({ op: "set_spawn", pos, from: pos });
        return;
      }
      case "chat": {
        if (typeof raw.message !== "string" || !raw.message) {
          errors.push(`${label}: "message" is required.`);
          return;
        }
        let msg = raw.message;
        if (msg.length > LIMITS.MAX_MESSAGE_CHARS) {
          warnings.push(`${label}: message truncated to ${LIMITS.MAX_MESSAGE_CHARS} chars by the engine.`);
          msg = msg.slice(0, LIMITS.MAX_MESSAGE_CHARS);
        }
        ops.push({ op: "chat", message: msg });
        return;
      }
      case "command": {
        if (typeof raw.command !== "string" || !raw.command.trim()) {
          errors.push(`${label}: "command" is required.`);
          return;
        }
        ops.push({ op: "command", command: raw.command.trim().replace(/^\/+/, "") });
        return;
      }
      case "load_pack": {
        const hasManifest = typeof raw.manifest === "string" && raw.manifest.length > 0;
        if (!hasManifest) {
          for (const k of ["id", "kind", "url"]) {
            if (typeof raw[k] !== "string" || !(raw[k] as string).trim()) {
              errors.push(`${label}: without "manifest", the fields id, kind and url are all required.`);
              return;
            }
          }
        }
        ops.push({ ...raw, op: "load_pack" });
        return;
      }
    }
  });

  const batch: Batch = { format: "omnimod-dev-1", batch: batchName, ops };
  const bytes = Buffer.byteLength(JSON.stringify(batch), "utf8");
  if (bytes > LIMITS.MAX_BATCH_BYTES) {
    errors.push(
      `Serialized batch is ${(bytes / 1048576).toFixed(2)} MB, over the 8 MB bridge cap (too_large). Split it.`,
    );
  }

  return { batch, estimatedBlocks, bytes, translations, errors, warnings };
}

/** Filename validator mirroring MapDevWorkspace.isSafeBatchFileName (:113-124). */
export function safeBatchFileName(name: string): string {
  let n = name.trim();
  if (!n) n = "agent-batch";
  n = n.replace(/[\\/]/g, "_").replace(/\.\./g, "_");
  if (!n.toLowerCase().endsWith(".json")) n += ".json";
  if (n.length > 128) n = n.slice(0, 123) + ".json";
  return n;
}
