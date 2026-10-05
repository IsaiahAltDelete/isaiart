# The village crest banner, raised when the village is promoted
# (Hamlet -> Village -> Town -> City). Faces -Y; ~3.1 tall on a small stone plinth.
# anim_flagMesh is the swivel at the top of the pole (a.flagMesh, waved about the
# pole by main.js like the buildings' flags); it carries the arm, the cloth and
# the emblem. Slots: banner (cloth), emblem, pole, stone, gold, leaf, flower.
import math

def _banner_wave(u, v, amp):
    """Front-to-back offset of the hanging cloth at (u across, v down)."""
    return amp * math.sin(u * math.pi * 2.3 + 0.3) * min(1.0, u * 4) * (0.35 + 0.65 * v)

def _banner_cloth(name, x0, x1, ztop, length, notch, t, amp, Mc, Mh):
    """A swallowtail cloth with gentle folds; a hem band (Mh) at the top and along the tails."""
    W = x1 - x0; nx = 14
    vs = [0.0, 0.045, 0.09] + [0.09 + (0.93 - 0.09) * k / 9 for k in range(1, 10)] + [1.0]
    bm = bmesh.new(); F, B = [], []
    for i in range(nx + 1):
        u = i / nx
        zb = ztop - length + notch * (1 - abs(2 * u - 1))
        cf, cb = [], []
        for v in vs:
            z = ztop + (zb - ztop) * v; y = _banner_wave(u, v, amp)
            cf.append(bm.verts.new((x0 + u * W, y - t / 2, z))); cb.append(bm.verts.new((x0 + u * W, y + t / 2, z)))
        F.append(cf); B.append(cb)
    nv = len(vs)
    def hem(j): return j == 0 or j == nv - 2
    for i in range(nx):
        for j in range(nv - 1):
            for G in (F, B):
                f = bm.faces.new((G[i][j], G[i + 1][j], G[i + 1][j + 1], G[i][j + 1]))
                f.material_index = 1 if hem(j) else 0
    for i in range(nx):   # top and bottom edges
        bm.faces.new((F[i][0], F[i + 1][0], B[i + 1][0], B[i][0])).material_index = 1
        bm.faces.new((F[i][-1], F[i + 1][-1], B[i + 1][-1], B[i][-1])).material_index = 1
    for i in (0, nx):     # side edges
        for j in range(nv - 1):
            bm.faces.new((F[i][j], F[i][j + 1], B[i][j + 1], B[i][j])).material_index = 1 if hem(j) else 0
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    o = _obj(name, bm, Mc, smooth=True)
    o.data.materials.append(Mh)
    return o

def _emblem_piece(name, pts, cx, cz, x0, W, ztop, length, amp, t, mat, side, mid=(0.0, 0.0)):
    """A flat emblem shape laid on the cloth's front (side -1) or back (+1), bent to follow
    its folds. pts must be star-shaped around mid (it is fanned from there)."""
    d = 0.008; R = []
    for k in range(len(pts)):   # resample long edges so the shape can bend
        a, b = pts[k], pts[(k + 1) % len(pts)]
        n = max(1, int(math.hypot(b[0] - a[0], b[1] - a[1]) / 0.025))
        R += [(a[0] + (b[0] - a[0]) * q / n, a[1] + (b[1] - a[1]) * q / n) for q in range(n)]
    def at(px, pz, off):
        u = (cx + px - x0) / W; v = (ztop - cz - pz) / length
        return (cx + px, _banner_wave(u, v, amp) + side * (t / 2 - 0.002 + off), cz + pz)
    bm = bmesh.new(); n = len(R); nr = 4
    # concentric rings from the rim (r=0) in to mid, front (off 0) and outer (off d) faces
    def ring(f, off):
        return [bm.verts.new(at(mid[0] + (px - mid[0]) * f, mid[1] + (pz - mid[1]) * f, off)) for px, pz in R]
    for off, flip in ((0, True), (d, False)):
        rs = [ring(1 - r / nr, off) for r in range(nr)]; c = bm.verts.new(at(mid[0], mid[1], off))
        for r in range(nr):
            for k in range(n):
                m = (k + 1) % n
                f = (rs[r][k], rs[r][m], c) if r == nr - 1 else (rs[r][k], rs[r][m], rs[r + 1][m], rs[r + 1][k])
                bm.faces.new(f[::-1] if flip else f)
        if off == 0: lo = rs[0]
        else: hi = rs[0]
    for k in range(n):
        m = (k + 1) % n
        bm.faces.new((lo[k], lo[m], hi[m], hi[k]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return _obj(name, bm, mat)

def _circle(r, n=14):
    return [(math.cos(k / n * 2 * math.pi) * r, math.sin(k / n * 2 * math.pi) * r) for k in range(n)]

def build_crestbanner():
    Bn = material("banner", 0x3f6fb0, True); Em = material("emblem", 0xf3d26b); Po = material("pole", 0x6b4428)
    St = material("stone", 0xb3ada2); Gd = material("gold", 0xf0b429, True); Lf = material("leaf", 0x5f9a3a); Fl = material("flower", 0xd9433b)
    root = empty("crestbanner", (0, 0, 0)); P = []
    # stone plinth, two tiers
    P.append(cyl("plinth", 0.34, 0.31, 0.14, (0, 0, 0), St, seg=8, bev=0.025, rot=(0, 0, math.pi / 8)))
    P.append(cyl("plinth2", 0.23, 0.2, 0.13, (0, 0, 0.14), St, seg=8, bev=0.02, rot=(0, 0, math.pi / 8)))
    P.append(cyl("socket", 0.075, 0.065, 0.06, (0, 0, 0.27), Gd, seg=10, bev=0.01))
    # pole and gold finial
    P.append(cyl("pole", 0.046, 0.038, 2.68, (0, 0, 0.28), Po, seg=8, smooth=False))
    P.append(cyl("band", 0.052, 0.052, 0.04, (0, 0, 1.25), Gd, seg=10))
    P.append(cyl("collar_top", 0.058, 0.05, 0.035, (0, 0, 2.94), Gd, seg=10))
    P.append(uvsphere("knob", 0.07, (0, 0, 3.03), Gd, seg=12, rings=8))
    P.append(cyl("spike", 0.04, 0.0, 0.16, (0, 0, 3.08), Gd, seg=8))
    # garland round the plinth: leaf clumps with red flowers
    for k in range(14):
        a = k / 14 * 2 * math.pi
        P.append(sphere(f"gl{k}", 0.065, (math.cos(a) * 0.235, math.sin(a) * 0.235, 0.17 + 0.012 * math.sin(a * 3)), Lf, sub=1, scale=(1.0, 1.0, 0.8)))
        if k % 2 == 0:
            P.append(sphere(f"gf{k}", 0.032, (math.cos(a + 0.2) * 0.29, math.sin(a + 0.2) * 0.29, 0.2), Fl if k % 4 == 0 else Gd, sub=1))
    body = join(P, "body"); parent(body, root)
    # the swivel: arm + cloth + emblem + tassels
    zt = 2.76
    swivel = empty("anim_flagMesh", (0, 0, zt)); parent(swivel, root)
    x0, x1, ztop, length, notch, t, amp = 0.075, 0.64, zt - 0.03, 1.32, 0.3, 0.026, 0.035
    W = x1 - x0; cx = (x0 + x1) / 2
    Q = [cyl("ring", 0.062, 0.062, 0.05, (0, 0, zt - 0.025), Gd, seg=10),
         cyl("arm", 0.024, 0.022, 0.66, (0.02, 0, zt), Po, seg=8, rot=(0, math.pi / 2, 0)),
         uvsphere("armend", 0.04, (0.7, 0, zt), Gd, seg=10, rings=7),
         _banner_cloth("cloth", x0, x1, ztop, length, notch, t, amp, Bn, Em)]
    # emblem: a round storybook tree on a little hill, a sun above it (both faces)
    ec = ztop - 0.6
    cloud = [(math.cos(k / 40 * 2 * math.pi) * 0.13 * (1 + 0.1 * math.cos(k / 40 * 12 * math.pi)),
              math.sin(k / 40 * 2 * math.pi) * 0.12 * (1 + 0.1 * math.cos(k / 40 * 12 * math.pi))) for k in range(40)]
    tree = [("canopy", cloud, 0.0, 0.04),
            ("trunk", [(-0.026, 0), (0.026, 0), (0.02, 0.12), (-0.02, 0.12)], 0.0, -0.2),
            ("hill", [(math.cos(a) * 0.17, math.sin(a) * 0.05) for a in [k / 10 * math.pi for k in range(11)]], 0.0, -0.215)]
    for k in range(8):   # sun rays: little diamonds round a disc
        a = k / 8 * 2 * math.pi
        tree.append((f"ray{k}", [(0, -0.022), (0.012, 0), (0, 0.022), (-0.012, 0)], math.cos(a) * 0.075, 0.33 + math.sin(a) * 0.075, a))
    tree.append(("sun", _circle(0.045, 12), 0.0, 0.33))
    for side in (-1, 1):
        for e in tree:
            nm, pts, ex, ez = e[:4]
            if len(e) > 4:   # rotate the ray outward
                a = e[4] - math.pi / 2
                pts = [(px * math.cos(a) - pz * math.sin(a), px * math.sin(a) + pz * math.cos(a)) for px, pz in pts]
            Q.append(_emblem_piece(f"{nm}{side}", pts, cx + ex, ec + ez, x0, W, ztop, length, amp, t, Em, side, mid=(0.0, 0.015) if nm == "hill" else (0.0, 0.06) if nm == "trunk" else (0.0, 0.0)))
    # gold tassels on the two tails
    zb = ztop - length
    for u in (0.0, 1.0):
        x = x0 + u * W; y = _banner_wave(u, 1.0, amp)
        Q.append(uvsphere(f"tb{u}", 0.03, (x, y, zb - 0.015), Gd, seg=8, rings=6))
        Q.append(cyl(f"tc{u}", 0.03, 0.012, 0.09, (x, y, zb - 0.11), Gd, seg=8, rot=(0, 0, 0)))
    flag = join(Q, "flag"); parent(flag, swivel)
    return root
