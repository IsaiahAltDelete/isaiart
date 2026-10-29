const keeperGeometryCache=new Map();
const keeperCanvas=new THREE.TextureLoader().load(KEEPER_CANVAS,()=>{worldDirty=true});keeperCanvas.colorSpace=THREE.SRGBColorSpace;keeperCanvas.wrapS=keeperCanvas.wrapT=THREE.RepeatWrapping;keeperCanvas.anisotropy=4;
const keeperEyes=new THREE.TextureLoader().load(KEEPER_EYES,()=>{worldDirty=true});keeperEyes.colorSpace=THREE.SRGBColorSpace;keeperEyes.flipY=false;
const keeperKnit=new THREE.TextureLoader().load(KEEPER_KNIT,()=>{worldDirty=true});keeperKnit.colorSpace=THREE.SRGBColorSpace;keeperKnit.wrapS=keeperKnit.wrapT=THREE.RepeatWrapping;keeperKnit.repeat.set(2,1);keeperKnit.anisotropy=4;
function makeAngler(portrait=false){
 const g=new THREE.Group(),materials={};
 for(const k of ['skin','coat','hair','scarf'])materials[k]=new THREE.MeshStandardMaterial({color:anglerOptions[k][anglerStyle[k]][1]??0xe9dec0,roughness:.85});
 materials.coat.map=keeperCanvas;
 materials.scarf.map=keeperKnit;materials.scarf.bumpMap=keeperKnit;materials.scarf.bumpScale=.003;
 Object.assign(materials,{trousers:new THREE.MeshStandardMaterial({color:0x7a8070,map:keeperCanvas,roughness:.95}),boots:new THREE.MeshStandardMaterial({color:0x8c785a,map:keeperCanvas,roughness:.72}),trim:new THREE.MeshStandardMaterial({color:0x706044,roughness:.8}),metal:new THREE.MeshStandardMaterial({color:0x9e8c61,metalness:.35,roughness:.65}),eyes:new THREE.MeshStandardMaterial({map:keeperEyes,roughness:.75})});
 for(const k of ['coat','trousers','boots']){materials[k].onBeforeCompile=shader=>{shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>','#ifdef USE_MAP\nvec4 sampledDiffuseColor=texture2D(map,vMapUv);diffuseColor*=vec4(mix(sampledDiffuseColor.rgb,vec3(1.0),0.26),sampledDiffuseColor.a);\n#endif')};materials[k].customProgramCacheKey=()=> 'keeper-tinted-weave-v2'}
 const hats=Array.from({length:3},()=>new THREE.Group()),scarf=new THREE.Group(),glasses=new THREE.Group();g.add(...hats,scarf,glasses);

 for(const part of KEEPER_PARTS){if(part.name==='Tailored continuous raincoat')continue;let geo=keeperGeometryCache.get(part.name);if(!geo){geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(part.p,3));geo.setAttribute('normal',new THREE.Float32BufferAttribute(part.n,3));geo.setAttribute('uv',new THREE.Float32BufferAttribute(part.uv,2));keeperGeometryCache.set(part.name,geo)}const m=new THREE.Mesh(geo,materials[part.material]);m.name=part.name;if(/patch pocket|Pocket welt|Coat placket|Wood toggle/.test(part.name))m.position.z+=.065;m.castShadow=m.receiveShadow=true;(part.group.startsWith('hat')?hats[Number(part.group.slice(3))]:part.group==='scarf'?scarf:part.group==='glasses'?glasses:g).add(m)}
 const coatBody=mesh(new THREE.LatheGeometry([new THREE.Vector2(.29,.54),new THREE.Vector2(.30,.57),new THREE.Vector2(.275,.75),new THREE.Vector2(.25,.94),new THREE.Vector2(.235,1.065),new THREE.Vector2(.155,1.115)],32),materials.coat,g);coatBody.scale.z=.71;const rod=new THREE.Group();rod.position.set(.25,.89,.29);g.add(rod);
 tube(rod,[[0,-.23,0],[0,.3,0],[0,1,.035],[0,1.72,.14]],.012,0x435253);
 cyl(rod,0,-.08,0,.028,.031,.36,0xa57b48);cyl(rod,0,.14,0,.031,.031,.035,0x383e3b);
 const tip=new THREE.Object3D();tip.position.set(0,1.72,.14);rod.add(tip);
 const reel=new THREE.Group();reel.position.set(-.07,-.12,.02);rod.add(reel);ball(reel,0,0,0,.055,.068,.055,materials.metal);
 const crank=new THREE.Group();crank.position.x=-.06;reel.add(crank);stick(crank,new THREE.Vector3(),new THREE.Vector3(0,.065,0),.009,0x393e38);
 const handle=cyl(crank,-.018,.065,0,.016,.016,.075,0x393e38);handle.rotation.z=Math.PI/2;const gripGeo=new THREE.BufferGeometry();gripGeo.setAttribute('position',new THREE.Float32BufferAttribute(KEEPER_GRIP.p,3));gripGeo.setAttribute('normal',new THREE.Float32BufferAttribute(KEEPER_GRIP.n,3));
 const right=new THREE.Mesh(gripGeo,materials.skin);rod.add(right);
 const left=new THREE.Mesh(gripGeo,materials.skin);left.position.set(-.018,.065,0);left.rotation.z=Math.PI/2;crank.add(left);
 const arms=[1,-1].map(side=>{const upper=cyl(g,0,0,0,.095,.078,1,materials.coat,12),lower=cyl(g,0,0,0,.078,.057,1,materials.coat,12),cuff=cyl(g,0,0,0,.060,.057,.065,materials.scarf,12);const shoulder=ball(g,side*.225,1.045,-.015,.085,.085,.085,materials.coat);const joint=ball(g,0,0,0,.077,.077,.077,materials.coat);return {side,upper,lower,cuff,shoulder,joint,hand:side===1?right:left}});
 hats.forEach((h,i)=>h.visible=i===anglerStyle.hat);glasses.visible=!!anglerStyle.glasses;scarf.visible=anglerStyle.scarf!==3;g.userData={materials,hats,scarf,glasses,rod,tip,crank,arms};poseKeeper(g,0,'idle',0,false,0);return g;
}
function poseKeeper(g,t,phase,phaseTime,pulling,strain){const d=g.userData;
 d.rod.rotation.set(.67+(phase==='cast'?-.95*Math.sin(Math.min(1,phaseTime/1.05)*Math.PI):phase==='reel'?-.22-strain*.16:0),0,-.32);
 d.crank.rotation.x=phase==='reel'&&pulling?t*6:0;
 g.rotation.x=phase==='reel'&&pulling?-.035:0;g.updateMatrixWorld(true);
 for(const a of d.arms){const hand=g.worldToLocal(a.hand.getWorldPosition(new THREE.Vector3()));const shoulder=a.shoulder.position.clone();const delta=hand.clone().sub(shoulder),dist=delta.length(),mid=shoulder.clone().add(hand).multiplyScalar(.5);const pole=new THREE.Vector3(a.side,-.3,-.45);pole.addScaledVector(delta,-pole.dot(delta)/Math.max(.0001,dist*dist)).normalize();const elbow=mid.addScaledVector(pole,Math.sqrt(Math.max(.003,.255*.255-dist*dist/4)));
 const segment=(m,p,q)=>{const v=q.clone().sub(p);m.position.copy(p).add(q).multiplyScalar(.5);m.scale.y=v.length();m.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),v.normalize())};a.joint.position.copy(elbow);segment(a.upper,shoulder,elbow);segment(a.lower,elbow,hand);a.cuff.position.copy(hand).lerp(elbow,.1);a.cuff.quaternion.copy(a.lower.quaternion);
 }
}
