# Storybook villager: ~4 heads tall, a normal-sized head with dot eyes, a real
# torso, arms and legs, boots. (The client turned down the chibi version.)
# Node layout (names matter to js/models.js):
#   villager
#     body            (empty; sleeping rotates it)
#       torso         shirt / pants / belt / neck
#       head          skin, eyes, brows, nose, ears  (pivot at the neck)
#         hair_short, hair_bob, hair_bun, hair_tails, hair_tuft, hair_long, hair_elder
#         hat_straw, hat_cap, hat_toque, hat_helmet, hat_bucket, hat_hood, hat_band, hat_beanie
#       hipL / hipR   (pivots)  leg + boot
#       armL / armR   (pivots)  sleeve + hand;  pt_hand on the right arm
#       apron, pack, scarf      (toggled by the game)
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
    torso = join([t_shirt, t_hem, t_hips, t_belt, t_buckle, neck, collar], "torso"); parent(torso, body)

    # head: a slightly tall egg; small dot eyes, brows, a little nose; pivot at the neck
    head = empty("head", (0, 0, NECK_Z)); parent(head, body)
    hx, hy, hz = HEAD_C
    skull = uvsphere("h_skull", HEAD_R, HEAD_C, SK, seg=16, rings=10, scale=(0.95, 0.95, 1.06))
    ears = [sphere(f"h_ear{s}", 0.02, (s * 0.085, 0.004, hz - 0.004), SK, sub=1, scale=(0.55, 0.9, 1.2), smooth=True) for s in (-1, 1)]
    fy = -HEAD_R * 0.93
    face = []
    for sx in (-1, 1):
        face.append(uvsphere(f"h_eye{sx}", 0.0145, (sx * 0.033, fy + 0.007, hz + 0.008), EY, seg=8, rings=5, scale=(0.8, 0.5, 1.2)))
        face.append(box(f"h_brow{sx}", (0.03, 0.01, 0.01), (sx * 0.034, fy + 0.004, hz + 0.034), HA, base=False, rot=(0, sx * -0.14, 0)))
    face.append(uvsphere("h_nose", 0.014, (0, fy - 0.006, hz - 0.012), SK, seg=8, rings=6, scale=(0.9, 1.0, 1.15)))
    face.append(box("h_mouth", (0.024, 0.006, 0.005), (0, fy + 0.012, hz - 0.04), material("lip", 0x9a5a48), base=False))
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
        boot = box(f"{nm}_boot", (0.072, 0.118, 0.066), (s * 0.045, -0.018, 0.0), BO, bev=0.024, segs=2)
        cuff = cyl(f"{nm}_bcuff", 0.036, 0.036, 0.02, (s * 0.044, 0, 0.055), BO, seg=10, smooth=True)
        lg = join([leg, boot, cuff], f"{nm}_mesh"); parent(lg, hip)

    # ── arms (shoulder pivots) ──
    SHZ = NECK_Z - 0.04
    for s, nm in ((-1, "armL"), (1, "armR")):
        sh = empty(nm, (s * 0.108, 0, SHZ)); parent(sh, body)
        slv = cyl(f"{nm}_sleeve", 0.03, 0.037, 0.19, (s * 0.108, 0, SHZ - 0.19), SH, seg=10, bev=0.01, smooth=True)
        cuff = cyl(f"{nm}_cuff", 0.034, 0.034, 0.02, (s * 0.108, 0, SHZ - 0.197), SH, seg=10, smooth=True)
        hand = uvsphere(f"{nm}_hand", 0.037, (s * 0.108, -0.006, SHZ - 0.222), SK, seg=10, rings=8, scale=(0.85, 0.78, 1.08))   # a mitten
        am = join([slv, cuff, hand], f"{nm}_mesh"); parent(am, sh)
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
    return root
