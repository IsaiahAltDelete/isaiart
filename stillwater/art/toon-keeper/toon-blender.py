import bpy,json,math
from pathlib import Path
ROOT=Path(r'C:\Users\Dizzy\Documents\Codex\2026-10-18\c-users-dizzy-documents-github-isaiart')
source=json.loads((ROOT/'outputs/angler-meshes.json').read_text())
scene=bpy.data.scenes.new('Stillwater • Ink and water');old=bpy.context.window.scene;bpy.context.window.scene=scene
parts=[]
def height(y):return y*.72 if y<.7 else .504+(y-.7)*.82 if y<1.47 else 1.1354+(y-1.47)*1.35
for part in source:
 if part['name'].startswith('Woven cuff'):continue
 p=[];n=[];uv=[]
 for k in range(0,len(part['p']),9):
  tri=[part['p'][j:j+3] for j in range(k,k+9,3)];x,y,z=[sum(v[d] for v in tri)/3 for d in range(3)]
  if part['material']=='skin' and y<1.47:continue
  if part['name']=='Tailored continuous raincoat' and y>1.02 and abs(x)>.192:continue
  for j in range(3):
   xx,yy,zz=tri[j];head=yy>1.47;sx=1.5 if head else 1.3
   xx*=sx;zz*=1.35 if head else 1.17
   if yy<.7:xx+=.028 if xx>0 else -.014;zz+=.035 if xx>0 else -.018
   p.extend([round(xx,6),round(height(yy),6),round(zz,6)])
   a=(k//3+j)*3;n.extend(part['n'][a:a+3]);u=(k//3+j)*2;uv.extend(part['uv'][u:u+2])
 if not p:continue
 out={**part,'p':p,'n':n,'uv':uv};parts.append(out)
 verts=[(p[i],-p[i+2],p[i+1]) for i in range(0,len(p),3)];me=bpy.data.meshes.new(part['name']);me.from_pydata(verts,[],[tuple(range(i,i+3)) for i in range(0,len(verts),3)]);me.update();o=bpy.data.objects.new(part['name'],me);scene.collection.objects.link(o)
# A curled, articulated-looking grip mesh built around a vertical rod, exported in its local frame.
grip=[]
def ellipsoid(name,loc,scale):
 bpy.ops.mesh.primitive_uv_sphere_add(segments=16,ring_count=8,location=loc);o=bpy.context.object;o.name=name;o.scale=scale;grip.append(o)
ellipsoid('Grip palm',(0,-.035,0),(.044,.027,.059))
ellipsoid('Grip thumb',(-.033,-.001,.027),(.018,.032,.024))
for f in range(4):
 cu=bpy.data.curves.new('Curled finger','CURVE');cu.dimensions='3D';cu.bevel_depth=.009;cu.bevel_resolution=2;sp=cu.splines.new('POLY');sp.points.add(11)
 for i,pt in enumerate(sp.points):a=-.7+i/11*4.0;pt.co=(math.cos(a)*.033,-math.sin(a)*.033,(f-1.5)*.023,1)
 o=bpy.data.objects.new('Curled finger',cu);scene.collection.objects.link(o);bpy.ops.object.select_all(action='DESELECT');o.select_set(True);bpy.context.view_layer.objects.active=o;bpy.ops.object.convert(target='MESH');grip.append(bpy.context.object)
gp=[];gn=[]
for o in grip:
 for poly in o.data.polygons:poly.use_smooth=True
 o.data.calc_loop_triangles()
 for tri in o.data.loop_triangles:
  for li in tri.loops:
   co=o.matrix_world@o.data.vertices[o.data.loops[li].vertex_index].co;no=o.matrix_world.to_3x3()@o.data.corner_normals[li].vector;no.normalize();gp.extend([round(co.x,6),round(co.z,6),round(-co.y,6)]);gn.extend([round(no.x,5),round(no.z,5),round(-no.y,5)])
(ROOT/'outputs/toon-keeper-meshes.json').write_text(json.dumps(parts,separators=(',',':')))
(ROOT/'outputs/toon-grip.json').write_text(json.dumps({'p':gp,'n':gn},separators=(',',':')))
bpy.context.window.scene=old
result={'bodyParts':len(parts),'gripTriangles':len(gp)//9,'scene':scene.name}
