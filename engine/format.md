# Engine map format, v0 (what `WORLD.load()` takes today)

This is the shape the engine reads now, as produced by the old game's map code (`src/world/maps.js`). It is plain data: every map in
the old game survives `JSON.parse(JSON.stringify(map))` with nothing lost (checked in `src/mapdatatest.py`). Version 1, the format the
editor will write (JSON files, people, triggers, events), is designed in `docs/next-plan.md` §4 and will be written here when it is built.

```
WORLD.load({ id: map, ... }, startId)
```

A map:

| field | meaning |
|---|---|
| `id`, `name` | key and the name shown on exit tags and the plank |
| `W`, `H`, `grid` | size in tiles and `H` rows of `W` single-letter tiles (array of arrays) |
| `theme` | `{ ground, path, water, tall, tallBlade, tree, bg, flowers[], ice?, lava?, dense?, cave? }`; `bg` is the colour outside the map |
| `places` | buildings: `{ id, name, x, y, w, h, door: [x, y], kind?, roof?, color?, open?, enter?, inert? }`; `enter` names the interior map |
| `signs` | `{ x, y, text, to? }` |
| `objects` | things to look at or use: `{ id, kind, x, y, reach?, text?, hidden?, gate?, portal?, beam?, day? }`; art and light per `kind` come from the game (`objArt`, `objLight`) |
| `props` | landmarks (`landmarks.js` kinds) placed by `addProp` |
| `exits` | `{ edge: n/s/w/e, a, b, to }`: the tiles `a..b` on that edge lead to map `to` |
| `arrive` | `{ n/s/w/e: [x, y] }`: where you stand after coming in through that edge |
| `arriveFrom` | `{ mapId: [x, y] }`: where you stand after coming from that map (takes precedence) |
| `spawn` | `[x, y]` where you start when nothing else says |
| `types`, `rate` | the old game's wild encounters (which kinds, how often per grass step); the engine only passes them to `onEncounter` |
| `interior`, `style`, `rug`, `parent` | a room: drawn by the interior renderer with `style: { floor, wall, rug, bed, mat }` |
| `cave`, `dark: { r }`, `hall`, `rare`, `noWind` | flags the renderer reads: no wind and no night tint in a cave, a dark layer with light radius `r`, sparkles at `rare` |

Tiles: `.` ground, `,` flowers, `=` path, `W` tall grass, `Z` rare grass, `~` water, `T` tree, `R` rock, `F` fence, `C` cave wall, `X`
building footprint, `G` sign, `O` object; inside rooms `w` wall, `d` door mat, and the furniture letters (`b s t p k h m a x n`).
Solid: everything in `WORLD.SOLID`.

Hooks a game passes to `WORLD.init(canvas, opts)`: `act` (an action layer with `step/items/drawFx/active/veilAlpha`), `objLight(o, state)`,
`objArt(kind)`, `drawUnder(env)` / `drawOver(env)`, `onInteract`, `onNear`, `onEncounter`, `onGrass`, `onMap`, `onAlert`, `onSpotted`,
`canChallenge`, `exitLocked`, `onLocked`, `objState`, `tint`, `weather`, `still`, `ambient`, `carry`, `relit`, `follower`, `critterLead`,
`npcs`, `pos`, `map`, `random`. `WORLD.setWinds({ region: { base, calm } })` gives each region its wind character.
