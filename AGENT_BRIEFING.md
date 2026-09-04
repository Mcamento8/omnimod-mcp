# OmniMod MCP — Agent Briefing Prompt

> **الغرض:** هذا الملف هو البرومبت الاحترافي الكامل الذي يُعطى لأي وكيل ذكاء اصطناعي (Claude, Cursor, Cline, Kilo, Zed, Windsurf, أو وكيل HTTP مخصص) ليُعرَّف بمشروع OmniMod، وبقدرات الـ MCP المبني عليه، وبكل ما يجب أن يعرفه قبل أن يعمل على اللعب.

---

## English Version (copy this section for non-Arabic agents)

````markdown
You are an AI agent working on **OmniMod**, a fork of EaglercraftX 1.8.8 that adds a runtime compatibility layer for Minecraft Forge 1.20.1 mods. The game runs on Web (TeaVM/WASM-GC), Android (WebAPK + Native), and Desktop (LWJGL debug). The user has a custom **MCP server** wired into the project at `mcp/` that gives you professional-grade control over map building, game state, and mod authoring.

## What the user asked for (in the user's own words)

The user said (Arabic, translated):
> "Hello, you are an AI agent specialized in creating and developing MCPs. I have this game that looks like Minecraft. I previously developed a system that lets users and AI agents on different computers create and develop maps remotely, with the ability to control the game in agent-link mode and do anything. I want you to create an advanced professional MCP that I can connect to any AI so that it gives any AI agent the ability to create maps professionally — i.e. a deep understanding of the agent for map development, mod addition, game control, and mod development. I want you to inspect the game currently to understand how this system works, read all the project's context files to understand how these systems work. There are several context files for these systems explaining in detail how they work. Did you understand? Note that this MCP is multi-task: it will give the agent the ability to create maps professionally and, at the same time, give the agent a deep understanding of how to create mods compatible with my game. I will upload the Forge file for translating mod compatibility with the game and allowing agents to access it and inspect it so they know how my game supports Minecraft mods. Did you understand? Create an `mcp` folder in the current project root, then start building the MCP."

So the deliverable is: **a multi-task MCP server** that gives any connected AI agent BOTH (a) professional map-building capability and (b) deep understanding of how to author Forge 1.20.1 mods that OmniMod will accept.

## What was built

A 12-file TypeScript MCP server at `mcp/`. Build + run:

```bash
cd mcp
npm install
npm run build
npm run selfcheck   # in-process test battery
npm run e2e         # drives a real JSON-RPC session
```

The server speaks MCP over stdio. Configure it in your client (Claude Desktop / Cursor / Cline / Kilo / Zed / Windsurf) by pointing at `node mcp/dist/index.js`. Sample configs in `mcp/examples/`.

## Connection (5 env vars, all optional)

| Var | Default | Meaning |
|---|---|---|
| `OMNIMOD_HOST` | `127.0.0.1` | Device running OmniMod |
| `OMNIMOD_PORT` | `26911` | Agent Dev Link port (engine default) |
| `OMNIMOD_TOKEN` | (none) | 32-hex pairing token. Get one with `omni_pair` |
| `OMNIMOD_TIMEOUT_MS` | `20000` | Per-request HTTP timeout |
| `OMNIMOD_AUTO_TRANSLATE_BLOCKS` | `true` | Translate 1.20→1.8 names on the way out |
| `OMNIMOD_FORGE_COMPAT_REPO` | (none) | Public mirror of the engine's Forge 1.20.1 compat layer (surfaced by `omni_knowledge topic='repos'`) |
| `OMNIMOD_COMMAND_BLOCKS_REPO` | (none) | Public mirror of the engine's command-block system (surfaced by `omni_knowledge topic='repos'`) |

## What the MCP gives you (51 tools, 13 resources, 5 prompts)

**Connection** (10): `omni_ping`, `omni_pair`, `omni_config`, `omni_state`, `omni_help`, `omni_logs`, `omni_errors`, `omni_notifications`, `omni_agentlog`, `omni_devpatch_verify`.

**Worlds & map mode** (6): `omni_worlds`, `omni_world_create`, `omni_world_enter`, `omni_world_quit`, `omni_mapdev_status`, `omni_mapdev_mode` (the dual-mode DEV⇄PLAY switch: play = every command block invisible/unopenable/unbreakable while its logic keeps running — the published-map preview shape; dev = full editing). World templates are `void_single`, `void_platform_7x7`, `flat`, `default`.

**Map building** (13): `omni_block_translate`, `omni_item_translate`, `omni_block_search`, `omni_shape_solid_box`, `omni_shape_hollow_box`, `omni_shape_cylinder`, `omni_shape_sphere`, `omni_shape_pyramid`, `omni_shape_gable_roof`, `omni_shape_hip_roof`, `omni_shape_building` (one-call house with door + windows + roof), `omni_shape_line`, `omni_blueprint` (multi-op in one call), `omni_batch_validate`, `omni_batch_apply`.

**Player & observation** (7): `omni_command`, `omni_player` (teleport/move/look/lookAt/give/say/attack/use/hotbar/drop/sneak/sprint/jump), `omni_inventory`, `omni_world_scan`, `omni_world_raycast`, `omni_chat`.

**Mod authoring** (4): `omni_mod_add`, `omni_mod_scaffold` (writes a complete Forge-shaped folder from a JSON spec), `omni_mod_inspect` (JAR/folder linter with file:line citations), `omni_recipe_validate`.

**Knowledge & master guide** (2): `omni_knowledge` with topics `identity | rules | pitfalls | commands | recipes | staging | endpoints | troubleshooting | mapdev | repos | all`, and `omni_map_guide` which returns the full professional map-development master guide (also served as the `omnimod://knowledge/map-dev-guide` resource). The `mapdev` topic is the compact 8-phase workflow; `repos` returns the public source mirrors of the Forge compat layer and the command-block system (set their URLs via `OMNIMOD_FORGE_COMPAT_REPO` / `OMNIMOD_COMMAND_BLOCKS_REPO`).

**Resources** (10): `omnimod://knowledge/{identity,rules,pitfalls,commands,recipes,staging-paths,endpoints,troubleshooting}` and `omnimod://registry/{blocks18,items18}` (the actual 198/187-name registries the engine uses).

**Prompts** (3): `build-a-medieval-village`, `author-a-new-mod`, `debug-a-silent-noop`.

## CRITICAL discovery: the 1.20→1.8 name gap

OmniMod's EaglercraftX 1.8.8 engine registers blocks and items from 1.8 (`minecraft:stone`, `minecraft:planks`, `minecraft:wool` + meta 14 = red). Modern mod authors think in 1.20 names (`minecraft:oak_planks`, `minecraft:white_wool`, `minecraft:grass_block`).

**There is NO alias table on the placement path in the engine.** Send `minecraft:oak_planks` and `MapBuilderRuntime.resolveBlockState` (`MapBuilderRuntime.java:311-328`) returns null, `placeBlock` logs `unknown_block`, and the batch is still recorded as applied. You will not see an error.

The MCP closes this gap in `mcp/src/translate.ts`:
- 16-color wool/glass/clay/carpet families with the right meta nibble
- 6 wood families (oak/spruce/birch/jungle/acacia/dark_oak) → `planks`, `log`/`log2`, `leaves`/`leaves2`, `sapling`, `wooden_slab` with the right meta
- Stone family (granite/diorite/andesite/sandstone/red_sandstone/quartz/prismarine)
- Plants (poppy/dandelion/tulip/orchid/lily/pad/sugar_cane/etc.)
- Items: dye meta nibble, sugar_cane→reeds, nether_brick→netherbrick, enchanted_golden_apple→golden_apple meta 1, food renames, music disc renames, etc.
- Explicit `unavailable` list with a `nearest match` note for 1.13+/1.16+/1.17+/1.19+/1.20 blocks that simply do not exist in 1.8 (concrete, deepslate, sculk, copper, amethyst, mangrove, cherry, etc.)

Modded namespaces (`mymod:custom_block`) pass through untouched. Auto-translation is on by default; you can disable per-call.

## Other non-negotiables the MCP encodes

1. **No blockstate strings.** `minecraft:oak_stairs[facing=east]` is not parsed anywhere. Variants are the 1.8 metadata nibble (0..15) via `Block.getStateFromMeta`.
2. **y is 0..255.** This is 1.8. No y<0, no y>255. Any op with y outside is rejected.
3. **The engine bounds game-thread work at 10s.** Big batches time out. The MCP's `MAX_BULK_PER_CALL=1,000,000` mirrors the engine cap.
4. **Bridge is not on Web targets.** Use the `_dev` folder bridge (`docs/project_map/30_AGENT_DEV_BRIDGE_PIPELINE.md`) on Web.
5. **The mod's Java is never executed.** The compat layer is a translation/asset bridge. Only JSON/assets and data-driven behaviors are bridged into the 1.8 engine.
6. **Batches apply within ~2s.** `MapDevSyncRuntime` polls every 40 ticks. Read `/omni/logs` after every meaningful batch to catch silent failures.
7. **The build needs verification.** Engine source edits require a DevPatch (`dev_hotpatch.py`) or a rebuild. Use `omni_devpatch_verify` to check.

## First agent call (canonical flow)

```
1. omni_ping                          -> confirm bridge up (no auth)
2. omni_pair {code: "ACDM3491"}       -> user reads 8-char code off device
3. omni_state                         -> confirm a world is loaded
4. omni_knowledge {topic: "rules"}    -> read non-negotiables
5. omni_blueprint { apply: true,
   steps: [{ kind: "cylinder", block: "minecraft:stone",
             center: [0,64,0], radius: 12, height: 1 },
            { kind: "building", origin: [0,65,0], width: 9, depth: 7,
              height: 4, wallBlock: "minecraft:cobblestone",
              roofStyle: "gable", roofBlock: "minecraft:stone" }]}
6. omni_logs {level: "WARN"}          -> read what engine applied
7. omni_agentlog {message: "phase 1 done"}
```

## What was NOT built (honest boundaries)

- Web target has no bridge. The MCP can still serve the static knowledge + scaffolding + inspector, but `omni_*` calls will fail. Suggest the user use Desktop or Android.
- The bridge does not encrypt. Use a trusted LAN or VPN.
- The bridge does not change game logic — it calls into the existing command manager, player APIs, mod-staging path. If the game does not understand a command, you get `command_failed` back.
- The bridge has no rate limiting beyond the 5-fail/10-min lockout. The MCP maps every engine error code to a hint string.
- The MCP does not generate textures. The scaffolder writes 1x1 transparent PNG placeholders. The user must swap real textures in.

## Source layout

```
mcp/
├── src/
│   ├── index.ts          # entry point
│   ├── selfcheck.ts      # in-process test battery
│   ├── server.ts         # 51 tools + 13 resources + 5 prompts (incl. omni_mapdev_mode, omni_map_guide)
│   ├── bridge.ts         # HTTP client with error mapping
│   ├── config.ts         # env-driven runtime config
│   ├── translate.ts      # 1.20→1.8 block/item name+meta translation
│   ├── registry.ts       # 198 blocks + 187 items registered in 1.8.8
│   ├── ops.ts            # MapDev op validation + batch builder
│   ├── shapes.ts         # solidBox, cylinder, sphere, building, ...
│   ├── scaffold.ts       # mod folder scaffolder
│   ├── inspect.ts        # mod JAR/folder inspector + problem linter
│   └── knowledge.ts      # static facts (rules, pitfalls, commands, ...)
├── scripts/e2e.mjs       # end-to-end JSON-RPC test
├── examples/             # configs for 5 MCP clients
├── package.json
├── tsconfig.json
├── README.md             # full docs
└── AGENT_BRIEFING.md     # this file
```

## Where to go for the deep background

- `docs/context_bundle/AGENT_LOOP.md` — the user's own agent guide
- `docs/context_bundle/AGENTS.md` — non-negotiable rules
- `docs/context_bundle/AGENT_MOD_COMPAT_GUIDE.md` — mod compat details
- `docs/project_map/30_AGENT_DEV_BRIDGE_PIPELINE.md` — `_dev` folder bridge
- `docs/project_map/31_AGENT_LINK_PIPELINE.md` — HTTP bridge internals
- `docs/project_map/36_OMNIMOD_PACK_LOADER.md` — OPL (note: OPL is NOT a mod authoring path; use JARs for content)
- `sources/main/java/net/lax1dude/eaglercraft/v1_8/sp/MapBuilderRuntime.java` — placement engine (read this before writing any op)
- `sources/main/java/net/lax1dude/eaglercraft/v1_8/sp/MapDevWorkspace.java` — op vocabulary
- `sources/main/java/net/lax1dude/eaglercraft/v1_8/minecraft/ModManager.java:3557-3890` — mod translation pass
````

---

## النسخة العربية (للوكلاء الذين يعملون بالعربية)

````markdown
أنت وكيل ذكاء اصطناعي يعمل على **OmniMod** — مفترق EaglercraftX 1.8.8 يضيف طبقة توافق runtime لمودات Minecraft Forge 1.20.1. اللعبة تعمل على Web (TeaVM/WASM-GC) وAndroid (WebAPK + Native) وDesktop (LWJGL debug). المستخدم بنى **MCP server** مخصص في مجلد `mcp/` يعطيك قدرة احترافية على بناء المابات، التحكم باللعبة، وتطوير المودات.

## ما طلبه المستخدم (بنص كلامه)

> "مرحبا انت وكيل دكاء اصطناعي متخصص في مجال انشاء تطزوير mcp. لدي هاده العبة التي تشبه لعبة ماين كرافت. انا سابقا قمت بتطوير نظام يمكن مستخدمين ووكلاء دكاء اصطناعي في مختلف كمبيوتورات من تطوير وانشاء مابات بحرية مع امكانية التحكم بالعب وضع agent link وفعل اي شيء. اود منك انشاء mcp متقدم احترافي يمكنني رطبه مع اي دكاء اصطناعي بحيث يعطي اي وكيل دكاء اصكناعي قدرة عل انشاء مابات بطريق احترافية. اي يعطي فهم واسع لوكيل بطريقة تطوير وانشاء مابات واضافة مودات والتحكم بالعبة وتطوير مودات واضافتها الى العبة. اود منك فحص العبة حاليا لتعرف كيف يعمل هادا نظام جيدا اقرء كل ملفات السياق المشروع بالكامل لتعرف كيف تعمل هاده الانظم. توجد عدة ملفات سياق لهاده الانظم تشرح كيف تعمل بتفصيل. هل فهمت يرجي علم انه هادا الام سي بي متعدد مهام سيعطي وكيل قدرة عل انشاء مابات بطيق احترافية وفي نفس وقت يعطي وكيل فهم واسع حول كيفية انشاء مودات متوفاق مع لعبتي. سوف ارفع ملف forge الخاص بترجمة توافق مودات مع العبة وسماح لوكلاء لوصول اليه وفحصه قرائته ليعرفو كيفية دعم لعبتي مودات ماين كرافت. هل فهمت. انشئ مجد mcp في جدر مشروع الحالي ومن ثم ابدء ببناء الام سي بي."

أي المطلوب: **MCP متعدد المهام** يعطي أي وكيل ذكاء اصطناعي قدرتين معاً: (أ) بناء مابات احترافي، و(ب) فهم عميق لكيفية تأليف مودات Forge 1.20.1 يقبلها OmniMod.

## ما تم بناؤه

سيرفر TypeScript من 12 ملفاً في `mcp/`. للبناء والتشغيل:

```bash
cd mcp
npm install
npm run build
npm run selfcheck   # بطارية اختبارات
npm run e2e         # اختبار JSON-RPC حقيقي
```

السيرفر يتكلم MCP عبر stdio. أضفه لعميلك (Claude Desktop / Cursor / Cline / Kilo / Zed / Windsurf) بتوجيهه إلى `node mcp/dist/index.js`. إعدادات جاهزة في `mcp/examples/`.

## الاتصال (5 متغيرات بيئة، كلها اختيارية)

| المتغير | الافتراضي | المعنى |
|---|---|---|
| `OMNIMOD_HOST` | `127.0.0.1` | الجهاز الذي يشغل OmniMod |
| `OMNIMOD_PORT` | `26911` | منفذ Agent Dev Link (افتراضي المحرك) |
| `OMNIMOD_TOKEN` | (فارغ) | توكن اقتران 32-hex. تحصل عليه بـ `omni_pair` |
| `OMNIMOD_TIMEOUT_MS` | `20000` | مهلة كل طلب HTTP |
| `OMNIMOD_AUTO_TRANSLATE_BLOCKS` | `true` | ترجمة 1.20→1.8 تلقائياً قبل الإرسال |
| `OMNIMOD_FORGE_COMPAT_REPO` | (فارغ) | المستودع العام لطبقة توافق Forge 1.20.1 (يظهر عبر `omni_knowledge topic='repos'`) |
| `OMNIMOD_COMMAND_BLOCKS_REPO` | (فارغ) | المستودع العام لنظام الكوماند بلوك (يظهر عبر `omni_knowledge topic='repos'`) |

## ما يعطيك إياه الـ MCP (51 أداة، 13 موردًا، 5 prompts)

**الاتصال** (10): `omni_ping`, `omni_pair`, `omni_config`, `omni_state`, `omni_help`, `omni_logs`, `omni_errors`, `omni_notifications`, `omni_agentlog`, `omni_devpatch_verify`.

**العوالم ووضع الخريطة** (6): `omni_worlds`, `omni_world_create`, `omni_world_enter`, `omni_world_quit`, `omni_mapdev_status`, `omni_mapdev_mode` (التبديل بين وضع التطوير والمعاينة: المعاينة = كل كوماند بلوك مخفي/غير قابل للفتح/غير قابل للكسر بينما يستمر عمل منطقه — شكل الخريطة كأنها منشورة). قوالب العوالم: `void_single`, `void_platform_7x7`, `flat`, `default`.

**بناء المابات** (13): `omni_block_translate`, `omni_item_translate`, `omni_block_search`, `omni_shape_solid_box`, `omni_shape_hollow_box`, `omni_shape_cylinder`, `omni_shape_sphere`, `omni_shape_pyramid`, `omni_shape_gable_roof`, `omni_shape_hip_roof`, `omni_shape_building` (بيت كامل بباب ونوافذ وسقف), `omni_shape_line`, `omni_blueprint` (متعدد العمليات في استدعاء واحد), `omni_batch_validate`, `omni_batch_apply`.

**اللاعب والمراقبة** (7): `omni_command`, `omni_player` (teleport/move/look/lookAt/give/say/attack/use/hotbar/drop/sneak/sprint/jump), `omni_inventory`, `omni_world_scan`, `omni_world_raycast`, `omni_chat`.

**تأليف المودات** (4): `omni_mod_add`, `omni_mod_scaffold` (يكتب مجلد Forge كامل من مواصفة JSON), `omni_mod_inspect` (فاحص JAR/مجلد مع اقتباسات file:line), `omni_recipe_validate`.

**المعرفة** (1): `omni_knowledge` مع المواضيع `identity | rules | pitfalls | commands | recipes | staging | endpoints | troubleshooting | all`.

**الموارد** (10): `omnimod://knowledge/{identity,rules,pitfalls,commands,recipes,staging-paths,endpoints,troubleshooting}` و `omnimod://registry/{blocks18,items18}` (السجلان الفعليان 198/157).

**البرومبتات الموجهة** (3): `build-a-medieval-village`, `author-a-new-mod`, `debug-a-silent-noop`.

## اكتشاف حاسم: فجوة أسماء 1.20→1.8

محرك OmniMod مبني على EaglercraftX 1.8.8 ويسجل الكتل/الآيتمنز بأسماء 1.8 (`minecraft:stone`, `minecraft:planks`, `minecraft:wool` + meta 14 = أحمر). كتّاب المودات الحديثون يفكرون بأسماء 1.20 (`minecraft:oak_planks`, `minecraft:white_wool`, `minecraft:grass_block`).

**لا يوجد أي جدول ترجمة في مسار الوضع داخل المحرك.** أرسل `minecraft:oak_planks` و `MapBuilderRuntime.resolveBlockState` (`MapBuilderRuntime.java:311-328`) يرجع null، و `placeBlock` يسجل `unknown_block` بصمت، والدفعة تُسجَّل على أنها طُبّقت. لن ترى خطأً.

الـ MCP يسد هذه الفجوة في `mcp/src/translate.ts`:
- عائلات 16 لون للصوف/الزجاج/الطين/السجاد مع meta nibble الصحيح
- 6 عائلات خشب (oak/spruce/birch/jungle/acacia/dark_oak) → `planks`, `log`/`log2`, `leaves`/`leaves2`, `sapling`, `wooden_slab` مع meta الصحيح
- عائلة الحجر (granite/diorite/andesite/sandstone/red_sandstone/quartz/prismarine)
- النباتات (poppy/dandelion/tulip/orchid/lily/pad/sugar_cane)
- الآيتمنز: dye meta nibble، sugar_cane→reeds، nether_brick→netherbrick، enchanted_golden_apple→golden_apple meta 1، إعادة تسمية الطعام، إعادة تسمية اسطوانات الموسيقى
- قائمة `unavailable` صريحة مع `nearest match` لكتل 1.13+/1.16+/1.17+/1.19+/1.20 التي لا وجود لها في 1.8 (concrete, deepslate, sculk, copper, amethyst, mangrove, cherry)

النطاقات المخصصة (`mymod:custom_block`) تمر كما هي. الترجمة التلقائية مفعّلة افتراضياً ويمكن تعطيلها لكل استدعاء.

## قواعد غير قابلة للتفاوض يضمنها الـ MCP

1. **لا توجد blockstate strings.** `minecraft:oak_stairs[facing=east]` لا يُفسر في أي مكان. المتغيرات هي meta nibble 1.8 (0..15) عبر `Block.getStateFromMeta`.
2. **y من 0 إلى 255.** هذا 1.8. لا y سالب، لا y أكبر. أي op خارج النطاق يُرفض.
3. **المحرك يحد عمل خيط اللعبة بـ 10 ثوان.** الدفعات الكبيرة تنتهي بـ timeout. الـ MCP يحترم `MAX_BULK_PER_CALL=1,000,000` مطابقة لسقف المحرك.
4. **الجسر لا يعمل على Web.** استخدم `_dev` folder bridge (`docs/project_map/30_AGENT_DEV_BRIDGE_PIPELINE.md`) على Web.
5. **Java الخاص بالمود لا يُنفذ أبداً.** طبقة التوافق جسر ترجمة/أصول. فقط JSON والأصول والسلوكيات المبنية على البيانات تُربط بمحرك 1.8.
6. **الدفعات تُطبَّق خلال ~2 ثانية.** `MapDevSyncRuntime` يستطلع كل 40 tick. اقرأ `/omni/logs` بعد كل دفعة مهمة.
7. **تعديلات المحرك تحتاج DevPatch.** استخدم `omni_devpatch_verify` للتحقق.

## أول استدعاء للوكيل (التدفق القانوني)

```
1. omni_ping                          -> تأكد أن الجسر يعمل
2. omni_pair {code: "ACDM3491"}       -> المستخدم يقرأ الكود من الجهاز
3. omni_state                         -> تأكد أن عالماً محمّلاً
4. omni_knowledge {topic: "rules"}    -> اقرأ القواعد
5. omni_blueprint { apply: true,
   steps: [{ kind: "cylinder", block: "minecraft:stone",
             center: [0,64,0], radius: 12, height: 1 },
            { kind: "building", origin: [0,65,0], width: 9, depth: 7,
              height: 4, wallBlock: "minecraft:cobblestone",
              roofStyle: "gable", roofBlock: "minecraft:stone" }]}
6. omni_logs {level: "WARN"}          -> اقرأ ما طبّقه المحرك
7. omni_agentlog {message: "phase 1 done"}
```

## ما لم يُبنَ (حدود صادقة)

- Web لا يحتوي جسر. الـ MCP يخدم المعرفة والمولّد والفاحص لكن `omni_*` ستفشل. اقترح Desktop أو Android.
- الجسر لا يشفر. استخدم LAN موثوق أو VPN.
- الجسر لا يغير منطق اللعبة — يستدعي مدير الأوامر وAPIs اللاعب ومسار staging الموجود. إذا اللعبة لم تفهم الأمر، ستحصل على `command_failed`.
- لا rate limiting سوى 5-fail/10-min lockout. الـ MCP يحوّل كل كود خطأ من المحرك إلى hint.
- الـ MCP لا يولّد textures. المولّد يكتب PNG شفاف 1x1 كعنصر نائب. المستخدم يستبدل textures حقيقية.

## بنية المصدر

```
mcp/
├── src/
│   ├── index.ts          # نقطة الدخول
│   ├── selfcheck.ts      # بطارية الاختبارات
│   ├── server.ts         # 51 أداة + 13 موردًا + 5 prompts
│   ├── bridge.ts         # عميل HTTP مع ترجمة الأخطاء
│   ├── config.ts         # إعدادات مدفوعة بـ env
│   ├── translate.ts      # ترجمة 1.20→1.8
│   ├── registry.ts       # 198 كتلة + 187 آيتم (1.8.8)
│   ├── ops.ts            # تحقق + بناء دفعات MapDev
│   ├── shapes.ts         # solidBox, cylinder, sphere, building, ...
│   ├── scaffold.ts       # مولّد مجلد المود
│   ├── inspect.ts        # فاحص JAR/مجلد
│   └── knowledge.ts      # حقائق ثابتة
├── scripts/e2e.mjs       # اختبار JSON-RPC
├── examples/             # إعدادات 5 عملاء
├── package.json
├── tsconfig.json
├── README.md             # توثيق كامل
└── AGENT_BRIEFING.md     # هذا الملف
```

## أين تذهب للعمق

- `docs/context_bundle/AGENT_LOOP.md` — دليل الوكيل الخاص بالمستخدم
- `docs/context_bundle/AGENTS.md` — القواعد غير القابلة للتفاوض
- `docs/context_bundle/AGENT_MOD_COMPAT_GUIDE.md` — تفاصيل توافق المودات
- `docs/project_map/30_AGENT_DEV_BRIDGE_PIPELINE.md` — جسر `_dev`
- `docs/project_map/31_AGENT_LINK_PIPELINE.md` — تفاصيل جسر HTTP
- `sources/main/java/net/lax1dude/eaglercraft/v1_8/sp/MapBuilderRuntime.java` — محرك الوضع
- `sources/main/java/net/lax1dude/eaglercraft/v1_8/sp/MapDevWorkspace.java` — قاموس الـ ops
- `sources/main/java/net/lax1dude/eaglercraft/v1_8/minecraft/ModManager.java:3557-3890` — مسار ترجمة المود
````
