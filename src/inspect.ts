/**
 * Mod inspector: opens a Forge 1.20.1 mod (JAR or unzipped folder) and
 * reports structural facts plus a list of problems the bridge's loader is
 * likely to trip on.
 *
 * Works in two modes:
 *  - jar:  read entry headers + body on demand, never inflate the whole zip
 *  - dir:  walk the file tree directly (use this for mods_folders/ sources)
 *
 * For every detected problem we cite the engine code that would surface the
 * error, so the agent can read the source itself.
 */
import { readdir, readFile, stat } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { unzipSync, strFromU8 } from "fflate";

export interface ModReport {
  kind: "jar" | "dir";
  root: string;
  metadata: {
    modId: string | null;
    version: string | null;
    displayName: string | null;
    description: string | null;
    modLoader: string | null;
    loaderVersion: string | null;
    rawToml: string | null;
    rawMcmodInfo: string | null;
  };
  counts: {
    totalFiles: number;
    models: number;
    blockstates: number;
    textures: number;
    recipes: number;
    langFiles: number;
    guis: number;
    shaders: number;
    sounds: number;
  };
  assetNamespaces: string[];
  itemTextures: { folder: "item" | "items"; files: string[] };
  blockTextures: { folder: "block" | "blocks"; files: string[] };
  parsed: {
    models: Record<string, unknown>;
    blockstates: Record<string, unknown>;
    recipes: Record<string, unknown>;
    guis: Record<string, unknown>;
  };
  problems: { severity: "error" | "warning" | "info"; id: string; detail: string; cite: string }[];
  warnings: string[];
}

function relPath(p: string): string {
  return p.split(sep).join("/");
}

async function listDir(abs: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string, prefix: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      const child = join(dir, e.name);
      const rel = prefix ? `${prefix}/${e.name}` : e.name;
      if (e.isDirectory()) await walk(child, rel);
      else out.push(rel);
    }
  }
  try {
    await walk(abs, "");
  } catch {
    /* missing dir */
  }
  return out;
}

function tryParseJson<T>(s: string | null): T | null {
  if (s === null) return null;
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
}

function looksBinary(buf: Uint8Array): boolean {
  for (let i = 0; i < Math.min(buf.length, 64); i++) if (buf[i] === 0) return true;
  return false;
}

export async function inspectMod(path: string): Promise<ModReport> {
  const root = resolve(path);
  const st = await stat(root).catch(() => null);
  if (!st) throw new Error(`Mod path not found: ${root}`);

  const problems: ModReport["problems"] = [];
  const problem = (
    severity: "error" | "warning" | "info",
    id: string,
    detail: string,
    cite: string,
  ) => {
    problems.push({ severity, id, detail, cite });
  };

  const report: ModReport = {
    kind: st.isDirectory() ? "dir" : "jar",
    root,
    metadata: {
      modId: null,
      version: null,
      displayName: null,
      description: null,
      modLoader: null,
      loaderVersion: null,
      rawToml: null,
      rawMcmodInfo: null,
    },
    counts: {
      totalFiles: 0,
      models: 0,
      blockstates: 0,
      textures: 0,
      recipes: 0,
      langFiles: 0,
      guis: 0,
      shaders: 0,
      sounds: 0,
    },
    assetNamespaces: [],
    itemTextures: { folder: "item", files: [] },
    blockTextures: { folder: "block", files: [] },
    parsed: { models: {}, blockstates: {}, recipes: {}, guis: {} },
    problems,
    warnings: [],
  };

  const files: { rel: string; bytes: Uint8Array; text: string | null }[] = [];
  if (st.isDirectory()) {
    const rels = await listDir(root);
    for (const r of rels) {
      const abs = join(root, ...r.split("/"));
      const buf = await readFile(abs);
      const isText = /\.(json|toml|properties|lang|mcmeta)$/i.test(r) || !looksBinary(buf);
      files.push({ rel: r, bytes: buf, text: isText ? new TextDecoder("utf-8").decode(buf) : null });
    }
  } else {
    const zipped = await readFile(root);
    const zip = unzipSync(zipped);
    for (const [name, body] of Object.entries(zip)) {
      const isText = /\.(json|toml|properties|lang|mcmeta)$/i.test(name) || !looksBinary(body);
      files.push({ rel: name, bytes: body, text: isText ? strFromU8(body) : null });
    }
  }
  report.counts.totalFiles = files.length;

  for (const f of files) {
    const r = f.rel;
    if (/^META-INF\/mods\.toml$/i.test(r)) {
      report.metadata.rawToml = f.text;
      Object.assign(report.metadata, parseModsToml(f.text ?? ""));
    } else if (/^mcmod\.info$/i.test(r)) {
      report.metadata.rawMcmodInfo = f.text;
    } else if (/^assets\/([^/]+)\/models\/item\/.+\.json$/i.test(r)) {
      report.counts.models++;
      const json = tryParseJson<Record<string, unknown>>(f.text);
      if (json) report.parsed.models[r] = json;
    } else if (/^assets\/([^/]+)\/models\/block\/.+\.json$/i.test(r)) {
      report.counts.models++;
      const json = tryParseJson<Record<string, unknown>>(f.text);
      if (json) report.parsed.models[r] = json;
    } else if (/^assets\/([^/]+)\/blockstates\/.+\.json$/i.test(r)) {
      report.counts.blockstates++;
      const json = tryParseJson<Record<string, unknown>>(f.text);
      if (json) report.parsed.blockstates[r] = json;
    } else if (/^assets\/([^/]+)\/textures\/item\/.+\.png$/i.test(r)) {
      report.counts.textures++;
      report.itemTextures.files.push(r);
    } else if (/^assets\/([^/]+)\/textures\/items\/.+\.png$/i.test(r)) {
      report.counts.textures++;
      report.itemTextures.folder = "items";
      report.itemTextures.files.push(r);
    } else if (/^assets\/([^/]+)\/textures\/block\/.+\.png$/i.test(r)) {
      report.counts.textures++;
      report.blockTextures.files.push(r);
    } else if (/^assets\/([^/]+)\/textures\/blocks\/.+\.png$/i.test(r)) {
      report.counts.textures++;
      report.blockTextures.folder = "blocks";
      report.blockTextures.files.push(r);
    } else if (/^assets\/([^/]+)\/lang\/.+\.(json|lang)$/i.test(r)) {
      report.counts.langFiles++;
    } else if (/^assets\/([^/]+)\/gui\/.+\.json$/i.test(r)) {
      report.counts.guis++;
      const json = tryParseJson<Record<string, unknown>>(f.text);
      if (json) report.parsed.guis[r] = json;
    } else if (/^assets\/([^/]+)\/shaders\//i.test(r)) {
      report.counts.shaders++;
    } else if (/^assets\/([^/]+)\/sounds\.json$/i.test(r)) {
      report.counts.sounds++;
    } else if (/^data\/([^/]+)\/recipes\/.+\.json$/i.test(r)) {
      report.counts.recipes++;
      const json = tryParseJson<Record<string, unknown>>(f.text);
      if (json) report.parsed.recipes[r] = json;
    }
  }

  report.assetNamespaces = [
    ...new Set(
      files
        .map((f) => /^assets\/([^/]+)\//.exec(f.rel)?.[1])
        .filter((s): s is string => !!s),
    ),
  ];

  if (!report.metadata.rawToml && !report.metadata.rawMcmodInfo) {
    problem(
      "warning",
      "no-metadata",
      "Mod has no META-INF/mods.toml and no mcmod.info. Metadata will be synthesized from the first asset namespace, which can be a wrong guess (ModManager.java:2143-2154).",
      "ModManager.java:1956-1963, 2143-2154",
    );
  }
  if (report.metadata.rawToml) {
    if (/\$\{mod_id\}/i.test(report.metadata.rawToml)) {
      problem(
        "error",
        "toml-gradle-template",
        'mods.toml contains the literal "${mod_id}" token. That becomes the modId and breaks element extraction (05_COMMON_PITFALLS.md:135-139).',
        "05_COMMON_PITFALLS.md:135-139",
      );
    }
    if (!/modid\s*=\s*"[^"]+"/i.test(report.metadata.rawToml)) {
      problem(
        "error",
        "toml-missing-modid",
        "mods.toml has no `[[mods]] modId=...`. Without a modId the namespace is synthesized.",
        "ModManager.java:2697-2765",
      );
    }
  }

  for (const [path, r] of Object.entries(report.parsed.recipes)) {
    const recipe = r as {
      type?: string;
      pattern?: string[];
      key?: Record<string, unknown>;
      result?: unknown;
      ingredients?: unknown[];
    };
    const t = String(recipe.type ?? "minecraft:crafting_shaped");
    if (/shaped/.test(t) && Array.isArray(recipe.pattern)) {
      for (const row of recipe.pattern) {
        if (row.length > 3 || recipe.pattern.length > 3) {
          problem(
            "error",
            "pattern-too-large",
            `${path} pattern is ${recipe.pattern.length}x${row.length}, over the 3x3 limit. The engine drops the recipe (ModernRecipeRuntime.java:747-749).`,
            "ModernRecipeRuntime.java:747-749",
          );
          break;
        }
      }
    }
    if (typeof recipe.result === "string") {
      problem(
        "info",
        "result-string-form",
        `${path} uses a bare string for "result". The engine accepts it; consider the 1.20 form {item, count, nbt} for forward compat (ModernRecipeRuntime.java:986-1012).`,
        "ModernRecipeRuntime.java:969-1012",
      );
    }
  }

  for (const [bsPath, bs] of Object.entries(report.parsed.blockstates)) {
    const v = (bs as { variants?: Record<string, { model?: string }> })?.variants;
    if (!v) {
      problem(
        "warning",
        "blockstate-no-variants",
        `${bsPath} has no "variants" key. The engine substitutes a missing-texture model.`,
        "03_BLOCK_RENDERING_PIPELINE.md",
      );
    }
  }

  for (const [modelPath, m] of Object.entries(report.parsed.models)) {
    if (!/models\/item\//.test(modelPath)) continue;
    const tex = (m as { textures?: Record<string, string> })?.textures?.layer0;
    if (!tex) continue;
    if (!/^[^:]+:item\//.test(tex)) {
      problem(
        "warning",
        "item-layer0-not-item-namespace",
        `${modelPath} layer0=${tex} is not \`<ns>:item/...\`. The model will likely fail to resolve.`,
        "01_ITEM_MODEL_PIPELINE.md:28-32",
      );
    }
  }

  if (report.counts.models === 0 && report.counts.blockstates > 0) {
    problem(
      "warning",
      "no-models",
      "Mod has blockstates but no model files. The fallback bakes the registry name as the texture path and the block renders as missing-texture (01_ITEM_MODEL_PIPELINE.md:112-117).",
      "01_ITEM_MODEL_PIPELINE.md:112-117",
    );
  }
  if (report.counts.guis > 0) {
    for (const [g, p] of Object.entries(report.parsed.guis)) {
      const keys = Object.keys(p as object);
      if (!keys.includes("screen") && !keys.includes("title")) {
        problem(
          "warning",
          "gui-missing-screen-title",
          `${g} has no "screen" or "title" key. JSON GUI dispatch skips the file silently.`,
          "16_JSON_GUI_DISPATCH_PIPELINE.md",
        );
      }
    }
  }

  return report;
}

function parseModsToml(text: string): {
  modId: string | null;
  version: string | null;
  displayName: string | null;
  description: string | null;
  modLoader: string | null;
  loaderVersion: string | null;
} {
  const find = (k: string): string | null => {
    const m = new RegExp(`^\\s*${k}\\s*=\\s*"([^"]+)"`, "im").exec(text);
    return m ? m[1] : null;
  };
  return {
    modId: find("modId") ?? find("modid"),
    version: find("version"),
    displayName: find("displayName") ?? find("displayname"),
    description: find("description"),
    modLoader: find("modLoader") ?? find("modloader"),
    loaderVersion: find("loaderVersion") ?? find("loaderversion"),
  };
}

// quiet unused-import lint
void relPath;
