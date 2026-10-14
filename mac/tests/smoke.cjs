/* State-level integration checks. Real browser checks are recorded in REVIEW.md. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const storage = new Map();
let dnsFields = [];
const listeners = {};
const element = () => ({ classList: { add() {}, remove() {}, toggle() {} }, style: { setProperty() {} }, dataset: {}, innerHTML: '', textContent: '', querySelector() { return element(); }, querySelectorAll() { return []; }, focus() {}, setAttribute() {}, removeAttribute() {}, remove() {}, appendChild() {}, offsetHeight: 25, clientWidth: 1440 });
const document = { querySelector() { return element(); }, querySelectorAll(s) { return s === '[data-dns-address]' ? dnsFields : []; }, getElementById() { return element(); }, createElement() { return element(); }, addEventListener(type,fn) { (listeners[type] ||= []).push(fn); }, documentElement: element(), body: element(), contains() { return false; } };
const c = vm.createContext({ console, document, structuredClone, Date, Math, URL, URLSearchParams, Blob, innerWidth: 1440, innerHeight: 900, location: {search:''}, setTimeout() {}, clearTimeout() {}, setInterval() {}, clearInterval() {}, requestAnimationFrame() {}, matchMedia() { return { matches: false, addEventListener() {} }; }, navigator: {}, addEventListener() {}, localStorage: { setItem(k,v) { storage.set(k,v); }, getItem(k) { return storage.get(k) || null; }, removeItem(k) { storage.delete(k); } } });
c.window = c;
const scripts = [...fs.readFileSync(path.join(root,'index.html'),'utf8').matchAll(/src="scripts\/([^"?]+)(?:\?[^"]*)?"/g)].map(m => m[1]).filter(n => n !== '99-boot.js');
for (const name of scripts) vm.runInContext(fs.readFileSync(path.join(root, 'scripts', name), 'utf8'), c, { filename: name });
const M = c.Mac;
M.state = structuredClone(M.DefaultState);
M.sync = () => {};
M.wm.refreshAll = () => {};
M.wm.render = () => {};
M.Notify.show = () => {};
M.Scenarios.renderProgress = () => {};
M.Scenarios.panel = () => {};
M.Dialog.open = cfg => { M.Dialog.current = cfg; };
M.Dialog.close = () => { M.Dialog.current = null; };
let passed = 0;
function test(name, check) { check(); passed++; console.log('PASS ' + name); }
test('current release starts up to date without a future upgrade', () => { assert.equal(M.OS.version(), '27.0.1'); assert.equal(M.OS.pending(), false); assert.equal(M.Web.enabled(), true); });
test('DHCP-supplied DNS stays online when manual DNS is removed', () => { M.state.wifi.dns = []; assert.equal(M.Network.online(), true); });
test('broken resolver blocks connectivity across the shared network service', () => { M.state.wifi.dns = ['203.0.113.53']; assert.equal(M.Network.offlineReason(), 'no-dns'); assert.equal(M.Web.simulatedOnline(), false); });
test('scenario changes restore unrelated faults and account state', () => { M.state.account.signedIn = false; M.state.settings.firewall = false; M.Scenarios.start('no-internet'); assert.equal(M.state.account.signedIn, true); assert.equal(M.state.settings.firewall, true); assert.equal(M.Network.offlineReason(), 'no-dns'); M.Scenarios.start('microphone'); assert.equal(M.Network.online(), true); assert.equal(M.state.permissions.Microphone.Safari, false); assert.equal(M.Scenarios.active().id, 'microphone'); });
test('invalid DNS input does not modify the connected service', () => { M.Scenarios.stop(); const initial = JSON.stringify(M.state.wifi); M.Network.draft = structuredClone(M.state.wifi); M.Network.detailTab = 'DNS'; dnsFields = [{value:'999.0.0.1'}]; M.Network.applyDetails(); assert.equal(JSON.stringify(M.state.wifi), initial); });
test('valid DNS changes persist through storage round-trip', () => { dnsFields = [{value:'9.9.9.9'}]; M.Network.applyDetails(); assert.equal(M.state.wifi.dns[0], '9.9.9.9'); const loaded = M.Store.load(); assert.equal(loaded.wifi.dns[0], '9.9.9.9'); });
test('full disk exercise reclaims measurable storage when Trash is emptied', () => { M.Scenarios.start('full-disk'); const before = M.state.volumes[0].usedBytes; M.FS.emptyTrash(); assert.ok(before - M.state.volumes[0].usedBytes >= 32 * 1024 ** 3); assert.equal(M.FS.children('trash').length, 0); });
test('upgrade practice targets the actual researched release', () => { M.Scenarios.stop(); M.Scenarios.inject('updates'); assert.equal(M.OS.version(), '27.0'); assert.equal(M.OS.update().version, '27.0.1'); assert.equal(M.OS.pending(), true); });
test('all eight scenarios have valid check functions and independent setup', () => { assert.equal(M.Scenarios.all.length, 8); for (const s of M.Scenarios.all) { M.Scenarios.start(s.id); for (const check of s.checks) assert.equal(typeof check.done(), 'boolean'); } });
(async () => {
  M.state = structuredClone(M.DefaultState);
  const background = JSON.stringify(M.state.backgroundItems);
  await M.run('login-remove','0');
  assert.equal(M.state.loginItems.includes('Microsoft Outlook'),false);
  assert.equal(JSON.stringify(M.state.backgroundItems),background);
  await M.run('login-choose','outlook');
  assert.equal(M.state.loginItems.includes('Microsoft Outlook'),true);
  passed++; console.log('PASS native login item commands remove and add without changing background permissions');
  const index=fs.readFileSync(path.join(root,'index.html'),'utf8');
  assert.ok(!index.includes('34-support'));
  assert.ok(!M.Settings.panes['Wi-Fi']().includes('simulat'));
  assert.ok(!M.Settings.subPanes['Permission:Microphone']().includes('A real Mac'));
  assert.ok(!M.Browser.startPage().includes('Training'));
  assert.deepEqual(Object.keys(M.Browser.articles()).sort(),['apple.local','network.test','support.apple.local']);
  passed++; console.log('PASS visible reference surfaces exclude technician panels and lesson content');
  test('every favorite has a routable destination and local titles agree with the registry', () => {
    for (const favorite of M.state.browser.favorites) {
      const url=M.Browser.normalize(favorite.url);
      assert.ok(!url.startsWith('unreachable:'));
      if (!url.startsWith('live:')) { assert.equal(typeof M.Browser.articles()[url],'function'); assert.equal(M.Browser.titleFor(url),M.Browser.sites[url].title); }
    }
    assert.equal(M.Browser.normalize('live:wikipedia.org/wiki/Main_Page'),'live:wikipedia.org/wiki/Main_Page');
  });
  test('Safari back cancels an in-flight reload and returns a usable start page', () => {
    const tab={url:'apple.local',stack:['start','apple.local'],index:1,loading:true,live:null}; const win={state:{tabs:[tab]}};
    M.Browser.go(win,-1); assert.equal(tab.url,'start'); assert.equal(tab.loading,false); assert.equal(tab.index,0);
    M.Browser.go(win,1); assert.equal(tab.url,'apple.local'); assert.equal(tab.loading,false);
  });
  test('Preview opens a file chooser before creating its first document window', () => {
    M.wm.open('preview'); assert.equal(M.Dialog.current.title,'Open'); assert.ok(M.Dialog.current.body.includes('Project Overview.pdf'));
    const pdf=M.apps.preview.render({state:{fileId:'f-runbook'}});
    assert.ok(pdf.includes('Meeting Notes')); assert.ok(!/QUICK GUIDE|Wi-Fi troubleshooting|training document|simulated/i.test(pdf));
    assert.equal(M.apps.preview.render({state:{}}),'');
  });
  test('Apps search and focused-grid Enter ignore stale Spotlight results', () => {
    const oldQuery=M.$,oldQueries=M.$$,oldClose=M.Surfaces.close,oldOpen=M.wm.open;
    let apps=true,launches=[];
    const field={id:'apps-search',focus(){document.activeElement=this},setSelectionRange(){},matches(){return true},closest(){return null}};
    const button={id:'',matches(s){return s === '[data-command="apps-launch"]'},closest(){return null},focus(){document.activeElement=this},click(){launches.push('calculator')}};
    M.$=s => s === '.spotlight-apps' ? (apps ? {} : null) : s === '#apps-search' ? field : {innerHTML:'',classList:{contains(){return true}}};
    M.$$=s => s.startsWith('.apps-grid') ? [button] : [];
    M.Surfaces.close=()=>{}; M.wm.open=id=>launches.push(id);
    M.Spotlight.flat=[{kind:'app',id:'mail'}]; M.Spotlight.openApps('All Apps','Calculator');
    assert.equal(M.Spotlight.flat.length,0);
    const key=k=> { const e={key:k,code:k,target:document.activeElement,preventDefault(){},metaKey:false,ctrlKey:false}; for(const fn of listeners.keydown) fn(e); };
    key('Enter'); assert.deepEqual(launches,['calculator']);
    launches=[]; field.focus(); key('ArrowDown'); assert.equal(document.activeElement,button); key('Enter'); assert.deepEqual(launches,['calculator']);
    M.$=oldQuery; M.$$=oldQueries; M.Surfaces.close=oldClose; M.wm.open=oldOpen;
  });
  test('normal secondary screens use native preferences and exclude teaching labels', () => {
    M.state=structuredClone(M.DefaultState);
    for (const tab of ['Point & Click','Scroll & Zoom','More Gestures']) { M.Settings.trackpadTab=tab; assert.ok(!/Try it|simulat|Lab passwords/i.test(M.Settings.panes.Trackpad())); }
    for (const html of [M.Browser.settingsPage(),M.TimeMachine.settings(),M.Setup.stepBody('network'),M.Setup.stepBody('account')]) assert.ok(!/simulat|Try it|Lab passwords|Lab credentials/i.test(html));
    assert.equal(M.state.browser.searchEngine,'Google');
    assert.equal(M.Browser.normalize('a search without a hostname'),'live:https://www.google.com/search?q=a%20search%20without%20a%20hostname');
  });
  test('Time Machine saves an independent file version and restores its content', () => {
    M.state=structuredClone(M.DefaultState);
    M.state.volumes.find(v=>v.id==='vol-backup').mounted=true;
    M.FS.node('f-notes').content='Original document';
    const snapshot=M.TimeMachine.backup();
    M.FS.node('f-notes').content='Changed document';
    assert.equal(snapshot.files.find(n=>n.id==='f-notes').content,'Original document');
    M.TimeMachine.index=0; assert.equal(M.TimeMachine.restore('f-notes',{mode:'replace'}),true);
    assert.equal(M.FS.node('f-notes').content,'Original document');
    assert.equal(M.Store.load().fs.find(n=>n.id==='f-notes').content,'Original document');
  });
  test('an unavailable backup disk cannot create a snapshot', () => {
    M.state=structuredClone(M.DefaultState);
    const count=M.state.timeMachine.snapshots.length;
    M.TimeMachine.backup(); assert.equal(M.state.timeMachine.snapshots.length,count); assert.equal(M.Dialog.current.title,'The backup disk is not available');
  });
  test('Safari preferences are a separate window and leave document tabs intact', () => {
    const previousCreate=M.wm.create,previousFocus=M.wm.focus,previousApp=M.session.activeApp;
    const browser={id:'test-safari',appId:'safari',state:{tabs:[{id:'one',url:'start'}],activeTab:'one'}};
    M.wm.windows.set(browser.id,browser); M.session.activeApp='safari';
    let created=0,focused;
    M.wm.create=(app,options)=>{created++;const prefs={id:'test-prefs',appId:app.id,state:options.state};M.wm.windows.set(prefs.id,prefs);return prefs;};
    M.wm.focus=id=>focused=id;
    const prefs=M.BrowserPreferences.open();
    assert.equal(prefs.state.preferences,true); assert.equal(M.apps.safari.titleFor(prefs),'General');
    prefs.state.prefPane='Search'; const html=M.apps.safari.render(prefs);
    assert.ok(html.includes('role="tablist"'));assert.ok(!html.includes('Address and search'));assert.ok(!html.includes('browser-view'));
    assert.equal(browser.state.tabs.length,1);assert.equal(browser.state.tabs[0].url,'start');
    M.BrowserPreferences.open();assert.equal(created,1);assert.equal(focused,prefs.id);
    M.wm.windows.delete(browser.id);M.wm.windows.delete(prefs.id);M.wm.create=previousCreate;M.wm.focus=previousFocus;M.session.activeApp=previousApp;
  });
  const freshSafari=()=>({id:'behavior-safari',appId:'safari',state:{tabs:[],activeTab:null,privateBrowsing:false}});
  test('Safari distinguishes window homepage, new-tab blank page and explicit destinations',()=>{
    M.state=structuredClone(M.DefaultState);const win=freshSafari();
    M.state.browser.newWindowsWith='Homepage';M.state.browser.homepage='https://www.apple.com';M.state.browser.newTabsWith='Empty Page';
    assert.equal(M.Browser.newTab(win,undefined,{initial:true}).url,'apple.local');
    assert.equal(M.Browser.newTab(win).url,'blank');
    assert.equal(M.Browser.newTab(win,'start').url,'start');
    assert.equal(M.Browser.fullAddress(win.state.tabs[0]),'https://www.apple.com');
  });
  test('background homepage tabs preserve the foreground selection',()=>{
    const win=freshSafari();const first=M.Browser.newTab(win,'start');
    M.Browser.newTab(win,'apple.local',{activate:false});assert.equal(win.state.activeTab,first.id);
  });
  test('private browsing uses its own search engine and excludes history and sessions',()=>{
    M.state=structuredClone(M.DefaultState);const win=freshSafari();win.state.privateBrowsing=true;
    M.state.browser.privateSearchEngine='DuckDuckGo';M.Browser.contextWindow=win;
    assert.equal(M.Browser.normalize('private query'),'live:https://duckduckgo.com/?q=private%20query');
    M.Browser.contextWindow=null;const tab=M.Browser.newTab(win,'apple.local');
    M.Browser.record(tab);assert.equal(M.state.browser.history.length,0);
    M.wm.windows.set(win.id,win);M.Browser.sessionOpened=true;M.Browser.saveSession();assert.equal(M.state.browser.savedWindows.length,0);M.wm.windows.clear();
  });
  test('Safari restores all saved windows and their selected tabs',()=>{
    M.state=structuredClone(M.DefaultState);M.wm.windows.clear();
    const oldCreate=M.wm.create,oldFocus=M.wm.focus;let n=0;
    M.wm.focus=()=>{};M.wm.create=(app,options)=>{const win={id:'restored-'+(++n),appId:app.id,state:{...app.initialState(),...options.state},el:element(),space:0};M.wm.windows.set(win.id,win);app.mount(win);return win;};
    M.state.browser.opensWith='All windows from last session';M.state.browser.savedWindows=[{urls:['apple.local','blank'],active:1},{urls:['start'],active:0}];
    const first=M.wm.open('safari');assert.equal(M.wm.forApp('safari').length,2);assert.equal(M.Browser.tab(first).url,'blank');
    assert.equal(M.state.browser.savedWindows.length,2);assert.equal(M.state.browser.savedWindows[0].urls.length,2);
    M.wm.windows.clear();M.wm.create=oldCreate;M.wm.focus=oldFocus;
  });
  test('Safari opens with a private window when requested',()=>{
    M.state=structuredClone(M.DefaultState);M.wm.windows.clear();M.state.browser.opensWith='A new private window';
    const oldCreate=M.wm.create;let opened;
    M.wm.create=(app,options)=>opened=options;
    M.wm.open('safari');assert.equal(opened.state.privateBrowsing,true);M.wm.create=oldCreate;
  });
  test('history expiry and clear-range operations preserve older entries appropriately',()=>{
    M.state=structuredClone(M.DefaultState);const now=Date.now();M.state.browser.removeHistory='After one week';
    M.state.browser.history=[{at:now-8*86400000},{at:now-2*86400000},{at:now-1800000}];
    M.Browser.pruneHistory(now);assert.equal(M.state.browser.history.length,2);
    M.Browser.clearHistory('the last hour',now);assert.equal(M.state.browser.history.length,1);
    M.Browser.clearHistory('all history',now);assert.equal(M.state.browser.history.length,0);
  });
  test('automatic tab closing cancels expired tabs and retains the recent tab',()=>{
    M.state=structuredClone(M.DefaultState);M.state.browser.closeTabs='After One Day';const now=Date.now(),win=freshSafari();
    const old=M.Browser.newTab(win,'start');old.createdAt=now-2*86400000;const recent=M.Browser.newTab(win,'blank');
    M.Browser.expireTabs(win,now);assert.equal(win.state.tabs.length,1);assert.equal(win.state.activeTab,recent.id);
  });
  test('Safari places its address toolbar in the window header and applies compact tabs',()=>{
    M.state=structuredClone(M.DefaultState);const win=freshSafari();M.Browser.newTab(win,'start');M.Browser.newTab(win,'blank');
    const separate=M.Browser.render(win);assert.ok(!separate.includes('class="browser-bar"'));assert.ok(separate.includes('class="tab-strip"'));assert.ok(M.apps.safari.leading(win).includes('Address and search'));
    M.state.browser.tabLayout='Compact';const compact=M.Browser.render(win);assert.ok(!compact.includes('class="tab-strip"'));assert.ok(M.apps.safari.leading(win).includes('class="tab-strip"'));
    const tab={url:'live:https://example.com/path'};assert.equal(M.Browser.displayAddress(tab),'example.com');M.state.browser.showFullAddress=true;assert.equal(M.Browser.displayAddress(tab),'https://example.com/path');
  });
  test('Time Machine restores nested folder versions and Keep Both preserves current data',()=>{
    M.state=structuredClone(M.DefaultState);M.state.volumes.find(v=>v.id==='vol-backup').mounted=true;
    M.state.fs.push({id:'restore-root',parent:'dir-documents',kind:'folder',name:'Work'},{id:'restore-sub',parent:'restore-root',kind:'folder',name:'Nested'},{id:'restore-file',parent:'restore-sub',kind:'file',name:'Notes.txt',content:'Old',size:3});
    M.TimeMachine.backup();M.TimeMachine.index=0;M.FS.node('restore-file').content='New';M.state.fs.push({id:'later-file',parent:'restore-root',kind:'file',name:'Later.txt',content:'Later'});
    M.TimeMachine.restore('restore-root');assert.equal(M.Dialog.current.title,'“Work” already exists');assert.equal(M.FS.node('restore-file').content,'New');
    assert.equal(M.TimeMachine.restore('restore-root',{mode:'both'}),true);
    const copy=M.state.fs.find(n=>n.parent==='dir-documents' && n.name==='Work 2');assert.ok(copy);
    assert.equal(M.TimeMachine.subtree(M.state.fs,copy.id).find(n=>n.kind==='file').content,'Old');assert.equal(M.FS.node('restore-file').content,'New');
    assert.equal(M.TimeMachine.restore('restore-root',{mode:'replace'}),true);assert.equal(M.FS.node('restore-file').content,'Old');assert.equal(M.FS.node('later-file'),null);
    assert.ok(M.FS.node(copy.id));assert.equal(new Set(M.state.fs.map(n=>n.id)).size,M.state.fs.length);assert.equal(M.Store.load().fs.find(n=>n.id==='restore-file').content,'Old');
  });
  test('folder restoration preserves moved files outside the restored subtree',()=>{
    M.state=structuredClone(M.DefaultState);M.state.volumes.find(v=>v.id==='vol-backup').mounted=true;
    M.state.fs.push({id:'move-root',parent:'dir-documents',kind:'folder',name:'Move'},{id:'move-file',parent:'move-root',kind:'file',name:'Notes.txt',content:'Old'});
    M.TimeMachine.backup();M.TimeMachine.index=0;M.FS.node('move-file').parent='dir-downloads';M.FS.node('move-file').content='Moved';
    M.TimeMachine.restore('move-root',{mode:'replace'});assert.equal(M.FS.node('move-file').content,'Moved');assert.equal(M.FS.children('move-root')[0].content,'Old');
  });
  test('scheduled backups run once when due without recursion; manual and missing disks do not run',()=>{
    M.state=structuredClone(M.DefaultState);M.state.volumes.find(v=>v.id==='vol-backup').mounted=true;const now=Date.now();M.state.timeMachine.nextBackupAt=now-1;
    const count=M.state.timeMachine.snapshots.length,refresh=M.wm.refreshAll;M.wm.refreshAll=()=>M.TimeMachine.settings();
    M.TimeMachine.tick(now);assert.equal(M.state.timeMachine.snapshots.length,count+1);assert.equal(M.state.timeMachine.nextBackupAt,now+3600000);
    M.TimeMachine.tick(now);assert.equal(M.state.timeMachine.snapshots.length,count+1);
    M.state.timeMachine.frequency='Manually';M.TimeMachine.tick(now+86400000);assert.equal(M.state.timeMachine.snapshots.length,count+1);assert.equal(M.state.timeMachine.nextBackupAt,0);
    M.state.volumes=M.state.volumes.filter(v=>v.id!=='vol-backup');assert.equal(M.TimeMachine.available(),false);M.wm.refreshAll=refresh;
  });
  test('Finder view options persist per folder without resetting files or Safari choices',()=>{
    M.state=structuredClone(M.DefaultState);const win={id:'finder-test',appId:'finder',state:{location:'dir-documents',view:'icon'},el:element()};
    M.FinderViewOptions.set(win,'iconSize',88);M.FinderViewOptions.set(win,'sort','size');M.FinderViewOptions.set(win,'showInfo',true);
    assert.equal(win.state.sort,'size');assert.ok(M.FinderViewOptions.body(win).includes('value="88"'));
    assert.ok(M.Finder.iconView(win,[M.FS.node('f-notes')]).includes('<small>'));
    M.state.browser.homepage='https://example.com';M.FS.node('f-notes').content='Kept';M.save();const loaded=M.Store.load();
    assert.equal(loaded.finderViews['dir-documents'].iconSize,88);assert.equal(loaded.fs.find(n=>n.id==='f-notes').content,'Kept');assert.equal(loaded.browser.homepage,'https://example.com');assert.equal(loaded.schema,15);
    win.state.location='dir-downloads';assert.equal(M.FinderViewOptions.get(win).iconSize,52);
  });
  test('Mail share prefills the native compose fields without sending a message',()=>{
    M.state=structuredClone(M.DefaultState);const before=M.state.mail.messages.length;
    M.Mail.compose({prefill:{subject:'Apple',body:'https://www.apple.com'}});
    assert.equal(M.Dialog.current.title,'New Message');assert.ok(M.Dialog.current.body.includes('value="Apple"'));assert.ok(M.Dialog.current.body.includes('https://www.apple.com'));assert.equal(M.state.mail.messages.length,before);
  });

  test('Spotlight privacy excludes descendants while preserving matching applications',()=>{
    M.state=structuredClone(M.DefaultState);
    const file=M.FS.node('f-transcript'),name=file.name;
    assert.ok(M.Spotlight.results(name).some(g=>g.items.some(i=>i.kind==='file' && i.node.id===file.id)));
    M.state.settings.spotlightExcluded=['dir-documents'];M.save();
    assert.ok(!M.Spotlight.results(name).some(g=>g.items.some(i=>i.kind==='file' && i.node.id===file.id)));
    assert.ok(M.Spotlight.results('Safari').some(g=>g.items.some(i=>i.kind==='app')));
    assert.equal(M.Store.load().settings.spotlightExcluded[0],'dir-documents');
  });
  test('Spotlight folder chooser stages exclusions until Choose is activated',()=>{
    M.state=structuredClone(M.DefaultState);M.run('spotlight-location-add');
    assert.equal(M.Dialog.current.title,'Choose a Folder');assert.equal(M.state.settings.spotlightExcluded.length,0);
    M.Settings.privacyDraft='dir-documents';M.Dialog.current.buttons.find(b=>b.label==='Choose').action();
    assert.equal(M.state.settings.spotlightExcluded[0],'dir-documents');
    M.run('spotlight-location-remove');assert.equal(M.state.settings.spotlightExcluded.length,0);
  });

  test('editing Homepage updates the model before another control can re-render it',()=>{
    M.state=structuredClone(M.DefaultState);
    const field={value:'https://support.apple.com',dataset:{safariPreference:'homepage'},matches:s=>s==='[data-safari-preference]',closest:()=>null};
    for(const handler of listeners.input)handler({target:field});
    assert.equal(M.state.browser.homepage,'https://support.apple.com');assert.equal(M.Store.load().browser.homepage,'https://support.apple.com');
  });
  test('JavaScript and pop-up choices change the embedded page sandbox',()=>{
    M.state=structuredClone(M.DefaultState);const tab={live:{kind:'frame',url:'https://example.com',host:'example.com'}};
    M.state.browser.javascript=false;let html=M.Browser.livePage(freshSafari(),tab);assert.ok(!html.includes('allow-scripts'));assert.ok(!html.includes('allow-popups'));
    M.state.browser.javascript=true;M.state.browser.popupPolicy='Allow';html=M.Browser.livePage(freshSafari(),tab);assert.ok(html.includes('allow-scripts'));assert.ok(html.includes('allow-popups-to-escape-sandbox'));
  });
  test('download location asks before creating a file and saves into the chosen folder',()=>{
    M.state=structuredClone(M.DefaultState);M.state.browser.downloadLocation='Ask for each download';M.state.browser.openSafeFiles=false;
    const before=M.state.fs.length;M.Browser.download('Example.pdf',4096);assert.equal(M.Dialog.current.title,'Save');assert.equal(M.state.fs.length,before);
    M.Browser.downloadFolder='dir-documents';M.Browser.downloadName='Saved.pdf';M.Dialog.current.buttons.find(b=>b.label==='Save').action();
    const file=M.state.fs.find(n=>n.name==='Saved.pdf');assert.equal(file.parent,'dir-documents');assert.equal(M.state.browser.downloads[0].fileId,file.id);
  });
  test('safe-file preference controls whether a completed virtual download opens',()=>{
    M.state=structuredClone(M.DefaultState);const previousOpen=M.wm.open;let opens=[];M.wm.open=(id,options)=>opens.push({id,options});
    M.state.browser.openSafeFiles=false;M.Browser.finishDownload('Closed.pdf',100);assert.equal(opens.length,0);
    M.state.browser.openSafeFiles=true;const file=M.Browser.finishDownload('Opened.pdf',100);assert.equal(opens[0].id,'preview');assert.equal(opens[0].options.state.fileId,file.id);M.wm.open=previousOpen;
  });

  test('Finder exposes View Options on the native View menu',()=>{
    const win={appId:'finder',state:{location:'dir-documents',view:'icon',selected:null}};
    const entry=M.apps.finder.menus(win).View.find(item=>item.command==='finder-view-options');
    assert.equal(entry.label,'Show View Options');assert.equal(entry.shortcut,'⌘J');
  });
  test('automatic backups preserve the version being browsed, including the oldest retained backup',()=>{
    M.state=structuredClone(M.DefaultState);M.state.volumes.find(v=>v.id==='vol-backup').mounted=true;
    const template=M.state.timeMachine.snapshots[0];M.state.timeMachine.snapshots=Array.from({length:12},(_,i)=>({...structuredClone(template),id:'retained-'+i}));
    M.session.surface='time-machine';M.TimeMachine.index=11;M.TimeMachine.selected='f-notes';
    const selected=M.state.timeMachine.snapshots[11].id;M.TimeMachine.backup();
    assert.equal(M.state.timeMachine.snapshots[M.TimeMachine.index].id,selected);assert.equal(M.state.timeMachine.snapshots.length,12);assert.equal(M.TimeMachine.selected,'f-notes');M.session.surface=null;
  });
  test('Finder selection preserves file nodes so double-click can open the selected folder',()=>{
    M.state=structuredClone(M.DefaultState);const id='dir-training';let selected=false,rendered=0,opened;
    const file={dataset:{file:id,win:'select-test'},classList:{toggle(name,on){selected=on;}}};
    const win={id:'select-test',appId:'finder',state:{location:'dir-documents',view:'icon',sort:'name'},el:{querySelectorAll:()=>[file],querySelector:()=>null}};
    M.wm.windows.set(win.id,win);const oldRender=M.wm.render,oldOpen=M.Finder.open;M.wm.render=()=>rendered++;M.Finder.open=(host,item)=>opened={host,item};
    M.Finder.select(win,id);assert.equal(selected,true);assert.equal(rendered,0);assert.equal(win.state.selected,id);
    for(const fn of listeners.dblclick)fn({target:{closest:s=>s==='[data-file]' ? file : null}});
    assert.equal(opened.item,id);assert.equal(opened.host,win);M.wm.windows.clear();M.wm.render=oldRender;M.Finder.open=oldOpen;
  });
  test('backup folder selection preserves its element for native double-click navigation',()=>{
    M.state=structuredClone(M.DefaultState);M.TimeMachine.index=0;let rendered=0,selected;const previousQuery=M.$,previousRender=M.TimeMachine.render;
    const option={dataset:{arg:'dir-training'},setAttribute(k,v){selected=v;}};const restore={disabled:true};
    M.$=()=>({querySelectorAll:()=>[option],querySelector:()=>restore});M.TimeMachine.render=()=>rendered++;
    assert.equal(M.TimeMachine.select('dir-training'),true);assert.equal(selected,'true');assert.equal(restore.disabled,false);assert.equal(rendered,0);
    for(const fn of listeners.dblclick)fn({target:{closest:s=>s==='[data-tm-folder]' ? {dataset:{tmFolder:'dir-training'}} : null}});
    assert.equal(M.TimeMachine.folder,'dir-training');assert.equal(rendered,1);M.$=previousQuery;M.TimeMachine.render=previousRender;
  });
  test('storage synchronization adopts files changed in another view before a subsequent save',()=>{
    M.state=structuredClone(M.DefaultState);M.save();const updated=structuredClone(M.state);
    updated.fs.push({id:'other-view-file',parent:'dir-documents',kind:'file',name:'Other view.txt',content:'Kept'});
    updated.browser.homepage='https://support.apple.com';storage.set(M.STORAGE_KEY,JSON.stringify(updated));
    M.syncStoredProfile({key:M.STORAGE_KEY,newValue:JSON.stringify(updated)});assert.equal(M.FS.node('other-view-file').content,'Kept');assert.equal(M.state.browser.homepage,'https://support.apple.com');
    M.save();assert.equal(M.Store.load().fs.find(n=>n.id==='other-view-file').content,'Kept');
    M.syncStoredProfile({key:'unrelated',newValue:'{}'});assert.equal(M.FS.node('other-view-file').content,'Kept');
  });
  test('restoration resolves recreated ancestor paths and conflicts without duplicate folders',()=>{
    M.state=structuredClone(M.DefaultState);M.state.volumes.find(v=>v.id==='vol-backup').mounted=true;
    M.state.fs.push({id:'old-work',parent:'dir-documents',kind:'folder',name:'Work'},{id:'old-note',parent:'old-work',kind:'file',name:'Note.txt',content:'Backup'});
    M.TimeMachine.backup();M.TimeMachine.index=0;M.state.fs=M.state.fs.filter(n=>!['old-work','old-note'].includes(n.id));
    M.state.fs.push({id:'new-work',parent:'dir-documents',kind:'folder',name:'Work'},{id:'new-note',parent:'new-work',kind:'file',name:'Note.txt',content:'Current'});
    assert.equal(M.TimeMachine.restore('old-note'),false);assert.equal(M.Dialog.current.title,'“Note.txt” already exists');
    assert.equal(M.TimeMachine.restore('old-note',{mode:'both'}),true);assert.equal(M.FS.children('dir-documents').filter(n=>n.name==='Work').length,1);
    assert.equal(M.FS.children('new-work').find(n=>n.name==='Note 2.txt').content,'Backup');assert.equal(M.FS.node('new-note').content,'Current');
    assert.equal(M.TimeMachine.restore('old-note',{mode:'replace'}),true);assert.equal(M.FS.children('new-work').find(n=>n.name==='Note.txt').content,'Backup');
  });
  test('restoration refuses a file blocking a missing ancestor without changing files',()=>{
    M.state=structuredClone(M.DefaultState);M.state.volumes.find(v=>v.id==='vol-backup').mounted=true;
    M.state.fs.push({id:'blocked-folder',parent:'dir-documents',kind:'folder',name:'Blocked'},{id:'blocked-note',parent:'blocked-folder',kind:'file',name:'Note.txt'});
    M.TimeMachine.backup();M.TimeMachine.index=0;M.state.fs=M.state.fs.filter(n=>!['blocked-folder','blocked-note'].includes(n.id));M.state.fs.push({id:'blocking-file',parent:'dir-documents',kind:'file',name:'Blocked',content:'Keep'});
    const before=JSON.stringify(M.state.fs);assert.equal(M.TimeMachine.restore('blocked-note'),false);assert.equal(JSON.stringify(M.state.fs),before);assert.equal(M.Dialog.current.title,'Cannot Restore Item');
  });
  test('command-click listener respects foreground and background windows and tabs',()=>{
    M.state=structuredClone(M.DefaultState);const win=freshSafari();M.Browser.newTab(win,'start');M.wm.windows.set(win.id,win);
    const oldOpen=M.wm.open,oldFocus=M.wm.focus;let focused,opened;M.wm.open=(app,options)=>{opened=options;focused='new-window';};M.wm.focus=id=>focused=id;
    const link={dataset:{arg:'apple.local'},closest:()=>({dataset:{win:win.id}})},event={metaKey:true,target:{closest:s=>s==='[data-command="browse"]' ? link : null},preventDefault(){},stopImmediatePropagation(){}};
    M.state.browser.commandClickTab=false;M.state.browser.activateNewTab=false;for(const fn of listeners.click)fn(event);assert.equal(focused,win.id);assert.equal(opened.state.initialUrl,'apple.local');
    M.state.browser.activateNewTab=true;for(const fn of listeners.click)fn(event);assert.equal(focused,'new-window');
    M.state.browser.commandClickTab=true;M.state.browser.activateNewTab=false;const active=win.state.activeTab;for(const fn of listeners.click)fn(event);assert.equal(win.state.activeTab,active);
    M.state.browser.activateNewTab=true;for(const fn of listeners.click)fn(event);assert.notEqual(win.state.activeTab,active);M.wm.open=oldOpen;M.wm.focus=oldFocus;M.wm.windows.clear();
  });
  test('New Private Window preserves the original regular window and exposes native menu',()=>{
    M.state=structuredClone(M.DefaultState);const win=freshSafari();M.Browser.newTab(win,'apple.local');M.wm.windows.set(win.id,win);
    const before=JSON.stringify(win.state),oldOpen=M.wm.open;let options;M.wm.open=(app,o)=>options=o;M.run('browser-private');assert.equal(JSON.stringify(win.state),before);assert.equal(options.state.privateBrowsing,true);assert.equal(options.newWindow,true);
    assert.ok(M.apps.safari.menus(win).File.some(n=>n.label==='New Private Window' && n.shortcut==='⇧⌘N'));assert.ok(!M.Browser.render(win).includes('aria-label="Private Browsing"'));M.wm.open=oldOpen;M.wm.windows.clear();
  });
  test('restored Safari sessions preserve tab ages and expire old tabs; legacy records remain usable',()=>{
    M.state=structuredClone(M.DefaultState);M.wm.windows.clear();const oldCreate=M.wm.create,oldFocus=M.wm.focus;let n=0;
    M.wm.focus=()=>{};M.wm.create=(app,o)=>{const w={id:'age-'+(++n),appId:app.id,state:{...app.initialState(),...o.state},el:element(),space:0};M.wm.windows.set(w.id,w);app.mount(w);return w;};
    const age=Date.now()-2*86400000;M.state.browser.opensWith='All windows from last session';M.state.browser.closeTabs='After One Day';M.state.browser.savedWindows=[{urls:['apple.local','blank'],createdAt:[age,Date.now()],active:0}];
    const restored=M.wm.open('safari');assert.equal(restored.state.tabs[0].createdAt,age);M.Browser.expireTabs(restored);assert.equal(restored.state.tabs.length,1);assert.equal(M.Browser.tab(restored).url,'blank');M.Browser.saveSession();assert.ok(M.state.browser.savedWindows[0].createdAt[0]>age);
    M.wm.windows.clear();M.state.browser.savedWindows=[{urls:['start'],active:0}];assert.equal(M.wm.open('safari').state.tabs.length,1);M.wm.windows.clear();M.wm.create=oldCreate;M.wm.focus=oldFocus;
  });
  test('compact selected tabs retain title and close affordance',()=>{
    M.state=structuredClone(M.DefaultState);M.state.browser.tabLayout='Compact';const win=freshSafari();M.Browser.newTab(win,'apple.local');M.Browser.render(win);
    assert.ok(win.chromeMarkup.includes('browser-tab on'));assert.ok(win.chromeMarkup.includes('data-close-tab'));assert.ok(!fs.readFileSync(path.join(root,'styles/10-native-behavior.css'),'utf8').includes('.browser-tab.on { display:none; }'));
  });
  test('Safari File menu replaces generic entries without duplicate windows or close shortcuts',()=>{
    const menus=M.Menus.build('safari');assert.equal(menus.File.filter(n=>n.label==='New Window').length,1);assert.equal(menus.File.find(n=>n.label==='Close Window').shortcut,'⇧⌘W');assert.equal(menus.File.find(n=>n.label==='Close Tab').shortcut,'⌘W');
  });
  test('explicit private and destination windows take precedence over a saved launch session',()=>{
    M.state=structuredClone(M.DefaultState);M.wm.windows.clear();const oldCreate=M.wm.create,oldFocus=M.wm.focus;let n=0;
    M.wm.focus=()=>{};M.wm.create=(app,o)=>{const w={id:'intent-'+(++n),appId:app.id,state:{...app.initialState(),...o.state},el:element(),space:0};M.wm.windows.set(w.id,w);app.mount(w);return w;};
    M.state.browser.opensWith='All windows from last session';M.state.browser.savedWindows=[{urls:['apple.local'],active:0}];
    const privateWindow=M.wm.open('safari',{newWindow:true,state:{privateBrowsing:true,initialUrl:'start'}});assert.equal(M.Browser.isPrivate(privateWindow),true);assert.equal(M.Browser.tab(privateWindow).url,'start');assert.equal(M.state.browser.savedWindows[0].urls[0],'apple.local');
    M.wm.windows.clear();const explicit=M.wm.open('safari',{newWindow:true,state:{initialUrl:'blank'}});assert.equal(M.Browser.tab(explicit).url,'blank');
    M.wm.windows.clear();M.state.browser.savedWindows=[{urls:['apple.local'],active:0}];assert.equal(M.Browser.tab(M.wm.open('safari')).url,'apple.local');M.wm.windows.clear();M.wm.create=oldCreate;M.wm.focus=oldFocus;
  });
  test('File-menu private command with only preferences preserves ordinary saved sessions',()=>{
    M.state=structuredClone(M.DefaultState);M.wm.windows.clear();const oldCreate=M.wm.create,oldFocus=M.wm.focus,oldActive=M.wm.active;let n=0;
    M.wm.focus=()=>{};M.wm.create=(app,o)=>{const w={id:'private-menu-'+(++n),appId:app.id,state:{...app.initialState(),...o.state},el:element(),space:0};M.wm.windows.set(w.id,w);app.mount(w);return w;};
    const prefs={id:'only-prefs',appId:'safari',state:{preferences:true},el:element()};M.wm.windows.set(prefs.id,prefs);M.wm.active=()=>prefs;
    M.state.browser.opensWith='All windows from last session';M.state.browser.savedWindows=[{urls:['apple.local'],active:0}];
    const command=M.Menus.build('safari').File.find(n=>n.label==='New Private Window').command;M.run(command);
    const win=M.wm.forApp('safari').find(w=>!w.state.preferences);assert.equal(M.Browser.isPrivate(win),true);assert.equal(M.Browser.tab(win).url,'start');M.Browser.saveSession();assert.equal(M.state.browser.savedWindows[0].urls[0],'apple.local');
    M.wm.windows.clear();M.wm.create=oldCreate;M.wm.focus=oldFocus;M.wm.active=oldActive;
  });
  test('known-network auto-join is independent of Ask and chooses strongest available saved network',()=>{
  const before=MacSafeState(),connect=M.Network.connect;const joins=[];
  try{M.Network.connect=(network)=>joins.push(network.name);
    M.state.wifi.saved=['Sablewave Home','Support Bench 5G'];M.state.wifi.autoJoin={'Sablewave Home':true,'Support Bench 5G':true};
    const strongest=M.NETWORKS.filter(n=>M.state.wifi.saved.includes(n.name)&&!n.unavailable).sort((a,b)=>b.bars-a.bars)[0].name;
    for(const ask of ['Off','Notify','Ask']){M.state.settings.askToJoin=ask;M.Network.toggle(false);M.Network.toggle(true);assert.equal(joins.at(-1),strongest);}
    assert.equal(joins.length,3);
  }finally{M.Network.connect=connect;M.state=before;}
});
function MacSafeState(){return M.clone(M.state);}
test('Mac DNS accepts IPv6 and rejects malformed addresses without changing saved network',()=>{
  const before=MacSafeState();
  try{M.Network.details('DNS');dnsFields=[{value:'2606:4700:4700::1111'},{value:'1.1.1.1'}];M.Network.applyDetails();assert.equal(M.state.wifi.dns[0],'2606:4700:4700::1111');
    const saved=JSON.stringify(M.state.wifi);M.Network.details('DNS');dnsFields=[{value:'2606:4700:::broken'}];M.Network.applyDetails();assert.equal(JSON.stringify(M.state.wifi),saved);
  }finally{M.state=before;dnsFields=[];}
});
test('Mac search-domain rows stage changes until OK and persist as the compatible domain string',()=>{
  const before=MacSafeState(),query=c.document.querySelectorAll;
  try{M.state.wifi.searchDomains='keep.example';M.Network.details('DNS');const saved=JSON.stringify(M.state.wifi);
    dnsFields=M.state.wifi.dns.map(value=>({value}));c.document.querySelectorAll=selector=>selector==='[data-search-domain]'?[{value:'office.example'},{value:'local.example'},{value:''}]:query(selector);
    M.Network.collectDetails();assert.equal(JSON.stringify(M.state.wifi),saved);M.Network.applyDetails();assert.equal(M.state.wifi.searchDomains,'office.example, local.example');assert.equal('domainRows' in M.state.wifi,false);
  }finally{c.document.querySelectorAll=query;M.state=before;dnsFields=[];}
});
console.log(`${passed} integration checks passed.`);
})().catch(err => { console.error(err); process.exitCode=1; });
