/**
 * Static OmniMod knowledge base served as MCP resources + used by prompts.
 *
 * Every fact here is grounded in either the engine source or a verified
 * pipeline doc; all citations are kept so an agent can verify with the user.
 */

export const PROJECT_IDENTITY = {
  name: "OmniMod",
  engine: "EaglercraftX 1.8.8 (the Web/TeaVM/Android client fork of Minecraft 1.8.8).",
  compat_target:
    "Runtime compatibility for Minecraft Forge 1.20.1 mods. The compat layer is a translation/asset bridge, NOT full Forge bytecode execution — the mod's Java is never run; only its JSON/assets and the data-driven parts of its behavior are bridged into the 1.8 engine.",
  platforms: ["Web (TeaVM / WASM-GC)", "Android (WebAPK + Native)", "Desktop (LWJGL debug)"],
  agentlink_port: 26911,
} as const;

export const NON_NEGOTIABLE_RULES: readonly string[] = [
  "No real rebuild to test: edits to runtime / mod-side data are picked up at the next world load. Engine source edits need a DevPatch (dev_hotpatch.py) or a rebuild — the MCP can verify with /omni/devpatch/verify before testing.",
  "No per-mod hardcoding: every fix or capability has to generalize, with a data-driven table when needed.",
  "No silent failures: every op the bridge cannot apply must log the cause (the engine does this; read /omni/logs).",
  "No fake tests: every claim must be backed by file:line or a real log line.",
  "No 1.20 vanilla block/item names in op payloads without translation. There is NO alias table on the placement path (MapBuilderRuntime.java:311-328). Use omni_block_translate / omni_block_search or rely on auto-translation, which is on by default.",
  "No blockstate strings. Variants are the 1.8 metadata nibble (0..15) via Block.getStateFromMeta. There is no `minecraft:oak_stairs[facing=east]` parser anywhere.",
  "This is a 1.8 world. y must be 0..255. There is no y<0 / y>255 (no 1.18 world height) and no Nether height tricks — nether is its own dimension but still 0..255.",
  "Engines have a 10s main-thread and 10s server-thread latch for any bridge call. Big batches time out. Split heavy work into many small ops.",
  "Bridges do not run on Web targets. Use the _dev folder bridge on the Web target (write ops-*.json into worlds/<map>/_dev/build/).",
];

export const COMMON_PITFALLS: ReadonlyArray<{
  id: string;
  title: string;
  detail: string;
  fix: string;
  cite: string;
}> = [
  {
    id: "1.20-block-name-noalias",
    title: "1.20 block names silently no-op (no alias table on the placement path).",
    detail:
      "MapBuilderRuntime.resolveBlockState() splits the id and looks it up directly in the 1.8 Block.blockRegistry. There is NO 1.20→1.8 alias table anywhere in the engine on this path. Unknown ids log unknown_block and the op continues; the batch is still recorded as applied.",
    fix: "Use omni_block_translate on every id before it goes into an op, or rely on autoTranslateBlocks (default on).",
    cite: "MapBuilderRuntime.java:311-328; MapBuilderRuntime.java:148-152; MapDevSyncRuntime.java:454-457, 472-476.",
  },
  {
    id: "meta-not-blockstate",
    title: "Blockstate strings do not work — variants are the 1.8 metadata nibble.",
    detail: "There is no [facing=east] / [half=top] / [shape=...] parser. Variants must be encoded in the integer meta (0..15) and go through Block.getStateFromMeta.",
    fix: "Use the op helper variants (line, cylinder, building) that know the meta. For ad-hoc variants, supply an explicit meta value (the engine falls back to getDefaultState() on parse exception).",
    cite: "MapBuilderRuntime.java:324-326.",
  },
  {
    id: "world-height-1.8",
    title: "y is 0..255. There is no negative y and no high Y.",
    detail: "EaglercraftX is 1.8.8. The world height is 256 (0..255). Any op with y<0 or y>255 is rejected by validPos.",
    fix: "Restrict y to 0..255. The void templates place the platform at y=64 and spawn at y=65 — keep builds in that band.",
    cite: "MapBuilderRuntime.java:90-94.",
  },
  {
    id: "modded-namespace-passthrough",
    title: "The MCP translation layer passes modded namespaces through unchanged.",
    detail: "If you set a block id with namespace mymod:, the layer will not try to translate it — the bridge lets the engine look it up. That is what you want for a modded block; the mod owns the registry entry.",
    fix: "Use your mod's exact namespace for any modded id.",
    cite: "translate.ts:resolve()",
  },
  {
    id: "texture-singular-vs-plural",
    title: "asset path singular vs plural for textures (items/ vs item/).",
    detail: "The bridge accepts BOTH 'items' (legacy) and 'item' (current) for texture paths, but the model JSON `textures.layer0` must point to `mymodid:item/<name>`. The two are not interchangeable — model layer0 must be singular.",
    fix: "Use 'mymodid:item/<filename>' in layer0; place the .png at assets/mymodid/textures/item/<filename>.png.",
    cite: "01_ITEM_MODEL_PIPELINE.md:28-32; 05_COMMON_PITFALLS.md:17-27.",
  },
  {
    id: "textures-derivation",
    title: "If the model cannot be loaded the engine bakes the registry name as the texture path.",
    detail: "When loadItemModel returns null, createFallbackItemModel produces a model whose texture is the registry name. That looks like 'minecraft:wool' but the .png does not exist there; you see the missing-texture icon.",
    fix: "Always ship a model that resolves cleanly (parent + layer0). For blocks, prefer block/cube_all or block/cube_column so the engine does not fall back.",
    cite: "01_ITEM_MODEL_PIPELINE.md:112-117.",
  },
  {
    id: "armor-double-underscore",
    title: "Armor texture path is __layer_N (double underscore) for hand-authored paths.",
    detail: "The class scan normalizes _armor_ and probes BOTH <m>_layer_N AND <m>__layer_N. Pick the right one for your hand-authored mod.",
    fix: "Use the double-underscore form <material>__layer_<n> to match the engine's primary path.",
    cite: "05_COMMON_PITFALLS.md:40-58.",
  },
  {
    id: "block-item-parent",
    title: "Block-item parent chain must be preserved if the block is bakeable.",
    detail: "If a model resolves to a vanilla block model the parent chain is preserved and you get the 3D icon. A wrong rewrite yields a flat sprite.",
    fix: "Don't rewrite a block's parent to item/generated; the engine's blockParentChainRendersAsVanillaBlock guard handles this.",
    cite: "03_BLOCK_RENDERING_PIPELINE.md:40-51.",
  },
  {
    id: "tag-misspelling",
    title: "Recipe tag misspellings silently yield no candidates.",
    detail: "An unknown tag resolves to an empty set, the recipe is skipped, and only a log line tells you. ModernRecipeRuntime does not throw.",
    fix: "Use omni_recipe_validate on every recipe JSON before publishing the mod.",
    cite: "27_RECIPE_CRAFTING_PIPELINE.md:66-78.",
  },
  {
    id: "pattern-3x3",
    title: "Crafting patterns wider than 3x3 are rejected.",
    detail: "addShapedRecipe rejects width>3 || rows.size()>3 and the recipe is dropped.",
    fix: "Keep crafting patterns within 3x3. For larger constructs, compose recipes in a CraftingTable sequence.",
    cite: "ModernRecipeRuntime.java:747-749.",
  },
  {
    id: "toml-template",
    title: "mods.toml using Gradle templates (${mod_id}) breaks metadata extraction.",
    detail: "The literal token ${mod_id} becomes the modId and the namespace guess fails; zero elements are extracted.",
    fix: "Hardcode the modId in the [[mods]] block. Do not template it.",
    cite: "05_COMMON_PITFALLS.md:135-139.",
  },
  {
    id: "vfs-mixing",
    title: "Mixing VFile2 with WorldsDB.newVFile in persistent worlds causes silent asset miss.",
    detail: "Persistent worlds use WorldsDB.newVFile for assets. Writing via plain VFile2 and reading via WorldsDB.newVFile is invisible.",
    fix: "In mods that read or write mod assets, always go through WorldsDB.newVFile on persistent worlds. Use the same IFile root everywhere.",
    cite: "09_VFS_AND_RESOURCE_SYSTEM.md:50-54.",
  },
  {
    id: "opl-not-the-mod-authoring-target",
    title: "OmniMod Pack Loader (OPL) is NOT a mod authoring path.",
    detail: "OPL is a generic fetch->verify->handoff pipe. It defines NO content types. Use it only for runtime-fetched opaque payloads behind a custom OmniPackPlugin. For items/blocks/recipes, build a JAR.",
    fix: "Build a JAR dropped in mods/ for any mod with content. Use OPL only for runtime content pack feeds.",
    cite: "OmniPackPlugin.java:16-31; 36_OMNIMOD_PACK_LOADER.md:1.",
  },
  {
    id: "bossbar-empty-players-invisible",
    title: "/bossbar with an empty players list renders NOTHING on the HUD.",
    detail: "Vanilla semantics: a bar tracks zero players until `bossbar set <id> players <selector>` runs. The data model exists and the command succeeds either way — the invisibility is silent.",
    fix: "Always follow `bossbar add` with `bossbar set <id> players @a` (put both lines in _dev/functions/load.mcfunction).",
    cite: "BossBarRuntime.java (players set + client filter); ClientBossBarRuntime.isVisibleTo.",
  },
  {
    id: "runtime-parity-state-not-persisted",
    title: "Bossbars, scheduled tasks and command storage do NOT survive a world reload.",
    detail: "FunctionRuntime/BossBarRuntime/ScheduleRuntime/CommandStorageRuntime are cleared on world unload (ModernRegistry cascade). Re-entering the map starts them empty — by design (documented §19.8 boundary).",
    fix: "Put every `bossbar add`, `team add`, `scoreboard objectives add` line into _dev/functions/load.mcfunction — it runs automatically on every world load (vanilla datapack load convention).",
    cite: "MapDevSyncRuntime.onWorldLoaded (runMapInitFunction); ModernRegistry.clearDynamicRegistrations cascade.",
  },
  {
    id: "preview-mode-not-a-security-boundary",
    title: "PLAY (preview) mode hides command blocks but never disables them.",
    detail: "The dual-mode system (MapModeRuntime) gates RENDERING (getRenderType -1), targeting (canCollideCheck false), editing (tryOpenEditCommandBlock false) and breaking (removeBlock refuses) in PLAY mode — but the command-block tick loop, redstone and map functions keep executing exactly as when published. Switching is instant (chunk meshes rebuild automatically) and persisted at worlds/<map>/mapmode.json. Honest boundaries: command-block MINECARTS still render (editor locked); light recompute near hidden blocks treats them as transparent; arrows pass through hidden blocks.",
    fix: "Use the agent loop: build in DEV -> switch to PLAY (omni_mapdev_mode or POST /omni/mapdev/mode) -> verify the PLAYER experience (effects still fire) -> switch back to DEV to fix. After ANY switch to PLAY, verify the map still WORKS (trigger a known command-block effect via /omni/command). /setblock /fill /give can still PLACE command blocks in PLAY — they are invisible immediately.",
    cite: "MapModeRuntime.java (setMode kernel, mapmode.json persistence); ClientMapModeRuntime.java (re-render); docs/project_map/37_MAP_MODE_PIPELINE.md.",
  },
  {
    id: "map-function-namespace-folding",
    title: "Map function ids fold the map name — 'Monster War' functions are monster_war:*.",
    detail: "Map-level .mcfunction files live in _dev/functions/. Their id is <folded-map-ns>:<folded-file-name>: lowercase, spaces -> underscores. Referring to them by any other casing/name fails with 'Unknown function'.",
    fix: "Run `/omni_dev status` to read the exact namespace, and call functions as <ns>:<name> from /function and /schedule.",
    cite: "MapDevWorkspace.functionNamespace/functionIdFor; MapDevSyncRuntime.drainFunctions.",
  },
];

export const COMMAND_GUIDE: ReadonlyArray<{ cmd: string; syntax: string; note: string }> = [
  { cmd: "setblock", syntax: "/setblock <x> <y> <z> <blockId> [meta]", note: "id is the 1.8 registry name. Use omni_block_translate before passing a 1.20 name." },
  { cmd: "fill", syntax: "/fill <x1> <y1> <z1> <x2> <y2> <z2> <blockId> [meta] [destroy|hollow|keep|outline]", note: "Hard cap 1,000,000 blocks per call; split bigger regions." },
  { cmd: "clone", syntax: "/clone <x1> <y1> <z1> <x2> <y2> <z2> <dx> <dy> <dz> [masked|replace|filtered] [force|move|normal]", note: "Useful for stamping one design into many locations." },
  { cmd: "summon", syntax: "/summon <entityId> [x y z] [nbt]", note: "Entity ids are 1.8 names. Many 1.20 mobs are unknown to this engine." },
  { cmd: "give", syntax: "/give <player> <itemId> [count] [meta] [dataTag]", note: "id is the 1.8 registry name." },
  { cmd: "tp", syntax: "/tp <target> <x> <y> <z> | /tp <target> <otherPlayer>", note: "Accepts coordinates and player names." },
  { cmd: "gamerule", syntax: "/gamerule <rule> [value]", note: "Use `keepInventory true` for testing." },
  { cmd: "time", syntax: "/time set <day|night|noon|midnight> | /time add <value>", note: "Integer ticks; 24000 = 1 day." },
  { cmd: "weather", syntax: "/weather <clear|rain|thunder> [duration in s]", note: "" },
  { cmd: "effect", syntax: "/effect <give|take> <player> <effect> [seconds] [amplifier] [hideParticles]", note: "" },
  { cmd: "particle", syntax: "/particle <name> [x y z] [dx dy dz] [speed] [count]", note: "" },
  { cmd: "playsound", syntax: "/playsound <sound> <player> [x y z] [volume] [pitch] [minVolume]", note: "" },
  { cmd: "data", syntax: "/data get|merge|remove|modify ...", note: "Parity over NbtPathCore + command storage. data if/store reach bossbar|storage|entity|score through the /execute parity layer." },
  { cmd: "execute", syntax: "/execute <as|at|positioned|in|rotated|anchored|facing|align|if|unless|store|run> ...", note: "Full 1.20.1 subcommand chain PLUS the 1.8 legacy selector form." },
  { cmd: "omni_dev", syntax: "/omni_dev <status|mode [dev|play]|enable|apply|where|linkset|help>", note: "Game-side command to inspect and trigger the _dev folder bridge. status prints the map function namespace AND the current map mode. `mode` (no arg) queries; `mode dev` = full editing; `mode play` (alias preview, Arabic: تطوير/معاينة) = PREVIEW: every command block becomes invisible/unopenable/unbreakable while all command-block logic (impulse/repeating/chain, redstone, functions) keeps running — the published-map testing shape. Mode is persisted per map in mapmode.json and survives reloads." },
  { cmd: "bossbar", syntax: "/bossbar add|get|list|remove|set ...", note: "1.20.1 parity, RENDERS on the client HUD (stacked/tinted/notched). Empty players list = visible to NOBODY. Cleared on world unload — re-arm from _dev/functions/load.mcfunction." },
  { cmd: "team", syntax: "/team add|empty|join|leave|list|modify|remove ...", note: "1.20.1 syntax → real 1.8 scoreboard teams. color+prefix give per-player overhead text. 'collision' honestly unsupported (no 1.8.8 equivalent)." },
  { cmd: "tag", syntax: "/tag <targets> add|remove|list <name>", note: "1.20.1 syntax → real 1.8 players-tag engine. Selectors work (@e[type=Zombie])." },
  { cmd: "title", syntax: "/title <player> title|subtitle|actionbar|times|clear|reset <json>", note: "actionbar shows text above the hotbar (1.20.1 parity via chat type 2)." },
  { cmd: "function", syntax: "/function <ns>:<name> | #<tag>", note: "Runs datapack AND map-level functions (_dev/functions/*.mcfunction). Map ns = folded map name — /omni_dev status prints it." },
  { cmd: "schedule", syntax: "/schedule function <id> <time> [append|replace] | clear <id>", note: "Ticks (20t), seconds (5s), days (1d). Fires on the server tick." },
  { cmd: "random", syntax: "/random value|roll <range>", note: "Vanilla dash range (1-6). Deterministic sequences." },
  { cmd: "return", syntax: "/return value|fail|run ...", note: "Function early-exit; rejected outside functions." },
  { cmd: "scoreboard", syntax: "/scoreboard objectives|players|teams|tags ...", note: "Full 1.8 surface. Sidebar/list display works. Pair with /team for modern syntax." },
  { cmd: "worldborder", syntax: "/worldborder set|center|add|warning ...", note: "1.8 surface — invisible walls for arenas." },
  { cmd: "repeating_command_block", syntax: "/setblock <pos> minecraft:repeating_command_block[facing=up,conditional=false]{Command:\"...\",auto:1b}", note: "MCBP 2026-09-04: full modern command-block modes. repeating = fires EVERY tick while activated; chain = fires when the block behind it fires (same tick); conditional = runs only if the block behind last succeeded; auto = Always Active. Aliases onto the real command_block + Mode NBT — skin stays 1.8. GUI has Impulse/Chain/Repeat + Conditional + Always Active buttons." },
  { cmd: "maxCommandChainLength", syntax: "/gamerule maxCommandChainLength <n>", note: "MCBP: bounds command-block chain length (default 65536, vanilla 1.12+)." },
  { cmd: "setblock-modern", syntax: "/setblock <pos> <id[props]{nbt}> [destroy|keep|replace]", note: "MCBP: modern block syntax now works — props resolve through the real 1.8 state space (unknown ones drop honestly), facing/conditional fold into command-block NBT, {auto:1b} impulse fires on placement (1.12+ pattern). Old 1.8 syntax still works unchanged." },
  { cmd: "fill-modern", syntax: "/fill <from> <to> <id[props]{nbt}> [destroy|hollow|keep|outline|replace] [filter]", note: "MCBP: modern arg order + replace-filter form." },
  { cmd: "clone-modern", syntax: "/clone <from> <to> <dest> filtered <filter> [force|move|normal]", note: "MCBP: modern filtered order (filter BEFORE clone mode) translated to the 1.8 order." },
  { cmd: "experience", syntax: "/experience add|set|query <targets> <amount> [levels|points]", note: "MCBP: real addExperience/addExperienceLevel engine. Modern /xp add|set|query also accepted. set points ≈ total points (engine boundary)." },
  { cmd: "effect-modern", syntax: "/effect give <targets> <effect> [s] [amp] [hideParticles] | /effect clear <targets> [effect]", note: "MCBP: 1.20.1 subcommand form → real 1.8 effect engine. minecraft:speed names, infinite→1.8 cap." },
  { cmd: "attribute", syntax: "/attribute <target> <attr> get|base get|base set <v>|value get|modifier add|remove <uuid>", note: "MCBP: real 1.8 attribute engine (minecraft:generic.max_health → generic.maxHealth). Boss stat design." },
  { cmd: "stopsound", syntax: "/stopsound <targets> [*|master|music|block|hostile|neutral|player|ambient|weather|record|voice] [*|sound]", note: "MCBP: real filtered stop on the client sound engine — map sound design." },
  { cmd: "teammsg", syntax: "/teammsg <message> | /tm <message>", note: "MCBP: message to the sender's team (real scoreboard teams)." },
  { cmd: "ride", syntax: "/ride <targets> mount <vehicle> | dismount", note: "MCBP: real 1.8 mount engine (one rider per vehicle — engine boundary)." },
  { cmd: "damage", syntax: "/damage <targets> <amount> [minecraft:<type>] [by <entity>]", note: "MCBP: real attackEntityFrom pipeline; type map in DamageCommandParity." },
  { cmd: "tellraw", syntax: "/tellraw <player> <json>", note: "JSON chat with click events; the stats-screen primitive." },
];

export const RECIPE_GUIDE: ReadonlyArray<{ type: string; keys: string; note: string }> = [
  { type: "minecraft:crafting_shaped", keys: "result, pattern, key", note: "Pattern max 3x3; tag ingredient support via parseIngredientMatcher." },
  { type: "minecraft:crafting_shapeless", keys: "result, ingredients", note: "Array of ingredients, max 9." },
  { type: "minecraft:smelting", keys: "result, ingredient, experience, cookingtime", note: "" },
  { type: "minecraft:blasting", keys: "result, ingredient, experience, cookingtime", note: "" },
  { type: "minecraft:smoking", keys: "result, ingredient, experience, cookingtime", note: "" },
  { type: "minecraft:campfire_cooking", keys: "result, ingredient, experience, cookingtime", note: "" },
  { type: "minecraft:stonecutting", keys: "result, ingredient, count", note: "" },
  { type: "minecraft:smithing_transform", keys: "result, template, base, addition", note: "" },
  { type: "forge:conditional / neoforge:conditional", keys: "conditions, recipe", note: "Wraps another recipe; only first passing conditions is registered." },
];

export const STAGING_PATH_TEMPLATE: ReadonlyArray<{ what: string; path: string; cite: string }> = [
  { what: "Mod JAR (staged per world)", path: "mods/<worldName>/<filename>.jar", cite: "ModManager.java:1191-1192" },
  { what: "Translated assets", path: "mods_translated/<worldName>/<modId>-<version>/assets/<ns>/...", cite: "ModManager.java:3557-3564" },
  { what: "Resource pack output", path: "resourcepacks/<packFolder>/assets/<ns>/...", cite: "09_VFS_AND_RESOURCE_SYSTEM.md:29-39" },
  { what: "Folder mod source", path: "mods_folders/<worldName>/<name>/...", cite: "ModManager.java:108, 15110-15125" },
  { what: "MapDev batch drop folder", path: "worlds/<worldName>/_dev/build/ops-*.json", cite: "MapDevWorkspace.java:50-51" },
];

export const ENDPOINT_CATALOG: ReadonlyArray<{
  method: "GET" | "POST";
  path: string;
  auth: "none" | "token";
  desc: string;
}> = [
  { method: "GET",  path: "/omni/ping",                auth: "none",  desc: "Liveness probe. Returns service/protocol info." },
  { method: "POST", path: "/omni/pair",                auth: "none",  desc: "Quick-pair with the 8-character code from the device." },
  { method: "GET",  path: "/omni/help",                auth: "token", desc: "Self-describing endpoint catalog this device serves." },
  { method: "GET",  path: "/omni/state",               auth: "token", desc: "Snapshot of game state, screen, player position, world, devpatch status." },
  { method: "GET",  path: "/omni/worlds",              auth: "token", desc: "List saved worlds. Full list only when no world is running." },
  { method: "POST", path: "/omni/command",             auth: "token", desc: "Run any command (full-privilege, player-anchored). Response includes chat feedback." },
  { method: "POST", path: "/omni/world/create",        auth: "token", desc: "Create a new world (template: void_single, void_platform_7x7, flat, default). Staging mods is allowed in one call." },
  { method: "POST", path: "/omni/world/enter",         auth: "token", desc: "Load a saved world by name." },
  { method: "POST", path: "/omni/world/quit",          auth: "token", desc: "Back to main menu." },
  { method: "POST", path: "/omni/player",              auth: "token", desc: "Player actions: teleport, move, look, lookAt, give, say, attack, use, hotbar, drop, sneak, sprint, jump." },
  { method: "GET",  path: "/omni/player/inventory",    auth: "token", desc: "Full inventory, hotbar, armor with id+count+meta." },
  { method: "POST", path: "/omni/world/scan",          auth: "token", desc: "Block and entity snapshot inside a 64^3 box." },
  { method: "POST", path: "/omni/world/raycast",       auth: "token", desc: "Ray from origin/direction; returns block or entity hit." },
  { method: "POST", path: "/omni/mod/add",             auth: "token", desc: "Stage a mod JAR (base64) into a world." },
  { method: "POST", path: "/omni/mapdev/write",        auth: "token", desc: "Write a MapDev batch into worlds/<map>/_dev/build/ (the engine applies within ~2s)." },
  { method: "GET",  path: "/omni/mapdev/status",       auth: "token", desc: "MapDev apply-ledger state and current map name." },
  { method: "POST", path: "/omni/mapdev/mode",         auth: "token", desc: "Dual-mode switch for the running map: {mode:'dev'|'play'} (aliases preview/development). Empty body = query only. play = PREVIEW: command blocks invisible/unopenable/unbreakable while logic keeps running. Server-thread scheduled, 10s timeout, same kernel as /omni_dev mode." },
  { method: "POST", path: "/omni/chat",                auth: "token", desc: "Broadcast a blue [Agent] chat line." },
  { method: "GET",  path: "/omni/poll",                auth: "token", desc: "v3 perception heartbeat: ONE round trip = state + new logs + new events + notifications. Pass lastLogSeq/lastEventSeq back as logSince/eventSince." },
  { method: "GET",  path: "/omni/events",              auth: "token", desc: "v3 typed structured event feed (living_hurt/death/heal/drops, entity_join/leave, mob_target, player_interact, block_break, explosion, mount, screen_open) with ?since=&type=&limit=." },
  { method: "GET",  path: "/omni/player/inspect",      auth: "token", desc: "v3 THE FULL PLAYER CARD: vitals, XP, gamemode, armor, inventory, effects, movement flags, statistics, biome/light. ?include=all|inventory|effects|stats." },
  { method: "POST", path: "/omni/batch",               auth: "token", desc: "v2 SPEED: N calls in ONE round trip: {steps:[{get}|{post}|{command}|{commands}|{player}|{wait}|{label}], stopOnError?} — every endpoint is batchable." },
  { method: "GET",  path: "/omni/commands",            auth: "token", desc: "v2 command discovery: every command registered on the integrated server (name, usage, permission) — vanilla + OmniMod + mod commands." },
  { method: "POST", path: "/omni/entity",              auth: "token", desc: "v2 full state of one loaded entity: pos/rotation/motion, health, equipment, held item, riding, age, flags." },
  { method: "POST", path: "/omni/entities/nearby",     auth: "token", desc: "v2 entities around the player sorted by distance + per-type counts. Much faster than world/scan for situational awareness." },
  { method: "POST", path: "/omni/world/block",         auth: "token", desc: "v2 targeted block reads: {x,y,z} or {positions:[..]} (max 512) — id, meta, tile, hardness, light, flags." },
  { method: "GET",  path: "/omni/screen",              auth: "token", desc: "v2 GUI: current screen + clickable button inventory (id, label, x, y, size, enabled)." },
  { method: "POST", path: "/omni/screen/click",        auth: "token", desc: "v2 GUI: click a button through the vanilla mouseClicked path (menus, respawn, settings, mod screens)." },
  { method: "POST", path: "/omni/screen/key",          auth: "token", desc: "v2 GUI: deliver a key through the vanilla keyTyped path (ESC closes screens, ENTER submits)." },
  { method: "POST", path: "/omni/wait",                auth: "token", desc: "v2 precise wait: {until:'ticks'|'ms'|'log'|'worldReady'|'menu'|'screen'|'entityGone'|'entityCount'|'health'|'positionNear'|'block', timeoutMs?, pollMs?, ...condition}." },
  { method: "GET",  path: "/omni/mods",                auth: "token", desc: "v2 mods installed in the active (or ?world=) world." },
  { method: "POST", path: "/omni/devpatch/verify",     auth: "token", desc: "Compare source-file sha256 against the active DevPatch inventory." },
  { method: "GET",  path: "/omni/logs",                auth: "token", desc: "In-game log ring. Filters: since, limit, level, source, q, tail." },
  { method: "GET",  path: "/omni/errors",              auth: "token", desc: "WARN+ only, same filters except level." },
  { method: "GET",  path: "/omni/notifications",       auth: "token", desc: "Grouped WARN/ERROR/FATAL by source with count + sample." },
  { method: "POST", path: "/omni/agentlog",            auth: "token", desc: "Write your own annotation into the log ring (use this to mark phases)." },
];

/**
 * Public source repositories that mirror the two engine systems. An external
 * agent (or a human mod author) reads these to understand exactly how the
 * engine accepts Forge 1.20.1 mods and how the command-block surface works.
 * URLs come from config (env OMNIMOD_FORGE_COMPAT_REPO / OMNIMOD_COMMAND_BLOCKS_REPO).
 */
export function sourceRepos(forgeCompatRepoUrl: string | null, commandBlocksRepoUrl: string | null): ReadonlyArray<{
  system: string;
  url: string;
  status: "linked" | "not-set";
  env: string;
  contains: string;
}> {
  return [
    {
      system: "Forge 1.20.1 mod-compat layer",
      url: forgeCompatRepoUrl ?? "(not linked yet — set OMNIMOD_FORGE_COMPAT_REPO)",
      status: forgeCompatRepoUrl ? "linked" : "not-set",
      env: "OMNIMOD_FORGE_COMPAT_REPO",
      contains: "ModManager (mod loading/translation), the forge compat kernel (registries, events, capabilities, recipes, rendering, loot, GUI dispatch), the net.minecraftforge API shims, the 1.20.1 net.minecraft API shims, and the mod-library shims (architectury, balm, terrablender, ...). Read this BEFORE authoring a mod: every key the loader reads is visible here with file:line citations in the pipeline docs.",
    },
    {
      system: "Command-block & command-surface system",
      url: commandBlocksRepoUrl ?? "(not linked yet — set OMNIMOD_COMMAND_BLOCKS_REPO)",
      status: commandBlocksRepoUrl ? "linked" : "not-set",
      env: "OMNIMOD_COMMAND_BLOCKS_REPO",
      contains: "The Brigadier 1.20.1 shim (dispatcher, argument types, suggestions), the 1.20.1 commands API shims, every 1.8 command implementation, the MCBP parity commands (bossbar/team/tag/title/function/schedule/execute/data/attribute/damage/ride/stopsound/experience/modern setblock-fill-clone), the command-block modes runtime, CommandBlockLogic + BlockCommandBlock + tile entity, and the dual-mode DEV/PLAY gates (MapModeRuntime). Read this to master command-block map design.",
    },
  ];
}

/**
 * The professional map-development workflow (compact form of
 * mcp/docs/MAP_DEV_MASTER_GUIDE.md — the full guide is served as the
 * omnimod://knowledge/map-dev-guide resource and via omni_map_guide).
 */
export const MAP_DEV_GUIDE: ReadonlyArray<{
  phase: string;
  goal: string;
  tools: string;
  key_facts: string;
}> = [
  {
    phase: "1. Connect",
    goal: "Pair with the device and confirm a world is loaded.",
    tools: "omni_ping -> omni_pair -> omni_state",
    key_facts: "Quick-pair code is read off the device screen (Options -> Agent Link Info). OMNIMOD_TOKEN can be preset instead.",
  },
  {
    phase: "2. Onboard the map",
    goal: "Read the per-map context pack before touching anything.",
    tools: "omni_map_onboard -> omni_map_docs",
    key_facts: "The pack (worlds/<map>/_dev/) carries MAP_OVERVIEW/CHANGE_LOG/FILE_MAP (living, agent-owned) + game-owned knowledge docs. Missing pack? omni_map_bootstrap regenerates it.",
  },
  {
    phase: "3. Build geometry",
    goal: "Place blocks through validated batches.",
    tools: "omni_shape_* -> omni_blueprint -> omni_batch_validate -> omni_batch_apply",
    key_facts: "1.8 registry names + meta nibble (0..15); auto-translate handles 1.20 names; y 0..255; batches land within ~2s; unloaded chunks are skipped silently (tp the player first).",
  },
  {
    phase: "4. Wire mechanics",
    goal: "Add command blocks, functions, timers, bossbars, teams.",
    tools: "omni_command (or a `command` op in a batch) + _dev/functions/*.mcfunction",
    key_facts: "Modern command surface: bossbar/team/tag/title(actionbar)/function/schedule/execute(1.20.1 chain)/data/random/return + modern setblock/fill/clone/effect/xp/give + attribute/damage/ride/stopsound/teammsg. Command-block modes: impulse/repeating/chain + conditional + auto via modern setblock. Map functions: _dev/functions/<name>.mcfunction -> <mapNs>:<name>; load.mcfunction + tick.mcfunction conventions. Runtime state (bossbars, storage, schedules) does NOT survive reload — re-arm from load.mcfunction.",
  },
  {
    phase: "5. Preview like a player (dual mode)",
    goal: "Test the map exactly as published — command blocks hidden but fully live.",
    tools: "omni_mapdev_mode {mode:'play'} -> verify -> omni_mapdev_mode {mode:'dev'}",
    key_facts: "play = PREVIEW: command blocks invisible/unopenable/unbreakable/untargetable, logic keeps running. Persisted per map (mapmode.json). Verify the map still WORKS after switching (hiding never disables). Same kernel as /omni_dev mode and POST /omni/mapdev/mode.",
  },
  {
    phase: "6. Verify",
    goal: "Prove the build with the 3-level battery.",
    tools: "omni_mapdev_status + omni_world_scan + omni_world_raycast + omni_errors + omni_wait + omni_map_report",
    key_facts: "Level 1 ledger (applied, failed=0) -> Level 2 geometry (8 corners, jambs, ridge, raycast from the intended viewpoint) -> Level 3 logs (zero unknown_block / volume_too_large / command_failed). Write the report into state/verification/.",
  },
  {
    phase: "7. Handoff",
    goal: "Leave the map self-describing for the next agent.",
    tools: "omni_map_changelog + omni_map_overview + omni_map_filemap + omni_agentlog",
    key_facts: "Every change gets a CHANGE_LOG entry (title, requested, interpretation, batches, blocksUsed, reportPath). MAP_OVERVIEW and FILE_MAP stay current.",
  },
  {
    phase: "8. Mod the map (optional)",
    goal: "Stage Forge 1.20.1 mods into the map.",
    tools: "omni_mod_scaffold -> omni_mod_inspect -> omni_mod_add -> reload world",
    key_facts: "Read the compat repo (omni_knowledge topic='repos') first. Data-driven mods translate; the mod's Java is never executed. Reload the world to activate.",
  },
];

export const MOD_TROUBLESHOOTING: ReadonlyArray<{
  symptom: string;
  cause: string;
  resolution: string;
}> = [
  {
    symptom: "Mod loads but no items appear in the creative tab.",
    cause: "Item models or textures failed to load. The fallback uses the registry name as the texture path and the .png is missing.",
    resolution: "Verify assets/<ns>/models/item/<name>.json and the texture path in layer0. Use inspect_mod to dump the mod structure.",
  },
  {
    symptom: "Recipe does not show in the recipe book and crafting yields nothing.",
    cause: "Tag misspelling or unknown 1.20 vanilla name in the ingredient list. The engine drops the recipe silently.",
    resolution: "Run a JSON recipe linter. Replace 1.20 names with 1.8 names (sugar_cane to reeds, white_wool to wool meta:0, nether_brick to netherbrick).",
  },
  {
    symptom: "GUI declared in assets/<ns>/gui/*.json does not open.",
    cause: "GUI dispatch keys must be present and the json must parse. Missing 'screen' or 'title' silently skips the registration.",
    resolution: "Run the JSON GUI linter on the directory and verify each file's top-level keys.",
  },
  {
    symptom: "Block places but has the missing-texture on every face.",
    cause: "Missing assets/<ns>/blockstates/<name>.json and a non-cube-all parent. The engine substitutes the missing-texture model.",
    resolution: "Add a blockstates JSON with a `variants.normal` pointing to a `mymodid:block/<name>` model, and a model with parent `block/cube_all` and an `all` texture.",
  },
  {
    symptom: "Logs flood with `unknown_block` lines for ops the agent is sending.",
    cause: "Block id was a 1.20 name with no translation.",
    resolution: "Call omni_block_translate on every block id before it goes into a batch. Enable autoTranslateBlocks (default on) for opaque safety.",
  },
  {
    symptom: "DevPatch verify says `changed_since_patch` for files I just edited.",
    cause: "The patch's recorded sha256 is the pre-edit one. The runtime on the device is not yet your latest source.",
    resolution: "Run `dev_hotpatch.py --once` to ship a new patch, wait for the device to ack, then re-verify.",
  },
];
