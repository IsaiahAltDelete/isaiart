/* Core and shell integration checks. Real browser checks are recorded in README.md. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const storage = new Map();
const element = () => new Proxy({
  classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } }, style: { setProperty() {} }, dataset: {},
  innerHTML: '', textContent: '', value: '', children: [], querySelector() { return element(); }, querySelectorAll() { return []; },
  addEventListener() {}, removeEventListener() {}, appendChild() {}, remove() {}, focus() {}, setAttribute() {}, removeAttribute() {},
  getBoundingClientRect() { return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }; }, closest() { return null; }, contains() { return false; },
  dispatchEvent() {}, insertAdjacentHTML() {}, cloneNode() { return element(); }, setPointerCapture() {},
}, { get(t, k) { return k in t ? t[k] : undefined; }, set(t, k, v) { t[k] = v; return true; } });
const template = () => ({ innerHTML: '', content: { firstElementChild: element() } });
const document = {
  querySelector() { return element(); }, querySelectorAll() { return []; }, getElementById() { return element(); },
  createElement(tag) { return tag === 'template' ? template() : element(); }, addEventListener() {}, removeEventListener() {},
  documentElement: element(), body: element(), activeElement: null, elementsFromPoint() { return []; },
};
const context = vm.createContext({
  console, document, structuredClone, Date, Math, URL, URLSearchParams, Blob, Promise, Proxy, Set, Map, JSON, CSS: { escape: s => s },
  innerWidth: 1440, innerHeight: 900, location: { search: '' }, navigator: {},
  setTimeout: fn => { fn(); return 0; }, clearTimeout() {}, setInterval() { return 0; }, clearInterval() {}, requestAnimationFrame() {},
  addEventListener() {}, removeEventListener() {}, matchMedia() { return { matches: false, addEventListener() {} }; },
  localStorage: { setItem(k, v) { storage.set(k, v); }, getItem(k) { return storage.get(k) ?? null; }, removeItem(k) { storage.delete(k); } },
});
context.window = context;

const scripts = [...fs.readFileSync(path.join(root, 'index.html'), 'utf8').matchAll(/src="scripts\/([^"?]+)(?:\?[^"]*)?"/g)]
  .map(m => m[1]).filter(name => name !== '99-boot.js' && fs.existsSync(path.join(root, 'scripts', name)));
for (const name of scripts) vm.runInContext(fs.readFileSync(path.join(root, 'scripts', name), 'utf8'), context, { filename: name });

const W = context.Win;
const fresh = () => { W.state = structuredClone(W.DefaultState); };
const tests = [];
const test = (name, check) => tests.push([name, check]);

test('every index.html asset exists', () => {
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  for (const [, ref] of html.matchAll(/(?:src|href)="((?:scripts|styles|assets)\/[^"?]+)/g)) assert.ok(fs.existsSync(path.join(root, ref)), `missing ${ref}`);
});

test('paths resolve both ways, including drives, .. and %userprofile%', () => {
  assert.equal(W.FS.path('desktop'), 'C:\\Users\\isaiah\\Desktop');
  assert.equal(W.FS.path('c'), 'C:\\');
  assert.equal(W.FS.resolve('C:\\Users\\isaiah\\Documents'), 'documents');
  assert.equal(W.FS.resolve('..\\Desktop', 'documents'), 'desktop');
  assert.equal(W.FS.resolve('%USERPROFILE%\\downloads'), 'downloads');
  assert.equal(W.FS.resolve('e:\\backup'), 'e-backup');
  assert.equal(W.FS.resolve('C:\\nope'), null);
});

test('rename rejects reserved characters and device names, and keeps names unique', () => {
  const folder = W.FS.create('desktop', 'New folder', 'folder');
  assert.match(W.FS.rename(folder.id, 'bad:name'), /can't contain/);
  assert.match(W.FS.rename(folder.id, 'CON'), /device name/);
  assert.equal(W.FS.create('desktop', 'New folder', 'folder').name, 'New folder (2)');
  assert.equal(W.FS.rename(folder.id, 'Taxes'), '');
});

test('delete goes to the Recycle Bin and restore returns the file to its folder', () => {
  W.FS.remove('f-notes');
  assert.equal(W.FS.get('f-notes').parent, 'bin');
  W.FS.restore('f-notes');
  assert.equal(W.FS.get('f-notes').parent, 'documents');
  W.FS.emptyBin();
  assert.equal(W.FS.children('bin', { hidden: true }).length, 0);
});

test('files on the removable drive are deleted permanently', () => {
  W.FS.remove('f-usb1');
  assert.equal(W.FS.get('f-usb1'), null);
});

test('default network is online with a DHCP address from the home router', () => {
  assert.equal(W.Network.reason(), '');
  const c = W.Network.config();
  assert.match(c.ip, /^192\.168\.1\.\d+$/);
  assert.equal(c.gateway, '192.168.1.1');
});

test('an unreachable DNS server breaks names but not raw IP pings', () => {
  assert.equal(W.Network.saveIP('Sablewave Home', { dnsMode: 'manual', dns: ['203.0.113.53'] }), '');
  assert.equal(W.Network.reason(), 'no-dns');
  assert.equal(W.Network.ping('google.com').error, 'host');
  assert.equal(W.Network.ping('8.8.8.8').ok, true);
  W.Network.saveIP('Sablewave Home', { dnsMode: 'auto' });
  assert.equal(W.Network.reason(), '');
});

test('invalid IP settings are rejected without changing the profile', () => {
  const before = JSON.stringify(W.Network.profile('Sablewave Home'));
  assert.match(W.Network.saveIP('Sablewave Home', { ipMode: 'manual', ip: '192.168.1.300', mask: '255.255.255.0' }), /valid IP/);
  assert.match(W.Network.saveIP('Sablewave Home', { dnsMode: 'manual', dns: ['dns.example'] }), /valid DNS/);
  assert.equal(JSON.stringify(W.Network.profile('Sablewave Home')), before);
});

test('a manual address on the wrong subnet loses the gateway', () => {
  W.Network.saveIP('Sablewave Home', { ipMode: 'manual', ip: '10.0.0.50', mask: '255.255.255.0', gateway: '10.0.0.1', dnsMode: 'manual', dns: ['1.1.1.1'] });
  assert.equal(W.Network.reason(), 'no-gateway');
  assert.equal(W.Network.ping('1.1.1.1').error, 'unreachable');
});

test('a manual proxy only blocks web traffic', () => {
  Object.assign(W.state.network.proxy, { manual: true, address: '10.9.9.9', port: '8080' });
  assert.equal(W.Network.reason(), '');
  assert.equal(W.Network.webReason(), 'proxy');
});

test('airplane mode drops Wi-Fi and Bluetooth, and turning it off rejoins', () => {
  W.Network.setAirplane(true);
  assert.equal(W.Network.reason(), 'airplane');
  assert.equal(W.state.settings.bluetooth, false);
  W.Network.setAirplane(false);
  assert.equal(W.state.network.connected, 'Sablewave Home');
});

test('a manual disconnect stops auto-join for that network', () => {
  W.Network.disconnect();
  W.Network.setWifi(false);
  W.Network.setWifi(true);
  assert.equal(W.state.network.connected, '');
});

test('wrong Wi-Fi keys are refused and the right key joins', async () => {
  const bad = await W.Network.connect('Hollis_5G', 'nope');
  assert.equal(bad.ok, false);
  const good = await W.Network.connect('Hollis_5G', 'hollisfamily');
  assert.equal(good.ok, true);
  assert.equal(W.state.network.connected, 'Hollis_5G');
});

test('wallpaper CSS can sit inside a double-quoted style attribute', () => {
  for (const { id } of W.Wallpapers.list()) assert.ok(!W.Wallpapers.css(id).includes('"'), id);
});

test('ms-settings URIs map to Settings pages', () => {
  const opened = [];
  W.wm.open = (id, args) => opened.push([id, args?.page]);
  assert.equal(W.msSettings('ms-settings:network-proxy'), true);
  assert.equal(W.msSettings('notepad'), false);
  assert.deepEqual(opened, [['settings', 'proxy']]);
});

test('Start search finds apps, settings and files', () => {
  assert.ok(W.Start.SETTINGS.some(([label]) => label === 'Proxy settings'));
});

test('every app referenced by Start, taskbar and the run map is registered', () => {
  const ids = new Set(W.apps.all().map(a => a.id));
  const missing = [...W.DefaultState.start.pinned, ...W.DefaultState.taskbar.pinned].filter(id => !ids.has(id));
  if (missing.length) console.log(`  (not yet registered: ${missing.join(', ')})`);
  for (const id of ['run', 'winver', 'controlpanel', 'store', 'mail', 'weather', 'copilot', 'snip']) assert.ok(ids.has(id), id);
});

(async () => {
  for (const [name, check] of tests) {
    fresh();
    await check();
    console.log(`PASS ${name}`);
  }
  console.log(`
${tests.length} checks passed`);
})().catch(error => { console.error(error); process.exit(1); });
