"""The .pxa sprite format: parse, validate, serialize.

    @name   knight
    @use    chr16            # load a built-in palette's key->color map
    @scale  12               # default render scale
    @fps    8                # default gif rate
    @palette                 # per-file additions/overrides
    c #7fd4ff cape
    x transparent
    @frame idle              # or a bare @grid for a single-frame sprite
    ....KKKK....
    ...K2222K...

'.' is transparent unless the file redefines it. Full-line '#' comments are
stripped outside grid blocks only, so '#' is a legal palette key -- though
`validate` warns about it, since a comment and a grid row would look alike.
"""

from collections import OrderedDict

from . import palettes

TRANSPARENT = (0, 0, 0, 0)
_TRANSPARENT_WORDS = ("transparent", "none", "clear", "-")


class PxaError(Exception):
    pass


def parse_color(tok):
    """'#rgb' | '#rrggbb' | '#rrggbbaa' | 'transparent' -> (r,g,b,a)."""
    t = tok.strip().lower()
    if t in _TRANSPARENT_WORDS:
        return TRANSPARENT
    if not t.startswith("#"):
        raise PxaError("color must be #hex or 'transparent', got %r" % tok)
    h = t[1:]
    if len(h) == 3:
        h = "".join(c * 2 for c in h)
    if len(h) == 6:
        h += "ff"
    if len(h) != 8:
        raise PxaError("bad hex color %r (want #rgb, #rrggbb or #rrggbbaa)" % tok)
    try:
        return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4, 6))
    except ValueError:
        raise PxaError("bad hex color %r" % tok)


def color_hex(c):
    if c[3] == 0:
        return "transparent"
    if c[3] == 255:
        return "#%02x%02x%02x" % (c[0], c[1], c[2])
    return "#%02x%02x%02x%02x" % tuple(c)


class Frame(object):
    def __init__(self, name, rows):
        self.name = name
        self.rows = list(rows)

    @property
    def width(self):
        return len(self.rows[0]) if self.rows else 0

    @property
    def height(self):
        return len(self.rows)

    def get(self, x, y):
        if 0 <= y < self.height and 0 <= x < len(self.rows[y]):
            return self.rows[y][x]
        return None

    def set(self, x, y, ch):
        if 0 <= y < self.height and 0 <= x < self.width:
            row = self.rows[y]
            self.rows[y] = row[:x] + ch + row[x + 1:]

    def copy(self, name=None):
        return Frame(name or self.name, self.rows)


class Sprite(object):
    def __init__(self, name="sprite", palette=None, frames=None, meta=None):
        self.name = name
        self.palette = palette if palette is not None else OrderedDict()
        self.frames = frames if frames is not None else []
        self.meta = meta or {}

    @property
    def width(self):
        return self.frames[0].width if self.frames else 0

    @property
    def height(self):
        return self.frames[0].height if self.frames else 0

    def frame(self, ref=None):
        """ref: None (first), a name, or an index as str/int."""
        if not self.frames:
            raise PxaError("sprite %r has no frames" % self.name)
        if ref is None or ref == "":
            return self.frames[0]
        for f in self.frames:
            if f.name == ref:
                return f
        try:
            return self.frames[int(ref)]
        except (ValueError, IndexError):
            pass
        raise PxaError("no frame %r (have: %s)"
                       % (ref, ", ".join(f.name for f in self.frames)))

    def color(self, ch):
        return self.palette.get(ch, TRANSPARENT)

    def used_keys(self):
        used = set()
        for f in self.frames:
            for row in f.rows:
                used.update(row)
        return used


def _apply_use(sprite, name):
    for k, hexcolor in palettes.get(name)["colors"].items():
        sprite.palette[k] = parse_color(hexcolor)
    sprite.meta.setdefault("use", name)


def loads(text, source="<string>"):
    if text.startswith("﻿"):
        text = text[1:]          # PowerShell's `Out-File -Encoding utf8` BOM
    sprite = Sprite()
    sprite.palette["."] = TRANSPARENT
    mode = None            # None | 'palette' | 'grid'
    pending = None         # Frame being accumulated
    saw_use = False

    def flush():
        if pending is not None:
            if not pending.rows:
                raise PxaError("%s: frame %r has no rows" % (source, pending.name))
            sprite.frames.append(pending)

    for lineno, raw in enumerate(text.splitlines(), 1):
        line = raw.rstrip("\r\n")
        stripped = line.strip()
        if stripped.startswith("@"):
            parts = stripped[1:].split(None, 1)
            key = parts[0].lower()
            val = parts[1].strip() if len(parts) > 1 else ""
            if key in ("grid", "frame"):
                flush()
                pending = Frame(val or ("f%d" % len(sprite.frames)), [])
                mode = "grid"
            elif key == "palette":
                flush()
                pending = None
                mode = "palette"
            elif key == "name":
                sprite.name = val
            elif key == "use":
                _apply_use(sprite, val)
                saw_use = True
            elif key in ("scale", "fps", "cols", "gap", "loop"):
                try:
                    sprite.meta[key] = int(val)
                except ValueError:
                    raise PxaError("%s:%d: @%s wants an integer, got %r"
                                   % (source, lineno, key, val))
            elif key == "size":
                sprite.meta["size"] = val
            else:
                sprite.meta[key] = val
            continue

        if mode == "grid":
            if not stripped:
                continue
            if stripped.startswith("#"):
                continue
            pending.rows.append(line.rstrip())
            continue

        if not stripped or stripped.startswith("#") or stripped.startswith("//"):
            continue

        if mode == "palette":
            bits = stripped.split(None, 2)
            if len(bits) < 2:
                raise PxaError("%s:%d: palette line needs '<char> <color>', got %r"
                               % (source, lineno, stripped))
            ch, colortok = bits[0], bits[1]
            if len(ch) != 1:
                raise PxaError("%s:%d: palette key must be one character, got %r"
                               % (source, lineno, ch))
            try:
                sprite.palette[ch] = parse_color(colortok)
            except PxaError as exc:
                raise PxaError("%s:%d: %s" % (source, lineno, exc))
            if len(bits) > 2:
                sprite.meta.setdefault("notes", {})[ch] = bits[2].strip()
            continue

        raise PxaError("%s:%d: unexpected text outside any block: %r"
                       % (source, lineno, stripped))

    flush()
    if not sprite.frames:
        raise PxaError("%s: no @grid or @frame block found" % source)
    if not saw_use and len(sprite.palette) == 1:
        _apply_use(sprite, palettes.DEFAULT)
    return sprite


def load(path):
    with open(path, "r", encoding="utf-8-sig") as fh:
        return loads(fh.read(), source=path)


def dumps(sprite):
    out = ["@name  %s" % sprite.name]
    if sprite.meta.get("use"):
        out.append("@use   %s" % sprite.meta["use"])
    for key in ("scale", "fps", "cols", "gap", "loop"):
        if key in sprite.meta:
            out.append("@%-5s %s" % (key, sprite.meta[key]))
    out.append("@size  %dx%d" % (sprite.width, sprite.height))

    base = {}
    if sprite.meta.get("use"):
        for k, hx in palettes.get(sprite.meta["use"])["colors"].items():
            base[k] = parse_color(hx)
    extra = OrderedDict()
    for k, c in sprite.palette.items():
        if k == "." and c == TRANSPARENT:
            continue
        if base.get(k) != c:
            extra[k] = c
    if extra:
        out.append("")
        out.append("@palette")
        notes = sprite.meta.get("notes", {})
        for k, c in extra.items():
            line = "%s %s" % (k, color_hex(c))
            if notes.get(k):
                line += "  %s" % notes[k]
            out.append(line)

    for f in sprite.frames:
        out.append("")
        out.append("@frame %s" % f.name)
        out.extend(f.rows)
    return "\n".join(out) + "\n"


def save(sprite, path):
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(dumps(sprite))


def validate(sprite):
    """-> (errors, warnings), both lists of strings."""
    errors, warnings = [], []
    if not sprite.frames:
        return ["sprite has no frames"], warnings

    w, h = sprite.frames[0].width, sprite.frames[0].height
    if w == 0:
        errors.append("frame %r has zero width" % sprite.frames[0].name)

    seen_names = set()
    for f in sprite.frames:
        if f.name in seen_names:
            warnings.append("duplicate frame name %r" % f.name)
        seen_names.add(f.name)
        if f.height != h:
            errors.append("frame %r has %d rows, frame %r has %d"
                          % (f.name, f.height, sprite.frames[0].name, h))
        for y, row in enumerate(f.rows):
            if len(row) != w:
                errors.append("frame %r row %d is %d chars, expected %d: %r"
                              % (f.name, y, len(row), w, row))

    undefined = {}
    for f in sprite.frames:
        for y, row in enumerate(f.rows):
            for x, ch in enumerate(row):
                if ch not in sprite.palette:
                    undefined.setdefault(ch, (f.name, x, y))
    for ch, (fname, x, y) in sorted(undefined.items()):
        errors.append("undefined palette key %r (first at frame %r x=%d y=%d)"
                      % (ch, fname, x, y))

    if "#" in sprite.palette:
        warnings.append("'#' is a palette key; grid rows starting with it are "
                        "read as comments")
    unused = set(sprite.palette) - sprite.used_keys() - {"."}
    if unused:
        warnings.append("palette keys defined but unused: %s"
                        % " ".join(sorted(unused)))
    return errors, warnings


def rasterize(sprite, frame_ref=None, bg=None):
    """-> (w, h, bytearray RGBA) at 1x."""
    f = sprite.frame(frame_ref)
    w, h = f.width, f.height
    buf = bytearray(w * h * 4)
    for y in range(h):
        row = f.rows[y]
        for x in range(w):
            c = sprite.color(row[x])
            if c[3] == 0 and bg is not None:
                c = bg
            i = (y * w + x) * 4
            buf[i:i + 4] = bytes(c)
    return w, h, buf
