# 13 — SOUND: getting audio into this map or a mod

Map: `__OMNIMOD_MAP__` · Library: CC0 game SFX · HTTP: `omni_sfx_*` MCP tools

A build with no sound feels dead: a door that opens silently, a button that does
not click, a pickup with no chime. You cannot author audio, but a curated CC0
library already exists and the tools below will find, VERIFY and install a sound
for you. This file is the contract.

## 1. THE DOCTRINE — sound serves the request, it does not decorate it

1. **The user's request is the specification** (00_AGENT_MANDATE §1). If they asked
   for a quiet village, do not wire 40 ambient loops into it. Adding sound they did
   not ask for is a defect, exactly like adding unrequested decoration.
2. **Sound is expected when the thing it belongs to is expected.** A door you built
   that a player can open should sound like a door. A UI you built should click.
   A pickup should chime. That is not decoration — it is the feature working.
3. **Match the map's existing language.** Read MAP_OVERVIEW.md and listen to what
   the map already does. A silent all-block map stays mostly silent; a map that
   already plays sounds continues in the same register.
4. **Record what you chose and why** in CHANGE_LOG.md, and note the licence.

## 2. The CC0 sound library — find, VERIFY, fetch, install

A public library of CC0 (public-domain) game sounds exists — UI clicks, impacts,
footsteps, weapons, monsters, sci-fi, jingles, voiceover — with a machine-readable
catalogue. **Commercial use allowed, no attribution required.** It is updated
continuously, so the tools read its catalogue live; never hardcode a count.

| Tool | What it does |
|---|---|
| `omni_sfx_library` | What the library holds, the engine contract, the whole loop |
| `omni_sfx_search` | `{query, category?, tag?, useCase?, mood?, maxDuration?, format?}` — Arabic queries work |
| `omni_sfx_inspect` | Duration, formats, SHA-256, and a warning when the length does not match your trigger |
| `omni_sfx_fetch` | Downloads ONE file and verifies its SHA-256 + parses its audio header |
| `omni_sfx_install` | Writes the file where the engine can reach it and MERGES `sounds.json` |

`omni_sfx_inspect` with a `need` string is the honest check: ask for `"a button
click"` and it will tell you when the sound you picked is 8 seconds long, or when
you asked for a UI sound and picked one from the music-jingle pack.

## 3. THE OGG RULE — read this before you place any file

**Only `.ogg` is playable.** The 1.8 sound handler builds every file reference as
`assets/<namespace>/sounds/<entry-name>.ogg` — the extension is appended
unconditionally, with no extension handling anywhere in the resolution path
(`SoundHandler.java:242`). A WAV, MP3 or FLAC dropped into a resource pack is
copied by the loader and then **never requested**: it looks installed and plays
nothing, with no error.

Consequences you must respect:

- `omni_sfx_install` only places OGG. If the sound you chose has no OGG upstream
  it will say so instead of installing something silent, and it will use a local
  `ffmpeg`/`oggenc` to convert when one is available.
- When searching, prefer `format: "ogg"`. Packs that ship WAV/FLAC only (the OGA
  retro/RPG/zombie packs) cannot be installed as-is.
- Never rename a `.wav` to `.ogg`. The engine hands the bytes to the platform
  decoder, which reads the real container — a mislabelled file fails at play time.

## 4. The asset layout — where a sound must live

```
assets/<namespace>/sounds/<name>.ogg     <- the audio, name has no extension
assets/<namespace>/sounds.json           <- the event map
```

`sounds.json` registers each top-level key as the event `<namespace>:<key>`, and
each entry of that event's `sounds` array resolves to `sounds/<entry>.ogg`:

```json
{
  "click": {
    "category": "ui",
    "sounds": ["ui_click_5"]
  }
}
```

That file must be valid JSON. **Never overwrite a pack's `sounds.json`** — it may
already define dozens of events. `omni_sfx_install` merges (existing events and
entries are preserved) and refuses to touch a malformed document rather than
replacing it.

### For a MAP (the usual case)

`omni_sfx_install { id, target:"map", map:"__OMNIMOD_MAP__" }` writes into this map's
`mods_folders` root through the agent bridge. The engine translates that folder
into the world resource pack on world load, so **reload the map** afterwards:

```
omni_sfx_install { id:"ui-audio_click5", target:"map", map:"__OMNIMOD_MAP__", event:"click" }
POST /omni/world/restart            # applies the new resource pack
omni_command { command: "playsound omnisound:click @a" }
```

### For a MOD

`omni_sfx_install { id, target:"mod", dir:"<mod folder>" }` writes the same two
paths inside the mod. Stage the mod, reload the world, then play the event. A mod
that ships `assets/<modid>/sounds.json` gets `<modid>:<event>` registered
automatically — no code, no registration call.

## 5. Playing it — `playsound`

```
playsound <namespace>:<event> <player|@a|@p> [x y z] [volume] [pitch] [minVolume]
```

- From a command block, a function, a map batch op, or an OMNI3D interaction
  action (`/omni3d interaction nearest interact [{"type":"sound","id":"ns:event"}]`).
- `@a` plays for everyone; coordinates make it positional (it attenuates with
  distance). `volume` 0..1+ and `pitch` 0.5..2.0 are your two knobs.
- Vary `pitch` slightly on repeated sounds (footsteps, hits) so they do not sound
  like a machine gun of the same sample.

Design rules that keep it professional:

| Rule | Why |
|---|---|
| One-shots stay short (≤ 2 s) | a long file on a repeated trigger overlaps into mush |
| Never fire a sound every tick | it becomes noise and costs audio channels |
| Use `category` in sounds.json | controls which volume slider the player expects |
| Ambient loops: 8 s+ and `stream: true` for long beds | short files looping are audible |
| Keep the palette small per build | three well-chosen sounds beat twenty |

## 6. Common failures — symptom → cause → fix

| Symptom | Cause | Fix |
|---|---|---|
| `playsound` reports success, nothing audible | the file is not `.ogg` — the engine only ever requests `<name>.ogg` | reinstall as OGG (`omni_sfx_install` refuses WAV/FLAC for this reason) |
| `Unable to play unknown soundEvent` | the event key is not in any loaded `sounds.json` | check the key matches, and that the pack was loaded (reload the world) |
| sound plays for you but not others | `@p`/player target instead of `@a`, or positional coords far away | use `@a`, or correct coordinates |
| event exists but silent | the `sounds` entry name does not match the file base name | they must match exactly (`click` → `click.ogg`) |
| the whole pack's sounds broke | someone overwrote `sounds.json` | restore it; always merge, never replace |
| installed into the map, still nothing | the world resource pack was not rebuilt | reload the map (`/omni/world/restart`) |
| a loud pop on every play | the sample is not trimmed / has DC offset | pick a different sound; do not process audio in place |

## 7. Verification battery for sound work (on top of 04_TESTING_MANDATE)

1. Provenance — `omni_sfx_fetch` reported `verified: true` (the SHA-256 matched
   the catalogue). A mismatch means you cannot quote the catalogue's duration.
2. Placement — the file is at `assets/<ns>/sounds/<name>.ogg` and the event key in
   `sounds.json` points at exactly `<name>`.
3. Live — reload the map, then `playsound <ns>:<event> @a` and LISTEN. A command
   that returns without an error is not proof that audio came out.
4. Logs — `/omni/logs?q=sounds_json` and `/omni/errors` show no warning for your
   namespace.
5. Others — if it is positional or targeted, confirm a second player hears it.
6. Regression — re-check one sound that existed before you touched the pack:
   merging must not have broken it.
7. Report into `state/verification/` and CHANGE_LOG.md, naming the sound ids and
   their licence (CC0 — attribution is not required, but record it anyway).


<!-- omnimod-docs-version: omnimod-agent-docs-11 -->
