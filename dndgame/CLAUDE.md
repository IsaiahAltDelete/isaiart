# CLAUDE.md — handoff for Claude Code

This project moved from an old 2-core laptop to a new PC on 28 Sep 2026. Read
this first, then `README.md` (what the game is), `docs/overhaul/STATUS.md`
(where the work stands) and `docs/OVERHAUL.md` (the plan and its contracts).

## The project

*Sword Coast Chronicles*: a top-down pixel-art RPG in the Forgotten Realms with
a full D&D 5.5e (2024) rules engine. Vanilla ES modules and Canvas2D, zero
dependencies, no build step. The user (Isaiah) has been building it with
Claude for weeks and is in the middle of a large multi-agent overhaul.

## Rules the user enforces (break these and they will notice)

1. **Forgotten Realms canon only.** Never rename the game or invent a setting.
   Places, gods, factions, monsters from published lore.
2. **No invented "fantasy slop" names** (the user rejected "Aetherfall",
   "Manacolony", "Kaelan"). Minor characters take names from the cultures in
   `docs/SETTING.md`, plain and period-correct.
3. **No external asset files at runtime.** Art and sound are procedural code, or
   PixelForge `.pxa` text sources compiled to JS (`tools/pxbuild.mjs`). No npm
   dependencies for the game, no CDNs, no build step.
4. **Old saves must keep loading.** New state goes under new keys created with
   defaults; never rename a saved field; tile ids are append-only.
5. All randomness through `src/core/rng.js`. Data catalogues are frozen.
6. **After any change under `src/`, run `node tools/stamp.mjs`.** `index.html`'s
   import map pins every module to a hash of its bytes; the regression suite
   fails if it is stale.
7. Match the codebase's voice: comments say *why*, in plain prose.
8. No transcriptions of copyrighted music (a Baldur's Gate 3 song was correctly
   declined once). Medieval/Renaissance works are public domain.

## How the user likes to work

- Their direction: "make it feel like a unique project of its own ...
  customizable, unique, and never ending of an adventure." They grant a lot of
  autonomy ("do as you please but make it good"); quality is the bar. They
  judge by what they SEE and HEAR in the game, so look at screenshots.
- They like parallel agent fleets. Two hard lessons from running them:
  - **The account usage limit is the real cap, not hardware.** Twelve Opus
    agents burned a whole 5-hour window in ~40 minutes and all stopped half
    done. About 4-5 agent roles finish per 5-hour window regardless of how many
    run at once, so run ~5 at a time and have them land in increments. Check
    usage (`get_usage` in the desktop app) before a fan-out.
  - **A user message mid-turn can interrupt every in-flight subagent.** Use the
    Workflow tool (resumable) rather than bare Agent calls for long work, and
    make agents commit often.
- They message often and casually ("take a break", "resume", "just end them").
  "Take a break" / "pause" means stop the agents and save everything.

## Setting up this machine

1. Git, **Node 18+**, Python 3 (for PixelForge), and Playwright for the browser
   tools (not a dependency of the game itself):
   ```bash
   npm i -g playwright
   npx playwright install chromium
   ```
2. Keep line endings byte-exact — stamp hashes depend on them. The repo's own
   `.git/config` already sets `core.autocrlf false`; confirm with
   `git config core.autocrlf` (should print `false`).
3. Verify the move:
   ```bash
   git status                     # clean
   git branch | grep overhaul     # the work-in-progress branches are here
   node tools/stamp.mjs --check   # import map up to date
   node tools/regress-run.mjs     # 30 PASS at the time of the move
   node tools/shot.mjs --scenario town --out output/town.png   # then look at it
   ```
   The tools find Node, Playwright and a browser on their own
   (`tools/pwlocate.mjs`; override with `PLAYWRIGHT=` / `CHROME=` / `NODE=`).
4. Play it: `python serve.py 8765`, open http://localhost:8765.
5. Some docs still mention the old laptop's paths
   (`C:/Users/Dizzy/.cache/codex-runtimes/...` for Node/Python, "2-core laptop
   shared by ~8 agents", the browser-slot limit of 2 in `tools/browserlock.mjs`,
   and `.claude/launch.json`, whose preview servers run the old bundled
   Python: change `runtimeExecutable` to `python` or `node` here).
   On this PC use plain `node`/`python`, and raise `SC_BROWSER_SLOTS` if there
   is RAM to spare. Update `docs/OVERHAUL.md` §6 and the fleet scripts' machine
   notes the first time you relaunch.

## Resuming the overhaul

Everything is in `docs/overhaul/STATUS.md`. In short:
- The six fleet scripts live in `docs/overhaul/fleet-scripts/` (Workflow tool,
  pass the file as `scriptPath`). Each role an agent owns is listed in
  `docs/OVERHAUL.md` §5; each role keeps notes in `docs/overhaul/<role>.md`.
- Before relaunching a fleet, replace every role that has already landed with a
  resolved result object (the scripts show how, e.g. `stage` and `kit` in the
  interface fleet), so finished work is not re-run. Queue agents with direct
  `run()` calls in priority order; calls made inside `.then()` callbacks do not
  keep their order.
- Agents work in their own git worktrees (`.claude/worktrees/`, git-ignored)
  and land with `sh tools/land.sh`: merge main in, regenerate the import map,
  fast-forward main. Never commit in the main checkout while agents are landing.
- A stopped agent's branch ends in a "WIP checkpoint" commit; the resumed agent
  branches `-r2`/`-r3` from it and continues.

## Deploying

The game is published at isaiart.com/dndgame from the user's `isaiart` GitHub
Pages repo (on the old laptop: `C:\Users\Dizzy\Documents\GitHub\isaiart\dndgame`).
Copy the project there WITHOUT `.git`, `output`, `__pycache__` and
`.claude\worktrees` (a nested `.git` would break that repo), then commit and
push in the isaiart repo when the user asks.
