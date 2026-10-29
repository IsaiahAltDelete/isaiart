function makeFish(id){
 const g=new THREE.Group(),root=new THREE.Group(),anim=[];g.add(root);
 // Closed, continuous silhouettes; the last section is the mouth rim.
 const designs=[
  {back:0x526f69,side:0x91aaa0,belly:0xd4ccac,fin:0xb98265,
   p:[[-1.85,.08,.12,0],[-1.35,.27,.35,0],[-.65,.66,.67,0],[.15,.85,.72,0],[.8,.76,.58,-.02],[1.2,.44,.32,-.12],[1.38,.32,.065,-.18]],eyeZ:.83,eyeY:.29,eyeS:.14},
  {back:0x355a52,side:0x84a27d,belly:0xe1cc98,fin:0xc49a58,
   p:[[-2.15,.09,.17,0],[-1.4,.23,.48,0],[-.6,.38,.85,.04],[.2,.51,.86,.03],[.85,.48,.65,0],[1.3,.36,.32,-.12],[1.55,.31,.20,-.15]],eyeZ:1.05,eyeY:.32,eyeS:.13},
  {back:0x343c5b,side:0x737c99,belly:0xb8b6bf,fin:0x9a8caa,
   p:[[-2.6,.025,.06,.08],[-1.9,.12,.23,.02],[-1.1,.22,.36,0],[-.25,.39,.47,0],[.6,.49,.48,0],[1.05,.36,.34,-.04],[1.28,.15,.13,-.07]],eyeZ:.78,eyeY:.24,eyeS:.12},
  {back:0x6a6741,side:0xb1a56c,belly:0xe0d2a2,fin:0x637f72,
   p:[[-1.1,.08,.15,0],[-.8,.33,.52,0],[-.3,.60,1.0,.02],[.3,.63,1.05,.01],[.8,.48,.72,-.03],[1.02,.22,.32,-.12],[1.12,.10,.15,-.14]],eyeZ:.75,eyeY:.32,eyeS:.135},
  {back:0x475e64,side:0x8ca2a2,belly:0xd3d0ba,fin:0x687c8a,
   p:[[-1.8,.10,.15,0],[-1.1,.40,.40,-.04],[-.4,.86,.60,-.03],[.35,1.01,.65,-.04],[.95,.90,.46,-.1],[1.28,.61,.23,-.25],[1.42,.43,.075,-.29]],eyeZ:.94,eyeY:.19,eyeS:.14},
  {back:0x1e3547,side:0x486975,belly:0x8caaa6,fin:0x577e87,
   p:[[-2.4,.055,.10,0],[-1.7,.20,.34,0],[-.85,.40,.61,.04],[0,.68,.83,.05],[.65,.84,.86,.02],[1.1,.76,.75,-.04],[1.34,.59,.58,-.10]],eyeZ:.83,eyeY:.58,eyeS:.095},
  {back:0x376e70,side:0x82b1a0,belly:0xddd0a4,fin:0xca8e61,
   p:[[-1.7,.07,.12,0],[-1.1,.32,.50,-.02],[-.4,.77,.92,.08],[.4,.85,.95,.09],[.95,.65,.62,.02],[1.3,.36,.26,-.14],[1.48,.19,.09,-.17]],eyeZ:.98,eyeY:.34,eyeS:.12},
  {back:0x4f566d,side:0x9c9cac,belly:0xd8c9c0,fin:0x85869a,eyeUp:true,
   p:[[-1.25,.04,.035,0],[-.90,.40,.075,0],[-.35,1.60,.14,0],[.05,1.95,.18,0],[.65,1.02,.23,0],[1.15,.48,.15,0],[1.55,.055,.035,0]],eyeZ:.73,eyeY:.17,eyeS:.10},
  {back:0x3c637b,side:0xafc9cc,belly:0xe2e0cf,fin:0x7089a7,
   p:[[-2.2,.04,.08,0],[-1.6,.10,.20,0],[-.65,.24,.36,0],[.35,.31,.38,0],[1.15,.25,.28,0],[1.8,.09,.075,-.01],[2.05,.05,.035,-.01]],eyeZ:1.15,eyeY:.12,eyeS:.095},
  {back:0x513b58,side:0xa9656e,belly:0xe0ac8b,fin:0xcf947a,
   p:[[-1.3,.07,.14,0],[-.9,.20,.52,0],[-.3,.43,.98,.04],[.45,.48,1.1,.02],[1.02,.37,.66,0],[1.3,.16,.25,-.08],[1.42,.085,.085,-.08]],eyeZ:.98,eyeY:.30,eyeS:.10},
  {back:0x354e51,side:0x799f92,belly:0xc4ceaf,fin:0xa1b69d,
   p:[[-3.0,.018,.025,.28],[-2.4,.07,.11,.01],[-1.65,.14,.19,-.18],[-.7,.23,.27,-.10],[.35,.34,.34,.08],[1.05,.32,.28,.12],[1.45,.17,.12,.08],[1.6,.085,.04,.07]],eyeZ:1.16,eyeY:.24,eyeS:.09},
  {back:0x475347,side:0x98a37c,belly:0xd5c6a0,fin:0xa88c61,
   p:[[-1.65,.07,.10,0],[-1.1,.23,.39,0],[-.35,.49,.63,.01],[.45,.60,.67,.04],[1,.48,.45,-.02],[1.36,.24,.19,-.05],[1.49,.11,.055,-.07]],eyeZ:1.0,eyeY:.23,eyeS:.12}
 ];
 const d=designs[id],P=d.p,TA=Math.PI*2;
 const ramp=new THREE.DataTexture(new Uint8Array([75,150,215,255]),4,1,THREE.RedFormat);ramp.needsUpdate=true;ramp.minFilter=ramp.magFilter=THREE.NearestFilter;
 const material=(c,extra={})=>new THREE.MeshToonMaterial({color:c,gradientMap:ramp,...extra});
 const skin=material(0xffffff,{vertexColors:true}),finMaterial=material(d.fin,{side:THREE.DoubleSide});
 const ink=material(0x23373b),lip=material(id===0?0xb78f78:id===5?0x3c5966:d.side);
 const bone=material(0xe9dbb2),irisMat=material(id===5?0xb9dcbb:0xd8b575),pupilMat=new THREE.MeshBasicMaterial({color:0x182c31});
 const outlineMaterial=new THREE.MeshBasicMaterial({color:0x1c3035,side:THREE.BackSide});
 function add(geo,mat,parent=root){const m=new THREE.Mesh(geo,mat);parent.add(m);m.castShadow=true;m.receiveShadow=true;return m}
 function outline(m,size=1.025){const edge=new THREE.Mesh(m.geometry,outlineMaterial);edge.scale.setScalar(size);edge.name='Fish silhouette';m.add(edge);return m}
 function ell(parent,x,y,z,sx,sy,sz,mat){const m=add(new THREE.SphereGeometry(1,24,16),mat,parent);m.position.set(x,y,z);m.scale.set(sx,sy,sz);return m}
 function stroke(parent,pts,r,mat=ink){return add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map(p=>new THREE.Vector3(...p))),32,r,6,false),mat,parent)}
 function sculptedStroke(parent,pts,r,mat,radiusAt){
  const curve=new THREE.CatmullRomCurve3(pts.map(p=>new THREE.Vector3(...p))),geo=new THREE.TubeGeometry(curve,48,r,10,false),p=geo.attributes.position;
  for(let j=0;j<=48;j++){const c=curve.getPointAt(j/48),scale=radiusAt(j/48);for(let k=0;k<=10;k++){const n=j*11+k;p.setXYZ(n,c.x+(p.getX(n)-c.x)*scale,c.y+(p.getY(n)-c.y)*scale,c.z+(p.getZ(n)-c.z)*scale)}}
  geo.computeVertexNormals();return add(geo,mat,parent);
 }
 function profile(z){
  let i=1;while(i<P.length-1&&z>P[i][0])i++;
  const a=P[i-1],b=P[i],t=THREE.MathUtils.clamp((z-a[0])/(b[0]-a[0]),0,1);
  // Catmull-Rom interpolation avoids a swollen "beads on a string" profile.
  const prev=P[Math.max(0,i-2)],next=P[Math.min(P.length-1,i+1)];
  return [1,2,3].map(k=>THREE.MathUtils.lerp(a[k],b[k],t)+t*(1-t)*((1-t)*(b[k]-prev[k])*.22+t*(a[k]-next[k])*.22));
 }
 function mouthShape(a,w,h,cy,z){
  const x=Math.cos(a)*w;
  const sy=Math.sin(a);
  const expression=id===6?.025*Math.cos(a)**2:id===9?-.025*Math.cos(a)**2:id===11?.015*Math.cos(a)**2:0;
  return [id===5?x*(1+.08*sy):x,cy+sy*h*(id===5?(sy>0?.62:.96):1)+(id===0?-.11*Math.cos(a)**2:id===4?-.055*Math.cos(a)**2:expression),
   z+(id===5?(sy<0?-.30*sy:.025*sy)-.24*Math.pow(Math.abs(Math.cos(a)),5):0)];
 }
 const pos=[],col=[],uv=[],idx=[],rows=72,sides=48;
 const back=new THREE.Color(d.back),sideColor=new THREE.Color(d.side),belly=new THREE.Color(d.belly);
 for(let j=0;j<=rows;j++){
  const v=j/rows,z=THREE.MathUtils.lerp(P[0][0],P.at(-1)[0],v),[w,h,cy]=profile(z);
  for(let i=0;i<=sides;i++){
   const u=i/sides,a=u*TA,sy=Math.sin(a),sx=Math.cos(a);
   const mouthBlend=Math.max(0,(v-.86)/.14),mp=mouthShape(a,w,h,cy,z);
   const surfaceY=id===7?(sy>=0?h*(1-Math.abs(sx)):sy*h*.30)+cy:sy*h+cy;
   pos.push(THREE.MathUtils.lerp(sx*w,mp[0],mouthBlend),THREE.MathUtils.lerp(surfaceY,mp[1],mouthBlend),THREE.MathUtils.lerp(z,mp[2],mouthBlend));uv.push(u,v);
   const c=sideColor.clone().lerp(sy>0?back:belly,Math.pow(Math.abs(sy),.8)*.85);
   // Painted flank markings, constrained to the skin rather than floating bumps.
   let pattern=0;
   if(id===1)pattern=Math.pow(Math.max(0,Math.cos(z*9+sy*.8)),12)*.26*(1-Math.abs(sy))*(v<.8?1:0);
   if(id===3)pattern=(Math.exp(-Math.pow((z+.35)/.16,2))+Math.exp(-Math.pow((z+.72)/.12,2)))*.48*(1-Math.abs(sy)*.7);
   if(id===2)pattern=Math.exp(-Math.pow((sy-.15)*12,2))*.16;
   if(id===0)pattern=Math.pow(Math.max(0,Math.cos(z*17+Math.floor(u*16)*.8)*Math.cos(a*16)),22)*.13*(sy>.15&&z<.3?1:0);
   if(id===4)pattern=Math.exp(-Math.pow((sy-.40)/.13,2))*.22*(z<.95?1:0);
   if(id===6)pattern=Math.exp(-Math.pow((z+.30)/.24,2))*.50;
   if(id===7)pattern=(sy>0&&Math.abs(sx)>.70?.16:0)+(sy>0&&z<-.3?.08:0);
   if(id===8)pattern=Math.exp(-Math.pow((sy-.08)/.16,2))*.36;
   if(id===9)pattern=0;
   if(id===10)pattern=Math.exp(-Math.pow((sy-.25)/.14,2))*.18;
   if(id===11)pattern=Math.pow(Math.max(0,Math.cos(z*9-sy*2)),8)*.23;
   c.multiplyScalar(1-pattern);
   // Large painted boundaries survive the game camera; these are not light/shadow bands.
   if(id===3&&((z>-.63&&z<-.40)||(z>-.12&&z<.10)))c.copy(new THREE.Color(0x66785a));
   if(id===6&&z>.10&&z<.48)c.copy(new THREE.Color(0xe0c396));
   if(id===9&&z>-.24&&z<.08)c.copy(new THREE.Color(0xf0c295));
   if(id===7&&sy>=0)c.copy(new THREE.Color(Math.abs(sx)>.60?(sx>0?0xb3aebd:0x9697ae):(sx>0?0x8b8da6:0xa5a5b6)));
   col.push(c.r,c.g,c.b);
   if(j<rows&&i<sides){const q=j*(sides+1)+i;idx.push(q,q+1,q+sides+1,q+1,q+sides+2,q+sides+1)}
  }
 }
 const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));geo.setAttribute('color',new THREE.Float32BufferAttribute(col,3));geo.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));geo.setIndex(idx);geo.computeVertexNormals();
 const body=outline(add(geo,skin),1.018);body.name=fishData[id].name+' • continuous body';
 // Mouth cup joins the body's open rim. Narrow lips retain the species expression.
 const [zm,mw,mh,my]=P.at(-1),rim=[];
 for(let i=0;i<=64;i++){const a=i/64*TA;rim.push(mouthShape(a,mw,mh,my,zm+.008))}
 // The Below's jaw is part of the body loft; only a fine edge marks its opening.
 stroke(root,rim,id===5?.012:id===0?.037:id===1?.020:.012,id===5?ink:id===1?material(0x7b8964):lip);
 const cupP=[],cupI=[],cupColors=[];
 for(let j=0;j<=12;j++)for(let i=0;i<=64;i++){
  const a=i/64*TA,k=1-j/12,mp=mouthShape(a,mw,mh,my,zm);
  cupP.push(mp[0]*k,my+(mp[1]-my)*k,THREE.MathUtils.lerp(zm-(id===5?.75:.3),mp[2],k));
  const tissue=new THREE.Color(0x202e35);if(id===5)tissue.lerp(new THREE.Color(0x4b4655),Math.max(0,-Math.sin(a))*Math.sin((1-k)*Math.PI)*.70);cupColors.push(tissue.r,tissue.g,tissue.b);
  if(j<12&&i<64){const q=j*65+i;cupI.push(q,q+1,q+65,q+1,q+66,q+65)}
 }
 const cup=new THREE.BufferGeometry();cup.setAttribute('position',new THREE.Float32BufferAttribute(cupP,3));cup.setAttribute('color',new THREE.Float32BufferAttribute(cupColors,3));cup.setIndex(cupI);cup.computeVertexNormals();add(cup,new THREE.MeshBasicMaterial({vertexColors:true,side:THREE.DoubleSide}));
 if(id===5){
  // A narrow interior gum shelf follows the jaw; darker tissue recedes behind it.
  const gp=[],gi=[];
  for(let row=0;row<2;row++)for(let i=0;i<=64;i++){const a=i/64*TA,mp=mouthShape(a,mw,mh,my,zm),k=row?.86:.99;gp.push(mp[0]*k,my+(mp[1]-my)*k,mp[2]-(row?.12:.012));if(row===0&&i<64)gi.push(i,i+1,i+65,i+1,i+66,i+65)}
  const gg=new THREE.BufferGeometry();gg.setAttribute('position',new THREE.Float32BufferAttribute(gp,3));gg.setIndex(gi);gg.computeVertexNormals();add(gg,new THREE.MeshBasicMaterial({color:0x46505a,side:THREE.DoubleSide}));
 }
 function eyeAt(z,y,sign,size,blind=false){
  const [w,h,cy]=profile(z),localY=(y-cy)/h,x=sign*w*Math.sqrt(Math.max(.04,1-localY*localY));
  const e=new THREE.Group();e.position.set(x,y,z);root.add(e);
  const normal=new THREE.Vector3(sign*(d.eyeUp?.25:.78),d.eyeUp?.88:.18,.63).normalize();e.quaternion.setFromUnitVectors(new THREE.Vector3(0,0,1),normal);
  ell(e,0,0,-.025,size*1.18,size*1.08,size*.4,ink);
  ell(e,0,0,0,size,size*.89,size*.39,blind?material(0xc5d3bf):id===3?bone:irisMat);
  ell(e,0,0,size*.34,size*(id===3?.47:.29),size*(id===0?.45:.64),.012,blind?material(0x869f9a):pupilMat);
  ell(e,-size*.22,size*.26,size*.4,size*.13,size*.13,.013,new THREE.MeshBasicMaterial({color:0xf4e5c5}));
  if([0,1,2,4,6,8,9,10,11].includes(id)){
   const lid=new THREE.Shape();lid.moveTo(-size*1.05,size*.05);lid.quadraticCurveTo(0,size*(id===4?-.1:.13),size*1.05,size*.05);lid.quadraticCurveTo(size,size*1.05,0,size*1.10);lid.quadraticCurveTo(-size,size*1.05,-size*1.05,size*.05);
   const lm=add(new THREE.ShapeGeometry(lid),material(d.back),e);lm.position.z=size*.43;
   if(id===1||id===11)e.rotation.z=sign*.16;
   if(id===6||id===9){lm.scale.y=.60;lm.position.y=size*.32}
   if(id===8){e.scale.y=.68}
   stroke(e,[[-size,size*.05,size*.44],[0,size*(id===4?-.03:.09),size*.44],[size,size*.05,size*.44]],.009,ink);
  }
  return e;
 }
 for(const sign of [-1,1])eyeAt(d.eyeZ,d.eyeY,sign,d.eyeS,id===2&&sign===-1);
 if(id===3){for(const sign of [-1,1]){eyeAt(.48,.64,sign,.105);eyeAt(.05,.76,sign,.09)}
  const seventh=new THREE.Group();root.add(seventh);seventh.position.set(0,.90,.31);seventh.rotation.x=-Math.PI/2;
  ell(seventh,0,0,0,.105,.1,.035,ink);ell(seventh,0,0,.02,.083,.075,.025,irisMat);ell(seventh,0,0,.04,.024,.052,.01,pupilMat);
 }
 // Fins grow from narrow roots; membrane, perimeter and rays share the same geometry.
 function fin(points,parent=root,rays=true){
  const vertices=points.flat();
  const span=[0,1,2].map(k=>Math.max(...points.map(p=>p[k]))-Math.min(...points.map(p=>p[k])));
  const axes=[0,1,2].sort((a,b)=>span[b]-span[a]).slice(0,2);
  const indices=THREE.ShapeUtils.triangulateShape(points.map(p=>new THREE.Vector2(p[axes[0]],p[axes[1]])),[]).flat();
  const fg=new THREE.BufferGeometry();fg.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));fg.setIndex(indices);fg.computeVertexNormals();
  const f=add(fg,finMaterial,parent);
  stroke(parent,[...points,points[0]],.013,ink);
  if(rays)for(let i=2;i<points.length-1;i+=id===4?2:1){const p=points[i],a=points[0];stroke(parent,[a,[(a[0]+p[0])*.5,(a[1]+p[1])*.5+.018,(a[2]+p[2])*.5],p],.009,material(d.back))}
  return f;
 }
 function pectoral(points,parent,sign){
  // A two-sided loft with a thick buried base, a curved fold, and a thin outer edge.
  const edge=new THREE.CatmullRomCurve3(points.slice(1,-1).map(p=>new THREE.Vector3(...p))),rows=18,cols=24,positions=[],indices=[];
  function at(u,v,side){
   const tip=edge.getPoint(v),base=id===7?new THREE.Vector3(-sign*.26,.035,.60-1.40*v):new THREE.Vector3(-sign*.07,-.13*v,-.20*v);
   const p=base.lerp(tip,u);p.y+=Math.sin(u*Math.PI)*.095*Math.sin(v*Math.PI);
   p.y+=side*(.045*Math.pow(1-u,2)+.003)*Math.sin(v*Math.PI);return p;
  }
  for(const side of [-1,1])for(let j=0;j<=rows;j++)for(let i=0;i<=cols;i++){positions.push(...at(j/rows,i/cols,side).toArray())}
  const layer=(rows+1)*(cols+1);
  for(let side=0;side<2;side++)for(let j=0;j<rows;j++)for(let i=0;i<cols;i++){
   const a=side*layer+j*(cols+1)+i,b=a+1,c=a+cols+1,e=c+1;
   indices.push(...(side?[a,b,c,b,e,c]:[a,c,b,b,c,e]));
  }
  for(let i=0;i<cols;i++){const a=rows*(cols+1)+i;indices.push(a,a+1,a+layer,a+1,a+layer+1,a+layer)}
  const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geo.setIndex(indices);geo.computeVertexNormals();add(geo,finMaterial,parent);
  const border=[];for(let i=0;i<=24;i++)border.push(at(1,i/24,1).toArray());stroke(parent,border,.009,ink);
  for(const v of [.18,.39,.61,.82])for(const face of [-1,1]){const ray=[];for(let i=3;i<=18;i++)ray.push(at(i/18,v,face).add(new THREE.Vector3(0,face*.009,0)).toArray());stroke(parent,ray,.009,material(d.back))}
 }
 const tail=new THREE.Group();tail.position.set(0,P[0][3],P[0][0]+.05);root.add(tail);
 const th=id===2||id===10?.26:id===1||id===8?.8:id===3||id===9?.40:.60,tl=id===2||id===10?.55:id===3?.5:.85;
 const tailPoints=id===2?[[0,0,.1],[0,.16,-.25],[.02,.14,-.52],[.02,0,-.82],[.02,-.12,-.49],[0,-.13,-.22]]:
  id===0||id===4?[[0,0,.1],[0,.17,-.12],[.02,th*.77,-tl*.6],[.03,th*.9,-tl*.85],[.04,th*.5,-tl],[.04,0,-tl*1.06],[.04,-th*.5,-tl],[.03,-th*.9,-tl*.85],[.02,-th*.77,-tl*.6],[0,-.17,-.12]]:
  id===5?[[0,0,.1],[0,.13,-.14],[.02,.33,-.47],[.04,0,-1.0],[.02,-.33,-.47],[0,-.13,-.14]]:
  [[0,0,.10],[0,.17,-.12],[.025,th,-tl],[.04,.12,-tl*.78],[.04,0,-tl*.58],[.04,-.12,-tl*.78],[.025,-th,-tl],[0,-.17,-.12]];
 if(id===7){sculptedStroke(tail,[[0,0,0],[0,-.03,-.55],[.07,.04,-1.15],[.11,.16,-1.65]],.055,material(d.back),t=>1-t*.94)}
 else fin(tailPoints,tail);
 anim.push({m:tail,type:'fishTail',phase:id});
 const crest=[];
 const z0=P[0][0]+.5,z1=.5;
 for(let i=0;i<=8;i++){const z=THREE.MathUtils.lerp(z0,z1,i/8),p=profile(z);crest.push([0,p[1]+p[2]-.025,z])}
 for(let i=8;i>=0;i--){const z=THREE.MathUtils.lerp(z0,z1,i/8),p=profile(z),rise=Math.sin(i/8*Math.PI)*(id===1?(i%2?.73:.52):id===2?.16:id===4?.21:.33);crest.push([0,p[1]+p[2]+rise,z])}
 if(id!==7&&id!==11)fin(crest);
 if(id===11){
  const crownZ=[-1.0,-.72,-.38,.12,.55],height=[.16,.63,.90,.72,.25],crown=[];
  for(let i=0;i<crownZ.length;i++){const z=crownZ[i],p=profile(z);crown.push([0,p[1]+p[2]-.02,z])}
  for(let i=crownZ.length-1;i>=0;i--){const z=crownZ[i],p=profile(z);crown.push([0,p[1]+p[2]+height[i],z-.14*height[i]]);if(i>0){const mid=(z+crownZ[i-1])/2,pm=profile(mid);crown.push([0,pm[1]+pm[2]+.20,mid])}}
  fin(crown,root,false);
  for(let i=1;i<4;i++){const z=crownZ[i],p=profile(z);stroke(root,[[.006,p[1]+p[2]+.02,z],[.006,p[1]+p[2]+height[i],z-.14*height[i]]],.009,material(d.back))}
 }
 if(id===7){const p=profile(.05);for(const sign of [-1,1])stroke(root,[[0,p[1]+.006,.05],[sign*p[0]*.5,p[1]*.5+.006,.05],[sign*p[0],.006,.05]],.008,material(0x646b80));}
 for(const sign of [-1,1]){
  const f=new THREE.Group(),z=.30,p=profile(z);f.position.set(sign*p[0]*(id===7?.72:.88),id===7?-.025:-.18,z);root.add(f);
  const fp=id===0?[[0,0,0],[sign*.20,.05,-.12],[sign*.48,-.10,-.45],[sign*.52,-.27,-.64],[sign*.43,-.44,-.70],[sign*.20,-.48,-.61],[0,-.16,-.18]]:
   id===1?[[0,0,0],[sign*.13,.03,-.12],[sign*.46,-.17,-.56],[sign*.30,-.55,-.90],[sign*.10,-.41,-.48],[0,-.16,-.18]]:
   id===2?[[0,0,0],[sign*.22,.05,-.10],[sign*.54,-.07,-.48],[sign*.40,-.29,-.88],[sign*.16,-.24,-.66],[0,-.12,-.2]]:
   id===3?[[0,0,0],[sign*.12,.04,-.04],[sign*.30,-.10,-.24],[sign*.34,-.25,-.39],[sign*.16,-.36,-.34],[0,-.13,-.10]]:
   id===4?[[0,0,0],[sign*.30,.08,-.06],[sign*.65,.03,-.27],[sign*.76,-.15,-.45],[sign*.60,-.31,-.67],[sign*.32,-.32,-.74],[0,-.12,-.26]]:
   [[0,0,0],[sign*.24,.10,-.14],[sign*.69,.02,-.34],[sign*.55,-.19,-.43],[sign*.68,-.41,-.76],[sign*.26,-.36,-.72],[0,-.15,-.19]];
  let speciesFin=fp;
  if(id===6)speciesFin=[[0,0,0],[sign*.20,.08,-.10],[sign*.60,.02,-.35],[sign*.66,-.20,-.60],[sign*.44,-.40,-.66],[sign*.10,-.30,-.38],[0,-.12,-.1]];
  if(id===7)speciesFin=[[0,0,0],[sign*.30,.06,.48],[sign*1.15,.22,-.04],[sign*1.50,.16,-.42],[sign*.90,-.02,-1.12],[sign*.18,-.04,-1.0],[0,0,-.30]];
  if(id===8)speciesFin=[[0,0,0],[sign*.1,0,-.08],[sign*.38,-.08,-.35],[sign*.25,-.3,-.62],[sign*.05,-.22,-.35],[0,-.1,-.15]];
  if(id===9)speciesFin=[[0,0,0],[sign*.14,.08,-.1],[sign*.44,-.06,-.35],[sign*.30,-.55,-.95],[sign*.06,-.39,-.48],[0,-.1,-.15]];
  if(id===10)speciesFin=[[0,0,0],[sign*.12,.02,-.08],[sign*.3,-.08,-.30],[sign*.26,-.20,-.40],[sign*.08,-.18,-.30],[0,-.1,-.1]];
  if(id!==7){pectoral(speciesFin,f,sign);anim.push({m:f,type:'fin',phase:sign})}
  // Gill covers follow the body surface at each sample.
  const gill=[];
  for(let i=0;i<=12;i++){const a=-.65+i/12*1.15,z=.39-.1*Math.sin(i/12*Math.PI),p=profile(z);gill.push([sign*Math.cos(a)*p[0]*1.012,p[2]+Math.sin(a)*p[1],z])}
  if(id!==7)stroke(root,gill,.011,ink);
  const lateral=[];
  for(let i=0;i<=14;i++){const z=P[0][0]+.4+i/14*(.3-P[0][0]-.4),p=profile(z);lateral.push([sign*p[0]*1.006,p[2],z])}
  if(id!==7)stroke(root,lateral,.009,material(d.back));
 }
 if(id===1){for(const sign of [-1,1])for(let i=0;i<4;i++){
  const x=(i-1.5)*.132+(sign<0?.018:0),h=.085+((i+ (sign>0?1:0))%3)*.016,w=.047+(i===1?.008:0);
  const gumY=my+sign*mh*Math.sqrt(1-(x/mw)**2);
  const tooth=ell(root,x,gumY-sign*h*.23,zm-.018,w,h*.65,.044,bone);
  tooth.rotation.z=(i-1.5)*.13;tooth.name='Rounded irregular molar';
  if(i===1||i===2)stroke(root,[[x-.020,gumY-sign*h*.42,zm+.021],[x,gumY-sign*h*.52,zm+.027],[x+.017,gumY-sign*h*.40,zm+.021]],.004,material(0xaaa183));
 }}
 if(id===5){
  for(let i=0;i<14;i++){const a=(i/14+.012*Math.sin(i*4))*TA,mp=mouthShape(a,mw*.92,mh*.92,my,zm),len=.10+(i%4)*.041;
   const tooth=add(new THREE.ConeGeometry(.023,len,7),bone);tooth.position.set(mp[0],mp[1],mp[2]-.035);tooth.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),new THREE.Vector3(-Math.cos(a)*.4,-Math.sin(a),-.14).normalize());
  }
  const lure=new THREE.Group();root.add(lure);lure.position.set(0,.75,.35);
  stroke(lure,[[0,0,0],[0,.58,.05],[0,.89,.5],[0,.67,1.08]],.025,material(d.side));
  ell(lure,0,.61,1.09,.105,.14,.105,new THREE.MeshToonMaterial({color:0xe5efb1,emissive:0xb0d69d,emissiveIntensity:.65,gradientMap:ramp}));
  anim.push({m:lure,type:'lure',phase:0});
  for(const sign of [-1,1])for(let i=0;i<6;i++){const z=-1.2+i*.29,p=profile(z);ell(root,sign*p[0]*.98,-p[1]*.16+p[2],z,.025,.025,.04,material(0xb5d6b6))}
 }
 if(id===9){const glow=new THREE.MeshToonMaterial({color:0xffdea0,emissive:0xe1b464,emissiveIntensity:.55,gradientMap:ramp});
  for(const sign of [-1,1])for(let i=0;i<7;i++){const z=-.70+i*.23,p=profile(z);ell(root,sign*p[0]*.87,p[2]-p[1]*.47,z,.035,.044,.045,glow)}
 }
 if(id===6){for(const sign of [-1,1])sculptedStroke(root,[[sign*.16,-.15,1.43],[sign*.30,-.30,1.55],[sign*.40,-.48,1.43]],.028,material(d.fin),t=>1-t*.85)}
 if(id===2||id===4){
  const n=id===2?6:2;
  for(let i=0;i<n;i++){
   const sign=i%2?1:-1,k=Math.floor(i/2),z=id===2?.98-k*.23+(sign>0?.045:0):1.25,p=profile(z);
   const strand=new THREE.Group();strand.position.set(sign*p[0]*.52,-p[1]*.50+p[2],z);root.add(strand);
   const length=id===2?[1.05,.72,1.24,.88][k]:.56;
   const points=[[0,.10,-.06],[sign*.07,-length*.22,-.01],[sign*(.22+k*.06),-length*.64,-.13-k*.16],[sign*(.12+k*.10),-length,-.28-k*.22]];
   const curve=new THREE.CatmullRomCurve3(points.map(p=>new THREE.Vector3(...p)));
   const tg=new THREE.TubeGeometry(curve,24,id===2?.045:.031,8,false);
   const pa=tg.attributes.position;
   for(let j=0;j<=24;j++){const c=curve.getPointAt(j/24),scale=1-j/24*.92;for(let k=0;k<=8;k++){const ix=j*9+k;pa.setXYZ(ix,c.x+(pa.getX(ix)-c.x)*scale,c.y+(pa.getY(ix)-c.y)*scale,c.z+(pa.getZ(ix)-c.z)*scale)}}
   tg.computeVertexNormals();
   if(id===2){
    const colors=[],base=new THREE.Color(d.side).lerp(new THREE.Color(d.belly),.66),tip=new THREE.Color(d.fin);
    for(let j=0;j<=24;j++){const t=THREE.MathUtils.smoothstep(j/24,.18,.65),c=base.clone().lerp(tip,t);for(let q=0;q<=8;q++)colors.push(c.r,c.g,c.b)}
    tg.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));add(tg,material(0xffffff,{vertexColors:true}),strand);
   }else add(tg,material(d.back),strand);
   anim.push({m:strand,type:'tendril',phase:i*.6});
  }
 }
 root.rotation.y=-.28;if(id===7)root.rotation.x=.42;root.scale.setScalar(id===2||id===10?.88:id===5||id===7?.90:1);
 g.userData={root,id,anim};return g;
}
