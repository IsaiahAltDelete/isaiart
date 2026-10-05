# Festival-shop decorations (1x1 tiles, keep inside +-0.45).
import math, random

def build_maypole():
    M = wslots(); root = empty("maypole", (0, 0, 0)); P = []
    P.append(cyl("base", 0.2, 0.24, 0.08, (0, 0, 0), M["stone"], seg=10, bev=0.02))
    P.append(cyl("pole", 0.04, 0.05, 1.7, (0, 0, 0.08), M["white"], seg=8))
    P.append(cyl("crown", 0.16, 0.12, 0.08, (0, 0, 1.7), M["leaf"], seg=10, bev=0.02))
    for k in range(5): P.append(sphere(f"cf{k}", 0.04, (math.cos(k * 1.26) * 0.15, math.sin(k * 1.26) * 0.15, 1.78), [M["fl1"], M["fl2"], M["fl3"], M["purple"], M["orange"]][k], sub=0))
    cols = [M["red"], M["shutter"], M["gold"], M["purple"], M["fl1"], M["water"]]
    for k in range(6):
        a = k / 6 * math.pi * 2
        x, y = math.cos(a) * 0.42, math.sin(a) * 0.42
        P.append(beam(f"rib{k}", (math.cos(a) * 0.12, math.sin(a) * 0.12, 1.7), (x, y, 0.15), 0.035, 0.01, cols[k]))
        P.append(sphere(f"peg{k}", 0.03, (x, y, 0.15), cols[k], sub=0))
    return finish(root, P, [])

def build_flowerarch():
    M = wslots(); root = empty("flowerarch", (0, 0, 0)); P = []
    for k in range(13):
        a = k / 12 * math.pi
        x, z = math.cos(a) * 0.4, 0.55 + math.sin(a) * 0.4
        P.append(box(f"seg{k}", (0.07, 0.07, 0.12), (x, 0, z), M["wood"], base=False, rot=(0, -a + math.pi / 2, 0)))
        if k % 2 == 0:
            P.append(sphere(f"lf{k}", 0.08, (x, 0, z), M["leaf"], sub=0))
            P.append(sphere(f"fl{k}", 0.05, (x, -0.06, z + 0.03), [M["fl1"], M["fl3"], M["purple"], M["fl2"]][k // 2 % 4], sub=0))
    for x in (-0.4, 0.4):
        P.append(box(f"leg{x}", (0.07, 0.07, 0.56), (x, 0, 0), M["wood"]))
        P.append(sphere(f"vine{x}", 0.07, (x, -0.02, 0.3), M["leaf"], sub=0, scale=(0.8, 0.8, 1.8)))
    return finish(root, P, [])

def build_sunflowers():
    M = wslots(); root = empty("sunflowers", (0, 0, 0)); P = []
    for k, (x, y, h) in enumerate([(-0.18, 0.05, 0.8), (0.0, -0.12, 0.95), (0.2, 0.08, 0.72)]):
        P.append(cyl(f"st{k}", 0.02, 0.02, h, (x, y, 0), M["leaf"], seg=5))
        P.append(sphere(f"lf{k}", 0.07, (x + 0.06, y, h * 0.45), M["leaf"], sub=0, scale=(1.5, 0.6, 0.4)))
        P.append(cyl(f"pet{k}", 0.16, 0.16, 0.02, (x, y - 0.02, h), M["gold"], seg=12, rot=(1.2, 0, 0)))
        P.append(cyl(f"mid{k}", 0.08, 0.08, 0.03, (x, y - 0.03, h), M["dark"], seg=10, rot=(1.2, 0, 0)))
    return finish(root, P, [])

def build_windchime():
    M = wslots(); root = empty("windchime", (0, 0, 0)); P = []
    P.append(box("post", (0.06, 0.06, 1.0), (0, 0.1, 0), M["wood"]))
    P.append(box("arm", (0.04, 0.32, 0.04), (0, -0.04, 0.96), M["wood"]))
    P.append(cyl("disc", 0.12, 0.12, 0.025, (0, -0.18, 0.86), M["wood"], seg=10))
    for k in range(5):
        a = k / 5 * math.pi * 2
        P.append(cyl(f"tube{k}", 0.014, 0.014, 0.18 + k * 0.03, (math.cos(a) * 0.08, -0.18 + math.sin(a) * 0.08, 0.62 - k * 0.03), M["metal2"], seg=6))
    return finish(root, P, [])

def build_pumpkinlantern():
    M = wslots(); root = empty("pumpkinlantern", (0, 0, 0)); P, E = [], []
    for j in range(7):
        a = j / 7 * math.pi * 2
        P.append(uvsphere(f"p{j}", 0.14, (math.cos(a) * 0.09, math.sin(a) * 0.09, 0.15), M["orange"], seg=8, rings=6, scale=(0.75, 0.75, 0.85), smooth=False))
    for s in (-1, 1): P.append(poly_extrude(f"eye{s}", [(-0.035, 0), (0.035, 0), (0, 0.05)], 0.03, (s * 0.07, -0.19, 0.19), M["glow"]))
    P.append(poly_extrude("mouth", [(-0.08, 0.02), (0.08, 0.02), (0.05, -0.02), (0.02, 0.0), (-0.02, -0.02), (-0.05, 0.0)], 0.03, (0, -0.185, 0.12), M["glow"]))
    P.append(cyl("stem", 0.025, 0.02, 0.07, (0, 0, 0.27), material("stem", 0x6b5a2a), seg=5, rot=(0.3, 0, 0)))
    E.append(empty("pt_glow_lamp", (0, -0.2, 0.17)))
    return finish(root, P, E)

def build_scarecrow():
    M = wslots(); root = empty("scarecrow", (0, 0, 0)); P = []
    P.append(box("pole", (0.05, 0.05, 1.05), (0, 0, 0), M["wood"]))
    P.append(box("arms", (0.62, 0.04, 0.04), (0, 0, 0.72), M["wood"]))
    P.append(box("shirt", (0.26, 0.14, 0.32), (0, 0, 0.5), M["red"], bev=0.03))
    for s in (-1, 1): P.append(box(f"sl{s}", (0.18, 0.12, 0.1), (s * 0.2, 0, 0.67), M["red"], bev=0.02))
    P.append(uvsphere("head", 0.12, (0, 0, 0.95), M["sack"], seg=10, rings=8))
    P.append(cyl("brim", 0.2, 0.2, 0.02, (0, 0, 1.03), M["hay"], seg=12))
    P.append(cyl("crown", 0.1, 0.08, 0.1, (0, 0, 1.04), M["hay"], seg=10))
    for s in (-1, 1): P.append(cyl(f"straw{s}", 0.03, 0.0, 0.1, (s * 0.31, 0, 0.72), M["hay"], seg=5, rot=(0, s * 1.57, 0)))
    P.append(sphere("crow", 0.05, (0.26, 0, 0.78), M["dark"], sub=1, scale=(1, 1.4, 0.9)))
    return finish(root, P, [])

def build_snowlantern():
    """A Japanese-style stone lantern capped with snow."""
    M = wslots(); root = empty("snowlantern", (0, 0, 0)); P, E = [], []
    P.append(cyl("foot", 0.18, 0.2, 0.08, (0, 0, 0), M["stone"], seg=8))
    P.append(cyl("post", 0.07, 0.08, 0.4, (0, 0, 0.08), M["stone"], seg=8))
    P.append(box("box", (0.24, 0.24, 0.2), (0, 0, 0.48), M["stone"], bev=0.02))
    P.append(box("light", (0.15, 0.26, 0.12), (0, 0, 0.52), M["glow"]))
    P.append(cyl("roof", 0.3, 0.05, 0.16, (0, 0, 0.68), M["stone2"], seg=6, bev=0.02))
    P.append(uvsphere("snowcap", 0.19, (0, 0, 0.8), material("snow", 0xf4f7fb), seg=10, rings=6, cut=0.0, scale=(1, 1, 0.35), smooth=False))
    E.append(empty("pt_glow_lamp", (0, -0.1, 0.58)))
    return finish(root, P, E)

def build_wintertree():
    """A little decorated fir with baubles and a star."""
    M = wslots(); root = empty("wintertree", (0, 0, 0)); P = []
    P.append(cyl("tub", 0.16, 0.13, 0.16, (0, 0, 0), M["red"], seg=8, bev=0.02))
    for k, (r, h, z) in enumerate([(0.36, 0.38, 0.2), (0.28, 0.34, 0.45), (0.19, 0.3, 0.68)]):
        P.append(star_cone(f"t{k}", r, h, z, M["leaf"], dent=0.72, rot=k * 0.4, droop=0.04))
    cols = [M["red"], M["gold"], M["shutter"], M["purple"]]
    for k in range(9):
        a = k * 2.4; z = 0.28 + (k % 3) * 0.2
        r = 0.3 - (k % 3) * 0.08
        P.append(sphere(f"b{k}", 0.035, (math.cos(a) * r, math.sin(a) * r, z), cols[k % 4], sub=1))
    P.append(sphere("star", 0.06, (0, 0, 1.0), M["gold"], sub=0))
    return finish(root, P, [])
