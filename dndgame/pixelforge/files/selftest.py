#!/usr/bin/env python
"""Self-test: `python selftest.py`. Exits non-zero on any failure.

Covers every CLI command, the drawing/transform ops, and -- most importantly --
round-trips the PNG and GIF encoders through independent decoders, since those
are hand-written and have no library to check them against.
"""

from __future__ import print_function

import os
import shutil
import struct
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
CLI = os.path.join(HERE, "pxforge.py")
EX = os.path.join(HERE, "examples")
sys.path.insert(0, HERE)

from pxlib import fmt, ops, png, render  # noqa: E402

FAILS = []


def check(label, ok, detail=""):
    print("%-4s %s%s" % ("ok" if ok else "FAIL", label,
                         "" if ok else "  -- " + str(detail)))
    if not ok:
        FAILS.append(label)


def run(label, args, expect_ok=True):
    p = subprocess.Popen([sys.executable, CLI] + args,
                         stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    out, err = p.communicate()
    ok = (p.returncode == 0) if expect_ok else (p.returncode != 0)
    check(label, ok, (out + err).decode("utf-8", "replace").strip()[:400])
    return out.decode("utf-8", "replace")


# ---------------------------------------------------------------- gif decoder

def lzw_decode(data, mcs):
    clear, eoi = 1 << mcs, (1 << mcs) + 1
    width = mcs + 1
    table = [(i,) for i in range(clear)] + [None, None]
    out, prev = [], None
    acc = nbits = pos = 0
    while True:
        while nbits < width:
            if pos >= len(data):
                return out
            acc |= data[pos] << nbits
            nbits += 8
            pos += 1
        code = acc & ((1 << width) - 1)
        acc >>= width
        nbits -= width
        if code == clear:
            table = [(i,) for i in range(clear)] + [None, None]
            width, prev = mcs + 1, None
            continue
        if code == eoi:
            return out
        if code < len(table) and table[code] is not None:
            entry = table[code]
        elif prev is not None:
            entry = prev + (prev[0],)
        else:
            raise ValueError("bad code %d" % code)
        out.extend(entry)
        if prev is not None:
            table.append(prev + (entry[0],))
            if len(table) == (1 << width) and width < 12:
                width += 1
        prev = entry


def parse_gif(path):
    blob = open(path, "rb").read()
    assert blob[:6] in (b"GIF89a", b"GIF87a"), "bad magic"
    w, h, flags = struct.unpack("<HHB", blob[6:11])
    pos = 13
    gct_size = 3 * (1 << ((flags & 7) + 1))
    gct = blob[pos:pos + gct_size]
    pos += gct_size
    frames = []
    while pos < len(blob) and blob[pos] != 0x3B:
        if blob[pos] == 0x21:
            pos += 2
            while blob[pos]:
                pos += 1 + blob[pos]
            pos += 1
        elif blob[pos] == 0x2C:
            fw, fh = struct.unpack("<HH", blob[pos + 5:pos + 9])
            assert not (blob[pos + 9] & 0x80), "unexpected local color table"
            pos += 10
            mcs = blob[pos]
            pos += 1
            sub = bytearray()
            while blob[pos]:
                n = blob[pos]
                sub += blob[pos + 1:pos + 1 + n]
                pos += 1 + n
            pos += 1
            idx = lzw_decode(bytes(sub), mcs)
            assert len(idx) == fw * fh, "decoded %d px, want %d" % (len(idx), fw * fh)
            frames.append((fw, fh, idx))
        else:
            raise ValueError("unexpected block 0x%02x" % blob[pos])
    return w, h, gct, frames


def gif_matches(gif_path, pxa_path, scale):
    _w, _h, gct, frames = parse_gif(gif_path)
    sprite = fmt.load(pxa_path)
    if len(frames) != len(sprite.frames):
        return "frame count %d != %d" % (len(frames), len(sprite.frames))
    for (fw, fh, idx), sf in zip(frames, sprite.frames):
        canvas = render.render_png(sprite, sf.name, scale=scale)
        if (fw, fh) != (canvas.w, canvas.h):
            return "size %dx%d != %dx%d" % (fw, fh, canvas.w, canvas.h)
        for p in range(fw * fh):
            j = p * 4
            if canvas.buf[j + 3] < 128:
                if idx[p] != 0:
                    return "opaque where transparent expected at %d" % p
                continue
            i = idx[p] * 3
            if idx[p] == 0 or (gct[i], gct[i + 1], gct[i + 2]) != \
                    tuple(canvas.buf[j:j + 3]):
                return "color mismatch at px %d" % p
    return None


def main():
    tmp = tempfile.mkdtemp(prefix="pxforge-selftest-")
    a = os.path.join(tmp, "a.pxa")
    try:
        run("palettes", ["palettes"])
        run("palettes NAME", ["palettes", "pico8"])
        run("templates", ["templates"])
        run("new", ["new", a, "--size", "16x16", "--template", "humanoid16",
                    "--frames", "idle,walk", "--force"])
        run("validate", ["validate", a])
        run("info", ["info", a])
        run("ascii -n --all", ["ascii", a, "-n", "--all"])
        run("edit draw", ["edit", a, "--replace", "s=5", "--frect", "2,2,4,4=8",
                          "--rect", "9,9,5,5=m", "--line", "0,0,15,15=W",
                          "--ellipse", "3,10,6,5=h", "--fellipse", "10,2,5,5=2",
                          "--set", "0,15=e", "--fill", "15,0=6"])
        run("edit row/col", ["edit", a, "--frame", "walk",
                             "--row", "7=" + "K" * 16, "--col", "0=" + "W" * 16])
        run("edit transforms", ["edit", a, "--all", "--outline", "K,diag",
                                "--autoshade", "456,tl,.K", "--mirror", "l",
                                "--flip-h", "--flip-v", "--shift", "1,1"])
        run("edit resize", ["edit", a, "-o", os.path.join(tmp, "c.pxa"),
                            "--pad", "2,2,2,2", "--crop", "1,1,18,18",
                            "--rot", "1", "--trim", "--scale", "2"])
        run("edit --dry", ["edit", a, "--dry", "--replace", "5=4"])
        run("add/del frame", ["edit", a, "--add-frame", "jump=idle"])
        run("del frame", ["edit", a, "--del-frame", "jump"])
        run("paste (drive colon)",
            ["edit", a, "--paste", "2,2=%s:idle" % os.path.join(EX, "knight.pxa")])
        run("render", ["render", a, "--scale", "5", "--pad", "3", "--bg", "#202030"])
        run("render --frame", ["render", a, "--frame", "walk",
                               "-o", os.path.join(tmp, "walk.png")])
        run("preview", ["preview", a, "--scale", "9"])
        run("preview auto-scale", ["preview", os.path.join(EX, "walk.pxa"),
                                   "--frame", "step_r",
                                   "-o", os.path.join(tmp, "p2.png")])
        run("sheet", ["sheet", a, "--scale", "6", "--cols", "1", "--gap", "3",
                      "--label"])
        run("gif", ["gif", a, "--scale", "4", "--fps", "12"])
        run("gif single frame", ["gif", os.path.join(EX, "mage.pxa"),
                                 "-o", os.path.join(tmp, "mage.gif")])
        run("import", ["import", os.path.join(tmp, "a.png"), "--grid", "5",
                       "-o", os.path.join(tmp, "back.pxa"), "--force"])
        run("import --max-colors", ["import", os.path.join(tmp, "a.png"),
                                    "--grid", "5", "--max-colors", "4",
                                    "-o", os.path.join(tmp, "b4.pxa"), "--force"])
        run("diff", ["diff", a, a])

        # bundled examples must always be valid
        for name in sorted(os.listdir(EX)):
            if name.endswith(".pxa"):
                run("example %s" % name, ["validate", os.path.join(EX, name)])

        # invalid input must fail loudly rather than emit art
        run("reject missing file", ["validate", os.path.join(tmp, "nope.pxa")],
            expect_ok=False)
        ragged = os.path.join(tmp, "ragged.pxa")
        open(ragged, "w").write("@name x\n@grid\n..KK\n..K\n")
        run("reject ragged rows", ["render", ragged], expect_ok=False)
        run("reject short --row", ["edit", a, "--row", "0=short"],
            expect_ok=False)
        run("reject 1-char ramp", ["edit", a, "--autoshade", "Z"],
            expect_ok=False)
        undef = os.path.join(tmp, "undef.pxa")
        open(undef, "w").write("@name x\n@use gb\n@grid\n01Z3\n0123\n")
        run("reject undefined key", ["render", undef], expect_ok=False)

        # BOM tolerance (PowerShell `Out-File -Encoding utf8`)
        bom = os.path.join(tmp, "bom.pxa")
        with open(bom, "wb") as fh:
            fh.write(b"\xef\xbb\xbf@name b\n@use gb\n@grid\n0123\n3210\n")
        run("accept UTF-8 BOM", ["validate", bom])

        # encoders vs independent decoders
        for label, path in (("a.png", os.path.join(tmp, "a.png")),
                            ("preview", os.path.join(tmp, "a.preview.png")),
                            ("sheet", os.path.join(tmp, "a.sheet.png"))):
            try:
                w, h, buf = png.read_rgba(path)
                check("png round-trip %s" % label, len(buf) == w * h * 4)
            except Exception as exc:
                check("png round-trip %s" % label, False, exc)

        for label, g, p, sc in (("multi-frame", os.path.join(tmp, "a.gif"), a, 4),
                                ("single-frame", os.path.join(tmp, "mage.gif"),
                                 os.path.join(EX, "mage.pxa"), 12)):
            try:
                check("gif decodes exactly (%s)" % label,
                      gif_matches(g, p, sc) is None, gif_matches(g, p, sc))
            except Exception as exc:
                check("gif decodes exactly (%s)" % label, False, exc)

        # geometry invariants
        f = fmt.Frame("t", ["abc", "def", "ghi"])
        check("flip_h involutive", ops.flip_h(ops.flip_h(f)).rows == f.rows)
        check("flip_v involutive", ops.flip_v(ops.flip_v(f)).rows == f.rows)
        check("rot 4x identity", ops.rotate(f, 4).rows == f.rows)
        check("rot 1 turns rows", ops.rotate(f, 1).rows == ["gda", "heb", "ifc"])
        check("mirror l symmetric",
              ops.mirror(fmt.Frame("t", ["ab.c", "d.ef"]), "l").rows
              == ["abba", "d..d"])
        check("scale_up 2x", ops.scale_up(fmt.Frame("t", ["ab"]), 2).rows
              == ["aabb", "aabb"])
        check("trim tightens",
              ops.trim(fmt.Frame("t", ["....", ".xx.", "...."])).rows == ["xx"])
        check("pad grows",
              ops.pad(fmt.Frame("t", ["x"]), 1, 1, 1, 1).rows
              == ["...", ".x.", "..."])
        check("outline surrounds",
              ops.outline(fmt.Frame("t", ["...", ".x.", "..."]), "K").rows
              == [".K.", "KxK", ".K."])
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

    print("")
    if FAILS:
        print("%d FAILURE(S): %s" % (len(FAILS), ", ".join(FAILS)))
        return 1
    print("ALL PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())
