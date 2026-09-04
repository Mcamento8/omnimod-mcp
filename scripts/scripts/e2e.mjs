#!/usr/bin/env node
/**
 * End-to-end smoke test. Spawns the MCP server over stdio and drives it
 * with real JSON-RPC. Verifies the tool list, the knowledge resources,
 * the translate / search / batch / shape / scaffold / inspect tools
 * (none of which require a live engine), and the ping tool's error path
 * (which exercises the bridge HTTP client).
 *
 * Run after `npm run build`:
 *   node scripts/e2e.mjs
 */
import { spawn } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const entry = resolve(root, "dist/index.js");

const child = spawn(process.execPath, [entry], {
  stdio: ["pipe", "pipe", "pipe"],
  env: { ...process.env, OMNIMOD_HOST: "127.0.0.1", OMNIMOD_PORT: "1" },
});

let nextId = 1;
const pending = new Map();
let buffer = "";
let initialized = false;
let toolsList = null;
let resourcesList = null;
let promptsList = null;

function send(method, params) {
  const id = nextId++;
  const msg = { jsonrpc: "2.0", id, method, params };
  child.stdin.write(JSON.stringify(msg) + "\n");
  return new Promise((resolveP, rejectP) => {
    pending.set(id, { method, resolve: resolveP, reject: rejectP });
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        rejectP(new Error(`timeout waiting for ${method}`));
      }
    }, 20000);
  });
}

function expect(cond, msg) {
  if (!cond) {
    process.stderr.write(`FAIL: ${msg}\n`);
    child.kill();
    process.exit(1);
  }
}

child.stdout.on("data", (chunk) => {
  buffer += chunk.toString("utf8");
  let idx;
  while ((idx = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, idx);
    buffer = buffer.slice(idx + 1);
    if (!line.trim()) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      process.stderr.write(`non-JSON: ${line}\n`);
      continue;
    }
    if (msg.id != null && pending.has(msg.id)) {
      const p = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) p.reject(new Error(`${p.method}: ${msg.error.code} ${msg.error.message}`));
      else p.resolve(msg.result);
    } else if (msg.method === "notifications/message") {
      process.stderr.write(`[server] ${msg.params?.level ?? "log"}: ${msg.params?.data ?? ""}\n`);
    }
  }
});

child.stderr.on("data", (chunk) => process.stderr.write(`[server stderr] ${chunk}`));

async function main() {
  // initialize
  const init = await send("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "omnimod-mcp-e2e", version: "0.1.0" },
  });
  expect(init.serverInfo?.name === "omnimod-mcp", `initialize: ${JSON.stringify(init)}`);
  expect(init.capabilities?.tools !== undefined, "tools capability missing");
  expect(init.capabilities?.resources !== undefined, "resources capability missing");
  expect(init.capabilities?.prompts !== undefined, "prompts capability missing");
  initialized = true;
  process.stderr.write("initialize OK\n");

  // tools/list
  const tools = await send("tools/list", {});
  toolsList = tools.tools;
  expect(Array.isArray(toolsList) && toolsList.length >= 48, `expected 48+ tools, got ${toolsList?.length}`);
  const names = new Set(toolsList.map((t) => t.name));
  for (const required of [
    "omni_ping", "omni_pair", "omni_config", "omni_state", "omni_help",
    "omni_logs", "omni_errors", "omni_notifications", "omni_agentlog", "omni_devpatch_verify",
    "omni_worlds", "omni_world_create", "omni_world_enter", "omni_world_quit", "omni_mapdev_status",
    "omni_block_translate", "omni_item_translate", "omni_block_search",
    "omni_shape_solid_box", "omni_shape_hollow_box", "omni_shape_cylinder",
    "omni_shape_sphere", "omni_shape_pyramid", "omni_shape_gable_roof",
    "omni_shape_hip_roof", "omni_shape_building", "omni_shape_line",
    "omni_blueprint", "omni_batch_validate", "omni_batch_apply",
    "omni_command", "omni_player", "omni_inventory", "omni_world_scan", "omni_world_raycast", "omni_chat",
    "omni_mod_add", "omni_mod_scaffold", "omni_mod_inspect", "omni_recipe_validate", "omni_knowledge",
    "omni_map_onboard", "omni_map_docs", "omni_map_bootstrap", "omni_map_status",
    "omni_map_filemap", "omni_map_changelog", "omni_map_overview", "omni_map_report",
    "omni_mapdev_mode", "omni_map_guide",
  ]) {
    expect(names.has(required), `missing tool: ${required}`);
  }
  process.stderr.write(`tools/list: ${toolsList.length} tools\n`);

  // resources/list
  const resources = await send("resources/list", {});
  resourcesList = resources.resources;
  expect(Array.isArray(resourcesList) && resourcesList.length >= 10, `expected 10+ resources, got ${resourcesList?.length}`);
  for (const r of resourcesList) {
    expect(r.uri?.startsWith("omnimod://"), `bad resource uri: ${r.uri}`);
  }
  expect(
    resourcesList.some((r) => r.uri === "omnimod://knowledge/map-context-pack"),
    "missing the per-map context pack resource",
  );
  expect(
    resourcesList.some((r) => r.uri === "omnimod://knowledge/map-dev-guide"),
    "missing the map dev master guide resource",
  );
  expect(
    resourcesList.some((r) => r.uri === "omnimod://knowledge/repos"),
    "missing the engine source repos resource",
  );
  process.stderr.write(`resources/list: ${resourcesList.length} resources\n`);

  // The map-dev master guide resource must serve the full guide text.
  const guideRes = await send("resources/read", { uri: "omnimod://knowledge/map-dev-guide" });
  const guideText = guideRes.contents?.[0]?.text ?? "";
  expect(guideText.includes("Professional Map Development Master Guide"), "guide resource carries no title");
  for (const section of [
    "The 8-phase professional workflow",
    "The REAL command surface",
    "Command-block modes (MCBP)",
    "Map functions (datapack-style",
    "The dual-mode system (DEV",
    "The verification battery (3 levels",
    "omni_mapdev_mode",
    "omnimod-agent-docs-4",
  ]) {
    expect(guideText.includes(section), `guide resource is missing section: ${section}`);
  }
  expect(guideText.length > 15000, `guide resource suspiciously small: ${guideText.length} chars`);
  process.stderr.write(`map-dev-guide resource: ${guideText.length} chars\n`);

  // The repos resource must serve the two engine systems (URLs may be unset).
  const reposRes = await send("resources/read", { uri: "omnimod://knowledge/repos" });
  const reposText = reposRes.contents?.[0]?.text ?? "";
  expect(reposText.includes("Forge 1.20.1 mod-compat layer"), "repos resource missing the compat system");
  expect(reposText.includes("Command-block & command-surface system"), "repos resource missing the command system");
  process.stderr.write(`repos resource: OK\n`);

  // The context-pack resource must serve the real exported pack.
  const packRes = await send("resources/read", { uri: "omnimod://knowledge/map-context-pack" });
  const packText = packRes.contents?.[0]?.text ?? "";
  expect(/omnimod-agent-docs-\d+/.test(packText), "context pack resource carries no version marker");
  for (const doc of [
    "AGENT_START_HERE.md",
    "agent/00_AGENT_MANDATE.md",
    "agent/01_MAP_BUILD_SYSTEM.md",
    "agent/02_BLOCK_NAMES_AND_META.md",
    "agent/03_DESIGN_AND_GEOMETRY.md",
    "agent/04_TESTING_MANDATE.md",
    "agent/05_AGENT_LINK_API.md",
    "agent/06_MOD_AUTHORING.md",
    "agent/07_MODS_IN_THIS_MAP.md",
    "agent/08_TROUBLESHOOTING.md",
    "agent/09_HANDOFF_PROTOCOL.md",
    "MAP_OVERVIEW.md",
    "CHANGE_LOG.md",
    "FILE_MAP.md",
  ]) {
    expect(packText.includes(doc), `context pack resource is missing ${doc}`);
  }
  expect(packText.length > 60000, `context pack resource suspiciously small: ${packText.length} chars`);
  process.stderr.write(`context pack resource: ${packText.length} chars\n`);

  // prompts/list
  const prompts = await send("prompts/list", {});
  promptsList = prompts.prompts;
  expect(Array.isArray(promptsList) && promptsList.length >= 5, `expected 5+ prompts, got ${promptsList?.length}`);
  for (const required of ["work-on-a-map", "verify-a-map-change"]) {
    expect(promptsList.some((p) => p.name === required), `missing prompt: ${required}`);
  }
  process.stderr.write(`prompts/list: ${promptsList.length} prompts\n`);

  // omni_knowledge identity
  const identity = await send("tools/call", { name: "omni_knowledge", arguments: { topic: "identity" } });
  const identityText = identity.content?.[0]?.text ?? "";
  expect(identityText.includes("OmniMod") && identityText.includes("EaglercraftX 1.8.8"), "identity doesn't mention 1.8.8");

  // omni_knowledge mapdev (compact workflow) + repos (engine source mirrors)
  const mapdev = await send("tools/call", { name: "omni_knowledge", arguments: { topic: "mapdev" } });
  const mapdevText = mapdev.content?.[0]?.text ?? "";
  expect(mapdevText.includes("8-phase") || /"phase"/.test(mapdevText), `mapdev topic: ${mapdevText.slice(0, 200)}`);
  expect(mapdevText.includes("omni_mapdev_mode"), "mapdev topic does not mention the mode tool");

  const reposTopic = await send("tools/call", { name: "omni_knowledge", arguments: { topic: "repos" } });
  const reposTopicText = reposTopic.content?.[0]?.text ?? "";
  expect(reposTopicText.includes("OMNIMOD_FORGE_COMPAT_REPO"), "repos topic missing the compat env var");
  expect(reposTopicText.includes("OMNIMOD_COMMAND_BLOCKS_REPO"), "repos topic missing the command-blocks env var");

  // omni_map_guide serves the full master guide text as a tool
  const guideTool = await send("tools/call", { name: "omni_map_guide", arguments: {} });
  const guideToolText = guideTool.content?.[0]?.text ?? "";
  expect(guideToolText.includes("Professional Map Development Master Guide"), "guide tool carries no title");

  // omni_mapdev_mode without a bridge must fail with a bridge error (not crash)
  const modeFail = await send("tools/call", { name: "omni_mapdev_mode", arguments: {} });
  expect(modeFail.isError === true || /Cannot reach|unreachable|ECONNREFUSED|Bridge/i.test(modeFail.content?.[0]?.text ?? ""),
    `omni_mapdev_mode should fail cleanly with no bridge up, got: ${(modeFail.content?.[0]?.text ?? "").slice(0, 200)}`);

  // omni_knowledge endpoints must now include the dual-mode endpoint
  const endpoints = await send("tools/call", { name: "omni_knowledge", arguments: { topic: "endpoints" } });
  const endpointsText = endpoints.content?.[0]?.text ?? "";
  expect(endpointsText.includes("/omni/mapdev/mode"), "endpoint catalog is missing /omni/mapdev/mode");
  expect(endpointsText.includes("/omni/poll"), "endpoint catalog is missing /omni/poll");
  expect(endpointsText.includes("/omni/wait"), "endpoint catalog is missing /omni/wait");

  // omni_knowledge commands must document the mode subcommand
  const commandsTopic = await send("tools/call", { name: "omni_knowledge", arguments: { topic: "commands" } });
  const commandsText = commandsTopic.content?.[0]?.text ?? "";
  expect(commandsText.includes("mode [dev|play]"), "command guide missing omni_dev mode subcommand");

  // omni_block_translate
  const tx = await send("tools/call", { name: "omni_block_translate", arguments: { id: "minecraft:oak_planks" } });
  const txText = tx.content?.[0]?.text ?? "";
  expect(txText.includes("minecraft:planks") && txText.includes("translated"), `oak_planks: ${txText}`);

  const txConcrete = await send("tools/call", { name: "omni_block_translate", arguments: { id: "minecraft:concrete" } });
  expect((txConcrete.content?.[0]?.text ?? "").includes("unresolved"), "concrete should be unresolved");

  // omni_block_search
  const search = await send("tools/call", { name: "omni_block_search", arguments: { query: "oak", kind: "block" } });
  const searchText = search.content?.[0]?.text ?? "";
  expect(searchText.includes("aliasFrom120") && searchText.includes("oak_planks"), `search oak: ${searchText}`);

  // omni_shape_building
  const shape = await send("tools/call", {
    name: "omni_shape_building",
    arguments: {
      origin: [0, 64, 0], width: 7, depth: 7, height: 3,
      wallBlock: "minecraft:cobblestone", floorBlock: "minecraft:stone",
      roofStyle: "gable", roofBlock: "minecraft:stone",
      doorSide: "south", windowsEnabled: true,
    },
  });
  const shapeText = shape.content?.[0]?.text ?? "";
  expect(shapeText.includes('"op"') && shapeText.includes("fill_area"), `shape output: ${shapeText.slice(0, 200)}`);

  // omni_batch_validate
  const batch = await send("tools/call", {
    name: "omni_batch_validate",
    arguments: {
      name: "smoke",
      ops: [
        { op: "place_block", block: "minecraft:oak_planks", x: 0, y: 64, z: 0 },
        { op: "fill_area", block: "minecraft:stone", from: [0, 64, 0], to: [5, 64, 5] },
        { op: "chat", message: "hi" },
      ],
      autoTranslate: true,
    },
  });
  const batchText = batch.content?.[0]?.text ?? "";
  const batchJson = JSON.parse(batchText);
  expect(Array.isArray(batchJson.errors) && batchJson.errors.length === 0, `batch errors: ${batchJson.errors}`);
  expect(Array.isArray(batchJson.warnings) && batchJson.warnings.length === 0, `batch warnings: ${batchJson.warnings}`);

  // omni_ping should fail (port 1 is not running the bridge) — exercises the
  // unreachable error path, which is what an agent will see when the device
  // is off.
  const ping = await send("tools/call", { name: "omni_ping", arguments: {} });
  const pingText = ping.content?.[0]?.text ?? "";
  expect(ping.isError === true || pingText.includes("Cannot reach") || pingText.includes("unreachable"),
    `ping should fail when no bridge is up, got: ${pingText}`);

  // omni_prompts/get
  const prompt = await send("prompts/get", { name: "build-a-medieval-village", arguments: { villageSize: "small", spawnAt: "0,65,0" } });
  expect(prompt.messages?.[0]?.content?.text?.includes("omni_ping"), "village prompt does not mention omni_ping");

  const mapPrompt = await send("prompts/get", {
    name: "work-on-a-map",
    arguments: { map: "e2e_map", request: "build a small cottage" },
  });
  const mapPromptText = mapPrompt.messages?.[0]?.content?.text ?? "";
  for (const required of ["omni_map_onboard", "omni_map_changelog", "omni_map_filemap", "omni_map_overview", "0..255"]) {
    expect(mapPromptText.includes(required), `work-on-a-map prompt is missing ${required}`);
  }

  // ------------------------------------------------------------------
  // Per-map context pack tools, driven over real JSON-RPC against a
  // scratch map folder on disk.
  // ------------------------------------------------------------------
  const mapRoot = resolve(tmpdir(), `omnimod-e2e-map-${Date.now()}`);
  const mapDir = resolve(mapRoot, "worlds", "E2EMap");
  await mkdir(mapDir, { recursive: true });
  await writeFile(resolve(mapDir, "level.dat"), "not-a-real-level", "utf8");

  const callJson = async (name, args) => {
    const r = await send("tools/call", { name, arguments: args });
    const t = r.content?.[0]?.text ?? "";
    try {
      return { raw: t, json: JSON.parse(t) };
    } catch {
      return { raw: t, json: null };
    }
  };

  // Resolution failure must be explicit, not silent.
  const missing = await callJson("omni_map_status", { map: "definitely_not_a_map" });
  expect(/Could not locate the map folder/.test(missing.raw) && /Tried:/.test(missing.raw),
    `unresolvable map should explain what it tried, got: ${missing.raw.slice(0, 200)}`);

  const boot = await callJson("omni_map_bootstrap", { mapDir });
  expect(boot.json && boot.json.written?.length >= 14, `bootstrap wrote too little: ${boot.raw.slice(0, 300)}`);
  expect(boot.json.seeded?.length === 3, `bootstrap should seed 3 living docs, got ${boot.json.seeded?.length}`);
  expect(/^omnimod-agent-docs-\d+$/.test(boot.json.version ?? ""), `bad pack version: ${boot.json.version}`);

  const onboard = await send("tools/call", { name: "omni_map_onboard", arguments: { mapDir } });
  const onboardText = onboard.content?.[0]?.text ?? "";
  for (const required of [
    "FILE: _dev/AGENT_START_HERE.md",
    "FILE: _dev/agent/00_AGENT_MANDATE.md",
    "FILE: _dev/agent/04_TESTING_MANDATE.md",
    "E2EMap",
    "still in the seeded state",
  ]) {
    expect(onboardText.includes(required), `onboard output is missing ${required}`);
  }
  expect(!onboardText.includes("__OMNIMOD_MAP__"), "onboard leaked the map-name token");
  process.stderr.write(`omni_map_onboard: ${onboardText.length} chars of mandatory reading\n`);

  const ov = await callJson("omni_map_overview", { mapDir, section: 2, body: "User wants a harbour town." });
  expect(ov.json?.sectionReplaced?.startsWith("## 2."), `overview patch failed: ${ov.raw.slice(0, 200)}`);

  const cl = await callJson("omni_map_changelog", {
    mapDir,
    title: "e2e smoke",
    agent: "e2e",
    requested: "verify the tooling",
    batches: [{ file: "ops-0001.json", ops: 1, placed: 25, failed: 0, what: "floor" }],
    verification: ["ledger clean", "corners scanned"],
  });
  expect(cl.json?.path?.endsWith("CHANGE_LOG.md"), `changelog write failed: ${cl.raw.slice(0, 200)}`);
  expect(/e2e smoke/.test(cl.json?.appended ?? ""), "changelog entry body missing");

  const clRead = await send("tools/call", { name: "omni_map_changelog", arguments: { mapDir, read: true } });
  expect((clRead.content?.[0]?.text ?? "").includes("e2e smoke"), "changelog read-back failed");

  const fm = await callJson("omni_map_filemap", { mapDir, agent: "e2e" });
  expect(fm.json?.entries > 10, `file map found too few entries: ${fm.raw.slice(0, 200)}`);
  expect(/OFF LIMITS/.test(fm.json?.preview ?? ""), "file map preview missing the off-limits section");

  const rep = await callJson("omni_map_report", { mapDir, slug: "e2e check", content: "# report\n\nPASS\n" });
  expect(/\d{4}-\d{2}-\d{2}-e2e-check\.md$/.test(rep.json?.path ?? ""), `report path: ${rep.raw.slice(0, 200)}`);

  const st = await callJson("omni_map_status", { mapDir });
  expect(st.json?.livingDocsStillSeeded?.length === 0,
    `living docs should be written after the tool calls: ${JSON.stringify(st.json?.livingDocsStillSeeded)}`);
  expect(st.json?.verificationReports?.length === 1, `expected 1 report, got ${st.json?.verificationReports?.length}`);
  expect(typeof st.json?.verdict === "string" && st.json.verdict.length > 0, "status verdict missing");
  process.stderr.write(`omni_map_status verdict: ${st.json.verdict}\n`);

  await rm(mapRoot, { recursive: true, force: true });

  process.stderr.write("\nE2E PASS\n");
  child.kill();
  process.exit(0);
}

main().catch((e) => {
  process.stderr.write(`E2E FAIL: ${e.message}\n`);
  child.kill();
  process.exit(1);
});
