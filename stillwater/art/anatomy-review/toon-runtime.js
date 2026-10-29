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

 for(const part of KEEPER_PARTS){if(part.name==='Tailored continuous raincoat'||['skin','eyes','hair'].includes(part.material)||part.name==='Raised collar'||part.name.startsWith('Yoke seam'))continue;let geo=keeperGeometryCache.get(part.name);if(!geo){geo=new THREE.BufferGeometry();const vertices=part.p.slice();if(/patch pocket|Pocket welt|Coat placket|Wood toggle/.test(part.name)){const avgZ=vertices.filter((_,i)=>i%3===2).reduce((a,b)=>a+b,0)/(vertices.length/3);for(let i=0;i<vertices.length;i+=3){const x=vertices[i],y=vertices[i+1],r=y<.75?.30-(y-.57)*.139:y<.94?.275-(y-.75)*.132:y<1.065?.25-(y-.94)*.12:y<1.115?.235-(y-1.065)*1.6:.155-(y-1.115)*2.5;vertices[i+2]=Math.sqrt(Math.max(.001,r*r-x*x))*.71+.006+(vertices[i+2]-avgZ)}}geo.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));geo.setAttribute('normal',new THREE.Float32BufferAttribute(part.n,3));geo.setAttribute('uv',new THREE.Float32BufferAttribute(part.uv,2));keeperGeometryCache.set(part.name,geo)}const m=new THREE.Mesh(geo,materials[part.material]);m.name=part.name;m.castShadow=m.receiveShadow=true;(part.group.startsWith('hat')?hats[Number(part.group.slice(3))]:part.group==='scarf'?scarf:part.group==='glasses'?glasses:g).add(m)}

 // A compact sculpted head; its jaw sits directly above a short neck inside the collar.
 const headRoot=new THREE.Group();headRoot.position.y=-.055;g.add(headRoot);const faceRings=[
 [1.255,.035,.105,-.015],[1.278,.085,.130,-.055],[1.315,.126,.135,-.100],[1.350,.142,.119,-.128],[1.380,.148,.120,-.142],[1.398,.151,.130,-.148],[1.418,.153,.143,-.152],[1.445,.149,.135,-.155],[1.468,.144,.128,-.157],[1.518,.145,.139,-.150],[1.575,.128,.123,-.133],[1.625,.082,.080,-.085],[1.65,.005,.005,-.005]];
 const headVertices=[],headUV=[],headIndices=[],ringSides=64;
 for(let i=0;i<faceRings.length;i++){const [y,rx,front,back]=faceRings[i];for(let j=0;j<=ringSides;j++){const a=j/ringSides*Math.PI*2,cs=Math.cos(a),sn=Math.sin(a);const noseDepth=y<1.398?0:y<1.418?THREE.MathUtils.lerp(.025,.052,(y-1.398)/.02):y<1.468?THREE.MathUtils.lerp(.052,.018,(y-1.418)/.05):y<1.518?.008:0;headVertices.push(rx*sn,y,cs>=0?front*Math.pow(cs,.65)+noseDepth*Math.exp(-Math.pow(rx*sn/.029,2)):back*Math.pow(-cs,.85));headUV.push(j/ringSides,i/(faceRings.length-1));if(i<faceRings.length-1&&j<ringSides){const k=i*(ringSides+1)+j;headIndices.push(k,k+1,k+ringSides+1,k+1,k+ringSides+2,k+ringSides+1)}}}
 const headGeo=new THREE.BufferGeometry();headGeo.setAttribute('position',new THREE.Float32BufferAttribute(headVertices,3));headGeo.setAttribute('uv',new THREE.Float32BufferAttribute(headUV,2));headGeo.setIndex(headIndices);headGeo.computeVertexNormals();const head=mesh(headGeo,materials.skin,headRoot);head.name='Keeper head';
 const neck=mesh(new THREE.LatheGeometry([new THREE.Vector2(.103,1.105),new THREE.Vector2(.087,1.14),new THREE.Vector2(.067,1.19),new THREE.Vector2(.072,1.235)],32),materials.skin,g);neck.scale.z=.8;neck.position.z=-.008;
 const collar=mesh(new THREE.LatheGeometry([new THREE.Vector2(.118,1.11),new THREE.Vector2(.105,1.16),new THREE.Vector2(.091,1.165),new THREE.Vector2(.085,1.13)],32),materials.coat,g);collar.scale.z=.77;
 for(const side of [-1,1]){
  ball(headRoot,side*.153,1.423,-.002,.028,.043,.027,materials.skin).name='Ear';
  const eye=ball(headRoot,side*.066,1.471,.124,.025,.010,.012,0xd8ccb0);eye.name='Eyes';
  const iris=ball(headRoot,side*.066,1.471,.136,.009,.008,.005,0x34352e);iris.name='Eyes';
  const brow=tube(headRoot,[[side*.035,1.507,.132],[side*.064,1.513,.132],[side*.094,1.503,.119]],.009,materials.hair);brow.name='Brow';
 }
 const mouth=tube(headRoot,[[-.038,1.352,.113],[0,1.346,.123],[.038,1.356,.113]],.003,0x805b46);mouth.name='Face detail';
 const hairCap=mesh(new THREE.SphereGeometry(1,32,16,0,Math.PI*2,0,Math.PI*.57),materials.hair,headRoot,0,1.54,-.005);hairCap.scale.set(.157,.116,.144);
 for(let i=0;i<5;i++){const tuft=ball(headRoot,-.105+i*.048,1.56+Math.sin(i)*.008,.102,.037,.035,.029,materials.hair);tuft.rotation.z=-.25;}
 const coatBody=mesh(new THREE.LatheGeometry([new THREE.Vector2(.29,.54),new THREE.Vector2(.30,.57),new THREE.Vector2(.275,.75),new THREE.Vector2(.25,.94),new THREE.Vector2(.245,1.025),new THREE.Vector2(.223,1.065),new THREE.Vector2(.185,1.10),new THREE.Vector2(.135,1.13),new THREE.Vector2(.080,1.145)],32),materials.coat,g);coatBody.scale.z=.71;const rod=new THREE.Group();rod.position.set(.25,.89,.29);g.add(rod);
 tube(rod,[[0,-.23,0],[0,.3,0],[0,1,.035],[0,1.72,.14]],.012,0x435253);
 cyl(rod,0,-.08,0,.028,.031,.36,0xa57b48);cyl(rod,0,.14,0,.031,.031,.035,0x383e3b);
 const tip=new THREE.Object3D();tip.position.set(0,1.72,.14);rod.add(tip);
 const reel=new THREE.Group();reel.position.set(-.07,-.12,.02);rod.add(reel);ball(reel,0,0,0,.055,.068,.055,materials.metal);
 const crank=new THREE.Group();crank.position.x=-.06;reel.add(crank);stick(crank,new THREE.Vector3(),new THREE.Vector3(0,.065,0),.009,0x393e38);
 const handle=cyl(crank,-.018,.065,0,.016,.016,.075,0x393e38);handle.rotation.z=Math.PI/2;function makeGrip(radius){const hand=new THREE.Group();const palm=ball(hand,0,0,.034,.038,.052,.023,materials.skin);palm.name='Grip palm';const wristSkin=cyl(hand,0,-.062,.032,.025,.027,.052,materials.skin,16);wristSkin.scale.z=.82;wristSkin.name='Finger detail';
 for(let f=0;f<4;f++){const y=(f-1.5)*.021,points=[];for(let i=0;i<=12;i++){const a=-.45+i/12*3.95;points.push([Math.cos(a)*radius,y,-Math.sin(a)*radius])}const finger=tube(hand,points,.009,materials.skin);finger.name='Finger detail';}
 const thumb=tube(hand,[[-.032,.036,.028],[-.041,.018,.012],[-.031,.002,-.013],[-.014,-.008,-.022]],.011,materials.skin);thumb.name='Finger detail';return hand;}
 const right=makeGrip(.035);rod.add(right);const left=makeGrip(.026);left.position.set(-.018,.065,0);left.rotation.z=Math.PI/2;crank.add(left);
 const arms=[1,-1].map(side=>{const hand=side===1?right:left,wrist=new THREE.Object3D();wrist.position.set(0,-.080,.032);hand.add(wrist);const shoulder=new THREE.Vector3(side*.175,1.012,-.008);
 const geometry=new THREE.BufferGeometry(),rings=20,sides=16,positions=new Float32Array((rings+1)*(sides+1)*3),uv=[] ,indices=[];
 for(let i=0;i<=rings;i++)for(let j=0;j<=sides;j++){uv.push(j/sides,i/rings);if(i<rings&&j<sides){const k=i*(sides+1)+j;indices.push(k,k+1,k+sides+1,k+1,k+sides+2,k+sides+1)}}
 geometry.setAttribute('position',new THREE.BufferAttribute(positions,3));geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));geometry.setIndex(indices);const sleeve=mesh(geometry,materials.coat,g);sleeve.name='Continuous tailored sleeve';const cuff=cyl(g,0,0,0,.041,.043,.035,materials.coat,20);return {side,shoulder,wrist,hand,sleeve,cuff,rings,sides};});
 hats.forEach((h,i)=>{h.visible=i===anglerStyle.hat;h.position.y=-.055});glasses.position.y=-.03;scarf.scale.y=.75;scarf.position.y=.2675;glasses.visible=!!anglerStyle.glasses;scarf.visible=anglerStyle.scarf!==3;g.userData={materials,hats,scarf,glasses,rod,tip,crank,arms};poseKeeper(g,0,'idle',0,false,0);return g;
}
function poseKeeper(g,t,phase,phaseTime,pulling,strain){const d=g.userData;
 d.rod.rotation.set(.67+(phase==='cast'?-.95*Math.sin(Math.min(1,phaseTime/1.05)*Math.PI):phase==='reel'?-.22-strain*.16:0),0,-.32);
 d.crank.rotation.x=phase==='reel'&&pulling?t*6:0;
 g.rotation.x=phase==='reel'&&pulling?-.035:0;g.updateMatrixWorld(true);
 for(const a of d.arms){const wrist=g.worldToLocal(a.wrist.getWorldPosition(new THREE.Vector3())),shoulder=a.shoulder.clone();
 // A shaped upper arm and tapered forearm meet at a rounded but readable elbow.
 const elbow=new THREE.Vector3(a.side*.265,.815,.105);elbow.lerp(wrist,.06);
 const upper=new THREE.Vector3(a.side*.235,.925,.015);
 const fore=elbow.clone().lerp(wrist,.60);fore.y-=.012;
 const curve=new THREE.CatmullRomCurve3([shoulder,upper,elbow,fore,wrist],false,'centripetal');
 const pos=a.sleeve.geometry.attributes.position;
 for(let i=0;i<=a.rings;i++){const u=i/a.rings,center=curve.getPoint(u),tangent=curve.getTangent(u).normalize(),axis=new THREE.Vector3(0,0,1).cross(tangent).normalize(),normal=tangent.clone().cross(axis).normalize();const radius=(u<.16?THREE.MathUtils.lerp(.070,.077,u/.16):u<.48?THREE.MathUtils.lerp(.077,.063,(u-.16)/.32):THREE.MathUtils.lerp(.067,.043,(u-.48)/.52));
  for(let j=0;j<=a.sides;j++){const theta=j/a.sides*Math.PI*2,v=center.clone().addScaledVector(axis,Math.cos(theta)*radius).addScaledVector(normal,Math.sin(theta)*radius*.82*(1-.20*Math.exp(-Math.pow((u-.48)/.09,2))*Math.max(0,Math.sin(theta))));pos.setXYZ(i*(a.sides+1)+j,v.x,v.y,v.z)}}
 pos.needsUpdate=true;a.sleeve.geometry.computeVertexNormals();a.sleeve.geometry.computeBoundingSphere();a.cuff.position.copy(wrist);const worldHandRotation=a.hand.getWorldQuaternion(new THREE.Quaternion());a.cuff.quaternion.copy(g.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(worldHandRotation));
 }
}
