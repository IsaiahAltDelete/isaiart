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

def fit(im):
    alpha = im.getchannel('A').point(lambda v: 255 if v > 8 else 0)
    c = im.crop(alpha.getbbox())
    k = SIZE * FILL / max(c.size)
    c = c.resize((max(1, round(c.width * k)), max(1, round(c.height * k))), Image.LANCZOS)
    out = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
    out.alpha_composite(c, ((SIZE - c.width) // 2, (SIZE - c.height) // 2))
    return out

OUT.mkdir(parents=True, exist_ok=True)
for f in sorted(SRC.glob('icon_*.png')):
    name = f.stem[5:]
    key = KEYS.get(name, name)
    fit(Image.open(f).convert('RGBA')).save(OUT / f'{key}.webp', 'WEBP', quality=92, method=6)
    print(f'{f.name} -> art/icons/{key}.webp')
