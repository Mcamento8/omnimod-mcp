# 14 — AUTHORING a 3D model yourself (the professional standard)

Map: `__OMNIMOD_MAP__` · Tools: `omni_3d_template` · `omni_3d_validate` · `omni_3d_upload`

You will sometimes need a model that does not exist yet. This file is how to build one
that is correct, correctly coloured, and does not embarrass the map. Everything here is
either a rule the ENGINE enforces (and will punish you for breaking) or a rule that
separates a model that looks authored from one that looks generated.

## 1. THE DECISION ORDER — read this before you open a text editor

| The model you need | Do this | Why |
|---|---|---|
| A simple or parametric shape — a box, slab, ramp, pillar, sign, plain crate, simple house | **Author it directly** (`omni_3d_template` -> shape -> `omni_3d_validate`) | You can make it EXACT: the size the user asked for, the proportions the map needs. A library model is an approximation of your requirement. |
| A large, organic or detailed thing — terrain, a creature, a vehicle, a statue, an ornate building | **Search the CC0 library first** (`omni_3d_search`) | Those are measured, verified, licence-clean, and somebody spent real time on the silhouette. Hand-authoring them is slow and usually worse. |
| The library has nothing that fits PROFESSIONALLY | **Author it yourself, to this standard** | Never force a library model that is merely close. A wrong model is worse than a plain one. |

Two rules that override the table:

- **Never ship a model you have not validated.** `omni_3d_validate` after every edit. A model
  with an unresolved `error` is not finished, no matter how good it looks in your head.
- **Never claim a model works without seeing it in game.** Upload it, place it, look at it.
  A command that returned without an error is not evidence that the model renders.

## 2. THE NON-NEGOTIABLE STRUCTURE (the engine will punish these)

| Rule | Why it is not optional |
|---|---|
| **1 OBJ unit = 1 block** | The engine does not rescale. A 40-unit mesh is 40 blocks wide. |
| **The base sits exactly on y = 0** | Placement anchors a model by its BASE CENTRE. A model whose lowest vertex is at y = -2 floats or sinks. |
| **Every face wound outward** (counter-clockwise seen from outside) | Inward faces are invisible from outside and light wrongly. Mixed winding makes a model look patchy. |
| **No concave polygons** | The engine fan-triangulates every face from its FIRST vertex. A fan is only correct for a CONVEX polygon — a concave one is torn into triangles that spill outside the outline, which shows in game as holes and spikes. Triangulate concave faces yourself. |
| **No two faces in the same place** | Coincident coplanar faces z-fight and flicker. This is the classic two-part-model bug: if a lid sits on a body, do NOT keep both touching faces — leave the interface open. |
| **Y is up** | Export Y-up. The loader applies `axisFix` (default `flip_xz`) for the Z convention. |
| **≤ 30 000 triangles** | The per-model budget. A prop should be far below it. |
| **Textures need UVs** | A `map_Kd` with no `vt` lines is undefined sampling. Either add UVs or colour with `Kd`. |

`omni_3d_template` emits a shell that already satisfies all of this — outward winding, base on
y = 0, correct units, and `o` groups where a part may need to move. Start there; shaping it
correctly is your job, but the structure will not be the reason it looks broken.

## 3. SHAPE — how to make it look authored, not generated

The engine's art language is Minecraft's. These are the rules that decide whether a model
reads as deliberate:

1. **The model defines the silhouette; the texture defines the detail.** Keep the element
   count as low as it can be while the object stays recognisable, and put the interest in
   the colour, not in more geometry.
2. **A round thing is ONE element, not a stack of small boxes.** A barrel, a log, a wheel,
   a melon — model it as a single rounded shape. Building a curve out of many steps is the
   single most common way a hand-authored model looks amateur.
3. **Avoid stairs as slants.** If a surface slopes, make it slope (a rotated or angled face),
   do not staircase it.
4. **No mixels.** In this art style one texture pixel is 1/16 of a block. A feature thinner
   than 1/16 block, or a texture drawn at a different scale than the rest, reads as a
   mistake. Pick a scale and hold it.
5. **Planes plus transparency beat many small elements.** For railings, foliage, chains and
   gaps, one larger face with transparent pixels is better than twenty tiny boxes.
6. **Proportions carry meaning.** A large head on a small body reads as cute; a heavy torso
   reads as strong. Decide what the object should feel like before you pick numbers.
7. **Recognisability beats exact scale.** A prop that is slightly too large still reads; a
   prop scaled to true size but unreadable does not.

## 4. COLOUR — the part that decides whether it looks professional

Two ways to colour a model. Choose deliberately:

| Method | When | How |
|---|---|---|
| **Material colours (`Kd`)** | Small models, flat/blocky shapes, anything that should match the map's palette | One `newmtl` per colour. No UVs needed. Exact and cheap. |
| **Texture (`map_Kd` + `vt`)** | Anything with surface detail: wood grain, stone, cloth, signage | A PNG plus a UV layout. More work, far more character. |

Rules that make colour look intentional:

1. **Start from a midtone, then add ONE shadow and ONE highlight.** A palette built this way
   reads clean. Adding shades at random reads noisy.
2. **Shift the hue, not just the brightness.** A straight ramp (same hue, different
   brightness) looks dull. Moving the hue slightly as it darkens is what makes a ramp look
   painted rather than computed.
3. **Keep the palette small.** A handful of colours reads as deliberate; dozens read as
   noise. `omni_3d_validate` warns past 24.
4. **Decide where the light is and be consistent.** Top faces brighter than side faces,
   sides brighter than the bottom. Light from above is the convention here, and a model
   that disagrees with the map around it looks pasted on.
5. **Never leave a material pure white with no texture.** It reads as "unfinished".
   `omni_3d_validate` flags it.
6. **Match the map, then improve it slightly.** Read MAP_OVERVIEW.md and look at what is
   already built. A model that is beautiful but alien to its surroundings is a defect.

## 5. THE WORKFLOW — five steps, every time

```
1. omni_3d_template { kind:"box", width:3, height:2, depth:3, material:"wood" }
2. shape it      — move/add vertices, add faces, split moving parts with `o <name>`
3. omni_3d_validate { path:"model.obj", intent:"a 3x2x3 crate", expectedSizeBlocks:3 }
4. fix EVERY error, re-validate until the verdict is READY (or the warnings are understood)
5. omni_3d_upload { dir:"<folder>" }  then  omni_3d_place  then LOOK AT IT
```

Step 3 is not optional and step 5 is not optional. Skipping 3 means shipping defects you
cannot see; skipping 5 means claiming a result you never observed.

## 6. DEFECT TABLE — symptom in game -> cause -> fix

| You see | Cause | Fix |
|---|---|---|
| Holes, spikes, faces poking through a wall | A CONCAVE face was fan-triangulated | Triangulate concave faces yourself (ear clipping / Blender's Triangulate modifier) |
| The model flickers or shimmers | Two coincident coplanar faces | Remove the duplicate, or leave the interface of a two-part model open |
| It looks flat and wrongly lit | No `vn`, so every vertex got (0, 1, 0) | Export normals |
| Patchy, uneven lighting | Inconsistent winding — faces disagree about which side is out | Recompute outward normals (Blender: select all, Shift+N) |
| It floats above the ground, or sinks into it | The base is not at y = 0 | Shift the mesh so minY = 0, or set `profile.offsetY` |
| It is invisible | Zero-area triangles, or all faces wound inward, or a plane model without `disableCull` | Validate; enable `disableCull` for plane-only models |
| It renders in one flat colour | No MTL, or `usemtl` names that are not defined | Add `newmtl` + `Kd` |
| Part of it samples the middle of the texture | Some faces have `vt`, others do not — the engine fills (0.5, 0.5) | Give every face a `vt` |
| It is 40 blocks wide | OBJ units are blocks; the mesh was exported in metres or centimetres | Rescale, or set `profile.scale` (it scales mesh AND collision) |
| Only the whole model moves, not the door | No `o`/`g` group around the moving part | Wrap it in `o <name>` |
| It stutters on a weak device | Too many triangles, or a huge texture | Decimate; keep textures ≤ 512x512 per material |

## 7. PERFORMANCE — the budget is real, the device is weak

| Item | Budget |
|---|---|
| Triangles per model | ≤ 30 000 (a prop should be under 2 000) |
| Triangles in a scene | ≤ 150 000 total |
| Texture per material | ≤ 512x512 |
| Named groups | as few as the animation needs — each is a separate draw |
| `collisionResolution` | 1.0 default; 2.0 for models over 150 blocks; 0.5 only for fine walkable detail |

Geometry is cheap and textures are not: one 512x512 atlas beats twelve 128x128 files.

## 8. VERIFICATION BATTERY for a hand-authored model

1. `omni_3d_validate` — verdict READY, or every remaining warning understood and accepted.
2. Upload + place it. Then look at it from FOUR sides and from above. A model that only
   works from the angle you designed it at is half a model.
3. Walk on it (if it is walkable): the player must STAND, not sink or jitter.
4. Check the colour against its neighbours in the map. Does it belong?
5. `/omni/logs?q=omni3d` — no new WARN/ERROR.
6. Reload the world: the model AND its collision persist.
7. Record in CHANGE_LOG.md what you authored, why the library did not fit, and the
   measured size. The next agent should not re-derive it.


<!-- omnimod-docs-version: omnimod-agent-docs-11 -->
