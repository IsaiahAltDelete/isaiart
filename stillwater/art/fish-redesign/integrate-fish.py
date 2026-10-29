from pathlib import Path
import re
p=Path('outputs/index.html')
import runpy
runpy.run_path('work/expand-fish.py')
s=p.read_text(encoding='utf-8')
a=s.index('function makeFish(id){')
b=s.index('function animateFish(',a)
s=s[:a]+Path('work/fish-redesign.js').read_text(encoding='utf-8')+'\n'+s[b:]
if "if(a.type==='fishTail')" not in s:
    s=s.replace("if(a.type==='breathe')", "if(a.type==='fishTail'){m.rotation.y=s*.20}else if(a.type==='breathe')")
s=s.replace("get meshSource(){return 'Blender MCP / 6 sculpted bodies'}","get meshSource(){return 'Six continuous toon fish / procedural mesh source'}")
s=s.replace('Six continuous toon fish / procedural mesh source','Twelve continuous toon fish / procedural mesh source')
s=s.replace('>0/6<','>0/12<').replace('>0 / 6<','>0 / 12<')
s=s.replace("Those are its resting lips.", "That is its resting pout.")
s=s.replace("The hair keeps moving", "The trailing whiskers keep moving")
s=s.replace("He looks like someone you used to work with. The resemblance gets worse the longer you look. Please stop looking.", "A heavy brow. A resigned little frown. He has the air of someone who remembers when this pond was a much nicer neighbourhood.")
p.write_text(s,encoding='utf-8')
script=re.findall(r'<script[^>]*>(.*?)</script>',s,re.S)[-1]
Path('work/toon-check.js').write_text(script,encoding='utf-8')
# Standalone inspection sheet: no gameplay persistence or discovery changes.
three=Path('work/three-test.cjs').read_text(encoding='utf-8')
data=re.search(r'const fishData=\[.*?\n\];',s,re.S).group()
runtime=Path('work/fish-redesign.js').read_text(encoding='utf-8')
review='''<!doctype html><html><meta charset="utf-8"><title>Stillwater fish atelier</title>
<style>body{margin:0;background:#172f35;color:#e4ddbd;font:16px Georgia}header{padding:22px 30px}h1{margin:0 0 8px;font-size:26px}button{padding:10px 22px;background:#dfd7b6;color:#223f40;border:0;margin:10px 5px 0 0;cursor:pointer}main{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;padding:0 24px 24px}article{background:#456466;border:1px solid #82958b;border-radius:6px;overflow:hidden}h2{font-size:19px;margin:10px 16px}img{width:100%;display:block}p{margin:8px 16px;font:12px sans-serif}@media(max-width:700px){main{grid-template-columns:1fr}}</style>
<header><h1>Stillwater · specimen atelier</h1>Twelve pond residents / actual game meshes<button onclick="renderAll(0)">Front</button><button onclick="renderAll(.85)">¾ view</button><button onclick="renderAll(1.57)">Profile</button></header><main></main>
<script>'''+three+'</script><script>'+data+'\n'+runtime+'''
const renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});renderer.setSize(600,410);renderer.setPixelRatio(1);renderer.outputColorSpace=THREE.SRGBColorSpace;
const scene=new THREE.Scene();scene.background=new THREE.Color(0x456466);
scene.add(new THREE.HemisphereLight(0xffefd1,0x3b5963,2.1));const light=new THREE.DirectionalLight(0xffefd5,2.5);light.position.set(-3,6,5);scene.add(light);
const camera=new THREE.PerspectiveCamera(35,600/410,.1,40);camera.position.set(0,1.0,6.8);camera.lookAt(0,0,-.35);
const fish=fishData.map((_,i)=>makeFish(i));
for(let i=0;i<fish.length;i++){const card=document.createElement('article');card.innerHTML='<h2>'+fishData[i].name+'</h2><img id="fish'+i+'"><p>'+fishData[i].rarity+' · '+fishData[i].latin+'</p>';document.querySelector('main').appendChild(card)}
function renderAll(angle){for(let i=0;i<fish.length;i++){const f=fish[i];scene.add(f);f.userData.root.rotation.y=angle;renderer.render(scene,camera);document.getElementById('fish'+i).src=renderer.domElement.toDataURL();scene.remove(f)}}
renderAll(.85);
</script></html>'''
Path('outputs/fish-review.html').write_text(review,encoding='utf-8')
