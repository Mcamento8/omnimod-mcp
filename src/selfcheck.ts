/**
 * Smoke-test battery. Runs without an engine. Verifies that:
 *  - the 1.8 registry is non-empty (198 blocks, 187 items)
 *  - known 1.20 names translate to the right 1.8 form
 *  - modded namespaces pass through
 *  - unresolved 1.20 names report a clear note
 *  - shape generators produce ops
 *  - a built batch round-trips through the validator without errors
 *  - the scaffolder writes files
 *  - the inspector reads a mod folder
 *  - the per-map agent context pack bootstraps, self-heals, and preserves
 *    agent-owned living documents (ownership rules from MapDevWorkspaceDocs)
 *  - FILE_MAP generation, append-only CHANGE_LOG, overview section patching,
 *    verification-report naming, ledger reading, and map-folder resolution
 *
 * Exits 0 on pass, 1 on any problem.
 */
import { translateBlock, translateItem, searchNames } from "./translate.js";
import { BLOCKS_18, ITEMS_18 } from "./registry.js";
import { buildBatch, safeBatchFileName } from "./ops.js";
import * as Shapes from "./shapes.js";
import { scaffoldMod } from "./scaffold.js";
import { inspectMod } from "./inspect.js";
import * as MapDocs from "./mapdocs.js";
import { rm, mkdir, stat, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

function assert(cond: unknown, msg: string): void {
  if (!cond) {
    process.stderr.write(`FAIL: ${msg}\n`);
    process.exit(1);
  }
}

async function main(): Promise<void> {
  process.stderr.write("[omnimod-mcp] selfcheck start\n");

  // Registry.
  assert(BLOCKS_18.size > 150, `BLOCKS_18 too small: ${BLOCKS_18.size}`);
  assert(ITEMS_18.size > 150, `ITEMS_18 too small: ${ITEMS_18.size}`);
  process.stderr.write(`  registry: ${BLOCKS_18.size} blocks, ${ITEMS_18.size} items\n`);

  // Block translations.
  const blockChecks: Array<[string, number, string, number]> = [
    ["minecraft:oak_planks", 0, "minecraft:planks", 0],
    ["minecraft:dark_oak_planks", 0, "minecraft:planks", 5],
    ["minecraft:oak_log", 0, "minecraft:log", 0],
    ["minecraft:acacia_log", 0, "minecraft:log2", 0],
    ["minecraft:stripped_oak_wood", 0, "minecraft:log", 12],
    ["minecraft:white_wool", 0, "minecraft:wool", 0],
    ["minecraft:red_wool", 0, "minecraft:wool", 14],
    ["minecraft:white_terracotta", 0, "minecraft:stained_hardened_clay", 0],
    ["minecraft:light_gray_terracotta", 0, "minecraft:stained_hardened_clay", 8],
    ["minecraft:stone_bricks", 0, "minecraft:stonebrick", 0],
    ["minecraft:mossy_stone_bricks", 0, "minecraft:stonebrick", 1],
    ["minecraft:granite", 0, "minecraft:stone", 1],
    ["minecraft:grass_block", 0, "minecraft:grass", 0],
    ["minecraft:sugar_cane", 0, "minecraft:reeds", 0],
    ["minecraft:dandelion", 0, "minecraft:yellow_flower", 0],
    ["minecraft:stone", 0, "minecraft:stone", 0],
    ["minecraft:oak_stairs", 0, "minecraft:oak_stairs", 0],
  ];
  for (const [in_, metaIn, expectId, expectMeta] of blockChecks) {
    const t = translateBlock(in_, metaIn);
    assert(t.id === expectId && t.meta === expectMeta, `block ${in_} -> ${t.id}@${t.meta}, want ${expectId}@${expectMeta}`);
  }
  process.stderr.write(`  block translations: ${blockChecks.length} cases pass\n`);

  // Modded pass-through.
  const t5 = translateBlock("mymod:custom_block", 0);
  assert(t5.passthrough && t5.id === "mymod:custom_block", `mymod:custom_block should pass through, got ${JSON.stringify(t5)}`);

  // Unresolved.
  const t6 = translateBlock("minecraft:concrete", 0);
  assert(t6.unresolved, "minecraft:concrete should be unresolved");

  // Item translations.
  const t7 = translateItem("minecraft:sugar_cane", 0);
  assert(t7.translated && t7.id === "minecraft:reeds", `sugar_cane -> ${t7.id}`);
  const t8 = translateItem("minecraft:enchanted_golden_apple", 0);
  assert(t8.translated && t8.id === "minecraft:golden_apple" && t8.meta === 1, `enchanted golden apple -> ${t8.id}@${t8.meta}`);
  process.stderr.write("  item translations: pass\n");

  // Search.
  const s = searchNames("oak", "block", 8);
  assert(s.aliasFrom120.length >= 4, `expected at least 4 oak aliases, got ${s.aliasFrom120.length}`);
  process.stderr.write(`  search "oak": ${s.exact18.length} exact, ${s.aliasFrom120.length} alias\n`);

  // Shape generators.
  const cyl = Shapes.cylinder("minecraft:stone", 0, [0, 64, 0], 5, 3);
  assert(cyl.length > 0 && cyl.every((o) => o.op === "fill_area"), "cylinder produced bad ops");
  const sph = Shapes.sphere("minecraft:glass", 0, [0, 64, 0], 4);
  assert(sph.length > 0, "sphere produced no ops");
  const pyr = Shapes.pyramid("minecraft:sandstone", 0, [0, 64, 0], 3);
  assert(pyr.length > 0, "pyramid produced no ops");
  const bld = Shapes.building({ origin: [0, 64, 0], width: 7, depth: 7, height: 3, wallBlock: "minecraft:cobblestone" });
  assert(bld.length > 0, "building produced no ops");
  const line = Shapes.line("minecraft:oak_fence", 0, [0, 64, 0], [10, 64, 10]);
  assert(line.length > 0, "line produced no ops");
  process.stderr.write(`  shape generators: cylinder=${cyl.length} sphere=${sph.length} pyramid=${pyr.length} building=${bld.length} line=${line.length}\n`);

  // Batch validation.
  const batch = buildBatch(
    "smoke",
    [
      { op: "place_block", block: "minecraft:oak_planks", x: 0, y: 64, z: 0 },
      { op: "fill_area", block: "minecraft:stone", from: [0, 64, 0], to: [5, 64, 5] },
      { op: "replace_area", fromBlock: "minecraft:grass", block: "minecraft:dirt", from: [0, 65, 0], to: [5, 65, 5] },
      { op: "set_spawn", pos: [0, 65, 0] },
      { op: "chat", message: "hello" },
      { op: "command", command: "weather clear" },
    ],
    true,
  );
  assert(batch.errors.length === 0, `batch had errors: ${batch.errors.join("; ")}`);
  assert(batch.warnings.length === 0, `batch had warnings: ${batch.warnings.join("; ")}`);
  // place_block 1, fill_area 6x1x6=36, replace_area 6x1x6=36. Total 73.
  assert(batch.estimatedBlocks === 73, `estimatedBlocks wrong: ${batch.estimatedBlocks}`);
  assert(safeBatchFileName("my batch!").endsWith(".json"), "safe filename doesn't end .json");
  process.stderr.write(`  batch: ops=${batch.batch.ops.length} blocks=${batch.estimatedBlocks} bytes=${batch.bytes}\n`);

  // Batch error: y out of range.
  const bad = buildBatch("bad", [{ op: "place_block", block: "minecraft:stone", x: 0, y: 600, z: 0 }], true);
  assert(bad.errors.length > 0 && /y=/.test(bad.errors[0]), "out-of-range y should be reported as an error");
  process.stderr.write("  batch: error path covers y out of range\n");

  // Batch warning: concrete.
  const warn = buildBatch("warn", [{ op: "place_block", block: "minecraft:concrete", x: 0, y: 64, z: 0 }], true);
  assert(warn.warnings.length > 0 && /concrete/.test(warn.warnings[0]), "concrete should produce a warning");
  process.stderr.write("  batch: warning path covers unresolved ids\n");

  // Scaffold.
  const tmp = join(process.env.TEMP ?? "/tmp", `omnimod-mcp-test-${Date.now()}`);
  await mkdir(tmp, { recursive: true });
  const modOut = await scaffoldMod(
    {
      modId: "TestMod",
      displayName: "Test Mod",
      version: "1.0.0",
      author: "selfcheck",
      items: [{ id: "ruby", displayName: "Ruby" }],
      blocks: [
        {
          id: "ruby_block",
          displayName: "Ruby Block",
          recipe: { pattern: ["###", "###", "###"], key: { "#": "minecraft:diamond" }, result: { item: "testmod:ruby_block" } },
        },
      ],
    },
    tmp,
  );
  assert((await stat(join(modOut.outDir, "META-INF", "mods.toml"))).isFile(), "mods.toml not written");
  assert((await stat(join(modOut.outDir, "assets", "testmod", "models", "item", "ruby.json"))).isFile(), "item model not written");
  assert((await stat(join(modOut.outDir, "data", "testmod", "recipes", "ruby_block.json"))).isFile(), "recipe not written");
  process.stderr.write(`  scaffold: wrote ${modOut.files.length} files to ${modOut.outDir}\n`);

  // Inspect.
  const ins = await inspectMod(modOut.outDir);
  assert(ins.metadata.modId === "testmod", `inspect modId: ${ins.metadata.modId}`);
  assert(ins.counts.models >= 3, `inspect model count: ${ins.counts.models}`);
  assert(ins.counts.recipes >= 1, `inspect recipe count: ${ins.counts.recipes}`);
  const fatalProblems = ins.problems.filter((p) => p.severity === "error");
  assert(fatalProblems.length === 0, `inspect found errors: ${fatalProblems.map((p) => p.id).join(", ")}`);
  process.stderr.write(`  inspect: modId=${ins.metadata.modId} models=${ins.counts.models} recipes=${ins.counts.recipes} problems=${ins.problems.length}\n`);

  // ------------------------------------------------------------------
  // Per-map agent context pack (mapdocs.ts + the exported engine pack)
  // ------------------------------------------------------------------
  const pack = await MapDocs.loadPackSource();
  assert(/^omnimod-agent-docs-\d+$/.test(pack.version), `pack version malformed: ${pack.version}`);
  assert(pack.static.length >= 14, `pack too small: ${pack.static.length} static files`);
  assert(pack.living.length === 3, `expected 3 living seeds, got ${pack.living.length}`);
  for (const rel of [...MapDocs.READ_ORDER, ...MapDocs.REFERENCE_DOCS]) {
    if (rel === MapDocs.LAYOUT.README_FILE) continue; // engine-authored, not part of the export
    const found = [...pack.static, ...pack.living].some((f) => f.rel === rel);
    assert(found, `pack is missing a mandated document: ${rel}`);
  }
  for (const f of pack.static) {
    assert(f.text.includes(pack.version), `static doc not version-marked: ${f.rel}`);
    assert(f.text.length > 200, `static doc suspiciously short: ${f.rel} (${f.text.length})`);
  }
  assert(
    pack.static.some((f) => f.text.includes(MapDocs.MAP_TOKEN)),
    "no document carries the map-name token — the export was not templated",
  );
  // [Agent Note 2026-09-04] MAP-MODE — the dual-mode contract (dev/preview)
  // is part of the pack contract: map-building agents must be able to learn
  // the switch exists (command + endpoint + persistence + honest boundaries).
  assert(
    pack.static.some(
      (f) => f.rel.includes("01_MAP_BUILD_SYSTEM") && f.text.includes("/omni_dev mode play"),
    ),
    "dual-mode contract (dev/preview switch) missing from the pack — re-export MapDevWorkspaceDocs",
  );
  assert(
    pack.static.some(
      (f) => f.rel.includes("05_AGENT_LINK_API") && f.text.includes("/omni/mapdev/mode"),
    ),
    "POST /omni/mapdev/mode endpoint missing from the pack — re-export MapDevWorkspaceDocs",
  );
  process.stderr.write(
    `  pack: ${pack.version}, ${pack.static.length} static + ${pack.living.length} living\n`,
  );

  // Bootstrap into a scratch map folder, then verify the ownership rules hold.
  const mapRoot = join(process.env.TEMP ?? "/tmp", `omnimod-mcp-map-${Date.now()}`);
  const mapDir = join(mapRoot, "worlds", "SelfcheckMap");
  await mkdir(mapDir, { recursive: true });
  await writeFile(join(mapDir, "level.dat"), "not-a-real-level", "utf8");

  const boot = await MapDocs.bootstrapPack(mapDir, "SelfcheckMap");
  assert(boot.written.length >= 14, `bootstrap wrote too few files: ${boot.written.length}`);
  assert(boot.seeded.length === 3, `bootstrap seeded ${boot.seeded.length} living docs, expected 3`);
  const startHere = await readFile(join(mapDir, "_dev", "AGENT_START_HERE.md"), "utf8");
  assert(startHere.includes("SelfcheckMap"), "map name was not substituted into the pack");
  assert(!startHere.includes(MapDocs.MAP_TOKEN), "map-name token leaked into the written pack");

  let st = await MapDocs.packStatus(mapDir, "SelfcheckMap");
  // README.md + dev_manifest.json are engine-authored, so a bootstrapped folder
  // reports exactly those two as missing until the game loads the map.
  assert(
    st.missing.length === 2 &&
      st.missing.includes(MapDocs.LAYOUT.README_FILE) &&
      st.missing.includes(MapDocs.LAYOUT.MANIFEST_FILE),
    `unexpected missing set: ${st.missing.join(", ")}`,
  );
  assert(st.outdated.length === 0, `unexpected outdated docs: ${st.outdated.join(", ")}`);
  assert(st.unwritten.length === 3, `expected 3 seeded living docs, got ${st.unwritten.join(", ")}`);

  // Idempotency: a second bootstrap must not rewrite anything.
  const boot2 = await MapDocs.bootstrapPack(mapDir, "SelfcheckMap");
  assert(boot2.written.length === 0 && boot2.refreshed.length === 0 && boot2.seeded.length === 0,
    `second bootstrap was not idempotent: ${JSON.stringify({ w: boot2.written.length, r: boot2.refreshed.length, s: boot2.seeded.length })}`);

  // Self-healing: a stale static doc is replaced, a living doc is not.
  await writeFile(join(mapDir, "_dev", "agent", "00_AGENT_MANDATE.md"), "# stale\n", "utf8");
  await writeFile(join(mapDir, "_dev", "MAP_OVERVIEW.md"), "# my own overview\n", "utf8");
  const stale = await MapDocs.packStatus(mapDir, "SelfcheckMap");
  assert(stale.outdated.includes("agent/00_AGENT_MANDATE.md"), "stale static doc not detected");
  const boot3 = await MapDocs.bootstrapPack(mapDir, "SelfcheckMap");
  assert(boot3.refreshed.includes("agent/00_AGENT_MANDATE.md"), "stale static doc not refreshed");
  assert(!boot3.seeded.includes("MAP_OVERVIEW.md") && !boot3.refreshed.includes("MAP_OVERVIEW.md"),
    "an agent-owned living document was overwritten — ownership rule violated");
  assert((await readFile(join(mapDir, "_dev", "MAP_OVERVIEW.md"), "utf8")).trim() === "# my own overview",
    "living document content was not preserved");

  // Restore the real overview so the section patcher has something to work on.
  await MapDocs.bootstrapPack(mapDir, "SelfcheckMap", { force: true });
  await rm(join(mapDir, "_dev", "MAP_OVERVIEW.md"), { force: true });
  await MapDocs.bootstrapPack(mapDir, "SelfcheckMap");

  // Overview section patching keeps neighbouring sections intact.
  const patched = await MapDocs.patchOverviewSection(mapDir, "SelfcheckMap", 2, "The user wants a harbour town.");
  assert(/^## 2\./.test(patched.heading), `unexpected heading matched: ${patched.heading}`);
  const overview = await readFile(join(mapDir, "_dev", "MAP_OVERVIEW.md"), "utf8");
  assert(overview.includes("The user wants a harbour town."), "section body not written");
  assert(overview.includes("## 3. Current build specification"), "a neighbouring section was destroyed");
  assert(!overview.includes("Status: NOT YET WRITTEN"), "seeded banner not cleared after a real edit");
  let threw = false;
  try {
    await MapDocs.patchOverviewSection(mapDir, "SelfcheckMap", 99 as unknown as number, "x");
  } catch {
    threw = true;
  }
  assert(threw, "patching a non-existent section should throw, not silently succeed");

  // Changelog is append-only.
  const c1 = await MapDocs.appendChangelog(mapDir, "SelfcheckMap", {
    title: "first", agent: "selfcheck", verification: ["ledger clean"],
  });
  const c2 = await MapDocs.appendChangelog(mapDir, "SelfcheckMap", {
    title: "second", agent: "selfcheck", corrects: "first",
  });
  const log = await readFile(c2.path, "utf8");
  assert(log.includes("— first") && log.includes("— second"), "changelog lost an entry");
  assert(log.indexOf("— first") < log.indexOf("— second"), "changelog is not append-ordered");
  assert(log.includes("**Corrects:** first"), "correction reference not recorded");
  assert(/NOT VERIFIED/.test(log), "an entry without verification lines must be flagged");
  assert(c1.bytes < c2.bytes, "changelog did not grow");

  // File map is generated from the real folder, and lists real batches.
  await mkdir(join(mapDir, "_dev", "build"), { recursive: true });
  await writeFile(
    join(mapDir, "_dev", "build", "ops-0001.json"),
    JSON.stringify({ format: "omnimod-dev-1", batch: "floor", ops: [{ op: "fill_area", block: "minecraft:stone", from: [0, 64, 0], to: [4, 64, 4] }] }),
    "utf8",
  );
  await writeFile(join(mapDir, "_dev", "build", "ops-0002-broken.json"), "{ not json", "utf8");
  const fm = await MapDocs.regenerateFileMap(mapDir, "SelfcheckMap", { agent: "selfcheck" });
  assert(fm.text.includes("ops-0001.json"), "file map missed a batch");
  assert(fm.text.includes("floor (1 ops)"), "file map did not read the batch label");
  assert(fm.text.includes("UNPARSEABLE JSON"), "file map did not flag a broken batch");
  assert(fm.text.includes("level.dat"), "file map did not list the world data");
  assert(fm.text.includes("OFF LIMITS"), "file map dropped the off-limits warning");
  assert(fm.text.includes("agent/00_AGENT_MANDATE.md"), "file map did not index the knowledge pack");
  assert(!fm.text.includes(MapDocs.MAP_TOKEN), "file map leaked the map-name token");

  // Verification report naming.
  const rep = await MapDocs.writeVerificationReport(mapDir, "Market Square!!", "# report\n");
  assert(/\d{4}-\d{2}-\d{2}-market-square\.md$/.test(rep.path), `report path not normalised: ${rep.path}`);

  // Ledger reader (Level 1 verification without the bridge).
  await mkdir(join(mapDir, "_dev", "state"), { recursive: true });
  await writeFile(
    join(mapDir, "_dev", "state", "applied.json"),
    JSON.stringify({ format: "omnimod-dev-1", entries: { "ops-0001.json": { hash: "abc", appliedAtMs: 1, ops: 1, placed: 25, failed: 0 } } }),
    "utf8",
  );
  const led = await MapDocs.readLedger(mapDir);
  assert(led !== null && led.entries["ops-0001.json"]?.placed === 25, "ledger not parsed");
  st = await MapDocs.packStatus(mapDir, "SelfcheckMap");
  assert(st.batches.length === 2, `expected 2 batches, got ${st.batches.length}`);
  assert(st.verificationReports.length === 1, `expected 1 report, got ${st.verificationReports.length}`);
  assert(st.hasLedger, "ledger not detected");

  // Map resolution: by mapDir, by worldsDir + name, and a clean failure.
  const byDir = await MapDocs.resolveMapDir({ mapDir }, { worldsDir: null, projectRoot: null });
  assert(byDir.map === "SelfcheckMap", `resolve by mapDir got ${byDir.map}`);
  const byName = await MapDocs.resolveMapDir(
    { map: "SelfcheckMap", worldsDir: join(mapRoot, "worlds") },
    { worldsDir: null, projectRoot: null },
  );
  assert(byName.dir === mapDir, `resolve by name got ${byName.dir}`);
  let resolveThrew = false;
  try {
    await MapDocs.resolveMapDir({ map: "NoSuchMap" }, { worldsDir: join(mapRoot, "worlds"), projectRoot: null });
  } catch (e) {
    resolveThrew = true;
    assert(/Tried:/.test(String(e)), "resolution failure must report what it tried");
  }
  assert(resolveThrew, "resolving a missing map should throw");
  process.stderr.write(
    `  mapdocs: bootstrap+status+overview+changelog+filemap+report verified in ${mapDir}\n`,
  );

  // Cleanup.
  await rm(tmp, { recursive: true, force: true });
  await rm(mapRoot, { recursive: true, force: true });

  process.stderr.write("[omnimod-mcp] selfcheck PASS\n");
}

main().catch((e) => {
  process.stderr.write(`[omnimod-mcp] selfcheck FAIL: ${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
});
