# Magic: the Scriptorium and the Enchanter's Forge.
import math, random

def crystal_cluster(name, M, loc, s=1.0, rnd=None, n=5):
    """Violet crystal points leaning out from a rocky base."""
    rnd = rnd or random.Random(7)
    x, y, z = loc
    parts = [sphere(f"{name}_rock", 0.11 * s, (x, y, z + 0.02 * s), M["rock2"], sub=1, scale=(1.3, 1.1, 0.55))]
    for k in range(n):
        a = k / n * math.tau + rnd.uniform(-0.3, 0.3)
        lean = 0.4 + rnd.uniform(0, 0.3) if k else 0.0
        h = (0.34 if k == 0 else rnd.uniform(0.17, 0.27)) * s
        r = (0.06 if k == 0 else rnd.uniform(0.04, 0.055)) * s
        off = 0.0 if k == 0 else 0.085 * s
        parts.append(cyl(f"{name}_c{k}", r, 0.0, h, (x + math.cos(a) * off, y + math.sin(a) * off, z + 0.03 * s), M["arcane"], seg=6,
                         rot=(math.sin(a) * lean, -math.cos(a) * lean, 0)))
    return parts

def scroll_roll(name, M, loc, L=0.22, r=0.035, rot_z=0.0, ribbon="red"):
    """A rolled scroll lying on its side, centred on loc, its axis turned rot_z from +X, tied with a ribbon."""
    x, y, z = loc
    dx, dy = math.cos(rot_z), math.sin(rot_z)
    c = cyl(f"{name}_p", r, r, L, (x - dx * L / 2, y - dy * L / 2, z), M["cloth"], seg=8, rot=(0, math.pi / 2, rot_z))
    t = cyl(f"{name}_t", r * 1.08, r * 1.08, 0.025, (x - dx * 0.0125, y - dy * 0.0125, z), M[ribbon], seg=8, rot=(0, math.pi / 2, rot_z))
    return [c, t]

# ── Scriptorium: a tall scholars' workshop, a giant quill in an inkpot on the sign, a scroll rack ──
def build_scriptorium():
    M = wslots(); rnd = random.Random(81)
    root = empty("scriptorium", (0, 0, 0)); P, E = [pad("pad", M, 1.9, 1.9)], []
    W, D = 1.25, 1.1; cy = 0.25
    P.append(plinth("plinth", M, W, D, rnd=rnd)); P[-1].location = (0, cy, 0)
    P.append(walls("ground", M, W, D, 0.8, loc=(0, cy, 0), mat=M["stone"]))
    P += block("upper", M, W, D, 0.62, 0.78, front_gable=True, over=0.14, rows=4, z0=0.8, y=cy, wall_mat=M["wall"], rnd=rnd)
    P.append(timber_frame("frame", M, W, D, 0.62, 0.8, braces=True)); P[-1].location = (0, cy, 0)
    P.append(box("band", (W + 0.08, D + 0.08, 0.07), (0, cy, 0.77), M["trim"], bev=0.02))
    P.append(door("door", M, (-0.22, cy - D / 2 - 0.01, 0.0), w=0.32, h=0.56))
    # a big arched reading window beside the door, lit from inside
    E += window("w1", M, (0.3, cy - D / 2 - 0.01, 0.34), w=0.3, h=0.36, shutters=False, round_top=True)
    E.append(empty("pt_glow_win", (0.3, cy - D / 2 - 0.05, 0.5)))
    # a round gable window
    P.append(cyl("rose", 0.15, 0.15, 0.05, (0, cy - D / 2, 1.73), M["trim"], seg=14, rot=(math.pi / 2, 0, 0)))
    P.append(cyl("roseg", 0.105, 0.105, 0.06, (0, cy - D / 2 + 0.005, 1.73), M["win"], seg=14, rot=(math.pi / 2, 0, 0)))
    for x in (-0.36, 0.36): E += window(f"u{x}", M, (x, cy - D / 2 - 0.01, 1.08), w=0.22, h=0.28, box_flowers=False)
    P += chimney("chim", M, (0.38, cy + 0.2, 1.2), h=1.2, rnd=rnd)
    # hero: a giant quill standing in an inkpot, up on a post by the door
    px, py = -0.7, -0.6
    P.append(box("spost", (0.1, 0.1, 0.95), (px, py, 0.04), M["dark"], bev=0.02))
    P.append(box("sshelf", (0.34, 0.3, 0.05), (px, py, 0.99), M["plank"], bev=0.015))
    P.append(cyl("pot", 0.13, 0.15, 0.2, (px, py, 1.04), M["dark"], seg=10, bev=0.02))
    P.append(cyl("potrim", 0.11, 0.11, 0.03, (px, py, 1.24), M["metal"], seg=10))
    P.append(cyl("ink", 0.095, 0.095, 0.012, (px, py, 1.26), M["arcane"], seg=10))
    q = poly_extrude("quill", [(-0.025, 0.0), (0.025, 0.0), (0.12, 0.28), (0.1, 0.62), (0.0, 0.8), (-0.07, 0.55), (-0.08, 0.24)], 0.03,
                     (px + 0.02, py, 1.12), M["white"], rot=(0, -0.3, 0))
    P.append(q)
    P.append(box("qspine", (0.014, 0.014, 0.78), (px + 0.04, py - 0.02, 1.12), M["cut"], rot=(0, -0.3, 0)))
    # the scroll rack: a pigeonhole shelf of rolled scrolls by the window
    sx, sy = 0.62, -0.62
    P.append(box("rack", (0.5, 0.2, 0.62), (sx, sy, 0), M["plank"], bev=0.015))
    for row in range(3):
        P.append(box(f"shelf{row}", (0.5, 0.21, 0.02), (sx, sy, 0.2 + row * 0.2), M["dark"]))
        for k in range(3):
            P += scroll_roll(f"sr{row}{k}", M, (sx - 0.15 + k * 0.15, sy - 0.03, 0.07 + row * 0.2), L=0.22, r=0.03,
                             rot_z=math.pi / 2, ribbon=["red", "gold", "purple"][(row + k) % 3])
    P += crate("cr", M, (-0.75, 0.75, 0), s=0.22)
    return finish(root, P, E)

# ── Enchanter's Forge: a dark stone workshop with a violet slate roof, crystals growing through the ridge,
#    and out front the hero: a rune anvil on a plinth inside a glowing circle, a crystal floating above it ──
def build_enchanter():
    M = wslots(); rnd = random.Random(82)
    root = empty("enchanter", (0, 0, 0)); P, E = [pad("pad", M, 1.9, 1.9)], []
    W, D = 1.3, 0.75; cy = 0.5
    P.append(plinth("plinth", M, W, D, rnd=rnd)); P[-1].location = (0, cy, 0)
    P.append(walls("back", M, W, D, 1.0, loc=(0, cy, 0), mat=M["stone2"]))
    P.append(gable_roof("roof", W, D, 0.45, M, over=0.13, rows=4, loc=(0, cy, 1.0), mat=M["purple"], rnd=rnd))
    g = gable_fill("gable", M, W, D, 0.45, 1.0, mat=M["stone2"]); g.location = (0, cy, 1.0); P.append(g)
    P.append(door("door", M, (0.32, cy - D / 2 - 0.01, 0.0), w=0.3, h=0.56))
    E += window("w1", M, (-0.32, cy - D / 2 - 0.01, 0.42), w=0.26, h=0.3, shutters=False, round_top=True)
    E.append(empty("pt_glow_win", (-0.32, cy - D / 2 - 0.05, 0.55)))
    # crystals pushing up through the roof
    P += crystal_cluster("ridge", M, (-0.32, cy, 1.36), s=2.2, rnd=rnd, n=6)
    E.append(empty("pt_glow_lamp", (-0.32, cy, 1.9)))
    # a lean-to over the workspace on two posts
    for x in (-0.72, 0.72): P.append(box(f"post{x}", (0.08, 0.08, 0.82), (x, -0.25, 0), M["dark"], bev=0.015))
    P.append(lean_roof("shed", 1.55, 0.55, 0.16, M, over=0.08, rows=2, loc=(0, -0.0, 0.82), rnd=rnd))
    # a magic circle on the ground: a thin glowing ring with four rune marks
    P.append(cyl("circ", 0.5, 0.5, 0.022, (0.05, -0.55, 0.03), M["arcane"], seg=24))
    P.append(cyl("circin", 0.45, 0.45, 0.026, (0.05, -0.55, 0.03), M["stone"], seg=24))
    for k in range(4):
        a = k * math.pi / 2 + math.pi / 4
        P.append(box(f"rune{k}", (0.07, 0.025, 0.012), (0.05 + math.cos(a) * 0.38, -0.55 + math.sin(a) * 0.38, 0.055), M["arcane"], rot=(0, 0, a)))
    # hero: the rune anvil on a stone plinth
    P.append(cyl("anvbase", 0.17, 0.2, 0.24, (0.05, -0.55, 0.056), M["stone2"], seg=8, bev=0.02))
    anv = [box("a_base", (0.22, 0.16, 0.08), (0.05, -0.55, 0.28), M["metal"], bev=0.01),
           box("a_waist", (0.14, 0.11, 0.08), (0.05, -0.55, 0.36), M["metal"]),
           box("a_face", (0.38, 0.18, 0.08), (0.05, -0.55, 0.44), M["metal"], bev=0.015),
           cyl("a_horn", 0.075, 0.0, 0.2, (0.24, -0.55, 0.48), M["metal"], seg=8, rot=(0, math.pi / 2, 0))]
    P += anv
    for k, x in enumerate((-0.07, 0.03, 0.13)):
        P.append(box(f"arune{k}", (0.04, 0.012, 0.045), (x, -0.55 - 0.093, 0.455), M["arcane"]))
    # a blade waiting on the anvil
    P.append(box("ablade", (0.3, 0.035, 0.012), (0.03, -0.53, 0.53), M["metal2"], rot=(0, 0, 0.2)))
    P.append(box("ahilt", (0.025, 0.1, 0.02), (-0.13, -0.56, 0.53), M["gold"], rot=(0, 0, 0.2)))
    # the floating crystal, bobbing and turning while the enchanter works (anim_float, main.js)
    fl = empty("anim_float", (0.05, -0.55, 0.92))
    fbody = join([cyl("fl_top", 0.1, 0.0, 0.24, (0.05, -0.55, 0.92), M["arcane"], seg=6),
                  cyl("fl_bot", 0.1, 0.0, 0.17, (0.05, -0.55, 0.92), M["arcane"], seg=6, rot=(math.pi, 0, 0))], "float_crystal")
    parent(fbody, fl); parent(fl, root)
    E.append(empty("pt_glow_lamp", (0.05, -0.55, 0.92)))
    # crystal clusters on the ground, and a rack of finished wands on the wall
    P += crystal_cluster("gc1", M, (-0.62, -0.62, 0.03), s=1.4, rnd=rnd)
    P += crystal_cluster("gc2", M, (0.74, -0.74, 0.03), s=1.0, rnd=rnd, n=4)
    P.append(box("wrack", (0.5, 0.05, 0.05), (-0.25, cy - D / 2 - 0.04, 0.78), M["dark"]))
    for k in range(4):
        x = -0.43 + k * 0.12
        P.append(cyl(f"wand{k}", 0.012, 0.012, 0.32, (x, cy - D / 2 - 0.07, 0.42), M["wood"], seg=6))
        P.append(sphere(f"wtip{k}", 0.022, (x, cy - D / 2 - 0.07, 0.75), M["arcane"], sub=0))
    P += barrel("b", M, (-0.72, 0.15, 0))
    return finish(root, P, E)
