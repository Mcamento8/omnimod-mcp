/**
 * Human-facing terminal surface for `omnimod-mcp`.
 *
 * An MCP server speaks JSON-RPC over stdio, so a human who runs the command
 * in a terminal would otherwise stare at a hanging cursor. Instead:
 *
 *   - `omnimod-mcp setup`   prints the connect dashboard (paste-ready client
 *                            configs for Kilo Code, Cline, Cursor, Claude Code
 *                            and Claude Desktop + pairing steps).
 *   - `omnimod-mcp doctor`  runs connectivity diagnostics (node, files,
 *                            bridge reachability, token, repo links).
 *   - bare `omnimod-mcp` in an interactive terminal prints the dashboard too
 *                            (see index.ts — piped/agent usage still starts
 *                            the server, so agents are never affected).
 */
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";

import {
  config,
  MCP_VERSION,
  baseUrl,
  describeConfig,
  DEFAULT_FORGE_COMPAT_REPO,
  DEFAULT_COMMAND_BLOCKS_REPO,
  DEFAULT_ASSET_LIBRARY_REPO,
  DEFAULT_SFX_REPO,
} from "./config.js";

const HERE = dirname(fileURLToPath(import.meta.url));
/** Absolute install root of this MCP package (…/dist → …). */
export const INSTALL_ROOT = resolve(HERE, "..");
/** Absolute entry file agents/clients point at. */
export const ENTRY_FILE = resolve(HERE, "index.js");

/** Forward-slash path: safe to paste into every client's JSON config. */
export const entryForJson = (): string => ENTRY_FILE.replace(/\\/g, "/");

/** Re-exported so callers have one import site; defined in config.ts. */
export { MCP_VERSION } from "./config.js";

const BAR = "=".repeat(72);
const SEP = "-".repeat(72);

function clientBlock(title: string, json: string): string {
  return [`[${title}]`, json, ""].join("\n");
}

/** Environment block shared by every client: only the values actually set. */
function envBlock(): Record<string, string> {
  const env: Record<string, string> = {};
  if (config.host) env.OMNIMOD_HOST = config.host;
  if (config.port) env.OMNIMOD_PORT = String(config.port);
  if (config.token) env.OMNIMOD_TOKEN = config.token;
  if (config.projectRoot) env.OMNIMOD_PROJECT_ROOT = config.projectRoot;
  if (config.worldsDir) env.OMNIMOD_WORLDS_DIR = config.worldsDir;
  if (config.workDir) env.OMNIMOD_WORK_DIR = config.workDir;
  return env;
}

/** The `{ command, args, env }` server entry every client wraps differently. */
function serverEntry(withEnv: boolean): Record<string, unknown> {
  const e: Record<string, unknown> = { command: "node", args: [entryForJson()] };
  if (withEnv) {
    const env = envBlock();
    if (Object.keys(env).length > 0) e.env = env;
  }
  return e;
}

function j(o: unknown): string {
  return JSON.stringify(o, null, 2);
}

/** Every client shape worth pasting, so nobody has to translate by hand. */
function clientBlocks(): string {
  const out: string[] = [];
  out.push(clientBlock("Claude Desktop  ·  claude_desktop_config.json", j({ mcpServers: { omnimod: serverEntry(true) } })));
  out.push(clientBlock("Claude Code  ·  .mcp.json (project) or ~/.claude.json", j({ mcpServers: { omnimod: serverEntry(true) } })));
  out.push(clientBlock("Cursor  ·  Settings → MCP → Add server  (or ~/.cursor/mcp.json)", j({ mcpServers: { omnimod: serverEntry(true) } })));
  out.push(
    clientBlock(
      "VS Code  ·  .vscode/mcp.json  (native MCP)",
      j({ servers: { omnimod: { type: "stdio", command: "node", args: [entryForJson()], env: envBlock() } } }),
    ),
  );
  out.push(
    clientBlock(
      "Cline  ·  VS Code settings.json → cline.mcpServers",
      j({ "cline.mcpServers": { omnimod: { ...serverEntry(true), disabled: false } } }),
    ),
  );
  out.push(clientBlock("Kilo Code  ·  ~/.zcode/config.json → mcpServers", j({ mcpServers: { omnimod: serverEntry(true) } })));
  out.push(
    clientBlock(
      "Windsurf  ·  ~/.codeium/windsurf/mcp_config.json",
      j({ mcpServers: { omnimod: serverEntry(true) } }),
    ),
  );
  out.push(
    clientBlock(
      "Zed  ·  settings.json → context_servers",
      j({ context_servers: { omnimod: { command: { path: "node", args: [entryForJson()], env: envBlock() } } } }),
    ),
  );
  out.push(
    clientBlock(
      "Continue  ·  config.json → mcpServers",
      j({ mcpServers: [{ name: "omnimod", command: "node", args: [entryForJson()], env: envBlock() }] }),
    ),
  );
  out.push(
    clientBlock(
      "Any other client  ·  plain stdio (command + args)",
      [`command : node`, `args    : ${entryForJson()}`, `transport: stdio`, `env     : ${j(envBlock()).replace(/\n/g, " ")}`].join("\n"),
    ),
  );
  return out.join("\n");
}

/** Everything a human needs in order to wire this into a tool. */
export function connectionData(): string[] {
  const L: string[] = [];
  const row = (k: string, v: string) => L.push(`  ${k.padEnd(22)} ${v}`);
  row("MCP version", `v${MCP_VERSION}`);
  row("Install folder", INSTALL_ROOT);
  row("Entry file", entryForJson());
  row("Node", `${process.execPath}  (${process.version})`);
  row("Global command", "omnimod-mcp   — works from ANY folder");
  row("Transport", "stdio (JSON-RPC) — the client spawns this process");
  L.push("");
  L.push("  -- the game it talks to ------------------------------------------");
  row("Bridge URL", baseUrl());
  row("Host / Port", `${config.host} / ${config.port}`);
  row("Pairing token", config.token ? `${config.token.slice(0, 4)}…${config.token.slice(-4)}  (set)` : "NOT SET — pair once (step 3 below)");
  row("Request timeout", `${config.timeoutMs} ms`);
  L.push("");
  L.push("  -- local paths ---------------------------------------------------");
  row("Project root", config.projectRoot ?? "(not set — optional, enables local doc reads)");
  row("Worlds dir", config.worldsDir ?? "(not set — derived from project root when possible)");
  row("Work dir", config.workDir);
  L.push("");
  L.push("  -- linked asset libraries ----------------------------------------");
  row("3D models (CC0)", config.assetLibraryRepoUrl ?? "(unlinked)");
  row("  local copy", config.assetLibraryLocalPath ?? "(not set — read over HTTPS)");
  row("  cache", config.assetCacheDir);
  row("Sounds (CC0)", config.sfxRepoUrl ?? "(unlinked)");
  row("  local copy", config.sfxLocalPath ?? "(not set — read over HTTPS)");
  row("  cache", config.sfxCacheDir);
  L.push("");
  L.push("  -- engine source mirrors -----------------------------------------");
  row("Forge compat", config.forgeCompatRepoUrl ?? DEFAULT_FORGE_COMPAT_REPO);
  row("Command blocks", config.commandBlocksRepoUrl ?? DEFAULT_COMMAND_BLOCKS_REPO);
  row("3D library", config.assetLibraryRepoUrl ?? DEFAULT_ASSET_LIBRARY_REPO);
  row("Sound library", config.sfxRepoUrl ?? DEFAULT_SFX_REPO);
  return L;
}

/** The connect dashboard: what a human sees in the terminal. */
export function setupText(): string {
  const L: string[] = [];
  L.push(BAR);
  L.push(`  OmniMod MCP v${MCP_VERSION} — connection data / بيانات الاتصال`);
  L.push(BAR);
  L.push("");
  L.push("  ══ CONNECTION DATA ══════════════════════════════════════════════");
  L.push(...connectionData());
  L.push("");
  L.push("  ══ PASTE THIS INTO YOUR CLIENT ══════════════════════════════════");
  L.push("  انسخ الكتلة الخاصة بمحررك والصقها في إعدادات الـ MCP لديه.");
  L.push("  The `env` block is what makes it connect to YOUR device — do not drop it.");
  L.push("");
  L.push(clientBlocks());
  L.push(SEP);
  L.push("  NEXT STEPS — الخطوات التالية");
  L.push(SEP);
  L.push("  1) Paste your client's block above, then RESTART that client.");
  L.push("  2) In the agent chat, run:   omni_ping");
  L.push("  3) Pair once: read the 8-char code on the device");
  L.push("     (Options → Agent Link Info → Quick Pair Computer), then:");
  L.push('         omni_pair { "code": "XXXXXXXX" }');
  L.push('  4) Start building:  omni_knowledge { "topic": "rules" }');
  L.push("");
  L.push("  Diagnostics any time:      omnimod-mcp doctor");
  L.push("  Show this card again:      omnimod-mcp setup");
  L.push("  Run it visibly (below):    omnimod-mcp serve");
  L.push(BAR);
  return L.join("\n");
}

export function printSetup(): void {
  process.stdout.write(setupText() + "\n");
}

export function helpText(): string {
  return [
    `omnimod-mcp v${MCP_VERSION} — OmniMod MCP server`,
    ``,
    `Usage — الاستخدام:`,
    `  omnimod-mcp              Terminal → shows the connection card.`,
    `                           Spawned by an agent (piped stdio) → starts the server.`,
    `  omnimod-mcp serve        Show the connection card, then RUN the server in this`,
    `                           window and stay open. Close the window (or Ctrl+C) to`,
    `                           stop it. This is the "I want to watch it" mode.`,
    `  omnimod-mcp setup        Show the connection card (all data + client JSON).`,
    `  omnimod-mcp doctor       Diagnose: node, files, bridge, token, repo links.`,
    `  omnimod-mcp selfcheck    Run the built-in test battery.`,
    `  omnimod-mcp --version    Print the version.`,
    `  omnimod-mcp --help       Show this help.`,
    ``,
    `Note: your MCP client spawns the server itself. You do NOT need to keep a`,
    `terminal open for normal use — \`serve\` is for watching it, debugging, or`,
    `keeping it alive on purpose.`,
    ``,
    `One-command install (Windows: cmd or PowerShell, paste as ONE line):`,
    `  powershell -NoProfile -ExecutionPolicy Bypass -c "$f=$env:TEMP+'\\omnimod-install.ps1'; irm https://raw.githubusercontent.com/Mcamento8/omnimod-mcp/main/scripts/install-windows.ps1 -OutFile $f; & $f"`,
    `One-command install (macOS / Linux):`,
    `  curl -fsSL https://raw.githubusercontent.com/Mcamento8/omnimod-mcp/main/install.sh | bash`,
  ].join("\n");
}

/**
 * The banner for `serve` mode.
 *
 * It answers the three questions a human has while a headless server is running
 * in front of them: is it alive, what is it connected to, and how do I stop it.
 * Everything else is already in the connection card above it.
 */
export function serveBanner(): string {
  const L: string[] = [];
  L.push(BAR);
  L.push(`  OmniMod MCP v${MCP_VERSION} — SERVER RUNNING IN THIS WINDOW`);
  L.push(BAR);
  L.push("");
  L.push(`  ● Listening on stdio. The client that spawns this process talks to it here.`);
  L.push(`  ● Bridge target : ${baseUrl()}`);
  L.push(`  ● Pairing token : ${config.token ? "set" : "NOT SET — pair with omni_pair"}`);
  L.push("");
  L.push("  This window must stay open while you use it. Closing this window —");
  L.push("  or pressing Ctrl+C — stops the server immediately.");
  L.push("");
  L.push("  Do NOT type into this window: its input is the JSON-RPC channel, so");
  L.push("  stray keystrokes are protocol errors, not commands.");
  L.push("");
  L.push("  Normal use does not need this mode: your MCP client starts the server");
  L.push("  on its own. This mode exists so you can WATCH it, debug a connection,");
  L.push("  or keep one instance alive deliberately.");
  L.push(BAR);
  return L.join("\n");
}

export function printServeBanner(): void {
  process.stdout.write(serveBanner() + "\n\n");
}

async function pingBridge(timeoutMs = 3000): Promise<{ ok: boolean; detail: string }> {
  const url = `${baseUrl()}/omni/ping`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    const body = await res.text();
    return res.ok
      ? { ok: true, detail: `reachable — ${body.slice(0, 120)}` }
      : { ok: false, detail: `HTTP ${res.status} — ${body.slice(0, 120)}` };
  } catch (e) {
    return {
      ok: false,
      detail:
        ctrl.signal.aborted
          ? `no answer within ${timeoutMs} ms`
          : `unreachable (${e instanceof Error ? e.message : String(e)})`,
    };
  } finally {
    clearTimeout(timer);
  }
}

function nodeInfo(): { version: string; ok: boolean } {
  const version = process.version;
  const major = Number.parseInt(version.replace(/^v/, "").split(".")[0] ?? "0", 10);
  return { version, ok: Number.isFinite(major) && major >= 18 };
}

async function globalCmd(): Promise<string> {
  return new Promise((resolveP) => {
    const cmd = process.platform === "win32" ? "where.exe" : "which";
    execFile(cmd, ["omnimod-mcp"], (err, stdout) => {
      if (err) return resolveP("NOT FOUND on PATH");
      resolveP(stdout.split(/\r?\n/).filter(Boolean).join(", ") || "NOT FOUND on PATH");
    });
  });
}

/** Diagnostics for humans: prints a checklist and exits non-zero on failure. */
export async function runDoctor(): Promise<number> {
  const L: string[] = [BAR, `  omnimod-mcp doctor — فحص شامل  (v${MCP_VERSION})`, BAR];
  let failed = 0;
  const row = (ok: boolean, name: string, detail = "") => {
    if (!ok) failed += 1;
    L.push(`  [${ok ? "OK" : "FAIL"}] ${name}${detail ? ` — ${detail}` : ""}`);
  };
  // Informational rows: a missing optional library is not a failure.
  const info = (name: string, detail: string) => L.push(`  [ -- ] ${name} — ${detail}`);

  const node = nodeInfo();
  row(node.ok, `node ${node.version}`, node.ok ? ">= 18 required" : "install Node.js 18+ from https://nodejs.org");
  row(existsSync(ENTRY_FILE), "entry file", ENTRY_FILE);
  row(existsSync(resolve(INSTALL_ROOT, "package.json")), "package.json", `version reported: v${MCP_VERSION}`);
  row(existsSync(resolve(INSTALL_ROOT, "assets", "map-context-pack")), "map context pack", "assets/map-context-pack");
  row(existsSync(resolve(INSTALL_ROOT, "docs", "MAP_DEV_MASTER_GUIDE.md")), "map-dev master guide", "docs/MAP_DEV_MASTER_GUIDE.md");
  row(true, "global command", await globalCmd());

  const ping = await pingBridge();
  row(
    ping.ok,
    `bridge ${baseUrl()}`,
    ping.ok
      ? ping.detail
      : `${ping.detail} — launch the game on the target device and enable Options → Agent Dev Link`,
  );
  row(!!config.token, "pairing token", config.token ? "set" : "not set — run omni_pair with the on-screen code");
  row(
    !!config.forgeCompatRepoUrl && !!config.commandBlocksRepoUrl,
    "engine mirrors",
    `${config.forgeCompatRepoUrl ?? "(missing)"} | ${config.commandBlocksRepoUrl ?? "(missing)"}`,
  );

  // The asset libraries are optional: the tools that use them report their own
  // "unlinked" state, so an absent library must not fail the doctor.
  info("3D model library", config.assetLibraryRepoUrl ?? "(unlinked — omni_3d_* tools disabled)");
  info("sound library", config.sfxRepoUrl ?? "(unlinked — omni_sfx_* tools disabled)");
  info("cache folder", `${config.assetCacheDir} | ${config.sfxCacheDir}`);

  L.push(SEP);
  L.push(describeConfig().split("\n").map((s) => `  ${s}`).join("\n"));
  L.push(SEP);
  L.push(
    failed === 0
      ? `  ALL CHECKS PASSED — everything works.\n` +
          `  Client config JSON : omnimod-mcp setup\n` +
          `  Watch it running   : omnimod-mcp serve`
      : `  ${failed} check(s) FAILED — fix the FAIL lines above, then re-run doctor.`,
  );
  L.push(BAR);
  process.stdout.write(L.join("\n") + "\n");
  return failed === 0 ? 0 : 1;
}
