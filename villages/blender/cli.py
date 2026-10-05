# Headless driver:
#   blender -b --factory-startup -P cli.py -- <command> [args]
# Commands
#   preview <model> <out.png> [variant-objects-to-show,comma]   render one model
#   export <out.json>                                            build + export every model
import sys, os, math
HERE = os.path.dirname(os.path.abspath(__file__))
G = globals()
for f in ["vkit.py"] + sorted(n for n in os.listdir(HERE) if n.startswith(("kit_", "build_")) and n.endswith(".py")) + ["list.py"]:
    with open(os.path.join(HERE, f), encoding="utf-8") as fh:
        exec(compile(fh.read(), f, "exec"), G)

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
cmd = argv[0] if argv else "export"

def builder(name):
    fn = G.get("build_" + name.split(":")[0])
    if fn is None: raise SystemExit(f"no builder for {name}")
    return fn

def build(name):
    """name may be 'cottage:3' -> build_cottage(3)."""
    base, _, arg = name.partition(":")
    col = collection(name); target(col)
    fn = builder(base)
    root = fn(*(int(a) if a.lstrip('-').isdigit() else a for a in arg.split(","))) if arg else fn()
    return col, root

if cmd == "preview":
    name, out = argv[1], argv[2]
    show = argv[3].split(",") if len(argv) > 3 and argv[3] else None
    hide = argv[4].split(",") if len(argv) > 4 and argv[4] else []
    clear_scene()
    col, root = build(name)
    for o in col.objects:
        n = o.name.split(".")[0]
        grp = n.split("_")[0]
        # SHOW lists the villager's optional parts to keep (hair, hats, race parts, outfits)
        optional = grp in ("hair", "hat", "race") or n in ("apron", "pack", "scarf", "chain", "robe", "mask")
        if show is not None and optional and n not in show: o.hide_render = True
        if n in hide: o.hide_render = True
    # the winter snow pillows are hidden in the game except in deep snow; drop them
    # from previews too (SNOW=1 keeps them)
    if os.environ.get("SNOW") != "1":
        for o in col.objects:
            if o.type != "MESH": continue
            idx = [i for i, m in enumerate(o.data.materials) if m and m.name.startswith("snowcap")]
            if not idx: continue
            bm = bmesh.new(); bm.from_mesh(o.data)
            bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.material_index in idx], context="FACES")
            bm.to_mesh(o.data); bm.free()
    # frame the model
    import mathutils
    bpy.context.view_layer.update()
    pts = [o.matrix_world @ mathutils.Vector(c) for o in col.objects if o.type == "MESH" and not o.hide_render for c in o.bound_box]
    lo = mathutils.Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = mathutils.Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    c = (lo + hi) / 2; r = (hi - lo).length / 2
    yaw = float(os.environ.get("VYAW", "0.55")); pitch = float(os.environ.get("VPITCH", "0.85"))
    preview_setup((int(os.environ.get("VW", "800")), int(os.environ.get("VH", "700"))))
    ground = box("ground", (40, 40, 0.02), (0, 0, -0.02), material("ground", 0x8cc463)); ground.data.materials[0] = material("ground", 0x8cc463)
    preview_camera(target=tuple(c), dist=r * float(os.environ.get("VDIST", "3.2")), yaw=yaw, pitch=pitch, lens=50)
    sc = bpy.context.scene
    sc.render.filepath = out
    sc.eevee.taa_render_samples = 16
    try:
        sc.eevee.use_shadows = True
    except Exception: pass
    bpy.ops.render.render(write_still=True)
    print("PREVIEW_OK", out)

elif cmd == "export":
    out = argv[1]
    names = argv[2].split(",") if len(argv) > 2 else G.get("MODEL_LIST", ["villager"])
    models = {}
    for name in names:
        clear_scene()
        col, root = build(name)
        models[name.replace(":", "_").replace(",", "_")] = export_model([root], name)
    size = write_models(models, out)
    print("EXPORT_OK", out, size, "bytes", len(models), "models")
