"""Turn the painted icon masters (villages/art/incoming/icon_*.png, 1024 px) into game icons.

Each master is trimmed to its silhouette, fitted into a square with the same padding as every other
icon, and saved as a 128 px WebP in villages/art/icons/, named by the game's icon key (icons.js).
Run from the repo:  python villages/tools/icons.py   (needs Pillow). Then run tools/stamp.mjs.
"""
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SRC, OUT = ROOT / 'art' / 'incoming', ROOT / 'art' / 'icons'
SIZE, FILL = 128, 0.9
# master file name -> the game's icon key (where they differ)
KEYS = {'build': 'hammer', 'town': 'crest', 'journal': 'book', 'world': 'map'}
# glyphs that sit inside coloured buttons (the green +, the red close, the round home button) read better
# as the plain drawn SVG: a painted badge inside a button looks doubled up
SKIP = {'plus', 'close', 'home', 'cross'}   # cross is the red ✗ beside an unmet requirement, not a healing cross

def fit(im):
    alpha = im.getchannel('A').point(lambda v: 255 if v > 8 else 0)
    c = im.crop(alpha.getbbox())
    k = SIZE * FILL / max(c.size)
    c = c.resize((max(1, round(c.width * k)), max(1, round(c.height * k))), Image.LANCZOS)
    out = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
    out.alpha_composite(c, ((SIZE - c.width) // 2, (SIZE - c.height) // 2))
    return out

OUT.mkdir(parents=True, exist_ok=True)
# frames (9-slice skins for CSS border-image): trimmed to the shape and scaled so the corner slice is
# FRAME_SLICE px. Only the ones the game uses are listed; the rest stay in incoming/ for later.
FRAMES = {'frame_modal': ('modal', 616)}
(ROOT / 'art' / 'frames').mkdir(parents=True, exist_ok=True)
for src, (name, size) in FRAMES.items():
    f = SRC / f'{src}.png'
    if not f.exists(): continue
    im = Image.open(f).convert('RGBA'); im = im.crop(im.getchannel('A').point(lambda v: 255 if v > 8 else 0).getbbox())
    im.resize((size, round(im.height * size / im.width)), Image.LANCZOS).save(ROOT / 'art' / 'frames' / f'{name}.webp', 'WEBP', quality=94, method=6)
    print(f'{f.name} -> art/frames/{name}.webp')

for f in sorted(SRC.glob('icon_*.png')):
    name = f.stem[5:]
    key = KEYS.get(name, name)
    if key in SKIP:
        (OUT / f'{key}.webp').unlink(missing_ok=True); continue
    fit(Image.open(f).convert('RGBA')).save(OUT / f'{key}.webp', 'WEBP', quality=92, method=6)
    print(f'{f.name} -> art/icons/{key}.webp')
