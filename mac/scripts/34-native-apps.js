/* Native secondary preferences and virtual Time Machine file versions. */
(function (Mac) {
  'use strict';
  const {UI,esc,glyph} = Mac;
  Object.assign(Mac.DefaultState.settings,{trackpadClick:'Medium',trackpadLookUp:'Force Click with One Finger',trackpadSecondary:'Click or Tap with Two Fingers',trackpadZoom:true,trackpadSmartZoom:true,trackpadRotate:true,trackpadPages:'Scroll Left or Right with Two Fingers',trackpadSpaces:'Swipe Left or Right with Four Fingers',trackpadNotifications:true,trackpadMission:'Swipe Up with Three Fingers',trackpadExpose:'Off',trackpadDesktop:true});
  Object.assign(Mac.DefaultState.browser,{searchEngine:'Google',privateSearchEngine:'Default',searchSuggestions:true,safariSuggestions:true,quickSearch:true,preloadTopHit:true,showStartPage:true});
  Mac.DefaultState.browser.bookmarks = Mac.DefaultState.browser.bookmarks.filter(b => !b.url.startsWith('kb.local'));
  Mac.DefaultState.mail.rules = Mac.DefaultState.mail.rules.map(r => ({...r,name:r.name.replace('training mail','important mail'),value:r.value === 'learning@' ? 'dana@' : r.value}));
  Mac.DefaultState.timeMachine = {frequency:'Automatically Every Hour',snapshots:[{id:'backup-initial',at:Date.now()-86400000,files:Mac.clone(Mac.DefaultState.fs)}]};
  Mac.Browser.searchDestination = query => {
    const engine=Mac.state.browser.private && Mac.state.browser.privateSearchEngine !== 'Default' ? Mac.state.browser.privateSearchEngine : Mac.state.browser.searchEngine;
    const urls={Google:'https://www.google.com/search?q=',Yahoo:'https://search.yahoo.com/search?p=',Bing:'https://www.bing.com/search?q=',DuckDuckGo:'https://duckduckgo.com/?q=',Ecosia:'https://www.ecosia.org/search?q='};
    return (urls[engine] || urls.Google)+encodeURIComponent(query);
  };
  const normalize=Mac.Browser.normalize;
  Mac.Browser.normalize = function (input) {
    const value=String(input || '').replace(/^search:/,'');
    const result=normalize.call(this,value);
    return result.startsWith('search:') ? 'live:'+this.searchDestination(value) : result;
  };
  Mac.Browser.settingsPage=()=>`<div class="web-page"><div class="web-wrap"><h1>Search</h1>${UI.group(UI.select('Search engine','browser.searchEngine',['Google','Yahoo','Bing','DuckDuckGo','Ecosia']),UI.select('Private Browsing search engine','browser.privateSearchEngine',['Default','Google','Yahoo','Bing','DuckDuckGo','Ecosia']),UI.toggle('Include search engine suggestions','browser.searchSuggestions'))}${UI.group(UI.toggle('Include Safari Suggestions','browser.safariSuggestions'),UI.toggle('Enable Quick Website Search','browser.quickSearch'),UI.toggle('Preload Top Hit in the background','browser.preloadTopHit'),UI.toggle('Show Start Page','browser.showStartPage'))}</div></div>`;
  const S = Mac.Settings;
  S.trackpadTab = 'Point & Click';
  S.panes.Trackpad = () => {
    const tab=S.trackpadTab;
    const choices=(label,path,items)=>UI.select(label,'settings.'+path,items);
    let content='';
    if(tab==='Point & Click') content=UI.group(UI.slider('Tracking speed','settings.trackpadSpeed'),choices('Click','trackpadClick',['Light','Medium','Firm']),UI.toggle('Force Click and haptic feedback','settings.forceClick'),choices('Look up & data detectors','trackpadLookUp',['Off','Force Click with One Finger','Tap with Three Fingers']),choices('Secondary click','trackpadSecondary',['Off','Click or Tap with Two Fingers','Click in Bottom Right Corner','Click in Bottom Left Corner']),UI.toggle('Tap to click','settings.tapToClick','Tap with one finger'));
    if(tab==='Scroll & Zoom') content=UI.group(UI.toggle('Natural scrolling','settings.naturalScroll'),UI.toggle('Zoom in or out','settings.trackpadZoom','Pinch with two fingers'),UI.toggle('Smart zoom','settings.trackpadSmartZoom','Double-tap with two fingers'),UI.toggle('Rotate','settings.trackpadRotate','Rotate with two fingers'));
    if(tab==='More Gestures') content=UI.group(choices('Swipe between pages','trackpadPages',['Off','Scroll Left or Right with Two Fingers','Swipe with Three Fingers','Swipe with Two or Three Fingers']),choices('Swipe between full-screen applications','trackpadSpaces',['Off','Swipe Left or Right with Three Fingers','Swipe Left or Right with Four Fingers']),UI.toggle('Notification Center','settings.trackpadNotifications','Swipe left from the right edge with two fingers'),choices('Mission Control','trackpadMission',['Off','Swipe Up with Three Fingers','Swipe Up with Four Fingers']),choices('App Exposé','trackpadExpose',['Off','Swipe Down with Three Fingers','Swipe Down with Four Fingers']),UI.toggle('Show Desktop','settings.trackpadDesktop','Spread with thumb and three fingers'));
    return `${UI.header('Trackpad')}<div class="native-segments" role="tablist" aria-label="Trackpad settings">${['Point & Click','Scroll & Zoom','More Gestures'].map(t=>`<button role="tab" aria-selected="${t===tab}" data-command="trackpad-tab" data-arg="${t}">${t}</button>`).join('')}</div>${content}`;
  };

  const TM=Mac.TimeMachine={
    index:0,folder:'dir-documents',selected:null,
    available(){return Mac.state.volumes.find(v=>v.id==='vol-backup')?.mounted !== false;},
    backup(){
      if(!this.available()) return Mac.Dialog.info('The backup disk is not available','Connect the backup disk to start a backup.','time-machine');
      const snapshot={id:Mac.uid('backup'),at:Date.now(),files:Mac.clone(Mac.state.fs)};
      Mac.state.timeMachine.snapshots.unshift(snapshot);
      Mac.state.timeMachine.snapshots=Mac.state.timeMachine.snapshots.slice(0,12);
      Mac.save();Mac.wm.refreshAll();
      Mac.Notify.show('Time Machine','Backup completed.',{app:'time-machine'});
      return snapshot;
    },
    settings(){
      const tm=Mac.state.timeMachine,latest=tm.snapshots[0];
      return `${UI.header('Time Machine')}${UI.group(UI.info('Time Machine Backup',this.available() ? 'Connected' : 'Not connected'),UI.info('Latest backup',latest ? new Date(latest.at).toLocaleString() : 'None'),UI.info('Next backup',this.available() ? 'Automatically' : 'When the disk is connected'))}${UI.group(UI.action('Back Up Now','time-machine-backup'),UI.action('Browse Time Machine Backups','time-machine-browse'),UI.action('Add Backup Disk…','tm-select-disk'),UI.action('Options…','tm-options'))}`;
    },
    browse(){
      if(!this.available()) return Mac.Dialog.info('The backup disk is not available','Connect the backup disk to browse backups.','time-machine');
      if(!Mac.state.timeMachine.snapshots.length) return Mac.Dialog.info('No backups found','Time Machine has not created a backup yet.','time-machine');
      Mac.Surfaces.close();Mac.session.surface='time-machine';this.index=0;this.folder='dir-documents';this.selected=null;this.render();
    },
    render(){
      const snapshots=Mac.state.timeMachine.snapshots,snapshot=snapshots[this.index];
      if(!snapshot)return;
      const items=snapshot.files.filter(n=>n.parent===this.folder);
      const folder=snapshot.files.find(n=>n.id===this.folder);
      Mac.$('#surface-layer').innerHTML=`<section class="tm-browser" role="dialog" aria-label="Time Machine"><div class="tm-date">${esc(new Date(snapshot.at).toLocaleString())}</div><div class="tm-stack"><div class="tm-file-window"><header>${glyph('folder')} ${esc(folder?.name || 'Documents')}<button class="btn" data-command="tm-folder" data-arg="dir-home">${glyph('back')} Home</button></header><div class="tm-files" role="listbox" aria-label="Backup files">${items.map(n=>`<button role="option" aria-selected="${n.id===this.selected}" data-command="${n.kind==='folder' ? 'tm-folder' : 'tm-select'}" data-arg="${n.id}">${glyph(n.kind==='folder' ? 'folder' : 'document')}<span>${esc(n.name)}</span><small>${n.kind==='folder' ? 'Folder' : Mac.bytes(n.size || 0)}</small></button>`).join('') || '<p class="muted">No items</p>'}</div></div></div><nav class="tm-timeline" aria-label="Backup dates">${snapshots.map((s,i)=>`<button data-command="tm-version" data-arg="${i}" aria-current="${i===this.index}">${esc(new Date(s.at).toLocaleDateString())}<small>${esc(new Date(s.at).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}))}</small></button>`).join('')}</nav><footer><button class="btn" data-command="tm-close">Cancel</button><strong>Time Machine</strong><button class="btn primary" data-command="tm-restore" ${!this.selected ? 'disabled' : ''}>Restore</button></footer></section>`;
    },
    restore(id=this.selected){
      const snapshot=Mac.state.timeMachine.snapshots[this.index];
      const node=snapshot?.files.find(n=>n.id===id);
      if(!node || node.kind!=='file')return false;
      const copy=Mac.clone(node);
      const ensureParent=parent=>{if(!parent || Mac.FS.node(parent))return;const p=snapshot.files.find(n=>n.id===parent);if(p){ensureParent(p.parent);Mac.state.fs.push(Mac.clone(p));}};
      ensureParent(copy.parent);
      const old=Mac.state.fs.findIndex(n=>n.id===id);
      if(old<0)Mac.state.fs.push(copy);else Mac.state.fs[old]=copy;
      Mac.save();Mac.Surfaces.close();Mac.wm.refreshAll();Mac.Shell.renderDesktop();
      Mac.Notify.show('Time Machine',`“${copy.name}” was restored.`,{app:'time-machine'});
      return true;
    }
  };
  S.subPanes['Time Machine']=()=>TM.settings();
  Mac.apps['time-machine'].render=()=>TM.settings();
  Mac.apps['time-machine'].launch=()=>TM.browse();
  const general=S.panes.General;
  S.panes.General=()=>general().replace('data-command="open-app" data-arg="time-machine"','data-command="settings-sub" data-arg="Time Machine"');
  const run=Mac.run;
  Mac.run=async(command,arg,element)=>{
    if(command==='trackpad-tab'){S.trackpadTab=arg;Mac.wm.refresh('settings');return;}
    if(command==='time-machine-backup')return TM.backup();
    if(command==='time-machine-browse')return TM.browse();
    if(command==='tm-version'){TM.index=Number(arg);TM.selected=null;return TM.render();}
    if(command==='tm-folder'){TM.folder=arg;TM.selected=null;return TM.render();}
    if(command==='tm-select'){TM.selected=arg;return TM.render();}
    if(command==='tm-restore')return TM.restore();
    if(command==='tm-close')return Mac.Surfaces.close();
    if(command==='tm-options'){Mac.Dialog.open({title:'Options',wide:true,body:UI.group(UI.select('Backup frequency','timeMachine.frequency',['Automatically Every Hour','Automatically Every Day','Automatically Every Week','Manually'])),buttons:[{label:'Done',primary:true}]});return;}
    if(command==='tm-select-disk'){Mac.Dialog.open({title:'Select a Backup Disk',wide:true,body:UI.group(UI.info('Time Machine Backup','1 TB — APFS')),buttons:[{label:'Cancel'},{label:'Set Up Disk',primary:true,action:()=>{Mac.state.volumes.find(v=>v.id==='vol-backup').mounted=true;Mac.save();Mac.wm.refreshAll();}}]});return;}
    await run(command,arg,element);
  };
  const BP = Mac.BrowserPreferences = {
    sections:[['General','gear'],['Tabs','window'],['AutoFill','identity-card'],['Search','search'],['Security','lock'],['Privacy','shield'],['Websites','globe'],['Profiles','person'],['Extensions','puzzle'],['Advanced','gear']],
    select(label,key,options){return `<label class="safari-pref-row"><span>${esc(label)}:</span><select class="field" aria-label="${esc(label)}" data-select-path="browser.${key}">${options.map(o=>`<option ${o===Mac.state.browser[key] ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select></label>`;},
    check(label,key){const on=Boolean(Mac.state.browser[key]);return `<button class="safari-pref-check" role="checkbox" aria-checked="${on}" data-toggle-path="browser.${key}"><span class="checkbox ${on ? 'on' : ''}">${on ? '✓' : ''}</span>${esc(label)}</button>`;},
    panes(){return {
      General:()=>this.select('Safari opens with','opensWith',['A new window','A new private window','All windows from last session'])+this.select('New windows open with','newWindowsWith',['Start Page','Homepage','Empty Page'])+this.select('New tabs open with','newTabsWith',['Start Page','Homepage','Empty Page'])+`<label class="safari-pref-row"><span>Homepage:</span><input class="field" aria-label="Homepage" data-safari-preference="homepage" value="${esc(Mac.state.browser.homepage)}"></label>`+this.select('Remove history items','removeHistory',['After one day','After one week','After two weeks','After one month','After one year','Manually'])+this.select('File download location','downloadLocation',['Downloads','Ask for each download'])+this.check('Open “safe” files after downloading','openSafeFiles'),
      Tabs:()=>this.select('Organize tabs','organizeTabs',['Automatically Create Topics','Show Related Tabs','Never'])+this.select('Open pages in tabs instead of windows','openPagesTabs',['Never','Automatically','Always'])+this.select('Automatically close tabs','closeTabs',['Manually','After One Day','After One Week','After One Month'])+this.select('Tab layout','tabLayout',['Separate','Compact'])+this.check('Always show website titles in tabs','showTabTitles')+this.check('⌘-click opens a link in a new tab','commandClickTab')+this.check('When a new tab or window opens, make it active','activateNewTab'),
      AutoFill:()=>this.check('Using information from my contacts','fillContacts')+this.check('User names and passwords','fillPasswords')+this.check('Credit cards','fillCards')+this.check('Other forms','fillForms'),
      Search:()=>this.select('Search engine','searchEngine',['Google','Yahoo','Bing','DuckDuckGo','Ecosia'])+this.select('Private Browsing search engine','privateSearchEngine',['Default','Google','Yahoo','Bing','DuckDuckGo','Ecosia'])+this.check('Include search engine suggestions','searchSuggestions')+this.check('Include Safari Suggestions','safariSuggestions')+this.check('Enable Quick Website Search','quickSearch')+this.check('Preload Top Hit in the background','preloadTopHit')+this.check('Show Start Page','showStartPage'),
      Security:()=>this.check('Warn when visiting a fraudulent website','warnFraud')+this.check('Enable JavaScript','javascript'),
      Privacy:()=>this.check('Prevent cross-site tracking','preventTracking')+this.check('Hide IP address from trackers','hideIP')+`<div class="safari-pref-actions"><button class="btn" data-command="safari-website-data">Manage Website Data…</button></div>`,
      Websites:()=>`<div class="safari-website-prefs"><aside>Reader<br><br>Content Blockers<br><br>Auto-Play<br><br>Page Zoom<br><br>Camera<br><br>Microphone<br><br>Location<br><br>Downloads<br><br>Notifications<br><br>Pop-up Windows</aside><div><strong>Pop-up Windows</strong><p>No configured websites</p>${this.select('When visiting other websites','popupPolicy',['Block and Notify','Block','Allow'])}</div></div>`,
      Profiles:()=>`<div class="safari-pref-empty">${glyph('person')}<h2>Profiles</h2><p>No profiles</p></div>`,
      Extensions:()=>`<div class="safari-pref-empty">${glyph('puzzle')}<h2>No Extensions Installed</h2><button class="btn" data-command="open-app" data-arg="appstore">More Extensions…</button></div>`,
      Advanced:()=>this.check('Show full website address','showFullAddress')+this.check('Press Tab to highlight each item on a webpage','tabHighlight')+this.select('Use advanced tracking and fingerprinting protection','advancedTracking',['In Private Browsing','In All Browsing'])+this.check('Show features for web developers','developerFeatures')
    };},
    render(win){const pane=win.state.prefPane || 'General';return `<div class="safari-native-prefs"><nav role="tablist" aria-label="Safari settings">${this.sections.map(([name,icon])=>`<button role="tab" aria-selected="${pane===name}" data-command="safari-preference-pane" data-arg="${name}">${glyph(icon)}<span>${name}</span></button>`).join('')}</nav><section role="tabpanel" aria-label="${pane}" class="safari-pref-content">${this.panes()[pane]()}</section></div>`;},
    open(){
      const existing=Mac.wm.forApp('safari').find(w=>w.state.preferences);
      if(existing){if(existing.minimized)Mac.wm.unminimize(existing.id);Mac.wm.focus(existing.id);return existing;}
      return Mac.wm.create({...Mac.apps.safari,size:[720,550],min:[650,400]},{state:{preferences:true,prefPane:'General'}});
    }
  };
  Object.assign(Mac.DefaultState.browser,{opensWith:'A new window',newWindowsWith:'Start Page',newTabsWith:'Start Page',homepage:'https://www.apple.com',removeHistory:'After one year',downloadLocation:'Downloads',openSafeFiles:true,organizeTabs:'Never',openPagesTabs:'Automatically',closeTabs:'Manually',tabLayout:'Separate',showTabTitles:true,commandClickTab:true,activateNewTab:false,fillContacts:true,fillPasswords:true,fillCards:false,fillForms:true,javascript:true,hideIP:true,popupPolicy:'Block and Notify',showFullAddress:false,tabHighlight:false,advancedTracking:'In Private Browsing',developerFeatures:false});
  const safari=Mac.apps.safari,renderSafari=safari.render,titleSafari=safari.titleFor,mountSafari=safari.mount,toolbarSafari=safari.toolbar,menusSafari=safari.menus;
  safari.render=win=>{win.el?.classList.toggle('safari-preferences',Boolean(win.state.preferences));return win.state.preferences ? BP.render(win) : renderSafari(win);};
  safari.titleFor=win=>win.state.preferences ? win.state.prefPane || 'General' : titleSafari(win);
  safari.mount=win=>{if(!win.state.preferences)mountSafari(win);};
  safari.toolbar=win=>win.state.preferences ? '' : toolbarSafari(win);
  safari.menus=win=>win?.state.preferences ? {} : menusSafari(win);
  const runPreferences=Mac.run;
  Mac.run=async(command,arg,element)=>{
    if(command==='app-settings' && Mac.session.activeApp==='safari' || command==='browse' && arg==='settings')return BP.open();
    if(command==='safari-preference-pane'){const w=Mac.wm.windows.get(element?.closest('.window')?.dataset.win) || Mac.wm.active();if(w?.state.preferences && BP.sections.some(([name])=>name===arg)){w.state.prefPane=arg;Mac.wm.render(w);}return;}
    if(command==='safari-website-data'){Mac.Dialog.open({title:'Manage Website Data',wide:true,body:'<p>No website data</p>',buttons:[{label:'Done',primary:true}]});return;}
    return runPreferences(command,arg,element);
  };
  document.addEventListener('change',event=>{if(event.target.matches('[data-safari-preference]'))Mac.set('browser.'+event.target.dataset.safariPreference,event.target.value);});

}(window.Mac));
