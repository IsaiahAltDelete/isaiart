const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),path=require('node:path');
const root=path.resolve(__dirname,'..'),source=fs.readFileSync(path.join(root,'scripts/iphone.js'),'utf8');
class E{constructor(tag,cls,html){this.tag=tag;this.className=cls;this.innerHTML=html;this.children=[];this.style={setProperty(){}};this.attributes={};}appendChild(e){this.children.push(e);return e;}setAttribute(k,v){this.attributes[k]=v;}querySelectorAll(){return [];}querySelector(){return null;}}
const storage=new Map(),network={ssid:'Saved',config:undefined};let saves=0,alerts=[],flushes=0;
const ctx=vm.createContext({console,structuredClone,URL,State:{settings:{wifi:true,bluetooth:true,cellular:true,airplane:false,network:'online',glassTint:.55}},SAVE_KEY:'iphone-sim-v2',eraseInProgress:false,saveTimer:null,clearTimeout(){},save(){saves++;},applyAppearance(){},renderCC(){},renderStatus(){},displayView:()=>({build(){}}),networkDetailView:()=>({build(){}}),knownNet:ssid=>ssid==='Saved'?network:null,WF:()=>({connected:'Saved'}),$:()=>({style:{setProperty(){}}}),addEventListener(){},document:{addEventListener(){}},localStorage:{getItem:k=>storage.get(k)||null,setItem(k,v){storage.set(k,v);flushes++;}},el:(t,c,h)=>new E(t,c,h),esc:s=>String(s),alertBox:a=>alerts.push(a),group(b,{rows}){for(const r of rows)b.appendChild(r);}});
vm.runInContext(source.slice(source.indexOf('/* Native reference behavior'),source.indexOf('/* Keep background pages')),ctx);
vm.runInContext(source.slice(source.indexOf('function wifiConfigFault(){'),source.indexOf('function netReason(){')),ctx);
let pass=0;const test=(n,f)=>{f();console.log('PASS '+n);pass++;};
test('airplane mode blocks cellular but Wi-Fi can be enabled without leaving airplane mode',()=>{ctx.setAirplane(true);assert.equal(ctx.State.settings.wifi,false);assert.equal(ctx.isOnline(),false);ctx.State.settings.wifi=true;assert.equal(ctx.State.settings.airplane,true);assert.equal(ctx.isOnline(),true);ctx.setAirplane(false);assert.equal(ctx.State.settings.wifi,true);});
test('disconnected Wi-Fi falls back to cellular; no service and airplane block cellular',()=>{ctx.State.settings.wifiDisconnected=true;assert.equal(ctx.isOnline(),true);ctx.State.settings.network='noservice';assert.equal(ctx.isOnline(),false);ctx.State.settings.wifiDisconnected=false;assert.equal(ctx.isOnline(),true);ctx.State.settings.network='offline';assert.equal(ctx.isOnline(),false);ctx.State.settings.network='online';});
test('manual DNS row invalid Save leaves config intact; add-server list saves IPv4 and IPv6',()=>{
  const view=ctx.networkEditor('Saved','dns'),b=new E();view.build(b,{refresh(){}});b.children.find(r=>r.label==='Manual').onClick();
  const form=new E();view.build(form,{refresh(){}});const fields=b=>b.children.flatMap(e=>e.children||[]).flatMap(e=>e.children||[]).filter(e=>e.tag==='input');
  const field=fields(form)[0];field.value='999.1.1.1';field.oninput();const before=JSON.stringify(network.config);
  view.right[0].onClick({pop(){throw Error('Must not leave invalid editor');},refresh(){}});assert.equal(JSON.stringify(network.config),before);assert.equal(alerts.at(-1).title,'Invalid Configuration');
  field.value='1.1.1.1';field.oninput();form.children.flatMap(e=>e.children||[]).find(e=>e.attributes?.['aria-label']==='Add server').onclick();
  const added=new E();view.build(added,{refresh(){}});const second=fields(added).find(e=>e.attributes['aria-label']==='DNS server 2');second.value='2606:4700:4700::1111';second.oninput();
  let popped=false;view.right[0].onClick({pop(){popped=true},refresh(){}});assert.equal(popped,true);assert.deepEqual(Array.from(network.config.dns),['1.1.1.1','2606:4700:4700::1111']);
});
test('Back without Save leaves staged DNS and other network state untouched',()=>{const before=JSON.stringify(network.config),view=ctx.networkEditor('Saved','dns'),b=new E();view.build(b,{refresh(){}});b.children.find(r=>r.label==='Automatic').onClick();assert.equal(JSON.stringify(network.config),before);});
test('manual proxy validates port and commits server/port only on Save',()=>{const view=ctx.networkEditor('Saved','proxy'),b=new E();view.build(b,{refresh(){}});b.children.find(r=>r.label==='Manual').onClick();const form=new E();view.build(form,{refresh(){}});const fields=form.children.flatMap(e=>e.children||[]).flatMap(e=>e.children||[]).filter(e=>e.tag==='input');fields[0].value='proxy.example.com';fields[0].oninput();fields[1].value='70000';fields[1].oninput();view.right[0].onClick({pop(){throw Error('Invalid port accepted')},refresh(){}});assert.equal(network.config.proxyMode,'Off');fields[1].value='8080';fields[1].oninput();view.right[0].onClick({pop(){},refresh(){}});assert.equal(network.config.port,'8080');});
test('pagehide flush retains unrelated notes and mail along with preferences',()=>{ctx.State.notes=[{body:'Keep'}];ctx.State.mail={messages:[{body:'Keep mail'}]};ctx.flushProfile();const saved=JSON.parse(storage.get('iphone-sim-v2'));assert.equal(saved.notes[0].body,'Keep');assert.equal(saved.mail.messages[0].body,'Keep mail');});
test('current About/update reference has no fictional pending upgrade',()=>{assert.ok(source.includes("['iOS Version','27.0.1']"));assert.ok(source.includes('<strong>iOS 27.0.1</strong>'));assert.ok(!source.includes('Software Update Available'));assert.ok(!source.includes('Downloading iOS 26.2'));});
test('directory routes resolve to the new phone and existing Mac without touching Mac assets',()=>{const html=fs.readFileSync(path.join(root,'../emulator/index.html'),'utf8');assert.ok(html.includes('href="../iphone/"'));assert.ok(html.includes('href="../mac/"'));assert.ok(fs.existsSync(path.join(root,'../mac/index.html')));});
test('phone scaling targets the device rather than the hidden drawer button',()=>{assert.ok(source.includes("device=s.querySelector('.device')"));assert.ok(!source.includes("s.firstElementChild.style.transform='scale"));});
test('Silent Mode hardware action is independent of Do Not Disturb',()=>{assert.ok(source.includes('setSilentMode(!State.settings.silent)'));assert.ok(!source.includes('State.settings.dnd=!State.settings.dnd; save(); ringerHUD()'));});
test('Erase cancels pending saves and lifecycle flush cannot resurrect the old profile',()=>{
  const saved=new Map([['iphone-sim-v2',JSON.stringify({notes:[{body:'Old note'}]})]]),events={},scheduled=[];
  const erase=vm.createContext({console,State:{notes:[{body:'Old note'}]},SAVE_KEY:'iphone-sim-v2',eraseInProgress:false,saveTimer:null,clearTimeout(){},setTimeout(fn){scheduled.push(fn);return 1;},localStorage:{removeItem:k=>saved.delete(k),setItem:(k,v)=>saved.set(k,v)},addEventListener:(n,fn)=>events[n]=fn,document:{hidden:true,addEventListener:(n,fn)=>events[n]=fn},location:{reload(){events.pagehide();events.visibilitychange();}}});
  vm.runInContext(source.slice(source.indexOf('function save(){'),source.indexOf('/* ---------- Apple Accounts')),erase);
  vm.runInContext(source.slice(source.indexOf('function flushProfile(){'),source.indexOf('function networkConfig(')),erase);
  erase.save();erase.factoryReset();for(const callback of scheduled)callback();assert.equal(saved.has('iphone-sim-v2'),false);assert.equal(erase.eraseInProgress,true);
});
test('Safari Private group keeps ordinary tabs and back history intact across switching and reload',()=>{
  ctx.FAVORITES=[];ctx.normalizeURL=s=>s;ctx.prettyHost=s=>s;ctx.safariRender=()=>{};
  vm.runInContext(source.slice(source.indexOf('function defaultSafari(){'),source.indexOf('function normalizeURL(')),ctx);
  vm.runInContext(source.slice(source.indexOf('function safariGo('),source.indexOf('function safariRender(')),ctx);
  ctx.State.safari={tabs:[{id:9,url:'https://ordinary.example',title:'Ordinary',history:['https://ordinary.example'],idx:0}],active:9,seq:10,bookmarks:[],history:[],privateMode:false};
  const ordinary=JSON.stringify(ctx.State.safari.tabs);ctx.setSafariPrivate(true);assert.equal(ctx.activeTab().url,'');ctx.safariGo('https://private.example');ctx.safariGo('https://private-next.example');ctx.safariBack();assert.equal(ctx.activeTab().url,'https://private.example');assert.equal(ctx.State.safari.history.length,0);assert.equal(JSON.stringify(ctx.State.safari.tabs),ordinary);
  ctx.setSafariPrivate(false);assert.equal(ctx.activeTab().url,'https://ordinary.example');ctx.State=JSON.parse(JSON.stringify(ctx.State));ctx.setSafariPrivate(true);assert.equal(ctx.activeTab().url,'https://private.example');ctx.setSafariPrivate(false);assert.equal(ctx.activeTab().url,'https://ordinary.example');
});
test('legacy URL-only Safari profiles retain ordinary tabs when Private is first created',()=>{
  ctx.State.safari={tabs:[{id:2,url:'https://keep.example',title:'Keep',history:['https://keep.example'],idx:0}],active:2,seq:3,bookmarks:[],history:[],privateMode:false};ctx.setSafariPrivate(true);assert.equal(ctx.activeTab().url,'');ctx.setSafariPrivate(false);assert.equal(ctx.activeTab().url,'https://keep.example');
});
test('root homepage iPhone link reaches the phone instead of the directory',()=>{const home=fs.readFileSync(path.join(root,'../index.html'),'utf8');assert.ok(home.includes('title: "iPhone",        url: "iphone/"'));});
test('cursor coordinates track the actual screen scale on desktop and mobile',()=>{
  const start=source.indexOf('const k=()=>',source.indexOf('(function touchSim(){')),end=source.indexOf('function placeFinger(',start);
  for(const scale of [1,.75,.4]){
    const screen={clientWidth:371,clientHeight:830,getBoundingClientRect:()=>({left:100,top:20,width:371*scale,height:830*scale})};
    const cursor=vm.createContext({scr:screen});vm.runInContext(source.slice(start,end),cursor);
    const point=vm.runInContext('devPt({clientX:'+(100+137*scale)+',clientY:'+(20+415*scale)+'})',cursor);assert.ok(Math.abs(point.x-137)<.001);assert.ok(Math.abs(point.y-415)<.001);
    assert.ok(Math.abs(vm.runInContext('k()',cursor)-scale)<.001);
  }
});
test('cursor restoration retains saved notes and respects subsequent explicit disabling',()=>{
  const profile={settings:{touchCursor:false},notes:[{b:'Keep saved note'}],mail:{messages:[{body:'Keep mail'}]}},saved=new Map([['iphone-sim-v2',JSON.stringify(profile)]]);
  const loader=vm.createContext({structuredClone,DEFAULTS:{settings:{touchCursor:true,touchCursorRevision:1}},SAVE_KEY:'iphone-sim-v2',localStorage:{getItem:k=>saved.get(k)}});
  vm.runInContext(source.slice(source.indexOf('function load(){'),source.indexOf('let saveTimer;')),loader);
  const restored=loader.load();assert.equal(restored.settings.touchCursor,true);assert.equal(restored.notes[0].b,'Keep saved note');assert.equal(restored.mail.messages[0].body,'Keep mail');
  restored.settings.touchCursor=false;saved.set('iphone-sim-v2',JSON.stringify(restored));assert.equal(loader.load().settings.touchCursor,false);
});
test('phone remains within viewport with the drawer open or closed at desktop and mobile sizes',()=>{
  const stage={style:{},querySelector:()=>({style:{}})},panel={getBoundingClientRect:()=>({width:270})};
  for(const [width,height] of [[1280,720],[800,600],[390,844],[320,568]])for(const open of [true,false]){
    const layout=vm.createContext({window:{innerWidth:width,innerHeight:height},deckOpen:open,$:s=>s==='#stage'?stage:panel});
    vm.runInContext(source.slice(source.indexOf('function fitStage(){'),source.indexOf("window.addEventListener('resize',fitStage)")),layout);layout.fitStage();
    const used=(width>760 && open?318:0)+parseFloat(stage.style.width)+(width<=760?64:80);assert.ok(used<=width+.01);assert.ok(parseFloat(stage.style.height)<=height-32+.01);
  }
});
test('Silent Mode suppresses new ringtone audio and stops an incoming ringtone already playing',()=>{
  let starts=0,closes=0,contexts=0;const callbacks=[];
  class AudioStub{constructor(){contexts++;this.currentTime=0;this.destination={};}close(){closes++;}createOscillator(){return {frequency:{},connect(){},start(){starts++;},stop(){}};}createGain(){return {gain:{setValueAtTime(){},exponentialRampToValueAtTime(){}},connect(){}};}}
  const audio=vm.createContext({State:{settings:{silent:true,dnd:false,ringer:75}},Call:{state:'incoming'},window:{AudioContext:AudioStub},setInterval(fn){callbacks.push(fn);return callbacks.length;},clearInterval(){},save(){},ringerHUD(){},renderCC(){}});
  vm.runInContext('let ringCtx,ringTimer;'+source.slice(source.indexOf('function setSilentMode('),source.indexOf('function incomingCall(')),audio);
  audio.ringTone(true);assert.equal(contexts,0);assert.equal(starts,0);
  audio.setSilentMode(false);assert.equal(contexts,1);assert.equal(starts,2);audio.ringTone(true);assert.equal(contexts,1);
  audio.setSilentMode(true);assert.equal(closes,1);const before=starts;for(const callback of callbacks)callback();assert.equal(starts,before);
  audio.State.settings.silent=false;audio.State.settings.dnd=true;audio.ringTone(true);assert.equal(contexts,1);
  audio.State.settings.dnd=false;audio.State.settings.ringer=0;audio.ringTone(true);assert.equal(contexts,1);
});
console.log(pass+' integration checks passed.');
