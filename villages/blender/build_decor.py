# Decorations and farm enclosures. Animals in pens are added by the game.
import math, random

def fence_ring(name, M, w, d, gap=0.36, h=0.36):
    """Posts and two rails round a w x d pen, with a gate gap at the front (-Y)."""
    parts = []
    hw, hd = w / 2 - 0.08, d / 2 - 0.08
    sides = [((-hw, -hd), (hw, -hd)), ((hw, -hd), (hw, hd)), ((hw, hd), (-hw, hd)), ((-hw, hd), (-hw, -hd))]
    for si, ((x0, y0), (x1, y1)) in enumerate(sides):
        L = math.hypot(x1 - x0, y1 - y0); n = max(2, round(L / 0.45))
        for k in range(n + 1):
            t = k / n; x = x0 + (x1 - x0) * t; y = y0 + (y1 - y0) * t
            if si == 0 and abs(x) < gap: continue
            parts.append(box(f"{name}_p{si}{k}", (0.06, 0.06, h), (x, y, 0), M["wood"], bev=0.012))
            parts.append(cyl(f"{name}_c{si}{k}", 0.045, 0.0, 0.05, (x, y, h), M["wood"], seg=4, rot=(0, 0, math.pi / 4)))
        ang = math.atan2(y1 - y0, x1 - x0)
        for z in (0.12, 0.26):
            if si == 0:
                for sx in (-1, 1):
                    seg = (hw - gap)
                    parts.append(box(f"{name}_r{si}{z}{sx}", (seg, 0.035, 0.045), (sx * (gap + seg / 2), y0, z), M["plank"], base=False))
            else:
                parts.append(box(f"{name}_r{si}{z}", (L, 0.035, 0.045), ((x0 + x1) / 2, (y0 + y1) / 2, z), M["plank"], base=False, rot=(0, 0, ang)))
    return parts

def ground(name, w, d, col):
    return box(name, (w, d, 0.04), (0, 0, -0.01), material("grass", col), bev=0.015)

def build_coop():
    M = wslots(); rnd = random.Random(51)
    root = empty("coop", (0, 0, 0)); P, E = [ground("g", 1.85, 1.85, 0xc9b27a)], []
    P += fence_ring("f", M, 1.9, 1.9)
    # hen house on stilts with a straw roof and a ramp
    hx, hy = -0.32, 0.3
    for x in (-0.28, 0.28):
        for y in (-0.22, 0.22): P.append(box(f"st{x}{y}", (0.06, 0.06, 0.3), (hx + x, hy + y, 0), M["wood"]))
    P.append(box("house", (0.72, 0.56, 0.42), (hx, hy, 0.3), M["red"], bev=0.03))
    P.append(gable_roof("roof", 0.72, 0.56, 0.3, M, over=0.08, thick=0.08, rows=2, loc=(hx, hy, 0.72), mat=M["thatch"], puffy=True, rnd=rnd))
    g = gable_fill("gf", M, 0.7, 0.54, 0.28, 0.72, mat=M["red"]); g.location = (hx, hy, 0.72); P.append(g)
    P.append(poly_extrude("hole", arch_pts(0.16, 0.2, 5), 0.02, (hx, hy - 0.285, 0.36), M["dark"]))
    P.append(box("ramp", (0.14, 0.45, 0.025), (hx, hy - 0.45, 0.16), M["plank"], base=False, rot=(-0.6, 0, 0)))
    for k in range(4): P.append(box(f"rg{k}", (0.14, 0.02, 0.02), (hx, hy - 0.33 - k * 0.08, 0.27 - k * 0.055), M["wood"]))
    # feeder, water bowl and a nest of eggs
    P.append(cyl("feed", 0.12, 0.1, 0.1, (0.5, 0.45, 0), M["wood"], seg=10)); P.append(cyl("grain", 0.1, 0.1, 0.02, (0.5, 0.45, 0.09), M["hay"], seg=10))
    P.append(cyl("bowl", 0.1, 0.08, 0.05, (0.55, -0.2, 0), M["metal2"], seg=10)); P.append(cyl("bw", 0.085, 0.085, 0.01, (0.55, -0.2, 0.045), M["water"], seg=10))
    P.append(cyl("nest", 0.12, 0.1, 0.06, (0.15, 0.65, 0), M["hay"], seg=10, bev=0.02))
    for k in range(3): P.append(uvsphere(f"egg{k}", 0.03, (0.12 + k * 0.035, 0.65, 0.07), M["white"], seg=8, rings=6, scale=(1, 1, 1.3), smooth=True))
    return finish(root, P, E)

def build_pasture():
    M = wslots(); rnd = random.Random(52)
    root = empty("pasture", (0, 0, 0)); P, E = [ground("g", 2.85, 2.85, 0x8cc463)], []
    P += fence_ring("f", M, 2.9, 2.9)
    # shepherd's lean-to and a water trough
    P.append(box("shed", (0.75, 0.5, 0.45), (-0.9, 0.95, 0), M["log"], bev=0.02))
    P.append(lean_roof("sroof", 0.75, 0.5, 0.16, M, over=0.08, rows=2, loc=(-0.9, 0.95, 0.45), mat=M["thatch"], rnd=rnd))
    P.append(box("trough", (0.6, 0.18, 0.15), (0.8, 1.0, 0), M["dark"], bev=0.02)); P.append(box("tw", (0.54, 0.12, 0.01), (0.8, 1.0, 0.14), M["water"]))
    for k in range(5):
        P.append(cyl(f"tuft{k}", 0.05, 0.0, 0.1, (rnd.uniform(-1.1, 1.1), rnd.uniform(-1.0, 0.6), 0), material("tuft", 0x6fae45), seg=5))
    P.append(box("bale", (0.36, 0.24, 0.22), (1.05, 0.55, 0), M["hay"], bev=0.04))
    return finish(root, P, E)

def build_dairy():
    M = wslots(); rnd = random.Random(53)
    root = empty("dairy", (0, 0, 0)); P, E = [ground("g", 2.85, 2.85, 0x86c25a)], []
    P += fence_ring("f", M, 2.9, 2.9)
    # a little red cowshed with a white door, milk churns
    P += block("shed", M, 0.95, 0.65, 0.6, 0.32, front_gable=True, over=0.08, x=-0.85, y=0.95, wall_mat=M["red"], rnd=rnd)
    P.append(box("sdoor", (0.32, 0.03, 0.42), (-0.85, 0.95 - 0.33, 0), M["white"], bev=0.01))
    for x in (0.7, 0.92):
        P.append(cyl(f"ch{x}", 0.08, 0.09, 0.24, (x, 1.05, 0), M["metal2"], seg=10, bev=0.015))
        P.append(cyl(f"cl{x}", 0.05, 0.05, 0.04, (x, 1.05, 0.24), M["metal"], seg=8))
    P.append(box("feed", (0.6, 0.2, 0.14), (0.6, -0.95, 0), M["dark"], bev=0.02)); P.append(box("fh", (0.54, 0.14, 0.04), (0.6, -0.95, 0.13), M["hay"]))
    return finish(root, P, E)

def apple_tree(name, M, x, y, s=1.0, rnd=None):
    rnd = rnd or random.Random(1)
    parts = [cyl(f"{name}_t", 0.07 * s, 0.05 * s, 0.5 * s, (x, y, 0), M["log"], seg=6)]
    for k, (dx, dy, dz, r) in enumerate([(0, 0, 0.72, 0.36), (0.18, 0.08, 0.6, 0.24), (-0.16, -0.08, 0.62, 0.25), (0.02, -0.04, 0.95, 0.22)]):
        parts.append(sphere(f"{name}_c{k}", r * s, (x + dx * s, y + dy * s, dz * s), M["leaf"] if k % 2 == 0 else material("leaf2", 0x5fae45), sub=1))
    for k in range(7):
        a = rnd.uniform(0, math.pi * 2); z = rnd.uniform(0.55, 0.95) * s
        parts.append(sphere(f"{name}_a{k}", 0.045 * s, (x + math.cos(a) * 0.34 * s, y + math.sin(a) * 0.34 * s, z), M["apple"], sub=1))
    return parts

def build_orchard():
    M = wslots(); rnd = random.Random(54)
    root = empty("orchard", (0, 0, 0)); P, E = [ground("g", 2.8, 2.8, 0x7fbf55)], []
    for k, (x, y) in enumerate([(-0.85, -0.85), (0.85, -0.85), (0, 0), (-0.85, 0.85), (0.85, 0.85)]):
        P += apple_tree(f"tr{k}", M, x, y, 1.0 + (k % 2) * 0.12, rnd)
    P.append(cyl("basket", 0.14, 0.11, 0.16, (0.4, -1.15, 0), M["plank"], seg=10, bev=0.02))
    for k in range(4): P.append(sphere(f"ba{k}", 0.05, (0.36 + (k % 2) * 0.07, -1.15 + (k // 2) * 0.05, 0.18), M["apple"], sub=1))
    for s in (-1, 1): P.append(box(f"lad{s}", (0.03, 0.03, 0.85), (-0.45 + s * 0.08, -0.3, 0), M["plank"], rot=(0.3, 0, 0)))
    for k in range(4): P.append(box(f"rung{k}", (0.18, 0.025, 0.025), (-0.45, -0.3 + k * 0.05, 0.15 + k * 0.18), M["plank"]))
    return finish(root, P, E)

def build_bench():
    M = wslots(); root = empty("bench", (0, 0, 0)); P = []
    for k in range(3): P.append(box(f"s{k}", (0.78, 0.08, 0.04), (0, -0.08 + k * 0.085, 0.24), M["plank"], bev=0.01))
    for k in range(2): P.append(box(f"b{k}", (0.78, 0.04, 0.07), (0, 0.15, 0.36 + k * 0.1), M["plank"], bev=0.01, rot=(-0.15, 0, 0)))
    for x in (-0.33, 0.33):
        P.append(box(f"l{x}", (0.05, 0.3, 0.24), (x, 0.02, 0), M["metal"], bev=0.01))
        P.append(box(f"a{x}", (0.05, 0.05, 0.26), (x, 0.14, 0.24), M["metal"]))
    return finish(root, P, [])

def build_sign():
    M = wslots(); root = empty("sign", (0, 0, 0)); P = []
    P.append(box("post", (0.07, 0.07, 0.95), (0, 0, 0), M["wood"], bev=0.012))
    P.append(cyl("cap", 0.06, 0.0, 0.08, (0, 0, 0.95), M["wood"], seg=4, rot=(0, 0, math.pi / 4)))
    P.append(poly_extrude("a1", [(-0.05, -0.07), (0.38, -0.07), (0.46, 0.0), (0.38, 0.07), (-0.05, 0.07)], 0.04, (0, -0.04, 0.72), M["plank"], bev=0.01))
    P.append(poly_extrude("a2", [(0.05, -0.065), (-0.34, -0.065), (-0.42, 0.0), (-0.34, 0.065), (0.05, 0.065)], 0.04, (0, -0.04, 0.5), M["shutter"], bev=0.01))
    P.append(sphere("flw", 0.05, (0.06, -0.08, 0.04), M["fl1"], sub=0)); P.append(sphere("flw2", 0.04, (-0.06, -0.05, 0.04), M["fl2"], sub=0))
    return finish(root, P, [])

def build_fence():
    M = wslots(); root = empty("fence", (0, 0, 0)); P = []
    for x in (-0.42, 0.0, 0.42):
        P.append(box(f"p{x}", (0.07, 0.07, 0.42), (x, 0, 0), M["wood"], bev=0.012))
        P.append(cyl(f"c{x}", 0.05, 0.0, 0.06, (x, 0, 0.42), M["wood"], seg=4, rot=(0, 0, math.pi / 4)))
    for z in (0.14, 0.3): P.append(box(f"r{z}", (0.95, 0.035, 0.05), (0, 0, z), M["plank"], base=False, bev=0.008))
    return finish(root, P, [])

def build_flowers():
    M = wslots(); rnd = random.Random(55); root = empty("flowers", (0, 0, 0)); P = []
    P.append(box("bed", (0.82, 0.82, 0.12), (0, 0, 0), M["wood"], bev=0.02))
    P.append(box("soil", (0.72, 0.72, 0.02), (0, 0, 0.11), material("soil", 0x7a5434)))
    cols = [M["fl1"], M["fl2"], M["purple"], M["fl3"], M["orange"]]
    for k in range(13):
        x, y = rnd.uniform(-0.28, 0.28), rnd.uniform(-0.28, 0.28); h = rnd.uniform(0.12, 0.22)
        P.append(box(f"st{k}", (0.02, 0.02, h), (x, y, 0.12), M["leaf"]))
        P.append(sphere(f"fh{k}", 0.055, (x, y, 0.12 + h), cols[k % 5], sub=0))
        P.append(sphere(f"lf{k}", 0.04, (x + 0.03, y, 0.15), M["leaf"], sub=0, scale=(1.4, 0.8, 0.5)))
    return finish(root, P, [])

def build_hay():
    M = wslots(); root = empty("hay", (0, 0, 0)); P = []
    P.append(cyl("roll", 0.24, 0.24, 0.42, (-0.21, -0.05, 0.24), M["hay"], seg=12, bev=0.04, rot=(0, math.pi / 2, 0)))
    P.append(cyl("rollend", 0.18, 0.18, 0.01, (-0.215, -0.05, 0.24), material("haydark", 0xc9a040), seg=12, rot=(0, math.pi / 2, 0)))
    P.append(box("bale", (0.4, 0.28, 0.24), (0.15, 0.22, 0), M["hay"], bev=0.04))
    for x in (0.05, 0.25): P.append(box(f"tw{x}", (0.02, 0.29, 0.25), (x, 0.22, 0), M["rope"]))
    return finish(root, P, [])

def build_pumpkins():
    M = wslots(); root = empty("pumpkins", (0, 0, 0)); P = []
    for k, (x, y, s) in enumerate([(-0.15, 0.0, 1.0), (0.17, 0.12, 0.75), (0.08, -0.2, 0.62)]):
        for j in range(6):
            a = j / 6 * math.pi * 2
            P.append(uvsphere(f"p{k}{j}", 0.11 * s, (x + math.cos(a) * 0.07 * s, y + math.sin(a) * 0.07 * s, 0.11 * s), M["orange"], seg=8, rings=6, scale=(0.75, 0.75, 0.82), smooth=False))
        P.append(cyl(f"stem{k}", 0.02 * s, 0.015 * s, 0.07 * s, (x, y, 0.2 * s), material("stem", 0x6b5a2a), seg=5, rot=(0.3, 0, 0)))
    P.append(uvsphere("leaf", 0.1, (-0.25, 0.2, 0.02), M["leaf"], seg=8, rings=4, scale=(1.4, 1.0, 0.3), smooth=False))
    return finish(root, P, [])

def build_palisade():
    M = wslots(); root = empty("palisade", (0, 0, 0)); P = []
    for k, x in enumerate((-0.33, 0.0, 0.33)):
        h = 0.78 + (k % 2) * 0.1
        P.append(cyl(f"s{k}", 0.13, 0.14, h, (x, 0, 0), M["log"], seg=7))
        P.append(cyl(f"t{k}", 0.13, 0.0, 0.22, (x, 0, h), material("pointwood", 0xc89060), seg=7))
    for z in (0.25, 0.6): P.append(box(f"b{z}", (0.98, 0.06, 0.07), (0, 0.13, z), M["dark"], bev=0.01))
    return finish(root, P, [])

def build_gnome():
    M = wslots(); root = empty("gnome", (0, 0, 0)); P = []
    P.append(cyl("base", 0.13, 0.14, 0.04, (0, 0, 0), M["stone"], seg=10))
    P.append(cyl("body", 0.08, 0.11, 0.18, (0, 0, 0.04), material("gcoat", 0x3f7fc4), seg=10, bev=0.02, smooth=True))
    P.append(uvsphere("face", 0.075, (0, 0, 0.27), material("gskin", 0xf2c9a0), seg=10, rings=8))
    P.append(uvsphere("beard", 0.075, (0, -0.03, 0.22), M["white"], seg=10, rings=8, scale=(0.95, 0.7, 1.15)))
    P.append(uvsphere("nose", 0.025, (0, -0.075, 0.27), material("gnose", 0xf29a8a), seg=8, rings=5))
    P.append(cyl("hat", 0.085, 0.0, 0.26, (0, 0.01, 0.3), M["red"], seg=10, rot=(0.15, 0, 0), smooth=True))
    P.append(box("spade", (0.03, 0.03, 0.22), (0.11, -0.04, 0.04), M["wood"]))
    P.append(box("blade", (0.06, 0.015, 0.07), (0.11, -0.04, 0.02), M["metal2"]))
    return finish(root, P, [])

def build_swing():
    M = wslots(); root = empty("swing", (0, 0, 0)); P = []
    P.append(cyl("trunk", 0.1, 0.13, 1.0, (-0.32, 0.25, 0), M["log"], seg=7))
    P.append(cyl("branch", 0.05, 0.045, 0.75, (-0.32, 0.25, 0.92), M["log"], seg=6, rot=(0, math.pi / 2, 0)))
    for k, (x, y, z, r) in enumerate([(-0.35, 0.3, 1.25, 0.42), (0.05, 0.15, 1.15, 0.3), (-0.55, 0.05, 1.05, 0.3), (0.25, 0.35, 1.2, 0.3)]):
        P.append(sphere(f"c{k}", r, (x, y, z), M["leaf"] if k % 2 == 0 else material("leaf2", 0x65b744), sub=1))
    piv = empty("anim_swing", (0.18, 0.25, 0.92))
    S = [box("rl", (0.02, 0.02, 0.62), (0.06, 0.25, 0.3), M["rope"]), box("rr", (0.02, 0.02, 0.62), (0.3, 0.25, 0.3), M["rope"]),
         box("seat", (0.34, 0.16, 0.04), (0.18, 0.25, 0.28), M["plank"], bev=0.01)]
    s = join(S, "seat_mesh"); parent(s, piv)
    body = join(P, "body"); parent(body, root); parent(piv, root)
    return root
