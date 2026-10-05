# Villages model kit for Blender (5.x). Run inside Blender; builds stylized
# low-poly parts and exports them for js/blender.js.
#
# Conventions
# - Units are game tiles. Z is up, the front of a model faces -Y (it becomes +Z
#   in three.js, where doors face). Ground is z = 0.
# - A material's name is its slot: wall, roof, trim, wood, door, win, stone,
#   chim, metal, leaf, cloth, skin, shirt, pants, hair, shoe, eye, cheek, ...
#   The game recolours slots per house / villager; the colour here is the default.
# - Objects named anim_<key> stay separate nodes the game animates (a.<key>).
#   Empties named pt_<key> export as points (smoke, glow_win, glow_lamp, ...).
import bpy, bmesh, math, json, base64, struct, os, random
from mathutils import Vector, Matrix, Euler

COL = {}

def hexrgb(h):
    return tuple(((h >> s) & 255) / 255 for s in (16, 8, 0))

def srgb_to_lin(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4

def material(slot, color, smooth=False):
    """One material per slot+colour. The slot is the part before '#'."""
    name = f"{slot}#{color:06x}" + ("~s" if smooth else "")
    m = bpy.data.materials.get(name)
    if m is None:
        m = bpy.data.materials.new(name)
        r, g, b = (srgb_to_lin(c) for c in hexrgb(color))
        m.diffuse_color = (r, g, b, 1)
        m.use_nodes = True
        bsdf = m.node_tree.nodes.get("Principled BSDF")
        if bsdf:
            bsdf.inputs["Base Color"].default_value = (r, g, b, 1)
            bsdf.inputs["Roughness"].default_value = 0.85
            if slot in ("win", "lamp", "glow"):
                bsdf.inputs["Emission Color"].default_value = (r, g, b, 1)
                bsdf.inputs["Emission Strength"].default_value = 0.6
    return m

def clear_scene():
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    for c in list(bpy.data.collections):
        bpy.data.collections.remove(c)
    for m in list(bpy.data.meshes):
        bpy.data.meshes.remove(m)

def collection(name):
    c = bpy.data.collections.get(name)
    if c is None:
        c = bpy.data.collections.new(name)
        bpy.context.scene.collection.children.link(c)
    return c

_TARGET = None
def target(col):
    global _TARGET
    _TARGET = col

def _link(o):
    (_TARGET or bpy.context.scene.collection).objects.link(o)
    return o

def _obj(name, bm, mat, loc=(0, 0, 0), rot=(0, 0, 0), smooth=False):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me); bm.free()
    if smooth:
        for p in me.polygons: p.use_smooth = True
    o = bpy.data.objects.new(name, me)
    o.location = loc; o.rotation_euler = rot
    me.materials.append(mat)
    return _link(o)

def bevel(o, width, segs=1, limit_angle=None):
    m = o.modifiers.new("bevel", "BEVEL")
    m.width = width; m.segments = segs
    m.limit_method = "ANGLE" if limit_angle is None else "ANGLE"
    m.angle_limit = math.radians(limit_angle or 40)
    m.harden_normals = False
    return o

# ── primitives ─────────────────────────────────────────────

def box(name, size, loc, mat, bev=0.0, segs=1, rot=(0, 0, 0), taper=1.0, base=True):
    """A box. base=True puts loc at the bottom centre. taper<1 narrows the top."""
    sx, sy, sz = size
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        top = v.co.z > 0
        v.co.x *= sx; v.co.y *= sy; v.co.z *= sz
        if base: v.co.z += sz / 2
        if top and taper != 1.0:
            v.co.x *= taper; v.co.y *= taper
    o = _obj(name, bm, mat, loc, rot)
    if bev: bevel(o, bev, segs)
    return o

def cyl(name, r1, r2, h, loc, mat, seg=10, bev=0.0, segs=1, rot=(0, 0, 0), smooth=False, cap=True):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=cap, cap_tris=False, segments=seg, radius1=r1, radius2=r2, depth=h)
    for v in bm.verts: v.co.z += h / 2
    o = _obj(name, bm, mat, loc, rot, smooth)
    if bev: bevel(o, bev, segs)
    return o

def sphere(name, r, loc, mat, sub=1, scale=(1, 1, 1), smooth=False, rot=(0, 0, 0)):
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=sub, radius=r)
    for v in bm.verts: v.co.x *= scale[0]; v.co.y *= scale[1]; v.co.z *= scale[2]
    return _obj(name, bm, mat, loc, rot, smooth)

def uvsphere(name, r, loc, mat, seg=12, rings=8, scale=(1, 1, 1), smooth=True, rot=(0, 0, 0), cut=None, front=None):
    """cut: keep only vertices with z >= cut*r (a dome).
    front: a hairline - on the front half (-Y) keep only z >= front*r."""
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=seg, v_segments=rings, radius=r)
    if cut is not None or front is not None:
        def gone(v):
            if cut is not None and v.co.z < cut * r - 1e-5: return True
            if front is not None and v.co.y < -0.25 * r:
                # the hairline curves down toward the temples
                k = min(1.0, (-v.co.y / r - 0.25) / 0.6)
                return v.co.z < (front * k + (cut if cut is not None else -1) * (1 - k)) * r - 1e-5
            return False
        bmesh.ops.delete(bm, geom=[v for v in bm.verts if gone(v)], context="VERTS")
    for v in bm.verts: v.co.x *= scale[0]; v.co.y *= scale[1]; v.co.z *= scale[2]
    return _obj(name, bm, mat, loc, rot, smooth)

def prism(name, w, d, h, loc, mat, rot=(0, 0, 0), bev=0.0):
    """Gable-end triangle prism, ridge along X, base at z=0."""
    bm = bmesh.new()
    hw, hd = w / 2, d / 2
    vs = [bm.verts.new(p) for p in [(-hw, -hd, 0), (-hw, hd, 0), (-hw, 0, h), (hw, -hd, 0), (hw, hd, 0), (hw, 0, h)]]
    for f in [(0, 2, 1), (3, 4, 5), (0, 3, 5, 2), (1, 2, 5, 4), (0, 1, 4, 3)]:
        bm.faces.new([vs[i] for i in f])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    o = _obj(name, bm, mat, loc, rot)
    if bev: bevel(o, bev)
    return o

def poly_extrude(name, pts2d, depth, loc, mat, rot=(0, 0, 0), bev=0.0, segs=1):
    """Extrude a 2D outline (in the XZ plane) by depth along Y (centred)."""
    bm = bmesh.new()
    front = [bm.verts.new((x, -depth / 2, z)) for x, z in pts2d]
    back = [bm.verts.new((x, depth / 2, z)) for x, z in pts2d]
    bm.faces.new(front[::-1]); bm.faces.new(back)
    n = len(pts2d)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new([front[i], front[j], back[j], back[i]])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    o = _obj(name, bm, mat, loc, rot)
    if bev: bevel(o, bev, segs)
    return o

def arch_pts(w, h, seg=6):
    """Outline of a round-topped door/window: width w, total height h."""
    r = w / 2
    pts = [(-r, 0), (r, 0)]
    for i in range(seg + 1):
        a = i / seg * math.pi
        pts.append((math.cos(a) * r, h - r + math.sin(a) * r))
    return pts

def beam(name, p0, p1, w, d, mat, bev=0.0):
    """A box running from point p0 to point p1 (w x d cross-section)."""
    a, b = Vector(p0), Vector(p1)
    o = box(name, (w, d, (b - a).length), (0, 0, 0), mat, bev=bev, base=True)
    o.rotation_mode = "QUATERNION"
    o.rotation_quaternion = Vector((0, 0, 1)).rotation_difference((b - a).normalized())
    o.location = a
    return o

def rotate_about(o, pivot, euler):
    """Bake a rotation about a world-space pivot into an object's mesh."""
    from mathutils import Matrix
    M = Matrix.Translation(Vector(pivot)) @ Euler(euler).to_matrix().to_4x4() @ Matrix.Translation(-Vector(pivot))
    o.data.transform(M)
    return o

def empty(name, loc):
    o = bpy.data.objects.new(name, None)
    o.location = loc; o.empty_display_size = 0.1
    return _link(o)

def parent(child, par):
    bpy.context.view_layer.update()
    mw = child.matrix_world.copy()
    child.parent = par
    child.matrix_world = mw
    return child

def join(objs, name):
    """Apply modifiers and join meshes into one object (keeps materials)."""
    objs = [o for o in objs if o and o.type == "MESH"]
    if not objs: return None
    dg = bpy.context.evaluated_depsgraph_get()
    bm = bmesh.new()
    mats = []
    bpy.context.view_layer.update()
    for o in objs:
        ev = o.evaluated_get(dg)
        me = ev.to_mesh()
        offs = len(mats)
        for m in o.data.materials: mats.append(m)   # originals, never the evaluated copies
        tmp = bmesh.new(); tmp.from_mesh(me)
        ev.to_mesh_clear()
        bmesh.ops.transform(tmp, matrix=o.matrix_world, verts=tmp.verts)
        for f in tmp.faces: f.material_index += offs
        m2 = bpy.data.meshes.new("_tmp")
        tmp.to_mesh(m2); tmp.free()
        bm.from_mesh(m2)
        bpy.data.meshes.remove(m2)
    out = bpy.data.meshes.new(name)
    bm.to_mesh(out); bm.free()
    for m in mats: out.materials.append(m)
    # dedupe material slots
    o = bpy.data.objects.new(name, out)
    _link(o)
    for old in objs: bpy.data.objects.remove(old, do_unlink=True)
    merge_slots(o)
    return o

def merge_slots(o):
    me = o.data
    uniq, remap = [], []
    for m in me.materials:
        if m not in uniq: uniq.append(m)
        remap.append(uniq.index(m))
    idx = [remap[p.material_index] for p in me.polygons]
    me.materials.clear()          # (this clamps polygon indices, so restore them after)
    for m in uniq: me.materials.append(m)
    me.polygons.foreach_set("material_index", idx)
    me.update()

# ── export ────────────────────────────────────────────────

# All vertex data goes into one binary buffer; the JSON holds offsets.
# Positions are int16 in steps of 1/QUANT tiles, normals int8, indices uint16.
QUANT = 4000
BIN = bytearray()

def _put(fmt, arr):
    while len(BIN) % 4: BIN.append(0)
    off = len(BIN)
    BIN.extend(struct.pack("<%d%s" % (len(arr), fmt), *arr))
    return off

def to_three(v):
    """Blender (x, y, z) Z-up, front -Y  ->  three (x, z, -y)."""
    return (v[0], v[2], -v[1])

def mesh_parts(o, dg):
    ev = o.evaluated_get(dg)
    me = ev.to_mesh()
    me.calc_loop_triangles()
    cn = me.corner_normals
    parts = {}
    for t in me.loop_triangles:
        mi = t.material_index
        mat = me.materials[mi] if mi < len(me.materials) else None
        name = mat.name if mat else "wall#ffffff"
        smooth = me.polygons[t.polygon_index].use_smooth
        P = parts.setdefault(name, {"map": {}, "pos": [], "nrm": [], "idx": [], "smooth": smooth})
        for li in t.loops:
            vi = me.loops[li].vertex_index
            co = me.vertices[vi].co
            n = cn[li].vector if smooth else t.normal
            # flat-shaded parts share vertices: the game derives face normals itself
            key = (vi, round(n.x, 2), round(n.y, 2), round(n.z, 2)) if smooth else vi
            k = P["map"].get(key)
            if k is None:
                k = len(P["pos"]) // 3
                P["map"][key] = k
                P["pos"].extend(to_three(co)); P["nrm"].extend(to_three(n))
            P["idx"].append(k)
    ev.to_mesh_clear()
    out = []
    for name, P in parts.items():
        slot, _, rest = name.partition("#")
        color = int(rest[:6], 16) if rest else 0xffffff
        q = [max(-127, min(127, round(c * 127))) for c in P["nrm"]]
        nv = len(P["pos"]) // 3
        assert nv < 65536, f"{name}: too many vertices"
        qp = [max(-32767, min(32767, round(c * QUANT))) for c in P["pos"]]
        smooth = "~s" in name
        out.append({"slot": slot, "color": color, "smooth": smooth, "nv": nv, "ni": len(P["idx"]),
                    "pos": _put("h", qp), "nrm": _put("b", q) if smooth else -1, "idx": _put("H", P["idx"])})
    return out

def export_model(root_objs, name):
    """Export objects (and their children) as one model description."""
    dg = bpy.context.evaluated_depsgraph_get()
    nodes, points = [], []
    def visit(o, par):
        if o.type == "EMPTY" and o.name.split(".")[0].startswith("pt_"):
            points.append({"name": o.name.split(".")[0][3:], "parent": par, "pos": to_three(o.location)})
            return
        loc = to_three(o.location)
        e = o.rotation_euler
        node = {"name": o.name.split(".")[0], "parent": par, "pos": loc,
                "rot": [e.x, e.z, -e.y], "scale": [o.scale.x, o.scale.z, o.scale.y]}
        if o.type == "MESH":
            # export in the object's local space
            node["meshes"] = mesh_parts_local(o, dg)
        nodes.append(node)
        me_i = len(nodes) - 1
        for c in o.children: visit(c, me_i)
    for o in root_objs: visit(o, -1)
    return {"nodes": nodes, "points": points}

def mesh_parts_local(o, dg):
    return mesh_parts(o, dg)

def write_models(models, path):
    """Writes <path> (JSON index) and <path minus .json>.bin (vertex data)."""
    binpath = path[:-5] + ".bin"
    with open(binpath, "wb") as f: f.write(BIN)
    with open(path, "w") as f:
        json.dump({"v": 2, "quant": QUANT, "bin": os.path.basename(binpath), "models": models}, f, separators=(",", ":"))
    return os.path.getsize(path) + os.path.getsize(binpath)

# ── preview rendering ────────────────────────────────────

def preview_setup(res=(900, 700)):
    sc = bpy.context.scene
    sc.render.engine = "BLENDER_EEVEE"
    sc.render.resolution_x, sc.render.resolution_y = res
    sc.render.film_transparent = False
    w = sc.world or bpy.data.worlds.new("World")
    sc.world = w
    w.use_nodes = True
    bg = w.node_tree.nodes.get("Background")
    if bg:
        bg.inputs[0].default_value = (0.62, 0.78, 0.55, 1)
        bg.inputs[1].default_value = 1.0
    sc.view_settings.view_transform = "Standard"

def preview_camera(target=(0, 0, 0.8), dist=7.0, yaw=-0.55, pitch=0.62, lens=50, name="PreviewCam"):
    cam = bpy.data.objects.get(name)
    if cam is None:
        cd = bpy.data.cameras.new(name); cam = bpy.data.objects.new(name, cd)
        bpy.context.scene.collection.objects.link(cam)
    cam.data.lens = lens
    t = Vector(target)
    d = Vector((math.sin(yaw) * math.cos(pitch), -math.cos(yaw) * math.cos(pitch), math.sin(pitch)))
    cam.location = t + d * dist
    cam.rotation_euler = (t - cam.location).to_track_quat("-Z", "Y").to_euler()
    bpy.context.scene.camera = cam
    sun = bpy.data.objects.get("PreviewSun")
    if sun is None:
        ld = bpy.data.lights.new("PreviewSun", "SUN"); ld.energy = 3.2; ld.angle = 0.2
        sun = bpy.data.objects.new("PreviewSun", ld); bpy.context.scene.collection.objects.link(sun)
    sun.rotation_euler = Euler((math.radians(48), math.radians(12), math.radians(-38)))
    return cam
