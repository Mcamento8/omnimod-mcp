#!/usr/bin/env node
/**
 * Entry point.
 *
 *   node dist/index.js            agent/pipe usage  -> starts the MCP server (stdio)
 *   node dist/index.js            human terminal    -> prints the connect guide
 *   node dist/index.js setup      always            -> prints the connect guide
 *   node dist/index.js doctor     always            -> connectivity diagnostics
 *   node dist/index.js selfcheck  always            -> the test battery
 *
 * A global `omnimod-mcp` command (created by the one-command installer via
 * `npm link`) forwards here, so it works from ANY folder on the machine.
 */
import { startServer, __server } from "./server.js";

export { startServer } from "./server.js";
export { __server } from "./server.js";
export { MCP_VERSION, setupText, printSetup, runDoctor, helpText } from "./setup.js";

import { printSetup, runDoctor, helpText, MCP_VERSION } from "./setup.js";

const cmd = process.argv[2];

async function main(): Promise<void> {
  switch (cmd) {
    case "selfcheck":
      // Re-run the same selfcheck logic that lives in server.ts but as a
      // side-effect import — keeping the selfcheck out of the prod hot path
      // keeps stdio clean.
      await import("./selfcheck.js");
      return;
    case "setup":
    case "connect":
    case "guide":
      printSetup();
      return;
    case "doctor":
    case "diagnose":
      process.exitCode = await runDoctor();
      return;
    case "--help":
    case "-h":
    case "help":
      process.stdout.write(helpText() + "\n");
      return;
    case "--version":
    case "-v":
    case "version":
      process.stdout.write(`omnimod-mcp ${MCP_VERSION}\n`);
      return;
    default:
      break;
  }

  if (cmd === undefined && process.stdin.isTTY) {
    // A human ran `omnimod-mcp` in a terminal: show the connect guide instead
    // of hanging on stdio. Agents spawn us with piped stdio (isTTY falsy),
    // so they always reach startServer() below.
    printSetup();
    return;
  }

  startServer().catch((e) => {
    process.stderr.write(`[omnimod-mcp] fatal: ${e instanceof Error ? e.message : String(e)}\n`);
    process.exit(1);
  });
}

void main();

// Keep __server alive when imported by tests/embedders.
void __server;
