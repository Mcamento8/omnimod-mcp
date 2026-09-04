# 02 — BLOCK NAMES AND METADATA (read this before your first op)

## The problem, stated plainly

This engine's block registry is **Minecraft 1.8.8**. Modern agents think in 1.20 names.
There is **no alias table on the placement path**: `MapBuilderRuntime.resolveBlockState`
looks the id up directly in `Block.blockRegistry`. If it is not a 1.8 name, the lookup
returns null, the op is skipped with an `unknown_block` log line, and **the batch is still
recorded as applied**. You get a silently empty build.

So: `minecraft:oak_planks` places nothing. `minecraft:planks` with `meta:0` places oak planks.

If you are connected to the OmniMod MCP server, translation is automatic by default and
`omni_block_translate` / `omni_block_search` are available. **Without the MCP, translation is
your job** and this file is the reference.

## Rule 1 — variants are a metadata nibble, not a blockstate string

There is no `[facing=east]`, no `[half=top]`, no `[axis=y]` parser anywhere in this engine.
A variant is an integer `meta` from 0 to 15, passed to `Block.getStateFromMeta`.
If the meta is invalid for that block, the engine falls back to the default state (so the
block appears, but in the wrong orientation — a silent visual bug, not an error).

Common meta encodings you will need:

**Stairs** (`oak_stairs`, `stone_stairs`, `brick_stairs`, ...):
`0`=east, `1`=west, `2`=south, `3`=north (all right-side-up); add `4` for upside-down.

**Logs** (`log`, `log2`): low 2 bits = wood type, high bits = axis.
`+0` = upright (y), `+4` = east-west (x), `+8` = north-south (z), `+12` = all-bark.

**Slabs** (`stone_slab`, `wooden_slab`, ...): `+0` = bottom half, `+8` = top half.

**Doors / trapdoors / levers / buttons / torches** all encode facing in meta. When you need
an exact orientation and are unsure of the nibble, place one block, scan it back, and read
the value the engine reports before you commit to a whole batch.

## Rule 2 — the colour families are one block plus a colour nibble

Colour index order (identical for `wool`, `stained_glass`, `stained_glass_pane`,
`stained_hardened_clay`, `carpet`):

| meta | colour | meta | colour |
|---|---|---|---|
| 0 | white | 8 | light_gray |
| 1 | orange | 9 | cyan |
| 2 | magenta | 10 | purple |
| 3 | light_blue | 11 | blue |
| 4 | yellow | 12 | brown |
| 5 | lime | 13 | green |
| 6 | pink | 14 | red |
| 7 | gray | 15 | black |

So 1.20 `minecraft:red_wool` becomes `minecraft:wool` + `meta:14`.
1.20 `minecraft:light_blue_terracotta` becomes `minecraft:stained_hardened_clay` + `meta:3`.

Note: **dye items do NOT use this order.** In 1.8 all dyes are one item, `minecraft:dye`,
with its own ordering (`0`=ink sac, `1`=rose red, `2`=cactus green, `4`=lapis, `11`=dandelion
yellow, `15`=bone meal). Do not reuse the wool table for dyes.

## Rule 3 — the wood families split across two blocks

Wood index for `planks`, `leaves`, `sapling`, `wooden_slab`:
`0`=oak, `1`=spruce, `2`=birch, `3`=jungle, `4`=acacia, `5`=dark_oak.

But logs and leaves split: `log` carries oak/spruce/birch/jungle (`0..3`) and
`log2` carries acacia (`0`) and dark_oak (`1`). Same for `leaves` / `leaves2`.
So 1.20 `minecraft:acacia_log` becomes `minecraft:log2` + `meta:0`, not `log` + `meta:4`.

## Rule 4 — the rename table for the names you will actually reach for

| you will type (1.20) | send instead (1.8) | meta |
|---|---|---|
| `oak_planks` / `spruce_planks` / ... | `planks` | 0 / 1 / 2 / 3 / 4 / 5 |
| `oak_log` .. `jungle_log` | `log` | 0..3 |
| `acacia_log`, `dark_oak_log` | `log2` | 0, 1 |
| `grass_block` | `grass` | 0 |
| `dirt_path`, `grass_path` | `grass` | 0 (no path block in 1.8) |
| `coarse_dirt` | `dirt` | 1 |
| `podzol` | `dirt` | 2 |
| `stone_bricks` | `stonebrick` | 0 |
| `mossy_stone_bricks` | `stonebrick` | 1 |
| `cracked_stone_bricks` | `stonebrick` | 2 |
| `chiseled_stone_bricks` | `stonebrick` | 3 |
| `granite` / `diorite` / `andesite` | `stone` | 1 / 3 / 5 |
| `polished_granite` / `polished_diorite` / `polished_andesite` | `stone` | 2 / 4 / 6 |
| `bricks` | `brick_block` | 0 |
| `nether_bricks` | `nether_brick` | 0 |
| `terracotta` | `hardened_clay` | 0 |
| `<colour>_terracotta` | `stained_hardened_clay` | colour nibble |
| `snow_block` | `snow` | 0 |
| `snow` (the thin layer) | `snow_layer` | 0 |
| `cobweb` | `web` | 0 |
| `sugar_cane` | `reeds` | 0 |
| `lily_pad` | `waterlily` | 0 |
| `dead_bush` | `deadbush` | 0 |
| `melon` | `melon_block` | 0 |
| `carved_pumpkin` | `pumpkin` | 0 |
| `jack_o_lantern` | `lit_pumpkin` | 0 |
| `dandelion` | `yellow_flower` | 0 |
| `poppy` | `red_flower` | 0 |
| `blue_orchid` / `allium` / `azure_bluet` | `red_flower` | 1 / 2 / 3 |
| `red_tulip` / `orange_tulip` / `white_tulip` / `pink_tulip` | `red_flower` | 4 / 5 / 6 / 7 |
| `oxeye_daisy` | `red_flower` | 8 |
| `sunflower` / `lilac` / `rose_bush` / `peony` | `double_plant` | 0 / 1 / 4 / 5 |
| `tall_grass` | `double_plant` | 2 |
| `short_grass` (the 1.20 rename of `grass` the plant) | `tallgrass` | 1 |
| `fern` | `tallgrass` | 2 |
| `chiseled_sandstone` / `cut_sandstone` | `sandstone` | 1 / 2 |
| `chiseled_quartz_block` / `quartz_pillar` | `quartz_block` | 1 / 2 |
| `prismarine_bricks` / `dark_prismarine` | `prismarine` | 1 / 2 |
| `cave_air`, `void_air` | `air` | 0 |

## Rule 5 — blocks that simply do not exist here

Anything introduced after 1.8 has no 1.8 equivalent. Do not send these; pick a substitute
and tell the user what you substituted:

- concrete and concrete powder, glazed terracotta (1.12)
- all the 1.13+ ocean blocks: prismarine walls, kelp, sea pickles, blue ice, conduits
- bamboo, scaffolding, barrel, smoker, blast furnace, lantern, campfire (1.14)
- honey, beehive (1.15) · basalt, blackstone, netherite, soul soil, warped/crimson (1.16)
- copper, deepslate, amethyst, tuff, calcite, candles, dripstone, moss, azalea (1.17)
- sculk family, mangrove, mud, froglight (1.19) · cherry, bamboo blocks, suspicious sand (1.20)

Reasonable substitutions: concrete -> `stained_hardened_clay` (same colours, matte look);
deepslate -> `stone`; copper -> `hardened_clay`/`stained_hardened_clay` orange;
blackstone -> `stone` or `obsidian`; smooth basalt -> `stone`; mangrove/cherry -> the
nearest 1.8 wood family.

## Rule 6 — modded blocks pass through untouched

`mymod:custom_block` is looked up in the same `Block.blockRegistry` and works if that mod
registered it. Never translate a modded namespace. If a modded block fails to place, the
mod did not load or did not register under that exact id — check the log ring, not this table.

## The verification habit that removes all doubt

When you are unsure about a name or a meta value, do not guess across a whole build:

1. Place a single test block at a scratch coordinate away from the build.
2. Read the log ring for `unknown_block`.
3. Scan the position back and confirm the block id and meta the world actually holds.
4. Only then emit the full batch.

One probe op costs two seconds. A wrong meta across a 4000-block build costs a rebuild.

<!-- omnimod-docs-version: omnimod-agent-docs-4 -->
