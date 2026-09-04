# START HERE — AI Agent Context Pack for map `__OMNIMOD_MAP__`

You are an AI agent that has been given control over an **OmniMod** map.
OmniMod is a fork of **EaglercraftX 1.8.8** with a runtime compatibility layer for
Minecraft **Forge 1.20.1** mods. This folder (`_dev/`) is the official bridge between
you and the live game.

This pack exists so that you can work at full professional capability **with or without**
the OmniMod MCP server. If you are connected to the MCP server, you must still read
these files: they are map-specific and the MCP knowledge base is not.

## Gate 1 — read before you write anything

Read these, in this order, completely. Do not skim.

| # | File | Why |
|---|---|---|
| 1 | `agent/00_AGENT_MANDATE.md` | The working contract. Non-negotiable. |
| 2 | `MAP_OVERVIEW.md` | What this map IS and what the user WANTS. Written by agents. |
| 3 | `CHANGE_LOG.md` | Everything previous agents already did. |
| 4 | `FILE_MAP.md` | The path index. Use this to find files, do not guess. |
| 5 | `agent/01_MAP_BUILD_SYSTEM.md` | Coordinates, ops, how a change reaches the world. |
| 6 | `agent/02_BLOCK_NAMES_AND_META.md` | The #1 cause of silent failure on this engine. |
| 7 | `agent/03_DESIGN_AND_GEOMETRY.md` | How to build without distortion. |
| 8 | `agent/04_TESTING_MANDATE.md` | The verification battery you owe on every change. |
| 9 | `README.md` | The raw batch-file contract written by the game engine. |

Then, only as needed for the task at hand:

- `agent/05_AGENT_LINK_API.md` — the live HTTP bridge and the MCP tool surface.
- `agent/06_MOD_AUTHORING.md` — writing a Forge 1.20.1 mod this engine accepts.
- `agent/07_MODS_IN_THIS_MAP.md` — installing a mod into THIS map.
- `agent/08_TROUBLESHOOTING.md` — symptom to cause to fix.
- `agent/09_HANDOFF_PROTOCOL.md` — how to leave the folder for the next agent.

## Gate 2 — understand the user before you build

Building the wrong thing beautifully is a failure. Before the first block:

1. Restate the user's request as an explicit build specification: footprint, height,
   materials, orientation, origin coordinates, style, and how many of each structure.
2. Resolve every ambiguity from `MAP_OVERVIEW.md` first (the user's intent may
   already be recorded there by a previous agent). Only ask the user about things that
   genuinely cannot be inferred and that would change the build.
3. Write the specification into `MAP_OVERVIEW.md` before building, so the next
   agent inherits the intent and not just the blocks.

## Gate 3 — nothing is done until it is verified in the world

This engine **does not throw** on most mistakes. It logs and continues. A batch with a
bad block name is still recorded as `applied`. Therefore:

- After every meaningful batch, read the log ring and scan the world back.
- Run the full battery in `agent/04_TESTING_MANDATE.md`.
- Write the result into `state/verification/`.
- Then append the change to `CHANGE_LOG.md` and refresh `FILE_MAP.md`.

## Ownership of files in this folder

| File | Owner | Rule |
|---|---|---|
| `AGENT_START_HERE.md`, `agent/**`, `README.md`, `dev_manifest.json` | the game | Regenerated when missing or outdated. Your edits will be overwritten. |
| `MAP_OVERVIEW.md`, `CHANGE_LOG.md`, `FILE_MAP.md` | **you** | The game seeds them once, then never touches them. Keep them true. |
| `build/*.json` | **you** | Your batches. |
| `state/applied.json` | the game | Never edit. Editing it causes re-application. |
| `state/verification/*` | **you** | Your test evidence. |

## The one-paragraph summary of how this works

You write a JSON file into `build/`. The game polls that folder every 40 server
ticks (about 2 seconds) plus once on every world load, hashes each file, applies any file
whose hash is not in the ledger, writes the result into the ledger, and posts a blue
`[MapDev]` chat line. That is the entire loop. Everything else in this pack exists to make
sure the ops inside that JSON are correct, precise, and provably applied.

<!-- omnimod-docs-version: omnimod-agent-docs-4 -->
