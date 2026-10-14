const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),path=require('node:path');
const source=fs.readFileSync(path.resolve(__dirname,'../scripts/iphone.js'),'utf8');
const nodes=new Map();function node(id){if(!nodes.has(id)){const classes=new Set();nodes.set(id,{inert:false,attrs:{},setAttribute(k,v){this.attrs[k]=v;},classList:{contains:x=>classes.has(x),add:x=>classes.add(x),remove:x=>classes.delete(x),toggle(x,on){if(on)classes.add(x);else classes.delete(x);}}});}return nodes.get(id);}
const settings=node('settings'),ctx=vm.createContext({$:id=>node(id),locked:false,currentApp:{id:'settings'},openApps:new Map([['settings',{win:settings}]])});
vm.runInContext(source.slice(source.indexOf('function syncPhoneSurfaces(){'),source.indexOf('new MutationObserver(syncPhoneSurfaces)')),ctx);
node('#callui').classList.add('on');ctx.syncPhoneSurfaces();assert.equal(node('#applayer').inert,true);assert.equal(node('#home').inert,true);assert.equal(node('#callui').inert,false);assert.equal(node('#screen').classList.contains('call-active'),true);
node('#callui').classList.remove('on');ctx.syncPhoneSurfaces();assert.equal(node('#applayer').inert,false);assert.equal(node('#screen').classList.contains('call-active'),false);
console.log('PASS full-screen call hides background controls and restores them when dismissed');
node('#callui').classList.add('on');node('#overlay').classList.add('on');ctx.syncPhoneSurfaces();assert.equal(node('#callui').inert,true);assert.equal(node('#overlay').inert,false);node('#overlay').classList.remove('on');ctx.syncPhoneSurfaces();assert.equal(node('#callui').inert,false);
console.log('PASS modal overlay takes accessibility priority over call controls');
const begin=source.indexOf('  pop(){'),end=source.indexOf('  popToRoot()',begin);
const popContext=vm.createContext({setTimeout(){}});vm.runInContext('globalThis.pop=function'+source.slice(begin+2,end).replace(/^pop/,'').trim(),popContext);
const prior={_page:node('prior')},departing={_page:node('departing')},nav={stack:[prior,departing],get top(){return this.stack.at(-1);}};
popContext.pop.call(nav);assert.equal(departing._page.inert,true);assert.equal(departing._page.attrs['aria-hidden'],'true');
console.log('PASS popped navigation page leaves focus tree before its departure animation finishes');
console.log('3 surface interaction checks passed.');
