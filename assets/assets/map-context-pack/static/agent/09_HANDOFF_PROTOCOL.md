# 09 — HANDOFF PROTOCOL (the living documents)

Three files in this folder are owned by agents, not by the game. They are the reason a
second agent can pick up this map months later and be productive in minutes. Keeping them
accurate is part of every task, not an optional extra.

| file | question it answers | update cadence |
|---|---|---|
| `MAP_OVERVIEW.md` | What is this map, and what does the user want from it? | before building (the spec) and after (the result) |
| `CHANGE_LOG.md` | What has been done, by whom, why, with what proof? | append one entry per task, always |
| `FILE_MAP.md` | Where is every file? | after creating, moving or deleting ANY file |

## MAP_OVERVIEW.md — the map's identity

Required sections:

1. **Identity** — map name, template, when it was created, current state in one sentence.
2. **The user's goal** — what the user is building and why, in their terms. This is the
   most valuable section in the whole folder. Write it from what the user actually said.
3. **Current build specification** — the numeric spec table (see `03_DESIGN_AND_GEOMETRY.md`)
   for everything that exists in the map: origins, footprints, heights, materials.
4. **Coordinate conventions for this map** — where the origin is, ground level `y`, which
   direction is the "front", where the build area ends. Without this the next agent will
   build over your work.
5. **Mods in this map** — each mod, what it adds, why it is here.
6. **Open items** — what the user asked for that is not built yet, and known defects.
7. **Do not touch** — regions or files that must not be modified, and why.

Rewrite sections when they become wrong. This file describes the present, not the history.
If a previous agent misunderstood the user, correct the section, and record the correction
in the changelog rather than silently rewriting the past.

## CHANGE_LOG.md — append-only history

Newest entry at the bottom. Never delete or rewrite an existing entry; if it is wrong,
append a correction that cites evidence. One entry per task, with this shape:

```markdown
## 2026-01-15 14:30 — Built the market square

**Agent:** <your model/tool name>
**Requested:** "a market square with four stalls in the middle of the village"
**Interpretation:** 15x15 cobblestone plaza centred on x=0,z=0 at y=64; four 3x3
open-sided stalls at the plaza corners, oak frame, wool awnings, 2-block gap from the edge.

### Batches
| file | ops | placed | failed | what |
|---|---|---|---|---|
| ops-0012.json | 3 | 225 | 0 | plaza floor |
| ops-0013.json | 28 | 196 | 0 | four stall frames |
| ops-0014.json | 16 | 64 | 0 | awnings + lighting |

### Blocks used (translated)
cobblestone(0), planks(0) [oak], log(0) [oak upright], wool(14) [red], torch(0)

### Verification
- Ledger: all three batches applied, failed=0.
- Scan 8 corners of the plaza: cobblestone at all 8. PASS
- Scan one block outside each plaza face: air. PASS (no overrun)
- Scan stall interiors: air, lit. PASS
- Errors since marker seq 4471: none. PASS
- Negative control: scanned x=30,y=64,z=30 (outside build) -> air as expected. PASS
- Regression: re-scanned the cottage from 2026-01-12 -> intact. PASS
- Report: state/verification/2026-01-15-market-square.md

### Decisions and deviations
- User did not specify awning colour; chose red wool for contrast. Flagged to the user.
- Stall count fixed at 4 as requested; spacing derived from the 15x15 plaza.

### Notes for the next agent
- The plaza occupies x:-7..7, z:-7..7 at y=64. Do not fill over it.
- Village expansion room is to the +x side; -x is reserved for the harbour the user mentioned.
```

The **Notes for the next agent** section is what makes this file worth reading. Record why
you chose something, not just what you placed. Record dead ends too — knowing that an
approach failed and why saves the next agent from repeating it.

## FILE_MAP.md — the path index

This is the file an agent should use to find things, instead of walking the folder blindly.
It must list **every** file under `_dev/` with its path relative to the map folder,
grouped, with a one-line purpose for anything an agent authored.

Rules:

1. Update it **immediately** after creating, renaming or deleting a file. A stale file map
   is worse than none, because it will be trusted.
2. Regenerate it from the real folder contents, not from memory.
3. Include the ledger and manifest even though the game owns them, so the inventory is
   complete.
4. Note the world data folders (`level.dat`, `level0/`) as present-but-off-limits.
5. Record the timestamp of the last regeneration at the top.

With the MCP: `omni_map_filemap` regenerates this file from disk in one call. Without it,
list the directory recursively and write it out yourself.

## Verification reports

One report per task under `state/verification/`, named
`<yyyy-mm-dd>-<slug>.md`, from the template at
`agent/templates/verification-report-template.md`.

Reports hold the raw evidence: the actual numbers, the actual log lines, the actual scan
output. The changelog summarises; the report proves. Keep them both — a summary with no
underlying report is an assertion, and this project does not accept assertions.

## The closing sequence for every task

```
1  verification battery complete, all levels                (04_TESTING_MANDATE.md)
2  write state/verification/<date>-<slug>.md
3  append CHANGE_LOG.md  (batches, blocks, verification, decisions, notes)
4  update MAP_OVERVIEW.md   (spec, conventions, open items, mods)
5  regenerate FILE_MAP.md    (every file, real paths, fresh timestamp)
6  fix anything you found wrong in these documents, and note the fix in the changelog
7  report to the user: what was built, what was verified, what remains unverified
```

Step 7 matters as much as the rest. Tell the user what you proved and what you could not
prove. That honesty is what makes the next request solvable.

<!-- omnimod-docs-version: omnimod-agent-docs-4 -->
