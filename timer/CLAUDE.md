# /timer — the Pixel Tide Timer

A countdown whose scene fills with water as time runs out. Every creature and
prop is pixel art authored as **text**, using [pixelforge](../pixelforge/),
which lives in this repo at `pixelforge/files/`.

## The one rule

**`timer/sprites.js` is generated. Never edit it by hand.** Edit the `.pxa`
grid, then rebuild:

```sh
python3 timer/build_sprites.py
```

It runs pixelforge's `validate` on every grid and refuses to write if one is
ragged or uses an undefined palette key, so a broken sprite cannot reach the
page. If you edit a sprite and see no change in the browser, you forgot this.

## Layout

| path | what it is |
|------|------------|
| `sprites/*.pxa` | the art — palette + ASCII grid. The source of truth. |
| `sprites/PALETTE.txt` | the shared `@palette` block every sprite embeds |
| `sprites/README.md` | frame list per sprite, and how the reef is generated |
| `build_sprites.py` | `.pxa` → `sprites.js` |
| `sprites.js` | generated sprite table, loaded by a plain `<script>` tag |
| `index.html` | the page: sprite bank, scene renderer, timer logic |
| `archive.html` | an old, unrelated version of this page. Leave it alone. |

## Authoring a sprite

The loop that works — `preview` is the point, because it puts numbered rulers
on the art so a flaw maps to an exact `(x, y)` you can edit:

```sh
PX=pixelforge/files/pxforge.py
python3 $PX new      timer/sprites/eel.pxa --size 24x11 --frames a,b,c
python3 $PX edit     timer/sprites/eel.pxa --all --fellipse 6,3,17,5=B --autoshade "ABC,tl" --outline K
python3 $PX preview  timer/sprites/eel.pxa   # render this, LOOK at it, fix, repeat
python3 $PX ascii    timer/sprites/eel.pxa -n
python3 $PX validate timer/sprites/eel.pxa
```

Order matters when building a shape: draw all the fill first, then
`--autoshade`, then `--outline K` **last**. Outline grows into empty cells, so
running it twice thickens the border; adding a fin after outlining leaves it
unoutlined.

New sprites must embed the palette from `sprites/PALETTE.txt`. `new` writes
`@use chr16` — replace that line with the palette block.

## Conventions that the page depends on

- **Semantic palette keys.** Fish use `A`/`B`/`C` for body dark→mid→light and
  `D`/`E` for fins. The page swaps those keys at bake time, which is how four
  fish files produce fourteen tropical colourways (`colorways` in `index.html`).
  A new fish that uses different keys will not recolour.
- **Sprites face right.** The renderer flips horizontally for leftward motion.
- **Draw at 1x only.** Doubling a sprite doubles its pixel size, so a 2x fish
  reads as a different resolution, not a nearer one. Size variation comes from
  drawing a bigger sprite. This was tried and reverted.
- **Golden-ratio placement.** Reef items and fish lanes are positioned by
  `goldenAt(i)`, because any *prefix* of that sequence is evenly spread — the
  shoal and the reef are both trimmed on small screens by dropping the tail of
  the list, and index-based spacing put every survivor on the left. Don't
  replace it with `i / count`.
- **Depth is alpha.** `shoalLayers` gives far fish low alpha and slow speed and
  draws them behind the reef. Low alpha over water tints them toward the water
  for free, so this follows the water theme without a second palette.
- **Headroom gates the reef.** `reefItem(i, back, headroom)` filters the `flora`
  pool by sprite height, so shallow water grows shells and grass and the kelp
  only appears once the tide is deep enough. That is what keeps low tide from
  looking like a hedge.
- **Degrade gracefully.** If `sprites.js` fails to load, the timer must still
  keep time — the sea just goes empty. Don't put timer logic behind a sprite
  lookup.

## Do not touch without being asked

- **The countdown digits.** They are Silkscreen from Google Fonts, deliberately.
  A previous session replaced them with pixel glyphs; the owner asked for the
  original back. Leave `#countdown` alone unless the request is explicitly about
  the numbers.

## Gotcha: fonts in cloud sandboxes

Claude Code's remote sandbox blocks `fonts.googleapis.com`. Screenshots taken
there render the whole HUD in fallback monospace, which looks wrong and is not
a real bug. **Do not redesign anything based on a sandbox screenshot of text.**
Check `document.fonts.size` before trusting one. Running locally avoids this.

## Looking at the result

There is no build or dev server. Serve the repo root and open `/timer/`:

```sh
python3 -m http.server 8931      # then http://127.0.0.1:8931/timer/
```

For a scripted look, Playwright with a pinned clock is what previous sessions
used — override `Date` in an init script to force a time of day, since the sky,
the gulls and the lighthouse beacon all key off the local hour:

```js
await page.addInitScript(`(() => {
  const fixed = new Date(2026, 5, 12, 21, 24, 0), Real = Date;
  class Fake extends Real {
    constructor(...a) { return a.length ? new Real(...a) : new Real(fixed.getTime()); }
    static now() { return fixed.getTime(); }
  }
  window.Date = Fake;
})()`);
```

Worth checking on any scene change: **day / dusk / night / dawn**, **desktop
and 390px portrait**, **0% and 100% water** (drive a 4-second timer to get to
100% and to open the chest), and **`sprites.js` blocked**.

## Ideas not yet done

- A shipwreck or pier piling as a large mid-ground silhouette; the middle of the
  water column is empty at high tide.
- Fish reacting to the completion chime — a scatter, or a school turning.
- Weather: the rain falls in every scene, including bright noon.
- The lighthouse and shore submerge at 100%. Intentional, but worth a look.
