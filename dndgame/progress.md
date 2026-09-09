Original prompt: make visual improvements to the game / pixel stylization, characters, buildings, animations, npc variation

2026-09-06: Inspecting the existing procedural pixel art. NPC palettes currently bake literal colors and ignore authored colorway seeds. Plan: preserve the established 16x24 silhouettes, add deterministic NPC style variants, repair palette resolution, enable staggered idle frames, and enrich facade and chimney art. Visual and movement checks will use the web-game Playwright client.

Completed visual pass:
- NPC palettes now resolve authored seeds and preserve profession defaults. Civilian dyes and three style variants per NPC family are stable by identity; species and equipment remain intact.
- Added satchel pixel source and generated runtime layer. Rebuild with node scripts/build-satchel.mjs. PixelForge preview inspected and source validated.
- Activated staggered idle poses and brief blinks; added flower-box windows, colored shutters, warm animated panes and clustered chimney smoke.
- Fixed cloth/horn appearance cache signatures and supplied render_game_to_text/advanceTime test hooks.
- Visual QA: output/visual-pass/final-town.png, gallery.png, dialogue.png and final-movement/shot-{0,1}.png inspected. Movement, pause/resume and NPC conversation passed; no render failures or final client console errors. Palette pixels and idle pixels differ as expected; 102 variant definitions validated; repeated NPC identity resolves consistently.
- The skill's Playwright client was copied to output/visual-pass with only local runtime/Edge launch adaptation and seeded campaign setup. Bundled Chromium is unavailable; headless Edge required sandbox escalation and ran successfully.
- No outstanding blockers. Verification covered Phandalin and representative sprite families, not every map in the campaign.

Completed HUD / toolbar pass:
- User request: improve combat and overworld toolbars, make them feel alive, put the minimap at the top, compact the player card to the side, and move time to top left.
- Overworld: clock/date/weather/purse upper left; minimap upper right; 86px party rail on the left with portraits, HP, AC/slots and conditions. Quest/log avoid the rail and the full-width bottom toolbar. Location banner and notifications use separate top-centre rows.
- Toolbar: taller plates, readable verbs, icons and key labels, color-coded readiness, hover shimmer, activation flashes, and hover clearing when the pointer leaves. Buttons and hit-testing share the same layout.
- Combat: taller labeled actions, Tactics submenu for situational actions, visible Action/Bonus/React budget, dedicated End Turn plate. Keycap labels now reflect actual shortcuts (1 Attack, 2 Spells, 3 Items, 4 Move, 5 End Turn). Registered and wired K for the overworld spellbook.
- Added combat phase/budget/actions to render_game_to_text.
- Validation: all four menu shortcut buttons and I/K/M/P keyboard shortcuts; Tactics open/back; movement targeting; Dodge applied and consumed the action; End Turn advanced to Goblin. Full party, quest, notifications, empty slots, hover and combat screenshots inspected. No page/console/render errors in successful final runs.
- Final skill-client checks: output/hud-pass/final-walk and final-combat; screenshots and JSON inspected, no error artifacts. More detailed UI screenshots: output/hud-pass/party.png, battle.png, tactics.png, spent-action.png.
- Resumed after an approval-review usage-limit block. Corrected a missing spells entry in the input action registry found by the keyboard test. No outstanding blockers.
- Playtest server restarted at http://localhost:5173 using output/hud-pass/serve.py (loopback only, quiet logging, larger request queue). Refresh the browser to load the updated modules.

Resolved stale browser HUD:
- The user's actual in-app tab still displayed the old HUD despite fresh-browser tests. index.html's content-hash import map had not been regenerated after the source edits.
- Ran tools/stamp.mjs and --check: all 74 modules are now stamped correctly, including the added satchel module.
- Used the actual in-app browser UI to save the current Mororon campaign into previously empty Slot 1, reload, and Continue Slot 1. Visually verified the user's own game now shows top-left clock, compact left party card, top-right minimap, and expanded bottom toolbar.
- REQUIRED finishing step after future src changes: run the bundled Node runtime on tools/stamp.mjs, then tools/stamp.mjs --check. Fresh-browser screenshots alone do not verify existing-tab cache invalidation.

Medieval compact-layout revision:
- User preferred the original minimap/time positions and disliked oversized Look/Attack buttons. Restored minimap bottom-right and time/purse top-right; compact party cards are top-left.
- Replaced two 74px verbs with one 56px contextual control in a 300x24 toolbar. E uses the object ahead (Talk/Open/Enter/Read/Fight); holding Shift while facing a creature switches the control to Attack, including the existing crime eligibility/refusal rules. Empty ground is a quiet disabled Explore state.
- Added shared ui/ornament.js for pixel wood/leather frames, brass edging and rivets; applied to HUD, overworld toolbar, combat toolbar, budget, detail card and initiative rail. Reviewed imagegen skill per user offer; code-native pixel frames are appropriate here, no generated raster asset needed.
- Validation: skill-client overworld/combat captures, full-party HUD, all four mouse/keyboard menu shortcuts, contextual verb mapping, Talk -> Shift Attack -> Talk, and actual contextual click opening dialogue. No console/page errors. Screenshots in output/medieval-pass inspected.
- Ran tools/stamp.mjs and --check (75 modules). Reloaded the user's actual in-app tab from its title screen, continued the newest save, and visually confirmed the restored corners and compact medieval belt in Mororon's campaign.
