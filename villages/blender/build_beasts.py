# Night beasts: cute-menacing. Legs are pivot nodes leg0..leg3 (the game swings
# them); eyes use the "eye" slot, which glows at night.
import math

def quad_legs(root, mat, pts, h, r):
    for k, (x, y) in enumerate(pts):
        piv = empty(f"leg{k}", (x, y, h)); parent(piv, root)
        lg = cyl(f"l{k}", r, r * 0.85, h, (x, y, 0), mat, seg=7, smooth=True)
        parent(lg, piv)

def build_wolf():
    F = material("fur", 0x8a8f99, True); D = material("fur2", 0x5f646e, True); Wh = material("belly", 0xd8dbe0, True)
    E = material("eye", 0xffe25a, True); N = material("nose", 0x222222, True)
    root = empty("wolf", (0, 0, 0))
    body = empty("body", (0, 0, 0)); parent(body, root)
    P = [uvsphere("torso", 0.15, (0, 0.02, 0.26), F, seg=12, rings=8, scale=(0.85, 1.65, 0.9)),
         uvsphere("chest", 0.11, (0, -0.15, 0.26), Wh, seg=10, rings=7, scale=(0.9, 0.8, 1.0)),
         uvsphere("ruff", 0.13, (0, -0.12, 0.33), D, seg=10, rings=7, scale=(1.1, 0.7, 0.8))]
    tail = uvsphere("tail", 0.07, (0, 0.3, 0.33), D, seg=10, rings=6, scale=(0.8, 2.0, 0.8), rot=(0.7, 0, 0))
    P.append(tail)
    head = [uvsphere("head", 0.1, (0, -0.27, 0.4), F, seg=12, rings=8, scale=(1.0, 1.0, 0.9)),
            uvsphere("snout", 0.055, (0, -0.37, 0.37), Wh, seg=10, rings=6, scale=(0.9, 1.5, 0.8)),
            uvsphere("nose", 0.022, (0, -0.445, 0.385), N, seg=6, rings=4)]
    for s in (-1, 1):
        head.append(cyl(f"ear{s}", 0.045, 0.0, 0.1, (s * 0.06, -0.25, 0.46), D, seg=4, rot=(0.15, s * -0.25, 0)))
        head.append(uvsphere(f"eye{s}", 0.02, (s * 0.04, -0.35, 0.43), E, seg=6, rings=4))
    b = join(P + head, "body_mesh"); parent(b, body)
    quad_legs(body, D, [(-0.07, -0.13), (0.07, -0.13), (-0.07, 0.17), (0.07, 0.17)], 0.18, 0.035)
    return root

def build_boar():
    F = material("fur", 0x5e4433, True); D = material("fur2", 0x3e2a1e, True); Sn = material("snout", 0xc98a7a, True)
    T = material("tusk", 0xf3ecd8, True); E = material("eye", 0xffe25a, True)
    root = empty("boar", (0, 0, 0))
    body = empty("body", (0, 0, 0)); parent(body, root)
    P = [uvsphere("torso", 0.19, (0, 0.03, 0.25), F, seg=12, rings=8, scale=(0.85, 1.35, 0.85)),
         uvsphere("hump", 0.14, (0, -0.06, 0.34), F, seg=10, rings=6, scale=(0.9, 1.2, 0.8))]
    for k in range(6):
        P.append(cyl(f"br{k}", 0.035, 0.0, 0.08, (0, -0.15 + k * 0.07, 0.4 - abs(k - 2) * 0.012), D, seg=4))
    head = [uvsphere("head", 0.12, (0, -0.26, 0.25), F, seg=10, rings=7, scale=(0.95, 1.1, 0.9)),
            cyl("snout", 0.06, 0.065, 0.08, (0, -0.37, 0.22), Sn, seg=10, rot=(math.pi / 2, 0, 0), smooth=True)]
    for s in (-1, 1):
        head.append(cyl(f"tusk{s}", 0.017, 0.0, 0.08, (s * 0.05, -0.38, 0.2), T, seg=5, rot=(-0.6, s * -0.4, 0)))
        head.append(cyl(f"ear{s}", 0.04, 0.0, 0.08, (s * 0.07, -0.22, 0.33), D, seg=4, rot=(-0.3, s * -0.5, 0)))
        head.append(uvsphere(f"eye{s}", 0.018, (s * 0.06, -0.34, 0.29), E, seg=6, rings=4))
    P.append(cyl("tail", 0.012, 0.008, 0.08, (0, 0.27, 0.3), D, seg=4, rot=(0.6, 0, 0)))
    b = join(P + head, "body_mesh"); parent(b, body)
    quad_legs(body, D, [(-0.09, -0.12), (0.09, -0.12), (-0.09, 0.16), (0.09, 0.16)], 0.15, 0.04)
    return root

def build_goblin():
    G = material("skin", 0x6fae4a, True); C = material("tunic", 0x6b4a2a, True); S = material("sack", 0x8a6a3a, True)
    E = material("eye", 0xffe25a, True); Cl = material("club", 0x5e3b22, True); T = material("tooth", 0xf3ecd8, True)
    root = empty("goblin", (0, 0, 0))
    body = empty("body", (0, 0, 0)); parent(body, root)
    P = [cyl("tunic", 0.12, 0.14, 0.2, (0, 0, 0.12), C, seg=10, bev=0.03, segs=2, smooth=True),
         uvsphere("head", 0.15, (0, -0.01, 0.43), G, seg=12, rings=8, scale=(1.1, 1.0, 0.92)),
         uvsphere("nose", 0.045, (0, -0.175, 0.405), G, seg=8, rings=6, scale=(0.9, 1.3, 1.0)),
         uvsphere("sack", 0.1, (0, 0.13, 0.25), S, seg=10, rings=7, scale=(1.0, 0.8, 1.1)),
         uvsphere("grin", 0.05, (0, -0.15, 0.355), material("mouth", 0x2a1a10, True), seg=8, rings=4, scale=(1.4, 0.4, 0.4))]
    for s in (-1, 1):
        P.append(cyl(f"ear{s}", 0.045, 0.0, 0.17, (s * 0.15, 0.0, 0.45), G, seg=5, rot=(0, s * 1.25, 0)))
        P.append(uvsphere(f"eye{s}", 0.036, (s * 0.065, -0.145, 0.47), E, seg=8, rings=5, scale=(1, 0.6, 1.1)))
        P.append(cyl(f"fang{s}", 0.012, 0.0, 0.035, (s * 0.03, -0.165, 0.355), T, seg=4, rot=(math.pi, 0, 0)))
        P.append(uvsphere(f"hand{s}", 0.035, (s * 0.15, -0.03, 0.17), G, seg=8, rings=5))
    P.append(cyl("club", 0.025, 0.055, 0.3, (0.15, -0.04, 0.15), Cl, seg=7, rot=(-0.35, 0.15, 0), smooth=True))
    b = join(P, "body_mesh"); parent(b, body)
    for k, x in enumerate((-0.05, 0.05)):
        piv = empty(f"leg{k}", (x, 0, 0.12)); parent(piv, body)
        lg = cyl(f"gl{k}", 0.035, 0.03, 0.12, (x, 0, 0.0), G, seg=7, smooth=True); parent(lg, piv)
        ft = uvsphere(f"gf{k}", 0.04, (x, -0.02, 0.02), G, seg=8, rings=5, scale=(0.9, 1.4, 0.6)); parent(ft, piv)
    return root
