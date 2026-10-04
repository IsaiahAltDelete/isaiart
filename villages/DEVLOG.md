# Villages — dev log

A cozy 3D village builder at **isaiart.com/villages**. Grow little settlements inside a
forest, give villagers jobs, and keep a small economy humming.

Built following Dilum Sanjaya's "cozy game with Opus" workflow:

1. One opening prompt: *a bunch of villages inside a forest, villagers you can assign tasks to,
   and a UI that matches the cozy feel*.
2. Then rounds. Each round: do a handful of things, then write **10 improvements ordered by
   difficulty**, pick **5–6**, build them, repeat.
3. Play for a minute or two between rounds and fold your own fixes in.

Between rounds I also ran a headless "bot player" against `js/sim.js` (it has no DOM or
Three.js dependencies) to fast-forward an hour of play in about a second. That's how the
pathing and economy bugs below were caught.

---

## v1 — the opening prompt

- Three.js low-poly world: a meandering river into a lake, ~5,000 instanced trees, boulders,
  berry bushes, roads between four clearings (Meadowbrook, Pinehollow, the Shallows, Stonecrest).
- Villagers with real jobs and pathfinding (A*): woodcutter, forager, farmer, sawyer, miner,
  fisher, merchant, forester, miller, baker, mason. Idle villagers build construction sites.
- Economy: coins, wood, planks, stone, bricks, grain, flour, food, gems; storage caps; meals;
  happiness that speeds up work; newcomers move in when there are beds and food.
- 14 buildings + 9 decorations, quests, XP and levels, unlockable settlements, day/night,
  desire paths that wear into the grass where villagers walk.
- Cozy cream-and-wood UI modelled on the reference screenshots, built for phones too.

## Round 1

Ideas (easy → hard): tidy phone HUD · fix odd models · soft roads · build-card tooltips ·
tree-felling animation · construction progress bars · weather · building upgrades ·
cross-village logistics.

**Picked:** phone HUD, models, soft paths, tooltips, felling animation, progress bars.
**Bot playtest fixes:** workers volunteer to build when nobody is idle; targets are picked by
walking distance (no more chasing trees across the river); doors can't be walled in;
decorations are walkable; sawmills and masons keep a reserve for builders; a bridge over the
river; markets only sell food and grain by default.

## Round 2

Ideas: mood icons · quest shortcuts · food alerts · production rates · work-range rings ·
wildlife · weather · upgrades · sleeping at night · trade caravans.

**Picked:** building upgrades (Lv 2–3), per-minute production rates, alert chip, quest
"show me" buttons, work-range rings, butterflies/fireflies/birds/jumping fish.

## Round 3

Ideas: bigger villagers + mood bubbles · graphics tiers · tutorial · better Villagers panel ·
rain · seasons · music · moving buildings · sleep · visiting merchant.

**Picked:** mood bubbles, High/Medium/Low graphics with dynamic resolution, five-step
tutorial, Villagers panel filters + auto-assign, rain showers + rainbow, moving buildings.

## Round 4

Ideas: meadow detail · sheltering butterflies · achievements · stone paths · visiting
merchant · music box · seasons · double-tap zoom · gift chests · logistics.

**Picked:** grass tufts and wildflowers, paintable cobblestone paths, 14 achievements, a
travelling merchant cart with deals, a procedural music box.

---

## Next round — pick 5–6

Ordered easiest to hardest:

1. Name your village and rename villagers
2. A "home" camera button and double-tap to follow a villager
3. Seasonal palettes: autumn leaves and a snowy winter every few days
4. Production-chain view in the building panel (inputs → outputs, live)
5. Gift chests hidden in the forest to find and open
6. Settlement specialties (Pinehollow timber bonus, Shallows fishing, Stonecrest stone)
7. Evening campfire gatherings and villagers sleeping at night
8. Festivals: a harvest fair with a happiness boost and special quests
9. Export / import a village as a share code
10. Per-settlement stockpiles with trade carts hauling goods between villages

---

## Code map

| File | What it does |
| --- | --- |
| `js/world.js` | Tile grid, world generation, A* and walking-distance fields |
| `js/sim.js` | All game rules: villager brains, economy, quests, upgrades, merchant, saving |
| `js/data.js` | Buildings, goods, quests, achievements, names |
| `js/view.js` | Three.js renderer, terrain, water, instanced forest, camera |
| `js/models.js` | Procedural low-poly buildings, trees and villagers |
| `js/life.js` | Butterflies, fireflies, birds and fish |
| `js/ui.js` | Every panel, modal, toast and tooltip |
| `js/main.js` | Wires it together: input, placement, effects, day/night, weather |
| `js/audio.js` | WebAudio sound effects, rain and the music box |
| `vendor/three.module.min.js` | Three.js r170 (MIT) |

Saves live in `localStorage` under `isaiart.villages.v1`.
