# Cottages: four archetypes, each with a two-storey version for level 3.
#   0 gablefront  tall gable facing the street, timber frame, porch
#   1 ell         side-gable house with a gable-front wing holding the door
#   2 townhouse   long side-gable house with a dormer; level 3 adds a jettied upper floor
#   3 stone       low stone cottage under a puffy thatch
# Footprint 2x2 tiles (keep inside +-0.95). Front faces -Y.
import math, random

def dormer(name, M, top, D, RH, over, x, rnd):
    """A little gable-front dormer sitting on the front slope of a side-gable roof."""
    yf = -D / 2 + 0.12
    zb = top + roof_z(yf, D, RH, over) - 0.08
    parts = [box(f"{name}_w", (0.38, 0.42, 0.34), (x, yf + 0.21, zb), M["wall"], bev=0.02)]
    parts += [gable_fill(f"{name}_g", M, 0.42, 0.38, 0.2, 0)]
    parts[-1].location = (x, yf + 0.21, zb + 0.34); parts[-1].rotation_euler = (0, 0, math.pi / 2)
    parts.append(gable_roof(f"{name}_r", 0.46, 0.38, 0.22, M, over=0.07, thick=0.06, rows=2, sag=0, loc=(x, yf + 0.18, zb + 0.34), rot_z=math.pi / 2, rnd=rnd, kick=0.06))
    ws = window(f"{name}_win", M, (x, yf - 0.01, zb + 0.18), w=0.2, h=0.2, shutters=False)
    return parts + ws

def build_cottage(arch=0, two=0):
    M = slots(); rnd = random.Random(arch * 31 + two * 7 + 11)
    root = empty("cottage", (0, 0, 0))
    P, extra = [], []
    P.append(pad("pad", M, 1.9, 1.9))
    def add(xs):
        for o in xs: (extra if o.type == "EMPTY" else P).append(o)
    if arch == 0:
        W, D = 1.25, 1.3
        H = 0.86 + (0.72 if two else 0)
        P.append(plinth("plinth", M, W, D, rnd=rnd))
        P += block("main", M, W, D, H, 0.82, front_gable=True, over=0.15, rows=5, rnd=rnd)
        P.append(timber_frame("frame", M, W, D, 0.86, 0.0, braces=False))
        if two:
            P.append(box("floorband", (W + 0.08, D + 0.08, 0.08), (0, 0, 0.84), M["trim"], bev=0.02))
            P.append(timber_frame("frame2", M, W, D, H - 0.86, 0.86, braces=True))
            add(window("u1", M, (-0.28, -D / 2 - 0.01, 1.25), w=0.26, h=0.3, box_flowers=True))
            add(window("u2", M, (0.28, -D / 2 - 0.01, 1.25), w=0.26, h=0.3))
        # round attic window in the gable
        P.append(cyl("attic_f", 0.13, 0.13, 0.05, (0, -D / 2 - 0.0, H + 0.3), M["trim"], seg=12, rot=(math.pi / 2, 0, 0), bev=0.01))
        P.append(cyl("attic_g", 0.09, 0.09, 0.06, (0, -D / 2 + 0.005, H + 0.3), M["win"], seg=12, rot=(math.pi / 2, 0, 0)))
        extra.append(empty("pt_glow_win", (0, -D / 2 - 0.03, H + 0.3)))
        P.append(door("door", M, (-0.27, -D / 2 - 0.01, 0.0)))
        for xp in (-0.55, 0.01):
            P.append(box(f"post{xp}", (0.06, 0.06, 0.66), (xp, -D / 2 - 0.34, 0), M["trim"], bev=0.015))
        P.append(lean_roof("porch", 0.62, 0.36, 0.14, M, over=0.06, rows=2, loc=(-0.27, -D / 2 - 0.2, 0.68), rnd=rnd))
        add(window("w1", M, (0.33, -D / 2 - 0.01, 0.48), box_flowers=True))
        add(window("w2", M, (W / 2 + 0.01, -0.15, 0.48), face="+X"))
        add(window("w3", M, (-W / 2 - 0.01, 0.15, 0.48), face="-X"))
        add(chimney("chim", M, (0.38, 0.3, H + 0.1), h=0.75, lean=0.05, rnd=rnd))
        P.append(bush("bush1", M, (0.78, -0.82, 0), rnd=rnd))
    elif arch == 1:
        H = 0.84 + (0.66 if two else 0)
        mx, my, MW, MD = -0.22, 0.28, 1.3, 1.0
        P.append(plinth("plinth", M, MW, MD, rnd=rnd)); P[-1].location = (mx, my, 0)
        P += block("main", M, MW, MD, H, 0.62, over=0.14, rows=4, x=mx, y=my, rnd=rnd)
        wx, wy, WW, WD = 0.42, -0.32, 0.72, 0.75
        P.append(plinth("plinth2", M, WW, WD, rnd=rnd)); P[-1].location = (wx, wy, 0)
        P += block("wing", M, WW, WD, 0.78, 0.5, front_gable=True, over=0.12, rows=3, x=wx, y=wy, rnd=rnd)
        P.append(door("door", M, (wx, wy - WD / 2 - 0.01, 0.0), w=0.3, h=0.52))
        add(window("w1", M, (-0.5, my - MD / 2 - 0.01, 0.5), box_flowers=True))
        add(window("w2", M, (mx - MW / 2 - 0.01, my, 0.5), face="-X"))
        add(window("w3", M, (wx + WW / 2 + 0.01, wy, 0.45), w=0.24, h=0.26, face="+X"))
        if two:
            add(window("u1", M, (-0.5, my - MD / 2 - 0.01, 1.2), w=0.26, h=0.28))
            add(window("u2", M, (-0.02, my - MD / 2 - 0.01, 1.2), w=0.22, h=0.26, shutters=False))
        add(chimney("chim", M, (-0.6, 0.5, H + 0.05), h=0.7, lean=-0.05, rnd=rnd))
        for i in range(3):
            for j in range(3 - i):
                P.append(cyl(f"log{i}{j}", 0.06, 0.06, 0.4, (-0.5 + j * 0.13 + i * 0.065, -0.68, 0.06 + i * 0.11), M["wood"], seg=7, rot=(0, math.pi / 2, 0)))
    elif arch == 2:
        W, D = 1.5, 1.1
        P.append(plinth("plinth", M, W, D, rnd=rnd))
        if two:
            H1, H2 = 0.8, 0.72
            P.append(walls("ground", M, W, D, H1, mat=M["stone"]))
            P.append(box("jetty", (W + 0.16, D + 0.16, 0.08), (0, 0, H1), M["trim"], bev=0.02))
            P += block("upper", M, W + 0.12, D + 0.12, H2, 0.78, over=0.15, rows=5, sag=0.07, z0=H1 + 0.08, rnd=rnd)
            P.append(timber_frame("frame2", M, W + 0.12, D + 0.12, H2, H1 + 0.08, braces=True))
            top = H1 + 0.08 + H2; Dr = D + 0.12
            add(window("u1", M, (-0.38, -Dr / 2 - 0.01, H1 + 0.5), w=0.28, h=0.32, box_flowers=True))
            add(window("u2", M, (0.38, -Dr / 2 - 0.01, H1 + 0.5), w=0.28, h=0.32))
        else:
            H1 = 0.86
            P += block("main", M, W, D, H1, 0.78, over=0.15, rows=5, sag=0.07, rnd=rnd)
            P.append(box("band", (W + 0.06, D + 0.06, 0.07), (0, 0, H1 - 0.06), M["trim"], bev=0.02))
            top = H1; Dr = D
        P.append(door("door", M, (-0.3, -D / 2 - 0.01, 0.0), w=0.34, h=0.58))
        add(window("w1", M, (0.36, -D / 2 - 0.01, 0.48), w=0.36, h=0.3, box_flowers=not two))
        add(window("w2", M, (W / 2 + 0.01, 0.1, 0.48), face="+X"))
        P.append(box("lpost", (0.05, 0.12, 0.05), (-0.6, -D / 2 - 0.06, 0.66), M["metal"]))
        P.append(box("lamp", (0.1, 0.1, 0.13), (-0.6, -D / 2 - 0.12, 0.55), M["win"], bev=0.02))
        extra.append(empty("pt_glow_lamp", (-0.6, -D / 2 - 0.12, 0.6)))
        add(chimney("chim", M, (-0.5, 0.22, top + 0.1), h=0.8, lean=0.04, rnd=rnd))
    else:
        W, D, H = 1.4, 1.3, 0.74 + (0.52 if two else 0)
        P += block("main", M, W, D, H, 0.85, front_gable=True, over=0.18, rows=3, sag=0.08, wall_mat=M["stone"], roof_mat=M["thatch"], puffy=True, thick=0.17, rnd=rnd)
        for k in range(30):
            side = rnd.choice(("-Y", "-Y", "+X", "-X"))
            z = rnd.uniform(0.08, H - 0.08)
            if side == "-Y":
                xx = rnd.uniform(-W / 2 + 0.1, W / 2 - 0.1)
                if (abs(xx) < 0.28 and z < 0.66) or (abs(abs(xx) - 0.45) < 0.22 and abs(z - 0.42) < 0.24): continue
                P.append(box(f"blk{k}", (rnd.uniform(0.14, 0.24), 0.04, rnd.uniform(0.08, 0.12)), (xx, -D / 2 + 0.005, z), M["stone2"], bev=0.015))
            else:
                sx = 1 if side == "+X" else -1
                yy = rnd.uniform(-D / 2 + 0.1, D / 2 - 0.1)
                if sx > 0 and abs(yy) < 0.25 and abs(z - 0.42) < 0.24: continue
                P.append(box(f"blk{k}", (0.04, rnd.uniform(0.14, 0.24), rnd.uniform(0.08, 0.12)), (sx * (W / 2 - 0.005), yy, z), M["stone2"], bev=0.015))
        P.append(door("door", M, (0.0, -D / 2 - 0.01, 0.0), w=0.32, h=0.55))
        add(window("w1", M, (-0.45, -D / 2 - 0.01, 0.42), w=0.26, h=0.26, box_flowers=True))
        add(window("w2", M, (0.45, -D / 2 - 0.01, 0.42), w=0.26, h=0.26))
        add(window("w3", M, (W / 2 + 0.01, 0.0, 0.42), w=0.26, h=0.26, face="+X"))
        add(chimney("chim", M, (-0.42, 0.32, H - 0.1), h=1.1, lean=-0.04, rnd=rnd))
        P.append(bush("bush1", M, (-0.78, -0.75, 0), rnd=rnd)); P.append(bush("bush2", M, (0.8, -0.72, 0), r=0.11, rnd=rnd))
    body = join(P, "body")
    parent(body, root)
    for o in extra: parent(o, root)
    return root
