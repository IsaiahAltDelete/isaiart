# Workplaces. Each one gets a big "hero prop" that says what it does from the
# overview camera. Footprints: 2x2 -> +-0.95, 3x2 -> x +-1.45, y +-0.95.
import math, random

def wslots():
    M = slots()
    M.update(log=material("log", 0x9a6a3e), logend=material("logend", 0xe0bf86), metal2=material("steel", 0xc9cdd1),
             rope=material("rope", 0x8a7350), sack=material("sack", 0xe3cfa2), bread=material("bread", 0xd9963f),
             crust=material("crust", 0xb8742f), brick=material("brick", 0xb8613f), cloth=material("cloth", 0xf6eedd),
             awning=material("awning", 0xffffff), red=material("paint", 0xc9473d), gold=material("gold", 0xf0b429),
             apple=material("apple", 0xd23a4a), orange=material("orange", 0xe58a3a), cabbage=material("cabbage", 0x7cc04a),
             yolk=material("yolk", 0xe8c14a), rock=material("rock", 0xa2a39e), rock2=material("rock2", 0x8f918c),
             cut=material("cut", 0xc9c3b5), dark=material("darkwood", 0x5e3b22), water=material("water", 0x5ab0e0),
             copper=material("copper", 0xc0703a), cheese=material("cheese", 0xf2c94a), white=material("white", 0xf7f3ea),
             plank=material("plank", 0xc8955a), hay=material("hay", 0xe6c35c), purple=material("purple", 0x5b3fa0),
             glow=material("lamp", 0xffe08a), sail=material("sail", 0xf6eedd))
    return M

def logs_stack(name, M, x, y, rows=3, L=0.7, r=0.09, axis="y"):
    parts = []
    for i in range(rows):
        for j in range(rows - i):
            off = -((rows - i - 1) * r) + j * 2 * r
            if axis == "y":
                c = cyl(f"{name}{i}{j}", r, r, L, (x + off, y - L / 2, r + i * r * 1.75), M["log"], seg=8, rot=(-math.pi / 2, 0, 0))
                e1 = cyl(f"{name}e{i}{j}", r * 0.82, r * 0.82, 0.012, (x + off, y - L / 2 - 0.006, r + i * r * 1.75), M["logend"], seg=8, rot=(-math.pi / 2, 0, 0))
            else:
                c = cyl(f"{name}{i}{j}", r, r, L, (x - L / 2, y + off, r + i * r * 1.75), M["log"], seg=8, rot=(0, math.pi / 2, 0))
                e1 = cyl(f"{name}e{i}{j}", r * 0.82, r * 0.82, 0.012, (x - L / 2 - 0.006, y + off, r + i * r * 1.75), M["logend"], seg=8, rot=(0, math.pi / 2, 0))
            parts += [c, e1]
    return parts

def crate(name, M, loc, s=0.26, rot=0.0):
    x, y, z = loc
    parts = [box(f"{name}_b", (s, s, s), (x, y, z), M["plank"], bev=0.02, rot=(0, 0, rot))]
    for dz in (0.05, s - 0.05):
        parts.append(box(f"{name}_s{dz}", (s + 0.02, s + 0.02, 0.04), (x, y, z + dz - 0.02), M["wood"], rot=(0, 0, rot)))
    return parts

def barrel(name, M, loc, r=0.13, h=0.32):
    x, y, z = loc
    return [cyl(f"{name}_b", r * 0.9, r * 0.9, h, (x, y, z), M["wood"], seg=10, bev=0.03, segs=2),
            cyl(f"{name}_m", r, r, h * 0.5, (x, y, z + h * 0.25), M["wood"], seg=10, bev=0.02),
            cyl(f"{name}_h1", r * 0.94, r * 0.94, 0.025, (x, y, z + h * 0.12), M["metal"], seg=10),
            cyl(f"{name}_h2", r * 0.94, r * 0.94, 0.025, (x, y, z + h * 0.85), M["metal"], seg=10)]

def sack(name, M, loc, s=0.14):
    x, y, z = loc
    return [sphere(f"{name}_s", s, (x, y, z + s * 0.8), M["sack"], sub=2, scale=(1, 0.85, 1.05), smooth=True),
            cyl(f"{name}_t", s * 0.3, s * 0.42, s * 0.4, (x, y, z + s * 1.55), M["sack"], seg=8),
            cyl(f"{name}_r", s * 0.3, s * 0.3, 0.03, (x, y, z + s * 1.6), M["rope"], seg=8)]

def finish(root, P, extra):
    pts = [o for o in extra if o.type == "EMPTY"]
    body = join(P + [o for o in extra if o.type == "MESH"], "body")
    parent(body, root)
    for o in pts: parent(o, root)
    return root

def log_cabin(name, M, W, D, H, loc=(0, 0, 0), r=0.07):
    """Walls of stacked logs with crossed ends poking out at the corners."""
    x0, y0, _ = loc
    parts = []
    n = int(H / (r * 1.8))
    for i in range(n):
        z = r + i * r * 1.8
        if i % 2 == 0:
            for y in (y0 - D / 2, y0 + D / 2):
                parts.append(cyl(f"{name}x{i}{y}", r, r, W + 0.2, (x0 - W / 2 - 0.1, y, z), M["log"], seg=7, rot=(0, math.pi / 2, 0)))
        else:
            for x in (x0 - W / 2, x0 + W / 2):
                parts.append(cyl(f"{name}y{i}{x}", r, r, D + 0.2, (x, y0 - D / 2 - 0.1, z), M["log"], seg=7, rot=(-math.pi / 2, 0, 0)))
    parts.append(box(f"{name}_core", (W - 0.02, D - 0.02, n * r * 1.8), (x0, y0, 0), M["log"]))
    return parts

# ── Lumber Hut: log cabin, a giant axe in a stump, a log pile ──
def build_lumber():
    M = wslots(); rnd = random.Random(7)
    root = empty("lumber", (0, 0, 0)); P, E = [pad("pad", M, 1.9, 1.9)], []
    W, D = 1.15, 0.95; cx, cy = -0.25, 0.3
    P += log_cabin("cab", M, W, D, 0.8, (cx, cy, 0))
    g = gable_fill("gable", M, W, D, 0.55, 0.8, mat=M["log"]); g.location = (cx, cy, 0.8); P.append(g)
    P.append(gable_roof("roof", W, D, 0.55, M, over=0.16, rows=4, loc=(cx, cy, 0.8), rnd=rnd))
    P.append(barge_boards("barge", W, D, 0.55, M, over=0.16, loc=(cx, cy, 0.8)))
    P.append(door("door", M, (cx - 0.2, cy - D / 2 - 0.08, 0.0), w=0.3, h=0.52))
    E += window("w1", M, (cx + 0.28, cy - D / 2 - 0.08, 0.45), w=0.24, h=0.24)
    P += logs_stack("pile", M, 0.72, 0.25, rows=3, L=0.85, r=0.085)
    # the hero: a big stump with a huge axe sunk into it
    P.append(cyl("stump", 0.22, 0.26, 0.26, (0.45, -0.6, 0), M["log"], seg=10, bev=0.03))
    P.append(cyl("stumptop", 0.2, 0.2, 0.02, (0.45, -0.6, 0.26), M["logend"], seg=10))
    axe = [box("haft", (0.06, 0.06, 0.62), (0, 0, 0), M["wood"], bev=0.015),
           poly_extrude("blade", [(-0.02, 0.0), (0.2, -0.08), (0.24, 0.0), (0.24, 0.16), (0.2, 0.22), (-0.02, 0.14)], 0.05, (0.0, 0, 0.42), M["metal2"], bev=0.012)]
    a = join(axe, "axe"); a.location = (0.38, -0.6, 0.2); a.rotation_euler = (0, math.radians(-28), math.radians(20)); P.append(a)
    # sawhorse with a log
    for x in (-0.75, -0.35):
        for s in (-1, 1):
            P.append(box(f"sh{x}{s}", (0.04, 0.04, 0.42), (x, -0.62 + s * 0.06, 0), M["wood"], rot=(s * 0.35, 0, 0)))
    P.append(cyl("hl", 0.08, 0.08, 0.6, (-0.85, -0.62, 0.36), M["log"], seg=8, rot=(0, math.pi / 2, 0)))
    E += chimney("chim", M, (cx - 0.35, cy + 0.25, 0.9), h=0.6, lean=0.05, rnd=rnd)
    return finish(root, P, E)

# ── Sawmill: a lean-to shed at the back, the big round saw out front ──
def build_sawmill():
    M = wslots(); rnd = random.Random(8)
    root = empty("sawmill", (0, 0, 0)); P, E = [pad("pad", M, 1.9, 1.9)], []
    P.append(box("deck", (1.75, 1.6, 0.08), (0, 0.0, 0), M["plank"], bev=0.02))
    for x in (-0.8, 0.8):
        for y in (0.0, 0.75):
            P.append(box(f"post{x}{y}", (0.1, 0.1, 1.0 if y > 0.5 else 0.82), (x, y, 0.08), M["log"], bev=0.02))
    P.append(lean_roof("roof", 1.7, 0.8, 0.28, M, over=0.12, rows=3, loc=(0, 0.37, 0.9), rnd=rnd))
    P.append(box("backwall", (1.6, 0.06, 0.82), (0, 0.78, 0.08), M["plank"], bev=0.01))
    # planks stacked under the shed
    for k in range(6):
        P.append(box(f"pl{k}", (1.1, 0.26, 0.045), (-0.15 + rnd.uniform(-0.03, 0.03), 0.45, 0.08 + k * 0.05), M["plank"], bev=0.008))
    P += logs_stack("lg", M, 0.6, 0.5, rows=2, L=0.55, r=0.08, axis="x")
    # the saw table and a log on its carriage, in the open
    P.append(box("table", (1.3, 0.36, 0.42), (-0.1, -0.45, 0.08), M["dark"], bev=0.03))
    P.append(cyl("logc", 0.13, 0.13, 0.75, (-0.85, -0.45, 0.63), M["log"], seg=9, rot=(0, math.pi / 2, 0)))
    P.append(cyl("logce", 0.11, 0.11, 0.015, (-0.86, -0.45, 0.63), M["logend"], seg=9, rot=(0, math.pi / 2, 0)))
    P += barrel("bar", M, (0.78, -0.75, 0.08))
    # hero: the blade, upright, spinning about the front axis
    hub = empty("anim_blade", (0.22, -0.45, 0.7))
    teeth = []
    for k in range(16):
        an = k / 16 * math.pi * 2
        teeth.append(box(f"t{k}", (0.08, 0.03, 0.08), (0.22 + math.cos(an) * 0.42, -0.45, 0.7 + math.sin(an) * 0.42), M["metal2"], base=False, rot=(0, -an + math.pi / 4, 0)))
    disc = cyl("disc", 0.42, 0.42, 0.03, (0.22, -0.435, 0.7), M["metal2"], seg=20, rot=(math.pi / 2, 0, 0))
    hubc = cyl("hubc", 0.08, 0.08, 0.07, (0.22, -0.42, 0.7), M["metal"], seg=10, rot=(math.pi / 2, 0, 0))
    bl = join([disc, hubc] + teeth, "blade_mesh")
    parent(bl, hub); parent(hub, root)
    return finish(root, P, E)

# ── Bakery: brick-and-plaster shop, domed bread oven, a giant pretzel sign ──
def build_bakery():
    M = wslots(); rnd = random.Random(9)
    root = empty("bakery", (0, 0, 0)); P, E = [pad("pad", M, 1.9, 1.9)], []
    W, D = 1.2, 1.1; cx = -0.25
    P.append(plinth("plinth", M, W, D, rnd=rnd)); P[-1].location = (cx, 0.2, 0)
    P += block("main", M, W, D, 0.9, 0.62, front_gable=True, over=0.14, rows=4, x=cx, y=0.2, rnd=rnd)
    P.append(timber_frame("frame", M, W, D, 0.9, 0.0, braces=False)); P[-1].location = (cx, 0.2, 0)
    P.append(door("door", M, (cx - 0.22, 0.2 - D / 2 - 0.01, 0.0), w=0.3, h=0.55))
    # display window with loaves on the sill
    E += window("w1", M, (cx + 0.25, 0.2 - D / 2 - 0.01, 0.48), w=0.36, h=0.28, shutters=False)
    for k in range(3):
        P.append(sphere(f"loaf{k}", 0.06, (cx + 0.15 + k * 0.1, 0.2 - D / 2 - 0.08, 0.36), M["bread"], sub=2, scale=(1.3, 0.8, 0.7), smooth=True))
    # striped awning over the window
    P.append(box("awn", (0.5, 0.3, 0.03), (cx + 0.25, 0.2 - D / 2 - 0.15, 0.72), M["awning"], rot=(0.5, 0, 0), bev=0.01))
    # hero 1: the domed oven on the side
    ox, oy = 0.62, 0.15
    P.append(cyl("ovenbase", 0.34, 0.36, 0.25, (ox, oy, 0), M["stone"], seg=12, bev=0.03))
    P.append(uvsphere("dome", 0.34, (ox, oy, 0.25), M["brick"], seg=14, rings=10, cut=0.0, smooth=False))
    P.append(poly_extrude("mouth", arch_pts(0.22, 0.2, 6), 0.06, (ox, oy - 0.33, 0.25), M["dark"]))
    P.append(box("glow", (0.16, 0.04, 0.1), (ox, oy - 0.33, 0.27), M["win"]))
    E.append(empty("pt_glow_lamp", (ox, oy - 0.38, 0.32)))
    P.append(cyl("ochim", 0.07, 0.08, 0.35, (ox + 0.08, oy + 0.15, 0.48), M["stone2"], seg=8))
    E.append(empty("pt_smoke", (ox + 0.08, oy + 0.15, 0.9)))
    E += chimney("chim", M, (cx + 0.3, 0.45, 1.2), h=0.6, lean=0.04, rnd=rnd)
    # hero 2: a big golden pretzel hanging from an iron bracket
    P.append(box("brk", (0.04, 0.42, 0.04), (cx - 0.55, 0.2 - D / 2 - 0.2, 0.95), M["metal"]))
    pr = []
    for k in range(18):
        t = k / 18 * math.pi * 2
        x = math.sin(t) * 0.16; z = math.sin(2 * t) * 0.07 - math.cos(t) * 0.05
        pr.append(sphere(f"pz{k}", 0.045, (x, 0, z), M["bread"], sub=1))
    p = join(pr, "pretzel"); p.location = (cx - 0.55, 0.2 - D / 2 - 0.38, 0.78); P.append(p)
    # flour sacks and a bread rack
    P += sack("s1", M, (0.35, -0.72, 0)); P += sack("s2", M, (0.55, -0.65, 0), 0.12)
    P.append(box("rack", (0.42, 0.14, 0.04), (-0.65, -0.78, 0.3), M["wood"], bev=0.01))
    for x in (-0.84, -0.46): P.append(box(f"rl{x}", (0.04, 0.12, 0.3), (x, -0.78, 0), M["wood"]))
    for k in range(3): P.append(sphere(f"rb{k}", 0.055, (-0.78 + k * 0.13, -0.78, 0.38), M["bread"], sub=2, scale=(1.4, 0.8, 0.75), smooth=True))
    return finish(root, P, E)

# ── Windmill: tapered tower on a stone base, cap with a tail beam, big lattice sails ──
def build_windmill():
    M = wslots(); rnd = random.Random(10)
    root = empty("windmill", (0, 0, 0)); P, E = [pad("pad", M, 1.9, 1.9)], []
    P.append(cyl("base", 0.68, 0.74, 0.3, (0, 0.05, 0), M["stone"], seg=8, bev=0.04))
    P.append(cyl("tower", 0.44, 0.62, 1.55, (0, 0.05, 0.3), M["wall"], seg=8, bev=0.03))
    for k, z in enumerate((0.75, 1.3)):
        P.append(cyl(f"band{k}", 0.6 - k * 0.09, 0.6 - k * 0.09, 0.05, (0, 0.05, z), M["trim"], seg=8))
    P.append(cyl("capring", 0.5, 0.5, 0.08, (0, 0.05, 1.85), M["trim"], seg=8))
    P.append(cyl("cap", 0.52, 0.12, 0.62, (0, 0.05, 1.92), M["roof"], seg=8, bev=0.03))
    P.append(sphere("knob", 0.08, (0, 0.05, 2.56), M["gold"], sub=1))
    # tail beam down the back
    P.append(box("tail", (0.07, 0.07, 1.4), (0, 0.55, 1.2), M["wood"], rot=(math.radians(35), 0, 0)))
    P.append(door("door", M, (0, 0.05 - 0.6, 0.3), w=0.3, h=0.48))
    P.append(box("stepblk", (0.4, 0.2, 0.3), (0, -0.62, 0), M["stone"], bev=0.03))
    E += window("w1", M, (0, 0.05 - 0.5, 1.1), w=0.2, h=0.24, shutters=False)
    P += sack("s1", M, (0.55, -0.6, 0)); P += sack("s2", M, (0.72, -0.48, 0), 0.12)
    P.append(box("hay", (0.4, 0.28, 0.26), (-0.6, -0.55, 0), M["hay"], bev=0.04))
    # hero: sails on a hub in front of the cap
    hub = empty("anim_blades", (0, -0.5, 1.95))
    sails = [cyl("axle", 0.08, 0.08, 0.2, (0, -0.42, 1.95), M["dark"], seg=8, rot=(math.pi / 2, 0, 0))]
    for k in range(4):
        a = k * math.pi / 2 + math.pi / 4
        ca, sa = math.cos(a), math.sin(a)
        arm = box(f"arm{k}", (0.07, 0.05, 1.05), (0, -0.52, 1.95), M["wood"], base=True, rot=(0, -a + math.pi / 2, 0))
        sails.append(arm)
        # lattice sail: frame + cloth panel offset to one side of the arm
        for j in range(4):
            r = 0.3 + j * 0.2
            sails.append(box(f"slat{k}{j}", (0.36, 0.03, 0.03), (ca * r - sa * 0.18, -0.54, 1.95 + sa * r + ca * 0.18), M["wood"], base=False, rot=(0, -a + math.pi / 2 + math.pi / 2, 0)))
        sails.append(box(f"cloth{k}", (0.32, 0.015, 0.68), (ca * 0.6 - sa * 0.18, -0.535, 1.95 + sa * 0.6 + ca * 0.18), M["sail"], base=False, rot=(0, -a + math.pi / 2, 0)))
    s = join(sails, "sails_mesh"); parent(s, hub); parent(hub, root)
    return finish(root, P, E)

# ── Market stall: striped awning, crates of produce, a hanging sign ──
def build_market():
    M = wslots(); rnd = random.Random(11)
    root = empty("market", (0, 0, 0)); P, E = [pad("pad", M, 1.9, 1.9)], []
    P.append(box("counter", (1.45, 0.55, 0.5), (0, -0.05, 0), M["plank"], bev=0.03))
    P.append(box("ctop", (1.55, 0.62, 0.05), (0, -0.05, 0.5), M["wood"], bev=0.015))
    for x in (-0.72, 0.72):
        for y in (-0.35, 0.45):
            P.append(box(f"p{x}{y}", (0.07, 0.07, 1.3 if y > 0 else 1.15), (x, y, 0), M["wood"], bev=0.015))
    # awning: scalloped edge of alternating cloth flaps
    for k in range(8):
        P.append(box(f"awn{k}", (0.205, 0.98, 0.04), (-0.715 + k * 0.204, 0.05, 1.2 + (k % 2) * 0.004), M["cloth"] if k % 2 else M["red"], base=False, rot=(-0.3, 0, 0), bev=0.008))
        sc = uvsphere(f"flap{k}", 0.1, (-0.715 + k * 0.204, -0.42, 1.06), M["cloth"] if k % 2 else M["red"], seg=10, rings=6, scale=(1.0, 0.25, 0.8), smooth=False)
        P.append(sc)
    # produce crates on the counter: apples, oranges, cabbages, bread
    goods = [("apple", 0.055), ("orange", 0.055), ("cabbage", 0.075), ("bread", 0.06)]
    for k, (g, r) in enumerate(goods):
        x = -0.54 + k * 0.36
        P += crate(f"cr{k}", M, (x, -0.12, 0.55), s=0.3)
        for j in range(5):
            P.append(sphere(f"{g}{k}{j}", r, (x - 0.07 + (j % 3) * 0.07, -0.12 - 0.05 + (j // 3) * 0.09, 0.85 + (j // 3) * 0.03), M[g], sub=1, smooth=False))
    # hanging sign
    P.append(box("sgn", (0.5, 0.04, 0.22), (0, -0.42, 1.25), M["wood"], bev=0.015))
    P.append(sphere("sgnapple", 0.07, (0, -0.45, 1.36), M["apple"], sub=1))
    P += barrel("b1", M, (0.8, -0.7, 0)); P += crate("cr9", M, (-0.75, -0.7, 0), s=0.3, rot=0.3)
    P += sack("s1", M, (-0.45, -0.78, 0), 0.12)
    return finish(root, P, E)

# ── Storehouse (3x2): a red barn, gable to the front, big X-braced doors ──
def build_storehouse():
    M = wslots(); rnd = random.Random(12)
    root = empty("storehouse", (0, 0, 0)); P, E = [pad("pad", M, 2.85, 1.9)], []
    W, D, H = 1.75, 1.5, 0.95
    P.append(plinth("plinth", M, W, D, rnd=rnd))
    P += block("barn", M, W, D, H, 0.85, front_gable=True, over=0.13, rows=5, sag=0.05, wall_mat=M["red"], rnd=rnd)
    for x in (-W / 2, W / 2):
        for y in (-D / 2, D / 2):
            P.append(box(f"cn{x}{y}", (0.08, 0.08, H), (x, y, 0), M["white"], bev=0.015))
    P.append(box("eave", (W + 0.04, 0.07, 0.07), (0, -D / 2 - 0.02, H - 0.06), M["white"]))
    P.append(box("dframe", (0.95, 0.06, 0.82), (0, -D / 2 - 0.02, 0), M["white"], bev=0.015))
    for sx in (-1, 1):
        P.append(box(f"dl{sx}", (0.42, 0.06, 0.76), (sx * 0.22, -D / 2 - 0.04, 0), M["red"], bev=0.01))
        L = math.hypot(0.4, 0.72); ang = math.atan2(0.4, 0.72)
        P.append(box(f"x{sx}a", (0.05, 0.03, L), (sx * 0.22, -D / 2 - 0.08, 0.38), M["white"], base=False, rot=(0, ang, 0)))
        P.append(box(f"x{sx}b", (0.05, 0.03, L), (sx * 0.22, -D / 2 - 0.08, 0.38), M["white"], base=False, rot=(0, -ang, 0)))
    P.append(box("loft", (0.4, 0.06, 0.36), (0, -D / 2 - 0.02, H + 0.08), M["white"], bev=0.01))
    P.append(box("loftd", (0.3, 0.07, 0.27), (0, -D / 2 - 0.03, H + 0.12), M["dark"]))
    P.append(box("hayout", (0.26, 0.1, 0.1), (0, -D / 2 - 0.06, H + 0.12), M["hay"], bev=0.04))
    P.append(box("pulley", (0.05, 0.3, 0.05), (0, -D / 2 - 0.12, H + 0.62), M["wood"]))
    E += window("w1", M, (W / 2 + 0.01, -0.2, 0.55), w=0.24, h=0.24, face="+X", shutters=False)
    # side lean-to with stacked crates and barrels
    P.append(box("lt", (0.62, 1.1, 0.06), (1.12, 0.05, 0.62), M["wood"], rot=(0, -0.25, 0)))
    for y in (-0.45, 0.5): P.append(box(f"ltp{y}", (0.06, 0.06, 0.55), (1.38, y, 0), M["wood"]))
    P += crate("c1", M, (1.15, -0.25, 0), s=0.3); P += crate("c2", M, (1.12, 0.12, 0), s=0.3, rot=0.2); P += crate("c3", M, (1.14, -0.1, 0.3), s=0.26, rot=-0.2)
    P += barrel("b1", M, (-1.15, -0.55, 0)); P += barrel("b2", M, (-1.2, -0.2, 0)); P += sack("s1", M, (-1.0, -0.8, 0), 0.12)
    P.append(box("hay2", (0.42, 0.3, 0.28), (-1.12, 0.35, 0), M["hay"], bev=0.04))
    return finish(root, P, E)

# ── Quarry: a rocky outcrop, stacked cut blocks, a timber crane ──
def build_quarry():
    M = wslots(); rnd = random.Random(13)
    root = empty("quarry", (0, 0, 0)); P, E = [box("pad", (1.9, 1.9, 0.06), (0, 0, -0.02), M["rock2"], bev=0.02)], []
    for k, (x, y, s, h) in enumerate([(-0.45, 0.4, 0.42, 0.8), (0.1, 0.55, 0.36, 0.6), (-0.65, -0.05, 0.3, 0.5), (0.5, 0.45, 0.3, 0.45)]):
        r = sphere(f"rock{k}", s, (x, y, h * 0.42), M["rock"] if k % 2 == 0 else M["rock2"], sub=1, scale=(1.2, 1.0, h / s * 0.62))
        P.append(r)
    # hero: crisp cut blocks in a neat stack
    for i in range(3):
        for j in range(3 - i):
            P.append(box(f"blk{i}{j}", (0.24, 0.24, 0.2), (0.35 + j * 0.26 + i * 0.13, -0.35, i * 0.2), M["cut"], bev=0.02))
    # crane: mast, jib, rope and a hanging block
    P.append(box("mast", (0.09, 0.09, 1.5), (-0.6, -0.55, 0), M["wood"], bev=0.015))
    P.append(box("jib", (0.9, 0.07, 0.07), (-0.2, -0.55, 1.42), M["wood"], bev=0.015))
    P.append(box("brace", (0.05, 0.05, 0.6), (-0.42, -0.55, 1.1), M["wood"], rot=(0, math.radians(45), 0)))
    P.append(box("rope", (0.015, 0.015, 0.6), (0.2, -0.55, 0.82), M["rope"]))
    P.append(box("hang", (0.2, 0.2, 0.16), (0.2, -0.55, 0.66), M["cut"], bev=0.02))
    P.append(cyl("wheel", 0.16, 0.16, 0.05, (-0.6, -0.48, 0.5), M["wood"], seg=10, rot=(math.pi / 2, 0, 0)))
    # a cart with stones
    P.append(box("cart", (0.45, 0.3, 0.16), (0.1, 0.0, 0.12), M["plank"], bev=0.02))
    for x in (-0.06, 0.26): P.append(cyl(f"cw{x}", 0.1, 0.1, 0.04, (x, 0.17, 0.1), M["dark"], seg=10, rot=(math.pi / 2, 0, 0)))
    for k in range(3): P.append(sphere(f"cs{k}", 0.08, (0.0 + k * 0.1, 0.0, 0.32), M["rock"], sub=0))
    P.append(box("pick", (0.03, 0.03, 0.4), (-0.15, -0.75, 0), M["wood"], rot=(0.4, 0, 0.2)))
    return finish(root, P, E)

# ── Stonemason: stone workshop, a carved stone arch, a workbench with blocks ──
def build_mason():
    M = wslots(); rnd = random.Random(14)
    root = empty("mason", (0, 0, 0)); P, E = [pad("pad", M, 1.9, 1.9)], []
    W, D = 1.2, 0.95; cx, cy = -0.25, 0.3
    P += block("main", M, W, D, 0.85, 0.5, over=0.13, rows=4, x=cx, y=cy, wall_mat=M["stone"], rnd=rnd)
    P.append(door("door", M, (cx - 0.2, cy - D / 2 - 0.01, 0.0), w=0.3, h=0.52))
    E += window("w1", M, (cx + 0.28, cy - D / 2 - 0.01, 0.5), w=0.26, h=0.24, shutters=False)
    E += chimney("chim", M, (cx + 0.35, cy + 0.2, 1.0), h=0.5, lean=0.03, rnd=rnd)
    # hero: a freestanding stone arch, the mason's showpiece
    ax, ay = 0.62, -0.25
    for s in (-1, 1):
        for k in range(3):
            P.append(box(f"col{s}{k}", (0.16, 0.16, 0.18), (ax + s * 0.22, ay, k * 0.18), M["cut"], bev=0.02))
    for k in range(7):
        a = k / 6 * math.pi
        P.append(box(f"vs{k}", (0.16, 0.16, 0.12), (ax + math.cos(a) * 0.22, ay, 0.54 + math.sin(a) * 0.22), M["cut"], base=False, rot=(0, -a + math.pi / 2, 0), bev=0.015))
    # bench with a half-carved block and bricks
    P.append(box("bench", (0.55, 0.3, 0.32), (-0.45, -0.62, 0), M["wood"], bev=0.02))
    P.append(box("wip", (0.2, 0.2, 0.18), (-0.5, -0.62, 0.32), M["cut"], bev=0.03))
    for i in range(2):
        for j in range(3):
            P.append(box(f"br{i}{j}", (0.22, 0.11, 0.09), (0.1 + (j % 2) * 0.03, -0.75 + j * 0.13, i * 0.09), M["brick"], bev=0.01))
    return finish(root, P, E)
