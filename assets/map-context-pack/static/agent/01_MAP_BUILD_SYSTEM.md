# 01 — THE MAP BUILD SYSTEM

Everything in this file is the behaviour of the shipped engine code
(`MapDevWorkspace.java`, `MapDevSyncRuntime.java`, `MapBuilderRuntime.java`).

## 1. The coordinate system — this is Minecraft 1.8

| Axis | Range | Meaning |
|---|---|---|
| `x` | -30000000 .. 29999999 | east(+) / west(-) |
| `y` | **0 .. 255** | up(+) / down(-). There is NO negative y and NO y above 255. |
| `z` | -30000000 .. 29999999 | south(+) / north(-) |

- `y` is the hard one. Modern Minecraft habits (`y=-60` for deepslate, `y=320` build
  limit) do not exist here. An op outside `0..255` is rejected outright.
- Void map templates put the platform at **y=64** and the spawn at **y=65**. Unless the
  user says otherwise, build upward from `y=65` and treat `y=64` as ground level.
- Boxes (`from`/`to`) are **inclusive** on both ends. A 9-wide wall from x=0 is `x: 0..8`.
  Off-by-one on this is the most common source of "the building is 1 block too big".
- Facing convention for orientation decisions: `north = -z`, `south = +z`, `east = +x`,
  `west = -x`.

## 2. Folder layout of this workspace

```
worlds/__OMNIMOD_MAP__/
  level.dat, level0/            <- the world itself. NEVER touch.
  _dev/
    AGENT_START_HERE.md           <- read first
    README.md                   <- engine-authored batch contract
    dev_manifest.json           <- workspace identity (game-owned)
    MAP_OVERVIEW.md             <- LIVING: what this map is (you own it)
    CHANGE_LOG.md              <- LIVING: every change (you own it)
    FILE_MAP.md                 <- LIVING: path index (you own it)
    agent/                     <- this knowledge pack (game-owned)
      templates/                <- copy-paste skeletons
    build/                     <- YOUR batch files: ops-0001.json, ...
    functions/                 <- YOUR map functions: *.mcfunction (GMF)
    state/
      applied.json              <- apply ledger (game-owned, never edit)
      verification/              <- YOUR test reports and scan snapshots
    link.json                   <- optional external folder link (Android SAF)
```

On Desktop the real path is `filesystem/worlds/__OMNIMOD_MAP__/_dev/`. In game,
`/omni_dev where` prints the platform-correct location.

## 3. The batch file — the only way to change the world from outside

Create a file in `build/` named `<something>.json`. Name rules: plain filename,
no `/`, no `\`, no `..`, must end in `.json`, at most 128 characters. Use a zero-padded,
sortable prefix — batches are applied in **filename sort order**, so `ops-0001.json`
applies before `ops-0002.json`. Order matters: foundation before walls, walls before roof.

```json
{
  "format": "omnimod-dev-1",
  "batch": "short-human-label",
  "ops": [
    {"op":"fill_area","block":"minecraft:stone","meta":0,"from":[0,64,0],"to":[8,64,6]},
    {"op":"place_block","block":"minecraft:torch","meta":0,"x":4,"y":66,"z":6}
  ]
}
```

`format` and `ops` are required. `batch` is a label (truncated to 64 chars); when absent
the filename is used.

## 4. The complete op vocabulary

There are exactly seven ops. Anything else is rejected at parse time and **the whole
batch fails** — one bad op means nothing in that file is applied.

| op | required fields | optional | behaviour |
|---|---|---|---|
| `place_block` | `block`, `x`, `y`, `z` | `meta` | one block |
| `fill_area` | `block`, `from` | `to`, `meta` | inclusive box; `to` defaults to `from` |
| `replace_area` | `fromBlock`, `block`, `from` | `to`, `meta` | only cells currently matching `fromBlock` |
| `set_spawn` | `pos` or `from` | | world spawn point |
| `chat` | `message` | | blue `[MapDev]` chat line, max 256 chars |
| `command` | `command` | | server command, vanilla syntax, **no leading `/`** |
| `load_pack` | `manifest` OR (`id`+`kind`+`url`) | `provider`, `ttlSeconds`, `sha256`, `sizeBytes`, `signature`, `metadata` | OmniMod Pack Loader fetch+verify+handoff |

Field shapes:

- `from`, `to`, `pos` are arrays of exactly three **integers**: `[x, y, z]`. Fractions are
  rejected. `1.0` is not an integer to this parser.
- `x`, `y`, `z` are integers.
- `block` and `fromBlock` are `namespace:path`. A bare `path` is treated as `minecraft:path`.
- `meta` is the 1.8 metadata nibble, `0..15`. **There are no blockstate strings.**
  `minecraft:oak_stairs[facing=east]` is not parsed anywhere in this engine — see
  `02_BLOCK_NAMES_AND_META.md`.

## 5. Hard limits (engine-enforced)

| Limit | Value | What happens when exceeded |
|---|---|---|
| ops per batch file | 20000 | batch rejected at parse; split it |
| bytes per batch file | 8 MB | rejected (`too_large` over the HTTP bridge) |
| blocks per single bulk op | 1,000,000 | that op logs `volume_too_large` and places nothing |
| chat message length | 256 chars | rejected |
| function files per map | 256 | extra files skipped with a log line (one pass) |
| function file size | 256 KB | that file skipped, others continue |
| batches applied per poll | 4 | the rest wait for the next poll (~2s later) |
| bridge call wall time | 10 s (main thread and server thread) | `main_thread_timeout` / `server_thread_timeout` |

## 6b. Map functions (datapack-style, no mod jar) — GMF 2026-09-04

Drop plain text function files into `_dev/functions/`:

```
# _dev/functions/load.mcfunction  (runs on EVERY world load — map init)
bossbar add map:wave "Wave"
bossbar set map:wave max 100
bossbar set map:wave players @a
team add defenders Defenders
team join defenders @a
team modify defenders color green
gamerule doDaylightCycle false
```

```
# _dev/functions/tick.mcfunction  (runs EVERY server tick — timers & wave logic)
scoreboard players add #clock timer 1
execute if score #clock timer matches 20.. run function omnimod_map__:on_second
```

Rules:

- Function id: `<map-ns>:<fileName>` — the map name folds to the namespace
  (`Monster War` → `monster_war`), file names fold spaces to `_` and lowercase
  (`Wave 2.mcfunction` → `monster_war:wave_2`).
- Files are ingested on world load and every ~2s; changed content re-ingests
  exactly once (same ledger discipline as batches).
- `<ns>:load` and `<ns>:tick` are convention hooks: load runs after every world
  load (re-arm bossbars/teams/scores — runtime state does NOT persist), tick runs
  every server tick (guarded by the vanilla `maxCommandChainLength` gamerule).
- Caps: 256 function files per map, 256 KB per file. Names are plain
  `<name>.mcfunction` (no subdirectories).
- Use `/function <ns>:<name>` and `/schedule function <ns>:<name> <time> [append|replace]`
  from batches or other functions (times: `20t` ticks, `5s` seconds, `1d` days).

## 6c. The REAL command surface for `command` ops and functions

The integrated server runs a 1.8.8 kernel PLUS the registered 1.20.1 parity
commands (MCBP round 2026-09-04 added the modern command-block modes + 6 new
commands + modern syntax for setblock/fill/clone/effect/xp/give). Verified
available (no leading `/` in ops):

| command | surface | notes |
|---|---|---|
| `bossbar` | add/get/list/remove/set (color/style/name/max/players/value/visible) | **renders on the client HUD** (stacked, tinted, notched). Empty `players` = visible to NOBODY. |
| `team` | add/empty/join/leave/list/modify/remove | 1.20.1 syntax → real 1.8 scoreboard teams. `color`+`prefix` = per-player overhead text. `collision` honestly unsupported. |
| `tag` | `<targets> add/remove/list` | entity tags via the real 1.8 players-tag engine (selectors work: `@e[type=Zombie]`). |
| `title` | title/subtitle/actionbar/times/clear/reset | **`actionbar` shows text above the hotbar** (1.20.1 parity). |
| `function` | `/function <ns>:<name>` or `#tag` | runs datapack + map functions; returns executed count. |
| `schedule` | `function <id> <time> [append\|replace]` / `clear <id>` | ticks/seconds/days; fires on the server tick. |
| `execute` | full 1.20.1 chain (as/at/positioned/in/rotated/anchored/facing/align/if/unless/store/run) + legacy 1.8 form | `if data`, `store bossbar\|storage\|entity\|score` all live. |
| `data` | get/merge/remove/modify × block/entity/storage | command storage persists per world session. |
| `random` | value/roll/sequences | vanilla 1.20.1 dash range `1-6`. |
| `return` | value/fail/run | function early-exit. |
| `scoreboard` | 1.8 full surface (objectives, players, teams, tags, display) | sidebar/list HUD works. |
| `worldborder` | 1.8 surface | invisible walls for arenas. |
| `experience` | add/set/query `<targets> <amount> [levels\|points]` | MCBP: real XP engine; modern `/xp add\|set\|query` also works. |
| `attribute` | get / base get\|set / value get / modifier add\|remove | MCBP: real 1.8 attributes — boss HP/damage/speed design (`minecraft:generic.max_health`). |
| `stopsound` | `<targets> [*\|source] [*\|sound]` | MCBP: real filtered stop of active+queued client sounds — map sound design. |
| `teammsg` (tm) | `<message>` | MCBP: message to the sender's team via real scoreboard teams. |
| `ride` | `<targets> mount <vehicle>\|dismount` | MCBP: real 1.8 mount (one rider per vehicle — engine boundary). |
| `damage` | `<targets> <amount> [minecraft:<type>] [by <entity>]` | MCBP: real attackEntityFrom (traps, boss hits, minigames). |
| `summon/give/effect/tp/gamemode/gamerule/time/weather/xp/kill/say/tellraw/playsound/particle/fill/clone/setblock/testfor/spreadplayers/trigger` | 1.8 vanilla + **modern syntax for setblock/fill/clone/effect/xp/give** | MCBP: `id[props]{nbt}` tokens, `effect give\|clear`, `xp add\|set\|query`, `give id{nbt}` all translate in-place; legacy 1.8 forms unchanged. Entity ids are 1.8 names (mods add theirs). |

**Command-block modes (MCBP):** `minecraft:repeating_command_block` (fires EVERY
tick while activated), `minecraft:chain_command_block` (fires when the block it
faces fires, same tick), `conditional=true` (runs only if the block behind last
succeeded), `auto:1b` (Always Active; impulse + auto = fires when placed via
modern setblock — the classic place-and-fire pattern). They alias onto the real
command_block + Mode NBT (skin stays 1.8). `/gamerule maxCommandChainLength`
bounds chain length (default 65536). The in-game GUI has the three vanilla
buttons: Impulse/Chain/Repeat, Conditional, Always Active.

Everything else that 1.20.1 has and this list does not mention should be treated as
**unsupported** — check the game feedback, never assume (§18.2 no silent guesses).

Practical batch sizing: keep a single batch under a few thousand ops and under a few
hundred thousand placed blocks. Large terrain work should be many sequential batches, not
one giant one — that also gives you per-stage verification points.

## 6. How a change actually reaches the world

```
you write ops-0002.json
        |
        v  (poll: every 40 server ticks ~= 2s, plus once on every world load)
MapDevSyncRuntime.drainPending()          [integrated server thread only]
        |  sort filenames, hash each file
        |  hash already in state/applied.json with the same value? -> skip
        v
MapDevWorkspace.parseBatch()   -> any invalid op fails the WHOLE file
        |
        v
per-op dispatch: MapBuilderRuntime.placeBlock / fillArea / replaceArea /
                 setSpawnPoint / chat / the vanilla command manager / pack loader
        |
        v
ledger updated (hash, appliedAtMs, ops, placed, failed) + blue [MapDev] chat line
```

Consequences you must design around:

1. **Exactly-once, by content hash.** Re-saving a file with different bytes re-applies it.
   Re-saving identical bytes does nothing. To intentionally re-run work, either change
   the content or write a new filename.
2. **Apply is asynchronous.** Expect up to ~2 seconds before your batch lands. Never
   assert results in the same breath as writing the file; poll the ledger or the world.
3. **Unloaded chunks are skipped silently.** Blocks are only written where the chunk is
   loaded. Build near the player, or teleport the player first with a `command` op
   (`tp <player> <x> <y> <z>`) at the top of the batch, then place.
4. **A parse error costs the whole file.** Validate before writing; one typo in op 900
   discards ops 1..899 too.

## 7. World templates (for reference when creating new maps)

| template | what you get |
|---|---|
| `void_single` | 1x1 grass platform at y=64 over infinite air; spawn y=65 |
| `void_platform_7x7` | 7x7 grass platform at y=64; spawn y=65 |
| `flat` | vanilla superflat |
| `default` | normal terrain generation |

Void templates only write the platform into chunk (0,0); every other chunk is pure air.
The `_dev/` workspace is provisioned for maps created through the Map Builder flow (the
void templates), which is why this folder exists.

## 8. In-game control commands

| command | effect |
|---|---|
| `/omni_dev status` | batch count, applied count, pending count + map mode |
| `/omni_dev mode` | show the map's current mode (dev / play-preview) |
| `/omni_dev mode play` | PREVIEW: every command block becomes invisible, unopenable and unbreakable — the map behaves exactly as published, while all command-block logic (impulse/repeating/chain, redstone) keeps running. The mode is PERSISTED with the map (`mapmode.json`). |
| `/omni_dev mode dev` | back to development: command blocks visible and editable again. |
| `/omni_dev apply` | force an immediate apply pass, do not wait for the poll |
| `/omni_dev where` | print the real folder path for this platform |
| `/omni_dev enable` | create the workspace if it is missing |
| `/omni_dev linkset <uri> [root]` | link an external folder (Android SAF) |
| `/omni_dev help` | the contract, as chat lines |

## 8b. The map’s two shapes — DEV and PREVIEW (dual mode)

Every map has TWO working shapes. The mode is a per-map property persisted at `worlds/<map>/mapmode.json`
(game-owned — never hand-edit it; switch it with `/omni_dev mode`, the pause-menu Map Dev screen, or
`POST /omni/mapdev/mode`):

| mode | command blocks | map mechanics | use it when |
|---|---|---|---|
| DEV (default) | visible, openable, breakable, programmable | everything live | building / editing the map |
| PLAY (preview) | invisible, unopenable, unbreakable, untargetable | **still fully live** (impulse/repeating/chain + redstone all keep running) | testing the map as a player will experience it when published |

Agent loop: build in DEV → switch to PLAY → verify the player experience (chat, screens, timers,
boss bars all still fire) → switch back to DEV to fix. Switching is instant (chunk meshes rebuild
automatically) and the mode survives world reload and game restart.

**Verification duty:** after ANY switch to PLAY, an agent must verify the map still WORKS (e.g. `POST /omni/command`
triggering a known command-block effect, or `/omni/poll` watching for the expected chat/event) — hiding
the blocks never disables them. Honest boundaries: command-block MINECARTS keep rendering (editor still
locked); light recompute near hidden blocks treats them as transparent; arrows pass through hidden blocks
(consistent with what the player sees).

## 9. Platform reality check

| platform | how you reach this folder | status |
|---|---|---|
| Desktop (LWJGL) | real directory `filesystem/worlds/__OMNIMOD_MAP__/_dev/build` | full |
| Android native | linked SAF folder synced from a computer, imported every ~15s | full |
| Web, single-thread | same as desktop logically | full |
| Web, worker mode | client-side world writes across the worker boundary are not guaranteed | partial: use `/omni_dev`, or edit while the server is stopped |

<!-- omnimod-docs-version: omnimod-agent-docs-4 -->
