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
  baseUrl,
  describeConfig,
  DEFAULT_FORGE_COMPAT_REPO,
  DEFAULT_COMMAND_BLOCKS_REPO,
} from "./config.js";

const HERE = dirname(fileURLToPath(import.meta.url));
/** Absolute install root of this MCP package (…/dist → …). */
export const INSTALL_ROOT = resolve(HERE, "..");
/** Absolute entry file agents/clients point at. */
export const ENTRY_FILE = resolve(HERE, "index.js");

/** Forward-slash path: safe to paste into every client's JSON config. */
export const entryForJson = (): string => ENTRY_FILE.replace(/\\/g, "/");

export const MCP_VERSION = "1.3.0";

const BAR = "=".repeat(64);
const SEP = "-".repeat(64);

function clientBlock(title: string, json: string): string {
  return [`[${title}]`, json, ""].join("\n");
}

function kiloJson(): string {
  return JSON.stringify(
    { mcpServers: { omnimod: { command: "node", args: [entryForJson()] } } },
    null,
    2,
  );
}

function clineJson(): string {
  return JSON.stringify(
    {
      "cline.mcpServers": {
        omnimod: { command: "node", args: [entryForJson()], disabled: false },
      },
    },
    null,
    2,
  );
}

function genericJson(): string {
  return JSON.stringify(
    { omnimod: { command: "node", args: [entryForJson()] } },
    null,
    2,
  );
}

function desktopJson(): string {
  return JSON.stringify(
    {
      mcpServers: {
        omnimod: {
          command: "node",
          args: [entryForJson()],
          env: {
            OMNIMOD_HOST: config.host,
            OMNIMOD_PORT: String(config.port),
            OMNIMOD_TOKEN: config.token ?? "",
          },
        },
      },
    },
    null,
    2,
  );
}

/** The connect dashboard: what a human sees in the terminal. */
export function setupText(): string {
  const L: string[] = [];
  L.push(BAR);
  L.push(`  OmniMod MCP v${MCP_VERSION} — يعمل بنجاح / up and running`);
  L.push(BAR);
  L.push(`  Install dir : ${INSTALL_ROOT}`);
  L.push(`  Entry file  : ${entryForJson()}`);
  L.push(`  Global cmd  : omnimod-mcp   (works from ANY folder — يعمل من أي مسار)`);
  L.push(`  Bridge      : ${baseUrl()}   (the device running the game)`);
  L.push(`  Token       : ${config.token ? "SET" : "NOT SET — pair once with omni_pair (see step 3)"}`);
  L.push(`  Sources     : ${config.forgeCompatRepoUrl ?? DEFAULT_FORGE_COMPAT_REPO}`);
  L.push(`                ${config.commandBlocksRepoUrl ?? DEFAULT_COMMAND_BLOCKS_REPO}`);
  L.push(SEP);
  L.push(`  ربط الوكيل — انسخ كتلة وكيلك والصقها في إعدادات الـ MCP لديه`);
  L.push(`  Connect your agent — copy YOUR client block into its MCP settings:`);
  L.push("");
  L.push(clientBlock("Kilo Code  (~/.zcode/config.json → mcpServers)", kiloJson()));
  L.push(clientBlock("Cline  (VS Code settings.json → cline.mcpServers)", clineJson()));
  L.push(clientBlock("Cursor  (Settings → MCP → Add server)", genericJson()));
  L.push(clientBlock("Claude Code  (.mcp.json)", kiloJson()));
  L.push(clientBlock("Claude Desktop  (claude_desktop_config.json)", desktopJson()));
  L.push(SEP);
  L.push(`  Next steps — الخطوات التالية:`);
  L.push(`  1) Paste the block above into your agent, then restart the agent.`);
  L.push(`  2) In the agent chat, run:  omni_ping`);
  L.push(`  3) Pair once: read the 8-char code on the device`);
  L.push(`     (Options → Agent Link Info → Quick Pair), then:`);
  L.push(`         omni_pair { "code": "XXXXXXXX" }`);
  L.push(`  4) Build:  omni_knowledge { "topic": "rules" }  then create!`);
  L.push(`  Diagnostics any time:  omnimod-mcp doctor`);
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
    `  omnimod-mcp              Run from a terminal → shows the connect guide.`,
    `                             Run by an agent (piped stdio) → starts the server.`,
    `  omnimod-mcp setup        Show the connect guide (client JSON + pairing steps).`,
    `  omnimod-mcp doctor       Diagnose: node, files, bridge, token, repo links.`,
    `  omnimod-mcp selfcheck    Run the built-in test battery.`,
    `  omnimod-mcp --version    Print the version.`,
    `  omnimod-mcp --help       Show this help.`,
    ``,
    `One-command install (Windows: cmd or PowerShell, paste as ONE line):`,
    `  powershell -NoProfile -ExecutionPolicy Bypass -c "$f=$env:TEMP+'\\omnimod-install.ps1'; irm https://raw.githubusercontent.com/Mcamento8/omnimod-mcp/main/scripts/install-windows.ps1 -OutFile $f; & $f"`,
  ].join("\n");
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
  const L: string[] = [BAR, `  omnimod-mcp doctor — فحص شامل`, BAR];
  let failed = 0;
  const row = (ok: boolean, name: string, detail = "") => {
    if (!ok) failed += 1;
    L.push(`  [${ok ? "OK" : "FAIL"}] ${name}${detail ? ` — ${detail}` : ""}`);
  };

  const node = nodeInfo();
  row(node.ok, `node ${node.version}`, node.ok ? ">= 18 required" : "install Node.js 18+ from https://nodejs.org");
  row(existsSync(ENTRY_FILE), "entry file", ENTRY_FILE);
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

  L.push(SEP);
  L.push(describeConfig().split("\n").map((s) => `  ${s}`).join("\n"));
  L.push(SEP);
  L.push(
    failed === 0
      ? `  ALL CHECKS PASSED — everything works. Need client JSON? run: omnimod-mcp setup`
      : `  ${failed} check(s) FAILED — fix the FAIL lines above, then re-run doctor.`,
  );
  L.push(BAR);
  process.stdout.write(L.join("\n") + "\n");
  return failed === 0 ? 0 : 1;
}
