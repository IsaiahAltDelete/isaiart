# Workplaces, part two, plus the decorations the critic could not read.
import math, random

# ── Forager hut: a hide tent of greens and browns, a herb-drying rack, baskets, giant mushrooms ──
def build_forager():
    M = wslots(); rnd = random.Random(21)
    root = empty("forager", (0, 0, 0)); P, E = [pad("pad", M, 1.9, 1.9)], []
    hide = [material("hide", 0x8a6a44), material("hide2", 0x6f8a4a), material("hide3", 0xa98458)]
    # stitched hide panels over a ring of poles
    for k in range(10):
        a0 = k / 10 * math.pi * 2; a1 = (k + 1) / 10 * math.pi * 2; r = 0.72; h = 1.05
        bm = bmesh.new()
        v0 = bm.verts.new((math.cos(a0) * r, math.sin(a0) * r + 0.12, 0.02)); v1 = bm.verts.new((math.cos(a1) * r, math.sin(a1) * r + 0.12, 0.02))
        v2 = bm.verts.new((0, 0.12, h))
        bm.faces.new((v0, v1, v2))
        P.append(_obj(f"panel{k}", bm, hide[k % 3]))
    for k in range(5):
        a = k / 5 * math.pi * 2 + 0.3
        P.append(beam(f"pole{k}", (math.cos(a) * 0.74, math.sin(a) * 0.74 + 0.12, 0.0), (-math.cos(a) * 0.08, -math.sin(a) * 0.08 + 0.12, 1.28), 0.045, 0.045, M["wood"]))
    # door flap pinned open
    P.append(poly_extrude("flap", [(-0.2, 0), (0.2, 0), (0.02, 0.62)], 0.02, (0, -0.52, 0.02), M["dark"]))
    P.append(poly_extrude("flapopen", [(0.0, 0), (0.22, 0), (0.05, 0.55)], 0.02, (0.2, -0.56, 0.02), hide[2], rot=(0, 0, 0.5)))
    # hero: a tall herb-drying rack hung with bundles
    for x in (0.45, 0.88): P.append(box(f"rp{x}", (0.05, 0.05, 0.95), (x, -0.55, 0), M["wood"]))
    P.append(box("rbar", (0.5, 0.04, 0.04), (0.665, -0.55, 0.9), M["wood"]))
    for k, x in enumerate((0.5, 0.6, 0.7, 0.8)):
        P.append(box(f"hs{k}", (0.008, 0.008, 0.1), (x, -0.55, 0.8), M["rope"]))
        P.append(cyl(f"hb{k}", 0.055, 0.0, 0.22, (x, -0.55, 0.58), material("herb", [0x5f9a3a, 0x8aa84a, 0x7a5aa8, 0x4f8a3a][k]), seg=6))
    for k, (x, y, g) in enumerate([(-0.72, -0.62, "apple"), (-0.45, -0.75, "purple"), (0.8, 0.35, "apple")]):
        P.append(cyl(f"bk{k}", 0.16, 0.12, 0.17, (x, y, 0), M["plank"], seg=10, bev=0.02))
        for j in range(5): P.append(sphere(f"be{k}{j}", 0.05, (x - 0.06 + (j % 3) * 0.06, y - 0.03 + (j // 3) * 0.06, 0.2), M[g], sub=1))
    # giant red-capped mushrooms by the door
    for k, (x, y, s) in enumerate([(-0.75, -0.15, 1.15), (-0.62, 0.25, 0.8)]):
        P.append(cyl(f"ms{k}", 0.06 * s, 0.08 * s, 0.24 * s, (x, y, 0), M["white"], seg=8))
        P.append(uvsphere(f"mc{k}", 0.18 * s, (x, y, 0.22 * s), M["red"], seg=12, rings=8, cut=0.0, scale=(1, 1, 0.7), smooth=False))
        for d in range(4): P.append(sphere(f"md{k}{d}", 0.028 * s, (x + math.cos(d * 1.6) * 0.1 * s, y + math.sin(d * 1.6) * 0.1 * s, 0.22 * s + 0.08 * s), M["white"], sub=0))
    return finish(root, P, E)

# ── Forester's lodge: log lodge, a nursery of saplings in pots, a pinecone sign ──
def build_forester():
    M = wslots(); rnd = random.Random(22)
    root = empty("forester", (0, 0, 0)); P, E = [pad("pad", M, 1.9, 1.9)], []
    W, D = 1.15, 0.95; cx, cy = -0.2, 0.32
    P += log_cabin("cab", M, W, D, 0.78, (cx, cy, 0))
    g = gable_fill("gable", M, W, D, 0.6, 0.78, mat=M["log"]); g.rotation_euler = (0, 0, math.pi / 2); g.location = (cx, cy, 0.78)
    P.append(g)
    P.append(gable_roof("roof", D, W, 0.6, M, over=0.15, rows=4, loc=(cx, cy, 0.78), rot_z=math.pi / 2, mat=M["leaf"], rnd=rnd))
    P.append(door("door", M, (cx, cy - D / 2 - 0.08, 0.0), w=0.3, h=0.5))
    for k, x in enumerate((-0.7, -0.35, 0.0, 0.35, 0.7)):
        P.append(cyl(f"pot{k}", 0.1, 0.08, 0.14, (x, -0.72, 0), M["brick"], seg=8, bev=0.015))
        P.append(cone_tree(f"sap{k}", M, (x, -0.72, 0.14), 0.12 + (k % 2) * 0.03))
    # hero: a big pinecone on a post
    P.append(box("post", (0.07, 0.07, 0.75), (0.72, 0.0, 0), M["wood"]))
    for k in range(5):
        P.append(cyl(f"pc{k}", 0.13 - k * 0.022, 0.13 - k * 0.02, 0.07, (0.72, 0.0, 0.78 + k * 0.06), M["dark"] if k % 2 else M["log"], seg=8, bev=0.015))
    return finish(root, P, E)

def cone_tree(name, M, loc, s=0.15):
    x, y, z = loc
    parts = [cyl(f"{name}_t", 0.02, 0.025, s * 0.6, (x, y, z), M["log"], seg=5)]
    for k in range(3):
        parts.append(cyl(f"{name}_c{k}", s * (1 - k * 0.25), 0.0, s * 1.1, (x, y, z + s * 0.4 + k * s * 0.5), M["leaf"], seg=7))
    return join(parts, name)

# ── Fishing dock: a shack, a plank pier toward the water (+Y here faces the water) ──
def build_dock():
    M = wslots(); rnd = random.Random(23)
    root = empty("dock", (0, 0, 0)); P, E = [], []
    # the game rotates docks to face the water; the pier runs toward -Y (front)
    P.append(box("shack", (0.95, 0.75, 0.68), (-0.4, 0.5, 0), M["plank"], bev=0.025))
    P.append(gable_roof("roof", 0.95, 0.75, 0.38, M, over=0.12, rows=3, loc=(-0.4, 0.5, 0.68), mat=M["shutter"], rnd=rnd))
    g = gable_fill("gable", M, 0.95, 0.75, 0.38, 0.68, mat=M["plank"]); g.location = (-0.4, 0.5, 0.68); P.append(g)
    P.append(door("door", M, (-0.4, 0.12, 0.0), w=0.28, h=0.5))
    for k in range(9):
        P.append(box(f"pl{k}", (0.72, 0.27, 0.06), (0.4 + rnd.uniform(-0.02, 0.02), 0.6 - k * 0.31, 0.05), M["plank"], bev=0.012, rot=(0, 0, rnd.uniform(-0.03, 0.03))))
    for k in range(4):
        for x in (0.07, 0.73):
            P.append(cyl(f"pile{k}{x}", 0.05, 0.05, 0.85, (x, 0.45 - k * 0.75, -0.7), M["log"], seg=7))
    # hero: a fish drying rack and a big fish sign
    P.append(box("rack", (0.03, 0.6, 0.03), (-0.85, -0.2, 0.55), M["wood"]))
    for y in (-0.48, 0.08): P.append(box(f"rp{y}", (0.04, 0.04, 0.55), (-0.85, y, 0), M["wood"]))
    for k in range(3):
        P.append(sphere(f"fish{k}", 0.07, (-0.85, -0.35 + k * 0.15, 0.42), M["metal2"], sub=1, scale=(0.4, 0.6, 1.5)))
        P.append(cyl(f"tail{k}", 0.05, 0.0, 0.06, (-0.85, -0.35 + k * 0.15, 0.3), M["metal2"], seg=4, rot=(math.pi, 0, 0)))
    P += barrel("b1", M, (-0.15, -0.25, 0)); P.append(box("net", (0.3, 0.25, 0.06), (-0.55, -0.6, 0), M["rope"], bev=0.03))
    boat = empty("anim_boat", (1.25, -1.6, -0.15))
    hull = [box("hull", (0.38, 0.95, 0.16), (1.25, -1.6, -0.15), M["wood"], bev=0.06, segs=2, taper=1.15),
            box("seat", (0.36, 0.1, 0.03), (1.25, -1.6, -0.0), M["plank"]),
            box("oar", (0.03, 0.7, 0.02), (1.2, -1.55, 0.02), M["plank"], rot=(0, 0, 0.3))]
    h = join(hull, "boat_mesh"); parent(h, boat); parent(boat, root)
    return finish(root, P, E)

# ── Weaver: a workshop hung with cloth banners, a big loom out front ──
def build_weaver():
    M = wslots(); rnd = random.Random(24)
    root = empty("weaver", (0, 0, 0)); P, E = [pad("pad", M, 1.9, 1.9)], []
    W, D = 1.2, 0.95; cx, cy = -0.25, 0.32
    P.append(plinth("plinth", M, W, D, rnd=rnd)); P[-1].location = (cx, cy, 0)
    P += block("main", M, W, D, 0.88, 0.55, over=0.13, rows=4, x=cx, y=cy, rnd=rnd)
    P.append(door("door", M, (cx - 0.22, cy - D / 2 - 0.01, 0.0), w=0.3, h=0.52))
    # hero 1: long cloth banners hanging down the front from the eave
    cols = [M["red"], M["gold"], M["shutter"], M["purple"]]
    for k, x in enumerate((cx + 0.05, cx + 0.25, cx + 0.45)):
        P.append(box(f"ban{k}", (0.16, 0.025, 0.62), (x, cy - D / 2 - 0.06, 0.22), cols[k], bev=0.005))
        P.append(box(f"bar{k}", (0.2, 0.04, 0.03), (x, cy - D / 2 - 0.06, 0.84), M["wood"]))
        P.append(poly_extrude(f"tip{k}", [(-0.08, 0), (0.08, 0), (0, -0.07)], 0.025, (x, cy - D / 2 - 0.06, 0.22), cols[k]))
    # hero 2: the big loom, as tall as the eaves, with a half-woven striped cloth
    lx, ly = 0.42, -0.5
    for x in (-0.36, 0.36):
        P.append(box(f"lp{x}", (0.07, 0.07, 0.95), (lx + x, ly, 0), M["wood"], bev=0.012))
        P.append(box(f"lf{x}", (0.07, 0.45, 0.07), (lx + x, ly, 0.12), M["wood"]))
    for z in (0.22, 0.9): P.append(cyl(f"beam{z}", 0.04, 0.04, 0.8, (lx - 0.4, ly, z), M["wood"], seg=8, rot=(0, math.pi / 2, 0)))
    for k in range(8): P.append(box(f"th{k}", (0.05, 0.012, 0.62), (lx - 0.28 + k * 0.08, ly, 0.24), cols[k % 4]))
    for k in range(4): P.append(box(f"wv{k}", (0.64, 0.02, 0.05), (lx, ly - 0.005, 0.24 + k * 0.05), cols[(k + 1) % 4]))
    for k, (x, y) in enumerate([(-0.78, -0.6), (-0.6, -0.76)]): P.append(sphere(f"wool{k}", 0.13, (x, y, 0.11), M["white"], sub=1, smooth=True))
    P.append(cyl("spool", 0.08, 0.08, 0.2, (-0.82, -0.25, 0), cols[3], seg=10))
    return finish(root, P, E)

# ── Creamery: a long low dairy with a giant cheese-wheel sign and churns ──
def build_creamery():
    M = wslots(); rnd = random.Random(25)
    root = empty("creamery", (0, 0, 0)); P, E = [pad("pad", M, 1.9, 1.9)], []
    W, D = 1.6, 0.85; cy = 0.42
    P.append(plinth("plinth", M, W, D, rnd=rnd)); P[-1].location = (0, cy, 0)
    P += block("main", M, W, D, 0.62, 0.42, over=0.14, rows=3, y=cy, wall_mat=M["white"], rnd=rnd)
    P.append(door("door", M, (-0.15, cy - D / 2 - 0.01, 0.0), w=0.3, h=0.5))
    E += window("w1", M, (-0.55, cy - D / 2 - 0.01, 0.38), w=0.24, h=0.2, shutters=False)
    E += window("w2", M, (0.25, cy - D / 2 - 0.01, 0.38), w=0.24, h=0.2, shutters=False)
    # hero: a big cheese wheel on a post, holes showing
    P.append(box("post", (0.08, 0.08, 1.05), (0.62, -0.45, 0), M["wood"], bev=0.015))
    P.append(cyl("cheese", 0.36, 0.36, 0.16, (0.62, -0.37, 1.05), M["cheese"], seg=14, bev=0.04, rot=(math.pi / 2, 0, 0)))
    P.append(cyl("rind", 0.37, 0.37, 0.03, (0.62, -0.37, 1.05), M["orange"], seg=14, rot=(math.pi / 2, 0, 0)))
    for k, (x, z, r) in enumerate([(0.52, 1.12, 0.035), (0.72, 0.98, 0.03), (0.6, 0.92, 0.025)]):
        P.append(cyl(f"hole{k}", r, r, 0.17, (x, -0.36, z), M["orange"], seg=8, rot=(math.pi / 2, 0, 0)))
    # churns and a stack of small cheeses
    for k, (x, y) in enumerate([(-0.75, -0.55), (-0.52, -0.68), (-0.3, -0.58)]):
        P.append(cyl(f"churn{k}", 0.1, 0.12, 0.3, (x, y, 0), M["metal2"], seg=10, bev=0.02))
        P.append(cyl(f"cneck{k}", 0.06, 0.09, 0.08, (x, y, 0.3), M["metal2"], seg=10))
        P.append(cyl(f"clid{k}", 0.07, 0.07, 0.03, (x, y, 0.38), M["metal"], seg=10))
    for k in range(3): P.append(cyl(f"sm{k}", 0.12 - k * 0.015, 0.12 - k * 0.015, 0.08, (0.1, -0.7, k * 0.08), M["cheese"], seg=12, bev=0.02))
    return finish(root, P, E)

# ── Brewery: a tall malt house with a vented cupola, a huge riveted copper kettle ──
def build_brewery():
    M = wslots(); rnd = random.Random(26)
    root = empty("brewery", (0, 0, 0)); P, E = [pad("pad", M, 1.9, 1.9)], []
    W, D = 0.9, 0.9; cx, cy = -0.45, 0.4
    P += block("malt", M, W, D, 1.45, 0.55, front_gable=True, over=0.12, rows=4, x=cx, y=cy, wall_mat=M["brick"], rnd=rnd)
    P.append(box("band", (W + 0.06, D + 0.06, 0.07), (cx, cy, 0.72), M["trim"], bev=0.015))
    # vented cupola on the ridge
    P.append(box("cup", (0.3, 0.3, 0.26), (cx, cy + 0.05, 1.85), M["wood"], bev=0.02))
    for x in (-0.07, 0.07): P.append(box(f"vent{x}", (0.06, 0.32, 0.12), (cx + x, cy + 0.05, 1.92), M["dark"]))
    P.append(cyl("cuproof", 0.28, 0.0, 0.24, (cx, cy + 0.05, 2.1), M["roof"], seg=4, rot=(0, 0, math.pi / 4)))
    E.append(empty("pt_smoke", (cx, cy + 0.05, 2.3)))
    P.append(door("door", M, (cx, cy - D / 2 - 0.01, 0.0), w=0.3, h=0.55))
    E += window("w1", M, (cx, cy - D / 2 - 0.01, 1.05), w=0.24, h=0.26, shutters=False)
    # hero: the copper kettle, half the building's height, riveted bands, a gooseneck pipe
    kx, ky = 0.45, 0.2
    P.append(cyl("kbase", 0.42, 0.44, 0.16, (kx, ky, 0), M["brick"], seg=12, bev=0.02))
    P.append(uvsphere("kettle", 0.42, (kx, ky, 0.6), M["copper"], seg=18, rings=12, scale=(1, 1, 1.05), smooth=True))
    for z in (0.42, 0.78):
        r = math.sqrt(max(0.0, 0.42 ** 2 - (z - 0.6) ** 2)) + 0.01
        P.append(cyl(f"band{z}", r, r, 0.035, (kx, ky, z), M["metal"], seg=18, smooth=True))
    P.append(cyl("kneck", 0.12, 0.24, 0.22, (kx, ky, 0.98), M["copper"], seg=14, smooth=True))
    P.append(beam("gooseneck", (kx, ky, 1.18), (cx + 0.45, ky, 1.42), 0.07, 0.07, M["copper"]))
    P.append(cyl("hatch", 0.1, 0.1, 0.03, (kx + 0.18, ky - 0.32, 0.86), M["metal"], seg=10, rot=(0.9, 0, 0.5)))
    for i in range(2):
        for j in range(2 - i):
            x = 0.25 + j * 0.28 + i * 0.14
            P.append(cyl(f"bl{i}{j}", 0.13, 0.13, 0.32, (x, -0.6, 0.13 + i * 0.24), M["wood"], seg=10, bev=0.03, rot=(math.pi / 2, 0, 0)))
            P.append(cyl(f"bh{i}{j}", 0.135, 0.135, 0.025, (x, -0.71, 0.13 + i * 0.24), M["metal"], seg=10, rot=(math.pi / 2, 0, 0)))
    for k, x in enumerate((-0.85, -0.65)):
        P.append(box(f"hp{k}", (0.04, 0.04, 0.9), (x, -0.62, 0), M["wood"]))
        for j in range(4): P.append(sphere(f"hop{k}{j}", 0.06, (x + 0.03 * (j % 2), -0.62, 0.3 + j * 0.15), M["cabbage"], sub=1))
    return finish(root, P, E)

# ── Tavern (3x2): a big two-storey inn, a hanging tankard sign, tables out front ──
def build_tavern():
    M = wslots(); rnd = random.Random(27)
    root = empty("tavern", (0, 0, 0)); P, E = [pad("pad", M, 2.85, 1.9)], []
    W, D = 2.0, 1.15; cy = 0.3
    P.append(plinth("plinth", M, W, D, rnd=rnd)); P[-1].location = (0, cy, 0)
    P.append(walls("ground", M, W, D, 0.85, loc=(0, cy, 0), mat=M["stone"]))
    P.append(box("jetty", (W + 0.14, D + 0.14, 0.08), (0, cy, 0.85), M["trim"], bev=0.02))
    P += block("upper", M, W + 0.1, D + 0.1, 0.7, 0.75, over=0.15, rows=5, sag=0.06, z0=0.93, y=cy, rnd=rnd)
    P.append(timber_frame("frame", M, W + 0.1, D + 0.1, 0.7, 0.93, braces=True)); P[-1].location = (0, cy, 0)
    P.append(door("door", M, (0, cy - D / 2 - 0.01, 0.0), w=0.38, h=0.62))
    for x in (-0.6, 0.6): E += window(f"g{x}", M, (x, cy - D / 2 - 0.01, 0.48), w=0.36, h=0.3, shutters=False)
    for x in (-0.65, 0.0, 0.65): E += window(f"u{x}", M, (x, cy - D / 2 - 0.06, 1.32), w=0.26, h=0.28, box_flowers=x != 0)
    E += chimney("chim", M, (-0.7, cy + 0.25, 1.85), h=0.6, lean=0.03, rnd=rnd)
    # hero: a big tankard sign on a bracket
    P.append(box("brk", (0.5, 0.05, 0.05), (0.95, cy - D / 2 - 0.25, 1.3), M["metal"], rot=(0, 0, 0)))
    P.append(box("brk2", (0.05, 0.05, 0.3), (0.72, cy - D / 2 - 0.25, 1.05), M["metal"]))
    P.append(cyl("mug", 0.2, 0.18, 0.38, (1.08, cy - D / 2 - 0.28, 0.82), M["gold"], seg=14, bev=0.03))
    for z in (0.88, 1.12): P.append(cyl(f"hoop{z}", 0.205, 0.205, 0.03, (1.08, cy - D / 2 - 0.28, z), M["wood"], seg=14))
    P.append(cyl("foam", 0.21, 0.21, 0.09, (1.08, cy - D / 2 - 0.28, 1.18), M["white"], seg=14, bev=0.04, segs=2))
    P.append(cyl("handle", 0.11, 0.11, 0.05, (1.3, cy - D / 2 - 0.28, 1.0), M["gold"], seg=12, rot=(math.pi / 2, 0, 0)))
    # outdoor tables with benches and mugs
    for x in (-0.85, 0.75):
        P.append(cyl(f"tt{x}", 0.22, 0.22, 0.04, (x, -0.7, 0.3), M["plank"], seg=12, bev=0.01))
        P.append(cyl(f"tl{x}", 0.04, 0.05, 0.3, (x, -0.7, 0), M["wood"], seg=6))
        for s in (-1, 1): P.append(box(f"tb{x}{s}", (0.4, 0.12, 0.05), (x + s * 0.32, -0.7, 0.17), M["plank"], bev=0.01, rot=(0, 0, math.pi / 2)))
        P.append(cyl(f"tm{x}", 0.035, 0.035, 0.07, (x + 0.06, -0.72, 0.34), M["gold"], seg=8))
    P += barrel("b1", M, (-1.25, -0.2, 0)); P += barrel("b2", M, (1.25, -0.25, 0))
    return finish(root, P, E)

# ── Schoolhouse: red-roofed hall, a belfry with a brass bell, chalkboard out front ──
def build_school():
    M = wslots(); rnd = random.Random(28)
    root = empty("school", (0, 0, 0)); P, E = [pad("pad", M, 1.9, 1.9)], []
    W, D = 1.3, 1.15; cy = 0.18
    P.append(plinth("plinth", M, W, D, rnd=rnd)); P[-1].location = (0, cy, 0)
    P += block("main", M, W, D, 0.88, 0.65, front_gable=True, over=0.13, rows=4, y=cy, wall_mat=M["wall"], rnd=rnd)
    P.append(door("door", M, (0, cy - D / 2 - 0.01, 0.0), w=0.32, h=0.56))
    for x in (-0.4, 0.4): E += window(f"w{x}", M, (x, cy - D / 2 - 0.01, 0.52), w=0.24, h=0.32, shutters=False)
    E += window("ws", M, (W / 2 + 0.01, cy, 0.52), w=0.3, h=0.32, face="+X", shutters=False)
    # hero: a big belfry on the ridge with a brass bell, taller than the roof
    bz = 0.88 + 0.65 - 0.08; by = cy - 0.22
    for x in (-0.19, 0.19):
        for y in (-0.19, 0.19):
            P.append(box(f"bp{x}{y}", (0.07, 0.07, 0.55), (x, by + y, bz), M["white"], bev=0.01))
    P.append(box("bfloor", (0.5, 0.5, 0.07), (0, by, bz), M["trim"], bev=0.015))
    P.append(box("brail", (0.52, 0.52, 0.05), (0, by, bz + 0.18), M["white"]))
    P.append(cyl("broof", 0.44, 0.0, 0.46, (0, by, bz + 0.55), M["roof"], seg=4, rot=(0, 0, math.pi / 4), bev=0.02))
    P.append(sphere("bknob", 0.05, (0, by, bz + 1.02), M["gold"], sub=1))
    P.append(cyl("bell", 0.08, 0.17, 0.24, (0, by, bz + 0.22), M["gold"], seg=14, smooth=True))
    P.append(cyl("bellip", 0.18, 0.18, 0.03, (0, by, bz + 0.21), M["gold"], seg=14, smooth=True))
    P.append(sphere("clap", 0.04, (0, by, bz + 0.18), M["dark"], sub=1))
    # chalkboard on an easel with an apple on top
    P.append(box("board", (0.5, 0.04, 0.34), (0.62, -0.65, 0.3), M["shutter"], bev=0.01))
    P.append(box("bframe", (0.54, 0.035, 0.38), (0.62, -0.635, 0.28), M["trim"]))
    for x in (0.42, 0.82): P.append(box(f"el{x}", (0.04, 0.04, 0.68), (x, -0.62, 0), M["wood"], rot=(0.15, 0, 0)))
    P.append(sphere("apple", 0.06, (0.75, -0.65, 0.7), M["apple"], sub=1))
    for k in range(3): P.append(box(f"chalk{k}", (0.12, 0.004, 0.012), (0.55 + k * 0.03, -0.67, 0.38 + k * 0.07), M["white"]))
    P.append(box("bench1", (0.6, 0.16, 0.05), (-0.55, -0.68, 0.2), M["plank"], bev=0.01))
    for x in (-0.78, -0.32): P.append(box(f"bl{x}", (0.05, 0.14, 0.2), (x, -0.68, 0), M["wood"]))
    return finish(root, P, E)

# ── Watchtower: a timber tower with a roofed platform, a flag and a lamp ──
def build_watchtower():
    M = wslots(); rnd = random.Random(29)
    root = empty("watchtower", (0, 0, 0)); P, E = [pad("pad", M, 1.9, 1.9)], []
    for x in (-0.42, 0.42):
        for y in (-0.42, 0.42):
            P.append(cyl(f"leg{x}{y}", 0.07, 0.09, 2.15, (x * 1.05, y * 1.05, 0), M["log"], seg=7, rot=(y * -0.08, x * 0.08, 0)))
    for z in (0.6, 1.3):
        for s in (-1, 1):
            P.append(box(f"xb{z}{s}", (0.06, 0.06, 1.15), (0, -0.44, z), M["wood"], base=False, rot=(0, s * 0.85, 0)))
    P.append(box("deck", (1.2, 1.2, 0.09), (0, 0, 2.0), M["plank"], bev=0.02))
    for (w, d, x, y) in [(1.2, 0.06, 0, 0.58), (1.2, 0.06, 0, -0.58), (0.06, 1.2, 0.58, 0), (0.06, 1.2, -0.58, 0)]:
        P.append(box(f"rail{x}{y}", (w, d, 0.32), (x, y, 2.09), M["log"], bev=0.015))
    for x in (-0.55, 0.55):
        for y in (-0.55, 0.55): P.append(box(f"rp{x}{y}", (0.06, 0.06, 0.62), (x, y, 2.09), M["wood"]))
    P.append(cyl("roof", 0.95, 0.0, 0.6, (0, 0, 2.68), M["roof"], seg=4, rot=(0, 0, math.pi / 4), bev=0.02))
    # ladder
    for x in (-0.12, 0.12): P.append(box(f"ll{x}", (0.04, 0.04, 2.1), (x, -0.68, 0), M["wood"], rot=(-0.12, 0, 0)))
    for k in range(9): P.append(box(f"rung{k}", (0.26, 0.03, 0.03), (0, -0.68 + k * 0.025, 0.18 + k * 0.22), M["wood"]))
    P.append(box("lamp", (0.13, 0.13, 0.16), (-0.5, -0.6, 2.42), M["glow"], bev=0.02))
    E.append(empty("pt_glow_lamp", (-0.5, -0.6, 2.5)))
    P.append(box("pole", (0.04, 0.04, 0.85), (0.5, -0.5, 2.6), M["dark"]))
    flag = empty("anim_flagMesh", (0.5, -0.5, 3.3))
    f = box("flag", (0.4, 0.02, 0.24), (0.72, -0.5, 3.15), M["red"], bev=0.005)
    parent(f, flag); parent(flag, root)
    return finish(root, P, E)

# ── Wizard tower: a leaning stone tower, a crooked starry hat roof, glowing windows ──
def build_wizard():
    M = wslots(); rnd = random.Random(30)
    root = empty("wizard", (0, 0, 0)); P, E = [pad("pad", M, 1.9, 1.9)], []
    P.append(cyl("base", 0.66, 0.74, 0.4, (0, 0, 0), M["stone2"], seg=10, bev=0.04))
    segs = 5; z = 0.4; r = 0.56
    for k in range(segs):
        h = 0.5
        rr = r - k * 0.025
        P.append(cyl(f"seg{k}", rr - 0.02, rr, h, (math.sin(k * 0.6) * 0.03, 0, z), M["stone"] if k % 2 == 0 else M["stone2"], seg=10, bev=0.02))
        z += h
    P.append(cyl("rim", 0.62, 0.55, 0.14, (0, 0, z), M["purple"], seg=10, bev=0.03))
    # crooked cone hat: three stacked cones bending to one side
    hat = [cyl("h1", 0.7, 0.42, 0.6, (0, 0, z + 0.1), M["purple"], seg=10, bev=0.02),
           cyl("h2", 0.42, 0.2, 0.55, (0.08, 0, z + 0.68), M["purple"], seg=10, rot=(0, 0.25, 0)),
           cyl("h3", 0.2, 0.0, 0.45, (0.25, 0, z + 1.16), M["purple"], seg=10, rot=(0, 0.6, 0))]
    P += hat
    P.append(sphere("star", 0.1, (0.55, 0, z + 1.42), M["gold"], sub=0))
    for k in range(6):
        a = k * 1.1; hz = z + 0.2 + (k % 3) * 0.25
        P.append(sphere(f"st{k}", 0.035, (math.cos(a) * 0.55, math.sin(a) * 0.55, hz), M["gold"], sub=0))
    # glowing windows up the tower
    for k, (zz, a) in enumerate([(1.0, -math.pi / 2), (1.65, -math.pi / 2 + 0.9), (2.2, -math.pi / 2 - 0.7)]):
        x, y = math.cos(a) * 0.53, math.sin(a) * 0.53
        w = poly_extrude(f"gw{k}", arch_pts(0.2, 0.3, 6), 0.08, (x, y, zz), M["glow"])
        w.rotation_euler = (0, 0, a + math.pi / 2); P.append(w)
        E.append(empty("pt_glow_lamp", (x * 1.05, y * 1.05, zz + 0.15)))
    P.append(door("door", M, (0, -0.68, 0.0), w=0.32, h=0.6))
    P.append(cyl("orbp", 0.16, 0.2, 0.3, (0.7, -0.55, 0), M["stone"], seg=8))
    P.append(sphere("orb", 0.11, (0.7, -0.55, 0.42), M["glow"], sub=2, smooth=True))
    return finish(root, P, E)

# ── Tiled house: stone ground floor, plaster above, slate hip roof ──
def build_tiled(two=0):
    M = slots(); rnd = random.Random(31 + two)
    M["roof"] = material("roof", 0x3f7fc4)
    root = empty("tiled", (0, 0, 0)); P, E = [pad("pad", M, 1.9, 1.9)], []
    W, D = 1.45, 1.25
    H1 = 0.4; H = 0.95 + (0.62 if two else 0)
    P.append(walls("base", M, W + 0.06, D + 0.06, H1, mat=M["stone"]))
    P += block("main", M, W, D, H - H1, 0.75, front_gable=False, over=0.16, rows=5, sag=0.05, z0=H1, rnd=rnd)
    # a front gable cross-wing for the entrance
    P += block("porch", M, 0.6, 0.35, H - 0.1, 0.42, front_gable=True, over=0.08, rows=3, x=-0.3, y=-D / 2 - 0.12, rnd=rnd)
    P.append(door("door", M, (-0.3, -D / 2 - 0.3, 0.0), w=0.3, h=0.55))
    E += window("w1", M, (0.38, -D / 2 - 0.04, 0.62), w=0.3, h=0.3)
    E += window("w2", M, (W / 2 + 0.04, 0.0, 0.62), face="+X")
    if two:
        E += window("u1", M, (0.38, -D / 2 - 0.01, 1.25), w=0.28, h=0.28, box_flowers=True)
    E += chimney("chim", M, (0.45, 0.25, H + 0.1), h=0.7, lean=-0.04, rnd=rnd)
    P.append(bush("b1", M, (0.75, -0.8, 0), rnd=rnd))
    return finish(root, P, E)

# ── Apiary: straw skep hives on a bench, a flower border ──
def build_beehive():
    M = wslots(); rnd = random.Random(32)
    root = empty("beehive", (0, 0, 0)); P, E = [box("pad", (1.8, 1.8, 0.04), (0, 0, -0.01), material("grass", 0x86c25a))], []
    P.append(box("bench", (1.3, 0.36, 0.06), (0, 0.1, 0.25), M["plank"], bev=0.015))
    for x in (-0.55, 0.55): P.append(box(f"bl{x}", (0.06, 0.3, 0.25), (x, 0.1, 0), M["wood"]))
    for k, x in enumerate((-0.42, 0.0, 0.42)):
        # coiled straw skep: stacked rings shrinking to a dome
        for j in range(5):
            r = 0.17 - j * 0.028
            P.append(cyl(f"sk{k}{j}", r, r + 0.01, 0.07, (x, 0.1, 0.31 + j * 0.062), M["hay"], seg=12, bev=0.025, segs=2, smooth=True))
        P.append(sphere(f"skt{k}", 0.05, (x, 0.1, 0.62), M["hay"], sub=1, smooth=True))
        P.append(poly_extrude(f"ent{k}", arch_pts(0.07, 0.06, 4), 0.02, (x, 0.1 - 0.17, 0.31), M["dark"]))
    flowers = [M["fl1"], M["fl2"], M["purple"], M["fl3"]]
    for k in range(14):
        x = -0.8 + k * 0.12; y = -0.55 + rnd.uniform(-0.12, 0.12)
        P.append(box(f"fs{k}", (0.02, 0.02, 0.16), (x, y, 0), M["leaf"]))
        P.append(sphere(f"fh{k}", 0.05, (x, y, 0.19), flowers[k % 4], sub=0))
    P.append(box("smoker", (0.1, 0.1, 0.16), (0.75, 0.6, 0), M["metal"], bev=0.02))
    return finish(root, P, E)

# ── decorations ──
def build_lantern():
    M = wslots(); root = empty("lantern", (0, 0, 0)); P, E = [], []
    P.append(box("post", (0.09, 0.09, 1.0), (0, 0, 0), M["wood"], bev=0.015))
    P.append(box("foot", (0.2, 0.2, 0.08), (0, 0, 0), M["stone"], bev=0.02))
    P.append(box("arm", (0.32, 0.05, 0.05), (0.12, 0, 0.95), M["wood"]))
    P.append(box("cage", (0.18, 0.18, 0.22), (0.24, 0, 0.66), M["metal"], bev=0.02))
    P.append(box("glass", (0.15, 0.2, 0.18), (0.24, 0, 0.68), M["glow"]))
    P.append(box("glass2", (0.2, 0.15, 0.18), (0.24, 0, 0.68), M["glow"]))
    P.append(cyl("hat", 0.15, 0.03, 0.1, (0.24, 0, 0.88), M["metal"], seg=4, rot=(0, 0, math.pi / 4)))
    E.append(empty("pt_glow_lamp", (0.24, 0, 0.77)))
    return finish(root, P, E)

def build_torch():
    M = wslots(); root = empty("torch", (0, 0, 0)); P, E = [], []
    P.append(cyl("pole", 0.04, 0.05, 0.78, (0, 0, 0), M["wood"], seg=6))
    P.append(cyl("bowl", 0.09, 0.05, 0.1, (0, 0, 0.75), M["metal"], seg=8))
    P.append(box("glow", (0.08, 0.08, 0.06), (0, 0, 0.82), M["glow"]))
    return finish(root, P, E)

def build_statue():
    """A cheerful hero on a plinth, sword raised."""
    M = wslots(); root = empty("statue", (0, 0, 0)); P, E = [], []
    S = material("bronze", 0x5f9e8f)
    P.append(box("plinth", (0.62, 0.62, 0.22), (0, 0, 0), M["stone"], bev=0.03))
    P.append(box("plinth2", (0.48, 0.48, 0.2), (0, 0, 0.22), M["cut"], bev=0.025))
    P.append(box("plaque", (0.24, 0.02, 0.1), (0, -0.25, 0.27), M["gold"]))
    P.append(cyl("base3", 0.18, 0.2, 0.04, (0, 0, 0.42), M["cut"], seg=10))
    z = 0.42
    P.append(cyl("legs", 0.1, 0.12, 0.2, (0, 0, z), S, seg=8))
    P.append(cyl("body", 0.09, 0.12, 0.26, (0, 0, z + 0.2), S, seg=8, bev=0.03))
    P.append(cyl("cape", 0.16, 0.12, 0.38, (0, 0.06, z + 0.05), S, seg=8, bev=0.02))
    P.append(uvsphere("head", 0.11, (0, 0, z + 0.58), S, seg=10, rings=8, smooth=False))
    P.append(box("armup", (0.06, 0.06, 0.26), (0.12, 0, z + 0.4), S, rot=(0, math.radians(25), 0)))
    P.append(box("sword", (0.04, 0.02, 0.5), (0.23, 0, z + 0.6), M["metal2"], rot=(0, math.radians(25), 0)))
    P.append(box("guard", (0.14, 0.04, 0.03), (0.23, 0, z + 0.6), M["gold"], rot=(0, math.radians(25), 0)))
    P.append(box("shield", (0.04, 0.2, 0.24), (-0.14, -0.02, z + 0.2), S, bev=0.03))
    for k in range(4):
        a = k * math.pi / 2 + 0.4
        P.append(sphere(f"fl{k}", 0.06, (math.cos(a) * 0.36, math.sin(a) * 0.36, 0.06), [M["fl1"], M["fl2"], M["purple"], M["fl3"]][k], sub=0))
    return finish(root, P, E)

def build_well():
    """Stone ring, two chunky posts, a crank on the crossbeam, a hanging bucket, a small roof."""
    M = wslots(); root = empty("well", (0, 0, 0)); P, E = [], []
    P.append(cyl("ring", 0.34, 0.37, 0.36, (0, 0, 0), M["stone"], seg=12, bev=0.04))
    P.append(cyl("lip", 0.36, 0.36, 0.05, (0, 0, 0.34), M["cut"], seg=12, bev=0.015))
    P.append(cyl("water", 0.27, 0.27, 0.02, (0, 0, 0.3), M["water"], seg=12))
    for x in (-0.3, 0.3): P.append(box(f"p{x}", (0.08, 0.08, 0.66), (x, 0, 0.36), M["wood"], bev=0.015))
    P.append(cyl("axle", 0.05, 0.05, 0.66, (-0.33, 0, 0.82), M["log"], seg=8, rot=(0, math.pi / 2, 0)))
    P.append(box("crank", (0.04, 0.04, 0.16), (0.36, 0, 0.74), M["metal"]))
    P.append(box("handle", (0.1, 0.03, 0.03), (0.4, 0, 0.68), M["wood"]))
    P.append(box("rope", (0.015, 0.015, 0.3), (0, 0, 0.52), M["rope"]))
    P.append(cyl("bucket", 0.07, 0.06, 0.11, (0, 0, 0.42), M["wood"], seg=8, bev=0.01))
    P.append(cyl("bband", 0.072, 0.072, 0.02, (0, 0, 0.5), M["metal"], seg=8))
    P.append(gable_roof("roof", 0.62, 0.4, 0.22, M, over=0.06, thick=0.05, loc=(0, 0, 1.02), sag=0))
    g = gable_fill("gable", M, 0.6, 0.38, 0.2, 1.02, mat=M["wood"]); g.location = (0, 0, 1.02); P.append(g)
    return finish(root, P, E)

