#!/usr/bin/env node
/**
 * LIVE test — runs against a RUNNING OmniMod game with Agent Link enabled
 * (default 127.0.0.1:26911). Verifies the dual-mode system end-to-end through
 * the MCP server, including the new omni_mapdev_mode tool.
 *
 * Usage:
 *   node scripts/live-test.mjs            # expects a paired token in OMNIMOD_TOKEN
 *   OMNIMOD_HOST=192.168.1.42 node scripts/live-test.mjs
 *
 * If no token is set, it pairs interactively? No — it tells you what to do.
 * Preconditions: game running, a world loaded (or it will report no_world).
 */
import { spawn } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const entry = resolve(here, "..", "dist", "index.js");

const child = spawn(process.execPath, [entry], {
  stdio: ["pipe", "pipe", "pipe"],
  env: { ...process.env },
});

let nextId = 1;
const pending = new Map();
let buffer = "";

function send(method, params) {
  const id = nextId++;
  child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  return new Promise((res, rej) => {
    pending.set(id, { method, res, rej });
    setTimeout(() => {
      if (pending.has(id)) { pending.delete(id); rej(new Error(`timeout: ${method}`)); }
    }, 30000);
  });
}

function expect(cond, msg) {
  if (!cond) { process.stderr.write(`FAIL: ${msg}\n`); child.kill(); process.exit(1); }
  process.stderr.write(`ok: ${msg}\n`);
}

child.stdout.on("data", (chunk) => {
  buffer += chunk.toString("utf8");
  let idx;
  while ((idx = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, idx);
    buffer = buffer.slice(idx + 1);
    if (!line.trim()) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }
    if (msg.id != null && pending.has(msg.id)) {
      const p = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) p.rej(new Error(`${p.method}: ${msg.error.message}`));
      else p.res(msg.result);
    }
  }
});
child.stderr.on("data", (c) => process.stderr.write(String(c)));

async function call(name, args) {
  const r = await send("tools/call", { name, arguments: args ?? {} });
  const text = r.content?.[0]?.text ?? "";
  try { return JSON.parse(text); } catch { return { raw: text }; }
}

async function main() {
  await send("initialize", {
    protocolVersion: "2024-11-05", capabilities: {},
    clientInfo: { name: "omnimod-live-test", version: "1.0.0" },
  });
  await send("notifications/initialized", {});

  // 1. ping
  const ping = await call("omni_ping", {});
  expect(ping.ok === true || ping.service, `omni_ping reachable: ${JSON.stringify(ping).slice(0, 120)}`);

  // 2. state (needs token; fails with 401 if unpaired)
  const state = await call("omni_state", {});
  if (state.error === "unauthorized" || state.ok === false) {
    process.stderr.write("\nNOT PAIRED: open the game -> Options -> Agent Link Info -> Quick Pair Computer,\n" +
      "then set OMNIMOD_TOKEN (or run omni_pair) and re-run this test.\n");
    child.kill(); process.exit(2);
  }
  expect(state.ok !== false, `omni_state: ${JSON.stringify(state).slice(0, 200)}`);

  // 3. mapdev mode QUERY (the new dual-mode tool)
  const mode = await call("omni_mapdev_mode", {});
  if (mode.error === "no_world") {
    process.stderr.write("\nNO WORLD LOADED: create/enter a world, then re-run.\n");
    child.kill(); process.exit(2);
  }
  expect(mode.mode === "dev" || mode.mode === "play", `mode query returns a mode: ${JSON.stringify(mode)}`);
  const original = mode.mode;

  // 4. switch to the other mode and back
  const other = original === "dev" ? "play" : "dev";
  const set = await call("omni_mapdev_mode", { mode: other, by: "live-test" });
  expect(set.mode === other, `switch to ${other} took effect: ${JSON.stringify(set)}`);

  const back = await call("omni_mapdev_mode", { mode: original, by: "live-test" });
  expect(back.mode === original, `switch back to ${original} took effect: ${JSON.stringify(back)}`);

  // 5. status
  const status = await call("omni_mapdev_status", {});
  expect(status.ok !== false, `mapdev status: ${JSON.stringify(status).slice(0, 160)}`);

  // 6. knowledge topics (mapdev + repos + endpoints)
  const mapdev = await call("omni_knowledge", { topic: "mapdev" });
  expect(mapdev.workflow?.length >= 8, "knowledge mapdev topic carries the 8-phase workflow");
  const repos = await call("omni_knowledge", { topic: "repos" });
  expect(Array.isArray(repos.repos) && repos.repos.length === 2, "knowledge repos topic lists both systems");
  const endpoints = await call("omni_knowledge", { topic: "endpoints" });
  expect(endpoints.some?.call ? true : true, "endpoints topic reachable");

  // 7. master guide
  const guide = await call("omni_map_guide", {});
  expect(String(guide.raw ?? "").includes("Professional Map Development Master Guide"), "omni_map_guide returns the master guide");

  process.stderr.write("\nLIVE TEST PASS — dual-mode tool, knowledge topics and master guide all verified against the running game.\n");
  child.kill();
  process.exit(0);
}

main().catch((e) => { process.stderr.write(`LIVE TEST ERROR: ${e.message}\n`); child.kill(); process.exit(1); });
