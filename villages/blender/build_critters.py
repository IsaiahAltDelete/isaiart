# Farm animals, crops and winter props.
# Animals face -Y; a "head" node is the grazing pivot the game nods.
import math, random

def build_sheep():
    W = material("wool", 0xf6f3ea, True); F = material("face", 0x3a3230, True); E = material("eye", 0x111111, True)
    root = empty("sheep", (0, 0, 0)); P = []
    rnd = random.Random(3)
    # a cloud of wool puffs
    for k in range(9):
        a = k / 9 * math.pi * 2
        P.append(uvsphere(f"w{k}", 0.11, (math.cos(a) * 0.09, math.sin(a) * 0.13, 0.3 + rnd.uniform(-0.02, 0.04)), W, seg=10, rings=7))
    P.append(uvsphere("wc", 0.15, (0, 0, 0.33), W, seg=12, rings=8, scale=(1, 1.25, 0.95)))
    for x in (-0.07, 0.07):
        for y in (-0.1, 0.1):
            P.append(cyl(f"l{x}{y}", 0.025, 0.022, 0.2, (x, y, 0), F, seg=6, smooth=True))
    body = join(P, "body"); parent(body, root)
    head = empty("head", (0, -0.17, 0.33)); parent(head, root)
    H = [uvsphere("hd", 0.075, (0, -0.24, 0.32), F, seg=10, rings=8, scale=(0.9, 1.15, 1.0)),
         uvsphere("tuft", 0.06, (0, -0.21, 0.39), W, seg=8, rings=6)]
    for s in (-1, 1):
        H.append(uvsphere(f"ear{s}", 0.03, (s * 0.075, -0.2, 0.33), F, seg=8, rings=5, scale=(1.6, 0.8, 0.6)))
        H.append(uvsphere(f"eye{s}", 0.013, (s * 0.035, -0.31, 0.34), E, seg=6, rings=4))
    h = join(H, "head_mesh"); parent(h, head)
    return root

def build_cow():
    B = material("hide", 0xf7f3ea, True); S = material("spot", 0x3a3230, True); N = material("snout", 0xf2b8a8, True)
    Hn = material("horn", 0xe8dcc0, True); E = material("eye", 0x111111, True); Hf = material("hoof", 0x4a3a30, True)
    root = empty("cow", (0, 0, 0)); P = []
    P.append(box("torso", (0.28, 0.5, 0.26), (0, 0, 0.17), B, bev=0.08, segs=3))
    for (x, y, z, r) in [(0.1, 0.05, 0.36, 0.09), (-0.12, -0.12, 0.3, 0.07), (-0.05, 0.17, 0.38, 0.06)]:
        P.append(uvsphere(f"sp{x}", r, (x, y, z), S, seg=10, rings=6, scale=(1.0, 1.1, 0.35)))
    for x in (-0.09, 0.09):
        for y in (-0.17, 0.17):
            P.append(cyl(f"l{x}{y}", 0.04, 0.035, 0.19, (x, y, 0.02), B, seg=8, smooth=True))
            P.append(cyl(f"h{x}{y}", 0.04, 0.04, 0.03, (x, y, 0), Hf, seg=8, smooth=True))
    P.append(uvsphere("udder", 0.05, (0, 0.12, 0.15), N, seg=8, rings=6))
    P.append(cyl("tail", 0.012, 0.012, 0.22, (0, 0.27, 0.22), B, seg=5, rot=(0.35, 0, 0)))
    P.append(uvsphere("tailtip", 0.03, (0, 0.33, 0.06), S, seg=6, rings=5))
    body = join(P, "body"); parent(body, root)
    head = empty("head", (0, -0.26, 0.36)); parent(head, root)
    H = [box("skull", (0.18, 0.18, 0.17), (0, -0.33, 0.3), B, bev=0.05, segs=2),
         box("snout", (0.17, 0.08, 0.09), (0, -0.42, 0.29), N, bev=0.035, segs=2)]
    for s in (-1, 1):
        H.append(cyl(f"horn{s}", 0.022, 0.0, 0.08, (s * 0.07, -0.31, 0.46), Hn, seg=6, rot=(0, s * 0.6, 0)))
        H.append(uvsphere(f"ear{s}", 0.03, (s * 0.11, -0.3, 0.42), S, seg=8, rings=5, scale=(1.6, 0.6, 0.8)))
        H.append(uvsphere(f"eye{s}", 0.016, (s * 0.05, -0.42, 0.41), E, seg=6, rings=4))
        H.append(uvsphere(f"nos{s}", 0.01, (s * 0.035, -0.465, 0.31), S, seg=5, rings=4))
    h = join(H, "head_mesh"); parent(h, head)
    return root

def build_chicken(col=0xfaf6ee):
    Bd = material("plume", col, True); Cm = material("comb", 0xd83a3a, True); Bk = material("beak", 0xf0a020, True); E = material("eye", 0x111111, True)
    root = empty("chicken", (0, 0, 0)); P = []
    P.append(uvsphere("b", 0.085, (0, 0.01, 0.1), Bd, seg=10, rings=8, scale=(1.0, 1.2, 0.95)))
    P.append(uvsphere("tail", 0.04, (0, 0.1, 0.16), Bd, seg=8, rings=5, scale=(0.5, 0.9, 1.3), rot=(-0.6, 0, 0)))
    for s in (-1, 1):
        P.append(uvsphere(f"wing{s}", 0.045, (s * 0.075, 0.02, 0.1), Bd, seg=8, rings=5, scale=(0.4, 1.2, 0.8)))
        P.append(cyl(f"leg{s}", 0.008, 0.008, 0.05, (s * 0.03, 0, 0.0), Bk, seg=4))
    body = join(P, "body"); parent(body, root)
    head = empty("head", (0, -0.06, 0.15)); parent(head, root)
    H = [uvsphere("h", 0.052, (0, -0.07, 0.2), Bd, seg=10, rings=7),
         cyl("bk", 0.018, 0.0, 0.045, (0, -0.115, 0.195), Bk, seg=5, rot=(math.pi / 2, 0, 0)),
         uvsphere("cm", 0.022, (0, -0.07, 0.255), Cm, seg=6, rings=5, scale=(0.5, 1.4, 1.0)),
         uvsphere("wt", 0.012, (0, -0.105, 0.17), Cm, seg=5, rings=4)]
    for s in (-1, 1): H.append(uvsphere(f"e{s}", 0.008, (s * 0.032, -0.105, 0.21), E, seg=5, rings=4))
    h = join(H, "head_mesh"); parent(h, head)
    return root

# ── crops: one bunch each; the game scales them by growth stage ──
def build_crop_wheat():
    St = material("stalk", 0x8fbf4a); Ea = material("ear", 0xe8c14a)
    root = empty("crop_wheat", (0, 0, 0)); P = []; rnd = random.Random(5)
    for k in range(7):
        a = k / 7 * math.pi * 2; r = 0.035 if k else 0
        tilt = (math.sin(a) * 0.18, math.cos(a) * 0.18, 0)
        x, y = math.cos(a) * r, math.sin(a) * r
        h = rnd.uniform(0.36, 0.44)
        P.append(cyl(f"s{k}", 0.008, 0.006, h, (x, y, 0), St, seg=4, rot=tilt))
        bpy.context.view_layer.update()
        top = P[-1].matrix_world @ Vector((0, 0, h))
        P.append(uvsphere(f"e{k}", 0.022, tuple(top), Ea, seg=6, rings=5, scale=(0.8, 0.8, 2.6), smooth=False))
    P.append(cyl("leaf", 0.06, 0.0, 0.12, (0, 0, 0), St, seg=5))
    o = join(P, "crop"); parent(o, root)
    return root

def build_crop_veg():
    L = material("leaf", 0x4f9a3a); Hd = material("head", 0x9fd36a)
    root = empty("crop_veg", (0, 0, 0)); P = []
    for k in range(6):
        a = k / 6 * math.pi * 2
        P.append(uvsphere(f"l{k}", 0.07, (math.cos(a) * 0.07, math.sin(a) * 0.07, 0.05), L, seg=8, rings=5, scale=(1.3, 0.9, 0.45), rot=(0, 0, a), smooth=False))
    P.append(uvsphere("h", 0.075, (0, 0, 0.09), Hd, seg=10, rings=7, scale=(1, 1, 0.9), smooth=False))
    o = join(P, "crop"); parent(o, root)
    return root

def build_crop_pumpkin():
    Pm = material("pumpkin", 0xe58a3a); L = material("leaf", 0x5f9a3a); S = material("stem", 0x6b5a2a)
    root = empty("crop_pumpkin", (0, 0, 0)); P = []
    for k in range(6):
        a = k / 6 * math.pi * 2
        P.append(uvsphere(f"r{k}", 0.07, (math.cos(a) * 0.045, math.sin(a) * 0.045, 0.07), Pm, seg=8, rings=6, scale=(0.75, 0.75, 0.85), smooth=False))
    P.append(cyl("stem", 0.015, 0.01, 0.06, (0, 0, 0.13), S, seg=5, rot=(0.3, 0, 0)))
    for k in range(3):
        a = k * 2.1 + 0.5
        P.append(uvsphere(f"lf{k}", 0.06, (math.cos(a) * 0.14, math.sin(a) * 0.14, 0.02), L, seg=8, rings=5, scale=(1.4, 1.0, 0.3), rot=(0, 0, a), smooth=False))
    o = join(P, "crop"); parent(o, root)
    return root

# ── winter ──
def build_snowman():
    Sn = material("snow", 0xf4f7fb, True); Co = material("coal", 0x2a2a2a, True); Ca = material("carrot", 0xf07a2a, True)
    Sc = material("scarf", 0xd9433b, True); Br = material("twig", 0x6b4428, True); Ht = material("tophat", 0x2f2f3a, True)
    root = empty("snowman", (0, 0, 0)); P = []
    P.append(uvsphere("b1", 0.3, (0, 0, 0.26), Sn, seg=14, rings=10, scale=(1, 1, 0.9)))
    P.append(uvsphere("b2", 0.22, (0, 0, 0.66), Sn, seg=14, rings=10))
    P.append(uvsphere("b3", 0.16, (0, 0, 0.98), Sn, seg=14, rings=10))
    P.append(cyl("nose", 0.03, 0.0, 0.14, (0, -0.15, 0.97), Ca, seg=6, rot=(math.pi / 2, 0, 0)))
    for s in (-1, 1):
        P.append(uvsphere(f"eye{s}", 0.022, (s * 0.06, -0.145, 1.03), Co, seg=6, rings=4))
        P.append(cyl(f"arm{s}", 0.015, 0.01, 0.4, (s * 0.18, 0, 0.72), Br, seg=5, rot=(0, s * 1.1, 0)))
    for k in range(3): P.append(uvsphere(f"btn{k}", 0.022, (0, -0.215 + k * 0.012, 0.58 + k * 0.1), Co, seg=6, rings=4))
    for k in range(5):
        a = math.radians(-60 + k * 30)
        P.append(uvsphere(f"m{k}", 0.012, (math.sin(a) * 0.07, -0.148, 0.93 + math.cos(a) * -0.01 - abs(math.sin(a)) * -0.015), Co, seg=5, rings=4))
    P.append(cyl("scarf", 0.17, 0.17, 0.07, (0, 0, 0.82), Sc, seg=14))
    P.append(box("tail", (0.07, 0.03, 0.2), (0.1, -0.15, 0.65), Sc, bev=0.01, rot=(0, 0.2, 0)))
    P.append(cyl("brim", 0.17, 0.17, 0.02, (0, 0, 1.1), Ht, seg=14))
    P.append(cyl("crown", 0.11, 0.11, 0.18, (0, 0, 1.11), Ht, seg=14))
    P.append(cyl("band", 0.112, 0.112, 0.035, (0, 0, 1.13), Sc, seg=14))
    o = join(P, "body"); parent(o, root)
    return root

def build_sled():
    Wd = material("wood", 0xb8743a); Rn = material("runner", 0xc9473d)
    root = empty("sled", (0, 0, 0)); P = []
    P.append(box("deck", (0.26, 0.5, 0.03), (0, 0, 0.09), Wd, bev=0.01))
    for x in (-0.11, 0.11):
        P.append(box(f"run{x}", (0.025, 0.56, 0.025), (x, 0.02, 0.0), Rn))
        P.append(cyl(f"curl{x}", 0.05, 0.05, 0.025, (x - 0.0125, -0.27, 0.06), Rn, seg=8, rot=(0, math.pi / 2, 0)))
        for y in (-0.15, 0.15): P.append(box(f"st{x}{y}", (0.02, 0.02, 0.08), (x, y, 0.01), Rn))
    P.append(box("rope", (0.2, 0.01, 0.01), (0, -0.3, 0.1), material("rope", 0x8a7350)))
    o = join(P, "body"); parent(o, root)
    return root
