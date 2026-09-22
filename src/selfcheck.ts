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
import * as Assets3D from "./assets3d.js";
import * as Sfx from "./sfx.js";
import * as ModelCheck from "./modelcheck.js";
import { MCP_VERSION, setupText, serveBanner, helpText, INSTALL_ROOT } from "./setup.js";
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
  // 3D asset library (pure parts — no network required)
  // ------------------------------------------------------------------
  // The library tools promise an agent two things it cannot get anywhere else:
  // a search that answers from measurements, and a fetch it can PROVE is the
  // file that was measured. Both are testable without touching the network.
  const synth: Assets3D.LibCatalog = {
    schema: 2,
    hashAlgo: Assets3D.EXPECTED_HASH_ALGO,
    count: 4,
    models: [
      {
        id: "kenney/furniture-kit/chair", name: "chair", source: "kenney", pack: "furniture-kit",
        category: "furniture", tags: ["furniture"], tri: 128, grp: 1, anim: "whole-model",
        uv: true, tex: true, size: [0.5, 0.9, 0.5], bb: [-0.25, 0, -0.25, 0.25, 0.9, 0.25],
        mat: [{ n: "wood", c: "#e59a64" }], gr: ["chair"], sha: "a".repeat(64),
        file: "kenney/furniture-kit/chair.obj", bytes: 4210,
      },
      {
        id: "kenney/building-kit/door-rotate-square-d", name: "door-rotate-square-d", source: "kenney",
        pack: "building-kit", category: "buildings", tags: ["building", "door"], tri: 264, grp: 3,
        anim: "per-part", uv: true, tex: true, size: [0.2, 2.1, 0.9],
        bb: [-0.1, 0, -0.45, 0.1, 2.1, 0.45], mat: [{ n: "colormap", c: "#ffffff", t: "Textures/colormap.png" }],
        gr: ["frame", "leaf"], sha: "b".repeat(64), file: "kenney/building-kit/door-rotate-square-d.obj", bytes: 9000,
      },
      {
        id: "kenney/castle-kit/wall", name: "wall", source: "kenney", pack: "castle-kit",
        category: "buildings", tags: ["building", "wall", "medieval"], tri: 88, grp: 1,
        anim: "whole-model", uv: true, tex: true, size: [1, 1.31, 1],
        bb: [-0.5, 0, -0.5, 0.5, 1.31, 0.5], mat: [{ n: "colormap", c: "#ffffff", t: "Textures/colormap.png" }],
        gr: ["wall"], sha: "c".repeat(64), file: "kenney/castle-kit/wall.obj", bytes: 12063,
      },
      {
        id: "kaykit/prototype-bits-1.1/flat_decal", name: "flat_decal", source: "kaykit",
        pack: "prototype-bits-1.1", category: "props-environments", tags: ["decor"], tri: 4, grp: 1,
        anim: "whole-model", uv: false, tex: false, size: [4, 0.01, 4],
        bb: [-2, 0, -2, 2, 0.01, 2], mat: [{ n: "d", c: "#cccccc" }], gr: [],
        sha: "d".repeat(64), file: "kaykit/prototype-bits-1.1/flat_decal.obj", bytes: 300,
      },
    ],
  };

  // Ranking: an identity hit must outrank a mere tag/category hit.
  const ranked = Assets3D.searchCatalog(synth, { query: "chair" });
  assert(ranked.length > 0 && ranked[0].id === "kenney/furniture-kit/chair",
    `search ranking wrong: got ${ranked.map((m) => m.id).join(", ")}`);

  // Structured filters.
  assert(Assets3D.searchCatalog(synth, { category: "buildings" }).length === 2, "category filter wrong");
  assert(Assets3D.searchCatalog(synth, { tag: ["door"] }).length === 1, "tag filter wrong");
  assert(Assets3D.searchCatalog(synth, { anim: "per-part" }).length === 1, "anim filter wrong");
  assert(Assets3D.searchCatalog(synth, { maxTri: 100 }).length === 2, "maxTri filter wrong");
  assert(Assets3D.searchCatalog(synth, { textured: true }).length === 3, "textured filter wrong");
  assert(Assets3D.searchCatalog(synth, { maxSize: 1 }).length === 3, "maxSize filter wrong");

  // Id resolution: exact, unambiguous short form, and ambiguous short form.
  assert(Assets3D.findModel(synth, "kenney/castle-kit/wall")?.id === "kenney/castle-kit/wall", "exact id lookup failed");
  assert(Assets3D.findModel(synth, "chair")?.id === "kenney/furniture-kit/chair", "short id lookup failed");
  assert(Assets3D.findModel(synth, "wall")?.id === "kenney/castle-kit/wall", "unique name lookup failed");
  assert(Assets3D.findModel(synth, "nope") === null, "a missing id must return null, not a guess");

  // Assessment: the flat decal must be called out, and the door must expose its parts.
  const aDoor = Assets3D.assess(synth.models[1]);
  assert(aDoor.animationMode === "per-part" && aDoor.namedParts.length === 2,
    `door assessment wrong: ${JSON.stringify(aDoor.namedParts)}`);
  const aFlat = Assets3D.assess(synth.models[3]);
  assert(aFlat.notes.some((n) => /decal\/ground tile/.test(n)), "a flat model must be flagged as a decal");
  assert(aFlat.notes.some((n) => /no texture coordinates/.test(n)), "a UV-less model must be flagged");
  const aChair = Assets3D.assess(synth.models[0]);
  assert(aChair.withinBudget && aChair.notes.some((n) => /no named parts/.test(n)),
    "a single-part model must say so");

  // The hash contract: line endings must not change the identity of a mesh,
  // because the recorder (AnalyzeModels.java) and a git checkout disagree on them.
  const lf = Buffer.from("v 0 0 0\nv 1 0 0\nf 1 2 3\n", "utf8");
  const crlf = Buffer.from("v 0 0 0\r\nv 1 0 0\r\nf 1 2 3\r\n", "utf8");
  assert(Assets3D.hashModelContent(lf) === Assets3D.hashModelContent(crlf),
    "the model hash must be line-ending independent");
  assert(Assets3D.hashModelContent(lf) !== Assets3D.hashModelContent(Buffer.from("v 0 0 0\nv 1 0 0\n", "utf8")),
    "a different mesh must hash differently");
  assert(Assets3D.hashModelContent(lf) === Assets3D.hashModelContent(Buffer.from(lf)),
    "the hash must be deterministic across calls");
  assert(Assets3D.hashModelContent(lf).length === 64, "the hash must be a 64-hex-character SHA-256");

  // Cache staleness: a catalogue that does not declare the hash convention, or
  // that predates the enriched fields, must be rejected rather than used.
  assert(Assets3D.catalogIsUsable(synth), "a well-formed catalogue must be accepted");
  assert(!Assets3D.catalogIsUsable({ count: 1, models: synth.models }), "a catalogue without hashAlgo must be rejected");
  assert(!Assets3D.catalogIsUsable({ ...synth, models: [{ id: "x" }] }), "an unenriched catalogue must be rejected");
  assert(!Assets3D.catalogIsUsable(null), "null must be rejected");
  process.stderr.write(
    `  assets3d: search/filters/id-resolution/assessment/hash/cache-staleness pass (${synth.count} synthetic models)\n`,
  );

  // Optional live round trip: exercises the real library over HTTPS and proves
  // the recorded hash matches the published bytes. Off by default so the
  // battery stays hermetic; set OMNIMOD_SELFCHECK_LIVE_ASSETS=1 to include it.
  if (/^(1|true|yes|on)$/i.test(process.env.OMNIMOD_SELFCHECK_LIVE_ASSETS ?? "")) {
    const live = await Assets3D.loadCatalog({ refresh: true });
    assert(live.count > 1000, `live catalogue suspiciously small: ${live.count}`);
    const target = Assets3D.findModel(live, "kenney/castle-kit/wall");
    assert(target !== null, "live catalogue is missing kenney/castle-kit/wall");
    const liveOut = join(tmp, "live-assets");
    const got = await Assets3D.fetchModel(target!, liveOut);
    assert(got.verified, `live fetch failed verification: got ${got.sha256}, want ${got.expectedSha256}`);
    process.stderr.write(
      `  assets3d LIVE: ${live.count} models, fetched ${got.id} and verified its SHA-256\n`,
    );
    const sfxLive = await Sfx.loadCatalog({ refresh: true });
    assert(sfxLive.sounds.length > 100, `live SFX catalogue suspiciously small: ${sfxLive.sounds.length}`);
    const click = Sfx.searchSfx(sfxLive, { query: "click", category: "ui" })[0];
    assert(click !== undefined, "live SFX catalogue has no UI click");
    const gotSfx = await Sfx.fetchSfx(click, join(tmp, "live-sfx"), { format: "ogg" });
    assert(gotSfx.verified, `live SFX fetch failed verification: got ${gotSfx.sha256}`);
    assert(gotSfx.header.recognised, "the downloaded sound's header was not recognised");
    process.stderr.write(
      `  sfx LIVE: ${sfxLive.sounds.length} sounds, fetched ${gotSfx.id} and verified it ` +
        `(${gotSfx.header.container}, ${gotSfx.header.channels}ch @ ${gotSfx.header.sampleRate}Hz)\n`,
    );
  } else {
    process.stderr.write("  assets3d LIVE: skipped (set OMNIMOD_SELFCHECK_LIVE_ASSETS=1 to enable)\n");
    process.stderr.write("  sfx LIVE: skipped (set OMNIMOD_SELFCHECK_LIVE_ASSETS=1 to enable)\n");
  }

  // ------------------------------------------------------------------
  // Sound library (pure parts — no network required)
  // ------------------------------------------------------------------
  // The sound tools promise three things an agent cannot get elsewhere: a
  // search that understands what it is asking for, a download it can PROVE, and
  // an install that will not silently produce a file the engine never plays.

  const sfxCat: Sfx.SfxCatalog = {
    version: "test",
    license_audio: "CC0-1.0",
    count: 3,
    sounds: [
      {
        id: "ui-audio_click5", title: "click 5", pack: "ui-audio", category: "ui",
        tags: ["button", "click"], use_cases: ["menu navigation"], mood: ["neutral"],
        keywords_en: ["click", "button"], keywords_ar: ["زر", "ضغطة"],
        duration_sec: 0.032, formats: ["ogg"],
        download_url_ogg: "https://example.invalid/a/click5.ogg", size_ogg: 4532,
        sha256_ogg: "a".repeat(64), license: "CC0-1.0",
      },
      {
        id: "oga-512-retro_sword2", title: "sword 2", pack: "oga-512-retro", category: "retro",
        tags: ["sword", "16-bit"], use_cases: ["combat"], mood: ["aggressive"],
        keywords_en: ["sword"], keywords_ar: ["ضربة"],
        duration_sec: 0.096, formats: ["wav"],
        download_url_wav: "https://example.invalid/a/The Pack [512 sounds]/sword2.wav", size_wav: 8000,
        sha256_wav: "b".repeat(64), license: "CC0-1.0",
      },
      {
        id: "music-jingles_hit12", title: "jingles HIT12", pack: "music-jingles", category: "music-jingle",
        tags: ["win"], use_cases: ["level complete"], mood: ["triumphant"],
        keywords_en: ["win", "success"], keywords_ar: ["فوز"],
        duration_sec: 8.5, formats: ["ogg"],
        download_url_ogg: "https://example.invalid/a/hit12.ogg", size_ogg: 90000,
        sha256_ogg: "c".repeat(64), license: "CC0-1.0",
      },
    ],
  };

  // Filters.
  assert(Sfx.searchSfx(sfxCat, { category: "ui" }).length === 1, "sfx category filter");
  assert(Sfx.searchSfx(sfxCat, { tag: ["button"] }).length === 1, "sfx tag filter");
  assert(Sfx.searchSfx(sfxCat, { format: "ogg" }).length === 2, "sfx format filter");
  assert(Sfx.searchSfx(sfxCat, { maxDuration: 1 }).length === 2, "sfx maxDuration filter");
  assert(Sfx.searchSfx(sfxCat, { minDuration: 5 }).length === 1, "sfx minDuration filter");
  assert(Sfx.searchSfx(sfxCat, { useCase: "menu" }).length === 1, "sfx useCase filter");
  assert(Sfx.searchSfx(sfxCat, { mood: "triumphant" }).length === 1, "sfx mood filter");

  // Ranking: identity beats category, and a Latin term must match at a word
  // boundary — otherwise "win" scores a full hit on "swing3" and buries the
  // real win jingle.
  const sfxRank = Sfx.searchSfx(sfxCat, { query: "click" });
  assert(sfxRank.length === 1 && sfxRank[0].id === "ui-audio_click5", "sfx search ranking");
  const swingTrap: Sfx.SfxCatalog = {
    ...sfxCat,
    sounds: [
      { ...sfxCat.sounds[0], id: "x_swing3", title: "swing 3", keywords_ar: [] },
      { ...sfxCat.sounds[2], id: "x_win", title: "win", keywords_ar: [] },
    ],
  };
  assert(
    Sfx.searchSfx(swingTrap, { query: "win" })[0].id === "x_win",
    "a Latin term must match at a word boundary (swing must not beat win)",
  );

  // Arabic bridge: a term the catalogue does not carry must still reach the
  // English sounds that mean the same thing.
  assert(Sfx.expandTerms("سيوف").includes("sword"), "Arabic term must expand to its English synonyms");
  assert(Sfx.expandTerms("زر").includes("click"), "Arabic 'زر' must expand to click");
  assert(Sfx.expandTerms("nonsense").length === 1, "an unknown term expands to itself only");
  assert(
    Sfx.searchSfx(sfxCat, { query: "سيوف" }).some((s) => s.id === "oga-512-retro_sword2"),
    "an Arabic query must reach the English-matching sound",
  );
  assert(
    Sfx.searchSfx(sfxCat, { query: "زر" })[0].id === "ui-audio_click5",
    "an Arabic query must reach the sound that carries it as an Arabic keyword",
  );

  // Duration role + fit warnings.
  assert(Sfx.durationRole(0.05).includes("blip"), "a 50 ms sound is a blip");
  assert(Sfx.durationRole(0.4).includes("UI click"), "a 0.4 s sound is a UI click");
  assert(Sfx.durationRole(20).includes("music"), "a 20 s sound is music/ambience");
  const aClick = Sfx.assessSfx(sfxCat.sounds[0], "a button click");
  assert(aClick.mismatchWarnings.length === 0, "a 32 ms click suits a button click");
  assert(aClick.approxKbps === null, "a sub-0.5 s file must not report a meaningless bitrate");
  const aJingle = Sfx.assessSfx(sfxCat.sounds[2], "a button click");
  assert(aJingle.mismatchWarnings.length > 0, "an 8.5 s jingle must be flagged for a click trigger");
  const aAmbience = Sfx.assessSfx(sfxCat.sounds[0], "looping ambience");
  assert(aAmbience.mismatchWarnings.length > 0, "a 32 ms blip must be flagged for ambience");

  // Format selection.
  assert(Sfx.availableFormats(sfxCat.sounds[1]).join() === "wav", "wav-only sound reports wav");
  assert(Sfx.chooseFormat(sfxCat.sounds[1]) === "wav", "chooseFormat picks the only option");
  let choseThrew = false;
  try {
    Sfx.chooseFormat(sfxCat.sounds[1], "ogg");
  } catch {
    choseThrew = true;
  }
  assert(choseThrew, "asking for a format the sound lacks must throw, not silently substitute");

  // URL encoding: the upstream catalogue contains raw spaces and brackets, and
  // a client that fetches them verbatim gets InvalidURL.
  const messy = "https://example.invalid/a/The Pack [512 sounds]/sword 2.wav";
  const enc = Sfx.encodeUrl(messy);
  assert(!enc.includes(" "), `encodeUrl left a space: ${enc}`);
  assert(enc.includes("The%20Pack%20%5B512%20sounds%5D"), `encodeUrl did not encode the path: ${enc}`);
  assert(decodeURIComponent(enc) === messy, "encodeUrl must be reversible");
  assert(Sfx.encodeUrl(enc) === enc, "encodeUrl must be idempotent on already-encoded input");

  // sounds.json merge: create, preserve, idempotent, and refuse to clobber.
  const m1 = Sfx.mergeSoundsJson(null, "click", "ui_click5");
  assert(m1.eventCreated && m1.soundAdded && JSON.parse(m1.text).click.sounds[0] === "ui_click5", "merge into an empty doc creates the event and adds the sound");
  const seeded = JSON.stringify({ door: { category: "block", sounds: ["door_open"] } });
  const m2 = Sfx.mergeSoundsJson(seeded, "click", "ui_click5", { category: "ui" });
  const parsed2 = JSON.parse(m2.text);
  assert(m2.eventCreated && m2.soundAdded, "a new event on an existing document is reported as a created EVENT");
  assert(
    JSON.stringify(parsed2.door) === JSON.stringify({ category: "block", sounds: ["door_open"] }),
    "merging must not touch an existing event",
  );
  assert(parsed2.click.category === "ui", "category hint applied");
  const m3 = Sfx.mergeSoundsJson(m2.text, "click", "ui_click5");
  assert(!m3.soundAdded && m3.existingSounds === 1, "re-merging the same sound is a no-op");
  let mergeThrew = false;
  try {
    Sfx.mergeSoundsJson("{ not json", "x", "y");
  } catch {
    mergeThrew = true;
  }
  assert(mergeThrew, "a malformed sounds.json must be refused, never overwritten");
  let shapeThrew = false;
  try {
    Sfx.mergeSoundsJson(JSON.stringify({ click: ["not-an-object"] }), "click", "x");
  } catch {
    shapeThrew = true;
  }
  assert(shapeThrew, "an existing non-object event must be refused");

  // Audio header probe — real parsing, no decoder.
  const wavBuf = Buffer.alloc(48);
  wavBuf.write("RIFF", 0, "latin1");
  wavBuf.writeUInt32LE(40, 4);
  wavBuf.write("WAVE", 8, "latin1");
  wavBuf.write("fmt ", 12, "latin1");
  wavBuf.writeUInt32LE(16, 16);
  wavBuf.writeUInt16LE(1, 20);
  wavBuf.writeUInt16LE(2, 22);
  wavBuf.writeUInt32LE(44100, 24);
  wavBuf.writeUInt32LE(176400, 28);
  wavBuf.writeUInt16LE(4, 32);
  wavBuf.writeUInt16LE(16, 34);
  const hWav = Sfx.probeAudioHeader(wavBuf);
  assert(
    hWav.container === "wav" && hWav.channels === 2 && hWav.sampleRate === 44100 && hWav.bitsPerSample === 16,
    `wav header probe wrong: ${JSON.stringify(hWav)}`,
  );

  const oggBuf = Buffer.alloc(64);
  oggBuf.write("OggS", 0, "latin1");
  Buffer.from([0x01, 0x76, 0x6f, 0x72, 0x62, 0x69, 0x73]).copy(oggBuf, 10);
  oggBuf.writeUInt32LE(0, 17);
  oggBuf.writeUInt8(2, 21);
  oggBuf.writeUInt32LE(48000, 22);
  const hOgg = Sfx.probeAudioHeader(oggBuf);
  assert(
    hOgg.container === "ogg/vorbis" && hOgg.channels === 2 && hOgg.sampleRate === 48000,
    `ogg header probe wrong: ${JSON.stringify(hOgg)}`,
  );

  const flacBuf = Buffer.alloc(64);
  flacBuf.write("fLaC", 0, "latin1");
  const packed = (32000n << 44n) | (0n << 41n) | (15n << 36n); // 1 channel, 16 bit
  flacBuf.writeBigUInt64BE(packed, 18);
  const hFlac = Sfx.probeAudioHeader(flacBuf);
  assert(
    hFlac.container === "flac" && hFlac.channels === 1 && hFlac.sampleRate === 32000 && hFlac.bitsPerSample === 16,
    `flac header probe wrong: ${JSON.stringify(hFlac)}`,
  );

  const junk = Sfx.probeAudioHeader(Buffer.from("not audio at all, really not", "utf8"));
  assert(!junk.recognised, "unrecognised bytes must be reported as unrecognised, not guessed at");

  // Cache staleness.
  assert(Sfx.catalogIsValid(sfxCat), "a well-formed SFX catalogue is accepted");
  assert(!Sfx.catalogIsValid({ count: 1, sounds: [{ title: "x" }] }), "a catalogue without ids is rejected");
  assert(!Sfx.catalogIsValid({ sounds: [] }), "an empty catalogue is rejected");
  assert(!Sfx.catalogIsValid(null), "null is rejected");

  process.stderr.write(
    "  sfx: filters/ranking/arabic-bridge/duration-fit/format/url-encoding/" +
      "sounds.json-merge/header-probe/cache-staleness pass\n",
  );

  // ------------------------------------------------------------------
  // Human-facing terminal surface (the connection card + serve banner)
  // ------------------------------------------------------------------
  // The version used to be a literal in two files and it drifted: the terminal
  // announced 1.3.0 while the package was 1.6.0. Anyone reporting a problem
  // quoted a version that did not exist. These assertions make that impossible.
  const pkg = JSON.parse(
    await readFile(join(INSTALL_ROOT, "package.json"), "utf8"),
  ) as { version: string };
  assert(
    MCP_VERSION === pkg.version,
    `MCP_VERSION (${MCP_VERSION}) must equal package.json (${pkg.version})`,
  );
  assert(/^\d+\.\d+\.\d+/.test(MCP_VERSION), `version looks malformed: ${MCP_VERSION}`);

  const card = setupText();
  // Every value a human needs to wire this into a tool must be on the card.
  for (const key of [
    "MCP version", "Install folder", "Entry file", "Node", "Transport",
    "Bridge URL", "Host / Port", "Pairing token",
    "Project root", "Worlds dir", "Work dir",
    "3D models (CC0)", "Sounds (CC0)", "cache",
    "Forge compat", "Command blocks",
  ]) {
    assert(card.includes(key), `connection card is missing "${key}"`);
  }
  // ...and a paste-ready block for each client family.
  for (const client of [
    "Claude Desktop", "Claude Code", "Cursor", "VS Code", "Cline",
    "Kilo Code", "Windsurf", "Zed", "Continue",
  ]) {
    assert(card.includes(client), `connection card is missing the ${client} block`);
  }
  assert(card.includes("mcpServers"), "card must show an mcpServers block");
  assert(card.includes("context_servers"), "card must show the Zed context_servers shape");
  assert(card.includes('"type": "stdio"'), "card must show the VS Code stdio shape");
  assert(card.includes("dist/index.js") || card.includes("dist\index.js"), "card must name the entry file");
  // The card must be honest about which mode is which.
  assert(card.includes("omnimod-mcp serve"), "card must tell the user how to run it visibly");

  const banner = serveBanner();
  assert(banner.includes("SERVER RUNNING"), "serve banner must say the server is running");
  assert(/closing this window|Close this window|close this window/i.test(banner), "serve banner must say how to stop it");
  assert(/Ctrl\+C/i.test(banner), "serve banner must mention Ctrl+C");
  assert(/Do NOT type/i.test(banner), "serve banner must warn that stdin is the data channel");

  const help = helpText();
  for (const cmd of ["serve", "setup", "doctor", "selfcheck"]) {
    assert(help.includes(cmd), `help text does not document "${cmd}"`);
  }
  process.stderr.write(
    `  terminal: version ${MCP_VERSION} matches package.json; card carries ` +
      `${9} client blocks + all connection fields; serve banner + help verified
`,
  );

  // ------------------------------------------------------------------
  // Hand-authored model validation (pure parts — no network required)
  // ------------------------------------------------------------------
  // The library covers models that already exist. This covers the model the
  // agent writes itself, where the expensive mistakes live: a concave face the
  // engine's fan triangulation tears apart, a texture bound with no UVs, a base
  // far below its own origin.

  // A correct, hand-authored 1x1x1 box: base on y=0, outward winding.
  const goodBox =
    "mtllib crate.mtl\no crate\nusemtl wood\n" +
    "v 0 0 0\nv 1 0 0\nv 1 0 1\nv 0 0 1\nv 0 1 0\nv 1 1 0\nv 1 1 1\nv 0 1 1\n" +
    "f 1 4 3 2\nf 5 6 7 8\nf 1 2 6 5\nf 3 4 8 7\nf 2 3 7 6\nf 4 1 5 8\n";
  const woodMtl = "newmtl wood\nKd 0.55 0.36 0.20\n";

  const rGood = ModelCheck.buildReport("crate", goodBox, woodMtl);
  assert(rGood.engine.triangles === 12, `good box should be 12 triangles, got ${rGood.engine.triangles}`);
  assert(rGood.engine.groups === 1, "good box should be one group");
  assert(rGood.engine.sizeBlocks.x === 1 && rGood.engine.sizeBlocks.y === 1, "good box should be 1x1x1");
  assert(rGood.engine.baseOffsetY === 0, "good box base must sit on y=0");
  assert(rGood.counts.errors === 0 && rGood.counts.warnings === 0, `good box must be clean: ${JSON.stringify(rGood.findings)}`);
  assert(rGood.ok, "a clean model must report ok");

  const ids = (obj: string, mtl: string | null = null, ctx = {}) =>
    ModelCheck.buildReport("t", obj, mtl, ctx).findings.map((f) => f.id);

  assert(ids("v 0 0 0\nv 1 0 0\nv 2 0 0\nv 0 1 0\nf 1 2 3\nf 1 2 4\n").includes("degenerate_triangles"),
    "a collinear triangle must be reported as degenerate");
  assert(ids("v 0 0 0\nv 1 0 0\nv 1 1 0\nv 0 1 0\nf 1 2 3\nf 1 2 3\n").includes("duplicate_triangles"),
    "a repeated face must be reported as a duplicate");
  assert(ids("usemtl nope\nv 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n").includes("material_undefined"),
    "usemtl without an MTL definition must be reported");
  assert(
    ids("v 0 0 0\nv 3 0 0\nv 3 1 0\nv 1 1 0\nv 1 3 0\nv 0 3 0\nf 1 2 3 4 5 6\n").includes("concave_faces"),
    "a concave polygon must be reported — fan triangulation tears it apart",
  );
  assert(
    ids("mtllib t.mtl\nv 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n", "newmtl m\nKd 1 1 1\nmap_Kd w.png\n")
      .includes("texture_without_uv"),
    "a bound texture with no vt lines must be an error",
  );
  assert(ids("v 0 -2 0\nv 1 -2 0\nv 1 -1 0\nv 0 -1 0\nf 1 2 3 4\n").includes("base_not_at_origin"),
    "a base below y=0 must be reported — placement anchors by base centre");
  assert(
    ids("v 0 0 0\nv 1 0 0\nv 1 1 0\nv 0 1 0\nvt 0 0\nvt 1 0\nvt 1 1\nf 1/1 2/2 3/3\nf 1 3 4\n",
        "newmtl m\nKd 1 1 1\nmap_Kd x.png\n").includes("partial_uvs"),
    "a file where only some faces carry vt must be reported",
  );
  assert(ids("v 0 0 0\nv 1 0 0\nv 0 1 0\nvn 0 0 5\nf 1//1 2//1 3//1\n").includes("unnormalised_normals"),
    "a non-unit normal must be reported");
  assert(ids("# empty\n").includes("no_geometry"), "a file with no faces must be reported as empty");
  assert(
    ModelCheck.buildReport("t", "v 0 0 0\nv 40 0 0\nv 40 40 0\nv 0 40 0\nf 1 2 3 4\n", null, {
      expectedSizeBlocks: 1,
    }).findings.some((f) => f.id === "scale_mismatch"),
    "a model far larger than the stated intent must be reported",
  );
  assert(
    ModelCheck.buildReport(
      "t",
      "v 0 0 0\nv 1 0 0\nv 0 1 0\n" + Array.from({ length: 30001 }, () => "f 1 2 3").join("\n"),
      null,
    ).findings.some((f) => f.id === "over_budget" && f.severity === "error"),
    "a model over the triangle budget must be a blocking error",
  );

  // Named parts must be surfaced, because that is what makes per-part animation
  // possible at all.
  const parts = ModelCheck.buildReport("t", "v 0 0 0\nv 1 0 0\nv 0 1 0\nv 1 1 0\no body\nf 1 2 3\no lid\nf 2 4 3\n", null);
  assert(parts.engine.groupNames.join(",") === "body,lid", `named parts wrong: ${parts.engine.groupNames}`);

  // Every shipped template must pass its own validator — a template that fails
  // is worse than no template, because it looks authoritative.
  const kinds: ModelCheck.TemplateKind[] = ["box", "slab", "ramp", "pillar", "plane", "box_with_parts"];
  for (const k of kinds) {
    const t = ModelCheck.buildTemplate(k, { width: 2, height: 1.5, depth: 3 });
    const r = ModelCheck.buildReport(`template:${k}`, t.obj, t.mtl);
    const bad = r.findings.filter((x) => x.severity !== "note");
    assert(bad.length === 0, `template "${k}" fails its own validator: ${bad.map((x) => x.id).join(", ")}`);
    assert(r.engine.baseOffsetY === 0, `template "${k}" does not sit on y=0`);
    assert(r.engine.triangles > 0, `template "${k}" has no geometry`);
  }
  // A two-part template must NOT leave two coincident faces (the classic
  // z-fighting bug): body and lid share an interface.
  const twoPart = ModelCheck.buildTemplate("box_with_parts", { width: 2, height: 2, depth: 2 });
  assert(
    !ModelCheck.buildReport("t", twoPart.obj, twoPart.mtl).findings.some((x) => x.id === "duplicate_triangles"),
    "the two-part template must not contain coincident faces",
  );
  process.stderr.write(
    "  modelcheck: parser + 11 defect families + 6 self-validated templates pass\n",
  );

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
  // [OMNI3D 2026-09-22] the world-model contract is part of the pack contract:
  // map-building agents must be able to learn the doctrine (3D-first BUT the
  // user's request is the specification), the /omni3d command family, and the
  // weak-device performance budget.
  assert(
    pack.static.some(
      (f) =>
        f.rel.includes("12_OMNI_3D_MODELS") &&
        f.text.includes("THE DOCTRINE") &&
        f.text.includes("/omni3d place") &&
        f.text.includes("must STAND"),
    ),
    "OMNI3D world-model contract missing from the pack — re-export MapDevWorkspaceDocs",
  );
  assert(
    pack.static.some(
      (f) => f.rel.includes("05_AGENT_LINK_API") && f.text.includes("/omni/model3d/upload"),
    ),
    "OMNI3D /omni/model3d endpoints missing from the pack — re-export MapDevWorkspaceDocs",
  );
  // [ASSET-LIBRARY 2026-09-22] the CC0 model library is part of the pack
  // contract: a map agent must be able to learn that the library exists, that it
  // is CC0, and that the four omni_3d_* tools are the supported way to find,
  // VERIFY and fetch a model — otherwise it will hand-author meshes it could
  // have picked from a measured, licence-clean catalogue.
  assert(
    pack.static.some(
      (f) =>
        f.rel.includes("12_OMNI_3D_MODELS") &&
        f.text.includes("CC0 model library") &&
        f.text.includes("omni_3d_search") &&
        f.text.includes("omni_3d_fetch") &&
        f.text.includes("omni_3d_inspect") &&
        f.text.includes("SHA-256"),
    ),
    "the CC0 model-library contract is missing from the pack — re-export MapDevWorkspaceDocs",
  );
  assert(
    pack.static.some(
      (f) => f.rel.includes("12_OMNI_3D_MODELS") && f.text.includes("verified: false"),
    ),
    "the pack must tell the agent what a failed library verification means",
  );
  // [SOUND 2026-09-22] the sound contract is part of the pack contract: a map
  // agent must learn that a CC0 sound library exists, how to reach it, AND the
  // constraint that decides whether its work is audible at all — the engine
  // resolves every sound reference to <name>.ogg.
  assert(
    pack.static.some(
      (f) =>
        f.rel.includes("13_SOUND_AND_AUDIO") &&
        f.text.includes("omni_sfx_search") &&
        f.text.includes("omni_sfx_install") &&
        f.text.includes("THE OGG RULE") &&
        f.text.includes("sounds.json"),
    ),
    "the sound contract is missing from the pack — re-export MapDevWorkspaceDocs",
  );
  assert(
    pack.static.some(
      (f) => f.rel.includes("13_SOUND_AND_AUDIO") && f.text.includes("playsound"),
    ),
    "the sound doc must show how to actually play the event",
  );
  // [AUTHORING 2026-09-22] a map agent that needs a model the library does not
  // have must be able to AUTHOR one correctly. The pack must carry the decision
  // order, the structural rules the engine enforces, and the validation loop —
  // otherwise it will hand-write an OBJ and ship something invisible or torn.
  assert(
    pack.static.some(
      (f) =>
        f.rel.includes("14_AUTHORING_3D_MODELS") &&
        f.text.includes("THE DECISION ORDER") &&
        f.text.includes("omni_3d_template") &&
        f.text.includes("omni_3d_validate") &&
        f.text.includes("concave"),
    ),
    "the 3D authoring contract is missing from the pack — re-export MapDevWorkspaceDocs",
  );
  assert(
    pack.static.some(
      (f) => f.rel.includes("14_AUTHORING_3D_MODELS") && f.text.includes("base sits exactly on y = 0"),
    ),
    "the authoring doc must state the base-origin rule",
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
