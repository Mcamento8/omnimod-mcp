# 06 — MOD AUTHORING FOR OMNIMOD

## The one fact that determines everything else

**The mod's Java is never executed.** OmniMod's Forge 1.20.1 compatibility layer is a
translation and asset bridge, not a Forge runtime. There is no Forge event bus, no mixin
application, no `@Mod` class construction, no bytecode from the JAR running at all.

What IS bridged: the mod's **metadata**, its **assets** (models, blockstates, textures,
lang), its **data** (recipes, tags, loot tables), and the **data-driven parts of its
behaviour** that the engine's compat registries can reconstruct from those files.

Therefore, when you write a mod for this game, you are writing a **data pack in Forge
clothing**. Design accordingly:

- A block that is just a block, with a model and a recipe: works.
- An item that is just an item, with a model and a recipe: works.
- A block whose behaviour is expressible through the engine's data-driven registries
  (harvest level, colour, loot table, explosion behaviour, simple interaction): works.
- A block whose behaviour lives in custom Java (a tick handler, a custom capability, a
  bespoke GUI controller, novel physics): **does not work**. Do not promise it.

Say this plainly to the user before building a mod. It is the difference between a mod
that works and a mod that installs silently and does nothing.

## Folder shape of an acceptable mod

```
mymod.jar (or a plain folder with the same layout)
  META-INF/mods.toml
  pack.mcmeta
  assets/<modid>/
    lang/en_us.json
    models/item/<name>.json
    models/block/<name>.json
    blockstates/<name>.json
    textures/item/<name>.png
    textures/block/<name>.png
  data/<modid>/
    recipes/<name>.json
    tags/items/<name>.json
    loot_tables/blocks/<name>.json
```

### `META-INF/mods.toml`

```toml
[[mods]]
modId="mymod"
version="1.0.0"
displayName="My Mod"
description="What it adds"
authors="you"
modLoader="forge"
loaderVersion="[47.2,)"
```

**Never template the modId.** A literal `${mod_id}` from a Gradle build becomes the modId
verbatim, the namespace guess fails, and zero elements are extracted from the mod. Hardcode
it. This is a real, repeatedly-observed failure.

### Item model — the singular/plural trap

`assets/mymod/models/item/ruby.json`:

```json
{ "parent": "item/generated", "textures": { "layer0": "mymod:item/ruby" } }
```

The texture reference in `layer0` is **singular** (`mymod:item/ruby`) and the PNG lives at
`assets/mymod/textures/item/ruby.png`. The bridge tolerates both `item/` and the legacy
`items/` for the texture directory, but `layer0` must be the singular form.

If a model cannot be loaded at all, the engine synthesises a fallback whose texture path is
the registry name — which never exists as a PNG. That is exactly what the missing-texture
checkerboard on a modded item means: your model did not resolve.

### Block model + blockstate — both are required

`assets/mymod/blockstates/ruby_block.json`:

```json
{ "variants": { "normal": { "model": "mymod:block/ruby_block" } } }
```

`assets/mymod/models/block/ruby_block.json`:

```json
{ "parent": "block/cube_all", "textures": { "all": "mymod:block/ruby_block" } }
```

Note `variants.normal` — this is the **1.8** blockstate format, not the 1.20 multipart
format. Prefer `block/cube_all` or `block/cube_column` as the parent so the engine does not
have to fall back. A block with a model but no blockstate JSON renders as missing texture on
every face.

### Lang

`assets/mymod/lang/en_us.json` with 1.8-style keys:

```json
{ "item.mymod.ruby": "Ruby", "tile.mymod.ruby_block": "Block of Ruby" }
```

### Recipes

`data/mymod/recipes/ruby_block.json`:

```json
{
  "type": "minecraft:crafting_shaped",
  "pattern": ["RRR", "RRR", "RRR"],
  "key": { "R": { "item": "mymod:ruby" } },
  "result": { "item": "mymod:ruby_block", "count": 1 }
}
```

Supported types: `crafting_shaped`, `crafting_shapeless`, `smelting`, `blasting`,
`smoking`, `campfire_cooking`, `stonecutting`, `smithing_transform`, and
`forge:conditional` / `neoforge:conditional` wrappers.

Recipe rules that cause silent drops:

- Shaped patterns are capped at **3x3**. A wider pattern is rejected and the recipe vanishes.
- Shapeless ingredient lists are capped at **9**.
- A misspelled tag resolves to an empty candidate set; the recipe is skipped with only a
  log line. Verify every tag name exists.
- Vanilla ingredient names go through the recipe runtime's own 1.20-to-1.8 rename table,
  which is a **different** table from the block placement path. It covers common renames
  (`sugar_cane` -> `reeds`, `nether_brick` -> `netherbrick`), but if a name has no entry the
  recipe is dropped silently. Prefer 1.8 names, or your own modded ids, in ingredients.

### Textures

Real PNGs, power-of-two, 16x16 is the safe default. A scaffolder may write 1x1 transparent
placeholders — those are not shippable, they are stubs. Replace them, and tell the user you
used placeholders if you did.

Armor is a special case: the layer texture path uses a **double** underscore
(`<material>__layer_1`), which is the engine's primary probe path.

## Reusable engine systems (do not reinvent these)

When you need behaviour, look for the existing data-driven registry before proposing Java:
harvest levels, dynamic block colours, block loot tables, modern item runtime, portal
lifecycle, modern recipes, machine recipes, entity behaviour bridge, entity attributes,
explosion conversion, spawn policy, entity family sounds, Forge block hooks and property
registry, vanilla blockstate overrides, block interaction registry. A fix that names one
specific mod is a defect in this project; a data-driven entry that works for every mod is
the goal.

## What is NOT a mod authoring path

The **OmniMod Pack Loader** (`load_pack` op) is a generic fetch-verify-handoff pipe for
runtime payloads behind a registered plugin. It defines no content types and it is not how
you add items, blocks or recipes. For content, build a JAR (or a folder mod).

## Testing a mod (three phases, all required)

1. **Static:** inspect the JAR/folder. Confirm `mods.toml` parses with a literal modId,
   every declared item/block has a model, every model's texture resolves to a real PNG,
   every blockstate exists, every recipe passes the linter.
2. **Load:** stage the mod, load the world, read the log ring for translation warnings.
   Confirm the translated output appeared under `mods_translated/<world>/<modId>-<version>/`.
3. **In-game:** give yourself the item, place the block, craft the recipe, look at it.
   Confirm the icon is not the missing-texture sprite, the block renders on all faces, and
   the recipe produces the result. A mod that loads without warnings but shows nothing
   in-game has failed.

With the MCP: `omni_mod_scaffold` writes the folder, `omni_mod_inspect` lints a JAR or
folder with file:line citations, `omni_recipe_validate` lints a single recipe JSON, and
`omni_mod_add` stages the JAR into a world.

<!-- omnimod-docs-version: omnimod-agent-docs-4 -->
