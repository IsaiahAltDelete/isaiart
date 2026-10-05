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

## Critic loop (attempts 1–6)

An art-director critic scored the build after each attempt: 6.7 → 8.0 → 8.5 → 8.6 → 8.9 → 9.0.
Main fixes: night lighting, phone layout, camera framing, shingle roofs, soft smoke, grass and
dirt lanes, fixed-size bubbles, villager spacing.

## Round 5 — the big content update (client requests)

- **Music:** a procedural score, not a music box. Piano, harp, flute, bass, bells, soft
  percussion and reverb play four pieces (morning, day, evening waltz, night) that change with
  the clock. Each 8-bar phrase is built A A' B A'' and repeats once so the tunes stick.
- **House variety:** every cottage is seeded by its id. Wall and roof colours, gable or hip roof,
  porch, window boxes, dormer, chimney side and garden all vary. At level 3 a house gets an upper
  storey. Tiled cottages vary too.
- **New buildings and synergy:** Chicken Coop, Orchard, Apiary, Sheep Pasture, Weaver, Cow
  Pasture, Creamery, Brewery, Tavern and Schoolhouse; Watchtower and Wizard Tower; plus Torches,
  Palisades and a Memorial Garden. Nearby buildings boost each other (bees → farms and orchards,
  flowers → bees, lumber → sawmill, brewery → tavern, …). Placement draws gold lines to every
  neighbour bonus.
- **New goods:** wool, cloth, milk, cheese, honey and ale. Tap or hover any resource for what it
  is, where it comes from, what uses it, and its rate.
- **Farming:** choose wheat, vegetables or pumpkins per field. Chickens, sheep and cows wander
  their pens and graze.
- **Life cycle:** villagers age. They pair up, have babies who toddle and play (and go to school),
  grow up into workers, retire as elders, and pass away peacefully. Family ties show in each
  villager's panel.
- **Night:** villagers sleep indoors, or on bedrolls around the campfire when beds run out.
  Guards stay up on the watchtower.
- **Beasts:** wolves, boars and goblins prowl in from the forest at night. Guards shoot them,
  torches scare them and palisades block them. They steal food or coins, or trample fields, if
  they get through.
- **Magic:** wizard apprentices gather mana and learn six spells: Bountiful Harvest, Call the
  Rain, Swift Feet, Ward of Light, Forest Bloom and Stone to Gems.

## Round 6 — seasons, festivals and treasures

Picked from the list below: seasons, festivals, gift chests, naming, the camera tools and the
production-chain view.

- **Seasons** (three days each): spring blossom, summer, autumn colours and leaf piles, then a
  winter where snow settles on the ground, treetops and roofs (roofs keep their colour), paths turn
  to slush and the water ices over. Snow, leaves and petals fall. Winter slows crops and berries;
  autumn boosts orchards.
- **Festivals** at dusk on the second day of each season: Flower Fair, Midsummer Bonfire, Harvest
  Festival and Lantern Night. Everyone dances round a roaring bonfire under bunting, with fireworks
  or sky lanterns and a festival jig, then a feast and a day of good cheer.
- **Gift chests** turn up in the woods (a chest button flies you there). Some hold rare treasures
  that can't be built: a Wishing Fountain, Fairy Ring, Garden Gnome and Tree Swing.
- **Names**: rename your village and anyone in it, and name each newborn.
- **Camera**: Home button, double-tap a villager to follow, double-tap the ground to zoom.
- **Production chain** in every workplace panel: inputs → building → outputs with real per-minute
  rates and links to suppliers and customers.
- **Textures** (Isaiah): shared canvas-drawn plaster, wood, stone, brick, shingle, slate, straw and
  cloth surfaces on every building, and a ground shader that blends grass, earth and cobbles.
- Fix: workers in looping jobs never went to bed; bedtime and festivals now break the loop.

A critic pass on the first draft scored 8.6; its notes (winter whiteout, a sticky chest banner,
over-zoomed close-ups, a cramped desktop panel, glittery fireworks) were fixed afterwards.

## Round 7 — Blender models, RPG layer, roads and trade (client requests)

All ten "next round" ideas, plus a long client wish list.

- **Models from Blender.** Every building, villager, animal, crop, beast, tree and decoration is
  now authored as a Python script in `blender/` and exported headless
  (`blender -b -P blender/cli.py -- export ../models/models.json`) to a compact binary that
  `js/blender.js` loads. Material names are slots (wall, roof, shirt, hair…) so each house and
  villager is still recoloured from its seed. Roofs are thick texture-mapped slabs (client call).
  - Chibi villagers with big readable faces, six hairstyles and a hat or apron per job.
  - Four cottage archetypes, each with a two-storey version, and a hero prop on every workplace
    (pretzel sign and dome oven, windmill sails, saw blade, giant axe, cheese tower…).
  - Guild Hall, Forge, Trade Post, a real Wishing Fountain, sheep, cows, chickens, wolves, boars,
    goblins, wheat/cabbage/pumpkin crops, stylized pines and round trees, festival decorations.
- **Winter**: white snow caps on roofs, knitted scarves and woolly hats, snowmen round the
  campfires and children sledging.
- **UI**: a sky-dial clock with a 3-day forecast, build-tray categories, a reworked Villagers tab,
  shared animated tooltips, motion and keyboard shortcuts, a sectioned building panel and a
  Buildings list. Hovering a building outlines it and shows a label; selecting draws a gold
  footprint outline; placing shows each footprint tile green or red. Baby-naming popups are gone.
- **Weather**: forecast days (clear, cloudy, rain, storm, snow, blizzard); storms send everyone
  indoors with lightning and thunder.
- **RPG layer** (`js/rpg.js`, `rpgui.js`, `rpgview.js`): D&D ability scores that set work speed and
  job fit, hit points and health bars, d20 combat against night beasts, a Guild Hall that sends
  parties on dice-driven expeditions, a Forge whose recipes unlock with Schoolhouse knowledge, and
  a spellbook of SRD 5.1 spells (CC-BY-4.0).
- **World** (`js/roads.js`, `trade.js`, `social.js`, `festival.js`, `share.js`, `island.js`): dirt and
  cobble roads with bridges, nicer water and soft ground, per-settlement stockpiles with trade carts,
  settlement specialties, friendships and evening visits, festival quests and a festival shop,
  share codes, the gift-chest arrow, and Pearl Isle with a ferry.

**Critic loop (round 7):** 6.3 → 7.8 → 8.3 → 8.5 → 8.5 → 8.7 → 8.8 → 8.9 against a 9.0 pass mark; it did
not pass. Along the way the client swapped the chibi villagers for ~3.6-head "storybook folk" at about 1.2x
door height. The last two passes added contact shadows and livelier shirts, kerb blocks, status badges on
the resource bar instead of stacked toasts, water kept off road banks, and a cleaner opening frame. The
critic's last notes: straw brims still hide faces from the default pitch, and the slab roofs, flat ground
and small villagers sit a notch below the Tiny Glade / Townscaper bar.

## Next round — pick 5–6

Ordered easiest to hardest:

1. Light spell visuals and villagers visibly carrying a knocked-out friend home
2. Merchant cart and ferry boat remodelled in Blender
3. Interior cutaways when you select a house
4. Expedition destinations shown on the world map
5. Seasonal clothes for summer (sun hats) and rain (coats and umbrellas)
6. Villager portraits rendered from the 3D models
7. Level-of-detail models for phones
8. Building variants for upgrades at every level, not just cottages
9. Rival bandit camps that expeditions can clear
10. A second biome (snowy mountain pass) to settle

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
| `js/audio.js` | WebAudio sound effects, rain and the procedural score |
| `js/snow.js` | Shared shader patch: snow on upward faces, slush on paths |
| `js/textures.js` | Canvas-drawn surface textures for buildings and ground |
| `js/blender.js` | Loads the Blender models (`models/models.json` + `.bin`) into three.js |
| `js/select.js` | Hover and selection outlines, placement footprint cells |
| `js/rpg.js`, `rpgui.js`, `rpgview.js` | Ability scores, combat, Guild Hall, Forge, spellbook |
| `js/roads.js`, `trade.js`, `social.js`, `festival.js`, `share.js`, `island.js` | Roads, stockpiles and carts, friendships, festivals, share codes, Pearl Isle |
| `blender/*.py` | Model scripts; `cli.py` builds, previews and exports them |
| `vendor/three.module.min.js` | Three.js r170 (MIT) |

Saves live in `localStorage` under `isaiart.villages.v1`.
