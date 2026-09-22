#!/usr/bin/env node
/**
 * Entry point.
 *
 *   node dist/index.js            agent/pipe usage  -> starts the MCP server (stdio)
 *   node dist/index.js            human terminal    -> prints the connection card
 *   node dist/index.js serve      always            -> card, then RUN the server here
 *   node dist/index.js setup      always            -> prints the connection card
 *   node dist/index.js doctor     always            -> connectivity diagnostics
 *   node dist/index.js selfcheck  always            -> the test battery
 *
 * A global `omnimod-mcp` command (created by the one-command installer via
 * `npm link`) forwards here, so it works from ANY folder on the machine.
 *
 * ABOUT `serve`
 * -------------
 * A stdio MCP server is normally spawned by the client, so it has no window of
 * its own and nothing to look at. `serve` is the opposite: it prints the full
 * connection card, then runs the server IN THIS WINDOW and stays in the
 * foreground, so a human can watch it, debug a connection, or deliberately keep
 * one instance alive.
 *
 * Two properties the user asked for, and how they are guaranteed here:
 *   - the window does not close on its own: `serve` never returns while the
 *     server is running — the process stays alive on stdio.
 *   - closing the window stops the server: closing a console sends its children
 *     a termination signal (and closes their stdin), and both paths are wired to
 *     a clean exit below.
 */
import { startServer, __server } from "./server.js";

export { startServer } from "./server.js";
export { __server } from "./server.js";
export { MCP_VERSION, setupText, printSetup, runDoctor, helpText } from "./setup.js";

import { printSetup, printServeBanner, runDoctor, helpText, MCP_VERSION } from "./setup.js";

const cmd = process.argv[2];

/**
 * Shut down deliberately, once, with a reason.
 *
 * A server that lingers after its window is gone is a stray process on the
 * user's machine and a held-open handle, so every termination path funnels
 * here. Order matters: close the transport first (so the client sees a clean
 * end), then release stdin, then let the loop drain — with a hard fallback in
 * case something else is still holding the process open.
 */
function installShutdownHandlers(): void {
  let closing = false;
  const bye = (why: string, code: number) => {
    if (closing) return;
    closing = true;
    process.stderr.write(`\n[omnimod-mcp] ${why} — stopping.\n`);
    process.exitCode = code;
    void Promise.resolve()
      .then(() => __server.close())
      .catch(() => undefined)
      .then(() => {
        try {
          process.stdin.pause();
          (process.stdin as unknown as { unref?: () => void }).unref?.();
        } catch {
          /* stdin may already be gone */
        }
      });
    // Fallback: never hang on exit because of a stray handle.
    const t = setTimeout(() => process.exit(code), 1500);
    (t as unknown as { unref?: () => void }).unref?.();
  };

  process.stdin.on("end", () => bye("stdin closed by the client", 0));
  // A TTY can emit `close` spuriously; only treat it as fatal when stdin is a
  // pipe, which is exactly the "the client that spawned me went away" case.
  if (!process.stdin.isTTY) {
    process.stdin.on("close", () => bye("stdin closed", 0));
  }
  process.on("SIGINT", () => bye("Ctrl+C", 0));
  process.on("SIGTERM", () => bye("terminated", 0));
  // SIGHUP is what a closed terminal sends on POSIX. On Windows a closed console
  // kills the child directly, which SIGTERM already covers.
  process.on("SIGHUP", () => bye("terminal closed", 0));
  process.on("uncaughtException", (e) => {
    process.stderr.write(
      `[omnimod-mcp] uncaught: ${e instanceof Error ? e.stack ?? e.message : String(e)}\n`,
    );
    bye("fatal error", 1);
  });
}

async function main(): Promise<void> {
  switch (cmd) {
    case "selfcheck":
      // Re-run the same selfcheck logic that lives in server.ts but as a
      // side-effect import — keeping the selfcheck out of the prod hot path
      // keeps stdio clean.
      await import("./selfcheck.js");
      return;
    case "serve":
    case "start":
      // Print the card FIRST so the human has every value they need before the
      // server takes over the process.
      printSetup();
      process.stdout.write("\n");
      printServeBanner();
      installShutdownHandlers();
      await startServer();
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
    // A human ran `omnimod-mcp` in a terminal: show the connection card instead
    // of hanging on stdio, and tell them how to run it visibly. Agents spawn us
    // with piped stdio (isTTY falsy), so they always reach startServer() below.
    printSetup();
    process.stdout.write(
      "\n  To RUN the server in this window (and stop it by closing it):  omnimod-mcp serve\n\n",
    );
    return;
  }

  // Spawned by a client: serve until stdin closes.
  installShutdownHandlers();
  await startServer();
}

main().catch((e) => {
  process.stderr.write(`[omnimod-mcp] fatal: ${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
});

// Keep __server alive when imported by tests/embedders.
void __server;
