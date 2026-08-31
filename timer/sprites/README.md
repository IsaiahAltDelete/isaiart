# timer sprites

Every creature and prop in the /timer scene lives here as `.pxa` text — a palette
plus an ASCII grid — the format [pixelforge](../../pixelforge/) uses. The grid is
the source; the image is a build artifact.

| file | frames | what it is |
|------|--------|------------|
| `fish-small.pxa` | a b c | the common fish, tail flick |
| `fish-long.pxa` | a b c | sleek fish, forked tail |
| `fish-round.pxa` | a b | puffer |
| `fish-fancy.pxa` | a b | angelfish, trailing fins |
| `jelly.pxa` | a b c | jellyfish, bell pulse |
| `turtle.pxa` | a b | sea turtle, flipper stroke |
| `crab.pxa` | a b | crab, walks the sea floor |
| `seaweed.pxa` | a b c | kelp, sways |
| `coral.pxa` | branch fan brain | three sea-floor variants |
| `kelp.pxa` | a b c | tall stipe with blades, sways |
| `grass.pxa` | a b c | sea-grass tufts, sway |
| `anemone.pxa` | a b c | bulb with waving tendrils |
| `rock.pxa` | big mid small | boulders |
| `urchin.pxa` | big small | sea urchins |
| `shell.pxa` | scallop cone clam | shells on the sand |
| `starfish.pxa` | idle | sea star |
| `chest.pxa` | closed open | opens when the timer lands |
| `boat.pxa` | a b | sailboat on the waterline |
| `sun.pxa` | a b | rays shimmer |
| `moon.pxa` | idle | craters |
| `cloud.pxa` | small wide tall | three drifting silhouettes |
| `bird.pxa` | up mid down | gull, wingbeat |
| `lighthouse.pxa` | dark lit | beacon on the headland, blinks at night |

## Palette

`PALETTE.txt` is the shared `@palette` block every sprite embeds. The keys are
semantic, which is what lets one grid produce a whole shoal: the page swaps
`A`/`B`/`C` (body dark → light) and `D`/`E` (fin dark → light) at bake time, so
`fish-small.pxa` ships in fourteen tropical colourways without fourteen files.

## The reef

The sea floor is not a fixed list. `flora` in `timer/index.html` is a weighted
pool, and item *i* of the reef is picked from it by a hash of *i*, so the same
slot always grows the same thing. Positions come from a golden-ratio sequence,
which is evenly spread for *any* prefix of it — that is what lets the reef add
or drop items with the scene width without reshuffling.

The pool is filtered by headroom, so a shallow tide grows shells, urchins and
grass, and the kelp only appears once the water is deep enough to hold it.

## Editing

Change a grid, then rebuild:

```sh
python3 timer/build_sprites.py        # writes timer/sprites.js
```

To work on one with the real tool — the annotated `preview` is the point, since
it puts numbered rulers on the art so a flaw maps to an exact `(x, y)`:

```sh
PX=pixelforge/files/pxforge.py
python3 $PX preview  timer/sprites/turtle.pxa      # read this PNG, fix, repeat
python3 $PX ascii    timer/sprites/turtle.pxa -n
python3 $PX validate timer/sprites/turtle.pxa
python3 $PX edit     timer/sprites/turtle.pxa --frame a --set 8,4=H
```

`build_sprites.py` runs `validate` on every file and refuses to write if a grid
is ragged or uses an undefined key, so a broken sprite cannot reach the page.
