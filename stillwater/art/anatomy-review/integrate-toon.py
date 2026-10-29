from pathlib import Path
import json,re
s=Path('work/before-toon-keeper.html').read_text(encoding='utf-8')
a=s.index('const KEEPER_PARTS=');b=s.index('const KEEPER_CANVAS=',a)
s=s[:a]+'const KEEPER_PARTS='+Path('outputs/toon-keeper-meshes.json').read_text()+';\nconst KEEPER_GRIP='+Path('outputs/toon-grip.json').read_text()+';\n'+s[b:]
a=s.index('const keeperGeometryCache=');b=s.index('const fisher=',a)
s=s[:a]+Path('work/toon-runtime.js').read_text()+'\n'+s[b:]
a=s.index('const rod=new THREE.Group();rod.position.set(.30');b=s.index('const rodTip=',a)
s=s[:a]+'const rod=fisher.userData.rod;\n'+s[b:]
s=s.replace('rodTip.set(2.3,1.75,1.2).applyMatrix4(rod.matrixWorld)','fisher.userData.tip.getWorldPosition(rodTip)')
s=s.replace('new THREE.Vector3(2.3,1.75,1.2).applyMatrix4(rod.matrixWorld)','fisher.userData.tip.getWorldPosition(new THREE.Vector3())')
s=s.replace('castStart.copy(rodTip);','fisher.userData.tip.getWorldPosition(rodTip);castStart.copy(rodTip);')
s=s.replace('stateTime+=dt;waterMaterial','stateTime+=dt;poseKeeper(fisher,gameTime,state,stateTime,held,tension);waterMaterial')
s=re.sub(r' if\(!reduced\)\{rod.rotation.y\+=.*?\n','\n',s)
s=s.replace("if(modalMode==='wardrobe'){if(!reduced)","if(modalMode==='wardrobe'){poseKeeper(wardrobeAngler,now*.001,'idle',0,false,0);if(!reduced)")
s=s.replace('closePortrait?1.62:1.18,closePortrait?2.05:4.9','closePortrait?1.42:1.35,closePortrait?2.45:5.4').replace('closePortrait?1.43:.9','closePortrait?1.22:1.05')
s=s.replace("if(!reduced)wardrobeAngler.rotation.y=-.25+Math.sin(now*.00045)*.28;", "")
s=s.replace("wardrobeScene.add(wardrobeAngler);", "wardrobeScene.add(wardrobeAngler);")
s=s.replace("function openWardrobe(){", "function openWardrobe(){")
s=s.replace("keeperUI();const wardrobeScene", "keeperUI();const wardrobeScene")
s=s.replace("function wardrobeResize(){", "const turnControls=document.createElement('div');turnControls.style.cssText='position:absolute;bottom:40px;left:10px;right:10px;display:flex;justify-content:center;gap:5px;z-index:4';for(const [label,angle] of [['Front',0],['¾ view',.65],['Side',1.57]]){const b=document.createElement('button');b.textContent=label;b.style.cssText='border:1px solid #506657;border-radius:12px;background:#e4ddbd;color:#314c40;padding:6px 9px;font:12px Georgia';b.onclick=()=>{wardrobeAngler.rotation.y=angle;wardrobeResize()};turnControls.appendChild(b)}const handView=document.createElement('button');handView.textContent='Hands';handView.style.cssText='border:1px solid #506657;border-radius:12px;background:#e4ddbd;color:#314c40;padding:6px 9px;font:12px Georgia';handView.onclick=()=>{portraitClose=!portraitClose;wardrobeResize()};turnControls.appendChild(handView);$('anglerPortrait').appendChild(turnControls);function wardrobeResize(){")
s=s.replace("poseKeeper(wardrobeAngler,now*.001,'idle',0,false,0);", "poseKeeper(wardrobeAngler,now*.001,portraitPhase,portraitPhase==='cast'?.525:0,portraitPhase==='reel',.45);")
s=s.replace("const turnControls=", "let portraitPhase='idle',portraitClose=false;const motionControls=document.createElement('div');motionControls.style.cssText='position:absolute;bottom:73px;left:10px;right:10px;display:flex;justify-content:center;gap:5px;z-index:4';for(const [label,phase] of [['Rest','idle'],['Cast','cast'],['Reel','reel']]){const b=document.createElement('button');b.textContent=label;b.style.cssText='border:1px solid #506657;border-radius:12px;background:#e4ddbd;color:#314c40;padding:6px 9px;font:12px Georgia';b.onclick=()=>portraitPhase=phase;motionControls.appendChild(b)}$('anglerPortrait').appendChild(motionControls);const turnControls=")
s=s.replace("wardrobeCamera.updateProjectionMatrix()}", "if(portraitClose){wardrobeAngler.updateMatrixWorld(true);const focus=new THREE.Vector3();for(const a of wardrobeAngler.userData.arms)focus.add(a.hand.getWorldPosition(new THREE.Vector3()));focus.multiplyScalar(.5);wardrobeCamera.position.copy(focus).add(new THREE.Vector3(.03,.14,1.90));wardrobeCamera.lookAt(focus)}wardrobeCamera.updateProjectionMatrix()}")
s=s.replace("motionControls.style.cssText=", "motionControls.className='keeper-pose-controls';motionControls.style.cssText=")
s=s.replace("turnControls.style.cssText=", "turnControls.className='keeper-angle-controls';turnControls.style.cssText=")
s=s.replace("viewRenderer.setSize(r.width,r.height);wardrobeCamera.aspect=r.width/r.height;", "const ph=r.height-(innerWidth<=650?44:0);viewRenderer.setSize(r.width,ph);wardrobeCamera.aspect=r.width/ph;")
s=s.replace('</style>', '@media(max-width:650px){.wardrobe-modal .angler-portrait{min-height:284px!important}.angler-portrait canvas{height:calc(100% - 44px)!important}.keeper-pose-controls{bottom:6px!important;left:5px!important;right:auto!important;gap:2px!important}.keeper-angle-controls{bottom:6px!important;right:5px!important;left:auto!important;gap:2px!important}.keeper-pose-controls button,.keeper-angle-controls button{font-size:10px!important;padding:7px 5px!important}}\n</style>')
style='''
// Shared toon materials preserve customization colour references.
const toonRamp=new THREE.DataTexture(new Uint8Array([65,135,205,255]),4,1,THREE.RedFormat);toonRamp.needsUpdate=true;toonRamp.minFilter=toonRamp.magFilter=THREE.NearestFilter;
const inkMaterial=new THREE.MeshBasicMaterial({color:0x162326,side:THREE.BackSide});
inkMaterial.onBeforeCompile=s=>{inkMaterial.userData.shader=s;s.uniforms.inkViewport={value:new THREE.Vector2(1000,800)};s.vertexShader='uniform vec2 inkViewport;\\n'+s.vertexShader;s.vertexShader=s.vertexShader.replace('#include <project_vertex>','#include <project_vertex>\\nvec3 inkNormal=normalize(normalMatrix*normal);gl_Position.xy+=normalize(inkNormal.xy+vec2(0.00001))*(vec2(3.2)/inkViewport)*gl_Position.w;')};inkMaterial.customProgramCacheKey=()=> 'pond-ink-v2';
const toonMaterials=new Map();
function inkScene(root){const outline=inkMaterial.clone();outline.onBeforeCompile=shader=>{inkMaterial.onBeforeCompile(shader);outline.userData.shader=shader};outline.customProgramCacheKey=()=> 'pond-outline-v3';const meshes=[];root.traverse(m=>{if(m.isMesh&&!m.isInstancedMesh&&m.material.isMeshStandardMaterial&&!m.material.transparent)meshes.push(m)});for(const m of meshes){const old=m.material;let material=toonMaterials.get(old);if(!material){material=new THREE.MeshToonMaterial({map:old.map,gradientMap:toonRamp,side:old.side,vertexColors:old.vertexColors,alphaTest:old.alphaTest,emissiveIntensity:old.emissiveIntensity});material.onBeforeCompile=old.onBeforeCompile;material.color=old.color;material.emissive=old.emissive;toonMaterials.set(old,material)}m.material=material;if(!m.userData.ink&&m.name!=='Eyes'&&m.name!=='Superhero_Female'&&m.name!=='Face detail'&&m.name!=='Ear'&&m.name!=='Finger detail'&&m.name!=='Grip palm'){const edge=new THREE.Mesh(m.geometry,outline);edge.name='Ink silhouette';edge.onBeforeRender=renderer=>{if(outline.userData.shader)renderer.getSize(outline.userData.shader.uniforms.inkViewport.value)};edge.renderOrder=-1;m.add(edge);m.userData.ink=true}}}
inkScene(scene);inkScene(wardrobeScene);fishModels.forEach(inkScene);for(let i=0;i<fishModels.length;i++){viewScene.add(fishModels[i]);viewRenderer.render(viewScene,viewCamera);thumbs[i]=viewRenderer.domElement.toDataURL('image/png');viewScene.remove(fishModels[i])}
'''
s=s.replace("enter('idle');journalRender();",style+"enter('idle');journalRender();")
s=s.replace('v4.6.0','v4.8.0')
Path('outputs/index.html').write_text(s,encoding='utf-8')
script=re.findall(r'<script[^>]*>(.*?)</script>',s,re.S)[-1];Path('work/toon-check.js').write_text(script,encoding='utf-8')
import runpy
runpy.run_path('work/fix-cast-water.py')
runpy.run_path('work/integrate-fish.py')
