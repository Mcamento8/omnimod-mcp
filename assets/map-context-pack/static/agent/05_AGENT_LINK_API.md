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

## 0. Shortcut: you are probably already authenticated

If you can read this folder, you can read `state/agentlink.json`,
which the game keeps updated with `{mapName, port, token, scope:"map"}`. Presenting that
token gives FULL control of **this map** from any IP - no pairing window, no 8-char code,
no expiry, and it keeps working across restarts. It is refused only while the player has
**Map Folder Agent Access** switched off in the game options.

```
TOKEN=$(python -c "import json;print(json.load(open('_dev/state/agentlink.json'))['token'])")
curl -H "Authorization: Bearer $TOKEN" http://<device-ip>:26911/omni/state
# or, with the MCP server:  omni_map_connect {"map":"__OMNIMOD_MAP__"}
```

Scope rule: `/omni/world/create` and `/omni/world/enter <other map>` answer
`scope_violation`. Everything inside this map is allowed, including
`POST /omni/world/restart` - see `agent/11_AGENT_CONTROL_AND_RESTART.md`.

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
| GET | `/omni/modstats` | per-mod log stats from the Mod Logs panel buffers (total/info/warn/error per mod): `world?` |
| GET | `/omni/modlogs` | ONE mod's complete panel trail (every level — exactly what the in-game Mod Logs panel shows): `mod`, `world?`, `limit?`, `level?` |
| GET | `/omni/errors` | `WARN`/`ERROR`/`FATAL` only |
| GET | `/omni/notifications` | grouped issue feed per source |
| POST | `/omni/agentlog` | `{message, level?}` — your own marker in the log stream |
| GET | `/omni/model3d/list` | [OMNI3D] registered 3D model assets + the models placed in this world (id, pos, scale, creator) |
| POST | `/omni/model3d/upload` | [OMNI3D] `{world?, name, obj\|objB64, mtl?\|mtlB64?, profile?}` — stage a 3D model (OBJ ≤ 8MB). Contract: `agent/12_OMNI_3D_MODELS.md` |
| POST | `/omni/model3d/place` | [OMNI3D] `{model, x,y,z\|pos:[x,y,z], rotY?, scale?, interaction?, attack?}` — place at a world anchor (base center) |
| POST | `/omni/model3d/configure` | [OMNI3D] `{target:nearest\|id=N, interaction?, attack?, scale?, rotY?, pos?, collision?}` |
| POST | `/omni/model3d/animate` | [OMNI3D] `{target, clip, mode?:once\|loop\|toggle\|reverse\|stop}` |
| POST | `/omni/model3d/remove` | [OMNI3D] `{target:nearest\|id=N\|all\|radius=N}` |
| GET | `/omni/model3d/profile` | [OMNI3D] `?model=<id>` — the model's full profile JSON (structure, collision, animations, interactions) |
| GET | `/omni/link` | the reachability ladder + its live health: public tunnel / LAN / adb, which one works from where you are, and why |
| POST | `/omni/link/public-url` | `{url, source?, verified?, verifiedAtMs?, ttlMs?}` — publish the public tunnel base (send `{"url":""}` to withdraw it) |
| GET | `/omni/connection` | the whole connection bundle for this map (token + reachability + guidance pack), rebuilt from live state on every call |
| POST | `/omni/link/rotate-token` | `{}` — mint a new credential for this map; the old one dies immediately (leak response) |

`/omni/mapdev/write` is the only endpoint that writes a file into a world folder, and it
only writes into `_dev/build/` with a validated plain filename. The living
documents in this folder are maintained by you through direct file access, not through the
HTTP bridge.

## 2.1 Reaching this bridge from anywhere — the public tunnel

A `192.168.*`, `10.*` or `172.16-31.*` address is a LAN address. **A LAN address is not
reachable from a cloud sandbox or from another network — that is a network fact, not a
dead token and not a wrong token.** A timeout there means you are knocking on a door that
physically is not on your street; retrying it in a loop proves nothing.

So read the ladder first and pick the rung that works FROM WHERE YOU ARE:

```
GET /omni/link            # the ladder + live health of every rung
GET /omni/connection      # the same thing as a hand-off file, rebuilt live
```

| rung | works from | how it is created |
|---|---|---|
| `public` | anywhere on the internet | a tunnel the operator's companion runs for you |
| `adb` | a computer with the device attached | `adb forward tcp:26911 tcp:26911`, then `http://127.0.0.1:26911` |
| `lan` | the device's own Wi-Fi only | nothing to set up |

Rules that stop you wasting an hour:

1. **If you are off-LAN, read `cloudApiBase` first.** It is either a proven public address
   or the empty string — it is NEVER a LAN address, because handing a cloud sandbox a LAN
   address is what produced every "the connection data is dead" report. Empty means no
   proven tunnel exists right now.
2. If `reachability.public.base` is non-empty **and** `public.live` is true, use
   `<public.base>/omni` as your apiBase and stop thinking about addresses. Non-empty alone
   is NOT enough: a published-but-not-live address is one nobody has reached, and calling
   it is how agents land on `503 no tunnel here`.
3. If `public.base` is empty (or `live` is false and `staleReason` says it went stale), no
   tunnel is running: say so plainly, do not retry the LAN address in a loop, and keep
   working from the documents you already have. Tell the operator to bring the tunnel up.
4. `live` is only true while the tunnel has been VERIFIED through itself recently (the TTL
   in `ttlMs`). A dead tunnel therefore reports `live:false` instead of advertising a
   corpse — trust the flag, it is measured, not assumed.
5. Bypass any HTTP proxy for these calls (`curl --noproxy '*'`, `NO_PROXY=<host>`). A proxy
   turns a LAN call into a timeout that looks exactly like an expired credential.

[LINK-TRUTH] Who proves the address. The GAME does, not an external companion: while a
public URL is published the bridge calls `<public.base>/omni/ping` **through the tunnel**
on a timer and demands its own `bridgeId` back, and every request that arrives carrying
that host refreshes the same proof for free. So `public.live` is measured by this process
end-to-end: an answer from a different server, a `503` from a tunnel that has closed, or
silence all leave the URL unproven. A URL nobody can prove is reported stale and is never
handed to an off-LAN agent, and the moment it answers again it becomes live by itself —
no republishing, no restart. The URL is also persisted, so restarting the game does not
erase the fixed address: it comes back unproven and is re-proved within seconds.

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

<!-- omnimod-docs-version: omnimod-agent-docs-11 -->
