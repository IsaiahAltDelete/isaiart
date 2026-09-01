# Sword Coast Chronicles — where to pick up
Updated 1 Sep 2026, end of the Baldur's Gate build session.

## State: playable, consistent, verified
- 82 maps, 166+ warps, all build; console clean; `node tools/stamp.mjs --check` passes.
- 186 NPCs / 185 dialogue trees, zero dangling references.
- Baldur's Gate: 16 districts (Outer/Lower/Upper + sewers) + interiors. Verified by
  flood-fill; districts visually distinct (mud shanties vs harbour vs flagstone).
- Road south: 32 maps, Waterdeep -> Daggerford -> Dragonspear -> Beregost ->
  Friendly Arm -> Candlekeep -> Nashkel. Wired at both ends.
- Teleport: Pause -> Cheats -> TRAVEL (43 destinations, grouped, level-banded).
  Typed codes: xyzzy god ghost calm nofight heal home coin boost unfog keys onehit freecast.

## Unfinished (in order)
1. FINAL GATE never ran: walk Phandalin -> Waterdeep -> south road -> BG Outer ->
   Lower -> Upper and back, verifying every warp pair in the live game. The workflow
   script is `workflows/scripts/swordcoast-baldursgate-wf_463e57c6-623.js`
   (resumeFromRunId wf_463e57c6-623); only `gate` + remnants re-run, rest is cached.
2. Cast agent was stopped mid-run. Its own verification (id cross-check of
   npcs_south/dialogue_south vs charter quests/shops) did not complete — spot-check
   a few southern shopkeepers open their shops and quest-givers offer quests.
3. Southern quests reference the charter chain — untested end-to-end in play.
4. Known cosmetic: Neverwinter quay scallop is periodic (lag-16 ~0.49); WOOD_FLOOR /
   BONE_FLOOR grid ratio >1.2 (legit plank art, low priority).

## Architecture notes for whoever continues
- Region packs: world/maps_south.js + maps_baldursgate.js export REGION_MAPS +
  REGION_LINKS; maps.js merges them. New regions = new pack file, no core edits.
- The southern charter (canon layout, cast, connection table) is reproduced at the
  top of the workflow script above.
- Painting helpers in maps.js are module-private BY DESIGN; packs carry copies.
- Never renumber tile ids (append only). Always run node tools/stamp.mjs after edits.
