/**
 * OmniMod MCP — runtime configuration.
 *
 * Every value can be supplied by env var (for MCP client config blocks) or by
 * the `omni_connect` tool at runtime (which mutates the live session config).
 */
import { homedir } from "node:os";
import { resolve, isAbsolute } from "node:path";

export interface OmniConfig {
  /** Host or IP where the game (Agent Dev Link bridge) is listening. */
  host: string;
  /** Bridge port. The engine default is 26911 (AgentLink.DEFAULT_PORT). */
  port: number;
  /** 32-hex pairing token, or null when not yet paired. */
  token: string | null;
  /** Per-request timeout in ms. The engine bounds game-thread work at 10s. */
  timeoutMs: number;
  /** Absolute path to the OmniMod project checkout (for local JAR/doc access). */
  projectRoot: string | null;
  /**
   * Absolute path to the folder that contains the map save folders. On Desktop
   * this is `<projectRoot>/filesystem/worlds` (PlatformFilesystem.filesystemsRoot
   * = "filesystem", DesktopClientConfigAdapter.getWorldsDB() = "worlds"). Set it
   * explicitly when the saves live somewhere else (a copy pulled off a phone, an
   * exported map folder, a synced network share).
   */
  worldsDir: string | null;
  /** Directory where scaffolded mods / exported schematics are written. */
  workDir: string;
  /** When true, block ids in ops are auto-translated 1.20 -> 1.8 before send. */
  autoTranslateBlocks: boolean;
  /**
   * Public GitHub repository that mirrors the engine's Forge 1.20.1 compat
   * layer (the sources an agent reads to author compatible mods). Served
   * through omni_knowledge(topic:"repos") and describeConfig().
   */
  forgeCompatRepoUrl: string | null;
  /**
   * Public GitHub repository that mirrors the engine's command-block /
   * command-surface system (Brigadier shim + parity commands + dual-mode
   * gates). Served through omni_knowledge(topic:"repos") and describeConfig().
   */
  commandBlocksRepoUrl: string | null;
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function envBool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  return /^(1|true|yes|on)$/i.test(raw.trim());
}

function envUrl(name: string): string | null {
  const raw = process.env[name];
  if (!raw || !raw.trim()) return null;
  const t = raw.trim();
  return /^https?:\/\//i.test(t) ? t : `https://${t}`;
}

/**
 * Default public mirrors of the two engine systems. They are pre-linked so
 * the MCP works for everyone out of the box; setting the env var overrides
 * the default, and setting it to an empty value explicitly unlinks.
 */
export const DEFAULT_FORGE_COMPAT_REPO =
  "https://github.com/Mcamento8/omnimod-forge-compat";
export const DEFAULT_COMMAND_BLOCKS_REPO =
  "https://github.com/Mcamento8/omnimod-command-blocks";

function envUrlOrDefault(name: string, fallback: string): string | null {
  const raw = process.env[name];
  if (raw === undefined) return fallback; // not set -> pre-linked default
  if (!raw.trim()) return null; // explicitly emptied -> unlinked
  const t = raw.trim();
  return /^https?:\/\//i.test(t) ? t : `https://${t}`;
}

function envPath(name: string): string | null {
  const raw = process.env[name];
  if (!raw || !raw.trim()) return null;
  const t = raw.trim();
  return isAbsolute(t) ? t : resolve(process.cwd(), t);
}

export const config: OmniConfig = {
  host: (process.env.OMNIMOD_HOST || "127.0.0.1").trim(),
  port: envInt("OMNIMOD_PORT", 26911),
  token: (process.env.OMNIMOD_TOKEN || "").trim() || null,
  timeoutMs: envInt("OMNIMOD_TIMEOUT_MS", 20000),
  projectRoot: envPath("OMNIMOD_PROJECT_ROOT"),
  worldsDir: envPath("OMNIMOD_WORLDS_DIR"),
  workDir: envPath("OMNIMOD_WORK_DIR") || resolve(homedir(), ".omnimod-mcp"),
  autoTranslateBlocks: envBool("OMNIMOD_AUTO_TRANSLATE_BLOCKS", true),
  forgeCompatRepoUrl: envUrlOrDefault(
    "OMNIMOD_FORGE_COMPAT_REPO",
    DEFAULT_FORGE_COMPAT_REPO,
  ),
  commandBlocksRepoUrl: envUrlOrDefault(
    "OMNIMOD_COMMAND_BLOCKS_REPO",
    DEFAULT_COMMAND_BLOCKS_REPO,
  ),
};

export function baseUrl(): string {
  return `http://${config.host}:${config.port}`;
}

/** Human-readable connection summary used in tool output and diagnostics. */
export function describeConfig(): string {
  return [
    `bridge: ${baseUrl()}`,
    `token: ${config.token ? `set (${config.token.slice(0, 4)}…${config.token.slice(-4)})` : "NOT SET"}`,
    `projectRoot: ${config.projectRoot ?? "(not set)"}`,
    `worldsDir: ${config.worldsDir ?? (config.projectRoot ? `(derived: ${config.projectRoot}/filesystem/worlds)` : "(not set)")}`,
    `workDir: ${config.workDir}`,
    `autoTranslateBlocks: ${config.autoTranslateBlocks}`,
    `forgeCompatRepoUrl: ${config.forgeCompatRepoUrl ?? "(not set — set OMNIMOD_FORGE_COMPAT_REPO)"}`,
    `commandBlocksRepoUrl: ${config.commandBlocksRepoUrl ?? "(not set — set OMNIMOD_COMMAND_BLOCKS_REPO)"}`,
  ].join("\n");
}
