# The dragon: a storybook flier for the "dragon attack" event. Faces -Y like the
# beasts; the origin is the centre of the body (it never stands on the ground).
# Pivot nodes the game animates (plain names, like the beasts' leg0..leg3):
#   body             the whole creature (bob / bank)
#   wingL / wingR    shoulders; wingL is the dragon's own left (-X), wingR is +X
#                    (same sides as the villager's armL / armR). Flap = rotate about
#                    the body's long axis (three.js Z).
#   neck             neck base; carries the head, the jaw and pt_mouth
#   jaw              jaw hinge (rotate about X to open)
#   tail             tail base
#   pt_mouth         mouth tip, where fire comes out
import math
from mathutils import Vector, Matrix

def _dragon_mats():
    M = dict(body=material("body", 0xbf3934, True), belly=material("belly", 0xf4e2b4, True),
             horn=material("horn", 0x3b2b2e, True), wing=material("wing", 0xec8b72),
             eye=material("eye", 0xffe14a, True), mouth=material("mouth", 0x5a1820, True),
             tooth=material("tooth", 0xfaf3e0, True))
    e = M["eye"].node_tree.nodes.get("Principled BSDF")
    if e:   # preview only: the game draws the eye slot unlit
        e.inputs["Emission Color"].default_value = (1.0, 0.75, 0.1, 1); e.inputs["Emission Strength"].default_value = 2.5
    return M

def _crspline(pts, steps=6):
    """Sample a Catmull-Rom curve through pts (like vkit.tube) -> list of Vectors."""
    P = [Vector(p) for p in pts]; n = len(P); S = []
    for i in range(n - 1):
        p0 = P[i - 1] if i > 0 else P[0] * 2 - P[1]
        p3 = P[i + 2] if i + 2 < n else P[-1] * 2 - P[-2]
        p1, p2 = P[i], P[i + 1]
        for k in range(steps):
            t = k / steps; t2 = t * t; t3 = t2 * t
            S.append(0.5 * ((2 * p1) + (p2 - p0) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (3 * p1 - p0 - 3 * p2 + p3) * t3))
    S.append(P[-1].copy())
    return S

def _along(pts, u):
    """Point and tangent at fraction u (by arc length) of the spline through pts."""
    S = _crspline(pts); acc = [0.0]
    for i in range(1, len(S)): acc.append(acc[-1] + (S[i] - S[i - 1]).length)
    d = u * acc[-1]
    for i in range(1, len(S)):
        if acc[i] >= d:
            t = (d - acc[i - 1]) / max(1e-6, acc[i] - acc[i - 1])
            return S[i - 1].lerp(S[i], t), (S[i] - S[i - 1]).normalized()
    return S[-1], (S[-1] - S[-2]).normalized()

def _spike(name, pos, tang, size, mat, lean=0.6):
    """A dorsal spike standing on pos, leaning back along the tangent."""
    up = Vector((0, 0, 1)); back = tang.normalized()
    d = (up * math.cos(lean) + back * math.sin(lean)).normalized()
    o = cyl(name, size * 0.6, 0.0, size, (0, 0, 0), mat, seg=4, smooth=False)
    o.data.transform(Matrix.Diagonal((0.4, 1.0, 1.0, 1.0)))   # a thin fin along the spine
    o.rotation_mode = "QUATERNION"
    o.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(d)
    o.location = pos - d * size * 0.25
    return o

def _sheet(name, outline, mat, thick=0.03):
    """A thin solid membrane through a (non-planar) outline loop."""
    import bmesh as _bm
    bm = _bm.new()
    vs = [bm.verts.new(p) for p in outline]
    f = bm.faces.new(vs)
    _bm.ops.triangulate(bm, faces=[f], quad_method="BEAUTY", ngon_method="EAR_CLIP")
    _bm.ops.recalc_face_normals(bm, faces=bm.faces)
    o = _obj(name, bm, mat)
    m = o.modifiers.new("solid", "SOLIDIFY"); m.thickness = thick; m.offset = 0.0
    return o

def _wing(s, M):
    """One wing on side s (+1 = +X). Returns the parts (world space)."""
    X = lambda p: (p[0] * s, p[1], p[2])
    S0 = (0.2, -0.26, 0.16); E = (0.82, -0.5, 0.44); W = (1.42, -0.32, 0.58)
    tips = [(2.25, 0.0, 0.62), (2.05, 0.62, 0.48), (1.56, 1.02, 0.32), (0.98, 1.02, 0.16)]
    R = (0.24, 0.5, 0.06)
    def scallop(a, b, k=0.4):
        a, b, w = Vector(a), Vector(b), Vector(W)
        m = (a + b) / 2
        m = m.lerp(w, k); m.z -= 0.05
        return tuple(m)
    out = [S0, E, W, tips[0]]
    for i in range(1, len(tips)):
        out += [scallop(tips[i - 1], tips[i]), tips[i]]
    out += [scallop(tips[-1], R, 0.18), R]
    P = [_sheet(f"memb{s}", [X(p) for p in out], M["wing"])]
    # arm bone along the leading edge, a thumb claw at the wrist
    P.append(tube(f"arm{s}", [X((0.08, -0.22, 0.1)), X(S0), X(E), X(W), X(tips[0])],
                  lambda u: (0.085 * (1 - u) + 0.02, 0.075 * (1 - u) + 0.02), M["body"], seg=8, steps=4))
    P.append(uvsphere(f"wrist{s}", 0.07, X(W), M["body"], seg=8, rings=6))
    P.append(tube(f"thumb{s}", [X(W), X((W[0] + 0.05, W[1] - 0.14, W[2] + 0.04)), X((W[0] + 0.02, W[1] - 0.24, W[2] + 0.0))],
                  lambda u: (0.035 * (1 - u) + 0.01, 0.035 * (1 - u) + 0.01), M["horn"], seg=6, steps=3))
    for i, t in enumerate(tips[1:]):
        mid = Vector(W).lerp(Vector(t), 0.5); mid.z += 0.04
        P.append(tube(f"fing{s}{i}", [X(W), X(tuple(mid)), X(t)], lambda u: (0.03 * (1 - u) + 0.012, 0.03 * (1 - u) + 0.012),
                      M["body"], seg=6, steps=3))
    return P

def build_dragon():
    M = _dragon_mats()
    root = empty("dragon", (0, 0, 0))
    body = empty("body", (0, 0, 0)); parent(body, root)

    # ── torso, belly, tucked legs, back spikes ──
    B = [uvsphere("torso", 0.37, (0, 0.08, 0.0), M["body"], seg=16, rings=10, scale=(1.0, 1.75, 0.9)),
         uvsphere("chest", 0.33, (0, -0.32, 0.05), M["body"], seg=14, rings=9, scale=(1.0, 1.0, 0.98)),
         uvsphere("bellyplate", 0.33, (0, 0.0, -0.09), M["belly"], seg=14, rings=8, scale=(0.84, 1.75, 0.68)),
         uvsphere("chestplate", 0.29, (0, -0.38, -0.08), M["belly"], seg=12, rings=8, scale=(0.9, 0.95, 0.85))]
    for s in (-1, 1):
        # hind leg folded back under the belly
        B.append(uvsphere(f"thigh{s}", 0.17, (s * 0.25, 0.42, -0.1), M["body"], seg=12, rings=8, scale=(0.62, 1.25, 0.85)))
        B.append(tube(f"shin{s}", [(s * 0.25, 0.44, -0.18), (s * 0.23, 0.66, -0.24), (s * 0.2, 0.86, -0.22)],
                      lambda u: (0.075 - 0.03 * u, 0.065 - 0.025 * u), M["body"], seg=8, steps=3))
        for k in (-1, 0, 1):
            B.append(cyl(f"hclaw{s}{k}", 0.022, 0.0, 0.09, (s * 0.2 + k * 0.035, 0.86, -0.22), M["horn"], seg=4, rot=(-1.9, 0, k * 0.3)))
        # small front arm tucked against the chest
        B.append(tube(f"farm{s}", [(s * 0.22, -0.36, -0.06), (s * 0.24, -0.42, -0.24), (s * 0.17, -0.6, -0.26)],
                      lambda u: (0.065 - 0.025 * u, 0.06 - 0.02 * u), M["body"], seg=8, steps=3))
        for k in (-1, 0, 1):
            B.append(cyl(f"fclaw{s}{k}", 0.018, 0.0, 0.07, (s * 0.17 + k * 0.03, -0.6, -0.26), M["horn"], seg=4, rot=(-1.25, 0, k * 0.3)))
    for k in range(5):
        y = -0.42 + k * 0.24
        z = 0.28 * math.sqrt(max(0.0, 1 - ((y - 0.06) / 0.63) ** 2)) + 0.02
        if y < -0.25: z = max(z, 0.27)
        B.append(_spike(f"bsp{k}", Vector((0, y, z)), Vector((0, 1, -0.1 * (k - 2))), 0.24 - abs(k - 1.5) * 0.02, M["horn"]))
    bm = join(B, "body_mesh"); parent(bm, body)

    # ── wings: pivots at the shoulders ──
    for s, nm in ((-1, "wingL"), (1, "wingR")):
        piv = empty(nm, (s * 0.2, -0.26, 0.14)); parent(piv, body)
        w = join(_wing(s, M), f"{nm}_mesh"); parent(w, piv)

    # ── tail ──
    tpts = [(0, 0.5, 0.02), (0, 0.9, 0.04), (0, 1.3, 0.1), (0, 1.62, 0.2), (0, 1.86, 0.32)]
    tp = empty("tail", (0, 0.58, 0.03)); parent(tp, body)
    T = [tube("tailtube", tpts, lambda u: (0.2 * (1 - u) ** 0.9 + 0.025, 0.21 * (1 - u) ** 0.9 + 0.025), M["body"], seg=10, steps=4),
         tube("tailbelly", [(0, 0.55, -0.06), (0, 0.9, -0.04), (0, 1.25, 0.02)], lambda u: (0.13 * (1 - u) + 0.02, 0.15 * (1 - u) + 0.02),
              M["belly"], seg=8, steps=3)]
    for k in range(5):
        u = 0.1 + k * 0.17
        p, t = _along(tpts, u)
        r = 0.2 * (1 - u) ** 0.9 + 0.025
        T.append(_spike(f"tsp{k}", p + Vector((0, 0, r * 0.85)), t, 0.2 - k * 0.025, M["horn"]))
    # spade tip
    tip, td = _along(tpts, 1.0)
    spade = [(0, -0.06, 0), (0.19, 0.08, 0.03), (0.05, 0.12, 0.05), (0, 0.34, 0.12), (-0.05, 0.12, 0.05), (-0.19, 0.08, 0.03)]
    T.append(_sheet("spade", [tuple(tip + Vector(v)) for v in spade], M["horn"], thick=0.03))
    tm = join(T, "tail_mesh"); parent(tm, tp)

    # ── neck + head (the neck pivot carries the head, jaw and mouth point) ──
    npts = [(0, -0.28, 0.04), (0, -0.6, 0.2), (0, -0.86, 0.4), (0, -1.02, 0.5)]
    nk = empty("neck", (0, -0.44, 0.1)); parent(nk, body)
    H = [tube("necktube", npts, lambda u: (0.25 - 0.08 * u, 0.23 - 0.07 * u), M["body"], seg=10, steps=4),
         tube("neckbelly", [(0, -0.42, -0.06), (0, -0.62, 0.09), (0, -0.86, 0.29), (0, -0.98, 0.4)], lambda u: (0.17 - 0.05 * u, 0.16 - 0.05 * u),
              M["belly"], seg=8, steps=3),
         uvsphere("skull", 0.26, (0, -1.06, 0.57), M["body"], seg=14, rings=10, scale=(1.0, 1.05, 0.85)),
         uvsphere("snout", 0.17, (0, -1.32, 0.5), M["body"], seg=12, rings=8, scale=(0.92, 1.55, 0.64)),
         uvsphere("mouthin", 0.11, (0, -1.34, 0.4), M["mouth"], seg=10, rings=6, scale=(0.85, 1.5, 0.45))]
    for k in range(3):
        u = 0.22 + k * 0.27
        p, t = _along(npts, u)
        H.append(_spike(f"nsp{k}", p + Vector((0, 0, 0.19 - 0.06 * u)), -t, 0.17, M["horn"]))
    for s in (-1, 1):
        H.append(uvsphere(f"brow{s}", 0.085, (s * 0.13, -1.19, 0.7), M["body"], seg=8, rings=6, scale=(1.0, 1.6, 0.5), rot=(0.25, s * -0.35, 0)))
        H.append(uvsphere(f"eye{s}", 0.085, (s * 0.165, -1.23, 0.635), M["eye"], seg=10, rings=6, scale=(0.75, 1.0, 0.8)))
        H.append(uvsphere(f"nost{s}", 0.025, (s * 0.06, -1.56, 0.56), M["horn"], seg=6, rings=4))
        H.append(tube(f"horn{s}", [(s * 0.12, -1.05, 0.7), (s * 0.17, -0.9, 0.85), (s * 0.22, -0.7, 0.94), (s * 0.25, -0.54, 0.92)],
                      lambda u: (0.07 * (1 - u) + 0.006, 0.065 * (1 - u) + 0.006), M["horn"], seg=8, steps=4))
        H.append(tube(f"cheek{s}", [(s * 0.22, -1.03, 0.5), (s * 0.32, -0.93, 0.5), (s * 0.4, -0.83, 0.54)],
                      lambda u: (0.035 * (1 - u) + 0.005, 0.03 * (1 - u) + 0.005), M["horn"], seg=6, steps=3))
        H.append(cyl(f"fang{s}", 0.022, 0.0, 0.07, (s * 0.08, -1.46, 0.43), M["tooth"], seg=5, rot=(math.pi, 0, 0)))
    hm = join(H, "head_mesh"); parent(hm, nk)

    # jaw: hinge under the ear, mouth slightly open at rest
    hinge = (0, -1.06, 0.42)
    jw = empty("jaw", hinge); parent(jw, nk)
    J = [uvsphere("jawbone", 0.13, (0, -1.3, 0.37), M["body"], seg=12, rings=7, scale=(0.9, 1.75, 0.42)),
         uvsphere("chin", 0.11, (0, -1.27, 0.34), M["belly"], seg=10, rings=6, scale=(0.85, 1.6, 0.4))]
    for s in (-1, 1):
        J.append(cyl(f"lfang{s}", 0.016, 0.0, 0.05, (s * 0.06, -1.44, 0.38), M["tooth"], seg=4))
    jm = join(J, "jaw_mesh")
    rotate_about(jm, hinge, (0.22, 0, 0))
    parent(jm, jw)

    pm = empty("pt_mouth", (0, -1.56, 0.44)); parent(pm, nk)
    return root
