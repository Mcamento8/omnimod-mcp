#!/usr/bin/env node
/**
 * OmniMod MCP — FULL offline test battery.
 *
 * Drives EVERY tool (51), EVERY resource (13) and EVERY prompt (5) over a
 * real JSON-RPC stdio session, plus the terminal commands
 * (setup / doctor / --help / --version).
 *
 * No game is needed: bridge-dependent tools are pointed at a dead port and
 * must fail GRACEFULLY (a clean bridge-error envelope, never a crash or a
 * malformed response). Static tools must succeed with real content.
 *
 * Which server to test:
 *   node scripts/full-test.mjs                              -> this checkout (dist/)
 *   OMNIMOD_MCP_ENTRY="C:/.../dist/index.js" node scripts/full-test.mjs  -> an installed copy
 *
 * Exit 0 = all green. Exit 1 = at least one FAIL (listed at the end).
 */
import { spawn, execFileSync } from "node:child_process";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";

const here = dirname(fileURLToPath(import.meta.url));
const entry = process.env.OMNIMOD_MCP_ENTRY || resolve(here, "..", "dist", "index.js");
const scratch = resolve(tmpdir(), `omnimod-fulltest-${Date.now()}`);

const child = spawn(process.execPath, [entry], {
  stdio: ["pipe", "pipe", "pipe"],
  env: {
    ...process.env,
    OMNIMOD_HOST: "127.0.0.1",
    OMNIMOD_PORT: "1", // dead port: bridge calls must fail gracefully
    OMNIMOD_TOKEN: "",
    OMNIMOD_WORK_DIR: join(scratch, "work"),
  },
});

let nextId = 1;
const pending = new Map();
let buffer = "";
let pass = 0;
const failures = [];

function ok(name) {
  pass += 1;
  process.stderr.write(`ok - ${name}\n`);
}
function fail(name, detail) {
  failures.push({ name, detail: String(detail ?? "").slice(0, 400) });
  process.stderr.write(`FAIL - ${name}: ${String(detail ?? "").slice(0, 200)}\n`);
}

function send(method, params) {
  const id = nextId++;
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  return new Promise((resolveP, rejectP) => {
    pending.set(id, { method, resolve: resolveP, reject: rejectP });
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        rejectP(new Error(`timeout waiting for ${method}`));
      }
    }, 25000);
  });
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
      fail("protocol", `non-JSON on stdout: ${line.slice(0, 120)}`);
      continue;
    }
    if (msg.id != null && pending.has(msg.id)) {
      const p = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) p.reject(new Error(`${p.method}: ${msg.error.code} ${msg.error.message}`));
      else p.resolve(msg.result);
    }
  }
});
child.stderr.on("data", () => { /* heartbeat noise; stdout is the contract */ });

const textOf = (r) => r?.content?.[0]?.text ?? "";
const CRASH = /TypeError|ReferenceError|is not a function|Internal error|ERR_|out of memory/i;
const BRIDGE_FAIL = /cannot reach|unreachable|econnrefused|timed out|bridge|failed|error/i;

async function call(name, args) {
  const r = await send("tools/call", { name, arguments: args });
  return { raw: textOf(r), isError: r.isError === true, result: r };
}

/** Static tool: must succeed with content matching `want`. */
async function expectTool(name, args, want, label) {
  try {
    const { raw, isError } = await call(name, args);
    if (isError) return fail(label || name, `unexpected isError: ${raw.slice(0, 200)}`);
    if (CRASH.test(raw)) return fail(label || name, `looks like a crash: ${raw.slice(0, 200)}`);
    if (want instanceof RegExp ? !want.test(raw) : !raw.includes(want)) {
      return fail(label || name, `missing ${want}: ${raw.slice(0, 200)}`);
    }
    ok(label || name);
  } catch (e) {
    fail(label || name, e.message);
  }
}

/** Bridge tool with the game down: must fail gracefully, never crash. */
async function expectGraceful(name, args, label) {
  try {
    const { raw, isError } = await call(name, args);
    if (CRASH.test(raw)) return fail(label || name, `CRASHED instead of graceful fail: ${raw.slice(0, 200)}`);
    if (isError || BRIDGE_FAIL.test(raw)) return ok(label || name);
    fail(label || name, `expected a graceful bridge failure, got success: ${raw.slice(0, 200)}`);
  } catch (e) {
    fail(label || name, `protocol/timeout: ${e.message}`);
  }
}

async function main() {
  process.stderr.write(`FULL TEST — entry: ${entry}\n`);
  const init = await send("initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "omnimod-mcp-fulltest", version: "1.0.0" },
  });
  if (init.serverInfo?.name === "omnimod-mcp") ok("initialize");
  else fail("initialize", JSON.stringify(init).slice(0, 200));

  const tools = await send("tools/list", {});
  const names = new Set((tools.tools || []).map((t) => t.name));
  if (tools.tools?.length === 51) ok("tools/list count = 51");
  else fail("tools/list count", `got ${tools.tools?.length}`);

  // ---- connection & config (static parts) ----
  await expectTool("omni_config", {}, /bridge: http/, "omni_config show");
  await expectTool("omni_config", { host: "192.168.1.50" }, /192\.168\.1\.50/, "omni_config set host");
  await expectTool("omni_config", { host: "127.0.0.1" }, /127\.0\.0\.1/, "omni_config restore host");
  await expectTool("omni_config", { forgeCompatRepoUrl: "https://example.com/f" }, /example\.com\/f/, "omni_config set repo");
  await expectTool("omni_config", { forgeCompatRepoUrl: null }, /Mcamento8\/omnimod-forge-compat/, "omni_config restore repo default");
  await expectTool("omni_config", { autoTranslateBlocks: false }, /autoTranslateBlocks: false/, "omni_config toggle translate");
  await expectTool("omni_config", { autoTranslateBlocks: true }, /autoTranslateBlocks: true/, "omni_config restore translate");

  // ---- translation & search ----
  await expectTool("omni_block_translate", { id: "minecraft:oak_planks" }, /minecraft:planks/, "block oak_planks");
  await expectTool("omni_block_translate", { id: "minecraft:concrete" }, /unresolved/, "block concrete unresolved");
  await expectTool("omni_item_translate", { id: "minecraft:sugar_cane" }, /translated|passthrough|reeds/, "item sugar_cane");
  await expectTool("omni_item_translate", { id: "minecraft:not_a_real_item_xyz" }, /unresolved|translated|passthrough/, "item unknown");
  await expectTool("omni_block_search", { query: "oak", kind: "block" }, /oak_planks/, "search oak");

  // ---- shapes (all 9) ----
  const B = "minecraft:stone";
  await expectTool("omni_shape_solid_box", { block: B, from: [0, 64, 0], to: [2, 64, 2] }, /fill_area/, "shape solid_box");
  await expectTool("omni_shape_hollow_box", { block: B, from: [0, 64, 0], to: [3, 66, 3] }, /fill_area/, "shape hollow_box");
  await expectTool("omni_shape_cylinder", { block: B, center: [0, 64, 0], radius: 3, height: 2 }, /fill_area/, "shape cylinder");
  await expectTool("omni_shape_sphere", { block: B, center: [0, 64, 0], radius: 3 }, /fill_area/, "shape sphere");
  await expectTool("omni_shape_pyramid", { block: B, center: [0, 64, 0], baseRadius: 3 }, /fill_area/, "shape pyramid");
  await expectTool("omni_shape_gable_roof", { block: B, from: [0, 64, 0], to: [6, 66, 4] }, /fill_area/, "shape gable_roof");
  await expectTool("omni_shape_hip_roof", { block: B, from: [0, 64, 0], to: [6, 66, 6] }, /fill_area/, "shape hip_roof");
  await expectTool("omni_shape_line", { block: B, from: [0, 64, 0], to: [5, 64, 0] }, /place_block/, "shape line");
  await expectTool("omni_shape_building", { origin: [0, 64, 0], width: 5, depth: 5, height: 3 }, /fill_area/, "shape building");

  // ---- blueprint + batches ----
  await expectTool("omni_blueprint", {
    apply: false,
    steps: [
      { kind: "solidBox", block: B, from: [0, 64, 0], to: [1, 64, 1] },
      { kind: "cylinder", block: B, center: [5, 64, 5], radius: 2, height: 1 },
    ],
  }, /fill_area/, "blueprint dry");
  try {
    const { raw } = await call("omni_batch_validate", {
      name: "t",
      ops: [{ op: "place_block", block: "minecraft:stone", x: 0, y: 64, z: 0 }],
      autoTranslate: true,
    });
    const j = JSON.parse(raw);
    if (Array.isArray(j.errors) && j.errors.length === 0) ok("batch_validate clean");
    else fail("batch_validate clean", raw.slice(0, 200));
  } catch (e) { fail("batch_validate clean", e.message); }
  try {
    const { raw } = await call("omni_batch_validate", {
      name: "t", ops: [{ op: "place_block", block: B, x: 0, y: 300, z: 0 }],
    });
    const j = JSON.parse(raw);
    if (Array.isArray(j.errors) && j.errors.length > 0) ok("batch_validate bad-y rejected");
    else fail("batch_validate bad-y rejected", raw.slice(0, 200));
  } catch (e) { fail("batch_validate bad-y rejected", e.message); }
  try {
    const { raw } = await call("omni_batch_apply", {
      name: "t", dryRun: true,
      ops: [{ op: "place_block", block: B, x: 0, y: 64, z: 0 }],
    });
    const j = JSON.parse(raw);
    if (j.sent === false) ok("batch_apply dryRun");
    else fail("batch_apply dryRun", raw.slice(0, 200));
  } catch (e) { fail("batch_apply dryRun", e.message); }

  // ---- knowledge: every topic ----
  const topics = {
    identity: /OmniMod/, rules: /1\.8/, pitfalls: /1\.20-block-name-noalias/,
    commands: /omni_dev/, recipes: /shaped|pattern/i, staging: /mods\//,
    endpoints: /\/omni\//, troubleshooting: /unknown_block/,
    mapdev: /omni_mapdev_mode/, repos: /omnimod-forge-compat/, all: /OmniMod/,
  };
  for (const [topic, want] of Object.entries(topics)) {
    await expectTool("omni_knowledge", { topic }, want, `knowledge ${topic}`);
  }
  await expectTool("omni_knowledge", { topic: "pitfalls", pitfallId: "1.20-block-name-noalias" }, /noalias|alias/, "knowledge pitfallId");
  await expectTool("omni_map_guide", {}, /Professional Map Development Master Guide/, "map_guide");

  // ---- per-map chain on a scratch map ----
  const mapDir = join(scratch, "worlds", "FullTestMap");
  await mkdir(mapDir, { recursive: true });
  try {
    const { raw, result } = await call("omni_map_bootstrap", { mapDir });
    const j = JSON.parse(raw);
    if (j.written?.length >= 14 && j.seeded?.length === 3) ok("map_bootstrap");
    else fail("map_bootstrap", raw.slice(0, 200));
    void result;
  } catch (e) { fail("map_bootstrap", e.message); }
  await expectTool("omni_map_docs", { mapDir }, /readOrder|AGENT_START_HERE/, "map_docs listing");
  await expectTool("omni_map_docs", { mapDir, files: ["CHANGE_LOG.md"] }, /CHANGE LOG|CHANGE_LOG/, "map_docs file");
  await expectTool("omni_map_onboard", { mapDir }, /FullTestMap/, "map_onboard");
  await expectTool("omni_map_overview", { mapDir, section: 2, body: "Full-test harbour town." }, /## 2\./, "map_overview");
  await expectTool("omni_map_changelog", {
    mapDir, title: "fulltest", agent: "fulltest",
    requested: "test everything", batches: [], verification: ["static battery"],
  }, /CHANGE_LOG\.md/, "map_changelog write");
  await expectTool("omni_map_changelog", { mapDir, read: true }, /fulltest/, "map_changelog read");
  await expectTool("omni_map_filemap", { mapDir, agent: "fulltest" }, /OFF LIMITS/, "map_filemap");
  await expectTool("omni_map_report", { mapDir, slug: "full check", content: "# report\n\nPASS\n" }, /full-check\.md/, "map_report");
  try {
    const { raw } = await call("omni_map_status", { mapDir });
    const j = JSON.parse(raw);
    if (Array.isArray(j.livingDocsStillSeeded) && j.livingDocsStillSeeded.length === 0) ok("map_status all written");
    else fail("map_status all written", raw.slice(0, 300));
  } catch (e) { fail("map_status all written", e.message); }

  // ---- mod authoring (offline parts) ----
  const modDir = join(scratch, "work", "fulltestmod");
  try {
    const { raw } = await call("omni_mod_scaffold", {
      outDir: modDir,
      spec: {
        modId: "fulltestmod", displayName: "FullTest", version: "1.0.0",
        items: [{ id: "ruby" }], blocks: [{ id: "ruby_ore" }],
      },
    });
    const j = JSON.parse(raw);
    const n = Array.isArray(j.files) ? j.files.length : j.files;
    if ((typeof n === "number" && n > 0) || j.written?.length > 0) ok("mod_scaffold");
    else fail("mod_scaffold", raw.slice(0, 200));
  } catch (e) { fail("mod_scaffold", e.message); }
  try {
    const { raw } = await call("omni_mod_inspect", { path: modDir });
    const j = JSON.parse(raw);
    if (Array.isArray(j.problems)) ok("mod_inspect");
    else fail("mod_inspect", raw.slice(0, 200));
  } catch (e) { fail("mod_inspect", e.message); }
  try {
    const { raw } = await call("omni_recipe_validate", {
      name: "ruby_block",
      recipe: {
        type: "minecraft:crafting_shaped", pattern: ["###", "###", "###"],
        key: { "#": { item: "minecraft:diamond" } },
        result: { item: "minecraft:diamond_block", count: 1 },
      },
    });
    const j = JSON.parse(raw);
    if (Array.isArray(j.problems)) ok("recipe_validate good");
    else fail("recipe_validate good", raw.slice(0, 200));
  } catch (e) { fail("recipe_validate good", e.message); }
  try {
    const { raw } = await call("omni_recipe_validate", {
      name: "bad",
      recipe: { type: "minecraft:crafting_shaped", pattern: ["####", "####"], key: {}, result: { item: "minecraft:stone" } },
    });
    const j = JSON.parse(raw);
    if (j.problems?.some((p) => p.severity === "error")) ok("recipe_validate bad rejected");
    else fail("recipe_validate bad rejected", raw.slice(0, 200));
  } catch (e) { fail("recipe_validate bad rejected", e.message); }

  // ---- bridge tools: game is DOWN, all must fail gracefully ----
  const graceful = [
    ["omni_ping", {}], ["omni_pair", { code: "BADCODE1" }], ["omni_state", {}],
    ["omni_help", {}], ["omni_logs", {}], ["omni_errors", {}],
    ["omni_notifications", {}], ["omni_agentlog", { message: "t" }],
    ["omni_devpatch_verify", {}], ["omni_worlds", {}],
    ["omni_world_create", { name: "testw", template: "flat" }],
    ["omni_world_enter", { name: "x" }], ["omni_world_quit", {}],
    ["omni_mapdev_status", {}], ["omni_mapdev_mode", {}],
    ["omni_mapdev_mode", { mode: "play" }],
    ["omni_command", { command: "say hi" }],
    ["omni_player", { action: "teleport", x: 0, y: 65, z: 0 }],
    ["omni_inventory", {}],
    ["omni_world_scan", { from: [0, 64, 0], to: [1, 64, 1] }],
    ["omni_world_raycast", {}], ["omni_chat", { message: "hi" }],
    ["omni_mod_add", { filename: "tjar", dataB64: "AAAA" }],
    ["omni_batch_apply", { name: "t", ops: [{ op: "place_block", block: B, x: 0, y: 64, z: 0 }] }],
  ];
  for (const [name, args] of graceful) {
    await expectGraceful(name, args);
  }

  // ---- resources: list + read every one ----
  const res = await send("resources/list", {});
  if (res.resources?.length === 13) ok("resources/list count = 13");
  else fail("resources/list count", `got ${res.resources?.length}`);
  for (const r of res.resources || []) {
    try {
      const got = await send("resources/read", { uri: r.uri });
      const t = got.contents?.[0]?.text ?? "";
      if (t.length > 20) ok(`resource ${r.uri}`);
      else fail(`resource ${r.uri}`, `only ${t.length} chars`);
    } catch (e) {
      fail(`resource ${r.uri}`, e.message);
    }
  }

  // ---- prompts: list + get every one ----
  const pr = await send("prompts/list", {});
  if (pr.prompts?.length === 5) ok("prompts/list count = 5");
  else fail("prompts/list count", `got ${pr.prompts?.length}`);
  const promptArgs = {
    "build-a-medieval-village": { villageSize: "small", spawnAt: "0,65,0" },
    "author-a-new-mod": { modId: "fulltestmod", displayName: "FullTest" },
    "debug-a-silent-noop": {},
    "work-on-a-map": { map: "FullTestMap", request: "smoke test" },
    "verify-a-map-change": { map: "FullTestMap", region: "spawn" },
  };
  for (const p of pr.prompts || []) {
    try {
      const got = await send("prompts/get", { name: p.name, arguments: promptArgs[p.name] || {} });
      const t = got.messages?.[0]?.content?.text ?? "";
      if (t.length > 200) ok(`prompt ${p.name}`);
      else fail(`prompt ${p.name}`, `only ${t.length} chars`);
    } catch (e) {
      fail(`prompt ${p.name}`, e.message);
    }
  }

  // ---- terminal commands on the same entry ----
  const cli = (args) => {
    try {
      return execFileSync(process.execPath, [entry, ...args], { encoding: "utf8", timeout: 60000 });
    } catch (e) {
      return (e.stdout || "") + (e.stderr || "");
    }
  };
  if (/1\.3\.0/.test(cli(["--version"]))) ok("cli --version");
  else fail("cli --version", "no version string");
  if (/Kilo Code/.test(cli(["setup"]))) ok("cli setup");
  else fail("cli setup", "no Kilo block");
  if (/omnimod-mcp doctor/.test(cli(["--help"]))) ok("cli --help");
  else fail("cli --help", "no help text");
  const doc = cli(["doctor"]);
  if (/\[OK\] node/.test(doc) && /engine mirrors/.test(doc)) ok("cli doctor");
  else fail("cli doctor", doc.slice(0, 200));

  await rm(scratch, { recursive: true, force: true });

  process.stderr.write(`\nFULL TEST: ${pass} passed, ${failures.length} failed\n`);
  for (const f of failures) process.stderr.write(`  FAIL ${f.name}: ${f.detail}\n`);
  child.kill();
  process.exit(failures.length ? 1 : 0);
}

main().catch((e) => {
  process.stderr.write(`FULL TEST FATAL: ${e.message}\n`);
  try { child.kill(); } catch { /* noop */ }
  process.exit(1);
});
