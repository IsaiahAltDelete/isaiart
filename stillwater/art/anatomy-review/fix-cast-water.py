from pathlib import Path
import re

p = Path('outputs/index.html')
s = p.read_text(encoding='utf-8')
if 'function isCastWater(' not in s:
    insertion = """
// Use the rendered shoreline and the dock's actual footprint, including its posts.
const castShore = lakeShape.getPoints().map(p => [p.x, -p.y]);
dock.updateWorldMatrix(true, true);
const castDockBounds = new THREE.Box3(new THREE.Vector3(-3.85,-.3,-1.1),new THREE.Vector3(3.5,.7,1.1)).applyMatrix4(dock.matrixWorld);
function isCastWater(x,z,clearance=.18){
 if(!Number.isFinite(x)||!Number.isFinite(z))return false;
 if(x>=castDockBounds.min.x-clearance&&x<=castDockBounds.max.x+clearance&&z>=castDockBounds.min.z-clearance&&z<=castDockBounds.max.z+clearance)return false;
 let inside=false;
 for(let i=0,j=castShore.length-1;i<castShore.length;j=i++){
  const a=castShore[j],b=castShore[i],dx=b[0]-a[0],dz=b[1]-a[1];
  if(((a[1]>z)!==(b[1]>z))&&x<(b[0]-a[0])*(z-a[1])/(b[1]-a[1])+a[0])inside=!inside;
  const q=Math.max(0,Math.min(1,((x-a[0])*dx+(z-a[1])*dz)/(dx*dx+dz*dz||1)));
  if(Math.hypot(x-a[0]-q*dx,z-a[1]-q*dz)<clearance)return false;
 }
 return inside;
}
"""
    s=s.replace('function chooseAimOrigin(point){',insertion+'\nfunction chooseAimOrigin(point){')
    start=s.index('function chooseAimOrigin(point){')
    end=s.index('\nlet castAccuracy=',start)
    s=s[:start]+"""function chooseAimOrigin(point){
 aimOrigin.copy(point);aimOrigin.y=.46;
 // Check the whole timing sweep and the feeding-ring clearance.
 const safe=()=>{for(let i=0;i<=64;i++){const sweep=i/32-1;if(!isCastWater(aimOrigin.x+sweep*1.3,aimOrigin.z+sweep*.36,.65))return false}return true};
 for(let i=0;i<60&&!safe();i++)aimOrigin.lerp(new THREE.Vector3(3,.46,2.6),.16);
 if(!safe())aimOrigin.set(3,.46,2.6);
}"""+s[end:]
    s=s.replace("function startAim(){enter('aim')}","function startAim(){chooseAimOrigin(aimOrigin);enter('aim')}")
    s=s.replace("if(state!=='aim'||paused)return;const distance=aimPoint", "if(state!=='aim'||paused)return;if(!isCastWater(aimPoint.x,aimPoint.z)){toast('That cast needs open water. Try again.');return}const distance=aimPoint")
    s=s.replace("if(ray.ray.intersectPlane(plane,hit)&&inLake(hit.x,hit.z)){", """// A dock click must not pass through the boards onto the water below.
 const dockHit=ray.ray.intersectBox(castDockBounds,new THREE.Vector3());
 if(ray.ray.intersectPlane(plane,hit)&&(!dockHit||ray.ray.origin.distanceTo(dockHit)>ray.ray.origin.distanceTo(hit))&&isCastWater(hit.x,hit.z)){""")
    p.write_text(s,encoding='utf-8')
Path('work/toon-check.js').write_text(re.findall(r'<script[^>]*>(.*?)</script>',s,re.S)[-1],encoding='utf-8')
