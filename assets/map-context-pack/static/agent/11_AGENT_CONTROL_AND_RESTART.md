# 11 — LIVE AGENT CONTROL, TESTING AND MAP RESTART

You are not limited to writing files. You can **play** the map: move the player, run
commands, read the world back, click screens, and restart the whole map when a change
needs a fresh load. This file is the professional control loop.

## 1. The credential is already in this folder

`state/agentlink.json` is written by the game and
contains `{mapName, port, token, scope:"map", endpoints}`. Send it as
`Authorization: Bearer <token>` (or header `X-Agent-Token`) to `http://<device-ip>:<port>`.

- **No pairing code, no expiry, no re-pairing.** Reaching the folder *is* the proof.
- It survives world restarts, game restarts and reboots - the token lives in the map folder.
- It is **scoped to `__OMNIMOD_MAP__`**: `/omni/world/create` and `/omni/world/enter <other map>`
  are refused with `scope_violation`. Inside this map your control is complete.
- It stops ONLY when the player switches off **Map Folder Agent Access** in the game
  options. Then your calls answer `bad_token` until they switch it back on.
- With the OmniMod MCP server: `omni_map_connect {map:"__OMNIMOD_MAP__"}` does all of this in one
  call (reads the file, sets host/port/token, pings, reports whether a world is loaded,
  and can `enter` the map with `enter:true`).

## 1.1 Reaching the map from off-LAN — the public tunnel

If you are a cloud/remote agent: **the LAN address cannot be reached by you.** Do not
retry it. Read the ladder instead and use the rung that works from where you are:

```
GET <public.base>/omni/link        # or, from the device's network, /omni/link
GET <public.base>/omni/connection  # the whole bundle, rebuilt live: token + ladder + docs
```

- Read **`cloudApiBase`** first. It is either a proven public address or EMPTY; it is never
  a LAN address, because a LAN address is unreachable from you and handing one over is
  exactly what made the connection data look dead.
- `cloudApiBase` non-empty (equivalently `public.live` true) -> that is your apiBase, from
  anywhere. `public.base` being non-empty alone is NOT enough — an address that is
  published but not live is one nobody has reached, and calling it is how agents end up at
  `503 no tunnel here`.
- `cloudApiBase` empty (or `live:false` with a `staleReason`) -> **no proven tunnel is
  running**: say so plainly, stop, work from the documents you already have, and tell the
  operator to bring the tunnel up. Do not loop on the LAN address.
- `adb` works from any computer with the device attached: `adb forward tcp:26911 tcp:26911`.
- `lan` works only from the device's own Wi-Fi.
- Always bypass an HTTP proxy for these calls (`curl --noproxy '*'`), otherwise a proxy
  turns the call into a timeout that looks like a dead credential.

[LINK-TRUTH] `public.live` is measured by the GAME, not reported by an external tool: the
bridge calls `<public.base>/omni/ping` through the tunnel on a timer and demands its own
`bridgeId` back, and any request that reaches it carrying that host re-proves it for free.
A `503`, a timeout, or an answer from a different server all leave the URL unproven, and an
unproven URL is never handed to an off-LAN agent. The address is also persisted, so a game
restart does not erase it — it returns unproven and is re-proved within seconds.

## 2. The control loop (use this order)

| Step | Call | Why |
|---|---|---|
| 1 | `GET /omni/state` | Is a world loaded? Where is the player? |
| 2 | `GET /omni/worlds` | Which maps exist (only when no world runs). |
| 3 | `POST /omni/world/enter {"name":"__OMNIMOD_MAP__"}` | Load the map if it is not running. |
| 4 | write `build/*.json` (or `POST /omni/mapdev/write`) | Your change. |
| 5 | `GET /omni/mapdev/status` + `GET /omni/errors` | Did it apply? Any silent no-op? |
| 6 | `POST /omni/player {"action":"walkTo",...}` / `/omni/command` | Exercise it like a player. |
| 7 | `POST /omni/world/scan` or `/omni/world/raycast` | Verify the world, not the file. |
| 8 | `POST /omni/world/restart` | Only if the change needs a fresh load. |

Batching: `POST /omni/batch {steps:[...]}` collapses many of these into ONE round trip.
Waiting: `POST /omni/wait {until:'worldReady'|'ticks'|'log'...}` - never blind-sleep.

## 3. Testing inside the map (professional, not token)

1. **State the hypothesis** before you act ("the drawbridge raises when the lever is hit").
2. **Set the scene**: gamemode, time, weather, position (`/omni/player` teleport/look,
   `/omni/command` for `time set`, `weather clear`, `gamerule`).
3. **Act through the player**, not through block writes: `walkTo`, `useItem`, `attackBlock`,
   `clickSlot`, `interact`. Physics and hunger are real - that is the point.
4. **Observe with the world**, not with your intent: `world/scan`, `world/block`,
   `entities/nearby`, `player/inspect`, `GET /omni/logs`, `GET /omni/errors`.
5. **Switch to PLAY mode** (`POST /omni/mapdev/mode {"mode":"play"}`) and re-run the test:
   command blocks vanish but keep running - this is how the map behaves when published.
6. **Write the evidence** into `state/verification/` and append to `CHANGE_LOG.md`.

## 4. Restarting the map

`POST /omni/world/restart` (MCP: `omni_world_restart`) quits to the menu and re-enters
**the same map**, then waits until it is playable again. Use it when:

- you staged a **mod** (mods load on world start);
- the map's `<ns>:load` function must re-run (bossbars, teams, scores, schedulers);
- command-block chains or structures only initialise on world load;
- you restructured the build order and want a clean, ordered re-apply of every batch.

The restart also re-applies every pending/changed `build/*.json` and re-ingests
`functions/*.mcfunction`, so it doubles as "apply everything now".
Body: `{name?, waitForReady?=true, timeoutMs?=30000}`; response:
`{ok, world, restarted, ready, waitedMs, statusState}`.
If `ready:false`, poll `GET /omni/state` - do not assume.
A restart can only reload the map that is running; name another map and you get
`world_mismatch` (quit, then enter that map).

## 5. Failure reading

| Answer | Meaning |
|---|---|
| `bad_token` | The player turned Map Folder Agent Access off, or the file is stale. |
| `scope_violation` | You tried to act outside this map. Stay inside it. |
| `not_paired` | You used the master token, not the folder token. |
| `world_running` / `world_mismatch` | Another map is loaded; quit or restart first. |
| `server_thread_timeout` | Work too heavy - split the batch and retry. |
| `unknown_endpoint` | This build predates the endpoint; `GET /omni/help` shows the truth. |

<!-- omnimod-docs-version: omnimod-agent-docs-11 -->
