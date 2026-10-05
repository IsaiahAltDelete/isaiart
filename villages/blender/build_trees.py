# Forest trees. ~5000 are instanced, so each stays near 100 triangles.
# Leaves must be green (the game tints them per season by vertex colour).
import math, random

SNOWT = None
def _snowt():
    return material("snowcap", 0xf4f7fb, True)

def star_cone(name, r, h, z, mat, seg=8, dent=0.78, rot=0.0, droop=0.04):
    bm = bmesh.new()
    ring = []
    for k in range(seg):
        a = k / seg * math.pi * 2 + rot
        rr = r * (1 if k % 2 == 0 else dent)
        ring.append(bm.verts.new((math.cos(a) * rr, math.sin(a) * rr, z - (droop if k % 2 == 0 else 0))))
    tip = bm.verts.new((0, 0, z + h))
    cen = bm.verts.new((0, 0, z + 0.02))
    for k in range(seg):
        a, b = ring[k], ring[(k + 1) % seg]
        bm.faces.new((a, b, tip)); bm.faces.new((b, a, cen))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return _obj(name, bm, mat)

def build_tree_pine():
    """Three drooping skirts whose points curl up at the tips."""
    global SNOWT; SNOWT = _snowt()
    T = material("bark", 0x7a4e2c); L1 = material("leaf", 0x2f7d3a); L2 = material("leaf2", 0x3f9646)
    root = empty("tree_pine", (0, 0, 0)); P = []
    P.append(cyl("trunk", 0.1, 0.06, 0.5, (0, 0, 0), T, seg=5))
    P.append(cyl("flare", 0.15, 0.08, 0.08, (0, 0, 0), T, seg=5))
    tiers = [(0.66, 0.46, 0.34), (0.52, 0.42, 0.66), (0.37, 0.4, 0.96), (0.22, 0.34, 1.22)]
    for k, (r, h, z) in enumerate(tiers):
        # negative droop: the star points lift, like a skirt flicking up at the hem
        P.append(star_cone(f"t{k}", r, h, z, L1 if k % 2 == 0 else L2, dent=0.66, rot=k * 0.4, droop=-0.07))
        P.append(star_cone(f"s{k}", r * 0.62, h * 0.62, z + h * 0.4 + 0.012, SNOWT, dent=0.7, rot=k * 0.4, droop=-0.03))   # winter-only cap
    o = join(P, "tree"); parent(o, root)
    return root

def lobe(name, r, loc, mat, scale=(1, 1, 0.92), rot=(0, 0, 0)):
    """A soft canopy puff: a smooth sphere with enough sides for a round outline."""
    return uvsphere(name, r, loc, mat, seg=11, rings=6, scale=scale, smooth=True, rot=rot)

def round_tree(name, lobes, trunk_h=0.68, fork=None):
    global SNOWT; SNOWT = _snowt()
    T = material("bark", 0x7a4e2c); L1 = material("leaf", 0x56a83c, True); L2 = material("leaf2", 0x65b744, True)
    root = empty(name, (0, 0, 0)); P = []
    P.append(cyl("trunk", 0.1, 0.07, trunk_h, (0, 0, 0), T, seg=5))
    P.append(cyl("flare", 0.17, 0.09, 0.1, (0, 0, 0), T, seg=5))
    for k, (x, y, z, ry) in enumerate(fork or [(0.0, 0, 0.5, 0.7)]):
        P.append(cyl(f"b{k}", 0.05, 0.03, 0.34, (x, y, z), T, seg=4, rot=(0, ry, k * 2.1)))
    for k, (x, y, z, r) in enumerate(lobes):
        P.append(lobe(f"c{k}", r, (x, y, z), L1 if k % 2 == 0 else L2, rot=(k * 0.6, k * 0.9, 0)))
        P.append(uvsphere(f"sc{k}", r * 1.075, (x, y, z), SNOWT, seg=11, rings=6, scale=(1, 1, 0.95), smooth=True, cut=0.2))   # winter-only cap
    o = join(P, "tree"); parent(o, root)
    return root

def build_tree_round():
    """The classic: three puffs."""
    return round_tree("tree_round", [(-0.05, 0.06, 1.08, 0.4), (0.24, -0.08, 0.86, 0.36), (-0.24, -0.14, 0.84, 0.35)])

def build_tree_round2():
    """Tall: two stacked puffs on a longer trunk."""
    return round_tree("tree_round2", [(0.0, 0.0, 0.98, 0.38), (0.05, 0.04, 1.42, 0.3)], trunk_h=0.8)

def build_tree_round3():
    """Wide and low with a forked trunk: four puffs."""
    return round_tree("tree_round3", [(-0.28, 0.0, 0.86, 0.34), (0.26, 0.04, 0.84, 0.33), (0.0, -0.18, 0.98, 0.34), (0.02, 0.2, 1.06, 0.3)],
                      trunk_h=0.55, fork=[(0.0, 0, 0.45, 0.75), (0.0, 0, 0.45, -0.75)])

def build_tree_pine2():
    """A slender fir: five narrower skirts."""
    global SNOWT; SNOWT = _snowt()
    T = material("bark", 0x7a4e2c); L1 = material("leaf", 0x2f7d3a); L2 = material("leaf2", 0x3f9646)
    root = empty("tree_pine2", (0, 0, 0)); P = []
    P.append(cyl("trunk", 0.08, 0.05, 0.5, (0, 0, 0), T, seg=5))
    P.append(cyl("flare", 0.13, 0.07, 0.07, (0, 0, 0), T, seg=5))
    for k, (r, h, z) in enumerate([(0.5, 0.4, 0.32), (0.42, 0.38, 0.6), (0.34, 0.36, 0.88), (0.25, 0.34, 1.14), (0.15, 0.32, 1.38)]):
        P.append(star_cone(f"t{k}", r, h, z, L1 if k % 2 == 0 else L2, seg=7, dent=0.68, rot=k * 0.5, droop=-0.06))
        P.append(star_cone(f"s{k}", r * 0.62, h * 0.62, z + h * 0.4 + 0.012, SNOWT, seg=7, dent=0.72, rot=k * 0.5, droop=-0.03))
    o = join(P, "tree"); parent(o, root)
    return root
