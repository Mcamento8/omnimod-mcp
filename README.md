# OmniMod MCP — Professional Map & Mod Authoring for Any AI Agent

![Version](https://img.shields.io/badge/version-1.3.0-blue)
![Tools](https://img.shields.io/badge/tools-51-green)
![Resources](https://img.shields.io/badge/resources-13-purple)
![Node](https://img.shields.io/badge/node-%3E%3D18-orange)
![License](https://img.shields.io/badge/license-MIT-lightgrey)
![Free](https://img.shields.io/badge/price-free-brightgreen)

An [MCP](https://modelcontextprotocol.io/) server that connects any AI agent
(Claude Desktop / Claude Code / Cursor / Cline / Kilo Code / Zed / Windsurf /
custom clients) to a live [OmniMod](../docs/project_map/30_AGENT_DEV_BRIDGE_PIPELINE.md)
game, gives it expert-level knowledge of the 1.8.8 engine and the Forge 1.20.1
mod-compat layer, and turns it into a professional map builder and mod author.

```
┌──────────────────┐     MCP (stdio JSON-RPC)    ┌──────────────────────┐
│ Any AI agent     │ ───────────────────────────▶│ OmniMod MCP server   │
│ (Claude, Cursor, │   tools / resources /       │   • 1.20→1.8 names   │
│  Cline, Kilo,    │   prompts                   │   • shape generators │
│  custom ...)     │ ◀───────────────────────────│   • batch builder    │
└──────────────────┘                             │   • mod scaffolder   │
                                                  │   • JAR inspector    │
                                                  │   • live game HTTP   │
                                                  │      :26911 bridge   │
                                                  └──────────┬───────────┘
                                                             │ HTTP
                                                  ┌──────────▼───────────┐
                                                  │ OmniMod game running │
                                                  │ (Desktop / Android / │
                                                  │  Web) — Agent Link   │
                                                  └──────────────────────┘
```

## Why this exists

OmniMod runs on an EaglercraftX 1.8.8 engine but accepts Forge 1.20.1 mods.
That sounds simple. It is not. The engine registers block / item names from
1.8 (`minecraft:stone`, `minecraft:planks`, `minecraft:wool` + meta 14 = red).
Modern mod authors think in 1.20 names (`minecraft:oak_planks`,
`minecraft:white_wool`, `minecraft:grass_block`).

**There is no alias table on the placement path in the engine.** Send
`minecraft:oak_planks` and the op logs `unknown_block` and silently builds
nothing. The batch is still recorded as applied. You will not see an error.

This server is the layer that closes that gap. It also gives the agent:

- Every high-level map primitive a real builder wants (cylinders, spheres,
  gable and hip roofs, gabled houses with doors and window bands, schematic
  blueprints) — each compiled into the smallest possible set of
  engine-friendly `fill_area` / `place_block` ops.
- A static knowledge base of every 1.8.8 block, every 1.8.8 item, the
  1.8-era command surface, recipe JSON keys, mod-scaffolding conventions,
  and the most common silent-failure pitfalls — every fact cited with the
  engine file:line that proves it.
- A JAR / folder inspector that lints mods against the loader's actual code
  and reports problems before they reach the device.
- A mod scaffolder that writes a complete Forge-shaped folder tree from a
  JSON spec, using the exact keys the loader reads.

## Install with ONE command (Windows, free)

Open PowerShell and paste this single command — it downloads the MCP to the
correct path (`%LOCALAPPDATA%\OmniModMCP\omnimod-mcp`), builds it, verifies
it, and registers a global `omnimod-mcp` command that works from **any
folder in any terminal**:

```cmd
powershell -NoProfile -ExecutionPolicy Bypass -c "$f=$env:TEMP+'\omnimod-install.ps1'; irm https://raw.githubusercontent.com/Mcamento8/omnimod-mcp/main/scripts/install-windows.ps1 -OutFile $f; & $f"
```

(paste as ONE line in cmd or PowerShell — downloads the installer to a temp
file and runs it; re-run any time to update)

Then, from any terminal, anywhere:

```powershell
omnimod-mcp          # prints YOUR personal connect guide (Kilo / Cline / Cursor / Claude)
omnimod-mcp doctor   # checks node, files, game bridge, token, repo links
```

> Re-run the same one-command any time to **update** to the latest version.

Alternative installs (no account, no cost):

**Windows:** double-click `install.bat`. **macOS/Linux:** run `./install.sh`.

Manual install:

```bash
cd mcp
npm install
npm run build
npm run selfcheck   # runs the in-process test battery (registry, ops, shapes, scaffold, inspect, mapdocs)
npm run e2e        # end-to-end JSON-RPC test (51 tools, 13 resources, 5 prompts)
```

The server speaks MCP over stdio. Point your client at `node dist/index.js`.
Ready-made configs for every major client live in [`examples/`](examples/)
(Claude Desktop, Claude Code, Cursor, Cline, Kilo/ZCode — plus `npx_mcp.json`
for the npm route). The engine-source mirrors are **pre-linked by default**,
so `omni_knowledge {topic:"repos"}` works with zero setup:

- Forge compat layer: <https://github.com/Mcamento8/omnimod-forge-compat>
- Command-block system: <https://github.com/Mcamento8/omnimod-command-blocks>

**Publishing:** see [PUBLISHING.md](PUBLISHING.md) for the step-by-step guide
(publish the two engine-source repositories in `repos/`, link them via env
vars, then publish the MCP itself — with the full verification battery).

**The professional map-dev master guide:** [docs/MAP_DEV_MASTER_GUIDE.md](docs/MAP_DEV_MASTER_GUIDE.md)
— served to agents as the `omni_map_guide` tool and the
`omnimod://knowledge/map-dev-guide` resource.

## Configuring your client

The server needs three env vars (all optional — they have sensible defaults):

| Env var | Default | Meaning |
|---|---|---|
| `OMNIMOD_HOST` | `127.0.0.1` | The IP / hostname of the device running OmniMod |
| `OMNIMOD_PORT` | `26911` | Agent Dev Link port (the engine default) |
| `OMNIMOD_TOKEN` | (none) | 32-hex pairing token. If unset, call `omni_pair` to obtain one. |
| `OMNIMOD_TIMEOUT_MS` | `20000` | Per-request HTTP timeout. The engine bounds game-thread work at 10s. |
| `OMNIMOD_PROJECT_ROOT` | (none) | Absolute path to the OmniMod checkout, for local JAR/docs access. |
| `OMNIMOD_WORK_DIR` | `~/.omnimod-mcp` | Where the scaffolder writes mod folders by default. |
| `OMNIMOD_AUTO_TRANSLATE_BLOCKS` | `true` | Translate 1.20→1.8 names on the way out. |
| `OMNIMOD_FORGE_COMPAT_REPO` | (none) | Public GitHub mirror of the engine's Forge 1.20.1 compat layer (see `omni_knowledge topic='repos'`). |
| `OMNIMOD_COMMAND_BLOCKS_REPO` | (none) | Public GitHub mirror of the engine's command-block / command-surface system (see `omni_knowledge topic='repos'`). |

### Claude Desktop (`claude_desktop_config.json`)

```json
{
  "mcpServers": {
    "omnimod": {
      "command": "node",
      "args": ["C:/path/to/OmniMod/mcp/dist/index.js"],
      "env": { "OMNIMOD_HOST": "192.168.1.42" }
    }
  }
}
```

### Claude Code (`.mcp.json` in your project root or `~/.claude`)

```json
{
  "mcpServers": {
    "omnimod": {
      "command": "node",
      "args": ["C:/path/to/OmniMod/mcp/dist/index.js"]
    }
  }
}
```

### Cursor (Settings → MCP → Add new global MCP server)

```json
{
  "omnimod": {
    "command": "node",
    "args": ["C:/path/to/OmniMod/mcp/dist/index.js"]
  }
}
```

### Cline (VS Code settings.json, `"cline.mcpServers"`)

```json
{
  "cline.mcpServers": {
    "omnimod": {
      "command": "node",
      "args": ["C:/path/to/OmniMod/mcp/dist/index.js"],
      "disabled": false
    }
  }
}
```

### Kilo Code (ZCode) — `~/.zcode/config.json`

Kilo Code is the original OmniMod project harness. Add the same shape to
`mcpServers`:

```json
{
  "mcpServers": {
    "omnimod": {
      "command": "node",
      "args": ["C:/path/to/OmniMod/mcp/dist/index.js"]
    }
  }
}
```

## First agent call

Once the server is connected, the agent has 51 tools (plus the full map-dev master guide: `omni_map_guide` / resource `omnimod://knowledge/map-dev-guide`). A typical first
session:

```
1. omni_ping                          -> confirm the bridge is up (pre-auth)
2. omni_pair {code: "ACDM3491"}       -> user reads the 8-char code off the device
3. omni_state                         -> confirm a world is loaded (or quit+create)
4. omni_knowledge {topic: "rules"}    -> read the non-negotiables
5. omni_map_docs {map: "my_map"}      -> fetch the per-map context pack
6. omni_blueprint { apply: true,
                    steps: [
                      { kind: "cylinder", block: "minecraft:stone",
                        center: [0,64,0], radius: 12, height: 1 },
                      { kind: "building", origin: [0,65,0], width: 9, depth: 7,
                        height: 4, wallBlock: "minecraft:cobblestone",
                        roofStyle: "gable", roofBlock: "minecraft:stone" }
                    ]}
7. omni_logs {level: "WARN"}         -> read what the engine applied
8. omni_agentlog {message: "phase 1 done"}
```

## Tool catalog

### Connection
- `omni_ping` — liveness probe (no auth)
- `omni_pair` — quick-pair with an 8-char code (no auth)
- `omni_config` — view or update host/port/token/autoTranslateBlocks
- `omni_state` — full snapshot of game state
- `omni_help` — endpoint catalog the device actually serves
- `omni_logs`, `omni_errors`, `omni_notifications` — observability
- `omni_agentlog` — write your own annotation into the log ring
- `omni_devpatch_verify` — compare source sha256 against the active DevPatch

### Worlds
- `omni_worlds`, `omni_world_create`, `omni_world_enter`, `omni_world_quit`
- `omni_mapdev_status` — apply-ledger state

### Map building
- `omni_block_translate`, `omni_item_translate`, `omni_block_search`
- `omni_shape_solid_box`, `omni_shape_hollow_box`, `omni_shape_cylinder`,
  `omni_shape_sphere`, `omni_shape_pyramid`, `omni_shape_gable_roof`,
  `omni_shape_hip_roof`, `omni_shape_building`, `omni_shape_line`
- `omni_blueprint` — compose many shape calls in one round-trip
- `omni_batch_validate`, `omni_batch_apply`

### Player & observation
- `omni_command`, `omni_player` (teleport, look, give, attack, use, ...),
  `omni_inventory`, `omni_world_scan`, `omni_world_raycast`,
  `omni_chat`

### Map development & per-map context
- `omni_map_onboard` — show all agent docs and mandatory setup for a map
- `omni_map_docs` — fetch the per-map context pack (knowledge + agent guidelines)
- `omni_map_bootstrap` — seed a map folder with agent knowledge pack
- `omni_map_status` — check map state, apply ledger, living doc status, and verdicts
- `omni_map_filemap` — regenerate FILE_MAP.md from the build folder
- `omni_map_changelog` — append to the append-only CHANGE_LOG.md or read it back
- `omni_map_overview` — patch a numbered section in MAP_OVERVIEW.md
- `omni_map_report` — write a verification report with a normalized path

### Mod authoring
- `omni_mod_add` — stage a JAR into a world
- `omni_mod_scaffold` — write a Forge-shaped mod folder from a spec
- `omni_mod_inspect` — lint a JAR or folder
- `omni_recipe_validate` — static recipe linter

### Knowledge
- `omni_knowledge` — programmatic access to the static knowledge base
- 11 MCP resources (one per knowledge topic + 1.8.8 block/item lists + per-map context pack)
- 5 MCP prompts (build a medieval village, work on a map, verify a map change, author a new mod, debug a silent no-op)

## Honest boundaries

- The bridge does NOT run on Web targets. The `_dev` folder bridge is the
  alternative on Web (`docs/project_map/30_AGENT_DEV_BRIDGE_PIPELINE.md`).
  Use the desktop / Android target for the MCP.
- The bridge does NOT encrypt. Use a trusted LAN or VPN.
- The bridge does NOT change game logic. It calls into the existing command
  manager, the existing player APIs, the existing mod-staging path. If the
  game does not understand a command you sent, you'll get
  `command_failed` back.
- The bridge does NOT run faster than the server. Every command runs on the
  integrated server thread with a 10-second latch. A heavy command will
  time out at `server_thread_timeout`.
- The bridge does NOT manage per-map agent context. Use the `omni_map_*` tools
  to bootstrap a map folder with the agent knowledge pack and track living documents
  (MAP_OVERVIEW.md, CHANGE_LOG.md, FILE_MAP.md, verification reports).

## Source layout

```
mcp/
├── src/
│   ├── index.ts          # entry point (start or selfcheck)
│   ├── selfcheck.ts      # smoke-test battery (registry, ops, shapes, scaffold, inspect, mapdocs)
│   ├── server.ts         # 51 MCP tools, 13 resources, 5 prompts
│   ├── bridge.ts         # HTTP client with error mapping
│   ├── config.ts         # env-driven runtime config
│   ├── translate.ts      # 1.20→1.8 block/item name+meta translation
│   ├── registry.ts       # 198 blocks + 187 items registered in 1.8.8
│   ├── ops.ts            # MapDev op validation + batch builder
│   ├── shapes.ts         # solidBox, cylinder, sphere, building, etc.
│   ├── scaffold.ts       # mod folder scaffolder
│   ├── inspect.ts        # mod JAR/folder inspector + problem linter
│   ├── knowledge.ts      # static facts (rules, pitfalls, commands, recipes, …)
│   └── mapdocs.ts        # per-map agent context pack and dev workspace tools
├── package.json
├── tsconfig.json
└── README.md
```

## License

MIT — see [LICENSE](LICENSE). Free for everyone, including commercial use.
The translation table was extracted from the engine's own `Blocks.java` /
`Items.java` registration calls, not from any third-party dataset. The
engine-source mirrors linked by this server carry their own mirror license —
see [omnimod-forge-compat](https://github.com/Mcamento8/omnimod-forge-compat)
and [omnimod-command-blocks](https://github.com/Mcamento8/omnimod-command-blocks).
