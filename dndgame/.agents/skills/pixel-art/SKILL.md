---
name: pixel-art
description: Create pixel characters, sprites, tilesets and pixel art, and export them as PNG or animated GIF. Use whenever asked to design, draw, edit or animate a sprite or pixel character, produce a sprite sheet or game character art, or convert a PNG into editable pixel art. Sprites are authored as text grids and rendered with a local zero-dependency tool.
---

# Pixel art

Use `pixelforge` at `C:\Users\Dizzy\Documents\DND GAME\pixelforge\files\pxforge.py`.
It uses only the Python standard library. On this machine, invoke it with Codex's bundled Python runtime:

```powershell
& 'C:\Users\Dizzy\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe' 'C:\Users\Dizzy\Documents\DND GAME\pixelforge\files\pxforge.py' --help
```

Sprites are `.pxa` text files (palette + ASCII grid), so author them with Write
and change them with Edit. The image is a build artifact, never the source.

## The loop

1. `new FILE --size WxH --template humanoid32` — scaffold over a proportion guide
2. Write / `edit` the grid
3. `preview FILE` → **`Read` the resulting PNG** → locate the flaw by its (x, y)
4. Fix that cell, repeat
5. `render` (PNG) / `sheet` (sprite sheet) / `gif` (animation)

Step 3 is what makes this work: `preview` draws numbered rulers, a pixel grid and
a palette legend, so what's wrong in the image maps to an exact cell to edit.
Always preview and Read before calling a sprite finished.

## Format

```
@name  knight
@use   chr16
@scale 12
@frame idle
....KKKK....
...K2222K...
```

`.` is transparent. Every row must be the same width — `validate` catches it and
`ascii -n` shows ruler-aligned rows with the character delta on bad ones.

`chr16` ramps (shading = ±1 on the key): `1 2 3` skin, `4 5 6` cloth A,
`7 8 9` cloth B, `m M` metal, `h H` hair, `K` outline, `k` shadow, `W` highlight,
`e` eye, `s` template guide.

## Commands

`new preview render sheet gif watch ascii validate info edit import diff palettes templates`

`watch FILE --port 8765` serves a live browser view that repaints and flashes
changed cells on every save — use it when someone wants to watch the sprite get
built. A `pixel-live` entry in `.claude/launch.json` opens it via `preview_start`.

`edit` ops apply in the order typed: `--set X,Y=C` `--line` `--rect` `--frect`
`--ellipse` `--fellipse` `--fill` `--row Y=STRING` `--col` `--replace A=B`
`--paste X,Y=FILE` `--mirror l|r` `--outline C[,diag]` `--autoshade RAMP,LIGHT`
`--trim` `--pad` `--crop` `--scale N` `--rot N` `--flip-h` `--flip-v`
`--add-frame NAME=COPYOF`

In PowerShell use **single** quotes for op values: `--row '16=....K44K....'`.

Full reference and recipes: `C:\Users\Dizzy\Documents\DND GAME\pixelforge\files\README.md`

## Craft

Silhouette first — if the blocked shape doesn't read at 1x, interior detail won't
save it. Keep to ~3 tones per material. Outline last. One light direction, same
`LIGHT` argument for every `--autoshade`.
