/**
 * Mod scaffolder: turns a JSON spec into a Forge 1.20.1-shaped directory tree
 * that OmniMod's ModManager.translateModData will accept. The output is a
 * FOLDER, not a ZIP; zip it from disk afterward (or stage it directly via the
 * folder mod path on the engine side).
 *
 * Why a folder first, not a JAR directly: the agent may want to inspect
 * individual files, swap in real .png textures, or stage via the folder mod
 * path (mods_folders/<world>/<name>) before committing to a JAR.
 *
 * Every JSON key written below is one the engine actually reads. The keys
 * were chosen by reading:
 *   - ModManager.java:2697-2765 (parseModsToml)
 *   - ModManager.java:3557-3890   (translateModData)
 *   - 01_ITEM_MODEL_PIPELINE.md:28-32
 *   - 03_BLOCK_RENDERING_PIPELINE.md
 *   - 10_REGISTRATION_AND_LIFECYCLE.md:90-94
 *   - 27_RECIPE_CRAFTING_PIPELINE.md
 *   - 16_JSON_GUI_DISPATCH_PIPELINE.md
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";

export interface ModSpec {
  modId: string;
  displayName: string;
  version: string;
  description?: string;
  author?: string;
  modLoader?: "forge" | "neoforge" | "fabric";
  loaderVersion?: string;
  items?: Array<{ id: string; displayName?: string; texture?: string }>;
  blocks?: Array<{
    id: string;
    displayName?: string;
    texture?: string;
    recipe?: { pattern: string[]; key: Record<string, string>; result: { item: string; count?: number } };
  }>;
  recipes?: Array<Record<string, unknown>>;
  guis?: Array<{ filename: string; payload: Record<string, unknown> }>;
  extraAssets?: Array<{ relPath: string; content: string }>;
}

function safeSeg(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9_-]/g, "_");
}

const PLACEHOLDER_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNgAAIAAAUAAen63NgAAAAASUVORK5CYII=";

export async function scaffoldMod(
  spec: ModSpec,
  outDir: string,
): Promise<{ outDir: string; files: string[]; warnings: string[] }> {
  const warnings: string[] = [];
  const modId = safeSeg(spec.modId);
  if (modId !== spec.modId) warnings.push(`modId sanitized to "${modId}"`);
  const modLoader = spec.modLoader ?? "forge";

  const root = resolve(outDir);
  const created: string[] = [];
  const write = async (rel: string, body: string | Uint8Array) => {
    const p = join(root, ...rel.split("/"));
    const dir = p.split(sep).slice(0, -1).join(sep);
    await mkdir(dir, { recursive: true });
    if (typeof body === "string") await writeFile(p, body, "utf8");
    else await writeFile(p, body);
    created.push(rel.replace(/\//g, sep));
  };

  const toml = [
    "[[mods]]",
    `modId="${modId}"`,
    `version="${spec.version}"`,
    `displayName="${spec.displayName.replace(/"/g, '\\"')}"`,
    spec.description ? `description="${spec.description.replace(/"/g, '\\"')}"` : null,
    spec.author ? `authors="${spec.author}"` : null,
    `modLoader="${modLoader}"`,
    spec.loaderVersion
      ? `loaderVersion="${spec.loaderVersion}"`
      : `loaderVersion="${modLoader === "neoforge" ? "[21.0,)" : "[47.2,)"}"`,
    "",
  ]
    .filter(Boolean)
    .join("\n");
  await write("META-INF/mods.toml", toml);
  await write(
    "pack.mcmeta",
    JSON.stringify({ pack: { pack_format: 1, description: `${spec.displayName} resources` } }, null, 2),
  );

  const lang: Record<string, string> = {};
  for (const it of spec.items ?? []) {
    lang[`item.${modId}.${it.id}`] = it.displayName ?? prettify(it.id);
  }
  for (const bl of spec.blocks ?? []) {
    lang[`tile.${modId}.${bl.id}`] = bl.displayName ?? prettify(bl.id);
  }
  if (Object.keys(lang).length) {
    await write(`assets/${modId}/lang/en_us.json`, JSON.stringify(lang, null, 2));
  }

  for (const it of spec.items ?? []) {
    await write(
      `assets/${modId}/models/item/${it.id}.json`,
      JSON.stringify(
        { parent: "item/generated", textures: { layer0: `${modId}:item/${it.texture ?? it.id}` } },
        null,
        2,
      ),
    );
    await write(
      `assets/${modId}/textures/item/${it.texture ?? it.id}.png`,
      Buffer.from(PLACEHOLDER_PNG_BASE64, "base64"),
    );
  }

  for (const bl of spec.blocks ?? []) {
    const tex = bl.texture ?? bl.id;
    await write(
      `assets/${modId}/blockstates/${bl.id}.json`,
      JSON.stringify({ variants: { normal: { model: `${modId}:block/${bl.id}` } } }, null, 2),
    );
    await write(
      `assets/${modId}/models/block/${bl.id}.json`,
      JSON.stringify({ parent: "block/cube_all", textures: { all: `${modId}:block/${tex}` } }, null, 2),
    );
    await write(
      `assets/${modId}/textures/block/${tex}.png`,
      Buffer.from(PLACEHOLDER_PNG_BASE64, "base64"),
    );
    // 3D item icon (parent = block model — keeps the block chain, FIX-5).
    await write(
      `assets/${modId}/models/item/${bl.id}.json`,
      JSON.stringify({ parent: `${modId}:block/${bl.id}` }, null, 2),
    );

    if (bl.recipe) {
      const recipe: Record<string, unknown> = {
        type: "minecraft:crafting_shaped",
        pattern: bl.recipe.pattern,
        key: Object.fromEntries(
          Object.entries(bl.recipe.key).map(([k, v]) => [k, { item: ensure18Name(v) }]),
        ),
        result: { item: `${modId}:${bl.id}`, count: bl.recipe.result.count ?? 1 },
      };
      await write(`data/${modId}/recipes/${bl.id}.json`, JSON.stringify(recipe, null, 2));
    }
  }

  for (let i = 0; i < (spec.recipes ?? []).length; i++) {
    const r = spec.recipes![i];
    const id = String((r as { name?: string }).name ?? `recipe_${i}`);
    await write(`data/${modId}/recipes/${id}.json`, JSON.stringify(r, null, 2));
  }

  for (const g of spec.guis ?? []) {
    if (!g.filename.toLowerCase().endsWith(".json")) {
      warnings.push(`gui entry "${g.filename}" did not end in .json — engine reads the .json files only`);
    }
    await write(`assets/${modId}/gui/${g.filename}`, JSON.stringify(g.payload, null, 2));
  }

  for (const ea of spec.extraAssets ?? []) {
    await write(ea.relPath, ea.content);
  }

  return { outDir: root, files: created, warnings };
}

function ensure18Name(id: string): string {
  return id.includes(":") ? id : `minecraft:${id}`;
}

function prettify(id: string): string {
  return id
    .split("_")
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join(" ");
}
