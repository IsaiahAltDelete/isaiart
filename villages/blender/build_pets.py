# Pets: a cat and a dog that follow villagers around. Face -Y like the beasts.
# Pivot nodes the game animates (plain names, like the beasts):
#   body          whole animal at the origin (bob / tilt)
#   head          neck pivot (nod, look around)
#   tail          tail base (wag = rotate about three.js Y)
#   leg0..leg3    shoulders / hips (swing about X): 0 front-left(-X), 1 front-right,
#                 2 back-left, 3 back-right - the same order as the wolf.
# Slots: fur, fur2 (belly / muzzle / paws), nose, eye (+ a tiny white "shine").
import math

def _pet_leg(k, body, x, y, hip, r, F, F2):
    piv = empty(f"leg{k}", (x, y, hip)); parent(piv, body)
    L = [cyl(f"lg{k}", r, r * 0.92, hip - 0.012, (x, y, 0.012), F, seg=8, smooth=True),
         uvsphere(f"paw{k}", r * 1.18, (x, y - 0.012, 0.02), F2, seg=10, rings=6, scale=(1.0, 1.25, 0.66))]
    lg = join(L, f"leg{k}_mesh"); parent(lg, piv)
    return piv

def _ear(name, base, r, h, mat, tilt, flat=0.5, seg=4):
    o = cyl(name, r, 0.0, h, base, mat, seg=seg, rot=tilt)
    o.scale = (1.0, flat, 1.0)   # join() bakes the scale
    return o

def _eyes(H, cx, y, z, r, E, S):
    for s in (-1, 1):
        H.append(uvsphere(f"eye{s}", r, (s * cx, y, z), E, seg=10, rings=7, scale=(0.9, 0.6, 1.1)))
        H.append(uvsphere(f"shine{s}", r * 0.28, (s * cx + r * 0.3, y - r * 0.4, z + r * 0.42), S, seg=6, rings=4))

def build_cat():
    F = material("fur", 0xe8954a, True); F2 = material("fur2", 0xf6e6c8, True); N = material("nose", 0xf08a9a, True)
    E = material("eye", 0x2a2230, True); S = material("shine", 0xffffff, True)
    root = empty("cat", (0, 0, 0))
    body = empty("body", (0, 0, 0)); parent(body, root)
    P = [uvsphere("torso", 0.1, (0, 0.02, 0.158), F, seg=14, rings=9, scale=(1.0, 1.3, 0.9)),
         uvsphere("bib", 0.068, (0, -0.07, 0.15), F2, seg=12, rings=8, scale=(0.95, 0.72, 1.1))]
    for s in (-1, 1):
        P.append(uvsphere(f"haunch{s}", 0.058, (s * 0.068, 0.085, 0.13), F, seg=10, rings=7, scale=(0.8, 1.1, 1.0)))
    b = join(P, "body_mesh"); parent(b, body)
    # head: big and round, cream cheeks, triangle ears with pink insides
    head = empty("head", (0, -0.09, 0.22)); parent(head, body)
    H = [uvsphere("skull", 0.1, (0, -0.14, 0.29), F, seg=14, rings=10, scale=(1.14, 0.92, 0.9)),
         uvsphere("chin", 0.024, (0, -0.207, 0.232), F2, seg=8, rings=6),
         uvsphere("nose", 0.013, (0, -0.236, 0.272), N, seg=8, rings=6, scale=(1.35, 0.8, 0.8))]
    for s in (-1, 1):
        H.append(uvsphere(f"cheek{s}", 0.036, (s * 0.031, -0.21, 0.254), F2, seg=10, rings=7, scale=(1.0, 0.8, 0.8)))
        H.append(_ear(f"ear{s}", (s * 0.062, -0.145, 0.34), 0.056, 0.105, F, (0.0, s * 0.27, 0), flat=0.55))
        H.append(_ear(f"inner{s}", (s * 0.06, -0.16, 0.348), 0.036, 0.074, N, (0.0, s * 0.27, 0), flat=0.4))
        for k in range(2):   # whisker dots
            H.append(uvsphere(f"wd{s}{k}", 0.0045, (s * (0.04 + k * 0.012), -0.236 + k * 0.005, 0.258 - k * 0.006), E, seg=5, rings=3))
    _eyes(H, 0.047, -0.217, 0.303, 0.022, E, S)
    h = join(H, "head_mesh"); parent(h, head)
    # tail: curls up behind like a question mark, cream tip
    tail = empty("tail", (0, 0.135, 0.17)); parent(tail, body)
    pts = [(0, 0.125, 0.165), (0, 0.19, 0.18), (0, 0.235, 0.23), (0, 0.245, 0.29), (0, 0.225, 0.335), (0, 0.19, 0.345)]
    T = [tube("tl", pts, lambda u: (0.024 * (1 - 0.25 * u),) * 2, F, seg=10, steps=5, up=(1, 0, 0)),
         uvsphere("tip", 0.019, (0, 0.193, 0.345), F2, seg=10, rings=7, scale=(1.0, 1.25, 1.0))]
    t = join(T, "tail_mesh"); parent(t, tail)
    for k, (x, y) in enumerate([(-0.05, -0.062), (0.05, -0.062), (-0.06, 0.09), (0.06, 0.09)]):
        _pet_leg(k, body, x, y, 0.1, 0.027, F, F2)
    return root

def build_dog():
    F = material("fur", 0xb98050, True); F2 = material("fur2", 0xf6e6c8, True); C = material("collar", 0xd9433b, True)
    G = material("gold", 0xf0b429, True); N = material("nose", 0x2a2220, True); E = material("eye", 0x2a2230, True)
    S = material("shine", 0xffffff, True); Tg = material("tongue", 0xec7a86, True)
    root = empty("dog", (0, 0, 0))
    body = empty("body", (0, 0, 0)); parent(body, root)
    P = [uvsphere("torso", 0.11, (0, 0.02, 0.18), F, seg=14, rings=9, scale=(0.92, 1.45, 0.85)),
         uvsphere("bib", 0.074, (0, -0.095, 0.17), F2, seg=12, rings=8, scale=(0.95, 0.72, 1.08)),
         # collar: a band round the neck with a gold tag
         cyl("collar", 0.062, 0.06, 0.024, (0, -0.12, 0.235), C, seg=16, rot=(0.9, 0, 0), smooth=True),
         uvsphere("bail", 0.008, (0, -0.164, 0.19), G, seg=6, rings=4),
         cyl("tag", 0.02, 0.02, 0.008, (0, -0.16, 0.172), G, seg=12, rot=(math.pi / 2, 0, 0), smooth=True)]
    for s in (-1, 1):
        P.append(uvsphere(f"haunch{s}", 0.06, (s * 0.066, 0.115, 0.16), F, seg=10, rings=7, scale=(0.8, 1.1, 1.0)))
    b = join(P, "body_mesh"); parent(b, body)
    head = empty("head", (0, -0.12, 0.27)); parent(head, body)
    H = [uvsphere("skull", 0.095, (0, -0.18, 0.335), F, seg=14, rings=10, scale=(1.05, 0.95, 0.92)),
         uvsphere("snout", 0.05, (0, -0.258, 0.305), F2, seg=12, rings=8, scale=(0.95, 1.15, 0.78)),
         uvsphere("blaze", 0.03, (0, -0.245, 0.36), F2, seg=10, rings=7, scale=(0.62, 0.6, 1.45)),
         uvsphere("nose", 0.02, (0, -0.312, 0.326), N, seg=10, rings=7, scale=(1.25, 0.9, 0.85)),
         uvsphere("tongue", 0.019, (0, -0.287, 0.272), Tg, seg=10, rings=6, scale=(0.95, 0.85, 0.5), rot=(0.4, 0, 0))]
    for s in (-1, 1):
        # big perky corgi ears with cream insides
        H.append(_ear(f"ear{s}", (s * 0.058, -0.16, 0.385), 0.05, 0.1, F, (0.12, s * 0.42, 0), flat=0.5))
        H.append(_ear(f"inner{s}", (s * 0.057, -0.174, 0.392), 0.031, 0.067, F2, (0.12, s * 0.42, 0), flat=0.38))
        H.append(uvsphere(f"cheek{s}", 0.03, (s * 0.06, -0.225, 0.3), F2, seg=8, rings=6, scale=(0.9, 0.9, 0.8)))
    for k, (x, y, rx, ry) in enumerate([(-0.025, -0.16, 0.2, -0.5), (0.0, -0.17, 0.35, 0.0), (0.028, -0.16, 0.2, 0.5)]):
        H.append(cyl(f"tuft{k}", 0.022, 0.0, 0.045, (x, y, 0.405), F, seg=5, rot=(rx, ry, 0)))   # scruffy top
    _eyes(H, 0.042, -0.252, 0.36, 0.019, E, S)
    h = join(H, "head_mesh"); parent(h, head)
    # short fluffy tail that sticks up (wags)
    tail = empty("tail", (0, 0.165, 0.235)); parent(tail, body)
    pts = [(0, 0.155, 0.225), (0, 0.2, 0.27), (0, 0.22, 0.32), (0, 0.21, 0.355)]
    T = [tube("tl", pts, lambda u: (0.03 * (1 - 0.3 * u),) * 2, F, seg=10, steps=5, up=(1, 0, 0)),
         uvsphere("tip", 0.022, (0, 0.212, 0.352), F2, seg=10, rings=7)]
    t = join(T, "tail_mesh"); parent(t, tail)
    for k, (x, y) in enumerate([(-0.055, -0.085), (0.055, -0.085), (-0.06, 0.12), (0.06, 0.12)]):
        _pet_leg(k, body, x, y, 0.11, 0.031, F, F2)
    return root
