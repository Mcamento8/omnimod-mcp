/**
 * Entry point. `node dist/index.js` runs the MCP server over stdio.
 * `node dist/index.js selfcheck` runs the lint battery.
 */
import { startServer, __server } from "./server.js";

export { startServer } from "./server.js";
export { __server } from "./server.js";

const cmd = process.argv[2];
if (cmd === "selfcheck") {
  // Re-run the same selfcheck logic that lives in server.ts but as a side-effect
  // import — keeping the selfcheck out of the prod hot path keeps stdio clean.
  void import("./selfcheck.js");
} else {
  startServer().catch((e) => {
    process.stderr.write(`[omnimod-mcp] fatal: ${e instanceof Error ? e.message : String(e)}\n`);
    process.exit(1);
  });
}

// Keep __server alive when imported by tests/embedders.
void __server;
