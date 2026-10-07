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

## Round 11 — the simplify pass (2026-10-05)

The client felt the game was getting too complicated after rounds 8–10. This round's rule: a
system stays only if you can **see it in the village** and it gives you **one clear decision**.
Old saves migrate automatically.

**Economy → prosperity** (`economy.js`)
- Removed personal purses, wages, mortgages, the price table and wealth labels. On first load,
  everyone's savings go back into the treasury once.
- Each home has one of four steps:
  - **Struggling:** someone in it is hungry.
  - **Getting by:** everyone is fed.
  - **Comfortable:** a luxury lately, plus a park, pub, bath or theatre nearby.
  - **Prosperous:** three or more luxuries, plus somewhere to unwind.
- Every 20 s each household uses one luxury (cloth, cheese, honey or ale) from its own
  settlement's store, if a Market Stall, Pub or Tavern sells it.
- Prosperous homes show it in the world: flower boxes, then a lantern by the door.
- With a Town Hall, homes pay tax that rises with their prosperity. Market prices are fixed again,
  apart from a government bonus.

**Government** (`government.js`)
- Five governments, each with three perks shown on its card.
- Three policies (Night watch, Public feasts, Free school meals). Each costs 1 coin per 20 s for
  every 4 villagers, a real share of tax income. The Town panel shows taxes against policy costs
  per minute.
- Removed: curfew, poor relief, justice modes. Tax is now 0–30%; above 10% happiness drops a little.
- Before a Town Hall, the panel shows the governments as a preview and asks for a Town Hall.

**Crime** (`crime.js`)
- Rolled once a night per settlement, and never in a storm. The chance rises with struggling homes
  and a glum village, and falls with guards, constables, lanterns, the government and Night watch.
  A happy, prosperous village is peaceful.
- The culprit puts on a mask (`mask` node), sneaks to the store, takes a sack of coins and heads
  home. A guard or constable who spots them gets the coins back.
- With a Watch House, a caught thief spends the next morning in the stocks out front (`v.jail` is
  reused, so every existing "unavailable" check still works). A thief who isn't caught keeps the
  coins.
- Removed: crime pressure numbers, investigations, custody timers, fear, pickpocketing and brawls.

**Classes and magic**
- The Training Yard trains Fighters, Rangers or Rogues (whichever suits the villager).
- The Ranger Lodge and Rogues' Guild are off the build menu; existing ones keep working.
- Wizard towers have two modes, Research and Nature. Warding, Artifice and the focused rituals
  are gone.

**Leisure and the University**
- Outings are free. The pub still uses ale and the bathhouse still burns wood.
- University tuition is gone.

**UI**
- **Villager panel:** a header with chips (title, race · pronouns, class, schooling, home), then a
  status line, family, workplace and job picker. Skills & health, Education (with the career
  toggle) and Friends are fold-out sections.
- **Boards:** one row per villager, workplace or building, and a single filter bar (region, show,
  search). The Buildings board went from about 11,600 px tall to 2,100 px. Upgrade costs show as
  icons with missing materials in red. Jobs: pick a candidate and Hire, inline.
- **Build menu:** 11 tabs down to 6 (Homes, Food, Industry, Services, Leisure & Faith, Defense).
  A "New" badge marks buildings you haven't seen yet.
- **Top-right buttons:** one Journal button (News, Achievements and Festival tabs, one badge). It
  opens whichever page has something waiting.
- **Clock:** below 1200×760 it folds to a slim strip; tap the sky for the forecast.
- **Coins:** whole numbers everywhere.

**Art** (background agent, `blender/`): grander Garden Manor, a smooth temple dome with a drum and
gold finial, a characterful pub roof, race features about 1.5× larger so they read at game zoom,
and the bandit `mask` node.

**Tests:** rewritten where the rules changed. Round 8 30/30, round 9 12/12, round 10 17/17.
Run them per file: `node --test tests/round8.test.mjs` (`node --test tests/` fails on Windows).
Check syntax as ES modules (copy to `.mjs` first); plain `node --check` missed an unescaped quote
this round.

## Round 12 — the Story page, village drama and hard times (2026-10-05)

The client found the relationship popups too pushy, felt everyone ended up best friends, and asked
for more things to go wrong: droughts, natural and supernatural disasters, famine, dragons.

**The Story page** (Journal → Story, `sim.story()`)
- Life events no longer pop up: love, babies, growing up, newcomers, farewells, new leaders,
  graduations, the Archmage, squabbles, rivals, break-ups, mischief and thefts. Each becomes an entry
  with portraits, grouped by day.
- Filters: Everything, Love & family, Friends & rivals, Milestones, Mischief.
- In the village, a small icon floats up over the people involved.
- The Journal badge now counts unread story entries, achievements and festival rewards, not every
  log line. The Journal opens on whichever page has something waiting.
- Each entry keeps a snapshot of the faces involved, so a farewell still shows who it was.
- A burst of new best friends (a festival, say) merges into one entry. "Good friends" only goes to
  News.

**Drama** (`social.js`)
- Affinity now runs from −100 to 100; at −30 or below, two villagers are rivals.
- Each villager has a quirk: Cheerful, Grumpy, Prankster, Proud, Shy or Chatterbox. It shows as a tag
  on their panel.
- Time together usually builds a friendship, but now and then it ends in a squabble. Squabbles are
  more likely between clashing quirks, when someone is hungry, and in a glum village; good friends
  forgive more.
- Friendships fade without time together, and grudges fade too. Couples don't fade.
- Festivals mend some rivalries.
- Couples now form out of friendship (the closest friend, at least 15). A couple who fall to
  negative affinity may part ways.
- Rivalries take a little happiness away from the village.
- The villager panel lists rivals under "Friends & rivals".

**Mischief and crime** (`crime.js`)
- Nightly theft is a bit more likely (base chance 0.07).
- Once a day per settlement, a prankster or a youngster may pull a harmless prank: a "borrowed" pie,
  a frog in someone's boot, a pink well bucket, chickens let loose, salt and sugar swapped, a snowman
  that looks like someone, tied bootlaces. Some pranks ruffle a friendship.

**Hard times** (`events.js`, visuals in `eventsview.js`)
- One roll a day at dawn, from day 4 and village level 3. Never on the first day after loading,
  never more than one event at a time (fires aside), and repeats are spaced out.
- Settings → Hard times: Off, Gentle or Normal.
- A banner under the resource bar says what's happening and what to do; popups move down below it.
- **Drought:** crops and berries grow slowly; rain ends it.
- **Crop blight:** a field or two withers and orchards bear half.
- **Fever:** about a quarter of a settlement falls ill (green glow, slower work). A cleric's round at
  a Chapel or Temple, or a bath, cures them.
- **Earthquake:** the camera shakes and one or two buildings are damaged.
- **Raiders:** announced at dawn, a war band of 4–8 goblins strikes after dark.
- **Restless spirits:** wisps drift through the village at night and happiness drops. Clerics lay them
  to rest.
- **The fair folk are offended:** work is 15% slower. An offering of 5 honey or cheese ends it and
  blesses the fields for a day (crops +30%).
- **Dragon attack** (level 8 and up):
  - A Blender dragon (`blender/build_dragon.py`) circles the settlement and swoops every 8–12 s,
    breathing fire on a building or snatching up to 5% of the coins.
  - Guards, wizards (the Archmage hits harder) and constables wear it down. Driven off, it drops gems
    (8 plus half the village level); otherwise it leaves after 80 s with its loot.
- **Fire** (lightning in a storm, or the dragon):
  - Flames and smoke on the building; up to 6 villagers form a bucket chain. A well or fountain within
    10 tiles makes them 40% better at it, and rain helps too.
  - If the fire wins, the building is damaged: it looks charred and stops working.
  - Its panel offers a repair for about 40% of the build cost, done through the normal upgrade work.
- **Famine** isn't rolled. It's declared when more than 40% of villagers are hungry (droughts and blight make that likely) and lifted below 10%. It shows a banner and a Story entry.
- Nobody dies.

**Speech bubbles, scuffles, hunger theft, wanted posters and paladins** (follow-up the same day)
- **Speech bubbles** (`v.talk`, drawn in main.js): three bouncing dots while chatting, a jagged red
  "#@!" that shakes during a squabble, a pulsing heart between sweethearts. They pop in, bob, and fade.
  The pair turns to face each other.
- **Scuffles:** rivals at −60 or worse may come to blows (20% of their squabbles) if one is grumpy,
  proud or hungry. A comic windmilling `scuffle` animation; 1–2 HP lost, never a knock-out.
  - A guard, constable or paladin within 12 breaks it up, and with a Watch House the instigator gets
    the stocks until morning.
  - If nobody stops it, the instigator gets a wanted poster.
- **Hunger theft:** every 15 s by day, a hungry grown-up has a 12% chance to raid a growing field,
  orchard, coop, hive or dairy. They eat (it sets back a field's growth), and the raid goes to the
  Story.
  - A watcher who catches them lets them off with a loaf of bread; on the third raid it's an hour in
    the stocks.
  - Hunger also raises the nightly theft chance.
- **Wanted posters** (Town → Wanted):
  - An escaped thief or an unstopped brawler gets a parchment poster. It's unknown ("?") until a
    witness, constable, rogue or paladin works out who it was; then it shows their face, crimes and
    village.
  - Watchers who spot a known culprit catch them (the stocks, with a Watch House). The poster is
    stamped CAUGHT and comes down a day later. Unknown trails go cold after three days.
  - A 20-coin bounty doubles both identifying and catching. Wanted villagers get a red "Wanted" tag on
    their panel.
- **Paladins** (new class, `classduties.js`):
  - Temple acolytes become Clerics or Paladins, whichever suits them. Paladin: d10 hit die, armour
    and shield. On expeditions, Divine Smite (+2d8 once per fight) and Lay on Hands.
  - In the village they answer the alarm, waking to charge any beast or raider within 16 and opening
    with a smite. Once a day each lifts a knocked-out neighbour back up, and they hit the dragon hard.
- **Other class duties:**
  - Rangers shoot at prowling beasts in bowshot.
  - Rogues spot sneaks and crack wanted cases.
  - Bards halve squabbles nearby.
  - Fighters and rangers help against the dragon.
  - The class tag's tooltip says what each class does in the village.

**Tests:** new `tests/round12.test.mjs` (21 tests); model-count checks now expect at least 93.
All 80 tests pass. Run each file on its own, e.g. `node --test tests/round12.test.mjs`.

## Round 12 critic loop (2026-10-05)

Critic: a lead designer of cozy village and colony sims, judging the Story page, drama, crime,
hard times and paladins. Pass mark 8.5, three attempts. Desktop 1280×720 first, phone second.

**Scores: 7.1 → 8.2 → 8.5. Passed on attempt 3.**

Fixed along the way:
- **Banners:**
  - Every banner carries a bold "what to do" line, also on phone, where the stack sits at the
    bottom, clear of the icon column.
  - No duplicate popups when an event or fire starts.
  - The fire and dragon bars are distinct and explained.
- **Fires:**
  - "Ring the bell" calls up to 10 helpers; the banner says whether a well is close.
  - Crew line up toward the well and throw blue water that puffs where it lands.
  - Flames are tapered tongues.
- **Dragon:**
  - The banner has an instruction and a "Sound the horn" lever (double damage for 25 s, once per
    attack).
  - A long breath stream, and scared "!!" bubbles over the villagers underneath.
- **Damaged buildings:** the repair button says what's missing. Status, production, bonus and
  upgrade rows are hidden, the workers show "Waiting for repairs", and the hover label says
  "Damaged".
- **Crime:**
  - Safety counts open posters and recent thefts (Peaceful, Uneasy, Troubled). Wanted sits above
    Households, and the Town button badges new posters.
  - Theft is 1% of the treasury, capped at 120 × village level; the bounty is half the loot.
  - Identified thieves lose goodwill, wear a "!" bubble, and their posters come down after four days.
- **Scuffles:** the hot-head gets the blame, and the nearest awake keeper, fighters included, steps
  in. No posters for scuffles.
- **Story:**
  - Squabble lines don't repeat.
  - Five different kindnesses for caught hungry raiders, and same-day raids by the same catcher
    merge into one entry. This found and fixed a crash: a portrait snapshot without a hat colour.
- **In the world:**
  - Speech bubbles are capped to the 6 nearest the screen centre, at most 2 of them angry.
  - Fever shows as a 36px sick-face bubble that outranks hunger.
  - Wisps are bigger, cyan-green, and drift around villagers.

The critic's remaining notes:
- The bucket-chain water still reads a little like blue flame.
- The wanted villager's "!" looks like the "!" buildings use for problems.
- At full brightness the dragon's breath whites out its target.

The last three critic notes are the starting point for a future art pass. Applied after the
passing verdict without re-scoring: the repair button shows only "Need …" (cost in the tooltip),
the dragon row lost its redundant label, and at most two angry bubbles show at once.

## Round 13 — wishes, pets, weddings, town rank, the chronicle and visitors (2026-10-05)

Six systems that make the villagers feel like people, each built around a single decision.

- **Wishes** (`wishes.js`):
  - Now and then a villager wishes for something small: a bench or flowers by the door,
    somewhere to unwind, to study, a job they'd be good at, a treat, a pet, to make up with a
    rival, or a swing.
  - A star thought bubble shows over their head, and an entry goes on the Story page.
  - The Story page lists open wishes at the top, each with a one-tap button. The villager's panel
    has a wish card with the button and a hint.
  - Some come true when the village changes (place the bench). Others need the one-tap answer
    (give the honey, adopt the pet).
  - A granted wish makes the villager beam and lifts the village. Unanswered wishes fade after
    two days, no harm done.
  - Wishes wait until the first-time tips are over, and only ask for things you can build at
    your level. At most 1 + pop/12 wishes are open at a time, with a 2-day rest per villager.
- **Pets** (`wishes.js`, models `cat` and `dog`):
  - A cat or dog costs 15 coins: from a pet wish, or "Adopt" under Friends.
  - Pets trot after their owner and sit by the door while the owner is indoors. Dogs wag;
    cats swish.
  - Each pet cheers the village a little. Pet wishes are rarer, and there is about one pet per
    five villagers.
  - If the owner leaves, someone else takes the pet in.
- **Weddings** (`celebrations.js`):
  - A new couple marries the next evening at their campfire, one wedding per campfire per night.
  - Family first, then friends (never rivals), gather in a ring and dance; the couple stand in
    the middle with hearts. Petals fall.
  - The banner shows a "Watch" button. There are no toasts, because relationship news belongs on
    the Story page.
  - Guests grow closer, and the village is happier for half a day.
  - Couples from old saves count as already married.
- **Town rank** (`celebrations.js`): Hamlet → Village → Town → City.
  - Each rank has 5–6 goals with progress bars and tips, shown in the Town panel. A "Become a …"
    row joins the quest panel when the quests run low.
  - Promotion brings fireworks over the square, gems (10/25/50), a day of good cheer, and the
    `crestbanner` model by the campfire, recoloured and enlarged per rank.
  - `stats.dragonsRepelled` and `stats.raidsRepelled` were added for the City goal.
- **The chronicle** (`celebrations.js`):
  - Every 12 days (a year), the year is bound into a parchment page: villagers then and now,
    births, weddings, wishes, buildings, festivals and hard times, and up to five dated
    headlines with faces. The year gets a name ("the Year of the Dragon", "the Year of Weddings"…).
  - Headlines are kept in a per-year buffer, because the Story keeps only 150 entries.
  - The Journal has a Chronicle tab, with "this year so far". It badges when a new chronicle is
    written.
- **Visitors at the gate** (`visitors.js`):
  - At most once a day from day 3, someone walks up the road to the campfire with a bubble over
    their head:
    - a family fleeing a disaster (they move in as a household);
    - a bard (20 coins: an evening of song, joy and calmer tempers);
    - a scholar (40 coins: +30 knowledge and a head start for the studious);
    - a hooded stranger. Half a day later the stranger is revealed: a hero (a level-3 fighter or
      ranger) or a pickpocket trying to go straight.
  - Each visitor is one Welcome / Turn away choice in the banner. "No" is always harmless.
- **Shared plumbing:**
  - `lifeui.js` holds the panels and the banner rows. `events.js` hands it `lv-` clicks, and its
    banner takes rows from `ui.lifeRows()`.
  - `lifeview.js` draws the pets, visitors, petals, music notes, crest banner and fireworks.
  - On phones the banner hides while a panel is open.
- **Art** (Blender agent, `build_pets.py` and `build_banner.py`):
  - `cat` and `dog`: nodes body, head, tail and leg0–3; slots fur, fur2, nose and eye, plus
    collar and gold on the dog. Fur is recoloured per pet. The sit pose is set in code.
  - `crestbanner`: a stone plinth with a garland, the pole, and a swallowtail banner with a tree
    emblem. It waves from `anim_flagMesh`.
- **Tests:** `tests/round13.test.mjs` has 14 tests, covering the wish lifecycle, treats, pets and
  re-homing, the wedding flow and no-toasts rule, old-save couples, rank promotion, the
  chronicle, all four visitors, and a 13-day run. All 95 tests pass.

**Fresh-village playtest** (port 8780, its own save):
- The first wish came on day 2 and was granted by building a Park.
- The village rank came on day 5.
- The first visitor came on day 3. Five came in 11 days.
- Fixed from the playtest:
  - Wishes for buildings not yet unlocked.
  - Wishes during the tips.
  - Pet wishes crowding out the rest (12 pets by day 6).
  - Two weddings on one night.
  - Treat wishes for goods not in store.
  - Long, repetitive banner text.
  - Oversized music notes.
  - The phone banner covering the villager panel.

## Round 14 — the HUD redesign, with a critic loop (2026-10-05)

The game had outgrown its first toolbar, so the HUD was rebuilt around one rule: every part of
the game has one obvious home.

- **Main bar (bottom):** five labelled places.
  - Build (key B): Build and Decorate are two halves of one tray, switched on a dark track; G
    still opens Decorate.
  - People (V): Villagers, Jobs, Buildings.
  - Town (T): rank and goals, government, treasury, safety, wanted posters, plus a **Stores**
    tab (the old Inventory, also key I).
  - Journal (N): Story, Chronicle, News, Achievements, Festival.
  - World (M): the map, plus a Trade tab once you have 2+ settlements.
  - Each place opens its window on the page with something waiting, and the current place is
    underlined.
  - Windows sit between the top bar and the main bar (`--topspace` / `--dockspace`), so the main
    bar stays usable and switches sections while a window is open.
- **Top right:** only Home, Shop (gold) and Settings stay fixed.
  - Things that come and go (gift chests, the festival, the spell book) are labelled
    "right now" chips (`#nowbar`) to their left, so the fixed buttons never move.
  - On phone they stack above Home/Shop/Settings.
  - The old World and Shop corner buttons, the phone side column and the 4–6 unlabelled round
    icons are gone.
- **Signal rules:**
  - **Gold** = something for you, or the main action: counts, NEW tags, Claim, Welcome, Hire,
    Give, Settle, Watch.
  - **Cream ghost** = decline or neutral: Turn away, No thanks, Show, Follow, Visit, Move.
  - **Red** = problems only (FULL, wanted posters, fires, the close button).
- **Badges:**
  - Build gets a gold pip for new buildings. In the tray, new cards come first with gold NEW
    tags, and the category tabs holding them carry pips.
  - Journal's count is the achievements to claim plus a new chronicle, matched by the tab
    counts inside. A dot means the Story has unread entries.
  - Town gets a red count for new wanted posters.
  - The quest header shows a count only when folded. The festival chip has no count, because
    its rewards are claimed from the quest panel.
- **Calmer top band:**
  - Banners show one at a time, in order: danger, then choices waiting (visitors, weddings),
    then the rest. A "+N" pill expands the list.
  - Visitor titles are short.
  - On laptops and phones the clock is one row.
  - The main bar is about 15% larger.
- **Tray:** both scroll rows fade at the edges and get arrows. On phone the categories are
  icon-only (the selected one keeps its name and count), the Build/Decorate switch is
  icon-only, and "All" has its own grid icon.
- **Panels:**
  - The villager panel shows the wish card right under the chips, and its Follow / All
    villagers footer is sticky.
  - Name and rename pencil sit on one line.
  - Every dropdown is a cream pill with a brown chevron.
  - Locked governments stay readable (dashed outline, muted text).
- **Town rank card:** a labelled ladder (Hamlet → Village → Town → City). Unmet goals come
  first, each with a how-to and a jump button ("See the wishes ›", "Build one ›"). Completed
  goals collapse to ticks.
- **Phone:**
  - Windows open below the two-row resource bar.
  - The banner reads title and message first, then the choices, and moves above the tray. It
    hides while placing or while a panel is open.
  - Gift-chest pointers stay off the panel, and the Quests header stays beside the clock.

**Critic loop** (a HUD/UX lead for cozy builders; pass mark 8.5; 1280×720 first, phone
second): **7.3 → 8.3 → 8.5, passed on attempt 3.**

Applied after the passing verdict, without re-scoring:
- the phone tray keeps the selected category's name;
- the phone banner's "+N" moved to the choices row;
- locked government text was darkened.

The critic's remaining notes, all minor:
- slivers of the right-edge chips peek out beside a phone window;
- the phone tray's Back column costs about one card of width;
- the clock card's top edge doesn't line up with the Quests header and banner.

Note: the preview pane pauses `requestAnimationFrame` while it's in the background, so the HUD
can look half-drawn in a screenshot taken right after load. Take a second screenshot.

## Deploying: cache-busting (2026-10-06)

isaiart.com is GitHub Pages behind **Cloudflare**, which caches `.js` files for 4 hours but
serves `index.html` fresh. The first deploy of rounds 7–14 broke the live game:

- A fresh page ran with Cloudflare's stale `ui.js`.
- The error was "Cannot set properties of null (setting 'innerHTML')".
- Cause: the old code filled in a Journal button the new page no longer has.

**Fix:** `tools/stamp.mjs` writes an import map into `index.html`.
- Every module, `three`, and the two model files load as `file?v=<content hash>`.
- A changed file always gets a new URL; unchanged files stay cached.
- `main.js` is now imported from an inline module so the map applies to it.
- `blender.js` reads the model fingerprints from `window.__villagesV`.

**Rule:** after changing any `js/` or `models/` file, run `node tools/stamp.mjs`.
`tests/stamp.test.mjs` fails if the stamp is stale.

## Round 15 — snow pass, peek inside, expeditions on the map, and a performance pass (2026-10-06)

Nine items, three critic loops (A visual art lead, B lead designer, C staff graphics engineer), 3 attempts each,
pass mark 8.5. None passed: A 6.3 → 7.4 → 7.8, B 6.6 → 7.2 → 7.5, C 6.0 → 7.6 → 7.7. Their remaining notes are
under "Next round".

**Visual polish (critic A: 6.3 → 7.4 → 7.8).** Flat painted kerbs to match the cobbles. Bucket water is
three soft-rimmed drops a throw, the dragon's breath a stream of chunky flame tongues pointed along the
flight, and the wanted villager's bubble a parchment poster with a red border. Seasonal clothes: straw
hats in summer, and in rain a third of villagers wear a yellow raincoat with the hood up while the rest
hold an umbrella, which is baked as a rigid prop held in the left fist.

**Welcome back** (`lifeui.js welcomeBack`). On load, if two or more Story entries are unread: a parchment
card with counts (babies, weddings, wishes granted, newcomers, hard times), the top four headlines, and
"Read the Story" / "Carry on". The event bar and toasts hide while it's open, and a visitor at the gate is
mentioned inside it.

**Expeditions on the World map** (`expmap.js`). Every expedition has a site on the map's rim
(`EXP_SITES`). A party walks a bold dashed trail out from the Guild Hall (`expLeg`: out for the first 30%
of its time, camped for the middle 40%, home for the last 30%). The trail bows away from towns and water,
and at the site the party pitches a tent by a campfire. The caption under the map tells the story without
dice rolls (`storyBeat`) and says when they'll be home.

**Peek inside a home** (`peek.js`, `roomplan.js`). Select a house: the roof floats up and fades, the door
fades, and the walls are clipped at 42% of the eave height like a doll's house. The room is found by
dropping rays onto the wall volumes (each grid cell counts the volumes over it, so a rectangle of one
count never crosses a wall). Beds go in the biggest room, a straw bedroll in the next for anyone without
a bed, then the table, a pot-bellied stove with firelight, and a chest in any room left bare. Whoever is
home appears inside at room scale: asleep under a quilt with a zzz, or round the table. The family pet
curls up on its owner's bed, lit by the stove. Lamplight glows at night.

**Frostpeak Pass** (`frost.js`). A sixth settlement, tucked into the map's emptiest corner and snowbound
all year (a `uFrost` term in every snow shader; drifts with cool hollows). Craggy snow-capped peaks stand
beyond the map edge (`view.buildPeaks`), and the classic map's ridges are raised.
- Old saves: the base map's trees are untouched (the glade is felled when you settle). Ridge heights are
  rebuilt on every load, and `frost.raised` records the corners it changed, so `round8`'s fixture test
  still proves the rest of the classic map is byte for byte the same.
- Specialty: miners break 20% more stone and dig up iron ore.
- Dangers: each night it burns 1 wood per settler from its own woodpile (a chip in the region bar shows
  nights left, opens trade routes, and warns at dusk). Running out makes everyone cold, and wolf packs
  come down from the peaks.

**Performance** (critic C: 6.0 → 7.6 → 7.7, below the 8.5 bar). Measured with `tools/devkit.js` `perfScene()` (40 buildings, 64
villagers) and `callsBy()` (draws per category, main pass and shadow pass), A/B against
`sessionStorage.villagesPerfOff = '1'`.
- Villagers (`models.js bakeVillager`, `batch.js`): each rigid part (body, head, limbs, plus the tool,
  umbrella, sack, wizard hat and bedroll) is baked to vertex-coloured geometry, in full and without the
  tiny details for far views. Every part of every villager draws from two `BatchedMesh`es. Originals stay
  in the tree on layer 31 (never drawn) so dressing still toggles them. Rebakes are capped at 6 a frame
  (`bakeBudget`), so rain ripples through a crowd instead of hitching. Eyes stay unlit via an `unlit`
  attribute.
- Buildings: once settled (built, not upgrading, popping, damaged, burning, being moved or peeked into),
  a building's static meshes become instances in one `BatchedMesh` per material for the whole town.
  `applyLevel`/`applyProsperity`/`removeBVis` drop it out first, only when they're about to change it.
- Blob shadows and chimney smoke: one instanced mesh each (smoke fades via a per-instance `aOp`).
- Forest: far chunks draw ~60-triangle stand-ins (`treeLod`, nearest-edge distance with hysteresis). Every
  chunk's shadow comes from a stand-in twin on layer 2, which the camera only sees while the shadow map
  renders (`shadowMap.render` is wrapped).
- Scene matrices update once a frame, just before the batches copy them (`matrixWorldAutoUpdate = false`).
- Paired A/B, distance 30: desktop 2,098 → 351 draw calls, 2.89M → 2.19M triangles, median 19.5 → 16.3 ms;
  phone (375×812) 1,745 → ~267 calls, 2.29M → 1.63M triangles, median 17.4 → 15.6 ms. In rain with
  umbrellas up: 244 calls.
- Known remaining wins: ~97 building batches (one per material) could fold into ~15 by baking colours, but
  window glow, lamps and seasonal palettes change material colours at runtime, so each material would
  need a "static" tag first. Also untested: BatchedMesh without WEBGL_multi_draw on real phones.

After the last reviews (not re-scored): tools and the sack were taken back out of the villager bake
(they change every work step; rebaking them caused spikes and a stale sack colour), flat-shaded props keep
their facets, forest chunks draw only their used slots (empty spare slots were ~0.6M wasted triangles:
desktop now ~1.56M triangles, ~350 calls), batching switches itself off where WEBGL_multi_draw is
missing (`perf.js BATCHING`; three.js would otherwise draw per instance), grown instanced meshes are
disposed, sleepers lie flat again, and a travelling party stops short of its site's medallion.

Tests: `tests/round15.test.mjs` (expedition legs and sites, story beats, room layout across walls,
Frostpeak's site, firewood, wolves and ore). The dev kit `tools/devkit.js` stages scenes, steps frames
in a hidden preview, and magnifies regions of the frame for inspection.

## Workers go inside (2026-10-06)

Workshop staff no longer stand at the wall of their workplace: a work task at their own building now
walks to the door and the worker is indoors while working (`Sim.workInside`, called from `setTask`).
It covers every job in `indoorJob()` (miller, baker, cheesemaker, brewer, innkeeper, teacher,
scholars, students, professors, wizards, bathhouse, theatre and chapel staff). The sawmill, forge,
weaver and stonemason keep their staff outside (`WORK_OUTSIDE`), because their workbench (the saw,
anvil, loom, mason's bench) stands out front. `v.inside` records which building someone is in, so
a home's peek only shows people who are actually there, and a friend working next door doesn't drop
work to chat. Tests: `tests/workinside.test.mjs`.

## Education gates the skilled buildings (2026-10-07)

Nobody starts or arrives schooled, so a workplace whose job needs schooling (Wizard Tower, Forge,
chapels and temples, the University) used to unlock long before anyone could work there, and the
Schoolhouse could not even hire its first teacher. Now:
- Teachers need no schooling (a schooled teacher still teaches better), so the Schoolhouse works.
- `schoolGate(type)` (education.js) locks those workplaces until a Library stands or someone is
  already schooled enough. The build card shows "Needs a Library"; placing is refused with the reason.
- The Wizard Tower moved from level 4 to 7, after the Library (6) and before the University (8). Its
  description now lists the two disciplines that exist (Research, Nature).
Tests: `tests/progression.test.mjs`.

## Magic goods: crystals, the Scriptorium and the Enchanter's Forge (2026-10-07)

- **Arcane Crystals** (new raw material, teal so they don't read as gems): quarry miners find 1-2 in 30%
  of loads once a Wizard Tower stands (`rpgOre` wrap), about 2.5 a minute from one quarry; expeditions
  to the Barrow, the Old Dwarf Mine, Wisp Marsh and the Dragon's Nap bring more.
- **Scriptorium** (level 7, needs a Library, 2 schooled scribes): 1 cloth + 1 crystal → 1 Spell Scroll
  (a plain converter, `CONVERT.scribe`; scribes work indoors). Crystal priority is a toggle on the
  Enchanter's panel: "Enchanter first" (default) makes scribes leave the last 2 crystals whenever the
  enchanter has everything else for an item (`enchanterWantsCrystals`, the converter's new `hold`);
  "Share" lets both take crystals as they come. The panel compares quarry income with what this
  enchanter uses at their own work speed (`enchantUse`).
- **Enchanter's Forge** (level 8, needs a Forge and a Wizard Tower, 1 enchanter with Honours, costs 6
  crystals): Runeblade (sword + 2 crystals), Wand (plank + 2), Warding Amulet (iron bar + 2). Auto
  makes whatever there is least of and always leaves 2 swords and 2 iron bars for the armory; the
  smith's Auto keeps 2 more swords while an enchanter works (`enchantDemand`). Items take 24-30s. The
  enchanter works outside at the rune anvil; the crystal above it bobs and spins (`anim_float`).
- **Magic gear**: a fourth gear slot `gear.m`. A Runeblade is an enchanted longsword: melee only,
  longsword dice, +1 to hit / +2 damage on top (the same in `classAttack` and `guardAttack`). A Wand
  gives +1 to hit or DC / +2 damage on real spells only. An Amulet gives +1 AC and +1 to saves.
  `magicWants` picks per class and weapon: archers take an amulet, a bard with a rapier a runeblade.
- **Scrolls on expeditions**: a party takes up to 2 (shown on the Guild Hall's Set off button).
  Burning Hands opens a fight against 3+ foes (3d6, DEX save DC 13 for half, credited to the reader),
  Bless one against a tough foe (20+ HP: +1d4 to attacks that fight), Guidance adds +1d4 to a check
  that missed by 4 or less. Unread scrolls come home.
- The market sells scrolls and magic items by default above a reserve of 2 (which stays home for
  adventurers); crystals stay unsold unless you switch them on. The Market Stall now sells the batch
  worth the most (up to 8 of one good) rather than whichever good it has most of, so a single
  Runeblade isn't stuck behind a heap of food. Guards with a bow take an amulet, not a runeblade.
- Building prerequisites: `needs: [...]` in a building's definition, checked by `Sim.gateOf` (also
  covers the Library gate); the build card shows what's missing.
- Models: `blender/build_works7.py` (`build_scriptorium`, `build_enchanter`), a new glowing `arcane`
  material slot. Exported through the Blender MCP; the other 96 models came out identical.
- Icons are drawn SVGs for now (`magicui.js`); `art/BRIEF.md` phase 6 asks for painted ones.
Tests: `tests/magic.test.mjs`.

## Survival: villagers who leave, and a Harsh mode where they can die (2026-10-07)

Until now only old age removed anyone, and nothing a player did could make the village shrink.
`js/hardship.js` adds consequences, set by the Town panel's Hard times setting:
- **Gentle and Normal (the default):** a grown-up who is hungry, freezing, without a bed in winter
  or in a village under 25 happiness for a whole day starts *thinking of leaving* (a bag over their
  head, a toast, and a note in their panel saying why and how long is left). Put it right and they
  stay; otherwise a day later they walk out of the gate. A partner who's also had enough goes too,
  and young children go with them if no parent is staying. Leavers are counted (`stats.left`,
  `s.leavers`) but not mourned or given a gravestone. **Off** turns it all off.
- **Harsh (new):** more hard times (event roll 0.5), and they can kill. A day without food makes
  people sick and a day and a half can kill (sooner for children and elders); a winter night by the
  fire or a freezing night in the pass chills them sick; sickness can take the old and young, and
  in time anyone. A villager knocked out makes D&D death saving throws (every 2 s; a cleric or
  paladin within reach steadies them). On expeditions the fallen make death saves each round, a
  healer spends a heal to pull them back, and the dead don't come home. When the last villager is
  gone the village has fallen: no more newcomers or visitors, and an epitaph with a "start again
  on this map" button.
- `Sim.passAway(v, how)` now takes a cause (age, hunger, illness, cold, wounds, with a place) or
  `left`. The chronicle counts the year's farewells and leavers; the story's Milestones list leavers.
- A year of villager age is now 2 minutes (YEAR 180 -> 120), so a long session sees a generation.
Tests: `tests/hardship.test.mjs`.

## Next round — pick 5–6

Critic leftovers from round 15:
- Peek: sleepers tucked under a quilt to the chin; the stove's glowing mouth toward the camera with its
  light pool in front; a door remnant still stands in the doorway on some cottages.
- Frostpeak: rock crags and outcrops in the pine belt so the pass reads as mountains at play zoom; darker
  lower flanks on the peaks.
- Map: a bigger World map so the camp and fire read; the tutorial tip can cover the woodpile chip.
- Performance: fold the ~97 building batches into ~15 by baking colours (needs a per-material "static" tag
  first, since window glow, lamps and seasons change colours); a per-type forest BatchedMesh (~160 → ~10
  calls); profile the per-frame batch sync on a real phone; check iOS Safari.
- Visual: umbrellas sit high; dragon flames; rain cues and wet ground.

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
| `js/events.js`, `eventsview.js`, `classduties.js` | Hard times (fires, fever, raiders, spirits, dragons), their visuals, class duties |
| `js/wishes.js`, `celebrations.js`, `visitors.js` | Wishes and pets; weddings, town rank, the chronicle; visitors at the gate |
| `js/lifeui.js`, `lifeview.js` | Their panels and banner rows; pets, visitors, petals, crest banner, fireworks |
| `tests/round8.test.mjs`, `tests/round9.test.mjs`, `tests/round10.test.mjs` | Save compatibility and gameplay/board integration checks |
| `js/expmap.js` | Expeditions on the World map: sites, the party's trail, camp and captions |
| `js/peek.js`, `js/roomplan.js` | Peek inside a home: roof lift, wall cut, furniture layout, family and pet |
| `js/frost.js` | Frostpeak Pass: the site, ridges, glade, firewood, wolves and the iron-ore specialty |
| `js/hardship.js` | Villagers who leave; Harsh mode: hunger, cold, sickness, death saves, a fallen village |
| `js/magic.js`, `js/magicui.js` | Magic goods: crystals, the Enchanter's Forge, magic gear, scrolls; their panel and icons |
| `js/batch.js`, `js/perf.js` | Draw batching for villagers, buildings, blob shadows and smoke; the A/B switch |
| `tools/devkit.js` | Dev-only helpers: staging scenes, stepping frames, magnify, perf and draw-call breakdowns |
| `blender/*.py` | Model scripts; `cli.py` builds, previews and exports them |
| `vendor/three.module.min.js` | Three.js r170 (MIT) |

Saves live in `localStorage` under `isaiart.villages.v1`.
