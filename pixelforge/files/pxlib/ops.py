"""Grid transforms and drawing primitives.

Everything works on Frame row-strings, so results stay diffable text.
"""

from .fmt import Frame, PxaError


# ---------------------------------------------------------------- transforms

def flip_h(frame):
    return Frame(frame.name, [row[::-1] for row in frame.rows])


def flip_v(frame):
    return Frame(frame.name, list(reversed(frame.rows)))


def mirror(frame, side="l"):
    """Copy one half across the vertical axis. Odd widths keep the center column."""
    w = frame.width
    half = w // 2
    rows = []
    for row in frame.rows:
        mid = row[half:w - half]
        if side == "l":
            keep = row[:half]
            rows.append(keep + mid + keep[::-1])
        else:
            keep = row[w - half:]
            rows.append(keep[::-1] + mid + keep)
    return Frame(frame.name, rows)


def rotate(frame, turns=1):
    rows = frame.rows
    for _ in range(turns % 4):
        w = len(rows[0])
        rows = ["".join(rows[len(rows) - 1 - y][x] for y in range(len(rows)))
                for x in range(w)]
    return Frame(frame.name, rows)


def crop(frame, x, y, w, h, fill="."):
    rows = []
    for yy in range(y, y + h):
        src = frame.rows[yy] if 0 <= yy < frame.height else ""
        rows.append("".join(src[xx] if 0 <= xx < len(src) else fill
                            for xx in range(x, x + w)))
    return Frame(frame.name, rows)


def pad(frame, left=0, right=0, top=0, bottom=0, fill="."):
    return crop(frame, -left, -top,
                frame.width + left + right, frame.height + top + bottom, fill)


def trim(frame, empty="."):
    """Shrink to the tight bounding box of non-empty cells."""
    xs, ys = [], []
    for y, row in enumerate(frame.rows):
        for x, ch in enumerate(row):
            if ch != empty:
                xs.append(x)
                ys.append(y)
    if not xs:
        return Frame(frame.name, ["."])
    return crop(frame, min(xs), min(ys), max(xs) - min(xs) + 1, max(ys) - min(ys) + 1)


def scale_up(frame, factor):
    if factor < 1:
        raise PxaError("scale factor must be >= 1")
    rows = []
    for row in frame.rows:
        big = "".join(ch * factor for ch in row)
        rows.extend([big] * factor)
    return Frame(frame.name, rows)


def replace(frame, mapping):
    """mapping: {old_char: new_char}."""
    table = dict((ord(k), v) for k, v in mapping.items())
    return Frame(frame.name, [row.translate(table) for row in frame.rows])


def shift(frame, dx=0, dy=0, fill="."):
    return crop(frame, -dx, -dy, frame.width, frame.height, fill)


# ------------------------------------------------------------------ silhouette

_N4 = ((0, -1), (-1, 0), (1, 0), (0, 1))
_N8 = _N4 + ((-1, -1), (1, -1), (-1, 1), (1, 1))


def outline(frame, char="K", empty=".", diagonal=False, inside=False):
    """Trace the silhouette. inside=False grows outward, True paints the rim."""
    nb = _N8 if diagonal else _N4
    out = frame.copy()
    hits = []
    for y in range(frame.height):
        for x in range(frame.width):
            solid = frame.get(x, y) != empty
            if inside:
                if not solid:
                    continue
                if any(frame.get(x + dx, y + dy) in (empty, None) for dx, dy in nb):
                    hits.append((x, y))
            else:
                if solid:
                    continue
                if any(frame.get(x + dx, y + dy) not in (empty, None)
                       for dx, dy in nb):
                    hits.append((x, y))
    for x, y in hits:
        out.set(x, y, char)
    return out


def autoshade(frame, ramp, light="tl", empty="."):
    """Push ramp colors toward light/shadow based on which side is exposed.

    ramp: dark->light key string, e.g. "123". A cell already in the ramp whose
    neighbour toward the light is empty becomes lighter; away from the light,
    darker. Everything else is untouched.

    empty: every character that counts as "outside the form". Pass ".K" on an
    already-outlined sprite, otherwise the outline hides every edge and nothing
    shades.
    """
    if len(ramp) < 2:
        raise PxaError("ramp needs at least 2 keys, got %r" % ramp)
    dirs = {"tl": (-1, -1), "t": (0, -1), "tr": (1, -1), "l": (-1, 0),
            "r": (1, 0), "bl": (-1, 1), "b": (0, 1), "br": (1, 1)}
    if light not in dirs:
        raise PxaError("light must be one of %s" % " ".join(sorted(dirs)))
    lx, ly = dirs[light]
    outside = set(empty) | set([None])
    idx = dict((ch, i) for i, ch in enumerate(ramp))
    out = frame.copy()
    for y in range(frame.height):
        for x in range(frame.width):
            ch = frame.get(x, y)
            if ch not in idx:
                continue
            i = idx[ch]
            lit = frame.get(x + lx, y + ly) in outside
            dark = frame.get(x - lx, y - ly) in outside
            if lit and not dark:
                i = min(len(ramp) - 1, i + 1)
            elif dark and not lit:
                i = max(0, i - 1)
            out.set(x, y, ramp[i])
    return out


# -------------------------------------------------------------------- drawing

def draw_point(frame, x, y, ch):
    frame.set(x, y, ch)


def draw_line(frame, x0, y0, x1, y1, ch):
    dx, dy = abs(x1 - x0), -abs(y1 - y0)
    sx = 1 if x0 < x1 else -1
    sy = 1 if y0 < y1 else -1
    err = dx + dy
    while True:
        frame.set(x0, y0, ch)
        if x0 == x1 and y0 == y1:
            return
        e2 = 2 * err
        if e2 >= dy:
            err += dy
            x0 += sx
        if e2 <= dx:
            err += dx
            y0 += sy


def draw_rect(frame, x, y, w, h, ch, fill=False):
    if w <= 0 or h <= 0:
        return
    for yy in range(y, y + h):
        for xx in range(x, x + w):
            edge = xx in (x, x + w - 1) or yy in (y, y + h - 1)
            if fill or edge:
                frame.set(xx, yy, ch)


def draw_ellipse(frame, x, y, w, h, ch, fill=False):
    """Inscribed in the box (x, y, w, h)."""
    if w <= 0 or h <= 0:
        return
    cx, cy = x + (w - 1) / 2.0, y + (h - 1) / 2.0
    rx, ry = w / 2.0, h / 2.0
    for yy in range(y, y + h):
        for xx in range(x, x + w):
            nx = (xx - cx) / rx
            ny = (yy - cy) / ry
            d = nx * nx + ny * ny
            if d <= 1.0:
                if fill:
                    frame.set(xx, yy, ch)
                else:
                    # keep the rim: inside, but with an outside 4-neighbour
                    rim = False
                    for dx, dy in _N4:
                        ox, oy = xx + dx, yy + dy
                        onx = (ox - cx) / rx
                        ony = (oy - cy) / ry
                        if onx * onx + ony * ony > 1.0:
                            rim = True
                            break
                    if rim:
                        frame.set(xx, yy, ch)


def flood_fill(frame, x, y, ch):
    target = frame.get(x, y)
    if target is None or target == ch:
        return
    stack = [(x, y)]
    while stack:
        cx, cy = stack.pop()
        if frame.get(cx, cy) != target:
            continue
        frame.set(cx, cy, ch)
        for dx, dy in _N4:
            nx, ny = cx + dx, cy + dy
            if 0 <= nx < frame.width and 0 <= ny < frame.height:
                stack.append((nx, ny))


def paste(dst, src, x, y, transparent="."):
    for sy in range(src.height):
        for sx in range(src.width):
            ch = src.get(sx, sy)
            if ch == transparent:
                continue
            dst.set(x + sx, y + sy, ch)
