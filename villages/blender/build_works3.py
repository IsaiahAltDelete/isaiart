# Guild Hall, Forge, Trade Post and the Wishing Fountain.
import math, random

def shield_sign(name, M, loc, s=0.32, col="red"):
    x, y, z = loc
    pts = [(-s / 2, s * 0.5), (s / 2, s * 0.5), (s / 2, 0.0), (0, -s * 0.55), (-s / 2, 0.0)]
    parts = [poly_extrude(f"{name}_sh", pts, 0.05, (x, y, z), M[col], bev=0.012)]
    for a in (0.7, -0.7):
        parts.append(box(f"{name}_sw{a}", (0.025, 0.02, s * 1.05), (x, y - 0.04, z - s * 0.05), M["metal2"], base=False, rot=(0, a, 0)))
    parts.append(poly_extrude(f"{name}_rim", [(p[0] * 1.12, p[1] * 1.1 + 0.005) for p in pts], 0.03, (x, y + 0.02, z), M["gold"]))
    return parts

# ── Guild Hall (3x2): a proud stone-and-timber hall with banners and a quest board ──
def build_guild():
    M = wslots(); rnd = random.Random(41)
    root = empty("guild", (0, 0, 0)); P, E = [pad("pad", M, 2.85, 1.9)], []
    W, D = 1.9, 1.3; cy = 0.25
    P.append(plinth("plinth", M, W, D, rnd=rnd)); P[-1].location = (0, cy, 0)
    P.append(walls("ground", M, W, D, 0.9, loc=(0, cy, 0), mat=M["stone"]))
    P += block("hall", M, W, D, 0.75, 1.0, front_gable=True, over=0.15, sag=0.04, z0=0.9, y=cy, rnd=rnd)
    P.append(timber_frame("frame", M, W, D, 0.75, 0.9, braces=True)); P[-1].location = (0, cy, 0)
    P.append(box("band", (W + 0.08, D + 0.08, 0.08), (0, cy, 0.86), M["trim"], bev=0.02))
    # big double door under an arch
    P.append(poly_extrude("arch", arch_pts(0.62, 0.78, 8), 0.08, (0, cy - D / 2 - 0.02, 0), M["cut"], bev=0.015))
    P.append(poly_extrude("dleaf", arch_pts(0.5, 0.7, 8), 0.09, (0, cy - D / 2 - 0.035, 0), M["door"]))
    P.append(box("dsplit", (0.02, 0.1, 0.62), (0, cy - D / 2 - 0.05, 0), M["dark"]))
    for x in (-0.06, 0.06): P.append(sphere(f"ring{x}", 0.025, (x, cy - D / 2 - 0.1, 0.38), M["gold"], sub=1))
    P.append(box("steps", (0.8, 0.3, 0.06), (0, cy - D / 2 - 0.15, -0.02), M["stone"], bev=0.02))
    for x in (-0.62, 0.62): E += window(f"g{x}", M, (x, cy - D / 2 - 0.01, 0.5), w=0.26, h=0.32, shutters=False)
    for x in (-0.45, 0.45): E += window(f"u{x}", M, (x, cy - D / 2 - 0.01, 1.28), w=0.24, h=0.3, box_flowers=True)
    # round gable window and the guild crest
    P.append(cyl("rose", 0.17, 0.17, 0.05, (0, cy - D / 2 + 0.0, 1.95), M["trim"], seg=14, rot=(math.pi / 2, 0, 0)))
    P.append(cyl("roseg", 0.12, 0.12, 0.06, (0, cy - D / 2 + 0.005, 1.95), M["win"], seg=14, rot=(math.pi / 2, 0, 0)))
    E.append(empty("pt_glow_win", (0, cy - D / 2 - 0.04, 1.95)))
    P += shield_sign("crest", M, (0, cy - D / 2 - 0.05, 1.0), 0.3)
    # hero: two tall banner poles with hanging banners
    for k, x in enumerate((-1.2, 1.2)):
        P.append(cyl(f"bp{x}", 0.035, 0.04, 1.7, (x, -0.55, 0), M["dark"], seg=8))
        P.append(sphere(f"bk{x}", 0.06, (x, -0.55, 1.72), M["gold"], sub=1))
        P.append(box(f"bar{x}", (0.42, 0.04, 0.04), (x, -0.55, 1.6), M["dark"]))
        P.append(poly_extrude(f"ban{x}", [(-0.18, 0), (0.18, 0), (0.18, -0.62), (0, -0.5), (-0.18, -0.62)], 0.02, (x, -0.56, 1.58), M["red"] if k == 0 else M["shutter"]))
        P.append(sphere(f"bem{x}", 0.07, (x, -0.58, 1.3), M["gold"], sub=0))
    # quest board with pinned notes
    P.append(box("board", (0.55, 0.05, 0.4), (0.62, -0.75, 0.42), M["wood"], bev=0.015))
    for x in (0.42, 0.82): P.append(box(f"bl{x}", (0.05, 0.05, 0.85), (x, -0.73, 0), M["dark"]))
    P.append(box("broof", (0.68, 0.18, 0.04), (0.62, -0.75, 0.86), M["roof"], rot=(0.25, 0, 0)))
    for k, (x, z) in enumerate([(0.5, 0.62), (0.64, 0.66), (0.76, 0.6), (0.56, 0.48), (0.72, 0.47)]):
        P.append(box(f"note{k}", (0.1, 0.012, 0.12), (x, -0.785, z), M["cloth"], rot=(0, rnd.uniform(-0.2, 0.2), 0)))
    # weapon rack
    P.append(box("rack", (0.5, 0.06, 0.05), (-0.6, -0.75, 0.5), M["wood"]))
    for k in range(3):
        P.append(box(f"spear{k}", (0.025, 0.025, 0.8), (-0.78 + k * 0.17, -0.72, 0), M["wood"], rot=(0.08, 0, 0)))
        P.append(cyl(f"tip{k}", 0.03, 0.0, 0.1, (-0.78 + k * 0.17, -0.66, 0.79), M["metal2"], seg=4))
    E += chimney("chim", M, (-0.55, cy + 0.35, 1.9), h=0.5, lean=0.03, rnd=rnd)
    return finish(root, P, E)

# ── Forge: an open smithy, a glowing hearth, the anvil out front ──
def build_forge():
    M = wslots(); rnd = random.Random(42)
    root = empty("forge", (0, 0, 0)); P, E = [pad("pad", M, 1.9, 1.9)], []
    # stone back room with the chimney, open timber lean-to in front
    P.append(walls("back", M, 1.6, 0.6, 0.95, loc=(0, 0.6, 0), mat=M["stone"]))
    P.append(gable_roof("roof", 1.6, 0.6, 0.35, M, over=0.12, rows=3, loc=(0, 0.6, 0.95), mat=M["roof"], rnd=rnd))
    g = gable_fill("gable", M, 1.6, 0.6, 0.35, 0.95, mat=M["stone"]); g.location = (0, 0.6, 0.95); P.append(g)
    for x in (-0.75, 0.75): P.append(box(f"post{x}", (0.09, 0.09, 0.85), (x, -0.25, 0), M["log"], bev=0.015))
    P.append(lean_roof("shed", 1.6, 0.6, 0.18, M, over=0.1, rows=2, loc=(0, 0.0, 0.85), rnd=rnd))
    # hero 1: the hearth, glowing coals under a brick hood
    P.append(box("hearth", (0.6, 0.45, 0.4), (-0.35, 0.18, 0), M["brick"], bev=0.03))
    P.append(box("coals", (0.42, 0.3, 0.05), (-0.35, 0.16, 0.4), M["glow"]))
    E.append(empty("pt_glow_lamp", (-0.35, 0.1, 0.55)))
    P.append(cyl("hood", 0.35, 0.12, 0.4, (-0.35, 0.2, 0.62), M["brick"], seg=4, rot=(0, 0, math.pi / 4)))
    P.append(box("stack", (0.24, 0.24, 1.0), (-0.35, 0.35, 0.95), M["stone2"], bev=0.02))
    E.append(empty("pt_smoke", (-0.35, 0.35, 2.05)))
    # bellows
    P.append(box("bellows", (0.22, 0.32, 0.1), (-0.78, 0.1, 0.3), M["dark"], bev=0.03, rot=(0, 0.3, 0)))
    # hero 2: a big anvil on a stump, hammer resting on it
    P.append(cyl("stump", 0.17, 0.2, 0.3, (0.3, -0.55, 0), M["log"], seg=10, bev=0.02))
    anv = [box("a_base", (0.22, 0.16, 0.08), (0.3, -0.55, 0.3), M["metal"], bev=0.01),
           box("a_waist", (0.14, 0.11, 0.08), (0.3, -0.55, 0.38), M["metal"]),
           box("a_face", (0.36, 0.17, 0.08), (0.3, -0.55, 0.46), M["metal"], bev=0.015),
           cyl("a_horn", 0.075, 0.0, 0.2, (0.48, -0.55, 0.5), M["metal"], seg=8, rot=(0, math.pi / 2, 0))]
    P += anv
    P.append(box("hamh", (0.03, 0.03, 0.26), (0.24, -0.55, 0.56), M["wood"], rot=(0, math.radians(80), 0.3)))
    P.append(box("hamhead", (0.07, 0.06, 0.06), (0.15, -0.53, 0.56), M["metal2"], bev=0.01))
    # quench barrel and a rack of finished blades
    P += barrel("q", M, (0.75, -0.35, 0)); P.append(cyl("qwater", 0.11, 0.11, 0.01, (0.75, -0.35, 0.31), M["water"], seg=10))
    P.append(box("wrack", (0.06, 0.5, 0.05), (0.75, 0.25, 0.55), M["wood"]))
    for k in range(3):
        y = 0.08 + k * 0.15
        P.append(box(f"blade{k}", (0.02, 0.04, 0.5), (0.72, y, 0.05), M["metal2"], rot=(0, -0.12, 0)))
        P.append(box(f"hilt{k}", (0.02, 0.12, 0.025), (0.7, y, 0.48), M["gold"]))
    P.append(box("ingots", (0.26, 0.14, 0.06), (0.0, -0.75, 0), M["metal"], bev=0.01))
    P.append(box("ingots2", (0.2, 0.12, 0.05), (0.02, -0.75, 0.06), M["metal2"], bev=0.01))
    return finish(root, P, E)

# ── Trade Post: a depot where carts load, with scales on the sign ──
def build_tradepost():
    M = wslots(); rnd = random.Random(43)
    root = empty("tradepost", (0, 0, 0)); P, E = [pad("pad", M, 1.9, 1.9)], []
    P += block("hut", M, 1.1, 0.8, 0.8, 0.5, over=0.12, rows=3, x=-0.3, y=0.45, rnd=rnd)
    P.append(door("door", M, (-0.3, 0.05, 0.0), w=0.3, h=0.52))
    E += window("w1", M, (0.05, 0.04, 0.5), w=0.2, h=0.22, shutters=False)
    # loading platform with crates and sacks
    P.append(box("dock", (0.75, 0.9, 0.18), (0.55, 0.15, 0), M["plank"], bev=0.02))
    P += crate("c1", M, (0.45, 0.35, 0.18), s=0.28); P += crate("c2", M, (0.72, 0.3, 0.18), s=0.26, rot=0.3); P += crate("c3", M, (0.5, 0.36, 0.46), s=0.22, rot=-0.2)
    P += sack("s1", M, (0.7, -0.05, 0.18), 0.12)
    # hero: a sign with brass scales
    P.append(box("sp", (0.06, 0.06, 1.2), (-0.8, -0.6, 0), M["wood"]))
    P.append(box("sarm", (0.5, 0.05, 0.05), (-0.6, -0.6, 1.15), M["wood"]))
    P.append(box("sbeam", (0.36, 0.03, 0.03), (-0.45, -0.6, 0.98), M["gold"]))
    P.append(box("sstem", (0.02, 0.02, 0.16), (-0.45, -0.6, 0.98), M["gold"]))
    for x in (-0.6, -0.3):
        P.append(box(f"str{x}", (0.01, 0.01, 0.14), (x, -0.6, 0.85), M["gold"]))
        P.append(cyl(f"pan{x}", 0.07, 0.04, 0.03, (x, -0.6, 0.83), M["gold"], seg=10))
    # a little handcart
    P.append(box("cart", (0.5, 0.32, 0.16), (0.2, -0.6, 0.14), M["wood"], bev=0.02))
    for x in (0.05, 0.35): P.append(cyl(f"wh{x}", 0.12, 0.12, 0.04, (x, -0.42, 0.12), M["dark"], seg=10, rot=(math.pi / 2, 0, 0)))
    P.append(box("handle", (0.4, 0.03, 0.03), (-0.2, -0.6, 0.3), M["wood"], rot=(0, 0.2, 0)))
    P.append(sphere("cg1", 0.07, (0.15, -0.6, 0.35), M["apple"], sub=1)); P.append(sphere("cg2", 0.07, (0.28, -0.58, 0.35), M["cabbage"], sub=1))
    return finish(root, P, E)

# ── Wishing Fountain (2x2): a tiered basin; the game adds the water jets ──
def build_fountain():
    M = wslots(); rnd = random.Random(44)
    root = empty("fountain", (0, 0, 0)); P, E = [], []
    P.append(cyl("step", 0.95, 0.98, 0.08, (0, 0, 0), M["stone2"], seg=16, bev=0.02))
    P.append(cyl("basin", 0.86, 0.9, 0.16, (0, 0, 0.06), M["stone"], seg=16, bev=0.03))
    P.append(cyl("water", 0.8, 0.8, 0.02, (0, 0, 0.22), M["water"], seg=16))
    # an open rim of dressed stones so the water shows
    for k in range(18):
        a = k / 18 * math.pi * 2
        P.append(box(f"rim{k}", (0.13, 0.32, 0.16), (math.cos(a) * 0.86, math.sin(a) * 0.86, 0.18), M["cut"], bev=0.025, rot=(0, 0, a)))
    P.append(cyl("column", 0.11, 0.16, 0.66, (0, 0, 0.3), M["cut"], seg=10, bev=0.02))
    P.append(cyl("bowl", 0.38, 0.16, 0.14, (0, 0, 0.92), M["stone"], seg=14, bev=0.03))
    P.append(cyl("bwater", 0.32, 0.32, 0.02, (0, 0, 1.04), M["water"], seg=14))
    P.append(cyl("spout", 0.06, 0.08, 0.12, (0, 0, 1.04), M["cut"], seg=8))
    P.append(sphere("knob", 0.07, (0, 0, 1.18), M["gold"], sub=1))
    # coins glinting in the basin and flower tubs at the corners
    for k in range(7):
        a = k * 0.9
        P.append(cyl(f"coin{k}", 0.035, 0.035, 0.012, (math.cos(a) * (0.35 + (k % 3) * 0.12), math.sin(a) * (0.35 + (k % 3) * 0.12), 0.235), M["gold"], seg=8))
    for k, (x, y) in enumerate([(-0.85, -0.85), (0.85, 0.85)]):
        P.append(cyl(f"tub{k}", 0.16, 0.13, 0.18, (x, y, 0), M["brick"], seg=8, bev=0.015))
        for j in range(4): P.append(sphere(f"fl{k}{j}", 0.06, (x - 0.06 + (j % 2) * 0.12, y - 0.06 + (j // 2) * 0.12, 0.22), [M["fl1"], M["fl2"], M["fl3"], M["purple"]][j], sub=0))
    return finish(root, P, E)

# ── the travelling merchant's wagon: wheels are nodes wheel0..3 (they spin) ──
def build_cart():
    M = wslots(); rnd = random.Random(61)
    root = empty("cart", (0, 0, 0)); P = []
    P.append(box("bed", (0.86, 1.3, 0.22), (0, 0, 0.36), M["plank"], bev=0.025))
    for x in (-0.44, 0.44): P.append(box(f"rail{x}", (0.05, 1.3, 0.16), (x, 0, 0.58), M["wood"], bev=0.012))
    P.append(box("board", (0.86, 0.05, 0.16), (0, 0.63, 0.58), M["wood"], bev=0.012))
    # an arched canvas cover in purple and cream stripes, on hoops
    cov = [material("canvas", 0x8a5aa8), material("canvas2", 0xf3ead6)]
    for k in range(6):
        y0 = -0.55 + k * 0.22
        for j in range(8):
            a0 = j / 8 * math.pi; a1 = (j + 1) / 8 * math.pi
            r = 0.47
            bm = bmesh.new()
            vs = [bm.verts.new((math.cos(a) * r, y, 0.72 + math.sin(a) * r * 0.85)) for a, y in ((a0, y0), (a1, y0), (a1, y0 + 0.22), (a0, y0 + 0.22))]
            bm.faces.new(vs[::-1])                     # outward-facing canvas panel
            P.append(_obj(f"cov{k}{j}", bm, cov[k % 2]))
    for y in (-0.56, 0.0, 0.56):
        for j in range(8):
            a0 = j / 8 * math.pi; a1 = (j + 1) / 8 * math.pi; r = 0.49
            P.append(beam(f"hoop{y}{j}", (math.cos(a0) * r, y, 0.72 + math.sin(a0) * r * 0.85), (math.cos(a1) * r, y, 0.72 + math.sin(a1) * r * 0.85), 0.035, 0.035, M["wood"]))
    # goods peeking out at the back, a lantern on a hook, a hanging sign
    P += crate("cr1", M, (-0.18, 0.55, 0.47), s=0.22); P += crate("cr2", M, (0.16, 0.5, 0.47), s=0.2, rot=0.3)
    for k, g in enumerate(("apple", "orange", "cabbage")): P.append(sphere(f"gd{k}", 0.06, (-0.18 + k * 0.06, 0.55, 0.72), M[g], sub=1))
    P.append(box("lhook", (0.03, 0.03, 0.2), (0.4, -0.6, 0.9), M["metal"]))
    P.append(box("lamp", (0.1, 0.1, 0.13), (0.4, -0.66, 0.78), M["glow"], bev=0.02))
    P.append(box("sign", (0.4, 0.03, 0.16), (0, -0.67, 0.55), M["wood"], bev=0.01))
    P.append(sphere("signgem", 0.05, (0, -0.69, 0.56), M["purple"], sub=0))
    for x in (-0.24, 0.24): P.append(box(f"shaft{x}", (0.04, 0.85, 0.04), (x, -1.05, 0.38), M["wood"], rot=(0.12, 0, 0)))
    body = join(P, "body"); parent(body, root)
    for k, (x, y) in enumerate([(-0.48, -0.38), (0.48, -0.38), (-0.48, 0.38), (0.48, 0.38)]):
        w = empty(f"wheel{k}", (x, y, 0.22)); parent(w, root)
        parts = [cyl(f"tyre{k}", 0.22, 0.22, 0.05, (x - 0.025, y, 0.22), M["dark"], seg=14, rot=(0, math.pi / 2, 0)),
                 cyl(f"hub{k}", 0.05, 0.05, 0.08, (x - 0.04, y, 0.22), M["metal"], seg=8, rot=(0, math.pi / 2, 0))]
        for j in range(6):
            a = j / 6 * math.pi
            parts.append(beam(f"sp{k}{j}", (x, y + math.cos(a) * 0.19, 0.22 + math.sin(a) * 0.19), (x, y - math.cos(a) * 0.19, 0.22 - math.sin(a) * 0.19), 0.022, 0.03, M["wood"]))
        wm = join(parts, f"wheel_mesh{k}"); parent(wm, w)
    E = empty("pt_glow_lamp", (0.4, -0.68, 0.84)); parent(E, root)
    return root
