# 10 — SYSTEM IMPROVEMENT AGENT CONTEXT (for agents who improve THIS system)

> **You are NOT a map builder.** You are an agent whose task is to improve the OmniMod
> map development system itself: the engine's `_dev/` workspace code, the MCP server, the
> agent context pack, the mod-translation layer, the bridge endpoints, or any supporting
> pipeline. You are here to make the next map-building agent better than you, and to make
> the next system-improvement agent's starting point richer than yours was.

This document is the **meta-context** — the file that exists because the context pack
itself is software, and software needs its own engineers. If you are about to edit the
context pack or anything that affects what the pack says, you are the audience for this
file. **Read it before you write a single line.**

## 1. You have two jobs, not one

1. **The code change** (engine source, MCP source, pipeline docs, scripts). The obvious deliverable.
2. **The context-pack update.** Every map folder in the world already contains the
   knowledge pack that the next map-building agent will read. If you improve the system but
   do NOT update the pack, every existing map will keep telling the next agent the old
   rules, the old limits, the old workflows, the old examples. **The next agent will
   silently build the wrong thing because you forgot to update what they read.**

Both are non-negotiable. A system change shipped without a context-pack update is a
half-ship. See §5 for the exact handoff contract.

## 2. The system you are improving — read these before you touch anything

The map development system spans four layers, in this order of authority:

### 2.1 The engine (Java)

- `MapDevWorkspace.java` — the per-map workspace owner. `DEV_DIR`, `BUILD_SUBDIR`,
  `STATE_SUBDIR`, `LEDGER_FILE`, `MANIFEST_FILE`, the op vocabulary constants, the
  op/file size caps, the bulk-op volume cap, the chat cap, the filename validator,
  and the byte serializers.
- `MapDevSyncRuntime.java` — the apply pipeline. The poll cadence, the per-poll throttle,
  the per-op dispatch, the `ensureWorkspaceAt` hook, the link-folder import.
- `MapBuilderRuntime.java` — the world-touching surface. `resolveBlockState` (no alias
  table — the source of the 1.20→1.8 problem), `placeBlock`, `fillArea`, `replaceArea`,
  the `validPos` y-bounds check.
- `MapDevWorkspaceDocs.java` (this file) — the **single source of truth** for what gets
  written into every map folder. If you are editing another doc's body, edit it here.

### 2.2 The MCP server (TypeScript)

- `mcp/src/mapdocs.ts` — the MCP's mirror of the engine pack, reading
  `mcp/assets/map-context-pack/`. That directory is **exported FROM THE ENGINE** by
  `tmp_mapdev_harness/MapDevWorkspaceDocsExport.java`. Do NOT hand-edit it.
- `mcp/src/translate.ts` — the 1.20→1.8 translation table. Add a row here when a
  new alias is needed; do not add convenience aliases in the engine.
- `mcp/src/ops.ts`, `mcp/src/shapes.ts`, `mcp/src/scaffold.ts`, `mcp/src/inspect.ts` —
  the batch validator, the shape generators, the mod scaffolder, the mod inspector.
- `mcp/src/server.ts` — the tools, resources, prompts. Every new tool ships with a test.
- `mcp/src/selfcheck.ts` — every system change adds a selfcheck assertion.

### 2.3 The harness (Java) — this is the project discipline

- `tmp_mapdev_harness/MapDevWorkspaceHarness.java` — tests the engine contract.
- `tmp_mapdev_harness/MapDevWorkspaceDocsHarness.java` — tests the context pack
  generator. **The contract for what the pack must contain.**
- `tmp_mapdev_harness/MapDevWorkspaceDocsExport.java` — the exporter that keeps the
  MCP in sync with the engine.
- `tmp_mapdev_harness/run_harness.sh` — runs both harnesses against the real shipped
  engine sources. No copies, no mocks.

### 2.4 The pipeline docs

- `docs/project_map/30_AGENT_DEV_BRIDGE_PIPELINE.md` — the `_dev` folder bridge.
- `docs/project_map/31_AGENT_LINK_PIPELINE.md` — the HTTP bridge.
- `docs/context_bundle/AGENT_LOOP.md`, `AGENTS.md`, `AGENT_MOD_COMPAT_GUIDE.md`,
  `AGENT_REAL_TESTING_MANDATE.md` — the project's agent-facing rulebooks.

**Read at least the four engine files and both harness files before designing a change.**
The most common defect in system work is fixing a code path without understanding the
2–3 other code paths that share the same constants.

## 3. The non-negotiables that govern system work

1. **Generalize, never hardcode.** A new op that only works for one map is a defect.
   A translation that only triggers for one mod is a defect. A tool that only handles one
   project is a defect.
2. **No silent failures.** Every failure is logged with the cause. A try/catch that
   swallows is a defect.
3. **No fake tests.** The harness runs the REAL shipped engine code. If your change has
   no harness assertion, you have not verified it. If the assertion cannot fail, you
   have not written a test.
4. **The mod's Java is never executed.** This is the compat layer's promise. Do not
   add a feature that requires running mod bytecode.
5. **Single source of truth for the context pack.** `MapDevWorkspaceDocs.java` is
   canonical. The MCP export is downstream. If they disagree, the engine wins.
6. **Engine source edits need a DevPatch or a rebuild.** The MCP can verify via
   `/omni/devpatch/verify` whether the device is running your source. Without a
   DevPatch, no device can test your change.
7. **The 10s latch is sacred.** Every batch pipeline, every mod-translation step, every
   scan must finish under 10s or the bridge returns `server_thread_timeout`.

## 4. The map-building agent's mental model — keep it intact

Every system change must be evaluated against this question: **does this make a
map-building agent's day better, or does it add a thing they have to learn?**

Good system changes:

- Remove a class of bugs (the 1.20→1.8 translation is the canonical example).
- Speed up the obvious path.
- Make verification possible where it was not.
- Make the next agent's context pack reflect what they actually need to know.

Bad system changes:

- Add a new op without documenting it in `01_MAP_BUILD_SYSTEM.md`.
- Add a new MCP tool without a prompt or resource that tells the agent when to call it.
- Add a new engine constant without updating the harness assertion.
- Add a new failure mode that only the engine logs and the docs do not mention.

When in doubt, the question is not "is this feature useful?" — it is **"does the
map-building agent who reads the context pack six months from now know this exists,
know when to use it, and know how to recognize when it failed?"**

## 5. The context-pack update handoff (your second deliverable)

After you ship any change to the system, the context pack in every existing map folder
must reflect the new reality. Two cases:

### 5.1 The change is internal (refactor, perf, bug fix with no user-visible change)

- No pack update needed. The pack describes user-facing behaviour, not code structure.
- **Exception:** if the bug fix changes a documented limit (op cap, file size, bulk cap,
  chat cap), update the doc that states the limit AND the harness assertion that tests it,
  in the same change.

### 5.2 The change is user-visible (new op, new tool, new limit, new workflow)

- Update the engine-side generator (`MapDevWorkspaceDocs.java`). Bump `DOCS_VERSION`.
- Update the harness assertion that covers the change.
- Re-export the pack (`MapDevWorkspaceDocsExport` → `mcp/assets/map-context-pack/`).
- Build the MCP (`npm run build`). The MCP's `loadPackSource` now serves the new content.
- Add a selfcheck assertion in `mcp/src/selfcheck.ts` that proves the new content
  reached the MCP.
- Add an e2e assertion in `mcp/scripts/e2e.mjs` if the change touches tools/resources.
- **Existing maps auto-heal on the next world load** because the engine re-writes stale
  static docs (the `isStale` check in `MapDevWorkspaceDocs.isStale`).
- **Living documents are never touched by the engine.** If your system change makes a
  previous living document factually wrong, the correct fix is to bump `DOCS_VERSION` so
  the `isStale` check triggers, then either rewrite the living doc template in
  `MapDevWorkspaceDocs.livingDocSeeds` AND accept that existing maps keep their older
  living doc OR write a migration tool.

### 5.3 The pack grew (new agent doc added)

- Add a new `md(...)` body method to `MapDevWorkspaceDocs.java`.
- Add the file path to `staticDocs(map)`.
- Bump `DOCS_VERSION`.
- Update the `READ_ORDER` and `REFERENCE_DOCS` arrays in `mcp/src/mapdocs.ts` only if
  the new doc is mandated or recommended for every map task.
- Update the harness expected-file set in `MapDevWorkspaceDocsHarness.java`.
- Update the MCP selfcheck's required-pack-doc check.
- Re-export. Rebuild. Re-test.

## 6. What MUST land in the context pack when you change these

| if you changed... | the pack must say... |
|---|---|
| a new op kind | a row in the op table in `01_MAP_BUILD_SYSTEM.md` §4, with required + optional fields |
| a new limit (cap, count, size) | the new value in the limits table in `01_MAP_BUILD_SYSTEM.md` §5 |
| a new 1.8 block/item | a row in `02_BLOCK_NAMES_AND_META.md` |
| a new 1.20→1.8 translation | a row in `02_BLOCK_NAMES_AND_META.md` with the 1.8 name and meta |
| a new MCP tool | mention in `05_AGENT_LINK_API.md` §3 with a one-line "use this when..." |
| a new HTTP endpoint | a row in the endpoint table in `05_AGENT_LINK_API.md` §2 |
| a new in-game command | a row in `01_MAP_BUILD_SYSTEM.md` §8 |
| a new verification step | a new check in `04_TESTING_MANDATE.md` with the command and what PASS/FAIL looks like |
| a new common silent failure | a row in `08_TROUBLESHOOTING.md` |
| a new ownership rule | a row in `00_AGENT_MANDATE.md` ownership table AND a row in `09_HANDOFF_PROTOCOL.md` closing sequence |
| a new way to stage mods | a row in `07_MODS_IN_THIS_MAP.md` |
| a new mod-format constraint | a row in `06_MOD_AUTHORING.md` |
| a new building primitive (shape, batch) | a recipe in `03_DESIGN_AND_GEOMETRY.md` §3 |

If your change does not fit any of these rows, ask yourself whether it is user-visible
at all. If it is not, §5.1 applies.

## 7. The verification battery for system changes

A system change is not done when the harness passes. It is done when **all of the
following** are true, in this order:

1. **Engine harness green.** `bash tmp_mapdev_harness/run_harness.sh` (or the PowerShell
   equivalent) passes against the REAL shipped engine code, including your edits.
2. **MCP selfcheck green.** `npm run selfcheck` in `mcp/` passes. Your new pack content
   is asserted, not assumed.
3. **MCP e2e green.** `npm run e2e` in `mcp/` passes. Your new tool/resource is visible
   to a real JSON-RPC client and answers the expected shape.
4. **Pack re-exported.** The diff between `MapDevWorkspaceDocs.java` and
   `mcp/assets/map-context-pack/` shows the new content reached the MCP, with no
   hand-edits to the MCP side.
5. **A new context file is present in the exported pack.** Read the new file from
   `mcp/assets/map-context-pack/static/agent/<name>.md` and confirm it is the version
   you wrote (version marker present, expected headings present, expected tables present).
6. **The doc the next agent will read mentions the change.** Pick the most likely doc a
   map-building agent will consult about the area you changed, and confirm by reading it
   that the new rule, tool, limit, or workflow is described.
7. **An existing map that had the OLD pack now gets the NEW pack on next world load.**
   Manually verify by either (a) loading any map folder and checking the doc version
   markers, or (b) reading `MapDevSyncRuntime.ensureAgentDocs` and tracing the
   staleness logic with a test doc.
8. **A changelog entry describes the system change.** Not in a map folder's
   `CHANGE_LOG.md` — in the **project repo's** `CHANGELOG.md` or `docs/CHANGELOG.md`,
   so the human owner of the project knows what shipped.

Skipping any of these is the difference between "I made a change" and "I shipped
a change that future agents can rely on."

## 8. Working agreement — the same precision the map builders owe

You are a system-improvement agent. The map-building agents you serve are held to the
precision standard in `00_AGENT_MANDATE.md`. You are held to the same standard applied
to your own domain.

- **Cite the engine file:line you are changing.** "I fixed the batch validator" is a
  defect. "I changed `MapDevSyncRuntime.applyBatch` at line 437 to log `failed_ops`
  instead of swallowing it" is a result.
- **Do not break older engines.** If your change is backwards-incompatible, the
  `DOCS_VERSION` bump is mandatory, a migration note in the changelog is mandatory, and a
  selfcheck that the MCP's `omni_devpatch_verify` would catch the running device is
  mandatory.
- **Do not break older maps.** A static-doc rewrite is fine (it is the self-heal path).
  A living-doc rewrite without the user's consent is data loss.
- **Do not break the no-alias-table promise.** Translation is the MCP's job. The engine
  stays clean. If you find yourself adding a "convenience alias" to the engine, write the
  translation entry in `mcp/src/translate.ts` instead.
- **If the user's request can be served by a doc update, prefer the doc update.** Adding
  200 lines of Java to enforce a rule that could be stated in 6 lines of markdown is a
  defect. Add the doc, add a selfcheck that the doc says it, move on.

## 9. When to escalate, when to ask, when to ship

| situation | action |
|---|---|
| The change touches the engine's runtime contract (op vocabulary, ledger format, batch schema) | **Stop and ask the human owner.** This breaks every existing agent, every existing map, and every existing MCP. The blast radius is project-wide. |
| The change adds a new MCP tool, resource, or prompt | Ship if selfcheck + e2e + doc update all pass. |
| The change adds a new translation entry | Ship if a selfcheck assertion proves it reaches the MCP. No harness change needed (translation is in the MCP). |
| The change adds a new doc to the pack | Ship if harness + selfcheck + re-export + bump all pass. |
| The change rewords an existing doc (clarification, typo fix, added example) | Ship if `DOCS_VERSION` is bumped and the re-export carries the new text. No behaviour change. |
| The change is "just a comment" or "just a rename" in a non-doc file | Ship. No pack update. Mention in the project changelog. |
| You are unsure which bucket you are in | Write the doc first, then write the code, then prove the doc is still true after the code. If at any point the doc lies, fix the doc, not the code path. |

## 10. Definition of done (for a system improvement task)

- [ ] The engine change is in the right file with the right citation.
- [ ] The harness assertion that covers the change is in the right harness file.
- [ ] The MCP selfcheck assertion that covers the change is in `mcp/src/selfcheck.ts`.
- [ ] The MCP e2e assertion that covers the change is in `mcp/scripts/e2e.mjs`.
- [ ] The context pack in `mcp/assets/map-context-pack/` reflects the change (re-exported, not hand-edited).
- [ ] The pack version `DOCS_VERSION` was bumped if the change is user-visible.
- [ ] The next map-building agent who reads the relevant doc will know about the change.
- [ ] An existing map folder with an older pack self-heals to the new pack on next world load (verified manually or by the `isStale` logic test in the harness).
- [ ] The project-level changelog has a one-line entry naming what shipped.

If any of these is missing, the task is not done. The map-building agents who pick up
this work tomorrow will not know what you shipped, and you will have wasted their first
hour on every new map they touch.

<!-- omnimod-docs-version: omnimod-agent-docs-4 -->
