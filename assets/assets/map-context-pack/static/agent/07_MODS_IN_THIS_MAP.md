# 07 — MODS IN THIS MAP (`__OMNIMOD_MAP__`)

Mods on OmniMod are staged **per world**, not globally. A mod installed into this map does
not exist in any other map. That is deliberate: it makes a map self-contained and it means
you can never break another save by experimenting here.

## The paths involved

| what | path |
|---|---|
| staged mod JAR | `mods/__OMNIMOD_MAP__/<filename>.jar` |
| folder mod source | `mods_folders/__OMNIMOD_MAP__/<name>/...` |
| translated output (engine-generated) | `mods_translated/__OMNIMOD_MAP__/<modId>-<version>/assets/<ns>/...` |
| this map's dev workspace | `worlds/__OMNIMOD_MAP__/_dev/` |

Note that the mod folders are siblings of `worlds/`, not children of this map's save
folder. Deleting the world also deletes its `mods/`, `mods_folders/` and `mods_translated/`
entries.

## Installing a mod into this map

1. **Verify the mod first.** Inspect it statically (see `06_MOD_AUTHORING.md`) before
   staging. Staging a broken mod produces a world that loads with missing content and a
   log full of translation warnings — much harder to diagnose after the fact.
2. **Stage it.** Either drop the JAR at `mods/__OMNIMOD_MAP__/<name>.jar`, or use the bridge:
   `POST /omni/mod/add` with `{world:"__OMNIMOD_MAP__", filename, dataB64}` (32 MB cap).
   With the MCP: `omni_mod_add`.
3. **Reload the world.** Mods are picked up at world start. If the world is running, quit
   to the menu and re-enter. A staged mod does nothing until the next load.
4. **Read the translation log.** After the load, check the log ring for translation
   warnings naming this mod. Confirm `mods_translated/__OMNIMOD_MAP__/<modId>-<version>/` exists
   and contains the assets you expected.
5. **Verify in-game.** Give yourself each item, place each block, craft each recipe. See
   `04_TESTING_MANDATE.md` Level 4, mod-bearing maps clause.
6. **Record it.** Add the mod to `MAP_OVERVIEW.md` (what it is and why this map needs
   it), append an entry to `CHANGE_LOG.md`, and add its paths to `FILE_MAP.md`.

## Using modded blocks in your batches

Once a mod is loaded, its blocks resolve through the same registry as vanilla ones. Use the
mod's exact namespaced id and **do not translate it**:

```json
{"op":"fill_area","block":"mymod:ruby_block","meta":0,"from":[0,65,0],"to":[4,65,4]}
```

If a modded block fails to place, the cause is almost always one of:

1. the mod is not staged into **this** map (check `mods/__OMNIMOD_MAP__/`),
2. the world was not reloaded after staging,
3. the mod registered the block under a different id than you assumed,
4. the mod's registration was skipped during translation — check the log ring.

Probe with a single `place_block` and a scan before you build anything large out of a
modded block.

## Interaction with the build order

Batches are applied on world load **and** live. If a batch places modded blocks, the mod
must already be loaded when that batch is applied. On a fresh install the safe sequence is:
stage the mod, load the world once (mod registers, batch may partially fail), fix any
failures, then re-apply the batch by changing its content or writing a new filename.

Cleaner: keep modded-block batches in separate, later-sorting files (for example
`ops-0900-modded.json`) so a mod that failed to load does not take out your vanilla
structure work.

<!-- omnimod-docs-version: omnimod-agent-docs-4 -->
