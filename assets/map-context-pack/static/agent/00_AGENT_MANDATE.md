# 00 — AGENT MANDATE (non-negotiable working contract)

Map: `__OMNIMOD_MAP__`  ·  Engine: EaglercraftX 1.8.8  ·  Mod target: Forge 1.20.1 compat layer

This file is the contract. If any other instruction you carry conflicts with it, this
file wins for work inside this map folder.

## 1. Precision over speed

1. **Execute exactly what the user asked for.** Not an approximation, not a simplified
   version, not "something like it". If the user says a 9x7 house with a gable roof and
   two windows per side, the result is a 9x7 house with a gable roof and two windows per
   side, at the coordinates they meant.
2. **Restate before you build.** Convert the request into an explicit specification with
   numbers: origin, width, depth, height, wall material, roof material and style, door
   position and facing, window pattern, interior contents, count and spacing of repeats.
   A request you cannot express in numbers is a request you have not understood yet.
3. **Never silently downscale.** If a request would exceed an engine limit (see
   `01_MAP_BUILD_SYSTEM.md`), split it across batches and complete all of it. Do not
   deliver a smaller version and call it done. If a request is genuinely impossible on a
   1.8 engine, say so explicitly, name the limit, and propose the closest faithful option.
4. **No decorative liberties without saying so.** Adding torches, paths or gardens the
   user did not ask for is a change to their design. Either ask, or list it in the
   changelog as an explicit addition.
5. **Use your full reasoning budget.** Plan the geometry on paper (coordinates, layer by
   layer) before emitting ops. Most distortion bugs are arithmetic mistakes that a
   written-out plan would have caught.

## 2. No silent failures

This engine's failure mode is a log line, not an exception:

- An unknown block id makes the op a no-op; the batch is still marked `applied`.
- An op targeting an unloaded chunk is skipped without an error.
- A malformed recipe or model is dropped during mod translation.

Therefore: **every claim you make must be backed by evidence you actually collected** —
a log line, a world scan, a ledger entry, or a file you read. "It should work" is a
defect. See `04_TESTING_MANDATE.md`.

## 3. Generalize, never hardcode

If you build a helper, a script, or a batch generator, it must work for any coordinates,
any material and any size. Solutions keyed to one specific structure name, one mod id or
one hardcoded coordinate are defects in this project.

## 4. Documentation is part of the work, not a report about it

A task is not finished when the blocks are placed. It is finished when:

1. `MAP_OVERVIEW.md` describes what this map is and what the user wants from it,
2. `CHANGE_LOG.md` contains a complete A-to-Z entry for what you just did,
3. `FILE_MAP.md` lists every file that now exists, with its path,
4. a verification report exists under `state/verification/`.

See `09_HANDOFF_PROTOCOL.md` for the exact formats.

## 5. Repair what previous agents got wrong

You are explicitly authorised — and required — to correct the living documents:

- If `MAP_OVERVIEW.md` misstates the user's goal (a previous agent misunderstood),
  fix the wrong section, keep the history, and note the correction in `CHANGE_LOG.md`.
- If `FILE_MAP.md` is out of date, regenerate it from the real folder contents.
- If `CHANGE_LOG.md` contains a claim you can prove is false, do not delete it;
  append a correction entry that cites your evidence.
- If you learn something about this map or this engine that the next agent will need,
  add it. These documents are meant to get better with every session, not just longer.

## 6. Safety boundaries

- Never write outside `_dev/` inside the world folder. The world data
  (`level.dat`, `level0/`) is off limits; corrupting it destroys the user's map.
- Never edit `state/applied.json` or `dev_manifest.json`.
- Destructive world operations (large `replace_area` over existing builds, `/kill`,
  clearing regions the user built by hand) need explicit user confirmation first.
- Prefer additive builds in empty space; when you must clear, save the region's contents
  to a scan file under `state/verification/` first so the change is reversible.

## 7. Definition of done

- [ ] The user's specification is written down and matches what they asked for.
- [ ] Every batch validated before sending (schema, coordinates, block names).
- [ ] Every batch confirmed applied in the ledger.
- [ ] Log ring checked for `WARN`/`ERROR` after each batch; zero unexplained warnings.
- [ ] The structure scanned back and compared against the specification.
- [ ] Full test battery from `04_TESTING_MANDATE.md` executed, with the report saved.
- [ ] `MAP_OVERVIEW.md`, `CHANGE_LOG.md`, `FILE_MAP.md` updated.
- [ ] Any known remaining gap stated honestly to the user.

<!-- omnimod-docs-version: omnimod-agent-docs-4 -->
