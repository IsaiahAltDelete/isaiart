# Sword Coast Chronicles — where to pick up
Updated 1 Sep 2026, after the post-Baldur's-Gate verification pass.

## State: playable, verified end to end
- 82 maps, 166 warps — ALL 166 verified in both directions: warp tile walkable,
  landing tile walkable, return warp present and reachable by pathfinding.
- Phandalin -> Baldur's Gate Upper City walks in 11 legs, and back again:
  phandalin -> neverwinter-wood -> neverwinter -> waterdeep -> trade-way-north ->
  daggerford -> the-way-inn -> trade-way-south -> fields-of-the-dead ->
  coast-way-north -> bg-blackgate -> bg-the-wide
- 186 NPCs / 185 dialogue trees, 0 dangling goto, 12 southern shopkeepers and
  10 quest-givers all resolve. 86 quests. 177 spawned entities all on walkable tiles.
- Console clean, `node tools/stamp.mjs --check` passes (70 modules).

## Fixed in this pass
- applyWarpNodes now clears INCOMING landing tiles, not just the tile you step on.
  A scattered prop had sealed the road out of Rosymorn Monastery; the fix is
  structural so no future region pack can reintroduce it.

## Verified NOT bugs (don't re-chase)
- undermountain / dragonspear-castle / rosymorn-cloister / nashkel-mines /
  bg-sewers / tumbledown-crypts look "orphaned" to a WORLD_NODES graph walk
  because their exits are created by their own builder at load time
  (toXY: null = procedural). Each has a working warp back to its surface map.
- 5 NPCs sit on solid tiles in the CATALOGUE, but the spawn path already relocates
  them via clearStanding()/safeTile(). Check entities, not npcs.js coordinates.

## Unfinished
1. Southern quest chain untested in actual play (ids all resolve; nobody has
   played through Daggerford -> Baldur's Gate accepting and completing them).
2. Cast agent was stopped mid-run — its own id cross-check never finished, though
   an independent check of the same things passed here.
3. Cosmetic, low priority: Neverwinter quay scallop is periodic (lag-16 ~0.49);
   WOOD_FLOOR / BONE_FLOOR grid ratio >1.2 (legitimate plank/course art).

## Architecture notes
- Region packs: world/maps_south.js + maps_baldursgate.js export REGION_MAPS +
  REGION_LINKS; maps.js merges them. New region = new pack file, no core edits.
- Painting helpers in maps.js are module-private by design; packs carry copies.
- Never renumber tile ids (append only). Always run node tools/stamp.mjs after edits.
- Cheats: Pause -> Cheats, or type xyzzy / god / ghost / calm / nofight / heal /
  home / coin / boost / unfog / keys / onehit / freecast anywhere in game.
