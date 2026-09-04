# OmniMod — Professional Map Development Master Guide

> **الغرض (بالعربية):** هذا الملف هو الدليل الاحترافي الكامل المدمج مع سيرفر OmniMod MCP.
> يمنح أي وكيل ذكاء اصطناعي قدرة واسعة واحترافية على تنفيذ الأوامر وتطوير وإنشاء المابات
> في لعبة OmniMod: سير العمل الكامل، سطح الأوامر الحقيقي بالكامل، نظام الدوال، نظام
> الوضعين (تطوير/معاينة)، أنماط تصميم الكوماند بلوك، ومنهجية التحقق والتسليم.
> اقرأ هذا الملف مرة واحدة في بداية كل جلسة قبل بناء أي ماب.

**Audience:** any AI agent (Claude, Cursor, Cline, Kilo, Zed, Windsurf, custom) connected
through the OmniMod MCP, and any human map engineer who wants the same contract in one file.

**How to load it:** `omni_map_guide` tool · resource `omnimod://knowledge/map-dev-guide` ·
compact phase summary: `omni_knowledge {topic: "mapdev"}`.

**Version:** omnimod-mcp 1.1.0 · engine docs omnimod-agent-docs-4 (GMF+MCBP+MAP-MODE rounds).

---

## 0. The engine reality (read once, never re-derive)

OmniMod is an **EaglercraftX 1.8.8 engine** with a **runtime compatibility layer for
Minecraft Forge 1.20.1 mods** (translation/asset bridge — mod Java is never executed).
Every fact below follows from that:

| Fact | Consequence |
|---|---|
| Block/item registry is **1.8.8** | 1.20 names silently no-op on the placement path. Translate first (auto-translate is ON by default; `omni_block_translate` / `omni_block_search` are the manual path). |
| Variants are a **meta nibble 0..15** | There is NO `[facing=east]` blockstate parser in ops. Stairs: 0=east,1=west,2=south,3=north,+4=upside-down. Logs: +0 y, +4 x, +8 z, +12 all-bark. Slabs: +0 bottom, +8 top. Colours (wool etc.): 0 white,1 orange,2 magenta,3 light_blue,4 yellow,5 lime,6 pink,7 gray,8 light_gray,9 cyan,10 purple,11 blue,12 brown,13 green,14 red,15 black. |
| World height is **0..255** | No negative y, no 1.18 height. Void templates put the platform at y=64, spawn y=65. |
| Command kernel is **1.8.8 + 1.20.1 parity** | Modern command surface works (see §2) but is a PARITY layer — check the game feedback, never assume. |
| Map mechanics persist via **`_dev/` + runtime state** | Batches/functions are persisted; bossbars, command storage and schedules are RUNTIME state cleared on world unload — re-arm them from `load.mcfunction`. |
| Bridge threads are **10s-latched** | Big single calls time out. Split heavy work into many small ops. |
| Ops apply **asynchronously** | The folder is polled every ~2s (40 server ticks). Never assert results in the same breath as writing. |
| Unloaded chunks are **skipped silently** | Build near the player or `tp` the player first (put the `tp` command op at the TOP of the batch). |

**Non-negotiable rules** (enforced across every system):
1. No per-map, per-mod or per-agent hardcoding — everything in this guide is generic.
2. No silent failures — read `/omni/logs` (`omni_logs` / `omni_errors`) whenever anything behaves oddly.
3. No fake tests — every claim in a report must cite a ledger line, a scan, or a log line.
4. No 1.20 vanilla block/item names in ops without translation.
5. Exactly-once by content hash — re-saving a batch file with the same bytes does nothing.

---

## 1. The 8-phase professional workflow

| # | Phase | Primary tools | One-line goal |
|---|---|---|---|
| 1 | Connect | `omni_ping` → `omni_pair` → `omni_state` | Pair with the device, confirm a world is loaded. |
| 2 | Onboard the map | `omni_map_onboard` → `omni_map_docs` | Read the per-map context pack before touching anything. |
| 3 | Build geometry | `omni_shape_*` → `omni_blueprint` → `omni_batch_validate` → `omni_batch_apply` | Place blocks through validated batches. |
| 4 | Wire mechanics | `omni_command`, `command` ops, `_dev/functions/*.mcfunction` | Command blocks, functions, timers, bossbars, teams. |
| 5 | Preview like a player | `omni_mapdev_mode {mode:"play"}` → verify → `{mode:"dev"}` | Test the map exactly as published (command blocks hidden, logic live). |
| 6 | Verify | `omni_mapdev_status`, `omni_world_scan`, `omni_world_raycast`, `omni_errors`, `omni_wait`, `omni_map_report` | Prove the build with the 3-level battery. |
| 7 | Handoff | `omni_map_changelog`, `omni_map_overview`, `omni_map_filemap`, `omni_agentlog` | Leave the map self-describing for the next agent. |
| 8 | Mod the map (optional) | `omni_mod_scaffold` → `omni_mod_inspect` → `omni_mod_add` | Stage Forge 1.20.1 mods into the map. |

---

## 2. The REAL command surface (verified, no guesses)

The integrated server runs the 1.8.8 kernel PLUS the registered 1.20.1 parity commands
(MCBP round: modern command-block modes, 6 new commands, modern syntax for
setblock/fill/clone/effect/xp/give). **Everything else 1.20.1 has that this list does not
mention must be treated as unsupported — check the game feedback, never assume.**

### 2.1 Parity commands (modern syntax that works)

| Command | Surface | Notes |
|---|---|---|
| `bossbar` | add/get/list/remove/set (color/style/name/max/players/value/visible) | **Renders on the client HUD** (stacked, tinted, notched). Empty `players` = visible to NOBODY. Runtime state — re-arm from `load.mcfunction`. |
| `team` | add/empty/join/leave/list/modify/remove | 1.20.1 syntax → real 1.8 scoreboard teams. `color`+`prefix` = per-player overhead text. `collision` honestly unsupported. |
| `tag` | `<targets> add/remove/list` | Entity tags via the real 1.8 players-tag engine. Selectors work: `@e[type=Zombie]`. |
| `title` | title/subtitle/**actionbar**/times/clear/reset | `actionbar` shows text above the hotbar (1.20.1 parity). |
| `function` | `/function <ns>:<name>` or `#tag` | Runs datapack + map functions; returns executed count. |
| `schedule` | `function <id> <time> [append\|replace]` / `clear <id>` | Ticks (`20t`), seconds (`5s`), days (`1d`); fires on the server tick. |
| `execute` | full 1.20.1 chain (as/at/positioned/in/rotated/anchored/facing/align/if/unless/store/run) + legacy 1.8 form | `if data`, `store bossbar\|storage\|entity\|score` all live. |
| `data` | get/merge/remove/modify × block/entity/storage | Command storage persists per world session (runtime state). |
| `random` | value/roll/sequences | Vanilla dash range `1-6`. |
| `return` | value/fail/run | Function early-exit. |
| `experience` | add/set/query `<targets> <amount> [levels\|points]` | Real XP engine; modern `/xp add\|set\|query` also works. |
| `attribute` | get / base get\|set / value get / modifier add\|remove | Real 1.8 attributes — boss stat design (`minecraft:generic.max_health`). |
| `stopsound` | `<targets> [*\|source] [*\|sound]` | Real filtered stop of active+queued client sounds. |
| `teammsg` (tm) | `<message>` | Message to the sender's team via real scoreboard teams. |
| `ride` | `<targets> mount <vehicle>\|dismount` | Real 1.8 mount (one rider per vehicle — engine boundary). |
| `damage` | `<targets> <amount> [minecraft:<type>] [by <entity>]` | Real attackEntityFrom — traps, boss hits, minigames. |
| `scoreboard` | 1.8 full surface (objectives, players, teams, tags, display) | Sidebar/list HUD works. |
| `worldborder` | 1.8 surface | Invisible walls for arenas. |

### 2.2 Vanilla + modernized forms

| Command | Modern form that now works | Legacy form |
|---|---|---|
| `setblock` | `/setblock <pos> <id[props]{nbt}> [destroy\|keep\|replace]` — props resolve through the real 1.8 state space; `facing`/`conditional` fold into command-block NBT; `{auto:1b}` impulse fires on placement | unchanged |
| `fill` | `/fill <from> <to> <id[props]{nbt}> [destroy\|hollow\|keep\|outline\|replace] [filter]` | unchanged |
| `clone` | `/clone <from> <to> <dest> filtered <filter> [force\|move\|normal]` (filter BEFORE mode) | unchanged |
| `effect` | `/effect give <targets> <effect> [s] [amp] [hideParticles]` · `/effect clear <targets> [effect]` | `/effect <player> <effect> ...` |
| `give` | `/give <player> <id{nbt}> [count]` | unchanged |
| `experience`/`xp` | `/xp add\|set\|query <targets> <amount> [levels\|points]` | unchanged |
| `summon/tp/gamemode/gamerule/time/weather/kill/say/tellraw/playsound/particle/testfor/spreadplayers/trigger` | 1.8 vanilla (entity ids are 1.8 names; mods add theirs) | — |

### 2.3 Command-block modes (MCBP)

Modern block ids alias onto the real 1.8 command_block + Mode NBT (the skin stays 1.8):

| Block id | Behavior |
|---|---|
| `minecraft:command_block` (impulse) | Fires once when activated (redstone/`auto`). With `{auto:1b}` (Always Active) it fires when placed via modern setblock — the classic place-and-fire pattern. |
| `minecraft:repeating_command_block` | Fires **every tick** while activated. |
| `minecraft:chain_command_block` | Fires when the block it **faces** fires, same tick. |
| `{conditional:true}` | Runs only if the block **behind** it last succeeded. |
| `/gamerule maxCommandChainLength <n>` | Bounds chain length (default 65536). |

The in-game GUI has the three vanilla buttons: Impulse/Chain/Repeat, Conditional,
Always Active.

### 2.4 In-game control commands

| Command | Effect |
|---|---|
| `/omni_dev status` | Batch count, applied, pending + map mode. |
| `/omni_dev mode` | Show the map's current mode. |
| `/omni_dev mode play` | PREVIEW: command blocks invisible/unopenable/unbreakable; logic keeps running. Persisted in `mapmode.json`. |
| `/omni_dev mode dev` | Back to development. |
| `/omni_dev apply` | Force an immediate apply pass. |
| `/omni_dev where` | Print the real folder path for this platform. |
| `/omni_dev enable` | Create the workspace if missing. |
| `/omni_dev linkset <uri> [root]` | Link an external folder (Android SAF). |

---

## 3. Map functions (datapack-style, no mod jar)

Plain text function files live in `_dev/functions/`:

```
_dev/functions/load.mcfunction   # runs on EVERY world load — map init
_dev/functions/tick.mcfunction   # runs EVERY server tick — timers & wave logic
_dev/functions/wave_1.mcfunction # your own — call by id
```

**Identity rule:** the function id is `<folded-map-ns>:<folded-file-name>` — lowercase,
spaces → underscores. The map "Monster War" gives namespace `monster_war`, so
`Wave 2.mcfunction` → `monster_war:wave_2`. `/omni_dev status` prints the exact namespace.
Refer to functions by that exact id from `/function` and `/schedule`.

**Caps:** 256 function files per map, 256 KB per file, plain `<name>.mcfunction` only
(no subdirectories). Times accept `20t` ticks, `5s` seconds, `1d` days.

**The runtime-state rule:** bossbars, command storage, schedules and function state do
NOT survive a world reload (documented engine boundary). Put every `bossbar add`,
`team add`, `scoreboard objectives add` line into `load.mcfunction` so the map re-arms
itself on every load.

---

## 4. The dual-mode system (DEV ⇄ PREVIEW)

Every map has **two working shapes**, switchable at any moment with zero negative side
effects. The mode is persisted per map at `worlds/<map>/mapmode.json` (game-owned — never
hand-edit) and survives reloads and restarts.

| Mode | Command blocks | Map mechanics | Use when |
|---|---|---|---|
| **DEV** (default) | Visible, openable, breakable, programmable + external-agent pipeline | Everything live | Building / editing |
| **PLAY** (preview) | **Invisible, unopenable, unbreakable, untargetable** | **Still fully live** — impulse/repeating/chain, redstone, functions, schedulers keep executing | Testing the map exactly as a player will experience it published |

All three switch paths go through the SAME server-thread kernel (`MapModeRuntime.setMode`):

1. Chat / command blocks: `/omni_dev mode` (aliases: `preview`; Arabic: `تطوير`, `معاينة`).
2. In-game GUI: pause menu → Map Dev Folder screen → mode toggle + live status line.
3. External AI agents (HTTP/MCP): `omni_mapdev_mode` tool → `POST /omni/mapdev/mode`
   `{"mode":"play"}` (empty body = query). Server-thread scheduled, 10s timeout.

**The agent loop:**

```
build in DEV
  → omni_mapdev_mode {mode:"play"}
  → verify the PLAYER experience (chat, screens, timers, boss bars still fire —
    hiding the blocks NEVER disables them)
  → omni_mapdev_mode {mode:"dev"}
  → fix
```

**Verification duty:** after ANY switch to PLAY, verify the map still works — trigger a
known command-block effect via `omni_command` or watch for the expected chat/event.
Switching is instant (chunk meshes rebuild automatically around every hidden command block
+ its 6 neighbors — no X-ray holes).

**Honest boundaries (documented, not hidden):**
- Command-block **minecarts** keep RENDERING in PLAY (entity path). Their editor is locked.
- Light recompute near hidden blocks treats them as transparent.
- Arrows/ray traces pass through hidden blocks (consistent with what the player sees).
- `/setblock`, `/fill`, `/give` can still PLACE command blocks during PLAY — they are
  invisible immediately; switching back to DEV reveals them. Preview is a testing shape,
  not a security boundary.

---

## 5. Command-block design patterns (professional recipes)

### 5.1 The place-and-fire starter (no redstone needed)

```
setblock 10 70 10 minecraft:command_block[facing=up]{Command:"say Round 1 — fight!",auto:1b}
```

Impulse + `auto:1b` = fires the moment it lands. Use it for one-shot setup (teleports,
gamerules, team setup) inside a batch.

### 5.2 Ticker + second clock (timers without lag)

```
setblock 12 70 10 minecraft:repeating_command_block[facing=up]{Command:"scoreboard players add #clock timer 1"}
setblock 12 70 11 minecraft:chain_command_block[facing=north,conditional=false]{Command:"execute if score #clock timer matches 20.. run function mymap:on_second"}
setblock 12 70 12 minecraft:chain_command_block[facing=north]{Command:"execute if score #clock timer matches 20.. run scoreboard players set #clock timer 0"}
```

One repeating block + chains = a 1-second heartbeat. Do per-tick work in `tick.mcfunction`
instead when you can — it is cheaper than a repeating block far from players.

### 5.3 Boss fight skeleton

```
# load.mcfunction (re-arms on every world load)
bossbar add boss "The Warden"
bossbar set boss players @a
bossbar set boss color red
scoreboard objectives add boss_hp dummy

# summon with tuned stats (real 1.8 attribute engine)
summon Zombie 20 65 20 {CustomName:"The Warden",CustomNameVisible:1b,Attributes:[{Name:generic.maxHealth,Base:200}],Health:200f}
attribute @e[type=Zombie,name=The Warden,r=5] minecraft:generic.movement_speed base set 0.35

# damage the boss from mechanisms (real attack pipeline)
damage @e[type=Zombie,name=The Warden] 10 minecraft:generic by @p
```

Track HP via `execute store result bossbar boss value run ...` or scoreboard, and mirror
it into the bossbar every second from the clock.

### 5.4 PvP arena with teams

```
team add red "Red Team"
team modify red color red
team join red @p
bossbar add score "Score"
bossbar set score players @a
```

Pair with a repeating `execute` chain that scores kills (`execute as @a run ...` +
`teammsg` for team chat).

### 5.5 Narrative with titles

```
title @a title {"text":"Chapter 1","color":"gold"}
title @a subtitle {"text":"The Awakening"}
title @a times 10 60 20
tellraw @a {"text":"[Guide] ","color":"aqua","extra":[{"text":"Follow the path north.","color":"white"}]}
title @a actionbar {"text":"Objective: reach the tower"}
```

### 5.6 Doors / locks with tags

```
tag @p add has_key
execute if entity @a[tag=has_key] setblock 30 68 30 minecraft:command_block{Command:"setblock 30 67 30 iron_door 0",auto:1b}
```

Tags persist with the player; `execute if entity @a[tag=...]` is the clean conditional.

### 5.7 Sound design

```
playsound mob.enderdragon.growl master @a 20 65 20 1.0 0.6
stopsound @a master mob.enderdragon.growl
```

---

## 6. Batches: the op vocabulary and sizing

Op types (each maps 1:1 onto a server capability): `place_block`, `fill_area`,
`replace_area`, `set_spawn`, `chat`, `command`, `load_pack`.

Caps (enforced at parse — one invalid op fails the WHOLE file):

| Cap | Value |
|---|---|
| ops per batch file | 20,000 |
| bytes per batch file | 8 MB |
| chat message length | 256 chars |
| function files per map | 256 |
| function file size | 256 KB |

Sizing guidance: keep a single batch under a few thousand ops and a few hundred thousand
placed blocks. Large terrain = many sequential batches — that also gives per-stage
verification points. **A parse error costs the whole file** — always `omni_batch_validate`
before `omni_batch_apply`.

Apply pipeline (what actually happens):

```
you write ops-0002.json
    → poll every ~2s (40 server ticks) + once on every world load
    → hash check vs state/applied.json ledger → exactly-once by content hash
    → parse (any invalid op fails the whole file)
    → per-op dispatch on the integrated server thread
    → ledger entry {hash, appliedAtMs, ops, placed, failed} + blue [MapDev] chat line
```

World templates for new maps: `void_single` (1x1 bedrock-grass platform, spawn y=65),
`void_platform_7x7` (7x7 grass), `flat` (superflat), `default` (terrain). Void templates
write only chunk (0,0) — build near the player or teleport first.

---

## 7. The verification battery (3 levels, no shortcuts)

**Level 1 — Ledger:** `omni_mapdev_status` / `omni_map_status` — every batch in the
ledger, `failed = 0`, ops/placed counts match intent.

**Level 2 — Geometry:** `omni_world_scan` all 8 corners of every box, both jambs of every
opening, the roof ridge; `omni_world_raycast` from the intended viewpoint — confirm the
first hit is the expected face. `omni_world/block` for targeted reads; `omni_wait` for
precise conditions instead of sleep-polling.

**Level 3 — Logs:** `omni_errors` since your marker (`omni_agentlog` first). Zero
`unknown_block`, zero `volume_too_large`, zero `command_failed`.

Then write the report: `omni_map_report` (goes to `state/verification/<date>-<slug>.md`).
A report without raw numbers and raw log lines is a fake report — the engine contract
forbids it.

**Dual-mode verification addendum:** after switching to PLAY, trigger a known
command-block effect and confirm it fires (e.g. `omni_command` a test trigger, then check
`/omni/events` or the chat ring). Hiding the blocks never disables them — prove it.

---

## 8. Handoff protocol (leave the map self-describing)

1. `omni_map_changelog` — every task gets an entry: title, requested, interpretation,
   batches, blocksUsed, reportPath.
2. `omni_map_overview` — keep the specification, coordinate conventions, open items,
   mods current.
3. `omni_map_filemap` — regenerate so every new file is listed.
4. `omni_agentlog { message: "DONE <task>" }`.

The next agent starts at `omni_map_onboard` — your handoff quality is their bootstrap speed.

---

## 9. Mod authoring quick path (Phase 8)

Read the **Forge compat layer repo** first (`omni_knowledge {topic:"repos"}` for the URL)
— every key the loader reads is visible there with file:line citations. Then:
`omni_mod_scaffold` (writes a Forge-shaped folder whose JSON keys the loader actually
reads) → `omni_mod_inspect` (lints against the loader's real code) → `omni_mod_add`
(stage the JAR, base64) → reload the world → `omni_logs` for ModManager lines.

Data-driven mods translate (models, blockstates, recipes, loot tables, lang, GUI JSON);
the mod's Java is never executed. Recipe JSONs: `omni_recipe_validate` before staging.

---

## 10. Pitfall quick table (full list: `omni_knowledge {topic:"pitfalls"}`)

| Symptom | Cause | Fix |
|---|---|---|
| Batch "applied" but nothing built | 1.20 block names (no alias table on the placement path) | `omni_block_translate`; keep auto-translate on |
| Blocks appear but wrong orientation | invalid meta nibble fell back to default state | place one, `omni_world/block` scan it back, read the meta, then batch |
| Bossbar invisible after `bossbar add` | empty players list = visible to NOBODY | follow with `bossbar set <id> players @a` in `load.mcfunction` |
| Bossbar/teams/storage reset after reload | runtime state cleared on world unload (documented) | re-arm everything from `load.mcfunction` |
| `Unknown function` | wrong namespace folding | `/omni_dev status` prints the exact ns; ids are `<ns>:<name>` |
| Nothing applied at all | no world loaded, or file outside `_dev/build/`, or identical hash already applied | `omni_state`; check the ledger; change content or filename |
| Region partially built | unloaded chunks skipped silently | `tp` op at the top of the batch; build near the player |
| Command did nothing | unsupported 1.20.1 command/branch | treat unlisted surface as unsupported; check feedback |
| Switched to PLAY and "map broke" | assumption — logic still runs | verify with a known trigger; hiding never disables |

---

## 11. MCP tool index (what to call, when)

| Group | Tools |
|---|---|
| Connection | `omni_ping`, `omni_pair`, `omni_config`, `omni_state`, `omni_help`, `omni_logs`, `omni_errors`, `omni_notifications`, `omni_agentlog`, `omni_devpatch_verify` |
| Worlds | `omni_worlds`, `omni_world_create`, `omni_world_enter`, `omni_world_quit` |
| Map building | `omni_block_translate`, `omni_item_translate`, `omni_block_search`, `omni_shape_solid_box`, `omni_shape_hollow_box`, `omni_shape_cylinder`, `omni_shape_sphere`, `omni_shape_pyramid`, `omni_shape_gable_roof`, `omni_shape_hip_roof`, `omni_shape_building`, `omni_shape_line`, `omni_blueprint`, `omni_batch_validate`, `omni_batch_apply` |
| MapDev state & mode | `omni_mapdev_status`, **`omni_mapdev_mode`** (dual-mode DEV⇄PLAY) |
| Per-map context pack | `omni_map_onboard`, `omni_map_docs`, `omni_map_bootstrap`, `omni_map_status`, `omni_map_filemap`, `omni_map_changelog`, `omni_map_overview`, `omni_map_report` |
| Master guide | **`omni_map_guide`** (this document) |
| Player & observation | `omni_command`, `omni_player`, `omni_inventory`, `omni_world_scan`, `omni_world_raycast`, `omni_chat` |
| Mod authoring | `omni_mod_add`, `omni_mod_scaffold`, `omni_mod_inspect`, `omni_recipe_validate` |
| Knowledge | `omni_knowledge` — topics: `identity · rules · pitfalls · commands · recipes · staging · endpoints · troubleshooting · mapdev · repos · all` |

Resources: `omnimod://knowledge/{identity,rules,pitfalls,commands,recipes,staging-paths,endpoints,troubleshooting,map-dev-guide,repos,map-context-pack}` and
`omnimod://registry/{blocks18,items18}`.

---

## 12. Engine source repositories

The two engine systems are mirrored as public repositories so any agent (or human) can
read exactly how the engine accepts mods and how the command surface works. Get the live
URLs (configurable via `OMNIMOD_FORGE_COMPAT_REPO` / `OMNIMOD_COMMAND_BLOCKS_REPO` env
vars or `omni_config`) with `omni_knowledge {topic:"repos"}`.

| Repo | Contains | Why an agent reads it |
|---|---|---|
| **Forge 1.20.1 compat layer** | ModManager (loading/translation), the compat kernel (registries, events, capabilities, recipes, rendering, loot, GUI dispatch), `net.minecraftforge` API shims, 1.20.1 `net.minecraft` API shims, mod-library shims | Author mods the engine actually accepts — every loader-read key is visible |
| **Command-block & command-surface system** | Brigadier 1.20.1 shim, 1.20.1 commands API shims, every 1.8 command implementation, the MCBP parity commands, command-block modes runtime, CommandBlockLogic/BlockCommandBlock/tile entity, dual-mode DEV/PLAY gates | Master command-block map design — the exact semantics of every command and mode |

---

## 13. Session checklist (print this in your head)

```
[ ] omni_ping / omni_state           — bridge up, world loaded
[ ] omni_map_onboard                 — read the pack for THIS map
[ ] omni_knowledge topic=rules       — engine contract fresh in context
[ ] omni_mapdev_status               — ledger state + current mode
[ ] build: validate → apply → wait   — never assert in the same breath
[ ] verify: 3-level battery          — ledger, geometry, logs
[ ] dual-mode: play → trigger → dev  — prove the published shape works
[ ] handoff: changelog/overview/filemap/agentlog
```
