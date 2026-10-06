# The office

A little 3D office that shows what the coding agents on this machine are doing: one adventurer per
session, typing at a desk while a session works, standing with a sign while it waits for Isaiah, napping
on the couch when it's idle.

- `feed.mjs` (built by Codex, see `CODEX_BRIEF.md`): `node office/feed.mjs` serves
  `http://127.0.0.1:7331/sessions`, a summary read from the Claude Code and Codex session logs.
- `index.html` + `office.js`: the room. Open it from the repo's dev server
  (`http://localhost:8778/office/`), or from isaiart.com/office/ with the feed running locally.
  `?mock=1` shows three pretend sessions so the room can be worked on without the feed.
- `assets/`: KayKit Adventurers and Furniture Bits by Kay Lousberg, CC0 (kaylousberg.itch.io).
- `vendor/`: three.js r170 example loaders (MIT), copied from the npm package.
