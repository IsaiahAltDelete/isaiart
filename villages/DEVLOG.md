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

## Round 7b — education and homes that grow by themselves (client request)

`js/education.js`, installed from `addons.js` like the other systems.

- **Grades.** Children earn lesson points at school. Points scale with the teacher's INT, CHA and tier,
  the school's level, and the child's own INT and WIS, and they drop when the child is hungry.
  Attendance is tracked per school day. At 14 the score (points weighted by attendance) gives a grade:
  A ≥ 170, B ≥ 110, C ≥ 50, otherwise none.
- **Education tiers.** The tiers are Unschooled, Schooled (grade C), Honours (A or B) and Scholar. They
  multiply work speed by 1.0, 1.06, 1.12 and 1.2, replacing the old flat +15% for `educated`. Teachers,
  wizards and smiths now need at least Schooled. The job picker greys those jobs out, and auto-assign
  only picks qualified villagers. Old saves migrate `educated` to Schooled.
- **Library** (new Services building, level 6, Blender model). Grown-ups take the Scholar job and study
  up a tier at 60, 140 and 240 points. Studying also feeds the village's knowledge pool.
- **Homes grow by themselves.** Each cottage panel shows a "Growing to level N" checklist:
  - Level 2: everyone fed, a well within 9 tiles, a decoration within 4, a schooled grown-up, and the
    village at least 55% happy.
  - Level 3: everything above, plus a market or tavern within 12, a mostly-schooled household with one
    honours grown-up, a road at the door, and the village at least 70% happy.
  When every item is ticked and the village can afford it, the home starts its upgrade, with a toast and
  a log entry. You can turn this off per home ("Grow by itself") or for every home at once ("All homes").
- **Panels.** Children get a report card showing their projected grade, points, attendance and the next
  grade's threshold. The school panel lists every pupil's projected grade and the teaching quality.
- Also fixed: festival sky lanterns threw an error every frame (`Object.assign` onto a mesh's read-only
  `position`).

## Round 8 — implemented, testing and balance handoff (2026-10-05)

Picked up the unfinished Round 8 work. The requested systems are now installed, connected to the
UI and exported Blender assets. Source changes are local on `villages-round-7`; no commit, push or
PR update was made in this session. Keep the earlier local changes in `rpg.js`, `rpgui.js`,
`world.js`, `society.js` and the Blender scripts when reviewing the combined diff.

- **Government:** Town Hall at level 4, Council of Elders, elected Mayor, Monarchy, Magocracy and
  Merchant Republic. Leaders' abilities affect work, study, prices, cheer or security. Elections
  happen every season; monarchs pass their title to a grown child when possible. Town controls set
  taxes (0–40%), night watch, curfew, feasts, free schooling, poor relief and justice.
- **Economy:** each villager carries a purse; wages move coins from the treasury every 20 seconds,
  with taxes retained. Prices respond to local supply and household demand. Households buy local
  luxuries and repay cottage mortgages (40 coins; tiled homes 100). Poor/Modest/Comfortable/Wealthy
  labels appear in villager panels. Estates pass savings to family. Wages and household payments
  conserve coins; purchases, bath fuel and theft consume only the affected settlement's stock.
- **Homes:** households own and name cottages, custom names can be set or cleared, family members
  inherit homes and repayments, spare beds take lodgers. Panels, hover labels and the Buildings
  list use the home name. A separate saved heirs list preserves adult children who have moved out.
- **People:** Commoner is the default, suitable assignments or guild parties train a class. Nine
  races and three genders now have names, portraits, body proportions, racial bonuses and model
  features. Old names stay intact and racial bonuses migrate once. Wizard Towers appoint an
  eligible Archmage automatically or through their panel; Magisters qualify too.
- **Leisure:** Park (level 2, free), Pub (4, barkeep and local ale), Bathhouse (6, attendant and wood),
  Theatre (7, bards). Evening outings pay admission into the treasury and give lasting cheer.
  Work loops now break for evening visits. Build and Buildings lists have Leisure and Civic filters.
- **Arcane University:** level 8; Honours professors teach Honours young adults aged 14–35.
  Student places are separate from staff slots. Enrol or leave through the building panel;
  180 study points graduate a Magister (tier 4, ×1.25 work speed) and level 2 wizard.
  Tuition is 0.5 coin per lesson, waived by funded Free schooling. Missing staff/tuition stop
  progress; demolition or retirement releases students safely.
- **Seeds:** numeric seeds (including 0) and text seeds are deterministic. New villages get varied
  river/lake/pond/forest/rock layouts and readable traits. Settings includes a seed field, re-roll
  and trait preview; starting over retains the existing two-tap confirmation. Old saves retain
  generation 1 terrain and tree indices; new saves store `wgen: 2` and `seedLabel`.
  Fixed mutable island-center/settlement definitions affecting subsequent world generation.
- **Crime:** local pressure responds to poverty, idle adults, happiness, lighting, guards and
  policies. Night theft, pickpocketing and pub brawls create reports. Watch House constables walk
  routes through local public buildings, investigate reports for 120 seconds and arrest culprits.
  Lenient custody lasts 40 seconds; strict custody 90 seconds with more fear. Custody persists
  through saves; prisoners cannot be reassigned and release safely if their Watch House is removed.
- **UI/assets:** Town button with Government, Economy and Crime tabs, seed controls, household,
  race, purse, university, venue and Archmage sections. Seven new Blender building models plus
  villager race nodes and ceremonial hat/crown/robe/chain. Export contains **84 models**; metadata
  and binary are updated together. University and elf Archmage renders were visually checked.

Validation performed:

- `node --test tests/round8.test.mjs`: **30 passing tests** after the critic revisions, covering deterministic seeds and 16
  varied maps, classic-save terrain/tree compatibility, migrations, share codes, inheritance,
  elections, cash conservation, local stock, university graduation/tuition, outings, custody and
  arrests through ordinary movement/simulation ticks, custody/expedition gates, evening staff
  coverage, free child admission and complete university applications. The classic fixture was captured from the
  pre-integration simulation; its terrain and tree checks are fixed reference values.
- A developed 24-villager scenario ran **12 full game days**: no non-finite purse/HP values or
  physical-stock mismatches, one Magister graduated and 122 outings completed. This scenario had
  good cheer and a staffed Watch House, so it produced no natural crimes; targeted tests cover crimes.
- All **35 JavaScript modules** pass syntax checks; the combined checkout passes `git diff --check`.
- In-app browser checked government changes, tax/justice inputs, home naming, student enrolment,
  new Build/Buildings categories and seed preview/re-roll. Government and Economy panels were
  checked at 390×844 as well as desktop width. No new browser errors observed; Three.js still
  emits its existing already-non-indexed geometry warning.
- Export from the villages directory:
  `& 'F:\Blender\blender.exe' -b --factory-startup -P blender/cli.py -- export models/models.json`
  Use an absolute output path for Blender preview renders; relative preview paths resolved
  incorrectly on this Windows install.

Continue here:

1. Play a normal village from level 1 through University unlock. Tune wages, luxury spending,
   mortgage pace, tuition and venue fees together. The 12-day soak is a stability check, not a
   claim that the economy is balanced; students without savings or Free schooling can stall.
2. Play a poor, unhappy village at night and tune spontaneous crime frequency and patrol travel
   times. Arrest/custody paths are tested, but ordinary low-resource pacing needs human play.
3. Review every race/title at the normal game camera, especially hat/horn clipping, dwarf beards
   and the small gnome/halfling silhouettes. Revisit Round 7's roof/ground/hat quality notes.
4. Review the combined diff and publish only when requested. PR #15 was mentioned in the previous
   handoff but was not read, updated or verified in this session.

Preview: `http://127.0.0.1:8778/` serves the real checkout. A separate `8779` preview used a generated
advanced village for UI testing. Existing play data on 8778 was not replaced with that scenario.

## Roof texture follow-up (2026-10-05)

- Replaced the simple 256px roof colour maps with shared **512px albedo and height maps** for
  rounded terracotta tiles, chipped cut slate and bundled thatch. Staggered courses repeat at
  both edges; per-tile tones, narrow contact seams, worn lips and fine grain add surface detail.
- `js/roof-textures.js` generates the maps once per surface with deterministic seeds.
  `surfaceTexture` delegates roof colours to it; `roofMat` and Blender roof/thatch slots now
  also use the height map through Lambert bump shading. Material caching includes the bump
  texture and strength. Existing roof colours, UV scale and winter shader remain connected.
- Roof bump strengths are deliberately subtle: terracotta 0.035, slate 0.022, thatch 0.028.
  No Blender mesh changes or binary export needed. All 26 Round 8 tests still pass.
- Visually checked three cottage archetypes under different light angles, with winter dusting,
  and at normal village zoom. A temporary comparison page lives in the chat staging folder at
  `http://127.0.0.1:8779/roof-preview.html`; it is a review aid, not part of the shipped game.
  Six PNG maps and a comparison screenshot were exported to the chat's outputs folder.
- If adjusting further, start with `roofMaps` and inspect the normal camera distance before
  increasing contrast or bump strength. Roof silhouettes and the earlier hat/ground art notes
  still need a separate modelling pass.

## Round 8 critic loop (2026-10-05)

User requested an independent review of this round's changes, menus, logic and synergy with the
rest of the game. Target **8.5/10**, at most **3 attempts**. The same independent game systems/UX
critic reviewed source, real in-game screenshots, 390×844 Town controls and regression results.

| Attempt | Correctness (40%) | Synergy (25%) | Menus (25%) | Visuals (10%) | Overall |
| --- | --- | --- | --- | --- | --- |
| 1 | 7.8 | 7.3 | 8.0 | 9.0 | **7.9 — below target** |
| 2 | 8.8 | 8.4 | 8.6 | 9.0 | **8.7 — PASS** |

All four evidenced defects were fixed and independently rescored:

- Custody blocks Guild recruitment and expedition departure, including existing party members.
  Guild cards show custody and quest buttons explain the block. Released residents can depart;
  a blocked departure consumes no supplies and creates no expedition.
- Barkeep, bath attendant and bard service loops stay on duty during evening outings. A worker
  already on an outing cannot advertise coverage; ordinary residents still take evening breaks.
- Children enter all-ages baths and theatres free; grown-ups retain their fees. Pub admission
  remains adult-only. Selection, payment and panel copy agree; no coins are created by free entry.
- University enrolment lists every eligible applicant with full name and current job. Current
  faculty are excluded and protected in the simulation until explicitly removed from their job.
  The menu explains reassignment and retains the selected applicant through live redraws.

Validation: **30/30** tests pass, five changed JS modules pass syntax checks. Browser test selected
and enrolled a formerly hidden nineteenth applicant, leaving both professors assigned; a separate
paused custody fixture showed all eight expedition buttons disabled with the correct reason.
Those fixtures were imported only on 8779; the player's 8778 village was not replaced.

Final critic verdict: no remaining shipping blockers within the assessed scope; ready for the
next gameplay round. Optional polish: show the incumbent government's numerical bonuses in the
Town panel. No gameplay changes were made after the passing verdict.

Still unassessed: full progression/economic balance, spontaneous crime pacing in struggling
villages, every race/title animation and clipping combination, screen-reader/keyboard coverage,
and phone performance. Keep these in the next playtest rather than treating the score as proof
of comprehensive game balance. Review evidence and full score history are in this chat's outputs.

## Round 9 — facing placement, faith/classes and village boards (2026-10-05)

User requested camera-facing assets, religious buildings, class workplaces, dynamic region
selection and improved Villager/Jobs/Buildings boards. This round follows those requests.

- New placements face the viewer, snapping to the nearest of the four tile orientations.
  They follow camera rotation until Rotate/R selects a manual orientation. **Face camera**
  restores automatic facing. Moving a placed building keeps its orientation; fishing docks
  still follow their shoreline. A stable centre prevents rectangular footprints drifting as
  they turn. Existing placed buildings and saved rotations are preserved.
- **Wayside Chapel** (level 3) and **Temple of the Dawn** (level 6): schooled Acolytes train
  commoners as Clerics. Every completed 12-second work session heals the most injured eligible
  resident within 10 world units by 2 + building level, capped at maximum HP. Recent care lifts
  town happiness by 0.025 per active sanctuary per second, capped at three sanctuaries.
- **Training Yard** (level 4), **Ranger Lodge** (level 4) and **Rogues’ Guild** (level 5):
  Combat Trainers, Scouts and Locksmiths train commoners as Fighters, Rangers and Rogues.
  A session gives the worker 1.5 XP and up to two nearby eligible adult martial adventurers
  0.5 XP. Existing adventurers retain their class. Recent Rogues’ Guild practice reduces local
  crime pressure by 4 per guild, capped at 8, expiring after 30 seconds without practice.
- These are ordinary staffed jobs: normal wages, schooling checks, sleep, festivals, storms,
  recovery, custody and expeditions apply. Removed buildings and unavailable staff cannot
  complete stale lessons. Healing excludes people on expeditions, in custody or in combat.
  Building details show completed sessions and recent activity. Faith upgrades also explain
  their extra health restored per session.
- Neighbour bonuses use the existing synergy system and placement preview: Parks help
  Chapels/Temples (+10% work speed), Guild Halls help Training Yards (+15%), Foresters help
  Ranger Lodges (+15%), Watch Houses help Rogues’ Guilds (+10%). Class Halls groups existing
  Wizard Towers, Universities, Theatres and Guild Halls with the new martial buildings.
- **Villager board:** full identity, class/level, race, age, education, purse, current activity,
  availability and workplace. Search, class and status filters plus current/specific/all-region
  scope; unavailable people have no misleading job assignment control.
- **Jobs board:** vacancies, current staff, education requirements and all qualified idle local
  adult candidates ranked by ability fit. Explicit candidate selection; hiring rechecks the
  candidate and slot, so stale selections fail safely. The normal assignment path now also
  excludes downed recovering residents. Fully staffed workplaces can be included with a toggle.
- **Buildings board:** upgrade readiness, level, staffing, all costs with shortages highlighted,
  level/resource blockers, concrete upgrade effects, one-click upgrades and construction
  progress. Effects include trade carts, student places, guard range and longer outing cheer;
  buildings with no extra gameplay benefit say so. Filters show ready/blocked upgrades, sites
  and buildings needing attention.
- **Regions:** quick camera-aware region selector and richer World cards show residents/beds,
  local vacancies, upgrades, stored food and crime pressure. Each settled region opens its own
  boards directly; unsettled regions show level and resource requirements. The quick selector
  hides during placement and panels so it cannot cover their controls.
- Five new Blender models: chapel with belfry/rose window, domed temple with columned entry,
  fenced training courtyard with targets/dummies, woodland lodge, and a padlock-signed guild.
  They share the village's roof/surface textures. Exported metadata and binary together:
  **89 models**, metadata and binary together **2,125,313 bytes**. Source: blender/build_works5.py.

Validation: **43/43** headless checks (30 Round 8 + 13 Round 9), JS syntax checks and model
mesh/binary-range checks pass. Browser tests on the isolated 8779 test village verified hiring,
manual/automatic placement controls, upgrade initiation and readiness counts, region scope,
region-to-board links, search and 390×844 board layouts without horizontal overflow. All five
models were inspected with the game materials and in a real village.

A four-day ordinary-tick soak across two regions completed 79–154 sessions per staffed class
building, kept resources and residents finite/nonnegative, and reloaded the resulting save.
The original player's 8778 village was not replaced with test data. Screenshots, soak report
and a copy of these notes are saved in the chat outputs. Changes remain uncommitted.

The earlier 8.7 critic score covers Round 8 only; these new changes have not had an independent
scored critique. Remaining playtests: class XP/healing balance over full progression, poorest
town economies and spontaneous crime, all animation/clothing combinations, keyboard/screen
reader coverage and sustained phone performance. New class buildings currently share their
base visual model at higher levels; a future upgrade-variant art pass can add larger silhouettes.

## Round 10 — education careers, arcane disciplines and housing (2026-10-05)

User requested education seats that rotate into further study or suitable jobs, more useful
wizard towers and additional house/hostel types. This round implements those requests.

- **Education & careers:** automatic by default, checking idle local adults every 20 seconds
  and immediately when a library lesson raises their tier. Qualified teachers/professors fill
  needed faculty vacancies; Honours adults aged 14–35 can continue at a staffed university
  with a free student place and funded Free schooling or at least 4 personal coins. Otherwise
  suitable qualified local jobs are ranked by abilities, education needs and class. Productive
  staff remain at their posts. University graduates seek a career on the next check.
- Library learners who reach Scholar leave if no suitable next step exists, freeing their
  seats. Other idle adults can enter the library; a one-day cooldown prevents a capped
  graduate immediately returning. The cooldown does not block a newly available job.
  University students who lack tuition or available faculty for 60 seconds release their seat and seek work. Study points persist; a one-day retry delay prevents immediate re-enrolment. Overnight faculty sleep keeps seats intact. Children keep their existing school attendance and graduation rules; teachers remain
  employed to teach them. Questing, jailed, downed and recovering residents are excluded.
- Education buildings offer a village-wide automatic-placement toggle. Each adult's panel
  has an individual plan toggle and their latest transition. Disable that plan to preserve
  a manual library assignment for continued knowledge research. Both preferences persist.
- **Wizard tower disciplines:** choose Research, Warding, Nature or Artifice in its panel.
  Names on boards, panels, job choices and hover labels identify the discipline; a coloured
  beacon distinguishes it in the village. Changing modes cancels the staff's current practice.
  Research preserves normal spell/level study. Warding consumes 1 local stone per session
  to reduce that region's crime pressure by 8 for 45 seconds; multiple towers do not stack.
  Nature uses 1 local food to advance up to three growing fields within 10 world units by
  10%, clamped at ripe. Artifice consumes 2 local wood for 1 plank or 2 local stone for 1 brick,
  respecting local output storage. Failed work consumes no supplies or XP.
- A staffed, awake tower can perform a **focused ritual** for 10 treasury coins, the same
  materials and a 90-second cooldown: eligible spell research +8 / village knowledge +1,
  a 90-second ward, 25% field advancement, or an immediate transmutation. Controls show
  local stock, target fields, completed sessions, ward duration and live blockers/cooldown.
  Tower upgrades, unavailable workers and stale demolished tasks cannot complete effects.
  Regional deposits update both physical stock and the aggregate ledger without shifting
  output to the currently viewed settlement. No Beast protection is implied by crime wards.
- **Row House** (village level 4, 8 beds), **Village Hostel** (level 3, 10 beds), and
  **Garden Manor** (level 8, 12 beds) appear in Build → Homes. Row houses/manors use family
  ownership, inheritance, naming, mortgage repayments (120/300 household coins) and existing
  automatic upgrades. Hostels provide shared lodging without an owner or mortgage; their
  residents can move into private homes later. They can be named and manually upgraded.
- Three new Blender models: adjoining houses with separate doors and red/blue roofs;
  a dormitory hostel with welcome bunting, bed sign and porch; and a stone-trimmed manor
  with portico, crest and planters. Source: blender/build_works6.py. Export: **92 models**,
  binary **2,102,668 bytes** (metadata is a separate file).

Validation: **63/63** headless checks (30 Round 8 + 13 Round 9 + 20 Round 10), module syntax
and mesh/binary ranges pass. Browser checks in the isolated 8779 fixture verified actual
mode/recipe clicks, ritual consumption and cooldown, global/individual education controls,
and 390×844 discipline selection without horizontal overflow (page 390px, panel 354px).
The three housing models were visually inspected with the game's roof/surface materials.
Browser testing found and fixed the initial missing panel-handler connection before shipping.

A four-day ordinary-tick soak completed 215 Research, 118 Warding, 85 Nature and 60 Artifice
sessions. Learners moved through library study into university and jobs, no capped Scholar
remained in library seats, and the saved 37-resident village reloaded with finite resources.
Natural resource/target exhaustion produced explicit waiting states. Screenshots, soak report
and these notes are in this chat's outputs. The actual 8778 player's village was preserved;
test data stayed on 8779. Changes remain uncommitted.

Remaining playtests: career placement and tuition affordability through poor settlements;
long-term balance of crop acceleration, wards and transmutation; sustained phone performance.
Tower disciplines share the base tower silhouette with coloured beacons; additional tower
architecture and housing upgrade variants can be a later art pass. The earlier independent
critic score applies to Round 8 only, not these changes.

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
| `js/models.js` | Builds and dresses Blender model instances, recolours and animates them |
| `js/life.js` | Butterflies, fireflies, birds and fish |
| `js/ui.js` | Every panel, modal, toast and tooltip |
| `js/main.js` | Wires it together: input, placement, effects, day/night, weather |
| `js/audio.js` | WebAudio sound effects, rain and the procedural score |
| `js/snow.js` | Shared shader patch: snow on upward faces, slush on paths |
| `js/textures.js` | Canvas-drawn surface textures for buildings and ground |
| `js/roof-textures.js` | Shared 512px roof colour/height maps for tiles, slate and thatch |
| `js/blender.js` | Loads the Blender models (`models/models.json` + `.bin`) into three.js |
| `js/select.js` | Hover and selection outlines, placement footprint cells |
| `js/rpg.js`, `rpgui.js`, `rpgview.js` | Ability scores, combat, Guild Hall, Forge, spellbook |
| `js/roads.js`, `trade.js`, `social.js`, `festival.js`, `share.js`, `island.js` | Roads, stockpiles and carts, friendships, festivals, share codes, Pearl Isle |
| `js/education.js` | Grades, Library, Arcane University, Magisters and automatic home upgrades |
| `js/society.js` | Races, genders, household ownership, inheritance and Archmage titles |
| `js/government.js`, `economy.js`, `leisure.js`, `crime.js` | Governments/policies, wages/prices/mortgages, outings, patrols and custody |
| `js/townui.js` | Town tabs, seed controls, household/education and class-place details |
| `js/boards.js` | Villager/Jobs/Buildings boards, region summaries and navigation |
| `js/classplaces.js` | Sanctuary care, martial training and local detection activity |
| `js/careers.js`, `arcane.js`, `progressui.js` | Rotating education/careers, tower disciplines/rituals and their controls |
| `js/placement.js` | Camera yaw to tile-facing orientation |
| `tests/round8.test.mjs`, `tests/round9.test.mjs`, `tests/round10.test.mjs` | Save compatibility and gameplay/board integration checks |
| `blender/*.py` | Model scripts; `cli.py` builds, previews and exports them |
| `vendor/three.module.min.js` | Three.js r170 (MIT) |

Saves live in `localStorage` under `isaiart.villages.v1`.
