# pixelforge

A pixel-art pipeline for Claude. Sprites are **text** (`.pxa`: a palette plus an
ASCII grid), so they can be authored with `Write`, changed with `Edit`, reviewed
with `diff`, and rasterized to PNG/GIF on demand.

Pure stdlib — PNG and GIF encoders are written from scratch. Nothing to install.

```bash
python C:/Users/Dizzy/Documents/Claude/tools/pixelforge/pxforge.py --help
```

## Why this shape

I can't push pixels around a canvas, but I can write and edit a character grid
precisely. So the sprite lives as text and the image is a build artifact. The
loop that actually works:

1. `new` a canvas (optionally over a proportion guide)
2. Write or `edit` the grid
3. `preview` → **`Read` the PNG** → find the mistake by its (x, y)
4. Fix that coordinate, repeat
5. `render` / `sheet` / `gif` for the final output

Step 3 is the point. `preview` draws numbered rulers, a pixel grid and a palette
legend, so a flaw in the image maps back to an exact cell to change.

## The .pxa format

```
@name   knight
@use    chr16          # built-in palette -> key/color map
@scale  12             # default render scale
@fps    6              # default gif rate

@palette               # optional; merges over @use
c #7fd4ff  cape        # <key> <color> [note shown in the legend]

@frame idle            # or a bare @grid for a single-frame sprite
................
.....KKKKKK.....
```

- `.` is transparent unless redefined.
- Every row in every frame must be the same width. `validate` enforces it and
  names the offending row.
- Full-line `#` comments are ignored outside grid blocks.
- Colors: `#rgb`, `#rrggbb`, `#rrggbbaa`, or `transparent`.
- A UTF-8 BOM is tolerated, so PowerShell heredocs into `Out-File` work.

## chr16 — the default palette

Built for character work: ramps are adjacent keys, so shading is `+1`/`-1` on a
character rather than a color decision.

| keys | meaning | keys | meaning |
|------|---------|------|---------|
| `1 2 3` | skin dark → light | `m M` | metal dark / light |
| `4 5 6` | cloth A dark → light | `h H` | hair dark / light |
| `7 8 9` | cloth B dark → light | `W` | highlight |
| `K` | outline | `e` | eye |
| `k` | shadow | `s` | guide grey (template blocking) |

Others: `pico8`, `sweetie16`, `db16`, `edg32`, `gb`, `mono`. List with
`pxforge.py palettes [name]`.

## Commands

| command | what it does |
|---------|--------------|
| `new FILE --size WxH [--template T] [--frames a,b]` | scaffold a canvas |
| `preview FILE [--frame F] [--scale N]` | **annotated PNG for inspection** |
| `render FILE [--scale N] [--bg #hex] [--pad N]` | clean PNG of one frame |
| `sheet FILE [--cols N] [--gap N] [--label]` | all frames as a sprite sheet |
| `gif FILE [--fps N] [--loop N]` | animated GIF |
| `watch FILE [--port N]` | live browser view that repaints on every save |
| `ascii FILE [-n] [--all]` | grid as text; `-n` adds rulers |
| `validate FILE` | row widths, frame sizes, undefined keys |
| `info FILE` | size, frames, color histogram |
| `edit FILE [ops...]` | drawing + transforms (below) |
| `import FILE.png [--grid N] [--max-colors N]` | PNG → editable `.pxa` |
| `diff A B` | list differing cells |
| `palettes` / `templates` | list what's built in |

`ascii -n` works on **invalid** files on purpose — it's the diagnostic tool, and
it marks ragged rows with their character delta.

### edit ops

Applied in the order typed. `--frame` targets one frame (default: first),
`--all` targets every frame. `--dry` prints instead of saving.

Drawing — `--set X,Y=C` `--line X0,Y0,X1,Y1=C` `--rect X,Y,W,H=C`
`--frect` (filled) `--ellipse` `--fellipse` `--fill X,Y=C` (flood)
`--row Y=STRING` `--col X=STRING` `--replace A=B[,C=D]`
`--paste X,Y=FILE[:FRAME]`

Transforms — `--flip-h` `--flip-v` `--mirror l|r` `--rot N` `--shift DX,DY`
`--trim` `--pad L,R,T,B` `--crop X,Y,W,H` `--scale N` `--outline C[,diag][,in]`
`--autoshade RAMP[,LIGHT[,EMPTY]]`

Size-changing ops (`trim`, `pad`, `crop`, `scale`, `rot`) always apply to every
frame, so frames can't drift out of sync.

Frames — `--add-frame NAME[=COPYOF]` `--del-frame NAME`

## Recipes

Block in a character over a proportion guide, then drop the guide:

```bash
python pxforge.py new hero.pxa --size 24x32 --template humanoid32
# ...paint over the 's' cells...
python pxforge.py edit hero.pxa --replace "s=."
```

Symmetric character — draw the left half only, then mirror:

```bash
python pxforge.py edit hero.pxa --mirror l
```

Outline a finished silhouette, then shade it from the top-left. Once outlined,
pass `.K` as the third field so the outline counts as "outside the form" —
otherwise it hides every edge and nothing shades:

```bash
python pxforge.py edit hero.pxa --outline 'K,diag' --autoshade '123,tl,.K' --autoshade '456,tl,.K'
```

Build a walk cycle from an idle pose:

```bash
python pxforge.py edit hero.pxa --add-frame step_l=idle --add-frame step_r=idle
python pxforge.py edit hero.pxa --frame step_l --row "16=.....K444KK....."
python pxforge.py gif hero.pxa --scale 6 --fps 8
```

Recover editable art from a rendered PNG (`--grid` = pixels per art pixel):

```bash
python pxforge.py import hero.png --grid 8 --max-colors 16
```

## Craft notes

- **Silhouette first.** If the blocked-in shape doesn't read at 1x, no amount of
  interior detail rescues it.
- **Few colors.** Three tones per material is usually plenty; `chr16`'s ramps
  are laid out for exactly that.
- **Outline last**, after the shape is settled — `--outline` re-derives it from
  whatever is there.
- **Light from one direction.** Pick it once and pass the same `LIGHT` to every
  `--autoshade`.
- Eyes and any read-critical feature want maximum contrast against what's behind
  them, not "correct" color.

## Gotchas

- In PowerShell, wrap op values in **single** quotes: `--row '16=....K44K....'`.
  Grid strings contain `.` and `=`; nested double quotes break the parser.
- `edit` writes in place unless given `-o`.
- GIF export uses uncompressed-LZW: larger files, but provably decodable.
  Verified pixel-exact against an independent decoder.

## Watching it happen

```bash
python pxforge.py watch examples/dragon.pxa --port 8765
```

Serves `http://localhost:8765` — a page that polls the file, repaints when it
changes, and **flashes the cells that just changed**, with a running activity
log. Useful for showing someone the sprite taking shape while edits land, and
for catching a botched op the moment it happens rather than at the next preview.

Under Claude Code there's a launch config at `.claude/launch.json` (`pixel-live`),
so `preview_start` opens it in the Browser pane. Point it at a different sprite
by editing the `runtimeArgs` path.

## Verify

```bash
python C:/Users/Dizzy/Documents/Claude/tools/pixelforge/selftest.py
```

Exercises every command, checks that invalid input is *rejected*, and decodes
the emitted PNG and GIF with independently written decoders — the encoders are
hand-rolled, so that round-trip is the only real proof they're correct.

## Layout

```
pxforge.py        CLI
selftest.py       full self-test (47 checks)
pxlib/png.py      PNG encoder + decoder
pxlib/gif.py      animated GIF encoder
pxlib/fmt.py      .pxa parse / serialize / validate / rasterize
pxlib/ops.py      transforms and drawing primitives
pxlib/render.py   canvas, preview, sprite sheet
pxlib/palettes.py built-in palettes
pxlib/templates.py proportion guides
pxlib/font.py     3x5 font for ruler and legend labels
examples/         knight.pxa (single frame), walk.pxa (3-frame cycle)
```
