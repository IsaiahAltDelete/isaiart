// Shared, seamless roof albedo and height maps. Four tiles span one world unit;
// an even number of staggered courses keeps both edges of the repeat aligned.
import * as THREE from '../vendor/three.module.min.js';
import { mulberry32 } from './rng.js';

const SIZE = 512, cache = new Map();
const SEEDS = { shingle: 67, slate: 71, straw: 83 };
const grey = v => `rgb(${v},${v},${v})`;
function wrap(g, draw) {
  for (const x of [-SIZE, 0, SIZE]) for (const y of [-SIZE, 0, SIZE]) {
    g.save(); g.translate(x, y); draw(); g.restore();
  }
}
function line(g, pts, colour, width) {
  g.beginPath(); pts.forEach(([x,y], i) => i ? g.lineTo(x,y) : g.moveTo(x,y));
  g.strokeStyle = colour; g.lineWidth = width; g.stroke();
}
function tilePath(g, x, y, w, h, slate, chip) {
  g.beginPath(); g.moveTo(x+2, y+1); g.lineTo(x+w-2, y+1);
  if (slate) {
    g.lineTo(x+w-2, y+h-7); g.lineTo(x+w-5-chip, y+h-2);
    g.lineTo(x+w*.54, y+h-3); g.lineTo(x+7+chip, y+h-1);
    g.lineTo(x+2, y+h-6);
  } else {
    g.lineTo(x+w-3, y+h-13);
    g.bezierCurveTo(x+w-9,y+h-3,x+w*.73,y+h-1,x+w*.5,y+h-1);
    g.bezierCurveTo(x+w*.27,y+h-1,x+9,y+h-3,x+3,y+h-13);
  }
  g.closePath();
}
function tiles(albedo, height, rng, slate) {
  albedo.fillStyle = '#777777'; albedo.fillRect(0,0,SIZE,SIZE);
  height.fillStyle = '#343434'; height.fillRect(0,0,SIZE,SIZE);
  const w=SIZE/4, h=SIZE/6;
  for(let row=0;row<6;row++) for(let col=0;col<4;col++) {
    const x=col*w+(row%2)*w/2, y=row*h, value=216+Math.floor(rng()*30), chip=rng()*5;
    const marks = Array.from({length:slate?14:10},()=>({x:8+rng()*(w-16),y:10+rng()*(h-20),len:3+rng()*16,a:.035+rng()*.045}));
    const crack = rng()<.22 ? [w*(.2+rng()*.6), h*(.42+rng()*.3)] : null;
    wrap(albedo,()=>{
      albedo.save(); tilePath(albedo,x,y,w,h,slate,chip); albedo.clip();
      const shade=albedo.createLinearGradient(x,y,x+(slate?0:w),y+(slate?h:0));
      shade.addColorStop(0,grey(value-25)); shade.addColorStop(.18,grey(value+7));
      shade.addColorStop(.58,grey(value)); shade.addColorStop(1,grey(value-30));
      albedo.fillStyle=shade; albedo.fillRect(x,y,w,h);
      const tuck=albedo.createLinearGradient(0,y,0,y+h);
      tuck.addColorStop(0,'rgba(35,35,35,.28)'); tuck.addColorStop(.19,'rgba(35,35,35,0)');
      tuck.addColorStop(.87,'rgba(255,255,255,.03)'); tuck.addColorStop(1,'rgba(40,40,40,.18)');
      albedo.fillStyle=tuck; albedo.fillRect(x,y,w,h);
      for(const m of marks) line(albedo,[[x+m.x,y+m.y],[x+m.x+(slate?m.len:1.5),y+m.y+m.len*.45]],`rgba(65,65,65,${m.a})`,slate?1.1:1.4);
      if(crack) line(albedo,[[x+crack[0],y+crack[1]],[x+crack[0]-3,y+h-15],[x+crack[0]+2,y+h-5]],'rgba(60,60,60,.2)',1.2);
      albedo.restore();
      // A narrow worn lip, with the dark contact seam beneath it.
      line(albedo,slate ? [[x+9,y+h-5],[x+w*.5,y+h-7],[x+w-10,y+h-6]]
        : [[x+14,y+h-9],[x+w*.3,y+h-5],[x+w*.7,y+h-5],[x+w-14,y+h-9]],'rgba(255,255,255,.5)',2);
    });
    wrap(height,()=>{
      height.save(); tilePath(height,x,y,w,h,slate,chip); height.clip();
      const relief=height.createLinearGradient(x,y,x+(slate?0:w),y+(slate?h:0));
      relief.addColorStop(0,grey(slate?110:95)); relief.addColorStop(.15,grey(slate?165:180));
      relief.addColorStop(.5,grey(slate?176:220)); relief.addColorStop(.86,grey(slate?200:170)); relief.addColorStop(1,grey(slate?140:90));
      height.fillStyle=relief; height.fillRect(x,y,w,h);
      const tuck=height.createLinearGradient(0,y,0,y+12);
      tuck.addColorStop(0,'rgba(0,0,0,.35)'); tuck.addColorStop(1,'rgba(0,0,0,0)');
      height.fillStyle=tuck; height.fillRect(x,y,w,12);
      for(const m of marks) line(height,[[x+m.x,y+m.y],[x+m.x+3,y+m.y+m.len]],'rgba(255,255,255,.07)',1.5);
      height.restore();
    });
  }
}
function thatch(albedo,height,rng) {
  albedo.fillStyle='#bcbcbc'; albedo.fillRect(0,0,SIZE,SIZE);
  height.fillStyle='#727272'; height.fillRect(0,0,SIZE,SIZE);
  const h=SIZE/6;
  for(let row=0;row<6;row++) {
    const y=row*h;
    const shade=albedo.createLinearGradient(0,y,0,y+h);
    shade.addColorStop(0,'#b5b5b5'); shade.addColorStop(.2,'#eeeeee'); shade.addColorStop(.8,'#d6d6d6'); shade.addColorStop(1,'#999999');
    albedo.fillStyle=shade; albedo.fillRect(0,y,SIZE,h);
    const rise=height.createLinearGradient(0,y,0,y+h);
    rise.addColorStop(0,'#777777'); rise.addColorStop(.2,'#b4b4b4'); rise.addColorStop(.85,'#c8c8c8'); rise.addColorStop(1,'#737373');
    height.fillStyle=rise; height.fillRect(0,y,SIZE,h);
    for(let strand=0;strand<155;strand++) {
      const x=rng()*SIZE, start=y+3+rng()*24, end=y+h-3-rng()*11, lean=rng()*6-3, value=170+Math.floor(rng()*85);
      const points=[[x,start],[x+lean*.5,(start+end)/2],[x+lean,end]], width=1+rng()*1.2;
      wrap(albedo,()=>line(albedo,points,grey(value),width));
      wrap(height,()=>line(height,points,'rgba(255,255,255,.12)',1.5));
    }
  }
}
function texture(canvas,name,colour) {
  const map=new THREE.CanvasTexture(canvas); map.name=`villages/${name}`;
  map.wrapS=map.wrapT=THREE.RepeatWrapping;
  map.colorSpace=colour?THREE.SRGBColorSpace:THREE.NoColorSpace;
  map.anisotropy=8; return map;
}
export function roofMaps(kind) {
  if(cache.has(kind)) return cache.get(kind);
  if(!(kind in SEEDS)) throw Error(`Unknown roof surface: ${kind}`);
  const canvases=Array.from({length:2},()=>{const c=document.createElement('canvas');c.width=c.height=SIZE;return c;});
  const [albedo,height]=canvases.map(c=>c.getContext('2d'));
  albedo.lineCap=height.lineCap='round';
  const rng=mulberry32(SEEDS[kind]);
  if(kind==='straw') thatch(albedo,height,rng); else tiles(albedo,height,rng,kind==='slate');
  const maps={map:texture(canvases[0],kind,true),bumpMap:texture(canvases[1],kind+'-height',false),bumpScale:kind==='slate'?.022:kind==='straw'?.028:.035};
  cache.set(kind,maps); return maps;
}
