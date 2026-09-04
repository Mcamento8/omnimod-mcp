# 03 — DESIGN AND GEOMETRY (building it right, not just building it)

The engine will happily place a lopsided house. Correctness here is entirely on you.
This file is the method.

## 1. Turn the request into a numeric specification first

Never start from prose. Write this table before the first op:

```
structure      : cottage
origin (min corner) : x=0  y=65  z=0        # y=65 is floor level on a void map
footprint      : width(x)=9  depth(z)=7      # so x: 0..8, z: 0..6
wall height    : 4                           # so walls occupy y: 65..68
wall material  : minecraft:cobblestone meta 0
floor material : minecraft:planks meta 0
roof           : gable, ridge along x, overhang 1, minecraft:planks meta 1
door           : centre of the -z wall, x=4, y=65..66, facing north
windows        : glass_pane, y=67, every 2 blocks from x=2 to x=6 on both long walls
count          : 1
```

Every number in that table must trace back to something the user said, or to a stated
default you are prepared to defend. If the user said "small house", pick sensible numbers
AND record that you picked them, so they can correct you cheaply.

## 2. The arithmetic rules that prevent distortion

1. **Inclusive boxes.** Width `w` starting at `x0` spans `x0 .. x0+w-1`. Writing `x0+w`
   makes every structure one block too large — and the error compounds on the roof.
2. **Odd dimensions centre cleanly.** A door or ridge centres exactly only on an odd span.
   For a 9-wide wall the centre is `x0+4`. For an 8-wide wall there is no single centre:
   choose `x0+3` or a 2-wide door, and say which you chose.
3. **Compute the centre once, reuse it.** Recomputing `(x0+x1)/2` in several places with
   different rounding is how doors end up off-axis from ridges.
4. **Walls then floor then roof, and know which one wins.** Later ops overwrite earlier
   ops at the same coordinate. Fill the shell, then carve openings, then place the frame
   pieces. Do not place a window and then fill the wall over it.
5. **Carve with `air`, do not skip.** To make a doorway inside an already-filled wall, fill
   the doorway volume with `minecraft:air`. That is the reliable way to get a clean opening.
6. **Roof pitch must divide the span.** A gable over a span of `s` needs `ceil(s/2)`
   courses to reach the ridge. If you emit fewer, the roof has a hole along the ridge;
   more, and it overshoots into the air.
7. **Hollow structures need six faces, not one box.** A hollow box is: floor, ceiling, and
   four walls — each an explicit fill. Filling solid and then filling the interior with air
   also works and is often easier to get right; it costs more block writes.

## 3. Primitive recipes (order-of-operations, in ops)

**Solid box** — one `fill_area` from the min corner to the max corner.

**Hollow box** (w x d x h at origin `x0,y0,z0`):
1. floor: `fill_area` `[x0,y0,z0] .. [x0+w-1,y0,z0+d-1]`
2. ceiling: same box at `y0+h-1`
3. wall -z: `[x0,y0,z0] .. [x0+w-1,y0+h-1,z0]`
4. wall +z: `[x0,y0,z0+d-1] .. [x0+w-1,y0+h-1,z0+d-1]`
5. wall -x: `[x0,y0,z0] .. [x0,y0+h-1,z0+d-1]`
6. wall +x: `[x0+w-1,y0,z0] .. [x0+w-1,y0+h-1,z0+d-1]`

**Cylinder** (centre `cx,cz`, radius `r`, height `h`): for each `y` and each `dz` in
`-r..r`, compute `dx = floor(sqrt(r*r - dz*dz))` and emit one `fill_area` run from
`cx-dx` to `cx+dx`. One fill per row keeps the op count linear in `r*h`, not cubic.

**Sphere** (centre `cx,cy,cz`, radius `r`): same idea in two nested loops — for each
`dy`, for each `dz`, one x-run of half-width `floor(sqrt(r*r - dy*dy - dz*dz))`.
For a hollow shell, keep only cells where the radius test passes but the `r-1` test fails.

**Stepped pyramid**: layer `i` from `0..r` is a box inset by `i` on all four sides at
`y0+i`. Stop when the inset span reaches 1 (odd base) or 2 (even base).

**Gable roof** over span `s` with ridge along x: course `i` (from `0`) covers the two
rows `z0+i` and `z1-i` at height `y0+i`. Stop when the two rows meet or cross.

**Hip roof**: each course insets by 1 on all four sides and rises 1. The final course is
a solid cap, not a ring, or you get a hole at the apex.

**3D line**: Bresenham on the dominant axis, one `place_block` per step. Do not attempt
diagonal fills — `fill_area` is axis-aligned only.

## 4. Style guidance that makes builds look intentional

- **Contrast the frame from the field.** Corners and edges in a second material (logs,
  stone brick) read as architecture; a single material reads as a box.
- **Give roofs an overhang of 1.** A roof flush with the walls looks unfinished.
- **Windows at eye level.** With a floor at `y0`, put the window band at `y0+2`.
- **Doors are two blocks tall.** Carve `y0` and `y0+1`; a one-block gap is a crawlspace.
- **Light the interior.** In 1.8, mobs spawn in the dark. One torch per ~7 blocks of floor.
- **Vary repeats.** When placing several of the same structure, change footprint, height,
  or material per instance unless the user explicitly wants identical copies.
- **Leave circulation space.** Buildings placed edge-to-edge with no gap look like a wall,
  not a village. 2-4 blocks between structures, with a path material between them.

## 5. Plan the batch sequence, not just the geometry

A professional build is a sequence of verifiable stages:

```
ops-0001.json  terrain / platform / ground plane
ops-0002.json  structure shells (walls + floors)
ops-0003.json  openings carved (doors, windows) + frames
ops-0004.json  roofs
ops-0005.json  interiors, lighting, furniture
ops-0006.json  paths, landscaping, spawn point
```

Verify after each stage. Finding a 1-block offset after stage 2 is a small fix; finding it
after stage 6 means redoing the roof, the windows and the interior.

## 6. Before you declare the build correct

- [ ] Every dimension in the world matches the specification table exactly.
- [ ] No unintended air gaps in walls, floors or roof (scan the shell).
- [ ] No blocks left floating outside the intended footprint.
- [ ] Doors and ridges are on the axis you specified.
- [ ] Roof meets the walls with no ridge hole and no overshoot.
- [ ] Interior is enclosed and lit.
- [ ] Nothing pre-existing in the map was destroyed that the user did not agree to lose.

<!-- omnimod-docs-version: omnimod-agent-docs-4 -->
