# 12 — OMNI3D: 3D world models (any shape, any size)

Map: `__OMNIMOD_MAP__` · Entity: `omni3d:world_model` · Command: `/omni3d` · HTTP: `/omni/model3d/*`

This engine holds REAL 3D models inside the world — Wavefront OBJ meshes with MTL
materials, any shape and any size, from a single prop to a 300-block terrain — with
walkable collision on the true surfaces, per-group animation, and fully custom player
interactions. This file is the professional contract for using them.

## 1. THE DOCTRINE — 3D-first, but the user's request is the specification

For large or complex structures (terrain, hills, custom buildings, statues, vehicles,
organic shapes) 3D models are ALWAYS the strongest tool on this engine: they render
through baked display lists (a 200KB model is cheaper than thousands of block ops),
they never distort (the mesh is exact), and one model can replace a 50,000-block
build. When a map calls for realism at scale, models are the right default.

BUT precision beats power. These rules are non-negotiable:

1. **The user's request is the specification** (00_AGENT_MANDATE §1). If the user
   asks for a map of normal Minecraft blocks — "a small beautiful grassy map with
   normal blocks" — you build it from normal blocks. Adding 3D models they did not
   ask for is a defect, exactly like adding unrequested decorations.
2. **Default when unspecified: match the map's existing language.** Read
   MAP_OVERVIEW.md, run a world scan, and run `/omni3d list`. An all-block map stays
   blocks; a map that already uses models continues in models.
3. **Ask when it materially changes the result.** "Make a house" on a block map
   means blocks. "Make a realistic mountain" means models. When the request implies
   realism, organic shapes or very large scale, models are the right call — record
   which you chose and why in CHANGE_LOG.md.
4. **Hybrid builds are first-class.** The classic request — a 3D terrain surface
   with normal Minecraft blocks ON TOP — has an exact workflow in §7. Do both
   precisely; never let one distort the other.

Decision table:

| The user says... | You build with... |
|---|---|
| "normal blocks", "vanilla style", "classic Minecraft look" | blocks only — no models |
| "blocky", "like regular Minecraft" | blocks only |
| "3D map", "realistic", "custom models", "modern graphics" | 3D models |
| "like [that other map]" | whatever that map uses — scan it or ask |
| "blocks/grass on top of the 3D surface" | hybrid — §7, exactly |
| names a real object (car, plane, statue, mountain) | usually models — confirm if the map is all blocks |
| small decoration on an all-block map (table, lamp) | blocks first; models only for shapes blocks cannot make |

## 2. Where models come from (four sources)

| Source | How | Model id |
|---|---|---|
| **The CC0 model library** (start here) | `omni_3d_search` -> `omni_3d_inspect` -> `omni_3d_fetch` -> `omni_3d_upload` | `omni3d:<name>` |
| Uploaded by you | POST /omni/model3d/upload `{world?, name, obj\|objB64, mtl?\|mtlB64?, profile?}` | `omni3d:<name>` |
| From a staged 1.20.1 mod | the mod ships `assets/<ns>/models3d/*.obj` + `*.obj.model3d.json` | `<ns>:<name>` |
| Already in this map | models3d store of the world (persists with the save) | as uploaded |

Check what already exists before uploading: `GET /omni/model3d/list` or `/omni3d models`.

Rules of the pipeline: OBJ text ≤ 8MB per upload; safe base names only (letters,
digits, `-`, `_`). **OBJ units are blocks** — a 40-unit-wide mesh is 40 blocks wide
at scale 1.0. Export Y-up; the loader applies the axis fix (profile `axisFix`,
default `flip_xz`). Materials: `Kd` colors render directly (Modular Village style);
`map_Kd` binds a PNG texture from the store or a resource pack (missing texture
falls back to the material color — never a crash).

## 2b. The CC0 model library — find, VERIFY, fetch, use

A public library of **5,952 CC0 (public-domain) models** already exists, with every
model measured by THIS engine's own OBJ parser. Before you hand-author a mesh or
upload something you have never seen, look there. Licence: CC0 1.0 — commercial use
allowed, no attribution required, no share-alike. Creatures, buildings, furniture,
props, vehicles, nature, characters.

**The loop (four MCP tools, then place):**

1. `omni_3d_search { query?, category?, tag?, maxTri?, maxSize?, anim?, textured? }`
   — returns compact rows. `listTags:true` prints the tag vocabulary.
2. `omni_3d_inspect { id, need? }` — the full measured record: triangles, exact bounds,
   size in blocks, every material with its colour and texture, the named parts that can
   be animated, the SHA-256, and an honest fit assessment. Pass `need` in your own words
   ('a door I can open', 'a small lamp') and it flags a mismatch.
3. `omni_3d_fetch { id }` — downloads ONLY that model (OBJ + MTL + its textures) and
   **verifies its SHA-256 against the measured catalogue**. A mismatch is reported as a
   mismatch, not hidden.
4. `omni_3d_upload { id | dir, collision?, scale? }` — pushes it into the running world
(handles the context-first gate itself). Then `/omni3d place <model> <x> <y> <z>` or
   `omni_3d_place`.

**Why the numbers can be trusted:** the catalogue records what the engine's parser
produced, not what a third-party tool claims. Triangle counts are post-parse, sizes are
in blocks, and the named parts (`gr`) are the real `o`/`g` groups — so `anim:"per-part"`
means per-part keyframe animation will actually work.

**Choosing correctly — read the fields, not the name:**

| You need | Filter on |
|---|---|
| a door/wheel/limb that moves | `anim` = `two-part` or `per-part` (never `whole-model`) |
| something cheap on a weak device | `maxTri` (engine budget is 30000 per model) |
| a model that fits a gap you measured | `maxSize` in blocks, then confirm `size`/`bb` |
| a textured look | `textured: true` (otherwise it is a flat `Kd` colour) |
| a large structure | `category: "buildings"`, sort by `size` — do not scale a prop up |

If nothing fits, then author the OBJ yourself (or convert one with Blender/assimp) and
upload it — but say in CHANGE_LOG.md that you did, and why the library was not enough.

Offline / no network: point `OMNIMOD_ASSET_LIBRARY_PATH` at a local clone of the
library, or upload a file you already have with POST /omni/model3d/upload.

## 3. Placing, sizing and moving — correctly, at the size you want

The anchor `(x, y, z)` is the model's BASE CENTER in world coordinates: `y` is where
the floor of the model sits. Place it ON the ground, not at eye level.

- **Place**: `/omni3d place <model> <x> <y> <z> [rotY] [scale]` — works from chat,
  command blocks and the agent bridge alike (permission 2, same path as setblock).
  HTTP: POST /omni/model3d/place `{model, pos:[x,y,z], rotY?, scale?, interaction?, attack?}`.
- **Scale**: 1.0 = OBJ units are blocks. Scale multiplies the mesh AND its collision
  together. The final size = mesh bounds x scale — always confirm with
  `/omni3d info nearest` (it prints the real dimensions) before judging the look.
- **Rotate**: `rotY` degrees clockwise. Collision follows automatically (conservative
  rotated boxes — a wall never becomes passable).
- **Adjust later**: `/omni3d move|scale|rotate <target> ...` — collision re-registers
  itself. Target is `nearest` or `id=<entityId>` from `/omni3d list`.
- **Persistence**: placements save with the world automatically (chunk entities).
  After a reload the first tick re-registers collision — verify with `/omni3d list`.

## 4. The model profile — full structure customization, per model

Each model carries a JSON profile: inline at upload (`profile` field), inline at
place, or shipped beside the OBJ as `<name>.obj.model3d.json` in the mod. Every
field is optional:

```
{
  "displayName": "Village Gate",
  "scale": 1.0,               // 1.0 = OBJ units are blocks
  "offsetX": 0, "offsetY": 0, "offsetZ": 0,   // base offset in blocks
  "renderDistance": 0,        // 0 = auto (model size + 64); set explicit for big terrain
  "shadowSize": 0,            // 0 = no shadow blob
  "disableCull": false,       // true for glass/foliage (renders back faces)
  "collision": "auto",        // auto | full | boxes | none
  "collisionResolution": 1.0, // blocks per voxel; 0.25..2.0
  "collisionBoxes": [[0,0,0, 16,10,16]],   // model units, for collision:"boxes"
  "animations": { ... clips ... },
  "interact": [ ... actions on right-click ... ],
  "attack":   [ ... actions on left-click ... ]
}
```

Collision modes: **auto** (default — voxelize the mesh and greedy-merge the cells;
players and mobs walk on the REAL surfaces: stairs, slopes, roofs), **full** (one
solid box — cheapest, for solid masses), **boxes** (your explicit box list in model
units), **none** (decoration only — everything passes through).

## 5. Animation — keyframe clips per OBJ group (o/g)

Clips move GROUPS — the `o`/`g` names inside the OBJ. Example (a swinging door):

```
"animations": {
  "open": {"duration": 1.2, "loop": false, "keys": [
    {"t": 0.0, "group": "door_leaf", "rotY": 0},
    {"t": 1.2, "group": "door_leaf", "rotY": 110}
  ]},
  "spin": {"duration": 4.0, "loop": true, "keys": [
    {"t": 0, "group": "wheel", "rotZ": 0},
    {"t": 4, "group": "wheel", "rotZ": 360}
  ]}
}
```

`group` `"*"` targets the whole model. Each key takes `rot`/`pos`/`scale` as
`[x,y,z]` arrays or `rotX`/`rotY`/`rotZ`/`posX`... components. Rotation pivots on
the group's own bounds automatically.

Play: `/omni3d animate <target> <clip> [once|loop|toggle|reverse|stop]` or
POST /omni/model3d/animate. The server broadcasts ONE state; every client runs the
timeline locally — zero per-frame network traffic.

## 6. Interactions — what a player's click does

Right-click runs the `interact` list; left-click (attack) runs the `attack` list.
Both are JSON arrays of actions (bare string = a single command action):

```
[{"type": "animation", "clip": "open", "mode": "toggle"},
 {"type": "sound", "id": "minecraft:random.door_open", "volume": 1, "pitch": 1},
 {"type": "command", "value": "/say The gate is open"},
 {"type": "message", "text": "Welcome!", "broadcast": false},
 {"type": "event", "name": "gate_opened"},
 {"type": "remove"}]
```

- `command` runs through the SAME full-privilege path as a command block — anything
  a command block can do works here (teleport, fill, give, functions, /omni3d itself).
- `event` posts `Omni3DInteractEvent` on the ModernEventBus for listening mods.
- `cooldownMs` per action (default 300) prevents double-fires.
- Set them: `/omni3d interaction <target> interact <json|clear>` (or `attack`), or
  the `interaction`/`attack` fields of /omni/model3d/place and /configure.

Item placement: `/omni3d binditem <itemId> <model> [scale] [offsetY] [consume]` —
using that item on the ground spawns the model there (yaw snapped to 45°).

## 7. Hybrid workflow — blocks ON TOP of a 3D surface (the classic request)

User: "a small beautiful grassy map with normal Minecraft blocks above the 3D map
surface". This is TWO builds, precisely joined:

1. Stage the terrain model — upload or reuse; profile `collision: "auto"`,
   `collisionResolution: 1.0` (0.5 only for fine detail the player must walk on).
2. `/omni3d place <terrain> <cx> <groundY> <cz> 0 1.0` — anchor at the intended
   center; the model's floor sits at `groundY`.
3. Verify walkability FIRST: teleport on top, watch the player stand (posY stable
   for 2 seconds — no sinking, no jitter). Fix collision before ANY block work.
4. Read the real surface heights where blocks will go: `/omni/world/raycast`
   straight down at each spot, or `/omni/world/scan` the region once.
5. Place blocks at surface + 1.0, integer-aligned. Keep block clusters at least
   0.5 blocks inside the surface edge — no half-floating blocks over air.
6. No z-fighting: never put a block face flush against a model face — keep ≥ 0.05
   clearance or lift the block slightly.
7. Run the full battery (§9 + 04_TESTING_MANDATE). Record the measured surface
   heights in CHANGE_LOG.md so the next agent never re-measures.

## 8. Performance contract — weak devices are the target, not the exception

Engine guarantees (automatic, you cannot break them):

- Zero cost when no models exist anywhere — early-out guards on the render and
  collision paths.
- Bake once: each (model x group x material) becomes ONE display list; a frame is
  transforms + callList per group.
- Collision boxes compute ONCE per placement (voxelized, greedy-merged) and live in
  a spatial hash — movement only tests boxes in the entity's own chunk cells.
- Safety caps: voxel grid auto-coarsens past 4M cells; > 4096 merged boxes falls
  back to one full box; tracking range grows with model size but never past the
  server view distance.

YOUR budget (not enforced by the engine — this is your craft):

| Rule | Value | Why |
|---|---|---|
| Triangles per model | ≤ 30,000 (aim 5–15k) | smooth on low-end phones |
| Total triangles in view | ≤ 150,000 | headroom for chunks + entities |
| Simultaneously ANIMATING models | tens, not hundreds | matrix work per animated group |
| Materials for large terrain | prefer `Kd` vertex colors | one shared white texture, no VRAM churn |
| Texture size per material | ≤ 512x512 | instant uploads |
| collisionResolution | 1.0 default; 2.0 for models > 150 blocks; 0.5 only for walkable fine detail | keeps box count low |
| Big terrain visibility | set explicit `renderDistance` (e.g. 256) | no pop-out at range |

Evidence after heavy 3D work: `/omni/logs?q=omni3d` shows no new WARN/ERROR, and a
sustained walk across the model shows no stutter entries in the log ring.

## 9. Verification battery for 3D work (on top of 04_TESTING_MANDATE)

0. Provenance — if the model came from the CC0 library, `omni_3d_fetch` reported
   `verified: true`. If it reported a SHA-256 MISMATCH, do not quote the catalogue's
   triangle count or size for that copy: re-fetch, or measure the file you actually have.
1. `/omni3d list` — placed, at the intended pos/scale, with your creator tag.
2. `/omni3d info nearest` — real dimensions match the specification. If you picked the
   model by `size` from the library, this is where you confirm it was not a lie.
3. Walk test — teleport on top; the player must STAND. Sinking or jittering = FAIL.
4. Interaction test (if wired) — the click visibly does the action; the log ring
   records the omni3d action (command/animation/sound).
5. Reload test — restart the world; model AND collision persist.
6. Performance evidence — `/omni/logs?q=omni3d` clean.
7. Report into `state/verification/` and CHANGE_LOG.md as always.

## 10. Common failures — symptom → cause → fix

| Symptom | Cause | Fix |
|---|---|---|
| "model not registered" | typo'd id, or a mod model before the mod is staged | `/omni3d models` for real ids; stage the mod; reload the world |
| model underground / floating | anchor y is the BASE; OBJ origin not at its base | adjust y or profile `offsetY` |
| right size, wrong look | OBJ units are blocks; scale multiplies mesh AND collision | verify with `/omni3d info nearest` |
| player walks THROUGH it | `collision: "none"`, or placed before the store loaded | `/omni3d info nearest`; `/omni3d collision nearest auto` |
| invisible but collides | bake failed or OBJ has no faces | `/omni/logs?q=omni3d`; fix the OBJ export |
| model vanishes at distance | tracking range smaller than the model | set explicit `renderDistance` in the profile |
| flickering faces vs blocks | z-fighting — coplanar faces | keep ≥ 0.05 separation |
| door spins the wrong way | rotX/rotY/rotZ mixed up | rotY spins flat like a door; test with `once` |
| upload `too_large` | OBJ > 8MB | decimate the mesh in the 3D tool first |
| library `verified: false` | the file you have differs from the measured one | re-fetch; if it persists, the catalogue is stale — `omni_3d_library { refresh: true }` |
| library search returns nothing | too many filters at once (tags are AND) | drop a tag, or widen `maxTri`/`maxSize` |


<!-- omnimod-docs-version: omnimod-agent-docs-9 -->
