# Storybook villager: ~4 heads tall, a normal-sized head with dot eyes, a real
# torso, arms and legs, boots. (The client turned down the chibi version.)
# Node layout (names matter to js/models.js):
#   villager
#     body            (empty; sleeping rotates it)
#       torso         shirt / pants / belt / neck
#       head          skin, eyes, brows, nose, ears  (pivot at the neck)
#         hair_short, hair_bob, hair_bun, hair_tails, hair_tuft, hair_long, hair_elder
#         hat_straw, hat_cap, hat_toque, hat_helmet, hat_bucket, hat_hood, hat_band, hat_beanie
#         race_elf, race_gnome (ears + button nose), race_beard, race_tusks, race_horns,
#         race_snout (muzzle, crest, cheek frills)   (shown per race by the game)
#         mask          bandit eye-mask (slot "mask"), shown on villagers sneaking about at night
#         hat_archmage, hat_crown
#       hipL / hipR   (pivots)  leg + boot
#       armL / armR   (pivots)  sleeve + hand;  pt_hand on the right arm
#       apron, pack, scarf      (toggled by the game)
#       race_tail, chain, robe  (toggled by the game)
import math
from mathutils import Vector, Matrix

NECK_Z = 0.55
HEAD_R = 0.098
HEAD_C = (0, 0, NECK_Z + 0.112)
# Hair and hats are modelled around a reference head (radius 0.155 centred at
# z 0.52) and then fitted onto the real head.
REF_C, REF_R = Vector((0, 0, 0.52)), 0.155

def arc_panel(name, r_top, r_bot, z0, z1, half_angle, mat, t=0.012):
    """A curved cloth panel hugging the body's front (around -Y), from z0 up to z1."""
    bm = bmesh.new(); n = 8; rows = []
    for zi, (z, r) in enumerate(((z0, r_bot), (z1, r_top))):
        ring = []
        for k in range(n + 1):
            a = -math.pi / 2 - half_angle + 2 * half_angle * k / n
            ring.append((bm.verts.new((math.cos(a) * r, math.sin(a) * r, z)), bm.verts.new((math.cos(a) * (r - t), math.sin(a) * (r - t), z))))
        rows.append(ring)
    b, tp = rows
    for k in range(n):
        bm.faces.new((b[k][0], b[k + 1][0], tp[k + 1][0], tp[k][0]))       # outside
        bm.faces.new((tp[k][1], tp[k + 1][1], b[k + 1][1], b[k][1]))       # inside
        bm.faces.new((tp[k][0], tp[k + 1][0], tp[k + 1][1], tp[k][1]))     # top edge
        bm.faces.new((b[k][1], b[k + 1][1], b[k + 1][0], b[k][0]))         # hem
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return _obj(name, bm, mat, smooth=True)

def fit_to_head(o):
    k = HEAD_R / REF_R * 1.02
    M = Matrix.Translation(Vector(HEAD_C)) @ Matrix.Scale(k, 4) @ Matrix.Translation(-REF_C)
    o.data.transform(M)
    return o

def web(name, base, tips, mat, t=0.004):
    """A thin webbed membrane fanning from base out between spine tips (scalloped edge)."""
    bm = bmesh.new(); b = bm.verts.new(base); ring = []
    for k, tp in enumerate(tips):
        ring.append(bm.verts.new(base.lerp(tp, 0.86)))
        if k < len(tips) - 1: ring.append(bm.verts.new(base.lerp((tp + tips[k + 1]) / 2, 0.62)))
    for k in range(len(ring) - 1): bm.faces.new((b, ring[k], ring[k + 1]))
    o = _obj(name, bm, mat, smooth=True)
    sm = o.modifiers.new("solid", "SOLIDIFY"); sm.thickness = t; sm.offset = 0
    return o

def mask_band(name, hz, mat, seg=72, rows=14):
    """The bandit mask's cloth band (head space, before the tilt). A domino shape:
    deep over the eyes, pinched over the nose bridge, narrowing to a strap that
    runs over the hair at the sides and back. Two round holes keep the dot eyes
    showing."""
    eyes = [(s * math.atan2(0.033, 0.084), 0.008) for s in (-1, 1)]
    hw, hh = 0.165, 0.019                    # eye-hole half-size (radians, height)
    def sstep(a, b, x):
        k = min(1.0, max(0.0, (x - a) / (b - a))); return k * k * (3 - 2 * k)
    def span(th):
        a = abs(th); bridge = 1 - sstep(0.0, 0.2, a); strap = sstep(0.62, 1.0, a)
        return -0.026 + 0.012 * bridge + 0.018 * strap, 0.044 - 0.009 * bridge - 0.014 * strap
    def radius(th, z):
        face = 0.0931 * math.sqrt(max(0.0, 1 - (z / 0.1039) ** 2)) + 0.005
        # over the hair: the short-hair dome (centre y +0.009, z +0.0065); fuller
        # styles cover the strap, but the knot still pokes out behind
        f = math.sqrt(max(0.0, 1 - ((z - 0.0065) / 0.1017) ** 2))
        ax, ay = 0.1113 * f, 0.1092 * f
        c, sn = -math.cos(th), math.sin(th)
        hair = 1 / math.sqrt((sn / ax) ** 2 + (c / ay) ** 2) + 0.009 * max(0.0, c) + 0.004
        return face + (max(face, hair) - face) * sstep(0.5, 1.15, abs(th))
    def pos(th, z):
        r = radius(th, z)
        return (math.sin(th) * r, -math.cos(th) * r, hz + z)
    bm = bmesh.new(); par = {}; grid = []
    for i in range(seg):
        th = -math.pi + 2 * math.pi * i / seg; lo, hi = span(th); col = []
        for j in range(rows + 1):
            z = lo + (hi - lo) * j / rows
            v = bm.verts.new(pos(th, z)); par[v] = (th, z, j); col.append(v)
        grid.append(col)
    for i in range(seg):
        i2 = (i + 1) % seg
        for j in range(rows):
            bm.faces.new((grid[i][j], grid[i2][j], grid[i2][j + 1], grid[i][j + 1]))
    def in_hole(th, z):
        return any(((th - te) / hw) ** 2 + ((z - ze) / hh) ** 2 < 1 for te, ze in eyes)
    gone = []
    for f in bm.faces:
        th = sum(par[v][0] for v in f.verts) / 4; z = sum(par[v][1] for v in f.verts) / 4
        if abs(th) < 1.2 and in_hole(th, z): gone.append(f)
    bmesh.ops.delete(bm, geom=gone, context="FACES_ONLY")
    # round the stair-stepped hole edges onto the ellipses
    for v in bm.verts:
        th, z, j = par[v]
        if len(v.link_faces) >= 4 or j in (0, rows) or abs(th) > 1.2: continue
        te, ze = min(eyes, key=lambda e: abs(e[0] - th))
        u, w = (th - te) / hw, (z - ze) / hh; d = math.hypot(u, w)
        if 0 < d < 1.6:
            v.co = pos(te + u / d * hw, ze + w / d * hh)
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    o = _obj(name, bm, mat, smooth=True)
    sm = o.modifiers.new("solid", "SOLIDIFY"); sm.thickness = 0.006; sm.offset = 0
    return o

def build_villager():
    SH = material("shirt", 0x4f8fd9, True)
    PA = material("pants", 0x4a4038, True)
    BE = material("belt", 0x5a3a22)
    BO = material("shoe", 0x6b4428, True)
    SK = material("skin", 0xe8b590, True)
    EY = material("eye", 0x2a1a10, True)
    HA = material("hair", 0x6b4226, True)
    HT = material("hat", 0xc9a050, True)
    HB = material("hatband", 0x8a4a3a, True)
    AP = material("apron", 0xf3ead6, True)
    ME = material("metal", 0xb8bcc4)
    WI = material("basket", 0xc8955a)

    root = empty("villager", (0, 0, 0))
    body = empty("body", (0, 0, 0)); parent(body, root)

    # torso: shoulders a little broader than the waist, tunic hem over the hips
    t_shirt = cyl("t_shirt", 0.084, 0.096, 0.24, (0, 0, 0.3), SH, seg=12, bev=0.03, segs=2, smooth=True)
    t_hem = cyl("t_hem", 0.106, 0.09, 0.06, (0, 0, 0.27), SH, seg=14, bev=0.015, smooth=True)    # a little flare at the hem
    t_hips = cyl("t_hips", 0.084, 0.086, 0.07, (0, 0, 0.25), PA, seg=12, bev=0.02, smooth=True)
    t_belt = cyl("t_belt", 0.092, 0.092, 0.022, (0, 0, 0.335), BE, seg=12, smooth=True)
    t_buckle = box("t_buckle", (0.03, 0.012, 0.022), (0, -0.092, 0.335), material("gold", 0xd9a520))
    neck = cyl("t_neck", 0.03, 0.032, 0.05, (0, 0, NECK_Z - 0.02), SK, seg=10, smooth=True)
    collar = cyl("t_collar", 0.05, 0.06, 0.022, (0, 0, NECK_Z - 0.03), SH, seg=12, bev=0.008, smooth=True)
    buttons = [sphere(f"t_button{k}", 0.007, (0, -(0.0905 + k * 0.0015), 0.47 - k * 0.045), material("gold", 0xd9a520), sub=1) for k in range(2)]
    torso = join([t_shirt, t_hem, t_hips, t_belt, t_buckle, neck, collar] + buttons, "torso"); parent(torso, body)

    # head: a slightly tall egg; small dot eyes, brows, a little nose; pivot at the neck
    head = empty("head", (0, 0, NECK_Z)); parent(head, body)
    hx, hy, hz = HEAD_C
    skull = uvsphere("h_skull", HEAD_R, HEAD_C, SK, seg=16, rings=10, scale=(0.95, 0.95, 1.06))
    ears = [sphere(f"h_ear{s}", 0.02, (s * 0.085, 0.004, hz - 0.004), SK, sub=1, scale=(0.55, 0.9, 1.2), smooth=True) for s in (-1, 1)]
    fy = -HEAD_R * 0.93
    WH = material("white", 0xfffaf0, True); CH = material("cheek", 0xf2a08e, True); LI = material("lip", 0x9a5a48, True)
    face = []
    for sx in (-1, 1):
        # big friendly eyes: a dark oval with a white catch-light (sized to the bandit mask's eye holes)
        face.append(uvsphere(f"h_eye{sx}", 0.019, (sx * 0.034, fy + 0.006, hz + 0.007), EY, seg=10, rings=7, scale=(0.78, 0.45, 1.0)))
        face.append(uvsphere(f"h_shine{sx}", 0.0055, (sx * 0.029, fy - 0.004, hz + 0.015), WH, seg=7, rings=5, scale=(1.0, 0.5, 1.0)))
        # a soft arched brow, thinner and higher than before, so the face reads kind rather than cross
        face.append(box(f"h_brow{sx}", (0.026, 0.007, 0.007), (sx * 0.037, fy + 0.006, hz + 0.04), HA, base=False, bev=0.003, rot=(0, sx * -0.22, 0)))
        # rosy cheeks, turned to sit flat on the side of the face (hidden by the game when the camera is far out)
        face.append(uvsphere(f"h_cheek{sx}", 0.016, (sx * 0.066, -0.07, hz - 0.02), CH, seg=9, rings=6, scale=(1.0, 0.35, 0.75), rot=(0, 0, sx * 0.73)))
    face.append(uvsphere("h_nose", 0.0125, (0, fy - 0.007, hz - 0.012), SK, seg=8, rings=6, scale=(0.9, 1.0, 1.1)))
    # a little smile: a shallow arc under the nose
    face.append(tube("h_mouth", [(-0.017, fy + 0.012, hz - 0.033), (0, fy + 0.007, hz - 0.042), (0.017, fy + 0.012, hz - 0.033)],
                     lambda u: (0.0035, 0.0035), LI, seg=6, steps=4))
    headm = join([skull] + ears + face, "head_mesh")
    TILT = (-0.22, 0, 0)               # faces tipped toward the high game camera (still not a chibi tilt)
    NECK = (0, 0, NECK_Z)
    rotate_about(headm, NECK, TILT); parent(headm, head)

    # ── hair styles (modelled on the reference head, then fitted) ──
    rz = REF_C.z
    HL = 0.6
    def dome(name, r, z, scale, cut, mat=HA, yoff=0.014, front=HL):
        return uvsphere(name, r, (0, yoff, z), mat, seg=18, rings=12, scale=scale, cut=cut, front=front)
    def fringe(name, n=3):
        """A single soft swept bang across the forehead (n picks the side it sweeps to)."""
        sx = 1 if n == 4 else -1
        return [uvsphere(f"{name}_sweep", 0.085, (sx * 0.03, -0.1, rz + 0.1), HA, seg=12, rings=7, scale=(1.5, 0.48, 0.48), rot=(0.45, 0, sx * -0.22))]
    hairs = {}
    hairs["hair_short"] = [dome("hs", 0.166, rz + 0.01, (1.04, 1.02, 0.95), -0.05)] + fringe("hsb", 4)
    hairs["hair_bob"] = [dome("hb", 0.172, rz, (1.08, 1.05, 1.0), -0.55, front=0.45)] + fringe("hbb", 3)
    hairs["hair_bun"] = [dome("hn", 0.166, rz + 0.01, (1.04, 1.02, 0.95), -0.1), uvsphere("hn_bun", 0.07, (0, 0.08, rz + 0.15), HA, seg=12, rings=8)]
    tails = [uvsphere(f"ht_t{sx}", 0.055, (sx * 0.17, 0.05, rz - 0.07), HA, seg=10, rings=8, scale=(0.75, 0.75, 1.5)) for sx in (-1, 1)]
    hairs["hair_tails"] = [dome("ht", 0.166, rz + 0.01, (1.04, 1.02, 0.95), -0.1)] + tails + fringe("htb", 3)
    tuft = cyl("hf_tuft", 0.05, 0.0, 0.1, (0.02, -0.03, rz + 0.135), HA, seg=6, rot=(math.radians(-25), math.radians(15), 0))
    hairs["hair_tuft"] = [dome("hf", 0.164, rz + 0.012, (1.04, 1.02, 0.93), 0.05), tuft]
    longb = box("hl_back", (0.27, 0.07, 0.3), (0, 0.12, rz - 0.28), HA, bev=0.03, segs=2)
    hairs["hair_long"] = [dome("hl", 0.172, rz, (1.06, 1.05, 0.98), -0.35, front=0.48), longb] + fringe("hlb", 4)
    el = [uvsphere(f"he_{sx}", 0.06, (sx * 0.15, 0.03, rz), HA, seg=10, rings=6, scale=(0.7, 1.2, 0.9)) for sx in (-1, 1)]
    el.append(dome("he_back", 0.16, rz - 0.02, (1.03, 1.03, 0.8), -0.3, yoff=0.04, front=0.9))
    # elders get a neat beard (shown with the elder hair)
    el.append(uvsphere("he_beard", 0.085, (0, -0.1, rz - 0.11), HA, seg=10, rings=7, scale=(1.1, 0.6, 1.0)))
    hairs["hair_elder"] = el
    for n, parts in hairs.items():
        o = join(parts, n); fit_to_head(o); rotate_about(o, NECK, TILT); parent(o, head)

    # ── hats ──
    hats = {}
    straw = [cyl("hs_brim", 0.21, 0.21, 0.02, (0, 0, 0), HT, seg=20, bev=0.006),
             cyl("hs_crown", 0.13, 0.11, 0.11, (0, 0, 0.012), HT, seg=14, bev=0.025, segs=2, smooth=True),
             cyl("hs_band", 0.132, 0.13, 0.03, (0, 0, 0.018), HB, seg=14)]
    for p in straw: p.location.z += rz + 0.11; p.location.y += 0.04
    hats["hat_straw"] = (straw, (math.radians(-20), 0, 0))
    cap = [uvsphere("hc_dome", 0.172, (0, 0.016, rz + 0.03), HT, seg=16, rings=10, scale=(1.05, 1.05, 0.9), cut=0.05, front=0.6),
           box("hc_bill", (0.2, 0.11, 0.018), (0, -0.165, rz + 0.08), HB, bev=0.008, rot=(math.radians(-14), 0, 0))]
    hats["hat_cap"] = (cap, None)
    toque = [cyl("hq_band", 0.15, 0.15, 0.06, (0, 0.02, rz + 0.09), AP, seg=16, smooth=True),
             uvsphere("hq_puff", 0.14, (0, 0.03, rz + 0.2), AP, seg=14, rings=8, scale=(1.1, 1.1, 0.75))]
    hats["hat_toque"] = (toque, None)
    helmet = [uvsphere("hh_dome", 0.178, (0, 0.018, rz + 0.02), ME, seg=16, rings=10, scale=(1.05, 1.05, 0.95), cut=0.0, front=0.6),
              cyl("hh_rim", 0.19, 0.19, 0.02, (0, 0.018, rz + 0.015), ME, seg=16),
              cyl("hh_spike", 0.022, 0.0, 0.07, (0, 0.01, rz + 0.18), ME, seg=6)]
    hats["hat_helmet"] = (helmet, None)
    bucket = [cyl("hk_brim", 0.2, 0.18, 0.045, (0, 0.03, rz + 0.08), HT, seg=16, bev=0.008, smooth=True),
              cyl("hk_top", 0.155, 0.135, 0.1, (0, 0.03, rz + 0.105), HT, seg=16, bev=0.02, segs=2, smooth=True)]
    hats["hat_bucket"] = (bucket, (math.radians(-14), 0, 0))
    hood = [uvsphere("hd_hood", 0.19, (0, 0.04, rz), HT, seg=16, rings=10, scale=(1.0, 1.05, 1.05), cut=-0.35, front=0.64),
            cyl("hd_tip", 0.06, 0.0, 0.14, (0, 0.13, rz + 0.13), HT, seg=8, rot=(math.radians(55), 0, 0))]
    hats["hat_hood"] = (hood, None)
    band = [cyl("hn_band", 0.165, 0.165, 0.035, (0, 0.0, rz + 0.07), HB, seg=16, smooth=True),
            box("hn_knot", (0.04, 0.05, 0.06), (0.03, 0.165, rz + 0.05), HB, bev=0.01)]
    hats["hat_band"] = (band, None)
    WN = material("winter", 0xb8463e, True); WC = material("wintercuff", 0x8e3530, True)
    WR = material("wintercuffrib", 0x6e2a26, True); WP = material("winterpom", 0xd8705f, True)
    # a slouchy knit: taller than wide, folded over at the back, on a ribbed turned-up cuff
    beanie = [uvsphere("hw_dome", 0.172, (0, 0.03, rz + 0.04), WN, seg=16, rings=10, scale=(1.04, 1.06, 1.32), cut=0.0, front=0.6),
              uvsphere("hw_fold", 0.1, (0, 0.13, rz + 0.2), WN, seg=12, rings=8, scale=(1.2, 0.9, 0.8)),
              uvsphere("hw_pom", 0.045, (0, 0.17, rz + 0.27), WP, seg=8, rings=6)]
    cuffc = (0, 0.03, rz + 0.06)
    cuff = [cyl("hw_cuff", 0.188, 0.186, 0.07, cuffc, WC, seg=20, bev=0.02, segs=2, smooth=True)]
    for k in range(18):
        a_ = k / 18 * math.pi * 2
        cuff.append(box(f"hw_rib{k}", (0.016, 0.01, 0.062), (math.cos(a_) * 0.19, 0.03 + math.sin(a_) * 0.19, rz + 0.064), WR, rot=(0, 0, a_ + math.pi / 2)))
    cuffo = join(cuff, "hw_cuffset"); rotate_about(cuffo, (0, 0.03, rz + 0.095), (0.3, 0, 0))
    beanie.append(cuffo)
    hats["hat_beanie"] = (beanie, None)
    for n, (parts, rot) in hats.items():
        o = join(parts, n)
        if rot: rotate_about(o, (0, 0.02, rz), rot)
        fit_to_head(o); rotate_about(o, NECK, TILT); parent(o, head)

    # ── legs (hip pivots) ──
    HIP = 0.29
    for s, nm in ((-1, "hipL"), (1, "hipR")):
        hip = empty(nm, (s * 0.042, 0, HIP)); parent(hip, body)
        leg = cyl(f"{nm}_leg", 0.034, 0.03, HIP - 0.03, (s * 0.042, 0, 0.03), PA, seg=10, smooth=True)
        boot = box(f"{nm}_boot", (0.072, 0.1, 0.062), (s * 0.045, -0.008, 0.008), BO, bev=0.022, segs=2)
        toe = uvsphere(f"{nm}_toe", 0.034, (s * 0.045, -0.058, 0.036), BO, seg=10, rings=7, scale=(1.05, 0.9, 0.85))
        sole = box(f"{nm}_sole", (0.078, 0.128, 0.012), (s * 0.045, -0.022, 0.0), BE, bev=0.005)
        cuff = cyl(f"{nm}_bcuff", 0.037, 0.036, 0.022, (s * 0.044, 0, 0.058), BO, seg=10, smooth=True)
        lg = join([leg, boot, toe, sole, cuff], f"{nm}_mesh"); parent(lg, hip)

    # ── arms (shoulder pivots) ──
    SHZ = NECK_Z - 0.04
    for s, nm in ((-1, "armL"), (1, "armR")):
        sh = empty(nm, (s * 0.108, 0, SHZ)); parent(sh, body)
        # a rounded shoulder cap where the sleeve meets the tunic, a sleeve that tapers to the cuff
        cap = uvsphere(f"{nm}_shoulder", 0.04, (s * 0.1, 0, SHZ - 0.006), SH, seg=12, rings=8, scale=(1.0, 0.95, 0.8))
        slv = cyl(f"{nm}_sleeve", 0.031, 0.04, 0.19, (s * 0.108, 0, SHZ - 0.19), SH, seg=10, bev=0.01, smooth=True)
        cuff = cyl(f"{nm}_cuff", 0.035, 0.035, 0.022, (s * 0.108, 0, SHZ - 0.198), SH, seg=10, smooth=True)
        hand = uvsphere(f"{nm}_hand", 0.039, (s * 0.108, -0.006, SHZ - 0.224), SK, seg=10, rings=8, scale=(0.85, 0.78, 1.08))   # a mitten
        thumb = uvsphere(f"{nm}_thumb", 0.0145, (s * 0.082, -0.016, SHZ - 0.212), SK, seg=8, rings=6, scale=(1.0, 1.0, 1.35), rot=(0, s * -0.35, 0))
        am = join([cap, slv, cuff, hand, thumb], f"{nm}_mesh"); parent(am, sh)
        if s == 1:
            p = empty("pt_hand", (s * 0.108, -0.01, SHZ - 0.225)); parent(p, sh)

    # ── job accessories ──
    # the apron wraps the front of the body and ties at the waist
    apr = [arc_panel("ap_skirt", 0.114, 0.116, 0.1, 0.335, 1.2, AP), arc_panel("ap_bib", 0.1, 0.104, 0.335, 0.47, 0.72, AP),
           cyl("ap_tie", 0.112, 0.112, 0.024, (0, 0, 0.322), AP, seg=16, smooth=True),
           box("ap_bow", (0.05, 0.02, 0.03), (0, 0.115, 0.322), AP, bev=0.008),
           box("ap_pocket", (0.05, 0.012, 0.035), (0, -0.118, 0.2), BE, bev=0.004)]
    o = join(apr, "apron"); parent(o, body)
    pack = [cyl("pk_basket", 0.075, 0.06, 0.15, (0, 0.12, 0.33), WI, seg=10, bev=0.012),
            cyl("pk_rim", 0.08, 0.08, 0.02, (0, 0.12, 0.475), BE, seg=10),
            box("pk_strapL", (0.018, 0.17, 0.018), (-0.05, 0.03, 0.47), BE),
            box("pk_strapR", (0.018, 0.17, 0.018), (0.05, 0.03, 0.47), BE)]
    o = join(pack, "pack"); parent(o, body)
    scarf = [cyl("sc_ring", 0.07, 0.065, 0.05, (0, 0, NECK_Z - 0.045), WN, seg=14, bev=0.018, segs=2, smooth=True),
             box("sc_tail", (0.04, 0.02, 0.14), (0.05, -0.07, NECK_Z - 0.17), WN, bev=0.008, rot=(0.15, 0, 0.3)),
             box("sc_back1", (0.045, 0.02, 0.17), (-0.025, 0.095, NECK_Z - 0.17), WN, bev=0.008, rot=(-0.2, 0, -0.1)),
             box("sc_back2", (0.04, 0.02, 0.13), (0.03, 0.1, NECK_Z - 0.14), WN, bev=0.008, rot=(-0.25, 0, 0.15))]
    for k in range(2): scarf.append(box(f"sc_fringe{k}", (0.047, 0.022, 0.018), (-0.025 + k * 0.055, 0.115, NECK_Z - 0.26 + k * 0.04), WC))
    o = join(scarf, "scarf"); parent(o, body)

    # Optional peoples and ceremonial clothes. The game selects these by node name.
    HO = material("horn", 0x463530, True)
    TO = material("tooth", 0xfff4da, True)
    RO = material("robe", 0x6043a5, True)
    ST = material("star", 0xe9bd48, True)
    GE = material("gem", 0x7ed9df, True)
    def head_part(name, parts):
        obj = join(parts, name)
        rotate_about(obj, NECK, TILT); parent(obj, head)
        return obj
    # Race parts are chunky on purpose: at the game camera a villager is ~40 px
    # tall, so ears, beards and horns must change the silhouette. Each part is
    # sized around its own attachment point (grow) and kept clear of the dot
    # eyes as seen from the high camera.
    for name, L, H, T, up, back, tipw in (("race_elf", 0.165, 0.036, 0.014, 0.62, 0.36, 0.0),
                                          ("race_gnome", 0.105, 0.046, 0.017, 0.3, 0.3, 0.28)):
        ears = []
        for side in (-1, 1):
            r0 = Vector((side * 0.08, 0.012, hz + 0.004))
            d = Vector((side * math.cos(up) * math.cos(back), math.cos(up) * math.sin(back), math.sin(up)))
            mid = r0 + d * (L * 0.45) - Vector((0, 0, L * 0.06))         # the ear sweeps up toward its tip
            prof = (lambda u, H=H, T=T, tipw=tipw: (H * leaf(u, tipw), T * (0.6 + 0.4 * leaf(u, 0.5))))
            ears.append(tube(f"{name}{side}", [r0, mid, r0 + d * L], prof, SK, seg=10, steps=5))
        if name == "race_gnome":
            # gnomes also get a big round button nose, sitting low so it never hides the eyes
            ears.append(uvsphere("gnomenose", 0.029, (0, -0.108, hz - 0.034), SK, seg=12, rings=8, scale=(1.05, 0.95, 0.92)))
        head_part(name, ears)
    # dwarf beard: a full chin mass running down onto the chest, cheek puffs up to
    # the sideburns and a drooping moustache, all kept below the eyes
    beard = [uvsphere("beardchin", 0.06, (0, -0.066, hz - 0.112), HA, seg=14, rings=10, scale=(1.32, 0.86, 1.4)),
             uvsphere("beardpoint", 0.042, (0, -0.074, hz - 0.19), HA, seg=12, rings=8, scale=(1.1, 0.8, 1.25))]
    for side in (-1, 1):
        beard.append(uvsphere(f"beardcheek{side}", 0.04, (side * 0.068, -0.05, hz - 0.068), HA, seg=10, rings=8, scale=(0.85, 0.95, 1.3)))
        beard.append(uvsphere(f"beardburn{side}", 0.026, (side * 0.087, -0.008, hz - 0.03), HA, seg=10, rings=7, scale=(0.75, 1.3, 1.7)))
        beard.append(tube(f"moustache{side}", [(side * 0.004, -0.112, hz - 0.042), (side * 0.03, -0.11, hz - 0.048), (side * 0.055, -0.098, hz - 0.068)],
                          lambda u: (0.011 * (1 - 0.6 * u), 0.012 * (1 - 0.5 * u)), HA, seg=8, steps=4))
    head_part("race_beard", beard)
    # orc tusks jut up from the lower jaw and out past the eyes
    tusks = []
    for side in (-1, 1):
        b0 = Vector((side * 0.031, -0.09, hz - 0.064))
        tusks.append(tube(f"tusk{side}", [b0, b0 + Vector((side * 0.013, -0.012, 0.024)), b0 + Vector((side * 0.034, -0.016, 0.05))],
                          lambda u: (0.017 * (1 - 0.86 * u),) * 2, TO, seg=8, steps=4))
    head_part("race_tusks", tusks)
    # tiefling horns: thick at the root, curling up, back and down like a ram's
    horns = []
    for side in (-1, 1):
        pts = [(0.04, -0.012, 0.07), (0.068, -0.005, 0.118), (0.1, 0.028, 0.152), (0.132, 0.072, 0.15), (0.146, 0.106, 0.118), (0.132, 0.112, 0.082)]
        horns.append(tube(f"horn{side}", [(side * x, y, hz + z) for x, y, z in pts], lambda u: (0.025 * (1 - 0.85 * u),) * 2, HO, seg=10, steps=5))
    head_part("race_horns", horns)
    # dragonborn: a long muzzle that dips forward (below the eye line from above),
    # swept-back horns, a ridge of crest spikes and webbed cheek frills
    # the muzzle: a broad, flat-topped jaw that stays below the eye line from the
    # high camera, with a narrow ridge running up between the eyes to the brow
    snout = [uvsphere("dragonjaw", 0.05, (0, -0.045, hz - 0.056), SK, seg=14, rings=9, scale=(1.5, 1.1, 0.75)),
             uvsphere("dragonmuzzle", 0.03, (0, -0.106, hz - 0.074), SK, seg=14, rings=9, scale=(1.55, 1.65, 0.78)),
             tube("dragonridge", [(0, -0.084, hz + 0.004), (0, -0.11, hz - 0.03), (0, -0.13, hz - 0.058)],
                  lambda u: (0.015 + 0.006 * u, 0.014 + 0.016 * u), SK, seg=10, steps=4)]
    for side in (-1, 1):
        snout.append(uvsphere(f"nostril{side}", 0.0065, (side * 0.014, -0.149, hz - 0.06), EY, seg=7, rings=4))
        snout.append(tube(f"dragoncrest{side}", [(side * 0.052, 0.0, hz + 0.075), (side * 0.07, 0.05, hz + 0.108), (side * 0.082, 0.118, hz + 0.122)],
                          lambda u: (0.022 * (1 - 0.88 * u),) * 2, HO, seg=8, steps=4))
        # a cheek frill: a scalloped fan of three spines sweeping back from the jaw
        out = []
        for k, (ang, L) in enumerate(((0.95, 0.082), (0.32, 0.092), (-0.32, 0.078))):
            out.append((math.cos(ang) * L, math.sin(ang) * L))
            if k < 2:
                a2 = ang - 0.32; out.append((math.cos(a2) * 0.05, math.sin(a2) * 0.05))
        outline = [(0.0, -0.024)] + out[::-1] + [(0.0, 0.028)]
        fr = poly_extrude(f"frill{side}", [(side * x, z) for x, z in outline][::side], 0.009, (0, 0, 0), HO)
        fr.rotation_euler = (0, 0, side * 0.62); fr.location = (side * 0.075, 0.018, hz - 0.03)
        snout.append(fr)
    # a ridge of crest spikes down the middle of the (hairless) head
    for k, (y, z, h, t) in enumerate(((-0.035, 0.1, 0.064, 0.35), (0.025, 0.104, 0.06, 0.6), (0.075, 0.082, 0.05, 0.9), (0.105, 0.04, 0.04, 1.2))):
        sp = cyl(f"dragonspike{k}", 0.021, 0.0, h, (0, y, hz + z), HO, seg=8, rot=(t, 0, 0)); sp.scale = (0.6, 1.0, 1.0)
        snout.append(sp)
    head_part("race_snout", snout)
    # a thick tail curling up at the end, with a spade tip
    tp = [(0, 0.07, 0.28), (0.012, 0.165, 0.205), (0.05, 0.245, 0.135), (0.1, 0.29, 0.14), (0.135, 0.3, 0.21), (0.142, 0.27, 0.285)]
    tail = [tube("tailrope", tp, lambda u: (0.027 * (1 - 0.5 * u),) * 2, SK, seg=10, steps=4)]
    end = Vector(tp[-1]); dv = (end - Vector(tp[-2])).normalized()
    tail.append(tube("tailspade", [end - dv * 0.01, end + dv * 0.03, end + dv * 0.062], lambda u: (0.036 * leaf(u, 0.0, 0.15), 0.008), SK, seg=8, steps=4,
                     up=(1, 0, 0)))
    obj = join(tail, "race_tail"); parent(obj, body)
    # ── bandit mask: a dark cloth band over the eyes with two eye holes, knotted at
    # the back with two loose tails. Sits over the face, then flares over the hair
    # at the sides; tilted with the head like the hats. The game shows it at night.
    MK = material("mask", 0x2a2a36, True)
    band = mask_band("mask_band", hz, MK); mask = [band]
    knot = (0, 0.126, hz + 0.01)
    mask.append(uvsphere("mask_knot", 0.019, knot, MK, seg=10, rings=7, scale=(1.2, 0.8, 1.0)))
    for side in (-1, 1):
        mask.append(tube(f"mask_tail{side}", [knot, (side * 0.02, knot[1] + 0.018, hz - 0.03), (side * 0.042, knot[1] + 0.026, hz - 0.08)],
                         lambda u: (0.004, 0.012 * (1 + 0.3 * u)), MK, seg=8, steps=4, up=(0, 1, 0)))
    head_part("mask", mask)
    hat = [cyl("archbrim", 0.125, 0.125, 0.014, (0, 0.018, hz + 0.09), RO, seg=18, smooth=True),
           cyl("archcone", 0.007, 0.075, 0.22, (0, 0.019, hz + 0.098), RO, seg=14, smooth=True),
           cyl("archband", 0.071, 0.074, 0.025, (0, 0.019, hz + 0.115), ST, seg=14)]
    for k in range(3):
        hat.append(sphere(f"archstar{k}", 0.008, (-0.03 + k * 0.025, -0.029, hz + 0.17 + k * 0.032), ST, sub=1))
    head_part("hat_archmage", hat)
    crown = [cyl("crownring", 0.098, 0.098, 0.023, (0, 0, hz + 0.075), ST, seg=16)]
    for k in range(7):
        a = k / 7 * math.pi * 2
        crown.append(cyl(f"crownpoint{k}", 0.001, 0.017, 0.054, (math.cos(a) * 0.088, math.sin(a) * 0.088, hz + 0.09), ST, seg=6))
    crown.append(sphere("crowngem", 0.013, (0, -0.102, hz + 0.093), GE, sub=1))
    head_part("hat_crown", crown)
    chain = []
    for k in range(11):
        a = -math.pi / 2 + (k - 5) * 0.15
        chain.append(sphere(f"chainlink{k}", 0.01, (math.cos(a) * 0.092, math.sin(a) * 0.092, 0.42 + abs(k - 5) * 0.009), ST, sub=1))
    chain.append(sphere("chainmedal", 0.025, (0, -0.098, 0.397), ST, sub=1, scale=(1, 0.3, 1)))
    obj = join(chain, "chain"); parent(obj, body)
    robe = [cyl("robecloth", 0.085, 0.14, 0.37, (0, 0, 0.1), RO, seg=16, smooth=True),
            arc_panel("robestole", 0.094, 0.145, 0.095, 0.47, 0.19, ST, t=0.004)]
    obj = join(robe, "robe"); parent(obj, body)
    return root
