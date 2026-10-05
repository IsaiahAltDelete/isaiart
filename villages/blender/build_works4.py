# Civic and leisure buildings: Town Hall, Park, Pub, Bathhouse, Theatre,
# Arcane University and the Watch House.
# Footprints as in build_works.py: 2x2 -> +-0.95, 3x2 -> x +-1.45, y +-0.95,
# 3x3 -> +-1.45. Fronts (doors, stages) face -Y like every other building.
import math, random

def xslots():
    M = wslots()
    M.update(flag=material("flag", 0x3f6fc9), verd=material("verdigris", 0x5fae9a), gravel=material("gravel", 0xdccca6),
             soil=material("soil", 0x7a5434), steam=material("steam", 0xffffff, True), towel=material("towel", 0x2f9e98),
             towel2=material("towel2", 0xf28fa6), curtain=material("curtain", 0xc23a3a, True), sky=material("backdrop", 0x8fcbef),
             hill=material("hill", 0x7cc04a), magic=material("magic", 0xc9a8ff, True), rune=material("rune", 0x8a6cf0),
             lily=material("lily", 0x4f9a3a), leafs=material("leaf", 0x56a83c, True), leafs2=material("leaf2", 0x65b744, True),
             bark=material("bark", 0x7a4e2c), pale=material("pale", 0xeee6d6))
    return M

def stones_ring(name, M, r, n, size, z=0.0, mat=None, h=None):
    """A ring of dressed stones (a pond or pool rim)."""
    parts = []
    for k in range(n):
        a = k / n * math.pi * 2
        parts.append(box(f"{name}{k}", (size * 1.6, size, h or size * 0.8), (math.cos(a) * r, math.sin(a) * r, z), mat or M["cut"], bev=size * 0.22,
                         rot=(0, 0, a + math.pi / 2)))
    return parts

def offset(parts, dx, dy, dz=0.0):
    for p in parts: p.location.x += dx; p.location.y += dy; p.location.z += dz
    return parts

def bunting(name, M, p0, p1, n=7, sag=0.12, cols=None, s=0.1):
    """A string of pennants between two points, drooping in the middle."""
    cols = cols or [M["red"], M["gold"], M["flag"], M["shutter"], M["fl1"]]
    p0, p1 = Vector(p0), Vector(p1)
    ang = math.atan2(p1.y - p0.y, p1.x - p0.x)
    pts = []
    for k in range(n * 2 + 1):
        t = k / (n * 2)
        p = p0.lerp(p1, t); p.z -= sag * 4 * t * (1 - t); pts.append(p)
    parts = [beam(f"{name}_s{k}", pts[k], pts[k + 1], 0.012, 0.012, M["rope"]) for k in range(len(pts) - 1)]
    for k in range(n):
        p = pts[k * 2 + 1]
        f = poly_extrude(f"{name}_f{k}", [(-s / 2, 0), (s / 2, 0), (0, -s * 1.3)], 0.012, (p.x, p.y, p.z), cols[k % len(cols)])
        f.rotation_euler = (0, 0, ang); parts.append(f)
    return parts

def tankard(name, M, loc, s=1.0, rot=0.0):
    x, y, z = loc
    parts = [cyl(f"{name}_m", 0.035 * s, 0.038 * s, 0.08 * s, (x, y, z), M["wood"], seg=8),
             cyl(f"{name}_f", 0.04 * s, 0.04 * s, 0.025 * s, (x, y, z + 0.075 * s), M["white"], seg=8, bev=0.008 * s),
             box(f"{name}_h", (0.025 * s, 0.015 * s, 0.05 * s), (x + 0.045 * s, y, z + 0.015 * s), M["wood"])]
    return parts

def ptree(name, M, x, y, s=1.0):
    """A small round park tree: a trunk and a few smooth puffs."""
    parts = [cyl(f"{name}_t", 0.06 * s, 0.045 * s, 0.5 * s, (x, y, 0), M["bark"], seg=6),
             cyl(f"{name}_fl", 0.1 * s, 0.05 * s, 0.07 * s, (x, y, 0), M["bark"], seg=6)]
    for k, (dx, dy, dz, r) in enumerate([(0, 0, 0.66, 0.3), (0.16, -0.05, 0.54, 0.21), (-0.15, -0.06, 0.56, 0.22), (0.02, 0.06, 0.86, 0.2)]):
        parts.append(uvsphere(f"{name}_c{k}", r * s, (x + dx * s, y + dy * s, dz * s), M["leafs"] if k % 2 == 0 else M["leafs2"], seg=11, rings=6,
                              scale=(1, 1, 0.92), rot=(k * 0.6, k * 0.9, 0)))
    return parts

def flower_bed(name, M, x, y, rx, ry, n=9, rnd=None, edge=True):
    rnd = rnd or random.Random(7)
    parts = [cyl(f"{name}_soil", 1.0, 1.0, 0.05, (x, y, 0.005), M["soil"], seg=14)]
    parts[-1].scale = (rx, ry, 1)
    if edge:
        for k in range(14):
            a = k / 14 * math.pi * 2
            parts.append(sphere(f"{name}_e{k}", 0.045, (x + math.cos(a) * (rx + 0.02), y + math.sin(a) * (ry + 0.02), 0.03), M["stone"] if k % 2 else M["stone2"], sub=0,
                                scale=(1.3, 1.0, 0.7)))
    cols = [M["fl1"], M["fl2"], M["purple"], M["fl3"], M["orange"], M["red"]]
    for k in range(n):
        a = rnd.uniform(0, math.pi * 2); d = rnd.uniform(0, 0.75)
        fx, fy = x + math.cos(a) * rx * d, y + math.sin(a) * ry * d
        parts.append(sphere(f"{name}_l{k}", 0.06, (fx, fy, 0.06), M["leaf"], sub=1, scale=(1.2, 1.2, 0.7)))
        parts.append(sphere(f"{name}_f{k}", 0.045, (fx + 0.01, fy - 0.01, 0.12), cols[k % len(cols)], sub=1))
    return parts

def park_bench(name, M, x, y, rz):
    parts = []
    for k in range(3): parts.append(box(f"{name}s{k}", (0.6, 0.065, 0.035), (0, -0.07 + k * 0.07, 0.2), M["plank"], bev=0.008))
    for k in range(2): parts.append(box(f"{name}b{k}", (0.6, 0.035, 0.06), (0, 0.11, 0.3 + k * 0.085), M["plank"], bev=0.008, rot=(-0.15, 0, 0)))
    for sx in (-0.25, 0.25):
        parts.append(box(f"{name}l{sx}", (0.04, 0.24, 0.2), (sx, 0.0, 0), M["metal"], bev=0.008))
        parts.append(box(f"{name}a{sx}", (0.04, 0.04, 0.22), (sx, 0.11, 0.2), M["metal"]))
    o = join(parts, name); o.rotation_euler = (0, 0, rz); o.location = (x, y, 0)
    return o

def lamp_post(name, M, x, y, h=1.0):
    parts = [cyl(f"{name}_b", 0.07, 0.08, 0.08, (x, y, 0), M["metal"], seg=8),
             cyl(f"{name}_p", 0.025, 0.035, h, (x, y, 0.06), M["metal"], seg=8),
             box(f"{name}_g", (0.13, 0.13, 0.17), (x, y, h + 0.04), M["glow"], bev=0.02),
             box(f"{name}_c", (0.16, 0.16, 0.03), (x, y, h + 0.03), M["metal"]),
             cyl(f"{name}_h", 0.13, 0.02, 0.1, (x, y, h + 0.21), M["metal"], seg=4, rot=(0, 0, math.pi / 4)),
             sphere(f"{name}_k", 0.025, (x, y, h + 0.32), M["metal"], sub=0)]
    return parts, empty("pt_glow_lamp", (x, y, h + 0.12))

# ── Town Hall (3x2): stone below, timber above, a clock cupola flying the town flag ──
def build_townhall():
    M = xslots(); rnd = random.Random(81)
    root = empty("townhall", (0, 0, 0)); P, E = [pad("pad", M, 2.85, 1.9)], []
    W, D = 2.1, 1.1; cy = 0.32; H0 = 0.82
    fy = cy - D / 2
    P.append(plinth("plinth", M, W, D, rnd=rnd)); P[-1].location = (0, cy, 0)
    P.append(walls("ground", M, W, D, H0, loc=(0, cy, 0), mat=M["stone"]))
    P.append(box("jetty", (W + 0.14, D + 0.14, 0.08), (0, cy, H0), M["trim"], bev=0.02))
    P += block("upper", M, W + 0.08, D + 0.08, 0.66, 0.72, over=0.15, rows=5, sag=0.05, z0=H0 + 0.06, y=cy, rnd=rnd)
    P.append(timber_frame("frame", M, W + 0.08, D + 0.08, 0.66, H0 + 0.06, braces=True)); P[-1].location = (0, cy, 0)
    ridge = H0 + 0.06 + 0.66 + 0.72
    # a columned porch: a raised landing, steps, a little pediment over the double doors
    P.append(box("landing", (0.96, 0.44, 0.15), (0, fy - 0.2, 0), M["cut"], bev=0.02))
    P.append(box("step1", (0.86, 0.14, 0.1), (0, fy - 0.48, 0), M["stone"], bev=0.02))
    P.append(box("step0", (0.96, 0.14, 0.05), (0, fy - 0.6, 0), M["stone2"], bev=0.015))
    P.append(poly_extrude("arch", arch_pts(0.6, 0.78, 8), 0.08, (0, fy - 0.02, 0.15), M["cut"], bev=0.015))
    P.append(poly_extrude("dleaf", arch_pts(0.48, 0.7, 8), 0.09, (0, fy - 0.035, 0.15), M["door"]))
    P.append(box("dsplit", (0.02, 0.1, 0.6), (0, fy - 0.05, 0.15), M["dark"]))
    for x in (-0.06, 0.06): P.append(sphere(f"ring{x}", 0.025, (x, fy - 0.1, 0.5), M["gold"], sub=1))
    for x in (-0.38, 0.38):
        P.append(box(f"colb{x}", (0.14, 0.14, 0.06), (x, fy - 0.36, 0.15), M["cut"], bev=0.015))
        P.append(cyl(f"col{x}", 0.055, 0.06, 0.74, (x, fy - 0.36, 0.2), M["white"], seg=10, bev=0.01))
        P.append(box(f"colt{x}", (0.14, 0.14, 0.05), (x, fy - 0.36, 0.93), M["cut"], bev=0.015))
    P.append(box("lintel", (0.98, 0.46, 0.07), (0, fy - 0.2, 0.97), M["cut"], bev=0.015))
    P.append(gable_roof("proof", 0.5, 0.98, 0.3, M, over=0.06, thick=0.07, sag=0, loc=(0, fy - 0.2, 1.04), rot_z=math.pi / 2, snow=False))
    g = gable_fill("pfill", M, 0.48, 0.98, 0.3, 0, mat=M["white"]); g.location = (0, fy - 0.2, 1.04); g.rotation_euler = (0, 0, math.pi / 2); P.append(g)
    P.append(cyl("pboss", 0.07, 0.07, 0.04, (0, fy - 0.44, 1.14), M["gold"], seg=10, rot=(math.pi / 2, 0, 0)))
    for x in (-0.78, 0.78): E += window(f"g{x}", M, (x, fy - 0.01, 0.52), w=0.28, h=0.34, shutters=True)
    for x in (-0.68, 0.68): E += window(f"u{x}", M, (x, fy - 0.05, 1.3), w=0.26, h=0.28, box_flowers=True)
    P += shield_sign("crest", M, (0, fy - 0.07, 1.36), 0.26, col="flag")
    E += window("side", M, (W / 2 + 0.01, cy, 0.5), w=0.26, h=0.32, face="+X", shutters=False)
    # hero: a clock cupola on the ridge, its copper cap flying the town flag
    cz = ridge - 0.42
    P.append(box("cbase", (0.52, 0.52, 0.78), (0, cy, cz), M["white"], bev=0.02))
    P.append(box("cbase_t", (0.6, 0.6, 0.07), (0, cy, cz + 0.78), M["trim"], bev=0.015))
    for k, (fx, fyy, rz) in enumerate([(0, cy - 0.265, 0), (0.265, cy, math.pi / 2)]):
        cl = [cyl(f"cl_rim{k}", 0.17, 0.17, 0.03, (0, 0, 0), M["gold"], seg=16, rot=(math.pi / 2, 0, 0)),
              cyl(f"cl_face{k}", 0.14, 0.14, 0.045, (0, 0, 0), M["cloth"], seg=16, rot=(math.pi / 2, 0, 0)),
              box(f"cl_h{k}", (0.024, 0.02, 0.085), (0, -0.05, 0), M["dark"]),
              box(f"cl_m{k}", (0.018, 0.02, 0.115), (0, -0.055, 0), M["dark"], rot=(0, -2.0, 0)),
              sphere(f"cl_c{k}", 0.022, (0, -0.055, 0), M["gold"], sub=0)]
        for j in range(4):
            a = j * math.pi / 2
            cl.append(box(f"cl_t{k}{j}", (0.02, 0.02, 0.03), (math.cos(a) * 0.11, -0.05, math.sin(a) * 0.11), M["dark"], base=False, rot=(0, -a + math.pi / 2, 0)))
        o = join(cl, f"clock{k}"); o.rotation_euler = (0, 0, rz); o.location = (fx, fyy, cz + 0.52)
        P.append(o)
    bz = cz + 0.85
    for x in (-0.2, 0.2):
        for y in (-0.2, 0.2): P.append(box(f"bpost{x}{y}", (0.07, 0.07, 0.42), (x, cy + y, bz), M["white"], bev=0.01))
    P.append(cyl("bell", 0.06, 0.13, 0.18, (0, cy, bz + 0.12), M["gold"], seg=12, smooth=True))
    P.append(cyl("bell_l", 0.135, 0.135, 0.025, (0, cy, bz + 0.11), M["gold"], seg=12))
    P.append(box("btop", (0.54, 0.54, 0.06), (0, cy, bz + 0.42), M["trim"], bev=0.015))
    P.append(cyl("cdome", 0.36, 0.0, 0.62, (0, cy, bz + 0.48), M["verd"], seg=8, bev=0.02, rot=(0, 0, math.pi / 8)))
    P.append(sphere("cknob", 0.055, (0, cy, bz + 1.08), M["gold"], sub=1))
    pz = bz + 1.08
    P.append(cyl("fpole", 0.02, 0.025, 0.72, (0, cy, pz), M["dark"], seg=6))
    P.append(sphere("fknob", 0.04, (0, cy, pz + 0.74), M["gold"], sub=1))
    flag = empty("anim_flagMesh", (0, cy, pz + 0.5))
    fl = [box("flag_c", (0.56, 0.02, 0.34), (0.3, cy, pz + 0.36), M["flag"], bev=0.005),
          box("flag_s", (0.56, 0.026, 0.06), (0.3, cy, pz + 0.5), M["gold"]),
          sphere("flag_e", 0.07, (0.3, cy, pz + 0.53), M["gold"], sub=0, scale=(1, 0.35, 1))]
    f = join(fl, "flag"); parent(f, flag); parent(flag, root)
    E += chimney("chim", M, (-0.75, cy + 0.32, ridge - 0.5), h=0.55, lean=0.03, rnd=rnd)
    # notice board for proclamations, and tubs of flowers by the steps
    nx, ny = -1.0, -0.66
    P.append(box("nboard", (0.5, 0.05, 0.38), (nx, ny, 0.42), M["wood"], bev=0.015))
    for x in (nx - 0.21, nx + 0.21): P.append(box(f"nl{x}", (0.05, 0.05, 0.86), (x, ny + 0.02, 0), M["dark"]))
    P.append(box("nroof", (0.64, 0.2, 0.04), (nx, ny, 0.87), M["roof"], rot=(0.25, 0, 0)))
    for k, (x, z) in enumerate([(-0.13, 0.62), (0.02, 0.66), (0.14, 0.6), (-0.07, 0.48), (0.1, 0.47)]):
        P.append(box(f"note{k}", (0.1, 0.012, 0.12), (nx + x, ny - 0.035, z), M["cloth"] if k != 1 else M["gold"], rot=(0, rnd.uniform(-0.2, 0.2), 0)))
    P.append(sphere("seal", 0.02, (nx + 0.02, ny - 0.045, 0.64), M["red"], sub=0))
    for x in (-0.62, 0.62):
        P.append(cyl(f"tub{x}", 0.13, 0.11, 0.16, (x, -0.82, 0), M["brick"], seg=8, bev=0.015))
        for j in range(4): P.append(sphere(f"tf{x}{j}", 0.055, (x - 0.05 + (j % 2) * 0.1, -0.82 - 0.04 + (j // 2) * 0.08, 0.2), [M["fl1"], M["fl2"], M["fl3"], M["leaf"]][j], sub=0))
    return finish(root, P, E)

# ── Park (3x3): a lawn, a curving gravel path, a lily pond and a white bandstand ──
def build_park():
    M = xslots(); rnd = random.Random(82)
    root = empty("park", (0, 0, 0)); P, E = [ground("g", 2.85, 2.85, 0x86c25a)], []
    # the path: a gentle S from the front edge up to the bandstand steps
    ctrl = [Vector((0.15, -1.45, 0)), Vector((0.1, -0.5, 0)), Vector((-0.75, -0.25, 0)), Vector((-0.65, 0.3, 0))]
    def bez(t):
        a, b, c, d = ctrl
        return a * (1 - t) ** 3 + b * 3 * (1 - t) ** 2 * t + c * 3 * (1 - t) * t ** 2 + d * t ** 3
    n = 16
    for k in range(n):
        p0, p1 = bez(k / n), bez((k + 1) / n)
        m = (p0 + p1) / 2; L = (p1 - p0).length
        P.append(box(f"path{k}", (0.36, L + 0.06, 0.02), (m.x, m.y, 0.025), M["gravel"], bev=0.01, rot=(0, 0, math.atan2(p1.y - p0.y, p1.x - p0.x) - math.pi / 2)))
        if k % 2 == 0:
            for s in (-1, 1):
                d = (p1 - p0).normalized(); nrm = Vector((-d.y, d.x, 0))
                q = m + nrm * s * 0.21
                P.append(sphere(f"pe{k}{s}", 0.035, (q.x, q.y, 0.04), M["stone"], sub=0, scale=(1.3, 1, 0.6)))
    # hero 1: a round lily pond with a stone rim, lily pads and a little duck
    px, py, pr = 0.62, 0.42, 0.5
    P.append(cyl("pbed", pr + 0.04, pr + 0.04, 0.03, (px, py, 0.01), M["stone2"], seg=18))
    P.append(cyl("pwater", pr, pr, 0.02, (px, py, 0.045), M["water"], seg=18))
    P += offset(stones_ring("prim", M, pr + 0.04, 16, 0.11, z=0.0, mat=M["cut"], h=0.09), px, py)
    for k, (dx, dy, r) in enumerate([(-0.2, -0.12, 0.08), (0.15, 0.18, 0.07), (0.22, -0.18, 0.06), (-0.1, 0.24, 0.06)]):
        P.append(cyl(f"lily{k}", r, r, 0.012, (px + dx, py + dy, 0.064), M["lily"], seg=8))
    P.append(sphere("lotus", 0.035, (px - 0.18, py - 0.12, 0.085), M["fl1"], sub=1, scale=(1, 1, 0.7)))
    duck = [uvsphere("dk_b", 0.06, (px + 0.05, py - 0.02, 0.07), M["white"], seg=8, rings=6, scale=(1.3, 0.9, 0.8)),
            uvsphere("dk_h", 0.035, (px - 0.015, py - 0.02, 0.13), M["white"], seg=8, rings=6),
            cyl("dk_bill", 0.018, 0.008, 0.035, (px - 0.045, py - 0.02, 0.125), M["orange"], seg=6, rot=(0, -math.pi / 2, 0))]
    P += duck
    for k in range(5):
        a = 2.2 + k * 0.32
        P.append(cyl(f"reed{k}", 0.012, 0.008, 0.26 + (k % 2) * 0.08, (px + math.cos(a) * (pr + 0.12), py + math.sin(a) * (pr + 0.12), 0), M["leaf"], seg=4))
        if k % 2 == 0: P.append(uvsphere(f"reedh{k}", 0.02, (px + math.cos(a) * (pr + 0.12), py + math.sin(a) * (pr + 0.12), 0.3), M["trim"], seg=6, rings=4, scale=(1, 1, 2.2)))
    # hero 2: a white bandstand with a domed roof
    gx, gy, gr = -0.72, 0.72, 0.5
    P.append(cyl("gbase", gr + 0.04, gr + 0.06, 0.16, (gx, gy, 0), M["cut"], seg=8, bev=0.02, rot=(0, 0, math.pi / 8)))
    P.append(cyl("gfloor", gr, gr, 0.03, (gx, gy, 0.16), M["plank"], seg=8, rot=(0, 0, math.pi / 8)))
    P.append(box("gstep", (0.36, 0.16, 0.08), (gx + 0.0, gy - gr - 0.04, 0), M["cut"], bev=0.015))
    for k in range(8):
        a = k / 8 * math.pi * 2 + math.pi / 8
        x, y = gx + math.cos(a) * (gr - 0.05), gy + math.sin(a) * (gr - 0.05)
        P.append(cyl(f"gcol{k}", 0.03, 0.03, 0.72, (x, y, 0.18), M["white"], seg=6))
        # a low rail between the posts, open at the front for the steps
        a2 = a + math.pi / 4
        if math.sin(a + math.pi / 8) > -0.9:
            x2, y2 = gx + math.cos(a2) * (gr - 0.05), gy + math.sin(a2) * (gr - 0.05)
            P.append(beam(f"grail{k}", (x, y, 0.36), (x2, y2, 0.36), 0.03, 0.03, M["white"]))
    P.append(cyl("gring", gr + 0.06, gr + 0.06, 0.07, (gx, gy, 0.9), M["white"], seg=8, bev=0.015, rot=(0, 0, math.pi / 8)))
    P.append(uvsphere("gdome", gr + 0.08, (gx, gy, 0.96), M["flag"], seg=16, rings=10, scale=(1, 1, 0.62), cut=0.0))
    for k in range(8):
        a = k / 8 * math.pi * 2 + math.pi / 8
        P.append(sphere(f"gscal{k}", 0.05, (gx + math.cos(a) * (gr + 0.06), gy + math.sin(a) * (gr + 0.06), 0.9), M["white"], sub=0))
    P.append(cyl("gfin", 0.03, 0.0, 0.2, (gx, gy, 1.3), M["gold"], seg=6))
    P.append(sphere("gfinb", 0.05, (gx, gy, 1.32), M["gold"], sub=1))
    # trees, flower beds, benches and a lamp
    P += ptree("t1", M, 1.12, -0.95, 0.9); P += ptree("t2", M, -1.12, -0.35, 1.05); P += ptree("t3", M, 1.1, 1.12, 0.85)
    P += flower_bed("fb1", M, -0.72, -1.0, 0.36, 0.22, n=8, rnd=rnd)
    P += flower_bed("fb2", M, 0.62, -0.42, 0.3, 0.16, n=6, rnd=rnd)
    P += flower_bed("fb3", M, -0.05, 1.18, 0.36, 0.16, n=7, rnd=rnd)
    P.append(park_bench("bench1", M, 0.52, -0.95, math.pi / 2 + 0.05))
    P.append(park_bench("bench2", M, -0.28, 0.12, -0.35))
    lp, le = lamp_post("lamp", M, -0.3, -0.72, 0.9); P += lp; E.append(le)
    return finish(root, P, E)

# ── Pub (2x2): a low, snug alehouse with dark timbers and a painted tankard sign ──
def build_pub():
    M = xslots(); rnd = random.Random(83)
    M["door"] = material("door", 0x2f8a7e); M["trim"] = material("trim", 0x4e3220)
    root = empty("pub", (0, 0, 0)); P, E = [pad("pad", M, 1.9, 1.9)], []
    W, D, H = 1.5, 0.95, 0.78; cy = 0.3; fy = cy - D / 2
    P.append(plinth("plinth", M, W, D, rnd=rnd)); P[-1].location = (0, cy, 0)
    P.append(walls("walls", M, W, D, H, loc=(0, cy, 0), mat=M["wall"]))
    P.append(box("dado", (W + 0.03, D + 0.03, 0.22), (0, cy, 0), M["stone"], bev=0.02))
    P.append(timber_frame("frame", M, W, D, H, 0.0, braces=True)); P[-1].location = (0, cy, 0)
    g = gable_fill("gable", M, W, D, 0.5, 0); g.location = (0, cy, H); P.append(g)
    P.append(gable_roof("roof", W, D, 0.5, M, over=0.14, thick=0.11, rows=3, sag=0.06, loc=(0, cy, H), mat=M["thatch"], puffy=True, rnd=rnd))
    # a teal door under a little hood, glowing bay windows either side
    P.append(door("door", M, (-0.22, fy - 0.01, 0.0), w=0.3, h=0.52))
    P.append(box("hood", (0.48, 0.22, 0.04), (-0.22, fy - 0.1, 0.64), M["dark"], rot=(0.3, 0, 0)))
    for x in (-0.34, -0.1): P.append(box(f"hbr{x}", (0.03, 0.14, 0.03), (x, fy - 0.07, 0.58), M["trim"], rot=(-0.6, 0, 0)))
    for x in (0.38,):
        P.append(box("bay", (0.5, 0.16, 0.36), (x, fy - 0.08, 0.18), M["trim"], bev=0.02))
        P.append(box("bayg", (0.44, 0.17, 0.28), (x, fy - 0.085, 0.22), M["win"]))
        for k in (-1, 0, 1): P.append(box(f"baym{k}", (0.025, 0.18, 0.28), (x + k * 0.11, fy - 0.09, 0.22), M["trim"]))
        P.append(box("bayh", (0.44, 0.18, 0.02), (x, fy - 0.09, 0.36), M["trim"]))
        P.append(box("bayr", (0.56, 0.22, 0.05), (x, fy - 0.1, 0.54), M["dark"], bev=0.015, rot=(0.25, 0, 0)))
        E.append(empty("pt_glow_win", (x, fy - 0.18, 0.36)))
    E += window("wl", M, (-0.6, fy - 0.01, 0.46), w=0.18, h=0.22, shutters=False)
    E += window("ws", M, (W / 2 + 0.01, cy, 0.42), w=0.24, h=0.24, face="+X", shutters=False)
    E += chimney("chim", M, (0.5, cy + 0.18, H + 0.2), h=0.6, lean=0.05, rnd=rnd)
    # hero: a painted signboard on an iron bracket, a giant foaming tankard on it
    sx, sy = -0.8, fy - 0.38
    P.append(box("spost", (0.07, 0.07, 1.2), (sx, sy, 0), M["dark"], bev=0.012))
    P.append(box("sarm", (0.56, 0.05, 0.05), (sx + 0.25, sy, 1.12), M["metal"]))
    P.append(box("sbrace", (0.03, 0.03, 0.34), (sx + 0.12, sy, 0.92), M["metal"], rot=(0, -0.78, 0)))
    for x in (0.12, 0.42): P.append(box(f"schain{x}", (0.015, 0.015, 0.1), (sx + x, sy, 1.03), M["metal"]))
    bx, bz = sx + 0.27, 0.72
    P.append(box("sboard", (0.5, 0.05, 0.4), (bx, sy, bz), M["shutter"], bev=0.015))
    P.append(box("sframe", (0.56, 0.04, 0.46), (bx, sy + 0.012, bz - 0.03), M["gold"], bev=0.01))
    mug = [box("m_body", (0.18, 0.06, 0.22), (bx - 0.02, sy - 0.03, bz + 0.05), M["gold"], bev=0.02),
           box("m_band", (0.19, 0.065, 0.025), (bx - 0.02, sy - 0.03, bz + 0.1), M["wood"]),
           box("m_band2", (0.19, 0.065, 0.025), (bx - 0.02, sy - 0.03, bz + 0.21), M["wood"]),
           uvsphere("m_foam", 0.11, (bx - 0.02, sy - 0.035, bz + 0.29), M["white"], seg=10, rings=6, scale=(1.0, 0.35, 0.5)),
           sphere("m_drip", 0.03, (bx + 0.06, sy - 0.04, bz + 0.24), M["white"], sub=1),
           cyl("m_handle", 0.065, 0.065, 0.05, (bx + 0.1, sy - 0.005, bz + 0.16), M["gold"], seg=10, rot=(math.pi / 2, 0, 0))]
    P += mug
    # barrels stacked by the wall, an outdoor table with tankards
    P += barrel("b1", M, (-0.62, 0.0, 0), r=0.12, h=0.28)
    P += barrel("b2", M, (-0.38, -0.02, 0), r=0.12, h=0.28)
    for k, x in enumerate((-0.5,)):
        P.append(cyl("b3", 0.11, 0.11, 0.28, (x - 0.14, -0.0, 0.38), M["wood"], seg=10, bev=0.03, rot=(0, math.pi / 2, 0)))
        P.append(cyl("b3e", 0.08, 0.08, 0.01, (x - 0.145, -0.0, 0.38), M["logend"], seg=10, rot=(0, math.pi / 2, 0)))
    tx, ty = 0.42, -0.62
    P.append(box("ttop", (0.6, 0.3, 0.04), (tx, ty, 0.3), M["plank"], bev=0.01))
    for x in (-0.22, 0.22): P.append(box(f"tleg{x}", (0.05, 0.24, 0.3), (tx + x, ty, 0), M["dark"], bev=0.008))
    for s in (-1, 1): P.append(box(f"tbench{s}", (0.6, 0.12, 0.04), (tx, ty + s * 0.26, 0.17), M["plank"], bev=0.008))
    for s in (-1, 1):
        for x in (-0.22, 0.22): P.append(box(f"tbl{s}{x}", (0.04, 0.1, 0.17), (tx + x, ty + s * 0.26, 0), M["dark"]))
    for k, (x, y) in enumerate([(-0.15, -0.04), (0.02, 0.06), (0.18, -0.05)]): P += tankard(f"tk{k}", M, (tx + x, ty + y, 0.34))
    lp = [box("lamp", (0.1, 0.1, 0.13), (-0.42, fy - 0.07, 0.48), M["glow"], bev=0.02), box("lampb", (0.03, 0.08, 0.03), (-0.42, fy - 0.03, 0.6), M["metal"]),
          cyl("lamph", 0.08, 0.02, 0.06, (-0.42, fy - 0.07, 0.6), M["metal"], seg=4, rot=(0, 0, math.pi / 4))]
    P += lp; E.append(empty("pt_glow_lamp", (-0.42, fy - 0.08, 0.55)))
    return finish(root, P, E)

# ── Bathhouse (3x2): a pale domed hall and an outdoor steaming pool on a deck ──
def build_bathhouse():
    M = xslots(); rnd = random.Random(84)
    root = empty("bathhouse", (0, 0, 0)); P, E = [pad("pad", M, 2.85, 1.9)], []
    W, D, H = 1.55, 1.15, 0.95; cx, cy = -0.6, 0.28; fy = cy - D / 2
    P.append(plinth("plinth", M, W, D, rnd=rnd)); P[-1].location = (cx, cy, 0)
    P.append(walls("walls", M, W, D, H, loc=(cx, cy, 0), mat=M["pale"]))
    P.append(box("base", (W + 0.04, D + 0.04, 0.18), (cx, cy, 0), M["cut"], bev=0.02))
    P.append(box("cornice", (W + 0.14, D + 0.14, 0.1), (cx, cy, H - 0.02), M["cut"], bev=0.025))
    P.append(box("parapet", (W + 0.04, D + 0.04, 0.12), (cx, cy, H + 0.08), M["pale"], bev=0.02))
    P.append(box("flat", (W - 0.06, D - 0.06, 0.04), (cx, cy, H + 0.12), M["roof"]))
    # a big tiled dome on a drum, with a lantern on top
    P.append(cyl("drum", 0.46, 0.46, 0.22, (cx, cy, H + 0.12), M["pale"], seg=16, bev=0.02))
    P.append(cyl("drumr", 0.5, 0.5, 0.05, (cx, cy, H + 0.32), M["cut"], seg=16, bev=0.015))
    for k in range(8):
        a = k / 8 * math.pi * 2 + 0.2
        P.append(box(f"dwin{k}", (0.1, 0.03, 0.12), (cx + math.cos(a) * 0.46, cy + math.sin(a) * 0.46, H + 0.16), M["win"], rot=(0, 0, a + math.pi / 2)))
    P.append(uvsphere("dome", 0.5, (cx, cy, H + 0.34), material("roof", 0x3f8fa0, True), seg=18, rings=10, scale=(1, 1, 0.8), cut=0.0))
    for k in range(8):
        a = k / 8 * math.pi * 2
        rib = []
        for j in range(6):
            t0, t1 = j / 6 * math.pi / 2, (j + 1) / 6 * math.pi / 2
            rib.append(beam(f"rib{k}{j}", (cx + math.cos(a) * math.cos(t0) * 0.505, cy + math.sin(a) * math.cos(t0) * 0.505, H + 0.34 + math.sin(t0) * 0.405),
                            (cx + math.cos(a) * math.cos(t1) * 0.505, cy + math.sin(a) * math.cos(t1) * 0.505, H + 0.34 + math.sin(t1) * 0.405), 0.035, 0.035, M["white"]))
        P += rib
    P.append(cyl("lant", 0.1, 0.1, 0.14, (cx, cy, H + 0.72), M["white"], seg=8))
    P.append(cyl("lantc", 0.13, 0.0, 0.14, (cx, cy, H + 0.86), M["roof"], seg=8))
    P.append(sphere("lantk", 0.04, (cx, cy, H + 1.0), M["gold"], sub=1))
    # arched door and windows
    P.append(poly_extrude("dframe", arch_pts(0.44, 0.68, 8), 0.07, (cx, fy - 0.01, 0.0), M["cut"], bev=0.012))
    P.append(poly_extrude("dleaf", arch_pts(0.34, 0.6, 8), 0.08, (cx, fy - 0.02, 0.0), M["towel"]))
    P.append(box("dstep", (0.6, 0.22, 0.06), (cx, fy - 0.12, -0.02), M["cut"], bev=0.02))
    for x in (-0.45, 0.45):
        P.append(poly_extrude(f"wf{x}", arch_pts(0.26, 0.48, 8), 0.06, (cx + x, fy - 0.01, 0.3), M["cut"], bev=0.01))
        P.append(poly_extrude(f"wg{x}", arch_pts(0.18, 0.4, 8), 0.07, (cx + x, fy - 0.018, 0.34), M["win"]))
        E.append(empty("pt_glow_win", (cx + x, fy - 0.05, 0.55)))
    P.append(box("plaque", (0.5, 0.03, 0.12), (cx, fy - 0.03, 0.78), M["towel"], bev=0.01))
    for k in range(3): P.append(uvsphere(f"plq{k}", 0.03, (cx - 0.12 + k * 0.12, fy - 0.05, 0.79 + (k % 2) * 0.02), M["white"], seg=6, rings=4, scale=(1, 0.5, 1.4)))
    # a squat chimney puffing steam from the boiler
    P.append(box("chim", (0.24, 0.24, 0.62), (cx + 0.55, cy + 0.38, H), M["brick"], bev=0.02))
    P.append(box("chimc", (0.3, 0.3, 0.06), (cx + 0.55, cy + 0.38, H + 0.62), M["stone2"], bev=0.015))
    E.append(empty("pt_smoke", (cx + 0.55, cy + 0.38, H + 0.78)))
    # hero: the outdoor pool on a timber deck, with a cloud of steam above it
    qx, qy = 0.82, -0.32
    P.append(box("deck", (1.3, 1.3, 0.1), (qx, qy, 0), M["plank"], bev=0.015))
    for k in range(8): P.append(box(f"dk{k}", (1.3, 0.012, 0.006), (qx, qy - 0.65 + k * 0.1625 + 0.08, 0.1), M["wood"]))
    P.append(cyl("pool_in", 0.5, 0.52, 0.13, (qx, qy, 0.0), M["cut"], seg=18, bev=0.02))
    P.append(cyl("pool_w", 0.46, 0.46, 0.02, (qx, qy, 0.125), M["water"], seg=18))
    P += offset(stones_ring("pool_rim", M, 0.5, 16, 0.12, z=0.1, mat=M["cut"], h=0.09), qx, qy)
    P.append(box("pool_step", (0.3, 0.14, 0.05), (qx - 0.05, qy - 0.62, 0.1), M["cut"], bev=0.015))
    steam = empty("anim_steam", (qx, qy, 0.25))
    puffs = []
    # soft clouds of steam rising off the water in two curling columns
    for w, (wx, wy, z0, n, r0, drift) in enumerate([(-0.14, 0.05, 0.36, 3, 0.15, 0.08), (0.16, -0.08, 0.3, 3, 0.12, -0.06), (0.04, 0.2, 0.62, 2, 0.1, 0.05)]):
        for j in range(n):
            r = r0 * (1 - 0.2 * j)
            cx_, cy_, cz_ = qx + wx + drift * j, qy + wy, z0 + j * r0 * 1.7
            for c, (ox, oy, oz, rr) in enumerate([(0, 0, 0, 1.0), (r * 0.7, 0.02, -r * 0.2, 0.7), (-r * 0.65, -0.02, -r * 0.25, 0.65)]):
                puffs.append(uvsphere(f"puff{w}{j}{c}", r * rr, (cx_ + ox, cy_ + oy, cz_ + oz), M["steam"], seg=10, rings=6, scale=(1, 1, 0.8)))
    sm = join(puffs, "steam"); parent(sm, steam); parent(steam, root)
    E.append(empty("pt_steam", (qx, qy, 0.3)))
    # towels on a rail, a bucket and ladle, a rubber duck
    rx, ry = 1.32, 0.28
    for x in (rx - 0.0,):
        for y in (ry - 0.3, ry + 0.3): P.append(box(f"rp{y}", (0.04, 0.04, 0.55), (x, y, 0.1), M["dark"]))
    P.append(cyl("rbar", 0.018, 0.018, 0.66, (rx, ry - 0.33, 0.6), M["dark"], seg=6, rot=(-math.pi / 2, 0, 0)))
    for k, (y, m) in enumerate([(ry - 0.16, M["towel"]), (ry + 0.02, M["white"]), (ry + 0.18, M["towel2"])]):
        P.append(box(f"tw{k}", (0.07, 0.14, 0.34), (rx, y, 0.29), m, bev=0.015))
        P.append(box(f"twb{k}", (0.075, 0.145, 0.03), (rx, y, 0.34), M["white"] if m is not M["white"] else M["towel"]))
    P.append(cyl("bucket", 0.08, 0.065, 0.12, (0.32, -0.82, 0.1), M["wood"], seg=10, bev=0.01))
    P.append(cyl("bband", 0.082, 0.082, 0.02, (0.32, -0.82, 0.18), M["metal"], seg=10))
    P.append(box("ladle", (0.02, 0.02, 0.22), (0.35, -0.82, 0.18), M["wood"], rot=(0, 0.4, 0)))
    duck = [uvsphere("dk_b", 0.05, (qx + 0.2, qy - 0.18, 0.165), M["gold"], seg=8, rings=6, scale=(1.3, 0.9, 0.8)),
            uvsphere("dk_h", 0.03, (qx + 0.15, qy - 0.18, 0.215), M["gold"], seg=8, rings=6),
            cyl("dk_bill", 0.015, 0.006, 0.03, (qx + 0.125, qy - 0.18, 0.21), M["orange"], seg=6, rot=(0, -math.pi / 2, 0))]
    P += duck
    for k, (x, y) in enumerate([(0.3, 0.3), (-1.35, -0.75)]):
        P.append(cyl(f"pot{k}", 0.12, 0.1, 0.18, (x, y, 0), M["cut"], seg=8, bev=0.015))
        P.append(sphere(f"fern{k}", 0.15, (x, y, 0.26), M["leaf"], sub=1, scale=(1.1, 1.1, 0.8)))
    return finish(root, P, E)

# ── Theatre (3x2): an open-air stage under a painted arch, red curtains, two rows of benches ──
def build_theatre():
    M = xslots(); rnd = random.Random(85)
    root = empty("theatre", (0, 0, 0)); P, E = [pad("pad", M, 2.85, 1.9)], []
    SZ = 0.32; sy0, sy1 = -0.12, 0.88          # stage floor height and depth
    sw = 2.1
    P.append(box("stage", (sw, sy1 - sy0, SZ), (0, (sy0 + sy1) / 2, 0), M["plank"], bev=0.02))
    P.append(box("skirt", (sw + 0.02, 0.04, SZ - 0.04), (0, sy0 - 0.005, 0.0), M["curtain"]))
    for k in range(9): P.append(box(f"sfold{k}", (0.03, 0.05, SZ - 0.05), (-sw / 2 + 0.12 + k * (sw - 0.24) / 8, sy0 - 0.02, 0.0), M["red"]))
    P.append(box("lip", (sw + 0.04, 0.08, 0.05), (0, sy0 + 0.02, SZ - 0.03), M["trim"], bev=0.012))
    for k in range(3): P.append(box(f"stair{k}", (0.32, 0.12, SZ - k * 0.1), (0.85, sy0 - 0.08 - k * 0.1, 0), M["plank"], bev=0.01))
    # the proscenium: posts and a round arch, with a gold crest and masks
    ax0, ax1, az = -0.98, 0.98, SZ
    ay = sy0 + 0.22
    for x in (ax0, ax1):
        P.append(box(f"post{x}", (0.16, 0.16, 1.1), (x, ay, az), M["red"], bev=0.02))
        P.append(box(f"postc{x}", (0.2, 0.2, 0.06), (x, ay, az + 1.1), M["gold"], bev=0.015))
        P.append(box(f"postb{x}", (0.2, 0.2, 0.08), (x, ay, az), M["gold"], bev=0.015))
    outer = [(math.cos(i / 16 * math.pi) * 1.06, math.sin(i / 16 * math.pi) * 0.5) for i in range(17)]
    inner = [(math.cos(i / 16 * math.pi) * 0.9, math.sin(i / 16 * math.pi) * 0.36) for i in range(16, -1, -1)]
    P.append(poly_extrude("archband", outer + inner, 0.14, (0, ay, az + 1.15), M["red"], bev=0.015))
    goutline = [(math.cos(i / 16 * math.pi) * 1.08, math.sin(i / 16 * math.pi) * 0.52) for i in range(17)] + \
               [(math.cos(i / 16 * math.pi) * 1.03, math.sin(i / 16 * math.pi) * 0.47) for i in range(16, -1, -1)]
    P.append(poly_extrude("archgold", goutline, 0.16, (0, ay, az + 1.15), M["gold"]))
    P.append(cyl("crest", 0.13, 0.13, 0.05, (0, ay - 0.08, az + 1.62), M["gold"], seg=14, rot=(math.pi / 2, 0, 0)))
    P.append(sphere("crestg", 0.06, (0, ay - 0.12, az + 1.62), M["flag"], sub=1))
    for s, col in ((-1, M["white"]), (1, M["gold"])):
        mx = s * 0.55
        P.append(uvsphere(f"mask{s}", 0.09, (mx, ay - 0.09, az + 1.38), col, seg=10, rings=6, scale=(1, 0.4, 1.2)))
        for e in (-1, 1): P.append(sphere(f"me{s}{e}", 0.018, (mx + e * 0.035, ay - 0.13, az + 1.41), M["dark"], sub=0))
        P.append(box(f"mm{s}", (0.06, 0.02, 0.014), (mx, ay - 0.13, az + 1.33 + (0 if s > 0 else 0.0)), M["dark"], base=False, rot=(0, s * 0.0, 0)))
    # red curtains drawn back to each side, a scalloped valance
    for s in (-1, 1):
        for k in range(4):
            x = s * (0.88 - k * 0.075)
            o = cyl(f"cur{s}{k}", 0.05, 0.05, 1.2, (x, ay + 0.12, az), M["curtain"], seg=8, smooth=True)
            # pinch the drape into a tie-back halfway down
            for v in o.data.vertices:
                t = v.co.z / 1.2
                pinch = 1 - 0.45 * math.exp(-((t - 0.38) / 0.12) ** 2)
                v.co.x *= pinch; v.co.y *= pinch
                v.co.x -= s * 0.09 * math.exp(-((t - 0.38) / 0.2) ** 2) * (k + 1) * 0.6
            P.append(o)
        P.append(cyl(f"tie{s}", 0.16, 0.16, 0.035, (s * 0.8, ay + 0.12, az + 0.44), M["gold"], seg=8, rot=(0, 0, 0)))
    for k in range(9):
        x = -0.8 + k * 0.2
        P.append(uvsphere(f"val{k}", 0.11, (x, ay + 0.08, az + 1.08), M["curtain"], seg=10, rings=6, scale=(1, 0.35, 0.6)))
    P.append(box("valbar", (1.86, 0.08, 0.08), (0, ay + 0.08, az + 1.12), M["curtain"]))
    for k in range(9): P.append(sphere(f"tas{k}", 0.025, (-0.8 + k * 0.2, ay + 0.03, az + 1.0), M["gold"], sub=0))
    # the painted backdrop: a sky flat with rolling hills, a big sun and a cloud
    by = sy1 - 0.08
    P.append(box("flat", (1.9, 0.05, 1.12), (0, by, az), M["sky"], bev=0.01))
    P.append(box("flatf", (1.98, 0.04, 0.06), (0, by + 0.02, az + 1.1), M["trim"]))
    for x in (-0.97, 0.97): P.append(box(f"flatp{x}", (0.06, 0.06, 1.18), (x, by + 0.02, az), M["trim"]))
    hills = [(-0.94, 0.0), (0.94, 0.0), (0.94, 0.28)] + [(0.94 - i / 12 * 1.88, 0.3 + 0.16 * math.sin(i / 12 * math.pi * 2.0 + 0.6) + 0.06) for i in range(13)] + [(-0.94, 0.3)]
    P.append(poly_extrude("hills", hills, 0.02, (0, by - 0.035, az), M["hill"]))
    hills2 = [(-0.94, 0.0), (0.94, 0.0)] + [(0.94 - i / 10 * 1.88, 0.16 + 0.1 * math.sin(i / 10 * math.pi * 1.5 + 2.0)) for i in range(11)]
    P.append(poly_extrude("hills2", hills2, 0.02, (0, by - 0.05, az), M["leaf"]))
    P.append(cyl("sun", 0.17, 0.17, 0.02, (0.45, by - 0.035, az + 0.82), M["gold"], seg=14, rot=(math.pi / 2, 0, 0)))
    for k in range(3): P.append(uvsphere(f"cloud{k}", 0.09 + (k == 1) * 0.03, (-0.5 + k * 0.1, by - 0.04, az + 0.86 + (k == 1) * 0.03), M["white"], seg=10, rings=6, scale=(1.3, 0.25, 0.8)))
    P.append(cyl("tree", 0.12, 0.0, 0.32, (-0.62, by - 0.06, az + 0.3), M["shutter"], seg=6, rot=(0, 0, 0)))
    # footlights along the stage lip (two glow points so the game's halo picks them up)
    for k in range(7):
        x = -0.75 + k * 0.25
        P.append(cyl(f"fl{k}", 0.045, 0.035, 0.05, (x, sy0 + 0.06, SZ), M["metal"], seg=8))
        P.append(uvsphere(f"flg{k}", 0.04, (x, sy0 + 0.06, SZ + 0.05), M["glow"], seg=8, rings=4, cut=0.0))
    for x in (-0.5, 0.5): E.append(empty("pt_glow_lamp", (x, sy0 + 0.05, SZ + 0.1)))
    # bunting from the arch posts out to two tall poles at the front corners
    for s in (-1, 1):
        P.append(cyl(f"bpole{s}", 0.03, 0.035, 1.55, (s * 1.32, -0.82, 0), M["dark"], seg=6))
        P.append(sphere(f"bknob{s}", 0.05, (s * 1.32, -0.82, 1.56), M["gold"], sub=1))
        P += bunting(f"bunt{s}", M, (s * 1.32, -0.82, 1.5), (s * 0.99, ay, az + 1.18), n=5, sag=0.1)
    P += bunting("buntx", M, (-1.32, -0.82, 1.42), (1.32, -0.82, 1.42), n=11, sag=0.18)
    # two rows of audience benches with an aisle down the middle
    for r, y in enumerate((-0.48, -0.8)):
        for s in (-1, 1):
            x = s * 0.55
            P.append(box(f"seat{r}{s}", (0.78, 0.15, 0.045), (x, y, 0.17 + r * 0.02), M["plank"], bev=0.01))
            for lx in (-0.32, 0.32): P.append(box(f"sl{r}{s}{lx}", (0.05, 0.12, 0.17 + r * 0.02), (x + lx, y, 0), M["dark"]))
    E.append(empty("pt_stage", (0, (sy0 + sy1) / 2 - 0.05, SZ)))
    return finish(root, P, E)

# ── Arcane University (3x3): pale stone halls, indigo roofs, a spire with a floating orb ──
def build_university():
    M = xslots(); rnd = random.Random(86)
    roof = material("roof", 0x4b3c8f); M["roof"] = roof
    stone = material("wall", 0xe6dfcf)
    root = empty("university", (0, 0, 0)); P, E = [pad("pad", M, 2.85, 2.85)], []
    # back hall across the rear, two wings coming forward round a courtyard
    BW, BD, BH = 2.6, 0.9, 1.25; by = 0.9
    P.append(plinth("plinthb", M, BW, BD, rnd=rnd)); P[-1].location = (0, by, 0)
    P += block("hall", M, BW, BD, BH, 0.75, over=0.14, rows=5, sag=0.03, y=by, wall_mat=stone, roof_mat=roof, rnd=rnd)
    P.append(box("hband", (BW + 0.06, BD + 0.06, 0.07), (0, by, BH - 0.05), M["cut"], bev=0.015))
    P.append(box("hbase", (BW + 0.05, BD + 0.05, 0.16), (0, by, 0), M["stone"], bev=0.02))
    WW, WD, WH = 0.66, 1.15, 0.95; wy = -0.07
    for s in (-1, 1):
        wx = s * (BW / 2 - WW / 2)
        P.append(plinth(f"plinthw{s}", M, WW, WD, rnd=rnd)); P[-1].location = (wx, wy, 0)
        P += block(f"wing{s}", M, WW, WD, WH, 0.55, front_gable=True, over=0.12, rows=4, sag=0.02, x=wx, y=wy, wall_mat=stone, roof_mat=roof, rnd=rnd)
        P.append(box(f"wbase{s}", (WW + 0.05, WD + 0.05, 0.16), (wx, wy, 0), M["stone"], bev=0.02))
        P.append(box(f"wband{s}", (WW + 0.06, WD + 0.06, 0.06), (wx, wy, WH - 0.05), M["cut"], bev=0.015))
        # an arched glowing window on each wing's gable end and two on the courtyard side
        fy = wy - WD / 2
        P.append(poly_extrude(f"wwf{s}", arch_pts(0.26, 0.56, 8), 0.06, (wx, fy - 0.01, 0.25), M["cut"], bev=0.01))
        P.append(poly_extrude(f"wwg{s}", arch_pts(0.18, 0.48, 8), 0.07, (wx, fy - 0.018, 0.29), M["win"]))
        E.append(empty("pt_glow_win", (wx, fy - 0.05, 0.5)))
        P.append(cyl(f"wrose{s}", 0.09, 0.09, 0.05, (wx, fy, 1.18), M["win"], seg=12, rot=(math.pi / 2, 0, 0)))
        P.append(cyl(f"wrosef{s}", 0.12, 0.12, 0.04, (wx, fy + 0.01, 1.18), M["cut"], seg=12, rot=(math.pi / 2, 0, 0)))
        ix = wx - s * WW / 2 - s * 0.01
        for yy in (-0.32, 0.18):
            w = poly_extrude(f"wif{s}{yy}", arch_pts(0.22, 0.46, 8), 0.06, (0, 0, 0), M["cut"], bev=0.01)
            g = poly_extrude(f"wig{s}{yy}", arch_pts(0.15, 0.39, 8), 0.07, (0, -0.008, 0.035), M["win"])
            o = join([w, g], f"wi{s}{yy}"); o.rotation_euler = (0, 0, -s * math.pi / 2); o.location = (ix, wy + yy, 0.3); P.append(o)
            E.append(empty("pt_glow_win", (ix - s * 0.04, wy + yy, 0.5)))
        # a hanging banner on the wing front
        P.append(box(f"banb{s}", (0.34, 0.04, 0.04), (wx, fy - 0.06, 0.95), M["gold"]))
        P.append(poly_extrude(f"ban{s}", [(-0.13, 0), (0.13, 0), (0.13, -0.5), (0, -0.4), (-0.13, -0.5)], 0.02, (wx, fy - 0.06, 0.94), M["purple"]))
        P.append(sphere(f"banst{s}", 0.05, (wx, fy - 0.08, 0.72), M["gold"], sub=0))
    # round turrets on the outer front corners
    for s_ in (-1, 1):
        x, y = s_ * 1.26, -0.64
        P.append(cyl(f"tur{s_}", 0.2, 0.19, 1.45, (x, y, 0), stone, seg=10, bev=0.02))
        P.append(cyl(f"turb{s_}", 0.23, 0.23, 0.16, (x, y, 0), M["stone"], seg=10, bev=0.02))
        P.append(cyl(f"turc{s_}", 0.25, 0.25, 0.08, (x, y, 1.42), M["cut"], seg=10, bev=0.015))
        P.append(cyl(f"turr{s_}", 0.27, 0.0, 0.72, (x, y, 1.5), M["roof"], seg=10))
        P.append(sphere(f"turk{s_}", 0.04, (x, y, 2.22), M["gold"], sub=1))
        for z in (0.55, 1.05):
            w = poly_extrude(f"tsl{s_}{z}", arch_pts(0.08, 0.2, 4), 0.05, (0, 0, 0), M["win"])
            a_ = -math.pi / 2 + s_ * 0.5
            w.rotation_euler = (0, 0, a_ + math.pi / 2); w.location = (x + math.cos(a_) * 0.19, y + math.sin(a_) * 0.19, z); P.append(w)
    # back hall front: a row of tall arched windows either side of the spire
    hfy = by - BD / 2
    for x in (-0.95, -0.55, 0.55, 0.95):
        if abs(x) > BW / 2 - WW - 0.05 and abs(x) < BW / 2: continue
        P.append(poly_extrude(f"hwf{x}", arch_pts(0.26, 0.72, 8), 0.06, (x, hfy - 0.01, 0.3), M["cut"], bev=0.01))
        P.append(poly_extrude(f"hwg{x}", arch_pts(0.18, 0.64, 8), 0.07, (x, hfy - 0.018, 0.34), M["win"]))
        P.append(box(f"hwm{x}", (0.02, 0.08, 0.64), (x, hfy - 0.03, 0.34), M["trim"]))
        E.append(empty("pt_glow_win", (x, hfy - 0.05, 0.62)))
    # hero: a slender spire rising from the hall front, an orb floating over its tip
    tx, ty = 0.0, hfy + 0.12
    P.append(box("tw0", (0.66, 0.66, 1.75), (tx, ty, 0), stone, bev=0.03))
    P.append(box("tw0b", (0.7, 0.7, 0.18), (tx, ty, 0), M["stone"], bev=0.02))
    P.append(box("tw0c", (0.74, 0.74, 0.08), (tx, ty, 1.72), M["cut"], bev=0.02))
    P.append(poly_extrude("tdoorf", arch_pts(0.42, 0.74, 8), 0.07, (tx, ty - 0.34, 0.0), M["cut"], bev=0.012))
    P.append(poly_extrude("tdoor", arch_pts(0.32, 0.66, 8), 0.08, (tx, ty - 0.35, 0.0), M["purple"]))
    P.append(box("tdsplit", (0.02, 0.09, 0.56), (tx, ty - 0.38, 0.0), M["gold"]))
    P.append(box("tstep", (0.62, 0.3, 0.07), (tx, ty - 0.45, -0.02), M["cut"], bev=0.02))
    P.append(poly_extrude("twf", arch_pts(0.22, 0.42, 8), 0.06, (tx, ty - 0.335, 1.05), M["cut"], bev=0.01))
    P.append(poly_extrude("twg", arch_pts(0.15, 0.35, 8), 0.07, (tx, ty - 0.342, 1.085), M["win"]))
    E.append(empty("pt_glow_win", (tx, ty - 0.38, 1.25)))
    # octagonal belfry stage with open arches, then the needle spire
    z = 1.8
    P.append(cyl("tw1", 0.3, 0.28, 0.62, (tx, ty, z), stone, seg=8, bev=0.02, rot=(0, 0, math.pi / 8)))
    for k in range(4):
        a = k / 4 * math.pi * 2 - math.pi / 2
        w = poly_extrude(f"bel{k}", arch_pts(0.14, 0.34, 6), 0.05, (0, 0, 0), M["win"])
        w.rotation_euler = (0, 0, a + math.pi / 2); w.location = (tx + math.cos(a) * 0.27, ty + math.sin(a) * 0.27, z + 0.14); P.append(w)
    E.append(empty("pt_glow_win", (tx, ty - 0.32, z + 0.32)))
    P.append(cyl("tw1c", 0.36, 0.36, 0.07, (tx, ty, z + 0.62), M["cut"], seg=8, bev=0.015, rot=(0, 0, math.pi / 8)))
    for k in range(8):
        a = k / 8 * math.pi * 2
        P.append(cyl(f"pin{k}", 0.04, 0.0, 0.2, (tx + math.cos(a) * 0.33, ty + math.sin(a) * 0.33, z + 0.68), M["roof"], seg=4))
    P.append(cyl("spire", 0.31, 0.02, 1.7, (tx, ty, z + 0.68), roof, seg=8, rot=(0, 0, math.pi / 8)))
    for k, zz in enumerate((0.35, 0.8)):
        P.append(cyl(f"sband{k}", 0.31 * (1 - zz / 1.7) + 0.02, 0.31 * (1 - (zz + 0.05) / 1.7) + 0.02, 0.05, (tx, ty, z + 0.68 + zz), M["gold"], seg=8, rot=(0, 0, math.pi / 8)))
    tip = z + 0.68 + 1.7
    P.append(sphere("tipk", 0.04, (tx, ty, tip), M["gold"], sub=1))
    # the floating orb (its own node so the game can bob and spin it) inside a gold ring
    oz = tip + 0.38
    orb = empty("anim_orb", (tx, ty, oz))
    op = [uvsphere("orb", 0.17, (tx, ty, oz), M["magic"], seg=14, rings=10),
          uvsphere("orbc", 0.1, (tx - 0.05, ty - 0.08, oz + 0.05), M["white"], seg=8, rings=6, scale=(1, 0.6, 1))]
    ring = []
    for k in range(16):
        a0, a1 = k / 16 * math.pi * 2, (k + 1) / 16 * math.pi * 2
        ring.append(beam(f"or{k}", (tx + math.cos(a0) * 0.27, ty + math.sin(a0) * 0.27, oz), (tx + math.cos(a1) * 0.27, ty + math.sin(a1) * 0.27, oz), 0.03, 0.03, M["gold"]))
    rg = join(ring, "orb_ring"); rotate_about(rg, (tx, ty, oz), (0.5, 0.3, 0))
    om = join(op + [rg], "orb_mesh"); parent(om, orb); parent(orb, root)
    E.append(empty("pt_orb", (tx, ty, oz)))
    E.append(empty("pt_glow_lamp", (tx, ty, oz)))
    # the courtyard: flagstones and a glowing rune circle, with crystal pillars
    cx, cyy = 0.0, -0.62
    P.append(cyl("court", 0.62, 0.62, 0.03, (cx, cyy, 0.0), M["cut"], seg=20))
    P.append(cyl("rring", 0.54, 0.54, 0.015, (cx, cyy, 0.03), M["rune"], seg=24))
    P.append(cyl("rring2", 0.47, 0.47, 0.018, (cx, cyy, 0.03), M["cut"], seg=24))
    P.append(cyl("rring3", 0.3, 0.3, 0.02, (cx, cyy, 0.03), M["rune"], seg=20))
    P.append(cyl("rring4", 0.25, 0.25, 0.024, (cx, cyy, 0.03), M["cut"], seg=20))
    for k in range(6):
        a = k / 6 * math.pi * 2
        x0, y0 = cx + math.cos(a) * 0.25, cyy + math.sin(a) * 0.25
        a2 = a + 2 * math.pi / 6 * 2
        x1, y1 = cx + math.cos(a2) * 0.25, cyy + math.sin(a2) * 0.25
        P.append(beam(f"hex{k}", (x0, y0, 0.05), (x1, y1, 0.05), 0.025, 0.012, M["rune"]))
    for k in range(10):
        a = k / 10 * math.pi * 2
        P.append(box(f"glyph{k}", (0.05, 0.03, 0.012), (cx + math.cos(a) * 0.39, cyy + math.sin(a) * 0.39, 0.045), M["rune"], rot=(0, 0, a + (k % 3) * 0.6)))
    P.append(sphere("rcore", 0.06, (cx, cyy, 0.06), M["magic"], sub=1, scale=(1, 1, 0.6)))
    for k, a in enumerate((math.pi * 0.25, math.pi * 0.75, math.pi * 1.25, math.pi * 1.75)):
        x, y = cx + math.cos(a) * 0.72, cyy + math.sin(a) * 0.72
        P.append(box(f"plr{k}", (0.12, 0.12, 0.36), (x, y, 0), M["cut"], bev=0.02))
        P.append(cyl(f"cry{k}", 0.06, 0.0, 0.16, (x, y, 0.36), M["magic"], seg=5))
        P.append(cyl(f"cryb{k}", 0.0, 0.06, 0.06, (x, y, 0.3), M["magic"], seg=5))
    E.append(empty("pt_rune", (cx, cyy, 0.05)))
    # tall banners on poles at the courtyard mouth
    for s in (-1, 1):
        x = s * 0.82; y = -1.25
        P.append(cyl(f"bp{s}", 0.03, 0.035, 1.5, (x, y, 0), M["dark"], seg=6))
        P.append(sphere(f"bk{s}", 0.05, (x, y, 1.52), M["gold"], sub=1))
        P.append(box(f"bbar{s}", (0.36, 0.04, 0.035), (x, y - 0.02, 1.4), M["gold"]))
        P.append(poly_extrude(f"bban{s}", [(-0.15, 0), (0.15, 0), (0.15, -0.66), (0, -0.54), (-0.15, -0.66)], 0.02, (x, y - 0.03, 1.39), M["purple"]))
        P.append(sphere(f"bstar{s}", 0.055, (x, y - 0.05, 1.1), M["gold"], sub=0))
    E += chimney("chim", M, (0.9, by + 0.25, BH + 0.35), h=0.45, lean=0.02, rnd=rnd)
    return finish(root, P, E)

# ── Watch House (2x2): the constable's stone lock-up, a barred cell window and the stocks ──
def build_watchhouse():
    M = xslots(); rnd = random.Random(87)
    M["roof"] = material("roof", 0x56677a)
    root = empty("watchhouse", (0, 0, 0)); P, E = [pad("pad", M, 1.9, 1.9)], []
    W, D, H = 1.3, 1.0, 0.9; cy = 0.32; fy = cy - D / 2
    P.append(plinth("plinth", M, W, D, rnd=rnd)); P[-1].location = (0, cy, 0)
    P += block("main", M, W, D, H, 0.6, front_gable=True, over=0.13, rows=4, sag=0.04, y=cy, wall_mat=M["stone"], rnd=rnd)
    # corner quoins
    for x in (-W / 2, W / 2):
        for k in range(5):
            P.append(box(f"q{x}{k}", (0.1 + (k % 2) * 0.06, 0.1 + ((k + 1) % 2) * 0.06, 0.15), (x, fy + 0.01, k * 0.18 + 0.01), M["cut"], bev=0.015))
    P.append(door("door", M, (-0.22, fy - 0.01, 0.0), w=0.32, h=0.56))
    E += window("w1", M, (0.3, fy - 0.01, 0.52), w=0.24, h=0.26, shutters=True)
    # the shield sign above the door
    P += shield_sign("shield", M, (-0.22, fy - 0.06, 0.8), 0.24, col="flag")
    for k in range(5): P.append(box(f"sw{k}", (0.025, 0.012, 0.04), (-0.3 + k * 0.04, fy - 0.1, 0.84), M["white"]))   # W A T C H as tiny plaques
    # a lantern on a bracket by the door
    P.append(box("lbr", (0.04, 0.16, 0.04), (0.02, fy - 0.08, 0.66), M["metal"]))
    P.append(box("lamp", (0.1, 0.1, 0.14), (0.02, fy - 0.16, 0.5), M["glow"], bev=0.02))
    P.append(cyl("lamph", 0.08, 0.02, 0.07, (0.02, fy - 0.16, 0.63), M["metal"], seg=4, rot=(0, 0, math.pi / 4)))
    P.append(box("lampb", (0.08, 0.08, 0.02), (0.02, fy - 0.16, 0.49), M["metal"]))
    E.append(empty("pt_glow_lamp", (0.02, fy - 0.17, 0.57)))
    # the cell: a barred window on the right side wall
    sx = W / 2 + 0.01
    P.append(box("cellf", (0.06, 0.36, 0.3), (sx, cy - 0.05, 0.36), M["cut"], bev=0.015))
    P.append(box("cellg", (0.07, 0.28, 0.22), (sx + 0.002, cy - 0.05, 0.4), M["dark"]))
    for k in range(4): P.append(cyl(f"bar{k}", 0.014, 0.014, 0.24, (sx + 0.03, cy - 0.155 + k * 0.07, 0.39), M["metal"], seg=6))
    P.append(box("cellsill", (0.1, 0.4, 0.04), (sx + 0.02, cy - 0.05, 0.34), M["cut"]))
    # a little bell gallows on the front-left corner
    gx, gy = -0.8, -0.55
    P.append(box("gpost", (0.07, 0.07, 1.15), (gx, gy, 0), M["dark"], bev=0.012))
    P.append(box("garm", (0.3, 0.06, 0.06), (gx + 0.12, gy, 1.08), M["dark"]))
    P.append(box("gbrace", (0.03, 0.03, 0.22), (gx + 0.07, gy, 0.92), M["dark"], rot=(0, -0.7, 0)))
    P.append(cyl("bell", 0.04, 0.09, 0.13, (gx + 0.2, gy, 0.9), M["gold"], seg=10, smooth=True))
    P.append(cyl("bellr", 0.095, 0.095, 0.02, (gx + 0.2, gy, 0.895), M["gold"], seg=10))
    P.append(box("brope", (0.012, 0.012, 0.4), (gx + 0.2, gy, 0.5), M["rope"]))
    # the stocks: a comic pair of boards with a head hole and two hands
    kx, ky = 0.45, -0.62
    for x in (-0.26, 0.26): P.append(box(f"kpost{x}", (0.07, 0.07, 0.62), (kx + x, ky, 0), M["dark"], bev=0.01))
    P.append(box("kbase", (0.7, 0.2, 0.05), (kx, ky, 0), M["wood"], bev=0.01))
    P.append(box("klo", (0.6, 0.06, 0.12), (kx, ky, 0.36), M["plank"], bev=0.012))
    P.append(box("khi", (0.6, 0.06, 0.12), (kx, ky, 0.49), M["plank"], bev=0.012))
    for x, r in ((-0.17, 0.035), (0.0, 0.06), (0.17, 0.035)):
        P.append(cyl(f"khole{x}", r, r, 0.07, (kx + x, ky + 0.035, 0.485), M["dark"], seg=10, rot=(math.pi / 2, 0, 0)))
    P.append(box("khinge", (0.04, 0.07, 0.06), (kx - 0.32, ky, 0.46), M["metal"]))
    P.append(box("klock", (0.05, 0.03, 0.06), (kx + 0.32, ky - 0.03, 0.46), M["metal"]))
    P.append(box("ktop", (0.66, 0.08, 0.03), (kx, ky, 0.61), M["dark"], bev=0.008))
    # a rotten tomato for flavour, a barrel and a bench for the constable
    P.append(sphere("tomato", 0.035, (kx + 0.12, ky - 0.18, 0.03), M["apple"], sub=1, scale=(1.3, 1.3, 0.6)))
    P += barrel("bar", M, (-0.75, 0.0, 0), r=0.12, h=0.28)
    P.append(box("bench", (0.5, 0.14, 0.04), (-0.55, -0.8, 0.2), M["plank"], bev=0.01))
    for x in (-0.75, -0.35): P.append(box(f"bl{x}", (0.04, 0.12, 0.2), (x, -0.8, 0), M["wood"]))
    E += chimney("chim", M, (0.35, cy + 0.3, H + 0.2), h=0.5, lean=0.03, rnd=rnd)
    return finish(root, P, E)
