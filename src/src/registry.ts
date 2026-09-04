/**
 * OmniMod 1.8.8 registry knowledge + 1.20 -> 1.8 translation.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * OmniMod runs on an EaglercraftX 1.8.8 engine. Block placement resolves ids
 * through the 1.8 registry:
 *
 *   MapBuilderRuntime.resolveBlockState()  (MapBuilderRuntime.java:311-328)
 *     domain = "minecraft" when no ':' is present
 *     Block.blockRegistry.getObject(loc)  -> null when unknown
 *     block.getStateFromMeta(meta)        -> falls back to getDefaultState()
 *
 * When the id is unknown the op does NOT throw. `placeBlock` logs an
 * `unknown_block` line and returns false (MapBuilderRuntime.java:148-152);
 * `fill_area` / `replace_area` count a failedOp and CONTINUE
 * (MapDevSyncRuntime.java:454-457, 472-476). The batch is still recorded as
 * applied. So a 1.20 block name does not error — it silently builds nothing.
 * That is the single largest failure mode for an agent building maps here, and
 * NO alias table exists anywhere in the engine for the placement path.
 *
 * There is also no blockstate-string support: `minecraft:oak_stairs[facing=east]`
 * is not parsed anywhere. Variants are the 1.8 metadata nibble (0-15) passed
 * through `getStateFromMeta`.
 *
 * The BLOCKS_18 / ITEMS_18 sets below are extracted from the engine's own
 * registration calls (`getRegisteredBlock("...")` in
 * sources/minecraft-client/java/net/minecraft/init/Blocks.java and
 * `getRegisteredItem("...")` in .../init/Items.java), so they are ground truth
 * for this engine rather than a guess about what 1.8 contained.
 */

/** Every block name registered by the 1.8.8 engine (198 entries). */
export const BLOCKS_18: ReadonlySet<string> = new Set([
  "acacia_door", "acacia_fence", "acacia_fence_gate", "acacia_stairs", "activator_rail", "air",
  "anvil", "barrier", "beacon", "bed", "bedrock", "birch_door", "birch_fence", "birch_fence_gate",
  "birch_stairs", "bookshelf", "brewing_stand", "brick_block", "brick_stairs", "brown_mushroom",
  "brown_mushroom_block", "cactus", "cake", "carpet", "carrots", "cauldron", "chest", "clay",
  "coal_block", "coal_ore", "cobblestone", "cobblestone_wall", "cocoa", "command_block",
  "crafting_table", "dark_oak_door", "dark_oak_fence", "dark_oak_fence_gate", "dark_oak_stairs",
  "daylight_detector", "daylight_detector_inverted", "deadbush", "detector_rail", "diamond_block",
  "diamond_ore", "dirt", "dispenser", "double_plant", "double_stone_slab", "double_stone_slab2",
  "double_wooden_slab", "dragon_egg", "dropper", "emerald_block", "emerald_ore", "enchanting_table",
  "end_portal", "end_portal_frame", "end_stone", "ender_chest", "farmland", "fence", "fence_gate",
  "fire", "flower_pot", "flowing_lava", "flowing_water", "furnace", "glass", "glass_pane",
  "glowstone", "gold_block", "gold_ore", "golden_rail", "grass", "gravel", "hardened_clay",
  "hay_block", "heavy_weighted_pressure_plate", "hopper", "ice", "iron_bars", "iron_block",
  "iron_door", "iron_ore", "iron_trapdoor", "jukebox", "jungle_door", "jungle_fence",
  "jungle_fence_gate", "jungle_stairs", "ladder", "lapis_block", "lapis_ore", "lava", "leaves",
  "leaves2", "lever", "light_weighted_pressure_plate", "lit_furnace", "lit_pumpkin",
  "lit_redstone_lamp", "lit_redstone_ore", "log", "log2", "melon_block", "melon_stem",
  "mob_spawner", "monster_egg", "mossy_cobblestone", "mycelium", "nether_brick",
  "nether_brick_fence", "nether_brick_stairs", "nether_wart", "netherrack", "noteblock",
  "oak_stairs", "obsidian", "packed_ice", "piston", "piston_extension", "piston_head", "planks",
  "portal", "potatoes", "powered_comparator", "powered_repeater", "prismarine", "pumpkin",
  "pumpkin_stem", "quartz_block", "quartz_ore", "quartz_stairs", "rail", "red_flower",
  "red_mushroom", "red_mushroom_block", "red_sandstone", "red_sandstone_stairs", "redstone_block",
  "redstone_lamp", "redstone_ore", "redstone_torch", "redstone_wire", "reeds", "sand", "sandstone",
  "sandstone_stairs", "sapling", "sea_lantern", "skull", "slime", "snow", "snow_layer",
  "soul_sand", "sponge", "spruce_door", "spruce_fence", "spruce_fence_gate", "spruce_stairs",
  "stained_glass", "stained_glass_pane", "stained_hardened_clay", "standing_banner",
  "standing_sign", "sticky_piston", "stone", "stone_brick_stairs", "stone_button",
  "stone_pressure_plate", "stone_slab", "stone_slab2", "stone_stairs", "stonebrick", "tallgrass",
  "tnt", "torch", "trapdoor", "trapped_chest", "tripwire", "tripwire_hook", "unlit_redstone_torch",
  "unpowered_comparator", "unpowered_repeater", "vine", "wall_banner", "wall_sign", "water",
  "waterlily", "web", "wheat", "wooden_button", "wooden_door", "wooden_pressure_plate",
  "wooden_slab", "wool", "yellow_flower",
]);

/** Every item name registered by the 1.8.8 engine (187 entries). */
export const ITEMS_18: ReadonlySet<string> = new Set([
  "acacia_door", "apple", "armor_stand", "arrow", "baked_potato", "banner", "bed", "beef",
  "birch_door", "blaze_powder", "blaze_rod", "boat", "bone", "book", "bow", "bowl", "bread",
  "brewing_stand", "brick", "bucket", "cake", "carrot", "carrot_on_a_stick", "cauldron",
  "chainmail_boots", "chainmail_chestplate", "chainmail_helmet", "chainmail_leggings",
  "chest_minecart", "chicken", "clay_ball", "clock", "coal", "command_block_minecart",
  "comparator", "compass", "cooked_beef", "cooked_chicken", "cooked_fish", "cooked_mutton",
  "cooked_porkchop", "cooked_rabbit", "cookie", "dark_oak_door", "diamond", "diamond_axe",
  "diamond_boots", "diamond_chestplate", "diamond_helmet", "diamond_hoe", "diamond_horse_armor",
  "diamond_leggings", "diamond_pickaxe", "diamond_shovel", "diamond_sword", "dye", "egg",
  "emerald", "enchanted_book", "ender_eye", "ender_pearl", "experience_bottle", "feather",
  "fermented_spider_eye", "filled_map", "fire_charge", "firework_charge", "fireworks", "fish",
  "fishing_rod", "flint", "flint_and_steel", "flower_pot", "furnace_minecart", "ghast_tear",
  "glass_bottle", "glowstone_dust", "gold_ingot", "gold_nugget", "golden_apple", "golden_axe",
  "golden_boots", "golden_carrot", "golden_chestplate", "golden_helmet", "golden_hoe",
  "golden_horse_armor", "golden_leggings", "golden_pickaxe", "golden_shovel", "golden_sword",
  "gunpowder", "hopper_minecart", "iron_axe", "iron_boots", "iron_chestplate", "iron_door",
  "iron_helmet", "iron_hoe", "iron_horse_armor", "iron_ingot", "iron_leggings", "iron_pickaxe",
  "iron_shovel", "iron_sword", "item_frame", "jungle_door", "lava_bucket", "lead", "leather",
  "leather_boots", "leather_chestplate", "leather_helmet", "leather_leggings", "magma_cream",
  "map", "melon", "melon_seeds", "milk_bucket", "minecart", "mushroom_stew", "mutton", "name_tag",
  "nether_star", "nether_wart", "netherbrick", "painting", "paper", "poisonous_potato",
  "porkchop", "potato", "potion", "prismarine_crystals", "prismarine_shard", "pumpkin_pie",
  "pumpkin_seeds", "quartz", "rabbit", "rabbit_foot", "rabbit_hide", "rabbit_stew", "record_11",
  "record_13", "record_blocks", "record_cat", "record_chirp", "record_far", "record_mall",
  "record_mellohi", "record_stal", "record_strad", "record_wait", "record_ward", "redstone",
  "reeds", "repeater", "rotten_flesh", "saddle", "shears", "sign", "skull", "slime_ball",
  "snowball", "spawn_egg", "speckled_melon", "spider_eye", "spruce_door", "stick", "stone_axe",
  "stone_hoe", "stone_pickaxe", "stone_shovel", "stone_sword", "string", "sugar", "tnt_minecart",
  "water_bucket", "wheat", "wheat_seeds", "wooden_axe", "wooden_door", "wooden_hoe",
  "wooden_pickaxe", "wooden_shovel", "wooden_sword", "writable_book", "written_book",
]);
