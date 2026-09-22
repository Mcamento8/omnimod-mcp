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

## Removing and replacing a mod

There is no separate delete endpoint for mods — staged mods are ordinary map files in the
`mods` root, so the general file API removes them. This is the complete lifecycle:

| what you want | how |
|---|---|
| list what is staged | `GET /omni/mapfiles/list?root=mods` (also `GET /omni/mods` for loaded ones) |
| remove a mod | `POST /omni/mapfiles/delete {"root":"mods","path":"MyMod.jar"}` |
| remove a folder mod | `POST /omni/mapfiles/delete {"root":"mods_folders","path":"MyMod"}` |
| replace a mod | remove it, then `POST /omni/mod/add` with the new bytes |
| change a mod's files | `POST /omni/mapfiles/write` into `mods_folders`, then reload |

After any of these **reload the world** (`POST /omni/world/restart`) — a staged mod is only
read at world start, exactly like installing.

## The rules that govern every change you make to this map

These are not stylistic preferences. A change that breaks one of them is a defect even when
it appears to work.

1. **General fixes only — never a fix for one mod.** Anything you change in the compat
   system must be keyed on evidence that *any* mod can present: a namespace, a resource
   path, a class name, a superclass, an interface, a method signature. If your fix only
   works because you know which mod is installed, it is a per-mod hack and it is forbidden.
   Ask "what general property of this mod's own bytes proves this?" and key on that.
2. **No invented defaults.** A value must come from the mod's own bytecode, its assets, its
   lang files, or the 1.8 vanilla equivalent. Never fill in a plausible-looking value and
   apply it to everything — a wrong default silently mislabels every other mod.
3. **No dead code.** Do not add a hook, a field or a knob that nothing reads. If you cannot
   show the line that consumes it, it does not belong in the tree.
4. **Evidence before action, evidence after.** Before: the log line, the bytecode, the
   missing asset that proves the gap. After: the log line that proves your change fired.
   A result you did not observe is not a result.
5. **Read the context first.** `GET /omni/context` returns every document of this map.
   State-changing requests answer `428 context_required` until you acknowledge the pack
   with `POST /omni/context/ack {"fingerprint": ...}`. The refusal carries the whole pack
   with it, so you can never be blocked by it — reads are never gated.
6. **Ground your work in the real Forge 1.20.1 API.** This engine emulates Forge 1.20.1 on
   a 1.8 base. Before deciding how something *should* behave, read how Forge 1.20.1
   actually defines it. If the Forge 1.20.1 sources/jars are not already on this machine,
   fetch them once (the Forge Maven `net.minecraftforge:forge:1.20.1-*` artifacts, or the
   official Forge source distribution) and keep them as your reference. Map what you find
   to the closest real 1.8 behaviour, and say in a comment when you had to approximate.

## Monitoring the logs while you work

Log evidence is mandatory, not optional. Use these in this order:

| need | endpoint |
|---|---|
| new lines since your last check | `GET /omni/logs?since=<lastSeq>` (the ring is bounded: 4096 records, oldest evicted) |
| only problems | `GET /omni/errors?since=<lastSeq>` |
| one mod's complete trail | `GET /omni/modlogs?mod=<modId>&sinceSeq=<lastPanelSeq>` |
| all mods, counted | `GET /omni/modstats` (per-mod totals + a world-level noise ledger) |
| everything, verbatim | `GET /omni/aiagent/logs_digest` (ring + Mod Logs panel + console + shaders) |
| durable copy on disk | `logs/agent_link_runtime.log`, rotated at 2 MB keeping 3 generations |

Always re-check the logs **after** you apply a change to the map — the point is to see what
your change actually did, not what you expected it to do.

<!-- omnimod-docs-version: omnimod-agent-docs-10 -->
