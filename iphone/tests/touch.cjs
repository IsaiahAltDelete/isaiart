const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),path=require('node:path');
const source=fs.readFileSync(path.resolve(__dirname,'../scripts/iphone.js'),'utf8');
function harness(scale=1){
  let time=100,seq=0;const frames=new Map();
  class Node{
    constructor(kind='',parent=null){this.kind=kind;this.parentElement=parent;this.listeners={};this.style={};this.children=[];this.isConnected=true;this.clientWidth=371;this.clientHeight=830;this.scrollWidth=371;this.scrollHeight=830;this.scrollTop=0;this.scrollLeft=0;this.capture=null;const set=new Set();this.classList={add:(...v)=>v.forEach(x=>set.add(x)),remove:(...v)=>v.forEach(x=>set.delete(x)),contains:v=>set.has(v)};}
    appendChild(n){n.parentElement=this;this.children.push(n);}
    addEventListener(k,fn){(this.listeners[k]??=[]).push(fn);}
    getBoundingClientRect(){return {left:100,top:20,width:371*scale,height:830*scale};}
    closest(sel){for(let n=this;n;n=n.parentElement)if(sel.split(',').some(s=>s.trim()===n.kind))return n;return null;}
    setPointerCapture(id){this.capture=id;}
  }
  const scr=new Node('#screen'),body=new Node('.body',scr),row=new Node('.ml-row',body),input=new Node('input',body),win=new Node(),cc=new Node('#cc');body.scrollHeight=3000;body.overflowY='auto';
  const ctx=vm.createContext({HTMLElement:Node,window:win,performance:{now:()=>time},getComputedStyle:n=>({overflowY:n.overflowY||'visible',overflowX:n.overflowX||'visible',scrollSnapType:n.snap||'none'}),State:{settings:{touchCursor:true}},save(){},el:()=>new Node(),$:s=>s==='#screen'?scr:cc,requestAnimationFrame:fn=>{frames.set(++seq,fn);return seq;},cancelAnimationFrame:id=>frames.delete(id)});
  vm.runInContext(source.slice(source.indexOf('(function touchSim(){'),source.indexOf('/* ---------- Control Center ---------- */')),ctx);
  function event(type,x=100,y=400,target=row,id=1,pointerType='mouse',detail=1){return {type,clientX:100+x*scale,clientY:20+y*scale,target,pointerId:id,pointerType,button:0,isPrimary:true,detail,preventDefault(){this.prevented=true;},stopImmediatePropagation(){this.stopped=true;}};}
  function send(node,e){for(const fn of node.listeners[e.type]||[])fn(e);return e;}
  const down=(x,y,t=row,id=1,p='mouse')=>send(scr,event('pointerdown',x,y,t,id,p));
  const move=(x,y,t=row,id=1)=>{time+=16;return send(win,event('pointermove',x,y,t,id));};
  const up=(type='pointerup',id=1)=>send(win,event(type,100,200,row,id));
  const click=(detail=1)=>send(scr,event('click',100,200,row,1,'mouse',detail));
  const tick=()=>{time+=16;const batch=[...frames];frames.clear();for(const [,fn]of batch)fn(time);};
  return {scr,body,row,input,win,cc,ctx,event,send,down,move,up,click,frames,tick,pause:n=>time+=n,Node};
}
let count=0;const test=(name,fn)=>{fn();count++;console.log('PASS '+name);};
test('vertical drags on Mail and known-network rows scroll without opening the row',()=>{for(const kind of ['.ml-row','.kn-row']){const h=harness(),row=new h.Node(kind,h.body);h.down(100,500,row);h.move(102,400,row);assert.equal(h.body.scrollTop,100);h.up();assert.equal(h.click().prevented,true);}});
test('taps and the next intentional tap remain clickable after a drag',()=>{const h=harness();h.down(100,500);h.move(100,400);h.up();h.pause(500);assert.equal(h.click().prevented,true);assert.equal(h.click(0).prevented,undefined);h.down(100,400);h.move(102,398);h.up();assert.equal(h.click().prevented,undefined);});
test('scroll motion uses device coordinates at desktop and small viewport scales',()=>{for(const scale of [1,.75,.4]){const h=harness(scale);h.down(100,500);h.move(100,400);assert.ok(Math.abs(h.body.scrollTop-100)<.001);h.up();}});
test('touch pointer follows the same drag handling without native pan competition',()=>{const h=harness();h.down(100,500,h.row,1,'touch');h.move(100,400);assert.equal(h.body.scrollTop,100);assert.equal(h.row.capture,1);h.up();});
test('new touch stops momentum immediately and retains current scroll position',()=>{const h=harness();h.down(100,500);h.move(100,400);h.up();h.tick();const before=h.body.scrollTop;assert.ok(before>100);h.down(100,350);h.tick();assert.equal(h.body.scrollTop,before);assert.equal(h.frames.size,0);});
test('cancelled drag and a paused release do not start momentum',()=>{for(const cancel of [true,false]){const h=harness();h.down(100,500);h.move(100,400);if(!cancel)h.pause(120);h.up(cancel?'pointercancel':'pointerup');assert.equal(h.frames.size,0);assert.equal(h.body.scrollTop,100);assert.equal(h.scr.classList.contains('dragging'),false);}});
test('unrelated pointer does not move or release the active touch',()=>{const h=harness();h.down(100,500);h.move(100,300,h.row,2);h.up('pointerup',2);assert.equal(h.body.scrollTop,0);h.move(100,400);assert.equal(h.body.scrollTop,100);h.up();});
test('form controls retain their own drag behavior',()=>{const h=harness();h.down(100,500,h.input);h.move(100,300,h.input);h.up();assert.equal(h.body.scrollTop,0);assert.equal(h.click().prevented,undefined);});
test('app-switcher rail drags preserve snap and restore it when interrupted',()=>{const h=harness(),switcher=new h.Node('#switcher',h.scr),rail=new h.Node('.sw-rail',switcher),card=new h.Node('.sw-card',rail);rail.scrollWidth=1200;rail.overflowX='auto';rail.snap='x mandatory';rail.style.scrollSnapType='x mandatory';h.down(200,400,card);h.move(100,402,card);assert.equal(rail.scrollLeft,100);assert.equal(rail.style.scrollSnapType,'none');h.up();h.down(100,400);assert.equal(rail.style.scrollSnapType,'x mandatory');});
test('focus loss clears pressed cursor and stops animation',()=>{const h=harness();h.down(100,500);h.move(100,400);h.send(h.win,{type:'blur'});assert.equal(h.scr.classList.contains('dragging'),false);assert.equal(h.scr.children[0].classList.contains('press'),false);assert.equal(h.frames.size,0);});
test('edge gesture uses actual screen geometry and cancellation cannot open Control Center',()=>{const h=harness(.4);h.ctx.locked=false;h.ctx.currentApp='settings';h.ctx.unlock=()=>{};let homes=0;h.ctx.goHome=()=>homes++;
  vm.runInContext(source.slice(source.indexOf('function screenPoint('),source.indexOf('let lastTap=0;')),h.ctx);
  h.ctx.document={addEventListener(){}};
  vm.runInContext(source.slice(source.indexOf('(function gestures(){'),source.indexOf('(function touchSim(){')),h.ctx);
  h.send(h.scr,h.event('pointerdown',330,20,h.row));h.send(h.scr,h.event('pointercancel',330,20,h.row));h.send(h.scr,h.event('pointerup',330,160,h.row));assert.equal(h.cc.classList.contains('on'),false);
  h.send(h.win,h.event('pointercancel'));h.send(h.scr,h.event('pointerdown',330,20,h.row));h.send(h.scr,h.event('pointerup',330,160,h.row));assert.equal(h.cc.classList.contains('on'),true);
});
console.log(count+' touch interaction checks passed.');

