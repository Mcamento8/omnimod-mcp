# 08 — TROUBLESHOOTING

Ordered by how often each one actually happens. Every entry assumes you have already read
the log ring — that is step zero for all of them.

## The batch did nothing at all

| check | meaning |
|---|---|
| Is the filename valid? | plain name, ends `.json`, no `/` `\` `..`, <=128 chars. Invalid names are skipped without comment. |
| Is it in `build/`? | files elsewhere in `_dev/` are never applied. |
| Does it parse? | one invalid op fails the WHOLE file. Look for a parse error naming your filename. |
| Is `format` exactly `"omnimod-dev-1"`? | a wrong format marker is rejected. |
| Is there an entry in the ledger? | no entry = never applied. An entry = applied, look at `placed`/`failed`. |
| Is a world loaded, and is it THIS map? | the poll only runs for the active world. |
| Did you wait ~2 s? | or run `/omni_dev apply` to force a pass. |
| Same bytes as before? | identical content is skipped by design. Change the content or the filename. |

## The batch says applied but the structure is missing

- **`unknown_block` in the log** — a 1.20 name reached the engine. Translate it
  (`02_BLOCK_NAMES_AND_META.md`). This is the single most common cause.
- **`placed` far below your estimate** — either unknown blocks, or the target chunks were
  not loaded. Teleport the player near the build with a `command` op first, then place.
- **`volume_too_large` in the log** — one op exceeded 1,000,000 blocks and placed nothing.
  Split it.
- **Nothing in the log and nothing in the world** — verify the ledger actually names your
  file. If it does not, the file was never read: re-check the filename rules.

## The structure is there but wrong

- **One block too large in every dimension** — you used `x0+w` instead of `x0+w-1`. Boxes
  are inclusive.
- **Right blocks, wrong orientation** — the meta nibble. Stairs, logs, slabs, doors all
  encode facing in meta. Probe one block, scan it back, read the real value.
- **Right shape, wrong colour** — the colour nibble, or you used the dye order instead of
  the wool order. They differ.
- **Windows and doors buried** — a later fill overwrote them. Fix the op order: shell,
  then carve, then frame.
- **Hole along the roof ridge** — too few gable courses. Courses needed is `ceil(span/2)`.
- **Roof floating above the walls** — the roof's base `y` should equal the top wall `y`,
  not top wall `y + 1`.
- **Interior is not enclosed** — a hollow box needs six explicit faces. Scan the interior
  perimeter to find the missing one.

## Bossbar / team / function problems (GMF features)

| symptom | cause | fix |
|---|---|---|
| `/bossbar` command works but no bar on the HUD | the bar's `players` list is empty (vanilla rule: visible to NOBODY) | `bossbar set <id> players @a` |
| bossbar disappeared after a world reload | bossbars are runtime state, cleared on unload (documented boundary) | put `bossbar add …` lines in `functions/load.mcfunction` so the map re-arms itself |
| `team modify … collision` rejected | honest boundary: 1.8.8 has no team collision | drop that one option; everything else works |
| `/function <ns>:x` says unknown function | wrong namespace or filename folding | id = `<map-ns>:<file>`; check `/omni_dev status` (prints the ns) |
| tick function runs but nothing happens | a line failed — check the game feedback line for that command | run the line standalone first; see `04_TESTING_MANDATE.md` |

## Bridge problems

| symptom | cause | fix |
|---|---|---|
| connection refused | Agent Link disabled, or wrong IP/port | user enables Options -> Agent Link; default port 26911 |
| `503 bridge_not_ready` | listener still binding, auto-retrying | wait a few seconds and retry |
| `bad_token` | no/wrong token | re-pair with a fresh 8-char code |
| `not_paired` | token ok, IP not paired | user opens Quick Pair; then pair |
| `locked` | 5 bad-token attempts | ~10 minute lockout; wait |
| `no_world` | at the main menu | create or enter a world |
| `world_running` | tried to create while in a world | quit first |
| `server_thread_timeout` | too much work in one call | split into smaller batches |
| `box_too_large` | scan over 64^3 | split the region |
| everything fails on Web | the HTTP bridge does not run on Web targets | use the folder bridge, or Desktop/Android |

## Mod problems

| symptom | cause | fix |
|---|---|---|
| mod staged, nothing in game | world not reloaded since staging | quit and re-enter |
| items missing from creative | models or textures failed to resolve | check `models/item/<name>.json` and that `layer0` points at a real PNG |
| missing-texture icon on an item | model did not load; fallback used the registry name as the texture path | fix the model's `parent` + `layer0` |
| block is missing-texture on every face | no `blockstates/<name>.json`, or a non-`cube_all` parent that could not resolve | add the blockstate with `variants.normal` |
| block icon is a flat sprite instead of a 3D cube | the block model's parent chain was rewritten to `item/generated` | keep the block model parent chain intact |
| recipe does nothing | tag misspelled, or a 1.20 ingredient name with no rename entry | lint the recipe; use 1.8 or modded ids |
| recipe silently absent | pattern wider than 3x3, or more than 9 shapeless ingredients | shrink it |
| mod metadata empty | `mods.toml` used `${mod_id}` from a Gradle template | hardcode the modId |
| declared GUI does not open | GUI JSON missing required top-level keys, or does not parse | lint the GUI JSON |
| asset written but never read | mixed plain VFS access with the worlds-DB VFS on a persistent world | use one root consistently |

## Engine-source problems

- **You edited `sources/**` and nothing changed.** The device runs a built artifact. You
  need a DevPatch or a rebuild. Use `/omni/devpatch/verify` with your local file hashes;
  `mismatches` means the device is not running your code and every test result is stale.
- **DevPatch verify reports `changed_since_patch` for files you just edited.** Expected —
  the patch recorded the pre-edit hash. Ship a new patch, wait for the ack, re-verify.

## When you are stuck

1. Write an `agentlog` marker, then reproduce the failure, then read `errors` since that
   marker. This isolates your failure from unrelated engine noise.
2. Reduce to the smallest failing case: one op, one block, one coordinate.
3. Check `CHANGE_LOG.md` — a previous agent may have hit exactly this and recorded
   the cause. That is what the changelog is for.
4. If you diagnose something not listed here and the cause is general, add it to
   `CHANGE_LOG.md` with the evidence so the next agent finds it.

<!-- omnimod-docs-version: omnimod-agent-docs-4 -->
