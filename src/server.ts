/**
 * OmniMod MCP server — exposes the Agent Dev Link bridge plus the
 * 1.20→1.8 translation, map-building primitives, and mod authoring tooling
 * to any MCP client (Claude Desktop, Claude Code, Cursor, Cline, Kilo Code,
 * Zed, Windsurf, custom agents, etc.).
 *
 * Tool surface (40 tools, grouped by phase of work):
 *
 *   CONNECTION
 *     omni_ping                  liveness probe (pre-auth)
 *     omni_pair                  quick-pair with an 8-char code (pre-auth)
 *     omni_config                view/update the live config (host/port/token)
 *     omni_state                 snapshot of game state
 *     omni_help                  endpoint catalog from the running game
 *     omni_logs / omni_errors / omni_notifications  observability
 *
 *   WORLDS
 *     omni_worlds                list saved worlds
 *     omni_world_create          create a new world
 *     omni_world_enter           load a saved world
 *     omni_world_quit            back to main menu
 *     omni_devpatch_verify       compare source sha256 with the active devpatch
 *
 *   MAP BUILDING
 *     omni_block_translate       translate one 1.20 block id to its 1.8 form
 *     omni_block_search          fuzzy search the 1.8 registry + alias table
 *     omni_shape_solid_box       1 fill_area
 *     omni_shape_hollow_box      6-fill hollow box (floor/ceiling/walls optional)
 *     omni_shape_cylinder        per-layer x-runs (vertical)
 *     omni_shape_sphere          x-runs per (y,z) row
 *     omni_shape_pyramid         stepped pyramid (1 fill per layer)
 *     omni_shape_gable_roof      gable roof
 *     omni_shape_hip_roof        hip roof
 *     omni_shape_building        one-call house: foundation + walls + roof + door + windows
 *     omni_shape_line            Bresenham 3D line
 *     omni_blueprint             run a multi-op construction in one call
 *     omni_batch_validate        translate + validate a raw batch
 *     omni_batch_apply           translate + validate + send to the bridge
 *     omni_mapdev_status         apply-ledger state
 *     omni_mapdev_mode           dual-mode DEV<->PLAY switch (command blocks hidden+locked in PLAY)
 *     omni_map_guide             the full professional map-dev master guide (docs/MAP_DEV_MASTER_GUIDE.md)
 *
 *   PLAYER & OBSERVATION
 *     omni_command               run any in-game command
 *     omni_player                teleport/look/give/attack/... actions
 *     omni_inventory             full inventory + armor
 *     omni_world_scan            block + entity snapshot in a box
 *     omni_world_raycast         ray from origin/direction
 *     omni_chat                  broadcast a [Agent] chat line
 *     omni_agentlog              write your own annotation into the log ring
 *
 *   MOD AUTHORING
 *     omni_mod_add               stage a mod JAR into a world
 *     omni_mod_scaffold          write a Forge-shaped mod folder to disk
 *     omni_mod_inspect           inspect a JAR or folder, list problems
 *     omni_recipe_validate       static linter for a recipe JSON
 *     omni_knowledge             fetch the static knowledge base
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { writeFile, mkdir, readFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { config, baseUrl, describeConfig, DEFAULT_FORGE_COMPAT_REPO, DEFAULT_COMMAND_BLOCKS_REPO } from "./config.js";
import { bridge, BridgeError } from "./bridge.js";
import { translateBlock, translateItem, searchNames, colorMeta, COLOR_NAMES, WOOD_NAMES } from "./translate.js";
import { buildBatch, safeBatchFileName, type Op } from "./ops.js";
import * as Shapes from "./shapes.js";
import { scaffoldMod, type ModSpec } from "./scaffold.js";
import { inspectMod } from "./inspect.js";
import * as MapDocs from "./mapdocs.js";
import {
  PROJECT_IDENTITY,
  NON_NEGOTIABLE_RULES,
  COMMON_PITFALLS,
  COMMAND_GUIDE,
  RECIPE_GUIDE,
  STAGING_PATH_TEMPLATE,
  ENDPOINT_CATALOG,
  MOD_TROUBLESHOOTING,
  MAP_DEV_GUIDE,
  sourceRepos,
} from "./knowledge.js";
import { join } from "node:path";

const server = new McpServer(
  {
    name: "omnimod-mcp",
    version: "1.2.0",
  },
  { capabilities: { tools: {}, resources: {}, prompts: {} } },
);

const text = (s: string) => ({ content: [{ type: "text" as const, text: s }] });
const json = (o: unknown) => text(JSON.stringify(o, null, 2));
const HERE = dirname(fileURLToPath(import.meta.url));

function describeError(e: unknown): string {
  if (e instanceof BridgeError) {
    return [
      `Bridge call failed: ${e.message}`,
      e.hint ? `Hint: ${e.hint}` : null,
      e.body ? `Body: ${JSON.stringify(e.body, null, 2)}` : null,
    ].filter(Boolean).join("\n");
  }
  if (e instanceof Error) return e.message;
  return String(e);
}

function trap<T>(fn: () => Promise<T>) {
  return fn().then((v) => v).catch((e) => {
    throw new Error(describeError(e));
  });
}

// =====================================================================
// CONNECTION
// =====================================================================

server.tool(
  "omni_ping",
  "Liveness probe for the OmniMod Agent Dev Link bridge. NO AUTH. Returns service info, protocol version, and auth requirement.",
  {},
  async () => {
    const r = await trap(async () => bridge.getPreAuth("/omni/ping"));
    return json(r);
  },
);

server.tool(
  "omni_pair",
  "Quick-pair with the device using the 8-character code the user sees on Options -> Agent Link Info -> Quick Pair Computer. NO AUTH. After this call, the token returned is stored in the MCP's live config so the next call works without re-pairing.",
  { code: z.string().describe("8-character code (e.g. ACDM3491) — case-insensitive, dashes/spaces ignored") },
  async ({ code }) => {
    const r = await trap(async () => bridge.postPreAuth("/omni/pair", { code: code.trim() }));
    const data = r as { ok: boolean; paired?: boolean; token?: string };
    if (data.ok && data.token) {
      // Mutate the live config. We cannot reassign the imported const, so we
      // require the user to also set OMNIMOD_TOKEN env var for full
      // persistence; this in-memory mutation is enough for the same session.
      (config as { token: string | null }).token = data.token;
      (globalThis as { __OMNIMOD_TOKEN__?: string }).__OMNIMOD_TOKEN__ = data.token;
    }
    return json({ ...r, configNow: describeConfig() });
  },
);

server.tool(
  "omni_config",
  "View or update the live MCP connection config. host/port/token changes affect every subsequent bridge call in this session. Use this to point at a different device, or to set a token obtained by omni_pair.",
  {
    show: z.boolean().optional().describe("Return the current config (default true)"),
    host: z.string().optional().describe("New host or IP"),
    port: z.number().int().positive().optional().describe("New port (default 26911)"),
    token: z.string().nullable().optional().describe("New token (32 hex chars). Pass null to clear."),
    autoTranslateBlocks: z.boolean().optional().describe("Default true; disable to pass 1.8 names verbatim"),
    forgeCompatRepoUrl: z.string().nullable().optional().describe("Override the Forge compat-layer mirror URL. Pass null to restore the default public mirror."),
    commandBlocksRepoUrl: z.string().nullable().optional().describe("Override the command-block system mirror URL. Pass null to restore the default public mirror."),
  },
  async ({ show, host, port, token, autoTranslateBlocks, forgeCompatRepoUrl, commandBlocksRepoUrl }) => {
    if (host !== undefined) (config as { host: string }).host = host;
    if (port !== undefined) (config as { port: number }).port = port;
    if (token !== undefined) (config as { token: string | null }).token = token;
    if (autoTranslateBlocks !== undefined) (config as { autoTranslateBlocks: boolean }).autoTranslateBlocks = autoTranslateBlocks;
    if (forgeCompatRepoUrl !== undefined) (config as { forgeCompatRepoUrl: string | null }).forgeCompatRepoUrl = forgeCompatRepoUrl || DEFAULT_FORGE_COMPAT_REPO;
    if (commandBlocksRepoUrl !== undefined) (config as { commandBlocksRepoUrl: string | null }).commandBlocksRepoUrl = commandBlocksRepoUrl || DEFAULT_COMMAND_BLOCKS_REPO;
    return show !== false ? text(describeConfig()) : text("Config updated.");
  },
);

server.tool(
  "omni_state",
  "Snapshot of the running game: status state, screen, mode, player position/health/food, world, devpatch status. Call this BEFORE every interaction to confirm the world you think is loaded is actually loaded.",
  {},
  async () => json(await trap(async () => bridge.get("/omni/state"))),
);

server.tool(
  "omni_help",
  "Self-describing endpoint catalog the running device serves (the engine returns its own list). Use this to discover platform-specific additions.",
  {},
  async () => json(await trap(async () => bridge.get("/omni/help"))),
);

server.tool(
  "omni_logs",
  "In-game log ring (TRACE..FATAL + AGENT). Supports `since` (sequence cursor), `limit`, `level` (min severity), `source` substring, `q` substring, `tail` (file tail bytes).",
  {
    since: z.number().int().nonnegative().optional(),
    limit: z.number().int().positive().max(2000).optional(),
    level: z.enum(["TRACE", "DEBUG", "INFO", "WARN", "ERROR", "FATAL"]).optional(),
    source: z.string().optional(),
    q: z.string().optional(),
    tail: z.number().int().positive().max(500).optional(),
  },
  async (q) => json(await trap(async () => bridge.get("/omni/logs", q))),
);

server.tool(
  "omni_errors",
  "Convenience for /omni/logs with min severity hardcoded to WARN. Use this first when something looks wrong.",
  {
    since: z.number().int().nonnegative().optional(),
    limit: z.number().int().positive().max(2000).optional(),
    source: z.string().optional(),
    q: z.string().optional(),
  },
  async (q) => json(await trap(async () => bridge.get("/omni/errors", q))),
);

server.tool(
  "omni_notifications",
  "Grouped WARN/ERROR/FATAL by source. Compact issue feed (one row per source with count + sample).",
  { since: z.number().int().nonnegative().optional() },
  async (q) => json(await trap(async () => bridge.get("/omni/notifications", q))),
);

server.tool(
  "omni_agentlog",
  "Write your own annotation into the log ring. Use this to mark phases of an agent run (e.g. `phase 1: scaffolding world`).",
  {
    message: z.string().min(1).max(2000),
    level: z.enum(["AGENT", "INFO", "WARN"]).optional(),
  },
  async ({ message, level }) =>
    json(await trap(async () => bridge.post("/omni/agentlog", { message, level: level ?? "AGENT" }))),
);

server.tool(
  "omni_devpatch_verify",
  "Compare source-file sha256 against the active DevPatch inventory on the device. Returns mismatches (changed_since_patch), missing (tracked but not sent), and matches. NO-OP envelope when no devpatch is active.",
  {
    files: z.array(z.object({ path: z.string(), sha256: z.string() })).optional(),
  },
  async ({ files }) =>
    json(await trap(async () => bridge.post("/omni/devpatch/verify", { files: files ?? [] }))),
);

// =====================================================================
// WORLDS
// =====================================================================

server.tool(
  "omni_worlds",
  "List saved worlds. Returns the full list only when no world is running; otherwise reports the running world with a note.",
  {},
  async () => json(await trap(async () => bridge.get("/omni/worlds"))),
);

server.tool(
  "omni_world_create",
  "Create a new world. Optional `mods` stages them before launch. Template ids: void_single (1x1 indestructible bedrock), void_platform_7x7 (7x7 breakable grass), flat, default.",
  {
    name: z.string().min(1).max(64).describe("Folder name. Allowed: a-z, 0-9, _, -"),
    template: z.enum(["void_single", "void_platform_7x7", "flat", "default"]).optional(),
    gametype: z.enum(["survival", "creative", "adventure", "spectator"]).optional(),
    cheats: z.boolean().optional(),
    seed: z.string().optional(),
    mods: z.array(z.object({ filename: z.string(), dataB64: z.string() })).optional(),
  },
  async (args) => json(await trap(async () => bridge.post("/omni/world/create", args))),
);

server.tool(
  "omni_world_enter",
  "Load a saved world by folder name (call omni_worlds first to get the name).",
  { name: z.string().min(1) },
  async ({ name }) => json(await trap(async () => bridge.post("/omni/world/enter", { name }))),
);

server.tool(
  "omni_world_quit",
  "Back to the main menu. Required before omni_world_create if a world is already running.",
  {},
  async () => json(await trap(async () => bridge.post("/omni/world/quit", {}))),
);

server.tool(
  "omni_mapdev_status",
  "MapDev apply-ledger state and current map name.",
  {},
  async () => json(await trap(async () => bridge.get("/omni/mapdev/status"))),
);

server.tool(
  "omni_mapdev_mode",
  "Dual-mode switch for the running map (the DEV <-> PLAY preview system). Call with no args to QUERY the current mode. mode='play' (alias 'preview') = PREVIEW: every command block becomes invisible, unopenable, unbreakable and untargetable while ALL command-block logic (impulse/repeating/chain, redstone, functions, schedulers) keeps running — the map behaves exactly as published. mode='dev' = full editing shape. Switching is instant (chunk meshes rebuild), race-free (server-thread scheduled) and persisted per map in mapmode.json. After switching to PLAY, always verify the map still WORKS (hiding never disables logic). Same unified kernel as /omni_dev mode and the pause-menu Map Dev screen.",
  {
    mode: z.enum(["dev", "play", "preview", "development"]).optional().describe("Omit to query the current mode. dev = editing shape; play/preview = published-map shape."),
    by: z.string().max(64).optional().describe("Who switched (audit trail). Defaults to the MCP agent."),
  },
  async ({ mode, by }) =>
    json(
      await trap(async () =>
        bridge.post("/omni/mapdev/mode", {
          ...(mode ? { mode } : {}),
          ...(by ? { by: `mcp:${by}` } : { by: "mcp-agent" }),
        }),
      ),
    ),
);

server.tool(
  "omni_map_guide",
  "The complete professional map-development master guide (same content as the omnimod://knowledge/map-dev-guide resource): the 8-phase workflow, the full command surface (modern MCBP syntax + command-block modes), map functions, dual-mode DEV/PLAY testing, verification battery and handoff protocol. Read this once per session before building a map; use omni_knowledge(topic='mapdev') for the compact phase summary.",
  {},
  async () => {
    try {
      const p = join(HERE, "..", "docs", "MAP_DEV_MASTER_GUIDE.md");
      return text(await readFile(p, "utf8"));
    } catch {
      return text("MAP_DEV_MASTER_GUIDE.md not found next to the package — the guide resource is only available when running from the repo checkout.");
    }
  },
);

// =====================================================================
// MAP BUILDING
// =====================================================================

server.tool(
  "omni_block_translate",
  "Translate ONE 1.20 block id to its 1.8 form (with metadata). Returns translated, passthrough, or unresolved. This is the function to call before any 1.20 block name goes into an op — there is NO alias table on the placement path in the engine.",
  { id: z.string().describe("Block id, e.g. 'minecraft:oak_planks' or 'white_wool'"), meta: z.number().int().min(0).max(15).optional() },
  async ({ id, meta }) => json(translateBlock(id, meta ?? 0)),
);

server.tool(
  "omni_item_translate",
  "Translate ONE 1.20 item id to its 1.8 form (with metadata). Same rules as omni_block_translate but for the item registry (187 entries).",
  { id: z.string(), meta: z.number().int().min(0).max(15).optional() },
  async ({ id, meta }) => json(translateItem(id, meta ?? 0)),
);

server.tool(
  "omni_block_search",
  "Fuzzy search the 1.8 registry (198 blocks / 187 items) and the alias table. Returns exact-1.8 matches, 1.20→1.8 aliases, and 1.20 names that have no 1.8 equivalent.",
  {
    query: z.string().min(1).max(64),
    kind: z.enum(["block", "item"]).default("block"),
    limit: z.number().int().positive().max(200).optional(),
  },
  async ({ query, kind, limit }) => json(searchNames(query, kind, limit ?? 40)),
);

server.tool(
  "omni_batch_validate",
  "Translate and validate a raw MapDev op batch WITHOUT sending it. Returns the cleaned batch + a list of errors and warnings (e.g. unknown block names, region over 1M blocks, y out of range, op count over 20k).",
  {
    name: z.string().default("agent-batch"),
    ops: z.array(z.record(z.string(), z.unknown())).describe("List of MapDev ops. Each op must have an `op` field."),
    autoTranslate: z.boolean().default(true),
  },
  async ({ name, ops, autoTranslate }) =>
    json(buildBatch(name, ops as Op[], autoTranslate)),
);

server.tool(
  "omni_batch_apply",
  "Translate + validate + send a raw MapDev op batch to the bridge. The engine applies it within ~2s of the world being loaded.",
  {
    name: z.string().default("agent-batch"),
    filename: z.string().optional().describe("Overrides the auto-generated filename. Must end .json."),
    ops: z.array(z.record(z.string(), z.unknown())),
    autoTranslate: z.boolean().default(true),
    dryRun: z.boolean().default(false).describe("If true, build and return the batch without sending."),
  },
  async ({ name, filename, ops, autoTranslate, dryRun }) => {
    const report = buildBatch(name, ops as Op[], autoTranslate);
    if (report.errors.length > 0) {
      return text(`Batch rejected before send. Fix these errors and retry:\n${report.errors.map((e) => ` - ${e}`).join("\n")}`);
    }
    if (dryRun) return json({ ...report, sent: false });
    const fn = safeBatchFileName(filename ?? `${name}-${Date.now()}.json`);
    const body = JSON.stringify(report.batch);
    const r = await trap(async () => bridge.post("/omni/mapdev/write", { filename: fn, content: body }));
    return json({ ...report, sent: true, filename: fn, response: r });
  },
);

server.tool(
  "omni_shape_solid_box",
  "Solid cuboid (1 fill_area op). Coordinates are inclusive.",
  {
    block: z.string().default("minecraft:stone"),
    meta: z.number().int().min(0).max(15).default(0),
    from: z.tuple([z.number().int(), z.number().int(), z.number().int()]),
    to: z.tuple([z.number().int(), z.number().int(), z.number().int()]),
  },
  async (a) => json(Shapes.solidBox(a.block, a.meta, a.from, a.to)),
);

server.tool(
  "omni_shape_hollow_box",
  "Hollow cuboid shell as up to 6 fill_area ops. Floor/ceiling/walls can be toggled independently.",
  {
    block: z.string().default("minecraft:stone"),
    meta: z.number().int().min(0).max(15).default(0),
    from: z.tuple([z.number().int(), z.number().int(), z.number().int()]),
    to: z.tuple([z.number().int(), z.number().int(), z.number().int()]),
    floor: z.boolean().default(true),
    ceiling: z.boolean().default(true),
    walls: z.boolean().default(true),
  },
  async (a) =>
    json(
      Shapes.hollowBox(a.block, a.meta, a.from, a.to, {
        floor: a.floor,
        ceiling: a.ceiling,
        walls: a.walls,
      }),
    ),
);

server.tool(
  "omni_shape_cylinder",
  "Vertical cylinder. Solid by default. Each y-layer is one or two fill_area runs.",
  {
    block: z.string().default("minecraft:stone"),
    meta: z.number().int().min(0).max(15).default(0),
    center: z.tuple([z.number().int(), z.number().int(), z.number().int()]),
    radius: z.number().int().positive().max(500),
    height: z.number().int().positive().max(256),
    hollow: z.boolean().default(false),
  },
  async (a) => json(Shapes.cylinder(a.block, a.meta, a.center, a.radius, a.height, a.hollow)),
);

server.tool(
  "omni_shape_sphere",
  "Sphere (or ellipsoid via 3-element radius). Rasterized as x-runs per (y,z) row.",
  {
    block: z.string().default("minecraft:stone"),
    meta: z.number().int().min(0).max(15).default(0),
    center: z.tuple([z.number().int(), z.number().int(), z.number().int()]),
    radius: z.union([z.number().int().positive().max(500), z.tuple([z.number().int(), z.number().int(), z.number().int()])]),
    hollow: z.boolean().default(false),
  },
  async (a) => json(Shapes.sphere(a.block, a.meta, a.center, a.radius, a.hollow)),
);

server.tool(
  "omni_shape_pyramid",
  "Stepped square pyramid, 1 fill per layer. `hollow=true` skips the interior of each layer.",
  {
    block: z.string().default("minecraft:sandstone"),
    meta: z.number().int().min(0).max(15).default(0),
    center: z.tuple([z.number().int(), z.number().int(), z.number().int()]),
    baseRadius: z.number().int().positive().max(500),
    hollow: z.boolean().default(false),
  },
  async (a) => json(Shapes.pyramid(a.block, a.meta, a.center, a.baseRadius, a.hollow)),
);

server.tool(
  "omni_shape_gable_roof",
  "Gable roof over a footprint. Ridge runs along the given axis. Each course is two fills (both slopes).",
  {
    block: z.string().default("minecraft:stone"),
    meta: z.number().int().min(0).max(15).default(0),
    from: z.tuple([z.number().int(), z.number().int(), z.number().int()]),
    to: z.tuple([z.number().int(), z.number().int(), z.number().int()]),
    ridgeAxis: z.enum(["x", "z"]).default("x"),
    overhang: z.number().int().min(0).max(20).default(1),
  },
  async (a) => json(Shapes.gableRoof(a.block, a.meta, a.from, a.to, a.ridgeAxis, a.overhang)),
);

server.tool(
  "omni_shape_hip_roof",
  "Hip roof over a footprint. Inset by 1 each layer until point. Empty middle kept solid (1 fill at apex).",
  {
    block: z.string().default("minecraft:stone"),
    meta: z.number().int().min(0).max(15).default(0),
    from: z.tuple([z.number().int(), z.number().int(), z.number().int()]),
    to: z.tuple([z.number().int(), z.number().int(), z.number().int()]),
    overhang: z.number().int().min(0).max(20).default(1),
  },
  async (a) => json(Shapes.hipRoof(a.block, a.meta, a.from, a.to, a.overhang)),
);

server.tool(
  "omni_shape_building",
  "One-call house: foundation (optional), floor, walls, roof, centered door, window band. This is the answer to 'build me a house' / 'build me a tower' / 'build me a small castle'.",
  {
    origin: z.tuple([z.number().int(), z.number().int(), z.number().int()]).describe("Min x, y, z corner of the foundation (interior floor is at y=origin.y)."),
    width: z.number().int().min(3).max(200),
    depth: z.number().int().min(3).max(200),
    height: z.number().int().min(2).max(200),
    wallBlock: z.string().default("minecraft:cobblestone"),
    wallMeta: z.number().int().min(0).max(15).default(0),
    floorBlock: z.string().default("minecraft:stone"),
    floorMeta: z.number().int().min(0).max(15).default(0),
    foundationBlock: z.string().optional().describe("If set, a 1-block-thick layer under the floor using this block."),
    foundationMeta: z.number().int().min(0).max(15).default(0),
    roofStyle: z.enum(["none", "flat", "gable", "hip"]).default("gable"),
    roofBlock: z.string().default("minecraft:stone"),
    roofMeta: z.number().int().min(0).max(15).default(0),
    roofRidgeAxis: z.enum(["x", "z"]).default("x"),
    roofOverhang: z.number().int().min(0).max(20).default(1),
    doorSide: z.enum(["none", "north", "south", "east", "west"]).default("south"),
    doorWidth: z.number().int().min(1).max(3).default(1),
    doorHeight: z.number().int().min(2).max(3).default(2),
    windowsEnabled: z.boolean().default(true),
    windowYOffset: z.number().int().min(1).max(50).default(2),
    windowSpacing: z.number().int().min(2).max(20).default(4),
    windowHeight: z.number().int().min(1).max(3).default(2),
    windowBlock: z.string().default("minecraft:glass_pane"),
    windowMeta: z.number().int().min(0).max(15).default(0),
  },
  async (a) =>
    json(
      Shapes.building({
        origin: a.origin,
        width: a.width,
        depth: a.depth,
        height: a.height,
        wallBlock: a.wallBlock,
        wallMeta: a.wallMeta,
        floorBlock: a.floorBlock,
        floorMeta: a.floorMeta,
        foundationBlock: a.foundationBlock,
        foundationMeta: a.foundationMeta,
        roof: a.roofStyle === "none" ? undefined : { style: a.roofStyle, block: a.roofBlock, meta: a.roofMeta, ridgeAxis: a.roofRidgeAxis, overhang: a.roofOverhang },
        door: a.doorSide === "none" ? undefined : { side: a.doorSide, width: a.doorWidth, height: a.doorHeight },
        windows: a.windowsEnabled ? { yOffset: a.windowYOffset, spacing: a.windowSpacing, height: a.windowHeight, block: a.windowBlock, meta: a.windowMeta } : undefined,
      }),
    ),
);

server.tool(
  "omni_shape_line",
  "3D Bresenham line of place_block ops. Use for paths, fences, wires.",
  {
    block: z.string().default("minecraft:fence"),
    meta: z.number().int().min(0).max(15).default(0),
    from: z.tuple([z.number().int(), z.number().int(), z.number().int()]),
    to: z.tuple([z.number().int(), z.number().int(), z.number().int()]),
  },
  async (a) => json(Shapes.line(a.block, a.meta, a.from, a.to)),
);

server.tool(
  "omni_blueprint",
  "Run any sequence of high-level shape calls in a single MCP round-trip. Provide a list of named operations; the response is the full op list ready to feed into omni_batch_apply (or auto-applied if apply=true).",
  {
    apply: z.boolean().default(false).describe("If true, validate + send as one batch. If false, just emit the ops."),
    batchName: z.string().default("blueprint"),
    steps: z.array(
      z.discriminatedUnion("kind", [
        z.object({ kind: z.literal("solidBox"), block: z.string(), meta: z.number().int().min(0).max(15).default(0), from: z.tuple([z.number().int(), z.number().int(), z.number().int()]), to: z.tuple([z.number().int(), z.number().int(), z.number().int()]) }),
        z.object({ kind: z.literal("hollowBox"), block: z.string(), meta: z.number().int().min(0).max(15).default(0), from: z.tuple([z.number().int(), z.number().int(), z.number().int()]), to: z.tuple([z.number().int(), z.number().int(), z.number().int()]), floor: z.boolean().default(true), ceiling: z.boolean().default(true), walls: z.boolean().default(true) }),
        z.object({ kind: z.literal("cylinder"), block: z.string(), meta: z.number().int().min(0).max(15).default(0), center: z.tuple([z.number().int(), z.number().int(), z.number().int()]), radius: z.number().int().positive().max(500), height: z.number().int().positive().max(256), hollow: z.boolean().default(false) }),
        z.object({ kind: z.literal("sphere"), block: z.string(), meta: z.number().int().min(0).max(15).default(0), center: z.tuple([z.number().int(), z.number().int(), z.number().int()]), radius: z.union([z.number().int().positive().max(500), z.tuple([z.number().int(), z.number().int(), z.number().int()])]), hollow: z.boolean().default(false) }),
        z.object({ kind: z.literal("pyramid"), block: z.string(), meta: z.number().int().min(0).max(15).default(0), center: z.tuple([z.number().int(), z.number().int(), z.number().int()]), baseRadius: z.number().int().positive().max(500), hollow: z.boolean().default(false) }),
        z.object({ kind: z.literal("gableRoof"), block: z.string(), meta: z.number().int().min(0).max(15).default(0), from: z.tuple([z.number().int(), z.number().int(), z.number().int()]), to: z.tuple([z.number().int(), z.number().int(), z.number().int()]), ridgeAxis: z.enum(["x", "z"]).default("x"), overhang: z.number().int().min(0).max(20).default(1) }),
        z.object({ kind: z.literal("hipRoof"), block: z.string(), meta: z.number().int().min(0).max(15).default(0), from: z.tuple([z.number().int(), z.number().int(), z.number().int()]), to: z.tuple([z.number().int(), z.number().int(), z.number().int()]), overhang: z.number().int().min(0).max(20).default(1) }),
        z.object({ kind: z.literal("building"), origin: z.tuple([z.number().int(), z.number().int(), z.number().int()]), width: z.number().int().min(3).max(200), depth: z.number().int().min(3).max(200), height: z.number().int().min(2).max(200), wallBlock: z.string().default("minecraft:cobblestone"), wallMeta: z.number().int().min(0).max(15).default(0), floorBlock: z.string().default("minecraft:stone"), roofStyle: z.enum(["none", "flat", "gable", "hip"]).default("gable"), roofBlock: z.string().default("minecraft:stone") }),
        z.object({ kind: z.literal("line"), block: z.string(), meta: z.number().int().min(0).max(15).default(0), from: z.tuple([z.number().int(), z.number().int(), z.number().int()]), to: z.tuple([z.number().int(), z.number().int(), z.number().int()]) }),
        z.object({ kind: z.literal("carve"), from: z.tuple([z.number().int(), z.number().int(), z.number().int()]), to: z.tuple([z.number().int(), z.number().int(), z.number().int()]) }),
        z.object({ kind: z.literal("raw"), ops: z.array(z.record(z.string(), z.unknown())) }),
      ]),
    ),
  },
  async ({ apply, batchName, steps }) => {
    const out: Op[] = [];
    for (const s of steps) {
      switch (s.kind) {
        case "solidBox":    out.push(...Shapes.solidBox(s.block, s.meta, s.from, s.to)); break;
        case "hollowBox":   out.push(...Shapes.hollowBox(s.block, s.meta, s.from, s.to, { floor: s.floor, ceiling: s.ceiling, walls: s.walls })); break;
        case "cylinder":    out.push(...Shapes.cylinder(s.block, s.meta, s.center, s.radius, s.height, s.hollow)); break;
        case "sphere":      out.push(...Shapes.sphere(s.block, s.meta, s.center, s.radius, s.hollow)); break;
        case "pyramid":     out.push(...Shapes.pyramid(s.block, s.meta, s.center, s.baseRadius, s.hollow)); break;
        case "gableRoof":   out.push(...Shapes.gableRoof(s.block, s.meta, s.from, s.to, s.ridgeAxis, s.overhang)); break;
        case "hipRoof":     out.push(...Shapes.hipRoof(s.block, s.meta, s.from, s.to, s.overhang)); break;
        case "building":    out.push(...Shapes.building({
                              origin: s.origin, width: s.width, depth: s.depth, height: s.height,
                              wallBlock: s.wallBlock, wallMeta: s.wallMeta, floorBlock: s.floorBlock ?? "minecraft:stone",
                              roof: s.roofStyle === "none" ? undefined : { style: s.roofStyle, block: s.roofBlock ?? "minecraft:stone" },
                            })); break;
        case "line":        out.push(...Shapes.line(s.block, s.meta, s.from, s.to)); break;
        case "carve":       out.push(...Shapes.carve(s.from, s.to)); break;
        case "raw":         out.push(...(s.ops as Op[])); break;
      }
    }
    if (!apply) return json({ ops: out, count: out.length });
    const report = buildBatch(batchName, out, true);
    if (report.errors.length) {
      return text(`Blueprint rejected:\n${report.errors.map((e) => ` - ${e}`).join("\n")}`);
    }
    const fn = safeBatchFileName(`${batchName}-${Date.now()}.json`);
    const r = await trap(async () => bridge.post("/omni/mapdev/write", { filename: fn, content: JSON.stringify(report.batch) }));
    return json({ sent: true, filename: fn, estimatedBlocks: report.estimatedBlocks, bytes: report.bytes, response: r });
  },
);

// =====================================================================
// PLAYER & OBSERVATION
// =====================================================================

server.tool(
  "omni_command",
  "Run any in-game command (full-privilege, player-anchored). Response includes chat feedback.",
  { command: z.string().min(1).describe("Command without the leading /") },
  async ({ command }) => json(await trap(async () => bridge.post("/omni/command", { command: command.replace(/^\/+/, "") }))),
);

server.tool(
  "omni_player",
  "Player actions: teleport, move, look, lookAt, give, say, attack, use, hotbar, drop, sneak, sprint, jump. Per-action fields vary; see the per-action constraints in the tool description.",
  {
    action: z.enum(["teleport", "move", "look", "lookAt", "give", "say", "attack", "use", "hotbar", "drop", "sneak", "sprint", "jump"]),
    player: z.string().optional(),
    x: z.number().optional(), y: z.number().optional(), z: z.number().optional(),
    yaw: z.number().optional(), pitch: z.number().optional(),
    item: z.string().optional(), count: z.number().int().min(1).max(576).optional(), meta: z.number().int().min(0).max(15).optional(),
    message: z.string().max(256).optional(),
    entity: z.number().int().positive().optional(),
    slot: z.number().int().min(0).max(8).optional(),
    all: z.boolean().optional(),
    enable: z.boolean().optional(),
  },
  async (a) => {
    const body: Record<string, unknown> = { action: a.action, player: a.player };
    if (a.x !== undefined) body.x = a.x; if (a.y !== undefined) body.y = a.y; if (a.z !== undefined) body.z = a.z;
    if (a.yaw !== undefined) body.yaw = a.yaw; if (a.pitch !== undefined) body.pitch = a.pitch;
    if (a.item !== undefined) body.item = a.item; if (a.count !== undefined) body.count = a.count; if (a.meta !== undefined) body.meta = a.meta;
    if (a.message !== undefined) body.message = a.message;
    if (a.entity !== undefined) body.entity = a.entity;
    if (a.slot !== undefined) body.slot = a.slot;
    if (a.all !== undefined) body.all = a.all;
    if (a.enable !== undefined) body.enable = a.enable;
    return json(await trap(async () => bridge.post("/omni/player", body)));
  },
);

server.tool(
  "omni_inventory",
  "Full inventory, hotbar, and armor (slot id+label+item id+count+meta+damage).",
  {},
  async () => json(await trap(async () => bridge.get("/omni/player/inventory"))),
);

server.tool(
  "omni_world_scan",
  "Block and entity snapshot inside a 64^3 box. Hard cap 262,144 blocks. Results truncated to maxBlocks/maxEntities.",
  {
    from: z.tuple([z.number().int(), z.number().int(), z.number().int()]),
    to: z.tuple([z.number().int(), z.number().int(), z.number().int()]),
    includeBlocks: z.boolean().default(true),
    includeEntities: z.boolean().default(true),
    blockFilter: z.string().optional(),
    maxBlocks: z.number().int().positive().max(50000).default(5000),
    maxEntities: z.number().int().positive().max(5000).default(200),
  },
  async (a) => json(await trap(async () => bridge.post("/omni/world/scan", a))),
);

server.tool(
  "omni_world_raycast",
  "Raycast from origin (or player eye) along direction. Returns block hit, face, distance, plus entity hit if any.",
  {
    distance: z.number().positive().max(256).default(64),
    origin: z.tuple([z.number(), z.number(), z.number()]).optional(),
    direction: z.tuple([z.number(), z.number(), z.number()]).optional(),
    includeEntities: z.boolean().default(true),
  },
  async (a) => json(await trap(async () => bridge.post("/omni/world/raycast", a))),
);

server.tool(
  "omni_chat",
  "Broadcast a blue [Agent] chat line.",
  { message: z.string().min(1).max(256) },
  async ({ message }) => json(await trap(async () => bridge.post("/omni/chat", { message }))),
);

// =====================================================================
// MOD AUTHORING
// =====================================================================

server.tool(
  "omni_mod_add",
  "Stage a mod JAR (base64) into a world. The next world load picks it up. If a world is running, reload it via omni_world_quit + omni_world_enter to activate.",
  {
    filename: z.string().min(1).max(128).regex(/^[^/\\.\x00]+$/),
    dataB64: z.string().min(1).describe("Base64-encoded JAR bytes. 32 MB cap."),
    world: z.string().optional(),
  },
  async (a) => json(await trap(async () => bridge.post("/omni/mod/add", a))),
);

server.tool(
  "omni_mod_scaffold",
  "Write a Forge 1.20.1-shaped mod folder to disk. Output is a folder (not a ZIP) — zip it yourself before omni_mod_add, or stage it via the folder mod path on the engine side. Every JSON key written is one the engine actually reads (see scaffold.ts comments).",
  {
    outDir: z.string().describe("Absolute path of an empty directory to create the mod in."),
    spec: z.object({
      modId: z.string().min(1).max(64),
      displayName: z.string().min(1).max(128),
      version: z.string().min(1).max(32),
      description: z.string().optional(),
      author: z.string().optional(),
      modLoader: z.enum(["forge", "neoforge", "fabric"]).optional(),
      loaderVersion: z.string().optional(),
      items: z.array(z.object({ id: z.string(), displayName: z.string().optional(), texture: z.string().optional() })).optional(),
      blocks: z.array(z.object({
        id: z.string(),
        displayName: z.string().optional(),
        texture: z.string().optional(),
        recipe: z.object({
          pattern: z.array(z.string().min(1).max(3)).min(1).max(3),
          key: z.record(z.string(), z.string()),
          result: z.object({ item: z.string(), count: z.number().int().min(1).max(64).optional() }),
        }).optional(),
      })).optional(),
      recipes: z.array(z.record(z.string(), z.unknown())).optional(),
      guis: z.array(z.object({ filename: z.string(), payload: z.record(z.string(), z.unknown()) })).optional(),
      extraAssets: z.array(z.object({ relPath: z.string(), content: z.string() })).optional(),
    }),
  },
  async ({ outDir, spec }) => {
    const abs = isAbsolute(outDir) ? outDir : resolve(process.cwd(), outDir);
    const r = await trap(async () => scaffoldMod(spec as ModSpec, abs));
    return json(r);
  },
);

server.tool(
  "omni_mod_inspect",
  "Inspect a Forge mod (JAR or unzipped folder). Returns metadata, file counts, parsed models/recipes/GUIs, and a problem list (each problem cites the engine code that would trip on it).",
  { path: z.string().describe("Absolute path to a mod JAR or folder.") },
  async ({ path }) => {
    const abs = isAbsolute(path) ? path : resolve(process.cwd(), path);
    return json(await trap(async () => inspectMod(abs)));
  },
);

server.tool(
  "omni_recipe_validate",
  "Static linter for a recipe JSON object. Checks the keys the engine actually reads (ModernRecipeRuntime.java:565-1078), the 3x3 pattern limit, the 1.8 vanilla registry for any non-tag ingredient, and the 1.20 result form compatibility.",
  { recipe: z.record(z.string(), z.unknown()), name: z.string().optional() },
  async ({ recipe, name }) => {
    const problems: { severity: "error" | "warning" | "info"; id: string; detail: string; cite: string }[] = [];
    const label = name ?? "(unnamed)";
    const r = recipe as { type?: string; pattern?: string[]; key?: Record<string, unknown>; result?: unknown; ingredients?: unknown[] };
    const t = String(r.type ?? "minecraft:crafting_shaped");
    if (t === "minecraft:crafting_shaped" || /shaped/.test(t)) {
      if (!Array.isArray(r.pattern)) problems.push({ severity: "error", id: "pattern-missing", detail: `${label}: crafting_shaped needs a "pattern" array.`, cite: "ModernRecipeRuntime.java:726-749" });
      else {
        for (const row of r.pattern) {
          if (row.length > 3 || r.pattern.length > 3) {
            problems.push({ severity: "error", id: "pattern-too-large", detail: `${label}: pattern ${r.pattern.length}x${row.length} exceeds the 3x3 cap.`, cite: "ModernRecipeRuntime.java:747-749" });
            break;
          }
        }
      }
      if (!r.key) problems.push({ severity: "warning", id: "key-missing", detail: `${label}: crafting_shaped without a "key" cannot be matched.`, cite: "ModernRecipeRuntime.java:751-762" });
    } else if (t === "minecraft:crafting_shapeless" || /shapeless/.test(t)) {
      if (!Array.isArray(r.ingredients)) problems.push({ severity: "error", id: "ingredients-missing", detail: `${label}: crafting_shapeless needs "ingredients".`, cite: "ModernRecipeRuntime.java:807" });
      if (Array.isArray(r.ingredients) && r.ingredients.length > 9) problems.push({ severity: "error", id: "too-many-ingredients", detail: `${label}: shapeless ingredients cap is 9.`, cite: "ModernRecipeRuntime.java:807" });
    }
    const checkItem = (id: unknown, where: string) => {
      if (typeof id !== "string") return;
      const [ns, name] = id.includes(":") ? id.split(":") : ["minecraft", id];
      if (ns === "minecraft" && name) {
        const ok = ["white","orange","magenta","light_blue","yellow","lime","pink","gray","light_gray","cyan","purple","blue","brown","green","red","black"].includes(name) ||
          ["dandelion","poppy","blue_orchid","allium","azure_bluet","red_tulip","orange_tulip","white_tulip","pink_tulip","oxeye_daisy","sunflower","lilac","rose_bush","peony"].includes(name);
        if (ok) return;
        if (!/^minecraft:[a-z0-9_]+$/.test(`minecraft:${name}`)) {
          problems.push({ severity: "warning", id: "item-not-in-18", detail: `${where}: "${id}" is not a 1.8 registry name. The bridge has its own VANILLA_ITEM_RENAME_120_TO_18 (ModernRecipeRuntime.java:45-80) for recipe ingredients, but if the mod does not provide a rename entry the recipe will be dropped silently.`, cite: "ModernRecipeRuntime.java:45-80" });
        }
      }
    };
    if (r.key) for (const [k, v] of Object.entries(r.key)) checkItem((v as { item?: string })?.item, `${label} key[${k}]`);
    if (Array.isArray(r.ingredients)) for (const [i, ing] of r.ingredients.entries()) {
      const arr = Array.isArray(ing) ? ing : [ing];
      for (const e of arr) checkItem((e as { item?: string })?.item, `${label} ingredients[${i}]`);
    }
    return json({ name: label, type: t, problems });
  },
);

server.tool(
  "omni_knowledge",
  "Fetch the static OmniMod knowledge base. Topics: identity, rules, pitfalls, commands, recipe shapes, staging paths, endpoint catalog, troubleshooting.",
  {
    topic: z.enum([
      "identity",
      "rules",
      "pitfalls",
      "commands",
      "recipes",
      "staging",
      "endpoints",
      "troubleshooting",
      "mapdev",
      "repos",
      "all",
    ]),
    pitfallId: z.string().optional().describe("When topic=pitfalls, return only the named entry (e.g. '1.20-block-name-noalias')."),
  },
  async ({ topic, pitfallId }) => {
    switch (topic) {
      case "identity":         return json(PROJECT_IDENTITY);
      case "rules":            return json(NON_NEGOTIABLE_RULES);
      case "pitfalls":         return json(pitfallId ? COMMON_PITFALLS.filter((p) => p.id === pitfallId) : COMMON_PITFALLS);
      case "commands":         return json(COMMAND_GUIDE);
      case "recipes":          return json(RECIPE_GUIDE);
      case "staging":          return json(STAGING_PATH_TEMPLATE);
      case "endpoints":        return json(ENDPOINT_CATALOG);
      case "troubleshooting":  return json(MOD_TROUBLESHOOTING);
      case "mapdev":           return json({ workflow: MAP_DEV_GUIDE, fullGuide: "omni_map_guide tool or omnimod://knowledge/map-dev-guide resource", modeTool: "omni_mapdev_mode", note: "The 8-phase professional map workflow. The full guide text is one call away." });
      case "repos":            return json({ repos: sourceRepos(config.forgeCompatRepoUrl, config.commandBlocksRepoUrl), note: "Public mirrors of the two engine systems (pre-linked by default; override with OMNIMOD_FORGE_COMPAT_REPO / OMNIMOD_COMMAND_BLOCKS_REPO env vars or omni_config)." });
      case "all":              return json({ identity: PROJECT_IDENTITY, rules: NON_NEGOTIABLE_RULES, pitfalls: COMMON_PITFALLS, commands: COMMAND_GUIDE, recipes: RECIPE_GUIDE, staging: STAGING_PATH_TEMPLATE, endpoints: ENDPOINT_CATALOG, troubleshooting: MOD_TROUBLESHOOTING, mapdev: MAP_DEV_GUIDE, repos: sourceRepos(config.forgeCompatRepoUrl, config.commandBlocksRepoUrl) });
    }
  },
);

// =====================================================================
// MAP CONTEXT PACK (the per-map agent documents in worlds/<map>/_dev/)
// =====================================================================

/**
 * Every tool in this group works on the map FOLDER, not the HTTP bridge, so it
 * keeps working when Agent Link is off, on Web targets, and on map folders that
 * were copied off a device. Folder resolution is shared and reports precisely
 * what it tried when it fails (no silent "not found").
 */
const mapLocator = {
  map: z.string().optional().describe("Map/world folder name, e.g. my_village"),
  mapDir: z.string().optional().describe("Absolute path to the map folder itself (wins over `map`)"),
  worldsDir: z.string().optional().describe("Absolute path to the worlds folder that contains `map`"),
};

async function locate(a: { map?: string; mapDir?: string; worldsDir?: string }) {
  return MapDocs.resolveMapDir(a, { worldsDir: config.worldsDir, projectRoot: config.projectRoot });
}

server.tool(
  "omni_map_onboard",
  "START HERE for any map task. Locates the map folder, verifies the per-map agent context pack, and returns the mandatory documents (mandate + map overview + change log + file map + build system + block names + testing mandate) as text so you actually read them before building. Also reports missing/outdated/unwritten documents. Run this before your first batch on a map, even when connected to the bridge — the MCP knowledge base describes the engine, this pack describes THIS map.",
  {
    ...mapLocator,
    full: z.boolean().default(false).describe("Also return the reference docs (agent link API, mod authoring, mods in this map, troubleshooting, handoff protocol)"),
    autoBootstrap: z.boolean().default(true).describe("Create or repair the pack when documents are missing or version-stale"),
  },
  async (a) => {
    try {
      const { dir, map, how } = await locate(a);
      let bootstrap: MapDocs.BootstrapResult | null = null;
      let status = await MapDocs.packStatus(dir, map);
      if (a.autoBootstrap && !status.ok) {
        bootstrap = await MapDocs.bootstrapPack(dir, map);
        status = await MapDocs.packStatus(dir, map);
      }
      const rels = a.full ? [...MapDocs.READ_ORDER, ...MapDocs.REFERENCE_DOCS] : MapDocs.READ_ORDER;
      const docs = await MapDocs.readDocs(dir, rels);
      const head = [
        `Map folder resolved via ${how}: ${dir}`,
        "",
        status.summary,
        bootstrap
          ? `\nBootstrap ran: wrote=${bootstrap.written.length} refreshed=${bootstrap.refreshed.length} seeded=${bootstrap.seeded.length}`
          : "",
        status.unwritten.length
          ? `\nACTION REQUIRED: ${status.unwritten.join(", ")} ${status.unwritten.length === 1 ? "is" : "are"} still in the seeded state. Fill them in as part of this task (omni_map_overview / omni_map_changelog / omni_map_filemap).`
          : "",
        "",
        "=".repeat(72),
        "Below is the full text of the documents you are required to read.",
        "=".repeat(72),
      ]
        .filter(Boolean)
        .join("\n");
      const body = docs
        .map((d) =>
          [
            "",
            "#".repeat(72),
            `# FILE: _dev/${d.rel}`,
            "#".repeat(72),
            "",
            d.text ?? "(MISSING — run omni_map_bootstrap)",
          ].join("\n"),
        )
        .join("\n");
      return text(`${head}\n${body}`);
    } catch (e) {
      return text(describeError(e));
    }
  },
);

server.tool(
  "omni_map_docs",
  "Read specific documents from a map's agent context pack. Use omni_map_onboard first; use this for targeted lookups afterwards (e.g. just the troubleshooting file, or just the change log).",
  {
    ...mapLocator,
    files: z
      .array(z.string())
      .optional()
      .describe("Pack-relative paths, e.g. ['agent/08_TROUBLESHOOTING.md','CHANGE_LOG.md']. Omit to list what exists."),
  },
  async (a) => {
    try {
      const { dir, map } = await locate(a);
      if (!a.files || a.files.length === 0) {
        const status = await MapDocs.packStatus(dir, map);
        return json({
          mapDir: dir,
          devDir: status.devDir,
          readOrder: MapDocs.READ_ORDER,
          referenceDocs: MapDocs.REFERENCE_DOCS,
          docs: status.docs,
          batches: status.batches,
          verificationReports: status.verificationReports,
        });
      }
      const docs = await MapDocs.readDocs(dir, a.files);
      return text(
        docs
          .map((d) => `${"#".repeat(72)}\n# FILE: _dev/${d.rel}\n${"#".repeat(72)}\n\n${d.text ?? "(missing)"}`)
          .join("\n\n"),
      );
    } catch (e) {
      return text(describeError(e));
    }
  },
);

server.tool(
  "omni_map_bootstrap",
  "Create or repair the agent context pack inside a map folder. Static knowledge docs are (re)written when missing or version-stale; MAP_OVERVIEW.md / CHANGE_LOG.md / FILE_MAP.md are seeded only when absent and never overwritten. Use this for map folders the running game has not provisioned (copies pulled off a device, exported maps, Web-target saves).",
  {
    ...mapLocator,
    force: z.boolean().default(false).describe("Rewrite the static docs even when the version already matches"),
  },
  async (a) => {
    try {
      const { dir, map, how } = await locate(a);
      const r = await MapDocs.bootstrapPack(dir, map, { force: a.force });
      const status = await MapDocs.packStatus(dir, map);
      return json({ resolvedVia: how, ...r, statusAfter: status.summary.split("\n") });
    } catch (e) {
      return text(describeError(e));
    }
  },
);

server.tool(
  "omni_map_status",
  "Verify a map's context pack and workspace without changing anything: which documents exist, which are version-stale, which living documents are still unwritten, what batches exist, what the apply ledger says (ops/placed/failed per batch — Level 1 verification without the HTTP bridge), and which verification reports have been written.",
  { ...mapLocator },
  async (a) => {
    try {
      const { dir, map, how } = await locate(a);
      const status = await MapDocs.packStatus(dir, map);
      const ledger = await MapDocs.readLedger(dir);
      const ledgerRows = ledger
        ? Object.entries(ledger.entries).map(([file, e]) => ({
            file,
            ops: e.ops,
            placed: e.placed,
            failed: e.failed,
            appliedAt: new Date(e.appliedAtMs).toISOString(),
          }))
        : [];
      const unapplied = status.batches.filter((b) => !ledger || !(b in ledger.entries));
      const withFailures = ledgerRows.filter((r) => r.failed > 0);
      return json({
        resolvedVia: how,
        mapDir: dir,
        map,
        packVersionExpected: status.packVersionExpected,
        missing: status.missing,
        outdated: status.outdated,
        livingDocsStillSeeded: status.unwritten,
        batches: status.batches,
        batchesNotInLedger: unapplied,
        ledger: ledgerRows,
        batchesWithFailedOps: withFailures,
        verificationReports: status.verificationReports,
        verdict:
          status.missing.length || status.outdated.length
            ? "pack needs repair — run omni_map_bootstrap"
            : withFailures.length
              ? "batches applied with failed ops — investigate before continuing"
              : unapplied.length
                ? "batches pending apply — load the map or run /omni_dev apply in game"
                : "pack complete, ledger clean",
      });
    } catch (e) {
      return text(describeError(e));
    }
  },
);

server.tool(
  "omni_map_filemap",
  "Regenerate FILE_MAP.md for a map from the real folder contents: every file under _dev/ with owner/size/mtime, the world data files marked off-limits, every batch with its label and op count (flagging unparseable ones), the verification reports, and the sibling mod-staging folders. Run this after creating, renaming or deleting ANY file in the map.",
  {
    ...mapLocator,
    agent: z.string().optional().describe("Your name, recorded in the generated header"),
  },
  async (a) => {
    try {
      const { dir, map } = await locate(a);
      const r = await MapDocs.regenerateFileMap(dir, map, {
        ...(a.agent ? { agent: a.agent } : {}),
        ...(a.worldsDir ? { worldsDir: a.worldsDir } : {}),
      });
      return json({ path: r.path, entries: r.entries, bytes: r.bytes, preview: r.text.slice(0, 1500) });
    } catch (e) {
      return text(describeError(e));
    }
  },
);

server.tool(
  "omni_map_changelog",
  "Append an entry to a map's CHANGE_LOG.md (append-only: existing history is never rewritten). Required at the end of every task. To correct an earlier entry, set `corrects` and append a new entry instead of editing the old one. Pass `read: true` to read the log instead of writing.",
  {
    ...mapLocator,
    read: z.boolean().default(false).describe("Return the current change log instead of appending"),
    title: z.string().optional().describe("Short title, e.g. 'Built the market square'"),
    agent: z.string().optional().describe("Your model/tool name"),
    requested: z.string().optional().describe("The user's request, in their own words"),
    interpretation: z.string().optional().describe("Your numeric interpretation: origin, size, materials, orientation"),
    batches: z
      .array(
        z.object({
          file: z.string(),
          ops: z.number().int().optional(),
          placed: z.number().int().optional(),
          failed: z.number().int().optional(),
          what: z.string().optional(),
        }),
      )
      .optional(),
    blocksUsed: z.array(z.string()).optional().describe("Translated 1.8 ids with meta, e.g. ['planks(0) oak','wool(14) red']"),
    verification: z.array(z.string()).optional().describe("One line per check WITH its result. Omitting this marks the entry as unverified."),
    decisions: z.array(z.string()).optional().describe("Choices you made that the user did not specify"),
    notes: z.array(z.string()).optional().describe("Notes for the next agent: occupied regions, dead ends, why-decisions"),
    corrects: z.string().optional().describe("Which earlier entry this corrects, and why"),
    reportPath: z.string().optional().describe("Path of the verification report backing this entry"),
  },
  async (a) => {
    try {
      const { dir, map } = await locate(a);
      if (a.read) {
        const [doc] = await MapDocs.readDocs(dir, [MapDocs.LAYOUT.CHANGELOG_FILE]);
        return text(doc?.text ?? "(no change log yet — run omni_map_bootstrap)");
      }
      if (!a.title) return text("`title` is required when appending (or pass read: true).");
      const r = await MapDocs.appendChangelog(dir, map, {
        title: a.title,
        ...(a.agent ? { agent: a.agent } : {}),
        ...(a.requested ? { requested: a.requested } : {}),
        ...(a.interpretation ? { interpretation: a.interpretation } : {}),
        ...(a.batches ? { batches: a.batches } : {}),
        ...(a.blocksUsed ? { blocksUsed: a.blocksUsed } : {}),
        ...(a.verification ? { verification: a.verification } : {}),
        ...(a.decisions ? { decisions: a.decisions } : {}),
        ...(a.notes ? { notes: a.notes } : {}),
        ...(a.corrects ? { corrects: a.corrects } : {}),
        ...(a.reportPath ? { reportPath: a.reportPath } : {}),
      });
      return json({
        path: r.path,
        bytes: r.bytes,
        appended: r.appended,
        reminder: a.verification?.length
          ? "Entry recorded. Now refresh FILE_MAP.md (omni_map_filemap) and MAP_OVERVIEW.md (omni_map_overview)."
          : "WARNING: no verification lines were supplied, so this entry is recorded as UNVERIFIED. Run the battery in agent/04_TESTING_MANDATE.md and append a correction entry.",
      });
    } catch (e) {
      return text(describeError(e));
    }
  },
);

server.tool(
  "omni_map_overview",
  "Read MAP_OVERVIEW.md, or replace one of its numbered sections. This is where the user's actual goal, the build specification, and this map's coordinate conventions live — write it BEFORE building, and correct it whenever a previous agent recorded the goal wrongly. Sections: 1 Identity, 2 The user's goal, 3 Current build specification, 4 Coordinate conventions, 5 Mods in this map, 6 Open items, 7 Do not touch, 8 Notes.",
  {
    ...mapLocator,
    section: z.number().int().min(1).max(8).optional().describe("Section number to replace. Omit to read the whole file."),
    body: z.string().optional().describe("Markdown body for that section (replaces the section's current content)"),
  },
  async (a) => {
    try {
      const { dir, map } = await locate(a);
      if (a.section === undefined) {
        const [doc] = await MapDocs.readDocs(dir, [MapDocs.LAYOUT.OVERVIEW_FILE]);
        return text(
          [
            `Sections: ${MapDocs.OVERVIEW_SECTIONS.join(" · ")}`,
            "",
            doc?.text ?? "(no overview yet — run omni_map_bootstrap)",
          ].join("\n"),
        );
      }
      if (a.body === undefined) return text("`body` is required when `section` is given.");
      const r = await MapDocs.patchOverviewSection(dir, map, a.section, a.body);
      return json({ path: r.path, sectionReplaced: r.heading, bytes: r.bytes });
    } catch (e) {
      return text(describeError(e));
    }
  },
);

server.tool(
  "omni_map_report",
  "Write a verification report into worlds/<map>/_dev/state/verification/. Every task owes one. Pass `template: true` to get the blank report skeleton to fill in.",
  {
    ...mapLocator,
    slug: z.string().optional().describe("Short name, e.g. 'market-square'. The date is prefixed automatically."),
    content: z.string().optional().describe("The full report markdown"),
    template: z.boolean().default(false).describe("Return the blank template instead of writing"),
  },
  async (a) => {
    try {
      const { dir } = await locate(a);
      if (a.template) {
        const [doc] = await MapDocs.readDocs(dir, [
          `${MapDocs.LAYOUT.AGENT_SUBDIR}/${MapDocs.LAYOUT.TEMPLATES_SUBDIR}/verification-report-template.md`,
        ]);
        return text(doc?.text ?? "(template missing — run omni_map_bootstrap)");
      }
      if (!a.slug || !a.content) return text("`slug` and `content` are required (or pass template: true).");
      const r = await MapDocs.writeVerificationReport(dir, a.slug, a.content);
      return json({
        path: r.path,
        bytes: r.bytes,
        next: "Reference this path in your omni_map_changelog entry (reportPath), then run omni_map_filemap.",
      });
    } catch (e) {
      return text(describeError(e));
    }
  },
);

// =====================================================================
// RESOURCES (the static knowledge base, served as MCP resources)
// =====================================================================

server.resource(
  "OmniMod project identity",
  "omnimod://knowledge/identity",
  async () => ({
    contents: [{ uri: "omnimod://knowledge/identity", mimeType: "application/json", text: JSON.stringify(PROJECT_IDENTITY, null, 2) }],
  }),
);

server.resource(
  "OmniMod non-negotiable rules",
  "omnimod://knowledge/rules",
  async () => ({
    contents: [{ uri: "omnimod://knowledge/rules", mimeType: "application/json", text: JSON.stringify(NON_NEGOTIABLE_RULES, null, 2) }],
  }),
);

server.resource(
  "OmniMod pitfalls",
  "omnimod://knowledge/pitfalls",
  async () => ({
    contents: [{ uri: "omnimod://knowledge/pitfalls", mimeType: "application/json", text: JSON.stringify(COMMON_PITFALLS, null, 2) }],
  }),
);

server.resource(
  "OmniMod commands",
  "omnimod://knowledge/commands",
  async () => ({
    contents: [{ uri: "omnimod://knowledge/commands", mimeType: "application/json", text: JSON.stringify(COMMAND_GUIDE, null, 2) }],
  }),
);

server.resource(
  "OmniMod recipe shapes",
  "omnimod://knowledge/recipes",
  async () => ({
    contents: [{ uri: "omnimod://knowledge/recipes", mimeType: "application/json", text: JSON.stringify(RECIPE_GUIDE, null, 2) }],
  }),
);

server.resource(
  "OmniMod staging paths",
  "omnimod://knowledge/staging-paths",
  async () => ({
    contents: [{ uri: "omnimod://knowledge/staging-paths", mimeType: "application/json", text: JSON.stringify(STAGING_PATH_TEMPLATE, null, 2) }],
  }),
);

server.resource(
  "OmniMod endpoint catalog",
  "omnimod://knowledge/endpoints",
  async () => ({
    contents: [{ uri: "omnimod://knowledge/endpoints", mimeType: "application/json", text: JSON.stringify(ENDPOINT_CATALOG, null, 2) }],
  }),
);

server.resource(
  "OmniMod troubleshooting",
  "omnimod://knowledge/troubleshooting",
  async () => ({
    contents: [{ uri: "omnimod://knowledge/troubleshooting", mimeType: "application/json", text: JSON.stringify(MOD_TROUBLESHOOTING, null, 2) }],
  }),
);

server.resource(
  "Professional map-development master guide (full text)",
  "omnimod://knowledge/map-dev-guide",
  async () => {
    let body: string;
    try {
      body = await readFile(join(HERE, "..", "docs", "MAP_DEV_MASTER_GUIDE.md"), "utf8");
    } catch {
      body = "MAP_DEV_MASTER_GUIDE.md is not present in this install. It ships with the repo checkout under mcp/docs/ and is also available through the omni_map_guide tool.";
    }
    return { contents: [{ uri: "omnimod://knowledge/map-dev-guide", mimeType: "text/markdown", text: body }] };
  },
);

server.resource(
  "Engine source repositories (Forge compat layer + command-block system)",
  "omnimod://knowledge/repos",
  async () => ({
    contents: [{ uri: "omnimod://knowledge/repos", mimeType: "application/json", text: JSON.stringify({ repos: sourceRepos(config.forgeCompatRepoUrl, config.commandBlocksRepoUrl), note: "Public mirrors of the two engine systems (pre-linked by default; override via OMNIMOD_FORGE_COMPAT_REPO / OMNIMOD_COMMAND_BLOCKS_REPO env vars or omni_config)." }, null, 2) }],
  }),
);

server.resource(
  "1.8.8 block registry",
  "omnimod://registry/blocks18",
  async () => {
    const list = [...BLOCKS_18_FROM_REGISTRY].sort();
    return { contents: [{ uri: "omnimod://registry/blocks18", mimeType: "application/json", text: JSON.stringify(list, null, 2) }] };
  },
);

server.resource(
  "1.8.8 item registry",
  "omnimod://registry/items18",
  async () => {
    const list = [...ITEMS_18_FROM_REGISTRY].sort();
    return { contents: [{ uri: "omnimod://registry/items18", mimeType: "application/json", text: JSON.stringify(list, null, 2) }] };
  },
);

import { BLOCKS_18 as BLOCKS_18_FROM_REGISTRY, ITEMS_18 as ITEMS_18_FROM_REGISTRY } from "./registry.js";

server.resource(
  "Per-map agent context pack (the documents written into every map folder)",
  "omnimod://knowledge/map-context-pack",
  async () => {
    const src = await MapDocs.loadPackSource();
    const body = [
      `# OmniMod per-map agent context pack — ${src.version}`,
      "",
      "These documents are generated into `worlds/<map>/_dev/` by the game itself",
      "(MapDevWorkspaceDocs.java, written on every world load) so that an agent opening a",
      "map folder has the full contract even with no MCP connection. The copy below is the",
      "same text with the map name left as a placeholder.",
      "",
      "Read order the pack mandates:",
      ...MapDocs.READ_ORDER.map((r, i) => `  ${i + 1}. ${r}`),
      "",
      "Reference documents:",
      ...MapDocs.REFERENCE_DOCS.map((r) => `  - ${r}`),
      "",
      "Agent-owned living documents (seeded once, never overwritten by the game):",
      ...MapDocs.LIVING_DOCS.map((r) => `  - ${r}`),
      "",
      ...src.static.flatMap((f) => ["", "#".repeat(72), `# FILE: _dev/${f.rel}`, "#".repeat(72), "", f.text]),
      ...src.living.flatMap((f) => ["", "#".repeat(72), `# SEED: _dev/${f.rel}`, "#".repeat(72), "", f.text]),
    ].join("\n");
    return {
      contents: [{ uri: "omnimod://knowledge/map-context-pack", mimeType: "text/markdown", text: body }],
    };
  },
);

// =====================================================================
// PROMPTS (reusable guided workflows)
// =====================================================================

server.prompt(
  "build-a-medieval-village",
  "A guided recipe for building a small medieval village on a 7x7 grass platform. Use this as a starting point and adapt.",
  {
    villageSize: z.string().default("small").describe("small (~3 buildings, fits in 7x7), medium (~7 buildings, needs 21x21), large (~15 buildings, needs 35x35)"),
    spawnAt: z.string().default("0,65,0").describe("x,y,z of the player spawn (the player is teleported here after the village is built)"),
  },
  async ({ villageSize, spawnAt }) => {
    const xs = villageSize === "small" ? 7 : villageSize === "medium" ? 21 : 35;
    const body = `You are a professional map builder on OmniMod. The user wants a medieval village of size "${villageSize}" on a 7x7 grass platform world.

Step 1: Connect and verify.
  - Call omni_ping (pre-auth).
  - If no token is set, ask the user to open Options -> Agent Link Info -> Quick Pair Computer on the device and tell you the 8-character code. Then call omni_pair.
  - If the game is not in a world, call omni_world_create with name="village_${Date.now()}", template="void_platform_7x7", gametype="creative", cheats=true.
  - Call omni_state to confirm you are on the new world. The player should be at (8,65,8).

Step 2: Plan. The platform is 7x7 centered on (8,64,8). For a "${villageSize}" village you have a ${xs}x${xs} surface (use the area outside the platform too — build a stone slab foundation over air if you need more room).

Step 3: Build. Use omni_shape_building for each house, omni_shape_hollow_box for roads, omni_shape_cylinder for the watchtower, omni_shape_gable_roof for roofing. Pass 1.8 block names (cobblestone, oak_stairs, planks meta 0, glass_pane, oak_fence). The omni_batch_apply tool will translate any 1.20 names for you.

Step 4: After each batch:
  - Wait 2 seconds.
  - Call omni_mapdev_status to confirm the apply ledger advanced.
  - If you see unknown_block lines, call omni_logs to read them and fix the offending block ids in the next batch.

Step 5: Decorate. Add a well (cylinder of cobblestone + water), torches around the perimeter, fences.

Step 6: Teleport the player to the spawn point (${spawnAt}) using omni_player {action:"teleport", x, y, z}, then omni_chat with a friendly message.

Use omni_knowledge(topic="rules") and omni_knowledge(topic="pitfalls") at any time. The rules include: y must be 0..255, 1.20 block names silently no-op without translation, and ops are batched via the MapDev _dev/build folder.`;
    return { messages: [{ role: "user", content: { type: "text", text: body } }] };
  },
);

server.prompt(
  "author-a-new-mod",
  "A guided recipe for authoring a brand-new Forge 1.20.1 mod that OmniMod will load. Use omni_mod_scaffold to materialize, omni_mod_inspect to lint, and omni_mod_add to stage.",
  {
    modId: z.string().describe("Lowercase id (a-z, 0-9, _). Used as both the modId and the asset namespace."),
    displayName: z.string().describe("Human-readable display name."),
    version: z.string().default("1.0.0"),
  },
  async ({ modId, displayName, version }) => {
    const body = `You are authoring a brand-new Forge 1.20.1 mod for OmniMod.

Step 1: Read the ground rules. Call omni_knowledge(topic="rules") and omni_knowledge(topic="pitfalls"). Pay special attention to:
  - "1.20-block-name-noalias" (pitfall id): block name tables are different but recipe ingredients get their own rename table.
  - "texture-singular-vs-plural" (pitfall id): model layer0 must be \`<modId>:item/<name>\`, textures under textures/item/.
  - "toml-template" (pitfall id): do NOT use \${mod_id} in mods.toml.

Step 2: Design the mod spec. Ask the user (or decide) what items, blocks, recipes, and GUIs to add. The spec has:
  { modId: "${modId}", displayName: "${displayName}", version: "${version}", items?: [{id, displayName?, texture?}], blocks?: [{id, displayName?, texture?, recipe?}], recipes?: [...], guis?: [{filename, payload}] }

Step 3: Scaffold. Call omni_mod_scaffold with the spec. outDir should be a fresh empty directory.

Step 4: Inspect. Call omni_mod_inspect on the scaffolded folder. Look for any "error" or "warning" problems. Fix the spec and re-scaffold if needed.

Step 5: Package. Zip the folder into a JAR (the standard \`jar cf mymod.jar -C <folder> .\` form).

Step 6: Stage on the device.
  - If no world is running, create one (omni_world_create, template=void_platform_7x7).
  - Call omni_mod_add with the JAR base64-encoded as dataB64 and a filename like "${modId}-${version}.jar".
  - Reload the world (omni_world_quit then omni_world_enter) if it was running.

Step 7: Verify. Call omni_logs to look for any "ModManager" or "translateModData" lines. The mod should appear in /omni/state's devpatch area's "mod" line if OmniMod exposes it (it may not — use logs as the source of truth).`;
    return { messages: [{ role: "user", content: { type: "text", text: body } }] };
  },
);

server.prompt(
  "debug-a-silent-noop",
  "When a build seems to have no effect (blocks missing, recipe dropped, model missing-texture). Walks the agent through the most common silent-failure modes.",
  {},
  async () => {
    const body = [
      "You suspect a silent no-op: an op ran but produced nothing visible. Walk this checklist.",
      "",
      "1. Read the log ring.",
      "   - omni_errors (WARN+). Look for unknown_block, unknown_item, recipe_diagnose, failedOp, null.",
      "2. If the log shows unknown_block:",
      "   - The id was a 1.20 name with no translation. Call omni_block_translate on it and use the 1.8 form in the next batch.",
      "3. If the log shows failedOp:",
      "   - Read the surrounding 5-10 lines. The engine prints the op's literal block id and the region coords. Compare to the engine's known 1.8 names with omni_block_search.",
      "4. If the log shows no warnings at all but the world is unchanged:",
      "   - The batch may not have been written. Call omni_mapdev_status and check that 'applied' is non-zero.",
      "   - Or: a world was not loaded when the batch was written. Call omni_state to confirm a world is running.",
      "5. If the user reports a missing-texture on a block, run omni_mod_inspect on the mod (if it is a modded block). Look for 'no-models' or 'blockstate-no-variants' warnings.",
      "6. If the user reports a recipe that does not work:",
      "   - Run omni_recipe_validate on the recipe JSON.",
      "   - Check tag names with omni_knowledge(topic='troubleshooting') and grep the mod for the tag definition.",
      "",
      "The general rule: never assume the build worked. The engine does not error on most silent failures — it logs and continues. Read the log ring after every meaningful batch.",
    ].join("\n");
    return { messages: [{ role: "user", content: { type: "text", text: body } }] };
  },
);

server.prompt(
  "work-on-a-map",
  "The canonical professional loop for ANY map task: understand the request precisely, read the map's own context pack, build in verifiable stages, run the deep verification battery, then update the map's living documents. Start every map session with this.",
  {
    map: z.string().describe("Map/world folder name, or an absolute path to the map folder"),
    request: z.string().describe("What the user asked for, in their own words"),
  },
  async ({ map, request }) => {
    const body = [
      "You are working on an OmniMod map. Work at full professional capability: precise, verified,",
      "and documented. The user's request was:",
      "",
      `> ${request}`,
      "",
      "## Phase 0 — Load the map's own contract (do not skip)",
      "",
      `1. Call omni_map_onboard { map: "${map}" }. It resolves the map folder, repairs the context`,
      "   pack if needed, and returns the documents you are required to read: the agent mandate,",
      "   MAP_OVERVIEW.md (what this map is and what the user wants), CHANGE_LOG.md (what previous",
      "   agents did), FILE_MAP.md (the path index), the build system, the block-name rules, and the",
      "   testing mandate. Read them. They are map-specific; the MCP knowledge base is not.",
      "2. If MAP_OVERVIEW.md or CHANGE_LOG.md contradicts the user's request, the user wins — but say",
      "   so explicitly and correct the document as part of this task.",
      "3. Call omni_ping / omni_pair / omni_state to confirm the live bridge and that this map is the",
      "   loaded world. If the bridge is unavailable, you can still build through the folder, but tell",
      "   the user which verification steps you will not be able to run.",
      "4. Call omni_agentlog { message: \"START <task>\" } and remember the sequence number. Every log",
      "   line you care about later is filtered from this point.",
      "",
      "## Phase 1 — Turn the request into a numeric specification",
      "",
      "Do not place a single block until you can state: origin (x,y,z), footprint (width x depth),",
      "height, wall/floor/roof materials with their 1.8 names AND meta values, roof style, door",
      "position and facing, window pattern, interior contents, count and spacing of repeats.",
      "",
      "Resolve ambiguity from MAP_OVERVIEW.md first. Ask the user only about things that genuinely",
      "cannot be inferred and that would change the build. Then record the specification with",
      "omni_map_overview { section: 3, body: ... } and, if this changes the map's purpose, section 2.",
      "",
      "## Phase 2 — Translate every block name before it goes anywhere",
      "",
      "This engine is Minecraft 1.8.8. `minecraft:oak_planks` places NOTHING and logs `unknown_block`",
      "while the batch is still recorded as applied. Use omni_block_translate / omni_block_search on",
      "every vanilla id, or rely on auto-translation, and state the resolved id+meta in your plan.",
      "Variants are the meta nibble 0..15; there are no blockstate strings. y must be 0..255.",
      "",
      "When unsure of a meta value: place ONE probe block at a scratch coordinate, scan it back, read",
      "the real value, then commit to the full batch.",
      "",
      "## Phase 3 — Build in verifiable stages",
      "",
      "Sequence the work so each stage can be checked before the next buries it:",
      "  1 terrain/foundation · 2 shells · 3 carve openings + frames · 4 roofs · 5 interiors+lighting",
      "  · 6 paths/landscaping/spawn",
      "",
      "For each stage: omni_batch_validate first, then omni_blueprint/omni_batch_apply. Boxes are",
      "INCLUSIVE — width w from x0 spans x0..x0+w-1. Compute centres once and reuse them.",
      "",
      "## Phase 4 — Verify deeply (all five levels of agent/04_TESTING_MANDATE.md)",
      "",
      "- Level 1: omni_mapdev_status / omni_map_status — every batch in the ledger, failed = 0, and",
      "  `placed` close to your estimate. A low `placed` means unknown blocks or unloaded chunks.",
      "- Level 2: omni_world_scan all 8 corners of every box, both jambs of every opening, the roof",
      "  ridge, the interior centre, and ONE BLOCK OUTSIDE each face (catches fills that ran long).",
      "  omni_world_raycast from the intended viewpoint.",
      "- Level 3: omni_errors since your marker. Zero `unknown_block`, zero `volume_too_large`, zero",
      "  `command_failed`, zero parse errors. Explain anything else you see.",
      "- Level 4: a negative control (verify a position you did NOT build — it must report air), a",
      "  deliberate wrong expectation (your check must be able to FAIL), a regression check on an",
      "  earlier structure, and an idempotency check.",
      "",
      "Then omni_map_report { slug, content } with the real numbers and the real log lines. A report",
      "that says \"verified\" with no data is worthless.",
      "",
      "## Phase 5 — Leave the folder better than you found it",
      "",
      `1. omni_map_changelog { map: "${map}", title, requested, interpretation, batches, blocksUsed,`,
      "   verification, decisions, notes, reportPath } — the complete A-to-Z record.",
      "2. omni_map_overview — update the specification, coordinate conventions, open items, mods.",
      "3. omni_map_filemap — regenerate the path index so every new file is listed.",
      "4. Fix anything you found wrong in those documents (a previous agent's misunderstanding, a",
      "   stale path, a false claim) and record the correction in the changelog.",
      "5. omni_agentlog { message: \"DONE <task>\" }.",
      "",
      "## Report to the user",
      "",
      "State what you built, what you verified with what evidence, what you chose that they did not",
      "specify, and what remains unverified or unbuilt. Never describe a check you did not run.",
    ].join("\n");
    return { messages: [{ role: "user", content: { type: "text", text: body } }] };
  },
);

server.prompt(
  "verify-a-map-change",
  "Run the full five-level verification battery against something already built, and write the report. Use when you inherited a map, when the user reports something looks wrong, or before declaring any task done.",
  {
    map: z.string().describe("Map/world folder name, or an absolute path to the map folder"),
    region: z.string().describe("What to verify, e.g. 'the cottage at 0,65,0, 9x7x4 with a gable roof'"),
  },
  async ({ map, region }) => {
    const body = [
      `Verify this on map "${map}": ${region}`,
      "",
      "Assume nothing works until you have observed it. This engine logs and continues instead of",
      "throwing, so a build can be entirely absent while every batch reports `applied`.",
      "",
      "1. omni_map_onboard { map } — read the mandate, the testing mandate, MAP_OVERVIEW.md (for the",
      "   specification this was supposed to match) and CHANGE_LOG.md (for what was claimed).",
      "2. omni_agentlog { message: \"VERIFY <region>\" } — remember the sequence number.",
      "3. omni_map_status — batches vs ledger: anything not in the ledger never applied; any entry",
      "   with failed > 0 must be explained; compare `placed` against the changelog's claim.",
      "4. omni_world_scan the region. Check: all 8 corners, every opening's jambs, the roof ridge,",
      "   the interior centre (expect air), and one block outside each face (expect air). Compare",
      "   against MAP_OVERVIEW.md section 3 — dimensions must match EXACTLY, not approximately.",
      "5. omni_world_raycast from the intended viewpoint; confirm the first hit is the expected face.",
      "6. omni_errors since the marker. Zero unknown_block / volume_too_large / command_failed.",
      "7. Negative controls: scan a position outside the build (must be air), and check one",
      "   deliberately wrong expectation (your comparison must be able to fail). If everything passes",
      "   including the wrong expectation, your verification is broken, not the build.",
      "8. Regression: re-check an earlier structure listed in CHANGE_LOG.md; confirm nothing was",
      "   overwritten.",
      "9. omni_map_report { slug, content } with raw numbers and raw log lines.",
      "10. If you found defects: append an omni_map_changelog entry with `corrects` naming the entry",
      "    that claimed success, then fix the defect and verify again.",
      "",
      "Report honestly: PASS / PARTIAL / FAIL, what matched, what did not, and what you could not check.",
    ].join("\n");
    return { messages: [{ role: "user", content: { type: "text", text: body } }] };
  },
);

// =====================================================================
// BOOT
// =====================================================================

export async function startServer(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Heartbeat to stderr; stdout is reserved for MCP framing.
  console.error(`[omnimod-mcp] connected. ${describeConfig().replace(/\n/g, " | ")}`);
}

export const __server = server;

