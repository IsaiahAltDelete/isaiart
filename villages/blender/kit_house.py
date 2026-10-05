# Shared house parts: chunky shingled roofs, framed windows with shutters,
# arched doors, cobbled plinths and leaning chimneys. Every part keeps a
# material slot so the game can recolour walls, roofs, trim and shutters.
import math, random
from mathutils import Vector

def slots():
    return dict(
        wall=material("wall", 0xf3e3c3), roof=material("roof", 0xc9473d), trim=material("trim", 0x8a5a33),
        door=material("door", 0x6b4428), win=material("win", 0xffe9a3), stone=material("stone", 0xa7a49c),
        stone2=material("stone2", 0x8c8a84), chim=material("chim", 0x9a8f86), shutter=material("shutter", 0x4f8a5a),
        metal=material("metal", 0x3c3c3c), thatch=material("thatch", 0xc9a35c), leaf=material("leaf", 0x4f9a3a),
        fl1=material("flower", 0xf06292), fl2=material("flower2", 0xffd54f), fl3=material("flower3", 0xffffff),
        pad=material("pad", 0xb89466), wood=material("wood", 0xa77a4a))

def sag_mesh(o, w, sag, h):
    """Dip the middle of a roof a little (in its own mesh, ridge along X)."""
    for v in o.data.vertices:
        k = 1 - min(1, (v.co.x / (w / 2)) ** 2)
        v.co.z -= sag * k * max(0, v.co.z) / max(h, 1e-3)

def slab(name, w, L, t, mat, cuts=8, bev=0.0):
    """A thick plate w x L x t (centred), cut along x so it can sag."""
    bm = bmesh.new()
    xs = [-w / 2 + w * k / cuts for k in range(cuts + 1)]
    vs = {}
    for i, x in enumerate(xs):
        for j, (y, z) in enumerate([(-L / 2, -t / 2), (L / 2, -t / 2), (L / 2, t / 2), (-L / 2, t / 2)]):
            vs[i, j] = bm.verts.new((x, y, z))
    for i in range(cuts):
        for j in range(4):
            k = (j + 1) % 4
            bm.faces.new((vs[i, j], vs[i + 1, j], vs[i + 1, k], vs[i, k]))
    bm.faces.new([vs[0, j] for j in range(4)][::-1]); bm.faces.new([vs[cuts, j] for j in range(4)])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    o = _obj(name, bm, mat)
    if bev: bevel(o, bev)
    return o

ROOF_MODE = "slab"     # "slab": textured plates (light); "shingles": modelled courses
SNOWCAP = None         # set lazily: the white pillow material the game toggles in winter

def gable_roof(name, w, d, h, M, over=0.16, thick=0.09, rows=5, sag=0.05, loc=(0, 0, 0), rot_z=0.0, mat=None, puffy=False, rnd=None, kick=0.13, snow=None):
    """A gable roof, ridge along X, eaves at z = 0 (loc). Slab mode: one thick
    textured plate per side with a rounded eave and ridge cap. Shingle mode and
    thatch: stepped courses whose lower edges lift by `kick`."""
    global SNOWCAP
    rnd = rnd or random.Random(1)
    mat = mat or M["roof"]
    if SNOWCAP is None or SNOWCAP.name not in bpy.data.materials: SNOWCAP = material("snowcap", 0xf4f7fb, True)
    if snow is None: snow = w + 2 * over > 0.9           # big roofs carry a pillow of snow; tiny ones don't
    parts = []
    half = d / 2 + over
    ang = math.atan2(h, half)
    slope = math.hypot(half, h)
    if ROOF_MODE == "slab" and not puffy:
        ww = w + 2 * over
        for s in (-1, 1):
            mid = slope / 2
            y = s * (half - math.cos(ang) * mid); z = math.sin(ang) * mid + thick * 0.4
            p = slab(f"{name}_s{s}", ww, slope + thick * 0.5, thick, mat, bev=thick * 0.3)
            p.location = (0, y, z); p.rotation_euler = (-s * ang, 0, 0); parts.append(p)
            # a chunky rounded eave
            parts.append(cyl(f"{name}_eave{s}", thick * 0.62, thick * 0.62, ww + 0.02, (-(ww / 2 + 0.01), s * (half - 0.02), thick * 0.1), mat, seg=8,
                             rot=(0, math.pi / 2, 0)))
            # a winter snow pillow over the upper two-thirds; the game shows it only in snow
            if snow:
                cov = 0.66
                midc = slope * (1 - cov / 2)
                yc = s * (half - math.cos(ang) * midc); zc = math.sin(ang) * midc + thick * 0.95
                sp = slab(f"{name}_snow{s}", ww - 0.04, slope * cov, 0.07, SNOWCAP, bev=0.03)
                sp.location = (0, yc, zc); sp.rotation_euler = (-s * ang, 0, 0); parts.append(sp)
        cap = cyl(f"{name}_cap", thick * 1.1, thick * 1.1, ww + 0.08, (-(ww / 2 + 0.04), 0, h + thick * 0.45), mat, seg=8, rot=(0, math.pi / 2, 0))
        parts.append(cap)
        if snow:
            parts.append(cyl(f"{name}_snowridge", thick * 1.25, thick * 1.25, ww, (-(ww / 2), 0, h + thick * 0.75), SNOWCAP, seg=8, rot=(0, math.pi / 2, 0), smooth=True))
        o = join(parts, name)
        if sag: sag_mesh(o, ww, sag, h)
        o.location = loc; o.rotation_euler = (0, 0, rot_z)
        return o
    for s in (-1, 1):
        for i in range(rows):
            seg = slope / rows * 1.18
            mid = (i + 0.5) / rows * slope
            y = s * (half - math.cos(ang) * mid)
            z = math.sin(ang) * mid + thick * 0.15
            ww = w + 2 * over + (rnd.uniform(-0.04, 0.04) if not puffy else rnd.uniform(-0.02, 0.02))
            a = ang - kick                     # flatter than the slope: lower edge lifts
            # staggered shingle pieces (or lumpy thatch bundles) with a little wobble
            n = max(2, round(ww / (0.55 if puffy else 0.42))); pw = ww / n
            off = (pw / 2) * (i % 2)
            x = -ww / 2 - off
            while x < ww / 2 - 0.01:
                x0, x1 = max(x, -ww / 2), min(x + pw, ww / 2)
                if x1 - x0 > 0.06:
                    gap = -0.04 if puffy else 0.018
                    parts.append(box(f"{name}_r{s}{i}_{len(parts)}", (x1 - x0 - gap, seg * (rnd.uniform(1.0, 1.12) if puffy else 1), thick * (rnd.uniform(0.9, 1.15) if puffy else 1)),
                                     ((x0 + x1) / 2, y, z + rnd.uniform(-0.01, 0.01)), mat,
                                     bev=thick * (0.46 if puffy else 0.32), segs=2 if puffy else 1, base=False,
                                     rot=(-s * (a + rnd.uniform(-0.03, 0.03)), rnd.uniform(-0.035, 0.035), 0)))
                x += pw
        if puffy:
            # a rolled eave of thatch
            parts.append(cyl(f"{name}_eave{s}", thick * 0.75, thick * 0.75, w + 2 * over + 0.04, (-(w / 2 + over + 0.02), s * (half - 0.04), thick * 0.1), mat, seg=10,
                             rot=(0, math.pi / 2, 0), smooth=True))
    cap = cyl(f"{name}_cap", thick * 1.05, thick * 1.05, w + 2 * over + 0.08, (-(w / 2 + over + 0.04), 0, h + thick * 0.2), mat, seg=8 if not puffy else 12,
              rot=(0, math.pi / 2, 0), smooth=puffy)
    parts.append(cap)
    o = join(parts, name)
    if sag: sag_mesh(o, w + 2 * over, sag, h)
    o.location = loc
    o.rotation_euler = (0, 0, rot_z)
    return o

def roof_z(y, d, h, over):
    """Height of a gable roof's surface at distance y from the ridge (ridge along X)."""
    half = d / 2 + over
    return h * (1 - abs(y) / half)

def block(name, M, W, D, H, RH, front_gable=False, over=0.16, rows=5, sag=0.05, z0=0.0, wall_mat=None, roof_mat=None, puffy=False, thick=0.09, x=0.0, y=0.0, rnd=None):
    """Walls + attic gable + roof + barge boards for one rectangular block.
    front_gable puts the ridge along Y so the gable faces the camera."""
    parts = []
    parts.append(walls(f"{name}_w", M, W, D, H, loc=(x, y, z0), mat=wall_mat))
    rw, rd = (D, W) if front_gable else (W, D)
    rz = math.pi / 2 if front_gable else 0.0
    g = gable_fill(f"{name}_g", M, rw, rd, RH, 0, mat=wall_mat)
    g.location = (x, y, z0 + H); g.rotation_euler = (0, 0, rz); parts.append(g)
    parts.append(gable_roof(f"{name}_r", rw, rd, RH, M, over=over, rows=rows, sag=sag, loc=(x, y, z0 + H), rot_z=rz, mat=roof_mat, puffy=puffy, thick=thick, rnd=rnd))
    if not puffy:
        b = barge_boards(f"{name}_b", rw, rd, RH, M, over=over); b.location = (x, y, z0 + H); b.rotation_euler = (0, 0, rz); parts.append(b)
    return parts

def barge_boards(name, w, d, h, M, over=0.16, loc=(0, 0, 0)):
    """Chunky trim boards up the gable edges."""
    half = d / 2 + over
    ang = math.atan2(h, half); L = math.hypot(half, h)
    parts = []
    for sx in (-1, 1):
        for s in (-1, 1):
            y = s * half / 2; z = h / 2 - 0.02
            parts.append(box(f"{name}_b{sx}{s}", (0.06, L + 0.06, 0.1), (sx * (w / 2 + over + 0.01), y, z), M["trim"], bev=0.02, base=False,
                             rot=(-s * ang, 0, 0)))
    o = join(parts, name); o.location = loc
    return o

def lean_roof(name, w, d, h, M, over=0.14, rows=3, loc=(0, 0, 0), mat=None, rnd=None):
    """A single slope falling toward -Y (front) from height h at the back."""
    rnd = rnd or random.Random(2)
    mat = mat or M["roof"]
    ang = math.atan2(h, d + over); slope = math.hypot(d + over, h)
    parts = []
    for i in range(rows):
        seg = slope / rows * 1.22; mid = (i + 0.5) / rows * slope
        y = -(d / 2 + over) + math.cos(ang) * mid
        z = math.sin(ang) * mid - 0.05
        parts.append(box(f"{name}_r{i}", (w + 2 * over + rnd.uniform(-0.02, 0.02), seg, 0.08), (0, y, z), mat, bev=0.024, base=False, rot=(ang, 0, 0)))
    o = join(parts, name); o.location = loc
    return o

def window(name, M, loc, w=0.3, h=0.32, face="-Y", shutters=True, box_flowers=False, round_top=False, rnd=None):
    """A deep-set window on a wall facing `face`. loc is the wall-surface centre."""
    rnd = rnd or random.Random(3)
    parts = []
    # frame and glass in local space facing -Y, then rotated
    parts.append(box(f"{name}_frame", (w + 0.08, 0.05, h + 0.08), (0, -0.01, -(h + 0.08) / 2), M["trim"], bev=0.015))
    parts.append(box(f"{name}_glass", (w, 0.04, h), (0, 0.005, -h / 2), M["win"]))
    parts.append(box(f"{name}_mv", (0.025, 0.06, h), (0, -0.012, -h / 2), M["trim"]))  # mullions stay sharp
    parts.append(box(f"{name}_mh", (w, 0.06, 0.025), (0, -0.012, -0.0125), M["trim"]))
    parts.append(box(f"{name}_sill", (w + 0.14, 0.1, 0.035), (0, -0.04, -h / 2 - 0.06), M["trim"], bev=0.012))
    if shutters:
        for sx in (-1, 1):
            parts.append(box(f"{name}_sh{sx}", (w * 0.5, 0.03, h + 0.04), (sx * (w / 2 + w * 0.27 + 0.02), -0.02, -(h + 0.04) / 2), M["shutter"], bev=0.01))
    if box_flowers:
        parts.append(box(f"{name}_fb", (w + 0.1, 0.09, 0.08), (0, -0.08, -h / 2 - 0.13), M["wood"], bev=0.015))
        for k in range(4):
            fm = (M["fl1"], M["fl2"], M["fl3"], M["fl1"])[k]
            parts.append(sphere(f"{name}_f{k}", 0.04, (-w / 2 + 0.03 + k * (w - 0.06) / 3, -0.08, h / 2 * -1 - 0.03), fm, sub=0))
        parts.append(sphere(f"{name}_lv", 0.06, (0, -0.08, -h / 2 - 0.05), M["leaf"], sub=1, scale=(2.2, 0.7, 0.6)))
    o = join(parts, name)
    for v in o.data.vertices: v.co.z += h / 2      # centre vertically on loc
    rz = {"-Y": 0, "+Y": math.pi, "+X": math.pi / 2, "-X": -math.pi / 2}[face]
    o.rotation_euler = (0, 0, rz); o.location = loc
    em = empty(f"pt_glow_win", loc);
    return [o, em]

def door(name, M, loc, w=0.34, h=0.56, face="-Y"):
    parts = []
    parts.append(poly_extrude(f"{name}_frame", arch_pts(w + 0.1, h + 0.06, 8), 0.06, (0, -0.0, 0), M["trim"], bev=0.012))
    parts.append(poly_extrude(f"{name}_leaf", arch_pts(w, h, 8), 0.07, (0, -0.012, 0), M["door"]))
    for k in (-1, 1):
        parts.append(box(f"{name}_pl{k}", (0.012, 0.075, h - 0.12), (k * w / 6, -0.015, 0.03), M["trim"]))
    parts.append(box(f"{name}_hinge", (w * 0.7, 0.08, 0.025), (0, -0.016, h * 0.25), M["metal"]))
    parts.append(sphere(f"{name}_knob", 0.022, (w * 0.32, -0.06, h * 0.45), M["metal"], sub=1))
    parts.append(box(f"{name}_step", (w + 0.22, 0.2, 0.06), (0, -0.1, -0.03), M["stone"], bev=0.02))
    o = join(parts, name)
    rz = {"-Y": 0, "+Y": math.pi, "+X": math.pi / 2, "-X": -math.pi / 2}[face]
    o.rotation_euler = (0, 0, rz); o.location = loc
    return o

def plinth(name, M, w, d, z=0.0, r=0.075, rnd=None):
    """Rounded cobbles around the base of a wall."""
    rnd = rnd or random.Random(4)
    parts = []
    def run(x0, y0, x1, y1):
        L = math.hypot(x1 - x0, y1 - y0); n = max(2, int(L / (r * 1.7)))
        for k in range(n + 1):
            t = k / n
            mm = M["stone"] if rnd.random() < 0.6 else M["stone2"]
            parts.append(sphere(f"{name}_{len(parts)}", r * rnd.uniform(0.85, 1.15), (x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, z + r * 0.55), mm, sub=0,
                                scale=(1.25, 1.0, 0.75)))
    hw, hd = w / 2 + 0.02, d / 2 + 0.02
    run(-hw, -hd, hw, -hd); run(hw, -hd, hw, hd); run(hw, hd, -hw, hd); run(-hw, hd, -hw, -hd)
    return join(parts, name)

def chimney(name, M, loc, h=0.8, lean=0.06, rnd=None):
    rnd = rnd or random.Random(5)
    parts = []
    z = 0; n = 4
    for k in range(n):
        hh = h / n
        parts.append(box(f"{name}_{k}", (0.24 + rnd.uniform(-0.02, 0.02), 0.24 + rnd.uniform(-0.02, 0.02), hh * 1.02),
                         (rnd.uniform(-0.012, 0.012), rnd.uniform(-0.012, 0.012), z), M["chim"] if k % 2 == 0 else M["stone2"], bev=0.025))
        z += hh
    parts.append(box(f"{name}_cap", (0.32, 0.32, 0.06), (0, 0, z), M["stone2"], bev=0.02))
    parts.append(box(f"{name}_pot", (0.12, 0.12, 0.08), (0, 0, z + 0.06), M["chim"], bev=0.02))
    o = join(parts, name)
    o.location = loc; o.rotation_euler = (lean, -lean * 0.6, 0)
    bpy.context.view_layer.update()
    top = o.matrix_world @ Vector((0, 0, z + 0.16))
    return [o, empty("pt_smoke", tuple(top))]

def walls(name, M, w, d, h, loc=(0, 0, 0), mat=None, taper=0.985):
    return box(name, (w, d, h), loc, mat or M["wall"], bev=0.035, segs=2, taper=taper)

def gable_fill(name, M, w, d, h, z, mat=None):
    """The attic triangle under a gable roof (ridge along X)."""
    return prism(name, w - 0.02, d - 0.02, h - 0.04, (0, 0, z), mat or M["wall"])

def timber_frame(name, M, w, d, h, z0=0.0, braces=True):
    parts = []
    hw, hd = w / 2 + 0.012, d / 2 + 0.012
    for x in (-hw, hw):
        for y in (-hd, hd):
            parts.append(box(f"{name}_c{len(parts)}", (0.075, 0.075, h), (x, y, z0), M["trim"], bev=0.015))
    for y in (-hd, hd):
        parts.append(box(f"{name}_hb{y}", (w + 0.04, 0.06, 0.06), (0, y, z0 + h * 0.52), M["trim"]))
        parts.append(box(f"{name}_tb{y}", (w + 0.06, 0.07, 0.07), (0, y, z0 + h - 0.06), M["trim"], bev=0.012))
    for x in (-hw, hw):
        parts.append(box(f"{name}_sb{x}", (0.06, d + 0.04, 0.06), (x, 0, z0 + h * 0.52), M["trim"]))
        parts.append(box(f"{name}_st{x}", (0.07, d + 0.06, 0.07), (x, 0, z0 + h - 0.06), M["trim"], bev=0.012))
        if braces:
            for s in (-1, 1):
                L = math.hypot(d * 0.3, h * 0.42)
                parts.append(box(f"{name}_br{x}{s}", (0.05, 0.05, L), (x, s * d * 0.3, z0 + h * 0.55), M["trim"],
                                 rot=(s * math.atan2(d * 0.3, h * 0.42), 0, 0)))
    return join(parts, name)

def pad(name, M, w, d):
    return box(name, (w, d, 0.06), (0, 0, -0.02), M["pad"], bev=0.025)

def bush(name, M, loc, r=0.14, rnd=None):
    rnd = rnd or random.Random(6)
    parts = [sphere(f"{name}_{k}", r * rnd.uniform(0.7, 1.0), (loc[0] + rnd.uniform(-r, r) * 0.6, loc[1] + rnd.uniform(-r, r) * 0.6, loc[2] + r * 0.6 + k * 0.03), M["leaf"], sub=1) for k in range(3)]
    if rnd.random() < 0.7:
        fm = M["fl1"] if rnd.random() < 0.5 else M["fl2"]
        for k in range(3): parts.append(sphere(f"{name}_f{k}", 0.035, (loc[0] + rnd.uniform(-r, r) * 0.7, loc[1] - r * 0.6, loc[2] + r * rnd.uniform(0.7, 1.3)), fm, sub=0))
    return join(parts, name)
