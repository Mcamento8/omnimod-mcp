# 04 — TESTING MANDATE (nothing is done until it is proven)

This project's rule is absolute: **a claim without evidence is a defect.** "It should
work" is not a result. This file is the battery you owe on every change.

## Why this is not optional here

The failure modes of this engine are quiet:

| what went wrong | what you see if you do not check |
|---|---|
| unknown block id | nothing. Batch says `applied`. Structure is missing. |
| wrong meta | the block appears, in the wrong orientation or colour. |
| chunk not loaded | some of the build exists, some does not. No error. |
| off-by-one box | the structure is subtly the wrong size. |
| batch parse error | the ENTIRE file did nothing. Only a log line says so. |
| mod not translated | the world loads, the mod's content is simply absent. |
| op order wrong | a later fill buried the windows you carved. |

Every one of these is invisible unless you go and look.

## The five levels — run all of them, in order

### Level 0 — Static validation (before writing the file)

- [ ] JSON parses. `format` is `"omnimod-dev-1"`. `ops` is an array.
- [ ] Every op's `op` value is one of the seven legal names.
- [ ] Every required field per op is present (see `01_MAP_BUILD_SYSTEM.md` §4).
- [ ] Every `from`/`to`/`pos` is exactly three integers. No floats.
- [ ] Every `y` is within `0..255`. Every `x`/`z` within the coordinate range.
- [ ] Every `meta` is `0..15`.
- [ ] Every vanilla block id is a **1.8** registry name (`02_BLOCK_NAMES_AND_META.md`).
- [ ] Op count <= 20000. File size <= 8 MB.
- [ ] No single bulk op exceeds 1,000,000 blocks.
- [ ] Every `chat` message <= 256 chars.
- [ ] Op order is correct: shells before carves, carves before frames, roofs last.
- [ ] Estimated block count computed and recorded, so Level 2 has an expected number.

With the MCP: `omni_batch_validate` performs this pass and reports translations,
estimated blocks, and errors without touching the world.

### Level 1 — Application proof (did the engine accept it?)

- [ ] The file appears in `build/`.
- [ ] Within ~2 seconds (or after `/omni_dev apply`), the ledger
      `state/applied.json` has an entry for the filename.
- [ ] The ledger entry's `ops` count equals the number of ops you sent.
- [ ] The ledger entry's `placed` count is within tolerance of your estimate. A `placed`
      count far below the estimate means unknown blocks or unloaded chunks.
- [ ] The ledger entry's `failed` count is **0**. Any non-zero value must be explained
      before you continue.
- [ ] The blue `[MapDev]` chat line was posted (visible in game / in the log ring).

With the MCP: `omni_mapdev_status` returns `batches`, `applied`, `pending`.
`pending > 0` long after the write means the poll is not running — check that a world is
loaded and that this map is the active one.

### Level 2 — World-state proof (is the geometry actually there?)

This is the level agents skip and should not.

- [ ] Scan the bounding box of what you built and compare against the specification:
      correct block id AND correct meta at the sampled positions.
- [ ] Check all **8 corners** of every box you filled. Corners catch off-by-one errors
      that centre samples miss.
- [ ] Check the **edges** of every opening you carved (door jambs, window frames).
- [ ] Check **one block outside** each face of the structure is what it should be
      (usually air). This catches fills that ran one block long.
- [ ] Count non-air blocks in the region and compare to the expected total.
- [ ] For a roof: sample along the ridge line — a hole there is the classic gable bug.
- [ ] For a hollow structure: sample the interior centre and confirm it is air.
- [ ] Raycast from the intended viewing position toward the build and confirm the first
      block hit is the surface you expect (catches structures built inside terrain).

With the MCP: `omni_world_scan` (max 64x64x64 per call, hard cap 262,144 blocks — split
larger regions) and `omni_world_raycast`.
Without the MCP: use `command` ops with `testforblock <x> <y> <z> <block> [meta]` and read
the command feedback out of the log ring, or teleport the player and inspect visually.

### Level 3 — Log-ring proof (what did the engine complain about?)

- [ ] Read the log ring at `WARN` and above for the window covering your batch.
- [ ] Zero `unknown_block` lines. Any occurrence means a name you sent does not exist.
- [ ] Zero `volume_too_large` lines. Any occurrence means an op placed nothing at all.
- [ ] Zero `out_of_range` / coordinate rejections.
- [ ] Zero `command_failed` for `command` ops (and check the command feedback text).
- [ ] Zero parse errors naming your file.
- [ ] Every warning you do see is either fixed or explicitly explained in your report.

With the MCP: `omni_errors` for `WARN`+ only, `omni_notifications` for a grouped feed,
`omni_logs` with `since`/`source`/`q` filters. Use `omni_agentlog` to write a marker line
**before** each batch, then filter `since` that sequence number — this is how you attribute
log lines to your own work instead of guessing.

### Level 4 — Negative controls and regression

An all-green test run that cannot fail is not evidence. Prove your check works:

- [ ] **Negative control:** verify a position you did NOT build at and confirm the check
      reports the expected `air`/original block. If your verification reports success
      everywhere, your verification is broken, not your build.
- [ ] **Deliberate-miss control:** compare against a wrong expected value once and confirm
      the comparison fails. A comparison that always passes proves nothing.
- [ ] **Regression:** re-verify a structure from an earlier stage or an earlier session
      (see `CHANGE_LOG.md`) and confirm your new work did not overwrite it.
- [ ] **Idempotency:** confirm re-running the same unchanged batch file changes nothing
      (the ledger hash should already match and the batch should be skipped).
- [ ] **Reload:** if the change must survive a restart, quit to the menu and re-enter the
      world, then re-verify. This is the only way to prove persistence.
- [ ] **Mod-bearing maps:** after installing or changing a mod, re-verify across all three
      phases: world load, world entry, and in-game interaction with the mod's content.

## Report every run

Write one report per task into
`state/verification/<yyyy-mm-dd>-<slug>.md`,
using `agent/templates/verification-report-template.md`.

The report must contain, for each check: what you ran, the raw result, and PASS/FAIL.
Paste real numbers and real log lines. A report that says "verified" with no data is
worthless to the next agent and will be treated as an unverified change.

## Honesty clause

If you could not run a check — no bridge, Web target, no world loaded — say so explicitly
in the report and in your message to the user, and name what remains unverified. Never
describe a check you did not run. Never infer a result you did not observe. An honest
"unverified: could not scan, bridge unavailable" is useful; a fabricated PASS is a defect
that will cost the next agent hours.

<!-- omnimod-docs-version: omnimod-agent-docs-4 -->
