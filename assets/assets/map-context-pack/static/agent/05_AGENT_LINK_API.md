# 05 — AGENT LINK API AND MCP TOOL SURFACE

There are two ways to drive this map. Use both: the folder bridge to build, the live
bridge to observe and verify.

| path | needs | strengths |
|---|---|---|
| **Folder bridge** (`build/*.json`) | file access only | works on every platform, ordered, replayable, audited by the ledger |
| **Agent Link HTTP** (port 26911) | the user enables it in game | live state, player control, world scans, log reads, mod staging |

The folder bridge is how you *build*. The HTTP bridge is how you *verify*. If you only
have the folder bridge, you can still verify via `command` ops plus the log ring, but it
is slower — say so to the user and suggest enabling Agent Link.

## 1. Turning on the live bridge

The user does this in game: **Options -> Agent Link** (enable), then
**Agent Link Info -> Quick Pair Computer** to get an 8-character code. The setting and the
pairing are persisted, so this is a one-time step per computer.

Default endpoint: `http://<device-ip>:26911`.
Auth: `Authorization: Bearer <32-hex token>` (the header `X-Agent-Token` is equivalent).
Pre-auth endpoints: `GET /omni/ping` and `POST /omni/pair` only.

Failure codes worth memorising:

| code | meaning | what to do |
|---|---|---|
| `bad_token` | missing or wrong token | re-pair with a fresh code |
| `not_paired` | token fine, this IP not paired | user opens Quick Pair, you call pair |
| `locked` | 5 bad-token attempts | locked out ~10 minutes; wait |
| `bridge_not_ready` | enabled but listener still binding | wait a few seconds, retry |
| `no_world` | no world loaded | create or enter a world first |
| `world_running` | a world is active | quit to the menu before creating |
| `server_thread_timeout` | work exceeded 10 s on the server thread | split the batch |
| `main_thread_timeout` | client main thread busy 10 s | check state and errors |
| `box_too_large` | scan over 64^3 | split the region |
| `too_large` | batch over 8 MB | split the batch |
| `unknown_endpoint` | this build lacks that route | call `/omni/help` for the real catalog |

Business failures arrive as HTTP 200 with `{"ok":false,"error":...}`. Transport, auth and
routing failures use real status codes. Always inspect `ok`, never just the status.

## 2. Endpoint catalog

| method | path | purpose |
|---|---|---|
| GET | `/omni/ping` | liveness, no auth |
| POST | `/omni/pair` | `{code}` -> token, no auth |
| GET | `/omni/help` | the endpoint catalog this build actually serves |
| GET | `/omni/state` | mode, screen, world, player snapshot |
| GET | `/omni/worlds` | saved world list |
| POST | `/omni/world/create` | `{name, template?, gametype?, cheats?, seed?, mods?}` |
| POST | `/omni/world/enter` | `{name}` |
| POST | `/omni/world/quit` | back to the main menu |
| POST | `/omni/command` | `{command}` — full-privilege server command |
| POST | `/omni/player` | teleport, move, look, lookAt, give, say, attack, use, hotbar, drop, sneak, sprint, jump |
| GET | `/omni/player/inventory` | inventory, hotbar, armor with id/count/meta |
| POST | `/omni/world/scan` | `{from,to,includeBlocks?,includeEntities?,blockFilter?,maxBlocks?,maxEntities?}`; 64^3 cap |
| POST | `/omni/world/raycast` | `{distance?,origin?,direction?,includeEntities?}` |
| POST | `/omni/mod/add` | `{world?, filename, dataB64}` — stage a mod JAR |
| POST | `/omni/mapdev/write` | `{world?, filename, content}` — write a batch into `build/` |
| GET | `/omni/mapdev/status` | ledger status line |
| POST | `/omni/mapdev/mode` | `{mode:"dev"|"play"}` (or `preview`) — switch the map's dual mode; empty body = query only. `play` hides + locks every command block (map as published) while their logic keeps running. |
| POST | `/omni/chat` | `{message}` — blue `[Agent]` broadcast |
| POST | `/omni/devpatch/verify` | `{files:[{path,sha256}]}` — is the device running your source? |
| GET | `/omni/logs` | log ring: `since`, `limit`, `level`, `source`, `q` |
| GET | `/omni/errors` | `WARN`/`ERROR`/`FATAL` only |
| GET | `/omni/notifications` | grouped issue feed per source |
| POST | `/omni/agentlog` | `{message, level?}` — your own marker in the log stream |

`/omni/mapdev/write` is the only endpoint that writes a file into a world folder, and it
only writes into `_dev/build/` with a validated plain filename. The living
documents in this folder are maintained by you through direct file access, not through the
HTTP bridge.

## 3. The MCP tool surface (when the user has connected the MCP server)

The OmniMod MCP server at `mcp/` wraps all of the above and adds translation, geometry
generators, a mod scaffolder and a mod inspector.

- **Connection:** `omni_ping`, `omni_pair`, `omni_config`, `omni_state`, `omni_help`,
  `omni_logs`, `omni_errors`, `omni_notifications`, `omni_agentlog`, `omni_devpatch_verify`.
- **Worlds:** `omni_worlds`, `omni_world_create`, `omni_world_enter`, `omni_world_quit`,
  `omni_mapdev_status`.
- **Names:** `omni_block_translate`, `omni_item_translate`, `omni_block_search`.
- **Geometry:** `omni_shape_solid_box`, `omni_shape_hollow_box`, `omni_shape_cylinder`,
  `omni_shape_sphere`, `omni_shape_pyramid`, `omni_shape_gable_roof`, `omni_shape_hip_roof`,
  `omni_shape_building`, `omni_shape_line`, `omni_blueprint`.
- **Batches:** `omni_batch_validate`, `omni_batch_apply`.
- **Observation:** `omni_command`, `omni_player`, `omni_inventory`, `omni_world_scan`,
  `omni_world_raycast`, `omni_chat`.
- **Mods:** `omni_mod_add`, `omni_mod_scaffold`, `omni_mod_inspect`, `omni_recipe_validate`.
- **Map documents:** `omni_map_docs` (read this pack through the bridge),
  `omni_map_filemap` (regenerate `FILE_MAP.md`), `omni_map_changelog` (append an entry),
  `omni_map_overview` (read/update the map's purpose), `omni_map_bootstrap`
  (create the pack for a map folder you have on disk).
- **Knowledge:** `omni_knowledge`, plus `omnimod://knowledge/*` and `omnimod://registry/*`
  resources.

**If you are connected via MCP you must still read this folder's pack.** The MCP knowledge
base describes the engine; `MAP_OVERVIEW.md` and `CHANGE_LOG.md` describe *this map*, and
only the folder has those.

## 4. The canonical working loop

```
1  ping / pair                      confirm the bridge, get a token
2  state                            confirm THIS map is the loaded world
3  read the context pack            00..04 at minimum, plus the living documents
4  agentlog "START <task>"          marker so you can attribute log lines later
5  write the specification          into MAP_OVERVIEW.md before building
6  validate the batch               Level 0 checks, every op
7  write the batch                  build/ops-NNNN.json (or mapdev/write)
8  wait ~2s / /omni_dev apply       let the poll pick it up
9  mapdev status + ledger           Level 1: applied, ops, placed, failed=0
10 world scan + raycast             Level 2: geometry matches the specification
11 errors since the marker          Level 3: zero unexplained warnings
12 negative + regression controls   Level 4: prove the checks can fail
13 write the verification report    state/verification/
14 append CHANGE_LOG.md            what changed, why, evidence
15 refresh FILE_MAP.md               every new file, with its path
16 agentlog "DONE <task>"           close the marker window
```

Steps 4 and 16 cost nothing and make every later investigation possible. Do not skip them.

## 5. Engine-source edits are a different thing entirely

Nothing in this folder changes engine behaviour. If a task genuinely requires modifying
the engine (`sources/**`), that needs a DevPatch or a rebuild before the device runs your
code. Use `/omni/devpatch/verify` to compare your local file hashes against what the
running device was built from — `mismatches` means the device is NOT running your edit and
any test result you collect is about the old code.

<!-- omnimod-docs-version: omnimod-agent-docs-4 -->
