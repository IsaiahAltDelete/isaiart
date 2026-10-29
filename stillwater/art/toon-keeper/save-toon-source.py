import bpy,json
from pathlib import Path
root=Path(r'C:\Users\Dizzy\Documents\Codex\2026-10-18\c-users-dizzy-documents-github-isaiart')
scene=bpy.data.scenes.new('Stillwater toon keeper - assembled runtime pose')
materials={}
for part in json.loads((root/'outputs/toon-runtime-pose.json').read_text()):
 p=part['p'];verts=[(p[i],-p[i+2],p[i+1]) for i in range(0,len(p),3)];me=bpy.data.meshes.new(part['name']);me.from_pydata(verts,[],[tuple(range(i,i+3)) for i in range(0,len(verts),3)]);me.update();o=bpy.data.objects.new(part['name'],me);scene.collection.objects.link(o);o.hide_render=not part['visible'];o.hide_viewport=not part['visible']
 if part['uv']:
  uv=me.uv_layers.new()
  for i,loop in enumerate(me.loops):j=loop.vertex_index*2;uv.data[i].uv=part['uv'][j:j+2]
 color=part['color']
 if color not in materials:
  m=bpy.data.materials.new('Toon colour '+hex(color));m.diffuse_color=(((color>>16)&255)/255,((color>>8)&255)/255,(color&255)/255,1);materials[color]=m
 me.materials.append(materials[color])
 for poly in me.polygons:poly.use_smooth=True
scene['Animation source']='work/toon-runtime.js: poseKeeper. This scene is the editable assembled resting pose; game owns articulated animation and screen-space ink.'
bpy.data.libraries.write(str(root/'outputs/stillwater-toon-keeper.blend'),{scene},fake_user=True)
result={'saved':str(root/'outputs/stillwater-toon-keeper.blend'),'objects':len(scene.objects)}
