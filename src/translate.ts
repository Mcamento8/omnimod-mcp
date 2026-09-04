/**
 * 1.20 -> 1.8 name+meta translation for blocks and items.
 *
 * This is the layer that makes an agent's natural instinct ("place
 * minecraft:oak_planks") actually build something on OmniMod. Without it,
 * `oak_planks` resolves to null in Block.blockRegistry and the op is a silent
 * no-op with only an `unknown_block` log line
 * (MapBuilderRuntime.java:148-152).
 *
 * The engine has NO alias table on the placement path (verified by grep across
 * sources/ for grass_block / oak_planks / BLOCK_ALIAS / legacyName /
 * nameAlias / blockNameCompat). The one hit, DynamicBlockBehaviorRegistry.java:64,
 * is a behavior heuristic for mod blocks, not a name resolver. So this table
 * lives here, client-side, and every op we emit is translated before send.
 *
 * `ModernRecipeRuntime` does carry its own VANILLA_ITEM_RENAME_120_TO_18 table
 * (ModernRecipeRuntime.java:45-80) for recipe ingredients — that is a separate
 * path and does not help block placement.
 */
import { BLOCKS_18, ITEMS_18 } from "./registry.js";

export interface Translation {
  /** Fully-qualified id to actually send (always `minecraft:<1.8 name>` for vanilla). */
  id: string;
  /** 1.8 metadata nibble. */
  meta: number;
  /** True when the input name was already a valid 1.8 name. */
  passthrough: boolean;
  /** True when the input was renamed/meta-mapped. */
  translated: boolean;
  /** Set when the name has no 1.8 equivalent at all. */
  unresolved?: true;
  /** Human explanation — always populated for translated/unresolved. */
  note?: string;
}

/** 1.8 wool/glass/clay/carpet colour order. Index == metadata value. */
const COLORS = [
  "white", "orange", "magenta", "light_blue", "yellow", "lime", "pink", "gray",
  "light_gray", "cyan", "purple", "blue", "brown", "green", "red", "black",
] as const;

/** 1.8 wood variants for planks/leaves/sapling (log splits across log/log2). */
const WOODS = ["oak", "spruce", "birch", "jungle", "acacia", "dark_oak"] as const;

/** name -> [1.8 name, meta]. Built at module load; see buildBlockAliases(). */
const BLOCK_ALIAS = new Map<string, [string, number]>();
/** Names with no 1.8 equivalent -> the reason/suggestion. */
const BLOCK_UNAVAILABLE = new Map<string, string>();
const ITEM_ALIAS = new Map<string, [string, number]>();
const ITEM_UNAVAILABLE = new Map<string, string>();

function b(from: string, to: string, meta = 0): void {
  BLOCK_ALIAS.set(from, [to, meta]);
}
function i(from: string, to: string, meta = 0): void {
  ITEM_ALIAS.set(from, [to, meta]);
}

function buildBlockAliases(): void {
  // --- colour families (meta == colour index) -------------------------------
  COLORS.forEach((c, m) => {
    b(`${c}_wool`, "wool", m);
    b(`${c}_carpet`, "carpet", m);
    b(`${c}_stained_glass`, "stained_glass", m);
    b(`${c}_stained_glass_pane`, "stained_glass_pane", m);
    b(`${c}_terracotta`, "stained_hardened_clay", m);
    b(`${c}_bed`, "bed", 0);
    b(`${c}_banner`, "standing_banner", 0);
    b(`${c}_wall_banner`, "wall_banner", 0);
    BLOCK_UNAVAILABLE.set(`${c}_concrete`, "concrete is 1.12+; nearest 1.8 match is stained_hardened_clay");
    BLOCK_UNAVAILABLE.set(`${c}_concrete_powder`, "concrete_powder is 1.12+; nearest 1.8 match is sand");
    BLOCK_UNAVAILABLE.set(`${c}_glazed_terracotta`, "glazed_terracotta is 1.12+; nearest 1.8 match is stained_hardened_clay");
    BLOCK_UNAVAILABLE.set(`${c}_shulker_box`, "shulker_box is 1.11+; use a chest for storage");
  });

  // --- wood families -------------------------------------------------------
  WOODS.forEach((w, m) => {
    b(`${w}_planks`, "planks", m);
    b(`${w}_leaves`, m < 4 ? "leaves" : "leaves2", m < 4 ? m : m - 4);
    b(`${w}_sapling`, "sapling", m);
    b(`${w}_slab`, "wooden_slab", m);
    // 1.8 log axis lives in the upper meta bits: 0-3 = upright, 12-15 = all-bark "wood".
    b(`${w}_log`, m < 4 ? "log" : "log2", m < 4 ? m : m - 4);
    b(`${w}_wood`, m < 4 ? "log" : "log2", (m < 4 ? m : m - 4) + 12);
    // 1.13+ stripped variants: closest honest match is the plain log.
    b(`stripped_${w}_log`, m < 4 ? "log" : "log2", m < 4 ? m : m - 4);
    b(`stripped_${w}_wood`, m < 4 ? "log" : "log2", (m < 4 ? m : m - 4) + 12);
  });
  // Stairs / fences / doors that DO have their own 1.8 block, except oak which
  // uses the unprefixed legacy name.
  b("oak_fence", "fence");
  b("oak_fence_gate", "fence_gate");
  b("oak_door", "wooden_door");
  b("oak_trapdoor", "trapdoor");
  b("oak_pressure_plate", "wooden_pressure_plate");
  b("oak_button", "wooden_button");
  b("oak_sign", "standing_sign");
  b("oak_wall_sign", "wall_sign");
  for (const w of ["spruce", "birch", "jungle", "acacia", "dark_oak"] as const) {
    // <w>_stairs / <w>_fence / <w>_fence_gate / <w>_door already exist in 1.8.
    b(`${w}_pressure_plate`, "wooden_pressure_plate");
    b(`${w}_button`, "wooden_button");
    b(`${w}_trapdoor`, "trapdoor");
    b(`${w}_sign`, "standing_sign");
    b(`${w}_wall_sign`, "wall_sign");
  }
  for (const w of WOODS) {
    BLOCK_UNAVAILABLE.set(`${w}_hanging_sign`, "hanging signs are 1.20; use standing_sign / wall_sign");
  }
}

function buildStoneAliases(): void {
  // --- stone family --------------------------------------------------------
  b("stone_bricks", "stonebrick", 0);
  b("mossy_stone_bricks", "stonebrick", 1);
  b("cracked_stone_bricks", "stonebrick", 2);
  b("chiseled_stone_bricks", "stonebrick", 3);
  b("granite", "stone", 1);
  b("polished_granite", "stone", 2);
  b("diorite", "stone", 3);
  b("polished_diorite", "stone", 4);
  b("andesite", "stone", 5);
  b("polished_andesite", "stone", 6);
  b("smooth_stone", "stone", 0);
  b("cobblestone_stairs", "stone_stairs");
  b("stone_brick_slab", "stone_slab", 5);
  b("cobblestone_slab", "stone_slab", 3);
  b("sandstone_slab", "stone_slab", 1);
  b("brick_slab", "stone_slab", 4);
  b("nether_brick_slab", "stone_slab", 6);
  b("quartz_slab", "stone_slab", 7);
  b("smooth_stone_slab", "stone_slab", 0);
  b("red_sandstone_slab", "stone_slab2", 0);
  b("mossy_cobblestone_wall", "cobblestone_wall", 1);
  b("chiseled_sandstone", "sandstone", 1);
  b("cut_sandstone", "sandstone", 2);
  b("smooth_sandstone", "sandstone", 2);
  b("chiseled_red_sandstone", "red_sandstone", 1);
  b("cut_red_sandstone", "red_sandstone", 2);
  b("smooth_red_sandstone", "red_sandstone", 2);
  b("bricks", "brick_block");
  b("nether_bricks", "nether_brick");
  b("chiseled_quartz_block", "quartz_block", 1);
  b("quartz_pillar", "quartz_block", 2);
  b("quartz_bricks", "quartz_block", 0);
  b("smooth_quartz", "quartz_block", 0);
  b("prismarine_bricks", "prismarine", 1);
  b("dark_prismarine", "prismarine", 2);
  b("infested_stone", "monster_egg", 0);
  b("infested_cobblestone", "monster_egg", 1);
  b("infested_stone_bricks", "monster_egg", 2);

  // --- earth / plants ------------------------------------------------------
  b("grass_block", "grass");
  b("coarse_dirt", "dirt", 1);
  b("podzol", "dirt", 2);
  b("dirt_path", "grass");
  b("grass_path", "grass");
  b("short_grass", "tallgrass", 1);
  b("grass", "tallgrass", 1); // 1.20 "grass" the plant, not the block
  b("fern", "tallgrass", 2);
  b("large_fern", "double_plant", 3);
  b("tall_grass", "double_plant", 2);
  b("dead_bush", "deadbush");
  b("lily_pad", "waterlily");
  b("sugar_cane", "reeds");
  b("cobweb", "web");
  b("dandelion", "yellow_flower", 0);
  b("poppy", "red_flower", 0);
  b("blue_orchid", "red_flower", 1);
  b("allium", "red_flower", 2);
  b("azure_bluet", "red_flower", 3);
  b("red_tulip", "red_flower", 4);
  b("orange_tulip", "red_flower", 5);
  b("white_tulip", "red_flower", 6);
  b("pink_tulip", "red_flower", 7);
  b("oxeye_daisy", "red_flower", 8);
  b("sunflower", "double_plant", 0);
  b("lilac", "double_plant", 1);
  b("rose_bush", "double_plant", 4);
  b("peony", "double_plant", 5);
  b("brown_mushroom_block", "brown_mushroom_block", 14);
  b("red_mushroom_block", "red_mushroom_block", 14);
  b("mushroom_stem", "brown_mushroom_block", 10);
  b("melon", "melon_block");
  b("carved_pumpkin", "pumpkin");
  b("jack_o_lantern", "lit_pumpkin");
  b("terracotta", "hardened_clay");
  b("snow_block", "snow");
  b("snow", "snow_layer");
  b("wheat_crops", "wheat");
  b("potatoes", "potatoes");
  b("cave_air", "air");
  b("void_air", "air");
  b("moss_block", "grass");

  // --- redstone / mechanisms ----------------------------------------------
  b("redstone_wall_torch", "redstone_torch");
  b("wall_torch", "torch");
  b("repeater", "unpowered_repeater");
  b("comparator", "unpowered_comparator");
  b("note_block", "noteblock");
  b("jukebox", "jukebox");
  b("powered_rail", "golden_rail");
  b("spawner", "mob_spawner");
  b("smooth_stone_slab_double", "double_stone_slab", 0);
  b("iron_bars", "iron_bars");
  b("glass_pane", "glass_pane");
  b("end_stone_bricks", "end_stone");
  b("nether_quartz_ore", "quartz_ore");
  b("nether_wart_block", "nether_wart");
  b("soul_sand", "soul_sand");
  b("crafting_table", "crafting_table");
  b("enchanting_table", "enchanting_table");
  b("dragon_egg", "dragon_egg");
  b("beacon", "beacon");
  b("slime_block", "slime");
  b("light_gray_terracotta", "stained_hardened_clay", 8);
  b("silver_terracotta", "stained_hardened_clay", 8);
  b("silver_wool", "wool", 8);
  b("light_gray_wool", "wool", 8);
}

/** 1.13+/1.16+/1.17+/1.20 blocks that simply do not exist in a 1.8 world. */
function buildBlockUnavailable(): void {
  const nearest: Record<string, string> = {
    // Nether update
    ancient_debris: "obsidian", basalt: "stone", blackstone: "stone",
    polished_blackstone: "stone", polished_blackstone_bricks: "stonebrick",
    crimson_planks: "planks (meta 0-5)", warped_planks: "planks (meta 0-5)",
    crimson_stem: "log", warped_stem: "log", nether_gold_ore: "quartz_ore",
    shroomlight: "glowstone", soul_soil: "soul_sand", soul_torch: "torch",
    soul_lantern: "sea_lantern", lodestone: "iron_block", respawn_anchor: "obsidian",
    netherite_block: "iron_block", crying_obsidian: "obsidian", gilded_blackstone: "stone",
    chain: "iron_bars", target: "hay_block", warped_nylium: "netherrack",
    crimson_nylium: "netherrack",
    // Caves & Cliffs
    deepslate: "stone", cobbled_deepslate: "cobblestone", polished_deepslate: "stone",
    deepslate_bricks: "stonebrick", deepslate_tiles: "stonebrick", tuff: "stone",
    calcite: "quartz_block", dripstone_block: "stone", pointed_dripstone: "stone",
    amethyst_block: "lapis_block", budding_amethyst: "lapis_block",
    copper_block: "gold_block", copper_ore: "iron_ore", raw_copper_block: "iron_block",
    raw_iron_block: "iron_block", raw_gold_block: "gold_block",
    deepslate_coal_ore: "coal_ore", deepslate_iron_ore: "iron_ore",
    deepslate_gold_ore: "gold_ore", deepslate_diamond_ore: "diamond_ore",
    deepslate_emerald_ore: "emerald_ore", deepslate_lapis_ore: "lapis_ore",
    deepslate_redstone_ore: "redstone_ore", deepslate_copper_ore: "iron_ore",
    smooth_basalt: "stone", tinted_glass: "stained_glass (meta 15)",
    sculk: "obsidian", sculk_catalyst: "obsidian", sculk_shrieker: "obsidian",
    sculk_sensor: "obsidian", moss_carpet: "carpet (meta 13)", azalea: "leaves",
    flowering_azalea: "leaves", big_dripleaf: "waterlily", small_dripleaf: "tallgrass",
    hanging_roots: "vine", rooted_dirt: "dirt", glow_lichen: "vine",
    spore_blossom: "red_flower", cave_vines: "vine", lightning_rod: "iron_bars",
    candle: "torch", powder_snow: "snow",
    // 1.19-1.20
    mud: "dirt", mud_bricks: "brick_block", packed_mud: "dirt", mangrove_planks: "planks",
    mangrove_log: "log", bamboo_planks: "planks", bamboo_block: "log",
    cherry_planks: "planks", cherry_log: "log", cherry_leaves: "leaves",
    reinforced_deepslate: "obsidian", ochre_froglight: "glowstone",
    verdant_froglight: "glowstone", pearlescent_froglight: "glowstone",
    frogspawn: "waterlily", mangrove_roots: "log", muddy_mangrove_roots: "dirt",
    suspicious_sand: "sand", suspicious_gravel: "gravel", decorated_pot: "flower_pot",
    calibrated_sculk_sensor: "obsidian", pink_petals: "red_flower",
    piglin_head: "skull", chiseled_bookshelf: "bookshelf",
    // 1.9-1.14 misc
    end_rod: "torch", chorus_plant: "log", chorus_flower: "red_flower",
    purpur_block: "quartz_block", purpur_pillar: "quartz_block",
    purpur_stairs: "quartz_stairs", purpur_slab: "stone_slab (meta 7)",
    magma_block: "netherrack", bone_block: "quartz_block",
    observer: "dispenser", grindstone: "crafting_table", smoker: "furnace",
    blast_furnace: "furnace", cartography_table: "crafting_table",
    fletching_table: "crafting_table", smithing_table: "crafting_table",
    loom: "crafting_table", stonecutter: "crafting_table", barrel: "chest",
    lantern: "sea_lantern", campfire: "fire", scaffolding: "fence",
    bell: "gold_block", composter: "wooden_slab", beehive: "log",
    bee_nest: "log", honey_block: "slime", honeycomb_block: "hay_block",
    lectern: "bookshelf", jigsaw: "command_block", structure_block: "command_block",
    structure_void: "air", light: "air", conduit: "sea_lantern",
    dried_kelp_block: "hay_block", kelp: "vine", seagrass: "tallgrass",
    sea_pickle: "sea_lantern", turtle_egg: "dragon_egg", blue_ice: "packed_ice",
    coral_block: "prismarine", brain_coral_block: "prismarine",
    bubble_column: "water", nether_sprouts: "tallgrass",
    weeping_vines: "vine", twisting_vines: "vine",
  };
  for (const [name, hint] of Object.entries(nearest)) {
    if (!BLOCK_UNAVAILABLE.has(name)) {
      BLOCK_UNAVAILABLE.set(name, `not in the 1.8 registry; nearest match is ${hint}`);
    }
  }
}

buildBlockAliases();
buildStoneAliases();
buildBlockUnavailable();

function buildItemAliases(): void {
  // Dyes are one item with a meta nibble in 1.8 (order is NOT the wool order).
  const DYE_META: Record<string, number> = {
    ink_sac: 0, red_dye: 1, green_dye: 2, cocoa_beans: 3, lapis_lazuli: 4,
    purple_dye: 5, cyan_dye: 6, light_gray_dye: 7, gray_dye: 8, pink_dye: 9,
    lime_dye: 10, yellow_dye: 11, light_blue_dye: 12, magenta_dye: 13,
    orange_dye: 14, bone_meal: 15,
    // pre-1.13 spellings an agent might also use
    dye_black: 0, rose_red: 1, cactus_green: 2, dandelion_yellow: 11,
  };
  for (const [name, m] of Object.entries(DYE_META)) i(name, "dye", m);
  // 1.14+ dyes that have no 1.8 dye slot map onto the closest hue.
  i("white_dye", "dye", 15);
  i("brown_dye", "dye", 3);
  i("blue_dye", "dye", 4);
  i("black_dye", "dye", 0);

  // Renamed vanilla items.
  i("sugar_cane", "reeds");
  i("nether_bricks", "netherbrick");
  i("nether_brick", "netherbrick");
  i("gunpowder", "gunpowder");
  i("cooked_cod", "cooked_fish", 0);
  i("cooked_salmon", "cooked_fish", 1);
  i("cod", "fish", 0);
  i("salmon", "fish", 1);
  i("tropical_fish", "fish", 2);
  i("pufferfish", "fish", 3);
  i("raw_cod", "fish", 0);
  i("raw_salmon", "fish", 1);
  i("glistering_melon_slice", "speckled_melon");
  i("melon_slice", "melon");
  i("beetroot", "carrot");
  i("golden_beetroot", "golden_carrot");
  i("firework_rocket", "fireworks");
  i("firework_star", "firework_charge");
  i("clock", "clock");
  i("book_and_quill", "writable_book");
  i("enchanted_golden_apple", "golden_apple", 1);
  i("music_disc_13", "record_13");
  i("music_disc_cat", "record_cat");
  i("music_disc_blocks", "record_blocks");
  i("music_disc_chirp", "record_chirp");
  i("music_disc_far", "record_far");
  i("music_disc_mall", "record_mall");
  i("music_disc_mellohi", "record_mellohi");
  i("music_disc_stal", "record_stal");
  i("music_disc_strad", "record_strad");
  i("music_disc_ward", "record_ward");
  i("music_disc_11", "record_11");
  i("music_disc_wait", "record_wait");
  i("oak_boat", "boat");
  i("spruce_boat", "boat");
  i("birch_boat", "boat");
  i("jungle_boat", "boat");
  i("acacia_boat", "boat");
  i("dark_oak_boat", "boat");
  i("wooden_axe", "wooden_axe");
  i("golden_pickaxe", "golden_pickaxe");
  i("charcoal", "coal", 1);
  i("iron_nugget", "gold_nugget");
  i("popped_chorus_fruit", "gunpowder");
  i("dragon_breath", "glass_bottle");
  i("rabbit_stew", "rabbit_stew");
  i("suspicious_stew", "mushroom_stew");
  i("beetroot_soup", "mushroom_stew");
  i("bone_block_item", "bone");
  i("filled_map", "filled_map");
  i("lingering_potion", "potion");
  i("splash_potion", "potion");
  i("bucket_of_cod", "water_bucket");
  i("cod_bucket", "water_bucket");
  i("axolotl_bucket", "water_bucket");
  i("powder_snow_bucket", "bucket");
  i("milk_bucket", "milk_bucket");

  // Every block alias is also a valid item id target.
  for (const [from, [to, m]] of BLOCK_ALIAS) {
    if (!ITEM_ALIAS.has(from)) ITEM_ALIAS.set(from, [to, m]);
  }

  const itemsGone: Record<string, string> = {
    trident: "diamond_sword", crossbow: "bow", shield: "iron_chestplate",
    elytra: "leather_chestplate", totem_of_undying: "golden_apple",
    netherite_ingot: "diamond", netherite_scrap: "diamond",
    netherite_sword: "diamond_sword", netherite_pickaxe: "diamond_pickaxe",
    netherite_axe: "diamond_axe", netherite_shovel: "diamond_shovel",
    netherite_hoe: "diamond_hoe", netherite_helmet: "diamond_helmet",
    netherite_chestplate: "diamond_chestplate", netherite_leggings: "diamond_leggings",
    netherite_boots: "diamond_boots", copper_ingot: "gold_ingot",
    amethyst_shard: "lapis_lazuli", spyglass: "compass", bundle: "leather",
    goat_horn: "bone", recovery_compass: "compass", echo_shard: "prismarine_shard",
    brush: "feather", mace: "diamond_sword", wind_charge: "snowball",
    honey_bottle: "glass_bottle", honeycomb: "sugar", sweet_berries: "apple",
    glow_berries: "apple", glow_ink_sac: "dye (meta 0)", nautilus_shell: "prismarine_shard",
    heart_of_the_sea: "prismarine_shard", phantom_membrane: "leather",
    scute: "leather", turtle_helmet: "iron_helmet", flint_and_steel: "flint_and_steel",
    chorus_fruit: "apple", shulker_shell: "prismarine_shard",
    end_crystal: "glowstone_dust", dragon_head: "skull",
    knowledge_book: "book", debug_stick: "stick", trial_key: "iron_ingot",
    ominous_bottle: "glass_bottle", breeze_rod: "blaze_rod",
    smithing_template: "paper", disc_fragment_5: "paper",
  };
  for (const [name, hint] of Object.entries(itemsGone)) {
    ITEM_UNAVAILABLE.set(name, `not in the 1.8 registry; nearest match is ${hint}`);
  }
}

buildItemAliases();

/** Strips the namespace and lowercases. Returns [namespace, path]. */
function split(id: string): [string, string] {
  const t = id.trim().toLowerCase();
  const idx = t.indexOf(":");
  if (idx < 0) return ["minecraft", t];
  return [t.slice(0, idx), t.slice(idx + 1)];
}

function resolve(
  id: string,
  meta: number,
  known: ReadonlySet<string>,
  alias: Map<string, [string, number]>,
  unavailable: Map<string, string>,
  kind: "block" | "item",
): Translation {
  const [ns, path] = split(id);

  // Modded ids are passed through untouched — only the 1.8 vanilla registry is
  // renameable, and a mod's own namespace is whatever it registered.
  if (ns !== "minecraft") {
    return { id: `${ns}:${path}`, meta, passthrough: true, translated: false };
  }

  if (known.has(path)) {
    return { id: `minecraft:${path}`, meta, passthrough: true, translated: false };
  }

  const hit = alias.get(path);
  if (hit) {
    const [to, aliasMeta] = hit;
    // An explicitly supplied non-zero meta wins over the alias default, because
    // the caller may be encoding a variant we do not model (e.g. stair facing).
    const finalMeta = meta !== 0 ? meta : aliasMeta;
    return {
      id: `minecraft:${to}`,
      meta: finalMeta,
      passthrough: false,
      translated: true,
      note: `${kind} "minecraft:${path}" is a 1.13+ name; translated to 1.8 "minecraft:${to}" meta=${finalMeta}`,
    };
  }

  const gone = unavailable.get(path);
  return {
    id: `minecraft:${path}`,
    meta,
    passthrough: false,
    translated: false,
    unresolved: true,
    note: gone
      ? `minecraft:${path} ${gone}. The engine will log unknown_block and SKIP this op silently.`
      : `minecraft:${path} is not in the 1.8.8 ${kind} registry and has no known alias. The engine will log unknown_${kind} and SKIP this op silently — pick a 1.8 name (call omni_block_search).`,
  };
}

export function translateBlock(id: string, meta = 0): Translation {
  return resolve(id, meta, BLOCKS_18, BLOCK_ALIAS, BLOCK_UNAVAILABLE, "block");
}

export function translateItem(id: string, meta = 0): Translation {
  return resolve(id, meta, ITEMS_18, ITEM_ALIAS, ITEM_UNAVAILABLE, "item");
}

/** Fuzzy search across the real 1.8 registry + the alias table. */
export function searchNames(
  query: string,
  kind: "block" | "item",
  limit = 40,
): { exact18: string[]; aliasFrom120: { from: string; to: string; meta: number }[]; unavailable: { name: string; reason: string }[] } {
  const q = split(query)[1];
  const known = kind === "block" ? BLOCKS_18 : ITEMS_18;
  const alias = kind === "block" ? BLOCK_ALIAS : ITEM_ALIAS;
  const gone = kind === "block" ? BLOCK_UNAVAILABLE : ITEM_UNAVAILABLE;

  const exact18 = [...known].filter((n) => n.includes(q)).sort().slice(0, limit);
  const aliasFrom120 = [...alias.entries()]
    .filter(([from, [to]]) => from.includes(q) || to.includes(q))
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(0, limit)
    .map(([from, [to, meta]]) => ({ from, to, meta }));
  const unavailable = [...gone.entries()]
    .filter(([n]) => n.includes(q))
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(0, limit)
    .map(([name, reason]) => ({ name, reason }));

  return { exact18, aliasFrom120, unavailable };
}

/** Colour index for wool/glass/clay/carpet, or null. */
export function colorMeta(name: string): number | null {
  const idx = COLORS.indexOf(name.toLowerCase() as (typeof COLORS)[number]);
  return idx < 0 ? null : idx;
}

export const COLOR_NAMES: readonly string[] = COLORS;
export const WOOD_NAMES: readonly string[] = WOODS;
