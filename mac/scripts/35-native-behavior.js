/* Behavior behind native preferences. No hardware or native OS access. */
(function (Mac) {
  'use strict';
  const {esc,glyph,UI}=Mac, B=Mac.Browser, TM=Mac.TimeMachine;
  Object.assign(Mac.DefaultState.browser,{savedWindows:[],websiteData:[]});
  Object.assign(Mac.DefaultState.timeMachine,{nextBackupAt:0});
  Mac.DefaultState.finderViews={};
  Mac.DefaultState.finderViewDefaults={iconSize:52,gridSpacing:14,textSize:12,showInfo:false,alwaysOpen:false,view:'icon',sort:'name'};
  Mac.DefaultState.settings.focusAcrossDevices=true;
  Mac.DefaultState.settings.spotlightExcluded=[];
  Mac.syncStoredProfile=function(event){
    if(event.key!==Mac.STORAGE_KEY || !event.newValue)return;
    try{
      const saved=JSON.parse(event.newValue);if(saved.schema!==Mac.DefaultState.schema)return;
      const backupId=Mac.session.surface==='time-machine' ? Mac.state.timeMachine.snapshots[TM.index]?.id : null;
      Mac.state=Mac.Store.load();Mac.sync();Mac.wm.refreshAll();Mac.Shell.renderDesktop();
      if(backupId){const index=Mac.state.timeMachine.snapshots.findIndex(s=>s.id===backupId);if(index>=0){TM.index=index;TM.render();}else Mac.Surfaces.close();}
    }catch(error){console.error('Could not synchronize saved profile',error);}
  };
  addEventListener('storage',Mac.syncStoredProfile);
  Mac.Finder.select=function(win,id){
    win.state.selected=id;
    for(const item of win.el.querySelectorAll('[data-file]'))item.classList.toggle('selected',item.dataset.file===id);
    const status=win.el.querySelector('.finder-status');if(status)status.outerHTML=this.statusBar(win,this.contents(win));
    if(win.state.view==='gallery'){
      const preview=win.el.querySelector('.finder-content > div > div:first-child'),node=Mac.FS.node(id);
      if(preview && node)preview.innerHTML=`<div style="text-align:center"><div style="width:140px;height:140px;margin:0 auto">${Mac.appIcon(Mac.FS.iconFor(node))}</div><strong>${esc(node.name)}</strong><p class="muted">${esc(Mac.FS.kindLabel(node))} — ${Mac.bytes(Mac.FS.sizeOf(node))}</p></div>`;
    }
    if(win.state.view==='column'){
      const html=this.columnView(win).match(/<div class="finder-preview">[\s\S]*?<\/div>/)?.[0],preview=win.el.querySelector('.finder-preview');
      if(preview && html)preview.outerHTML=html;else if(html)win.el.querySelector('.finder-columns')?.insertAdjacentHTML('beforeend',html);
    }
  };

  B.isPrivate=win=>Boolean(win?.state?.privateBrowsing ?? Mac.state.browser.private);
  B.defaultPage=initial=>{
    const choice=Mac.state.browser[initial ? 'newWindowsWith' : 'newTabsWith'];
    return choice==='Homepage' ? Mac.state.browser.homepage.trim() || 'start' : choice==='Empty Page' ? 'blank' : 'start';
  };
  const normalize=B.normalize,titleFor=B.titleFor,page=B.page,newTab=B.newTab,navigate=B.navigate,record=B.record,renderBrowser=B.render;
  B.normalize=function(input){
    if(input==='blank' || input==='about:blank')return 'blank';
    const host=String(input).replace(/^live:/,'').replace(/^https?:\/\//,'').replace(/\/$/,'');
    if(['www.apple.com','apple.com'].includes(host))return 'apple.local';
    if(host==='support.apple.com')return 'support.apple.local';
    return normalize.call(this,input);
  };
  B.titleFor=function(url){return url==='blank' ? 'Empty Page' : titleFor.call(this,url);};
  B.page=function(win,tab){const html=tab.url==='blank' ? '<div class="safari-empty-page"></div>' : page.call(this,win,tab);return tab.url==='start' && this.isPrivate(win) ? '<div class="safari-private-notice"><strong>Private Browsing</strong><p>Safari won’t save your browsing history in this window.</p></div>'+html : html;};
  B.newTab=function(win,url,options={}){
    const destination=url===undefined ? this.defaultPage(Boolean(options.initial)) : url;
    const tab=newTab.call(this,win,['start','blank'].includes(destination) ? destination : 'start',options);
    tab.createdAt=Date.now();tab.private=this.isPrivate(win);
    if(!['start','blank'].includes(destination)){
      const active=win.state.activeTab;win.state.activeTab=tab.id;
      this.navigate(win,destination,{replace:true});win.state.activeTab=active;
    }
    return tab;
  };
  B.documentWindow=function(win){
    if(win?.appId==='safari' && !win.state.preferences)return win;
    return Mac.wm.forApp('safari').find(w=>!w.state.preferences) || Mac.wm.open('safari',{newWindow:true});
  };
  B.navigate=function(win,input,options){
    win=this.documentWindow(win);
    const previous=this.contextWindow;this.contextWindow=win;
    try{return navigate.call(this,win,input,options);}finally{this.contextWindow=previous;}
  };
  B.searchDestination=function(query){
    const s=Mac.state.browser;
    const engine=this.isPrivate(this.contextWindow) && s.privateSearchEngine!=='Default' ? s.privateSearchEngine : s.searchEngine;
    const urls={Google:'https://www.google.com/search?q=',Yahoo:'https://search.yahoo.com/search?p=',Bing:'https://www.bing.com/search?q=',DuckDuckGo:'https://duckduckgo.com/?q=',Ecosia:'https://www.ecosia.org/search?q='};
    return (urls[engine] || urls.Google)+encodeURIComponent(query);
  };
  B.pruneHistory=function(now=Date.now()){
    const days={'After one day':1,'After one week':7,'After two weeks':14,'After one month':30,'After one year':365};
    const age=days[Mac.state.browser.removeHistory];
    if(age)Mac.state.browser.history=Mac.state.browser.history.filter(h=>h.at>=now-age*86400000);
  };
  B.record=function(tab){
    if(tab.private || ['start','blank','settings','history','downloads','bookmarks'].includes(tab.url))return;
    const previous=Mac.state.browser.private;Mac.state.browser.private=false;
    try{record.call(this,tab);}finally{Mac.state.browser.private=previous;}
    this.pruneHistory();
    if(tab.live?.kind==='wiki'){
      const host=tab.live.target?.host || 'wikipedia.org';
      if(!Mac.state.browser.websiteData.some(item=>item.host===host))Mac.state.browser.websiteData.push({host,type:'Cache'});
    }
    Mac.save();this.saveSession();
  };
  B.clearHistory=function(range='all history',now=Date.now()){
    const midnight=new Date(now);midnight.setHours(0,0,0,0);
    const cutoff=range==='the last hour' ? now-3600000 : range==='today' ? midnight.getTime() : range==='today and yesterday' ? midnight.getTime()-86400000 : -Infinity;
    Mac.state.browser.history=Mac.state.browser.history.filter(h=>h.at<cutoff);
    Mac.save();Mac.wm.refresh('safari');
  };
  const livePage=B.livePage;
  B.livePage=function(win,tab){
    const permissions=['allow-same-origin','allow-forms'];
    if(Mac.state.browser.javascript)permissions.push('allow-scripts');
    if(Mac.state.browser.popupPolicy==='Allow')permissions.push('allow-popups','allow-popups-to-escape-sandbox');
    return livePage.call(this,win,tab).replace('sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"',`sandbox="${permissions.join(' ')}"`);
  };
  B.finishDownload=function(name,size,parent='dir-downloads'){
    const node=Mac.FS.createFile(parent,name,{ext:name.split('.').pop(),size});
    Mac.state.browser.downloads.unshift({id:Mac.uid('dl'),name:node.name,size,at:Date.now(),fileId:node.id,parent});
    Mac.save();Mac.wm.refresh('finder');Mac.Notify.show('Safari',`“${node.name}” was downloaded.`,{app:'safari'});
    if(Mac.state.browser.openSafeFiles && ['pdf','txt','rtf','png','jpg','jpeg'].includes(node.ext))Mac.wm.open(Mac.FS.openerFor(node),{newWindow:true,state:{fileId:node.id}});
    return node;
  };
  B.download=function(name,size){
    if(Mac.state.browser.downloadLocation!=='Ask for each download')return this.finishDownload(name,size);
    this.downloadFolder='dir-downloads';
    Mac.Dialog.open({title:'Save',wide:true,body:`<label class="safari-pref-row"><span>Save As:</span><input class="field" aria-label="Save As" data-download-name value="${esc(name)}"></label><label class="safari-pref-row"><span>Where:</span><select class="field" aria-label="Where" data-download-folder>${['dir-desktop','dir-documents','dir-downloads','dir-pictures'].map(id=>`<option value="${id}" ${id==='dir-downloads' ? 'selected' : ''}>${esc(Mac.FS.node(id)?.name || id)}</option>`).join('')}</select></label>`,buttons:[{label:'Cancel'},{label:'Save',primary:true,action:()=>this.finishDownload(this.downloadName || name,size,this.downloadFolder)}]});this.downloadName=name;
  };
  B.saveSession=function(){
    if(this.restoring || !Mac.state)return;
    const windows=Mac.wm.forApp('safari').filter(w=>!w.state.preferences && !this.isPrivate(w));
    if(!windows.length && (!this.sessionOpened || Mac.wm.forApp('safari').some(w=>this.isPrivate(w))))return;
    Mac.state.browser.savedWindows=windows.map(w=>({urls:w.state.tabs.map(t=>t.url),createdAt:w.state.tabs.map(t=>t.createdAt || Date.now()),active:Math.max(0,w.state.tabs.findIndex(t=>t.id===w.state.activeTab))}));
    Mac.save();
  };
  const closeTab=B.closeTab;
  B.closeTab=function(win,id){closeTab.call(this,win,id);this.saveSession();};
  B.expireTabs=function(win,now=Date.now()){
    const days={'After One Day':1,'After One Week':7,'After One Month':30}[Mac.state.browser.closeTabs];
    if(!days)return;
    const expired=win.state.tabs.filter(t=>t.createdAt && t.createdAt<now-days*86400000);
    for(const tab of expired){Mac.Web.cancel(tab);clearTimeout(tab.timer);}
    win.state.tabs=win.state.tabs.filter(t=>!expired.includes(t));
    if(!win.state.tabs.length)this.newTab(win);
    if(!win.state.tabs.some(t=>t.id===win.state.activeTab))win.state.activeTab=win.state.tabs[0].id;
  };
  B.fullAddress=tab=>tab.url==='start' || tab.url==='blank' ? '' : tab.url==='apple.local' ? 'https://www.apple.com' : tab.url==='support.apple.local' ? 'https://support.apple.com' : tab.url.replace(/^(offline|unreachable|dnsfail|proxyfail|search|live):/,'');
  B.displayAddress=function(tab){
    const address=this.fullAddress(tab);
    if(Mac.state.browser.showFullAddress || !tab.url.startsWith('live:') && !/^https?:\/\//.test(address))return address;
    try{return new URL(address.includes('://') ? address : 'https://'+address).host;}catch{return address;}
  };
  B.render=function(win){
    this.expireTabs(win);
    win.el?.classList.toggle('safari-private',this.isPrivate(win));
    let html=renderBrowser.call(this,win);
    const bar=html.match(/<div class="browser-bar">[\s\S]*?<\/div>/)?.[0] || '';
    const strip=html.match(/<div class="tab-strip">[\s\S]*?<\/div>/)?.[0] || '';
    const tab=this.tab(win);
    win.chromeMarkup=bar.replace(/<input value="[^"]*"/,`<input value="${esc(this.displayAddress(tab))}"`);
    html=html.replace(bar,'');
    if(Mac.state.browser.tabLayout==='Compact'){
      win.chromeMarkup=win.chromeMarkup.replace('<form class="address-field"',strip+'<form class="address-field"');html=html.replace(strip,'');
    }
    return html;
  };
  const safari=Mac.apps.safari,leadSafari=safari.leading;
  safari.leading=win=>win.state.preferences ? leadSafari?.(win) || '' : win.chromeMarkup || '';
  safari.toolbar=()=>'';
  const buildMenus=Mac.Menus.build;
  Mac.Menus.build=function(appId){const menus=buildMenus.call(this,appId);if(appId==='safari')menus.File=[...Mac.apps.safari.menus({state:{preferences:false}}).File,'sep',{label:'Open…',command:'open-item',shortcut:'⌘O'},{label:'Close Window',command:'close-window',shortcut:'⇧⌘W'},{label:'Print…',command:'print',shortcut:'⌘P'}];return menus;};
  document.addEventListener('keydown',event=>{
    const win=Mac.wm.active(),key=event.key.toLowerCase();
    if(win?.appId!=='safari' || win.state.preferences || !(event.metaKey || event.ctrlKey) || event.altKey || !['n','w','t'].includes(key))return;
    event.preventDefault();event.stopImmediatePropagation();
    Mac.run(key==='n' ? event.shiftKey ? 'browser-private' : 'browser-new-window' : key==='t' ? 'browser-new-tab' : event.shiftKey ? 'close-window' : 'browser-close-tab',null,event.target);
  },true);
  const nativeOpen=Mac.wm.open;
  Mac.wm.open=function(appId,options={}){
    const restoreLaunchSession=!options.newWindow && !options.state?.initialUrl && options.state?.privateBrowsing===undefined;
    if(['safari','finder'].includes(appId) && !options.newWindow){
      const existing=this.forApp(appId).find(w=>!w.state.preferences && !w.state.viewOptions);
      if(existing){
        if(options.state)Object.assign(existing.state,options.state);
        if(existing.space!==Mac.session.space)this.gotoSpace(existing.space);
        if(existing.minimized)this.unminimize(existing.id);
        this.render(existing);this.focus(existing.id);return existing;
      }
      options={...options,newWindow:true};
    }
    if(appId==='safari'){
      const first=!this.forApp('safari').some(w=>!w.state.preferences);
      const saved=first && restoreLaunchSession && !B.restoring && Mac.state.browser.opensWith==='All windows from last session' ? Mac.clone(Mac.state.browser.savedWindows) : [];
      B.sessionOpened=true;
      if(saved.length){
        B.restoring=true;let firstWin;
        try{
          for(const entry of saved){
            const win=nativeOpen.call(this,'safari',{newWindow:true,state:{privateBrowsing:false,initialUrl:'blank'}});firstWin ||= win;
            for(const t of win.state.tabs)Mac.Web.cancel(t);
            win.state.tabs=[];
            for(const [index,url] of entry.urls.entries()){const tab=B.newTab(win,url);const age=entry.createdAt?.[index];if(Number.isFinite(age) && age>0)tab.createdAt=age;}
            if(!win.state.tabs.length)B.newTab(win);
            win.state.activeTab=win.state.tabs[Math.min(entry.active,win.state.tabs.length-1)].id;this.render(win);
          }
          this.focus(firstWin.id);return firstWin;
        }finally{B.restoring=false;B.saveSession();}
      }
      options={...options,state:{privateBrowsing:first && Mac.state.browser.opensWith==='A new private window',...options.state}};
    }
    return nativeOpen.call(this,appId,options);
  };
  const closeApp=Mac.wm.closeApp;
  Mac.wm.closeApp=function(appId){if(appId!=='safari')return closeApp.call(this,appId);B.saveSession();B.restoring=true;try{return closeApp.call(this,appId);}finally{B.restoring=false;}};
  Mac.on('windows',()=>B.saveSession());
  document.addEventListener('focusin',event=>{
    if(event.target.matches('[data-address-form] input')){
      const win=Mac.wm.windows.get(event.target.closest('.window')?.dataset.win);
      if(win){event.target.value=B.fullAddress(B.tab(win));event.target.select();}
    }
  });
  document.addEventListener('input',event=>{if(event.target.matches('[data-safari-preference]'))Mac.set('browser.'+event.target.dataset.safariPreference,event.target.value,{silent:true});});
  document.addEventListener('focusout',event=>{
    if(event.target.matches('[data-address-form] input')){
      const win=Mac.wm.windows.get(event.target.closest('.window')?.dataset.win);
      if(win)event.target.value=B.displayAddress(B.tab(win));
    }
  });
  document.addEventListener('click',event=>{
    if(!event.metaKey && !event.ctrlKey)return;
    const link=event.target.closest('[data-command="browse"]');
    const win=Mac.wm.windows.get(link?.closest('.window')?.dataset.win);
    if(!win || win.appId!=='safari' || win.state.preferences)return;
    event.preventDefault();event.stopImmediatePropagation();
    if(Mac.state.browser.commandClickTab){B.newTab(win,link.dataset.arg,{activate:Mac.state.browser.activateNewTab});Mac.wm.render(win);B.saveSession();}
    else {Mac.wm.open('safari',{newWindow:true,state:{initialUrl:link.dataset.arg,privateBrowsing:B.isPrivate(win)}});if(!Mac.state.browser.activateNewTab)Mac.wm.focus(win.id);}
  },true);

  /* Folder restoration is a transaction on the virtual filesystem. */
  TM.available=()=>Boolean(Mac.state.volumes.find(v=>v.id==='vol-backup' && v.mounted!==false));
  TM.subtree=function(files,id){
    const ids=new Set([id]);let previous;
    do{previous=ids.size;for(const node of files)if(ids.has(node.parent))ids.add(node.id);}while(ids.size!==previous);
    return files.filter(n=>ids.has(n.id));
  };
  TM.restore=function(id=this.selected,{mode}={}){
    const snapshot=Mac.state.timeMachine.snapshots[this.index],node=snapshot?.files.find(n=>n.id===id);
    if(!this.available() || !node || !['file','folder'].includes(node.kind))return false;
    const next=Mac.clone(Mac.state.fs),parents=new Map();
    const ensureParent=(parent,seen=new Set())=>{
      if(!parent)return parent;
      if(parents.has(parent))return parents.get(parent);
      if(seen.has(parent))throw new Error('Invalid backup folder hierarchy');seen.add(parent);
      const ancestor=snapshot.files.find(n=>n.id===parent);if(!ancestor)throw new Error('Missing backup folder');
      const resolvedParent=ensureParent(ancestor.parent,seen);
      const current=next.find(n=>n.parent===resolvedParent && n.name===ancestor.name);
      if(current){if(!['folder','volume'].includes(current.kind))throw new Error('A file occupies the backup folder path');parents.set(parent,current.id);return current.id;}
      const copy={...Mac.clone(ancestor),parent:resolvedParent,id:next.some(n=>n.id===parent) ? Mac.uid('restored') : parent};
      next.push(copy);parents.set(parent,copy.id);return copy.id;
    };
    let parent;
    try{parent=ensureParent(node.parent);}catch(error){Mac.Dialog.open({title:'Cannot Restore Item',body:esc(error.message),buttons:[{label:'OK',primary:true}]});return false;}
    const existing=next.find(n=>n.parent===parent && n.name===node.name);
    if(existing && !mode){
      Mac.Dialog.open({title:`“${node.name}” already exists`,body:'Choose whether to keep both items or replace the current item with the version from this backup.',buttons:[{label:'Cancel'},{label:'Keep Both',action:()=>this.restore(id,{mode:'both'})},{label:'Replace',primary:true,action:()=>this.restore(id,{mode:'replace'})}]});return false;
    }
    const saved=this.subtree(snapshot.files,id);
    if(existing && mode!=='both'){const remove=new Set(this.subtree(next,existing.id).map(n=>n.id));for(let i=next.length-1;i>=0;i--)if(remove.has(next[i].id))next.splice(i,1);}
    const ids=new Map(saved.map(n=>[n.id,mode==='both' || next.some(current=>current.id===n.id) ? Mac.uid('restored') : n.id]));
    const copies=saved.map(n=>({...Mac.clone(n),id:ids.get(n.id),parent:ids.get(n.parent) || parents.get(n.parent) || n.parent}));
    if(mode==='both'){
      let suffix=2,name=node.name;const dot=node.kind==='file' ? name.lastIndexOf('.') : -1;
      do{name=dot>0 ? node.name.slice(0,dot)+' '+suffix+node.name.slice(dot) : node.name+' '+suffix;suffix++;}while(next.some(n=>n.parent===parent && n.name===name));
      copies.find(n=>n.id===ids.get(id)).name=name;
    }
    next.push(...copies);Mac.state.fs=next;Mac.save();Mac.Surfaces.close();Mac.wm.refreshAll();Mac.Shell.renderDesktop();
    Mac.Notify.show('Time Machine',`“${node.name}” was restored.`,{app:'time-machine'});return true;
  };
  const tmRender=TM.render;
  TM.render=function(){
    tmRender.call(this);
    const layer=Mac.$('#surface-layer');
    layer.innerHTML=layer.innerHTML.replace(/data-command="tm-folder" data-arg="([^"]+)"/g,(match,id)=>id==='dir-home' ? match : `data-command="tm-select" data-arg="${id}" data-tm-folder="${id}"`);
  };
  TM.select=function(id){
    const node=Mac.state.timeMachine.snapshots[this.index]?.files.find(n=>n.id===id);
    if(!node || !['file','folder'].includes(node.kind))return false;
    this.selected=id;const surface=Mac.$('.tm-browser');
    for(const item of surface.querySelectorAll('.tm-files [role=option]'))item.setAttribute('aria-selected',String(item.dataset.arg===id));
    const restore=surface.querySelector('[data-command="tm-restore"]');if(restore)restore.disabled=false;return true;
  };
  document.addEventListener('dblclick',event=>{const item=event.target.closest('[data-tm-folder]');if(item){TM.folder=item.dataset.tmFolder;TM.selected=null;TM.render();}});
  TM.interval=()=>({'Automatically Every Hour':3600000,'Automatically Every Day':86400000,'Automatically Every Week':604800000}[Mac.state.timeMachine.frequency] || 0);
  const backup=TM.backup;
  TM.backup=function(now=Date.now()){
    if(!this.available())return backup.call(this);
    const displayed=Mac.session.surface==='time-machine' ? Mac.state.timeMachine.snapshots[this.index] : null;
    Mac.state.timeMachine.nextBackupAt=this.interval() ? now+this.interval() : 0;
    const result=backup.call(this);
    if(result){
      result.at=now;
      if(displayed){
        if(!Mac.state.timeMachine.snapshots.some(s=>s.id===displayed.id))Mac.state.timeMachine.snapshots=[...Mac.state.timeMachine.snapshots.slice(0,11),displayed];
        this.index=Mac.state.timeMachine.snapshots.findIndex(s=>s.id===displayed.id);this.render();
      }
      Mac.save();
    }return result;
  };
  TM.tick=function(now=Date.now()){
    if(!Mac.state)return;
    const s=Mac.state.timeMachine,interval=this.interval();
    if(!interval){if(s.nextBackupAt){s.nextBackupAt=0;Mac.save();}return;}
    if(!s.nextBackupAt){s.nextBackupAt=(s.snapshots[0]?.at || now)+interval;Mac.save();}
    if(this.available() && now>=s.nextBackupAt)return this.backup(now);
  };
  TM.settings=function(){this.tick();const latest=Mac.state.timeMachine.snapshots[0],next=this.interval() ? this.available() ? new Date(Mac.state.timeMachine.nextBackupAt).toLocaleString() : 'When the disk is connected' : 'Manually';return `${UI.header('Time Machine')}${UI.group(UI.info('Time Machine Backup',this.available() ? 'Connected' : 'Not connected'),UI.info('Latest backup',latest ? new Date(latest.at).toLocaleString() : 'None'),UI.info('Next backup',next))}${UI.group(UI.action('Back Up Now','time-machine-backup'),UI.action('Browse Time Machine Backups','time-machine-browse'),UI.action('Add Backup Disk…','tm-select-disk'),UI.action('Options…','tm-options'))}`;};
  const set=Mac.set;
  Mac.set=function(path,value,options){if(path==='timeMachine.frequency')Mac.state.timeMachine.nextBackupAt=0;return set(path,value,options);};
  setInterval(()=>{if(Mac.session.booted)TM.tick();},60000);

  const FV=Mac.FinderViewOptions={
    get(win){return Mac.state.finderViews[win.state.location] || Mac.clone(Mac.state.finderViewDefaults);},
    set(win,key,value){const prefs=this.get(win);prefs[key]=value;Mac.state.finderViews[win.state.location]=prefs;if(key==='sort')win.state.sort=value;Mac.save();Mac.wm.render(win);},
    body(win){const p=this.get(win);return `<div class="finder-options-body"><strong>${esc(Mac.Finder.locationName(win))}</strong><button role="checkbox" aria-checked="${p.alwaysOpen}" data-command="finder-pref-toggle" data-arg="alwaysOpen">${p.alwaysOpen ? '☑' : '☐'} Always open in ${win.state.view} view</button><label>Sort by<select class="field" aria-label="Sort by" data-finder-preference="sort">${[['name','Name'],['kind','Kind'],['date','Date Modified'],['size','Size']].map(([v,l])=>`<option value="${v}" ${p.sort===v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>${win.state.view==='icon' ? `<label>Icon size<input type="range" aria-label="Icon size" min="16" max="128" step="4" data-finder-preference="iconSize" value="${p.iconSize}"></label><label>Grid spacing<input type="range" aria-label="Grid spacing" min="4" max="40" data-finder-preference="gridSpacing" value="${p.gridSpacing}"></label>` : ''}<label>Text size<select class="field" aria-label="Text size" data-finder-preference="textSize">${[10,11,12,13,14,15,16].map(v=>`<option ${v===p.textSize ? 'selected' : ''}>${v}</option>`).join('')}</select></label><button role="checkbox" aria-checked="${p.showInfo}" data-command="finder-pref-toggle" data-arg="showInfo">${p.showInfo ? '☑' : '☐'} Show item info</button><button class="btn" data-command="finder-pref-defaults">Use as Defaults</button></div>`;},
    owner(win){return Mac.wm.windows.get(win?.state.owner);},
    open(win){win=win?.state.viewOptions ? this.owner(win) : win || Mac.wm.open('finder');const existing=Mac.wm.forApp('finder').find(w=>w.state.viewOptions && w.state.owner===win.id);if(existing){Mac.wm.close(existing.id);return;}return Mac.wm.create({...Mac.apps.finder,size:[330,440]},{state:{viewOptions:true,owner:win.id}});}
  };
  const finder=Mac.apps.finder,renderFinder=finder.render,titleFinder=finder.titleFor,toolsFinder=finder.toolbar,leadFinder=finder.leading;
  finder.render=win=>{
    win.el?.classList.toggle('finder-view-options',Boolean(win.state.viewOptions));
    if(win.state.viewOptions)return FV.owner(win) ? FV.body(FV.owner(win)) : '';
    const p=FV.get(win);
    if(win.viewLocation!==win.state.location){win.viewLocation=win.state.location;win.state.sort=p.sort;if(p.alwaysOpen)win.state.view=p.view;}
    win.el?.style.setProperty('--finder-icon-size',p.iconSize+'px');win.el?.style.setProperty('--finder-grid-gap',p.gridSpacing+'px');win.el?.style.setProperty('--finder-text-size',p.textSize+'px');
    return renderFinder(win);
  };
  finder.titleFor=win=>win.state.viewOptions ? 'View Options' : titleFinder(win);
  finder.toolbar=win=>win.state.viewOptions ? '' : toolsFinder(win);
  finder.leading=win=>win.state.viewOptions ? '' : leadFinder?.(win) || '';
  const finderMenus=finder.menus;
  finder.menus=win=>{const menus=finderMenus(win);menus.View.push('sep',{label:win?.state.viewOptions ? 'Hide View Options' : 'Show View Options',command:'finder-view-options',shortcut:'⌘J'});return menus;};
  const iconView=Mac.Finder.iconView;
  Mac.Finder.iconView=(win,nodes)=>{let html=iconView.call(Mac.Finder,win,nodes);if(FV.get(win).showInfo)for(const node of nodes)html=html.replace(`<span>${esc(node.name)}</span>`,`<span>${esc(node.name)}</span><small>${esc(node.kind==='folder' ? Mac.plural(Mac.FS.children(node.id).length,'item') : Mac.bytes(node.size || 0))}</small>`);return html;};
  document.addEventListener('change',event=>{
    const target=event.target;
    if(target.matches('[data-finder-preference]')){
      const options=Mac.wm.windows.get(target.closest('.window')?.dataset.win),owner=FV.owner(options);
      if(owner){const key=target.dataset.finderPreference;FV.set(owner,key,key==='sort' ? target.value : Number(target.value));Mac.wm.render(options);}
    }
    if(target.matches('[data-clear-history-range]'))B.clearRange=target.value;
    if(target.matches('[data-spotlight-folder]'))Mac.Settings.privacyDraft=target.value;
    if(target.matches('[data-download-folder]'))B.downloadFolder=target.value;
    if(target.matches('[data-download-name]'))B.downloadName=target.value;
  });
  document.addEventListener('keydown',event=>{const win=Mac.wm.active();if((event.metaKey || event.ctrlKey) && event.key.toLowerCase()==='j' && win?.appId==='finder'){event.preventDefault();FV.open(win);}});
  const focus=Mac.Settings.panes.Focus;
  Mac.Settings.panes.Focus=()=>focus().replace(UI.action('Share across devices','generic','Focus turns on for every device signed into this account.'),UI.toggle('Share across devices','settings.focusAcrossDevices'));
  Mac.Settings.subPanes['Search Privacy']=()=>`${UI.header('Search Privacy')}<div class="group"><div class="spotlight-locations" role="listbox" aria-label="Excluded locations">${Mac.state.settings.spotlightExcluded.map(id=>`<button role="option" aria-selected="${Mac.Settings.privacySelected===id}" data-command="spotlight-location" data-arg="${esc(id)}">${glyph('folder')} ${esc(Mac.FS.node(id)?.name || id)}</button>`).join('') || '<p class="muted">No excluded locations</p>'}</div><div class="row"><button class="btn" aria-label="Add excluded location" data-command="spotlight-location-add">+</button><button class="btn" aria-label="Remove excluded location" data-command="spotlight-location-remove" ${!Mac.Settings.privacySelected ? 'disabled' : ''}>−</button></div></div>`;
  const spotResults=Mac.Spotlight.results;
  Mac.Spotlight.results=function(query){const excluded=new Set(Mac.state.settings.spotlightExcluded);return spotResults.call(this,query).map(group=>({...group,items:group.items.filter(item=>item.kind!=='file' || !Mac.FS.path(item.node.id).some(n=>excluded.has(n.id)))})).filter(group=>group.items.length);};

  const run=Mac.run;
  Mac.run=async(command,arg,element)=>{
    const win=Mac.wm.windows.get(element?.closest?.('.window')?.dataset.win) || Mac.wm.active();
    if(command==='tm-select')return TM.select(arg);
    if(command==='spotlight-location'){Mac.Settings.privacySelected=arg;Mac.wm.refresh('settings');return;}
    if(command==='spotlight-location-remove'){Mac.state.settings.spotlightExcluded=Mac.state.settings.spotlightExcluded.filter(id=>id!==Mac.Settings.privacySelected);Mac.Settings.privacySelected=null;Mac.save();Mac.wm.refresh('settings');return;}
    if(command==='spotlight-location-add'){
      Mac.Settings.privacyDraft='dir-desktop';
      Mac.Dialog.open({title:'Choose a Folder',wide:true,body:`<label class="safari-pref-row"><span>Folder:</span><select class="field" aria-label="Folder" data-spotlight-folder>${Mac.state.fs.filter(n=>n.kind==='folder' && !n.hiddenInTrash).map(n=>`<option value="${esc(n.id)}" ${n.id==='dir-desktop' ? 'selected' : ''}>${esc(Mac.FS.pathString(n.id))}</option>`).join('')}</select></label>`,buttons:[{label:'Cancel'},{label:'Choose',primary:true,action:()=>{const id=Mac.Settings.privacyDraft;if(!Mac.state.settings.spotlightExcluded.includes(id))Mac.state.settings.spotlightExcluded.push(id);Mac.Settings.privacySelected=id;Mac.save();Mac.wm.refresh('settings');}}]});return;
    }
    if(command==='finder-view-options')return FV.open(win?.appId==='finder' ? win : null);
    if(command==='finder-pref-toggle'){const owner=FV.owner(win);if(owner){FV.set(owner,arg,!FV.get(owner)[arg]);Mac.state.finderViews[owner.state.location].view=owner.state.view;Mac.save();Mac.wm.render(win);}return;}
    if(command==='finder-pref-defaults'){const owner=FV.owner(win);if(owner){Mac.state.finderViewDefaults={...FV.get(owner),alwaysOpen:false};Mac.save();}return;}
    if(command==='browser-new-tab'){const target=B.documentWindow(win);B.newTab(target);Mac.wm.render(target);Mac.wm.focus(target.id);B.saveSession();return;}
    if(command==='browser-private')return Mac.wm.open('safari',{newWindow:true,state:{privateBrowsing:true,initialUrl:'start'}});
    if(command==='browser-new-window')return Mac.wm.open('safari',{newWindow:true});
    if(command==='clear-history'){B.clearRange='all history';Mac.Dialog.open({title:'Clear History',wide:true,body:'<label class="safari-pref-row"><span>Clear:</span><select class="field" aria-label="Clear" data-clear-history-range><option>the last hour</option><option>today</option><option>today and yesterday</option><option selected>all history</option></select></label>',buttons:[{label:'Cancel'},{label:'Clear History',primary:true,action:()=>B.clearHistory(B.clearRange)}]});return;}
    if(command==='safari-website-data'){
      Mac.Dialog.open({title:'Manage Website Data',wide:true,body:Mac.state.browser.websiteData.map(d=>`<div class="row"><strong>${esc(d.host)}</strong><span class="muted">${esc(d.type)}</span></div>`).join('') || '<p>No website data</p>',buttons:[{label:'Remove All',disabled:!Mac.state.browser.websiteData.length,action:()=>{Mac.state.browser.websiteData=[];Mac.save();}},{label:'Done',primary:true}]});return;
    }
    if(command==='browser-share'){const tab=B.tab(B.documentWindow(win));Mac.Dialog.open({title:'Share',wide:true,body:`<p>${esc(tab.title)}</p>`,buttons:[{label:'Cancel'},{label:'Mail',action:()=>Mac.Mail.compose({prefill:{subject:tab.title,body:B.fullAddress(tab)}})}]});return;}
    return run(command,arg,element);
  };
}(window.Mac));
