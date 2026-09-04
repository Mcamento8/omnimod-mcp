# MAP OVERVIEW — `__OMNIMOD_MAP__`

> **This file is owned by AI agents, not by the game.** The game created it once, empty.
> Every agent that works on this map must keep it true. If a section is wrong, fix it and
> record the correction in `CHANGE_LOG.md`. See `agent/09_HANDOFF_PROTOCOL.md`.

**Status: NOT YET WRITTEN.** The first agent to work on this map must fill in every
section below, replacing the guidance text. Leaving this file in its seeded state is a
failure of the handoff contract.

---

## 1. Identity

- **Map folder:** `__OMNIMOD_MAP__`
- **Template:** <void_single | void_platform_7x7 | flat | default | unknown>
- **Created:** <date, if known>
- **One-sentence state:** <what exists in this map right now>

## 2. The user's goal

<The most important section in this folder. What is the user building, and why? Write it
from what they actually said, in their terms, not your restatement of a generic task. If
they described a mood, a reference, or a purpose ("a medieval village for my friends to
explore"), capture that — it is what tells the next agent whether a decision fits.>

## 3. Current build specification

<Numeric spec for everything that exists. One block per structure. See
`agent/03_DESIGN_AND_GEOMETRY.md` §1 for the format.>

| structure | origin (x,y,z) | footprint | height | materials | notes |
|---|---|---|---|---|---|
| | | | | | |

## 4. Coordinate conventions for this map

- **Origin / reference point:** <e.g. the spawn platform at 0,64,0>
- **Ground level y:** <e.g. 64; build from y=65>
- **Which way is "front":** <e.g. -z is the village entrance>
- **Occupied region:** <x range, z range — do not build over this>
- **Reserved / planned region:** <where future work is meant to go>

## 5. Mods in this map

| mod | version | why it is here | content used in the build |
|---|---|---|---|
| | | | |

<Or: "none — vanilla 1.8 blocks only.">

## 6. Open items

- [ ] <requested by the user, not built yet>
- [ ] <known defect, with a pointer to the changelog entry that describes it>

## 7. Do not touch

- <regions, structures or files that must be preserved, and why>

## 8. Notes for whoever reads this next

<Anything about this map that is not obvious from the blocks: the user's preferences,
decisions they rejected, constraints they mentioned, things that looked wrong but are
intentional.>

<!-- omnimod-docs-version: omnimod-agent-docs-4 -->
