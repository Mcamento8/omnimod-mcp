/**
 * HTTP client for the OmniMod Agent Dev Link bridge.
 *
 * Contract notes taken from the engine (sources/main/java/net/lax1dude/
 * eaglercraft/v1_8/sp/agentlink/):
 *  - Business errors come back as HTTP 200 with {"ok":false,"error":...}.
 *  - Transport/auth/routing errors use real status codes (401/403/404/405/429/500/503).
 *  - Auth is `Authorization: Bearer <token>`; `X-Agent-Token` is equivalent.
 *  - GET /omni/ping and POST /omni/pair are pre-auth.
 *  - Game-thread work is bounded at 10s server-side; we allow a little more.
 */
import { config, baseUrl } from "./config.js";

export interface Envelope {
  ok: boolean;
  error?: string;
  message?: string;
  [k: string]: unknown;
}

export class BridgeError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly httpStatus: number | null,
    readonly hint?: string,
    readonly body?: unknown,
  ) {
    super(message);
    this.name = "BridgeError";
  }
}

/** Maps bridge error codes to actionable guidance for the calling agent. */
const ERROR_HINTS: Record<string, string> = {
  bad_token:
    "The token is missing or wrong. Ask the user to open Options -> Agent Link Info -> Quick Pair Computer, then call omni_pair with the 8-character code.",
  not_paired:
    "The token is right but this computer's IP is not paired. Ask the user to open Quick Pair on the device, then call omni_pair with the code.",
  locked:
    "This IP is locked out for 10 minutes after 5 consecutive bad-token attempts. Wait, or have the user regenerate the token.",
  bridge_not_ready:
    "The bridge is enabled but the listener is not up yet (it retries with backoff). Wait a few seconds and retry. If it persists, the user should check Options -> Agent Link Info for the retry counter.",
  unknown_endpoint:
    "This build of OmniMod does not have that endpoint. Call omni_help to see the endpoint catalog this device actually serves.",
  no_world:
    "No world is loaded. Call omni_world_create or omni_world_enter first, then retry.",
  world_running:
    "A world is already running. Call omni_world_quit first (world creation requires the main menu).",
  world_exists: "A world with that name already exists. Pick another name or enter the existing one.",
  world_not_found: "No saved world with that folder name. Call omni_worlds to list the real names.",
  server_thread_timeout:
    "The integrated server thread did not answer within 10 seconds. The command was probably too heavy (huge fill, chunk generation). Split the work into smaller batches.",
  main_thread_timeout:
    "The client main thread did not answer within 10 seconds. The game may be mid-load or hung; check omni_state and omni_errors.",
  box_too_large: "world_scan is capped at 64x64x64 = 262144 blocks per call. Split the region.",
  too_large: "A mapdev batch is capped at 8 MB. Split the ops across several batches.",
  bad_json: "The body was not valid JSON, or the batch content was not valid JSON.",
  command_failed:
    "The command was rejected by the engine's command manager. Remember this is a 1.8.8-era command surface — check the syntax with omni_knowledge('commands').",
  scope_violation:
    "This credential comes from a map folder, so it is scoped to ONE map: you have full control inside it, but creating or entering another map is refused on purpose. Use the master token / permanent code for whole-game actions, or omni_map_connect on the other map's folder.",
  world_mismatch:
    "A restart can only reload the map that is currently running. Omit 'name' to restart the active world, or quit then enter the other map explicitly.",
  context_required:
    "The bridge's context-first gate is armed: a mutating call was refused until you acknowledge the map's context pack. Read GET /omni/context (mode=link is enough when you only need the credential and the fingerprint), then POST /omni/context/ack with the exact fingerprint you received. omni_map_onboard does this for you; omni_3d_upload retries automatically.",
  context_fingerprint_mismatch:
    "The fingerprint you acked is not the one the bridge currently serves — the pack changed between your read and your ack. Re-read GET /omni/context and ack the new fingerprint.",
};

function headers(preAuth: boolean): Record<string, string> {
  const h: Record<string, string> = {
    "Content-Type": "application/json; charset=utf-8",
    Accept: "application/json",
  };
  if (!preAuth && config.token) h["Authorization"] = `Bearer ${config.token}`;
  return h;
}

async function request(
  method: "GET" | "POST",
  path: string,
  opts: { body?: unknown; query?: Record<string, unknown>; preAuth?: boolean; timeoutMs?: number } = {},
): Promise<Envelope> {
  const preAuth = opts.preAuth === true;
  if (!preAuth && !config.token) {
    throw new BridgeError(
      "No pairing token configured for the OmniMod bridge.",
      "no_token",
      null,
      ERROR_HINTS["bad_token"],
    );
  }

  const url = new URL(path, baseUrl());
  if (opts.query) {
    for (const [k, v] of Object.entries(opts.query)) {
      if (v === undefined || v === null || v === "") continue;
      url.searchParams.set(k, String(v));
    }
  }

  const controller = new AbortController();
  const timeoutMs = opts.timeoutMs ?? config.timeoutMs;
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: headers(preAuth),
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      signal: controller.signal,
    });
  } catch (err) {
    const cause = err instanceof Error ? err.message : String(err);
    if (controller.signal.aborted) {
      throw new BridgeError(
        `Request to ${method} ${path} timed out after ${timeoutMs} ms.`,
        "client_timeout",
        null,
        "The bridge bounds game-thread work at 10 s. If this keeps happening the game is likely hung or the work is too heavy; check omni_state and omni_errors.",
      );
    }
    throw new BridgeError(
      `Cannot reach the OmniMod bridge at ${baseUrl()} (${cause}).`,
      "unreachable",
      null,
      "Confirm the game is running, that the user enabled Options -> Agent Dev Link, and that host/port are right. Note the bridge does NOT exist on Web/TeaVM targets — use the _dev folder bridge there.",
    );
  } finally {
    clearTimeout(timer);
  }

  const text = await res.text();
  let parsed: Envelope;
  try {
    parsed = text ? (JSON.parse(text) as Envelope) : { ok: false, error: "empty_response" };
  } catch {
    throw new BridgeError(
      `Bridge returned non-JSON (HTTP ${res.status}): ${text.slice(0, 400)}`,
      "bad_response",
      res.status,
    );
  }

  if (!res.ok || parsed.ok === false) {
    const code = String(parsed.error ?? `http_${res.status}`);
    const msg = String(parsed.message ?? `HTTP ${res.status}`);
    throw new BridgeError(`${method} ${path} -> ${code}: ${msg}`, code, res.status, ERROR_HINTS[code], parsed);
  }
  return parsed;
}

export const bridge = {
  get: (path: string, query?: Record<string, unknown>, timeoutMs?: number) =>
    request("GET", path, { query, timeoutMs }),
  post: (path: string, body?: unknown, timeoutMs?: number) => request("POST", path, { body, timeoutMs }),
  /** Pre-auth calls: GET /omni/ping and POST /omni/pair only. */
  getPreAuth: (path: string) => request("GET", path, { preAuth: true }),
  postPreAuth: (path: string, body?: unknown) => request("POST", path, { body, preAuth: true }),

  /**
   * Satisfy the bridge's context-first gate.
   *
   * The gate refuses state-changing calls with HTTP 428 / `context_required`
   * until the caller quotes the fingerprint of the pack it just read, which is
   * what makes a blind ack impossible. Tools that mutate state can call this and
   * retry once instead of bouncing the failure back to the agent.
   *
   * Returns the acknowledged fingerprint, or null when the bridge did not
   * publish one (older builds) — in that case the caller should surface the
   * original error rather than pretend it acked.
   */
  ackContext: async (): Promise<string | null> => {
    const ctx = (await request("GET", "/omni/context", {
      query: { mode: "link" },
    })) as Record<string, unknown>;
    const fp =
      (ctx.fingerprint as string | undefined) ??
      (ctx.packFingerprint as string | undefined) ??
      null;
    if (!fp) return null;
    await request("POST", "/omni/context/ack", { body: { fingerprint: fp } });
    return fp;
  },
};
