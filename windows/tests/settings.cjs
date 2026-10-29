/* Settings module checks: every page renders, network dialogs drive the shared
   network model, and account validation holds. Run: node windows/tests/settings.cjs */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const storage = new Map();
const timers = [];
const stubEl = () => ({ classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } }, style: { setProperty() {} }, dataset: {}, addEventListener() {}, appendChild() {}, remove() {}, querySelector() { return null; }, querySelectorAll() { return []; } });
const document = {
  querySelector() { return null; }, querySelectorAll() { return []; }, getElementById() { return null; },
  createElement() { return { ...stubEl(), content: { firstElementChild: stubEl() } }; },
  addEventListener() {}, removeEventListener() {}, documentElement: stubEl(), body: stubEl(), activeElement: null,
};
const ctx = vm.createContext({
  console, document, structuredClone, Date, Math, JSON, URL, URLSearchParams, Blob, Promise, Intl,
  innerWidth: 1440, innerHeight: 900, location: { search: '', reload() {} }, navigator: {},
  setTimeout(fn) { timers.push(fn); return timers.length; }, clearTimeout() {}, setInterval() { return 0; }, clearInterval() {},
  requestAnimationFrame() {}, addEventListener() {}, matchMedia() { return { matches: false, addEventListener() {} }; },
  localStorage: { setItem(k, v) { storage.set(k, v); }, getItem(k) { return storage.get(k) ?? null; }, removeItem(k) { storage.delete(k); } },
  encodeURIComponent,
});
ctx.window = ctx;

const files = ['01-core.js', '02-icons.js', '03-state.js', '04-network.js', '05-ui.js', '06-wm.js', '07-wallpapers.js', '30-settings.js']
  .filter(f => fs.existsSync(path.join(root, 'scripts', f)));
for (const f of files) vm.runInContext(fs.readFileSync(path.join(root, 'scripts', f), 'utf8'), ctx, { filename: f });

const Win = ctx.Win;
Win.state = Win.clone(Win.DefaultState);
let captured = null;
Win.dialog = cfg => { captured = cfg; return Promise.resolve(null); };
const flush = () => { while (timers.length) timers.shift()(); };
const field = (name, value) => (typeof value === 'boolean' ? { name, type: 'checkbox', checked: value } : { name, type: 'text', value });
const box = obj => ({ querySelectorAll: () => Object.entries(obj).map(([k, v]) => field(k, v)), querySelector: () => null });
const primary = () => captured.buttons.find(b => b.primary);

let passed = 0;
const test = (name, fn) => { fn(); passed += 1; console.log(`PASS ${name}`); };

const REQUIRED = ['home', 'system', 'display', 'sound', 'notifications', 'focus', 'power', 'storage', 'multitasking', 'about', 'bluetooth', 'printers', 'mouse', 'touchpad',
  'network', 'wifi', 'wifi-manage', 'wifi-props', 'proxy', 'vpn', 'hotspot', 'airplane', 'advanced-network', 'personalization', 'background', 'colors', 'themes',
  'lock-screen', 'start', 'taskbar', 'apps', 'installed-apps', 'default-apps', 'startup', 'accounts', 'your-info', 'sign-in', 'other-users', 'time', 'date-time',
  'language', 'gaming', 'accessibility', 'privacy', 'security', 'update', 'update-history', 'update-advanced'];

test('the app registers and every documented page id exists', () => {
  assert.ok(Win.apps.get('settings'));
  const pages = Win.Settings.pages();
  for (const id of REQUIRED) assert.ok(pages.includes(id), `missing page ${id}`);
});

test('every page renders non-empty markup without stray undefined/NaN', () => {
  for (const id of Win.Settings.pages()) {
    const html = Win.Settings.render(id, id === 'wifi-props' ? { ssid: 'Sablewave Home' } : {});
    assert.equal(typeof html, 'string');
    assert.ok(html.length > 200, `${id} rendered too little`);
    const bad = html.match(/.{0,80}(\bundefined\b|\bNaN\b|\[object Object\]).{0,40}/);
    assert.ok(!bad, `${id} contains undefined/NaN: ${bad && bad[0]}`);
    assert.ok(!/simulat/i.test(html), `${id} mentions simulation`);
  }
});

test('pages also render in degraded states (offline, airplane, adapter off)', () => {
  Win.Network.setAirplane(true);
  for (const id of ['network', 'wifi', 'hotspot', 'airplane', 'advanced-network', 'home']) assert.ok(Win.Settings.render(id).length > 200);
  Win.Network.setAirplane(false);
  Win.Network.setAdapter(false);
  assert.ok(Win.Settings.render('wifi').includes('adapter is disabled'));
  Win.Network.setAdapter(true);
  assert.equal(Win.state.network.connected, 'Sablewave Home');
});

test('wifi properties show the same values ipconfig reads from Win.Network.config()', () => {
  const c = Win.Network.config();
  const html = Win.Settings.render('wifi-props', { ssid: 'Sablewave Home' });
  assert.ok(html.includes(c.ip));
  assert.ok(html.includes(Win.Network.mac()));
  assert.ok(html.includes(Win.Network.ADAPTER.description));
  assert.ok(html.includes(`${c.router} (Unencrypted)`));
});

test('manual DNS 203.0.113.53 via the Edit DNS dialog breaks name resolution; automatic restores it', () => {
  assert.equal(Win.Network.reason(), '');
  Win.Settings._.editDNS('Sablewave Home', null);
  assert.equal(captured.title, 'Edit DNS settings');
  assert.equal(primary().validate(box({ mode: 'manual', v4: true, dns1: '203.0.113.53', doh1: 'Off', dns2: '', v6: false })), '');
  assert.equal(Win.Network.reason(), 'no-dns');
  assert.deepEqual([...Win.Network.config().dns], ['203.0.113.53']);
  assert.ok(Win.Settings.render('wifi-props', { ssid: 'Sablewave Home' }).includes('203.0.113.53'));
  Win.Settings._.editDNS('Sablewave Home', null);
  assert.equal(primary().validate(box({ mode: 'auto' })), '');
  assert.equal(Win.Network.reason(), '');
});

test('DNS dialog rejects bad input without writing anything', () => {
  const before = JSON.stringify(Win.state.network.known);
  Win.Settings._.editDNS('Sablewave Home', null);
  assert.match(primary().validate(box({ mode: 'manual', v4: true, dns1: '999.1.1.1', doh1: 'Off' })), /valid/);
  assert.match(primary().validate(box({ mode: 'manual', v4: true, dns1: '203.0.113.53', doh1: 'On (automatic template)' })), /template/);
  assert.equal(JSON.stringify(Win.state.network.known), before);
});

test('manual IP: invalid mask is refused, wrong subnet means no gateway, DHCP restores', () => {
  Win.Settings._.editIP('Sablewave Home', null);
  assert.match(primary().validate(box({ mode: 'manual', v4: true, ip: '192.168.1.50', mask: '255.0.255.0', gateway: '192.168.1.1' })), /subnet mask/);
  assert.equal(primary().validate(box({ mode: 'manual', v4: true, ip: '192.168.5.50', mask: '255.255.255.0', gateway: '192.168.5.1', dns1: '', dns2: '' })), '');
  assert.equal(Win.Network.reason(), 'no-gateway');
  Win.Settings._.editIP('Sablewave Home', null);
  assert.equal(primary().validate(box({ mode: 'dhcp' })), '');
  assert.equal(Win.Network.reason(), '');
});

test('manual proxy routes web traffic through an unreachable proxy until removed', () => {
  assert.equal(Win.Settings._.applyProxyManual({ on: true, address: '10.0.0.5', port: '99999' }), 'Enter a valid port number between 1 and 65535.');
  assert.equal(Win.Settings._.applyProxyManual({ on: true, address: '10.0.0.5', port: '8080', bypass: '', local: true }), '');
  assert.equal(Win.Network.webReason(), 'proxy');
  assert.equal(Win.Settings._.applyProxyManual({ on: false, address: '', port: '' }), '');
  assert.equal(Win.Network.webReason(), '');
});

test('PIN change rejects a wrong current PIN and enforces length and match', () => {
  const pin = Win.state.account.pin;
  Win.Settings._.pinDialog(null);
  assert.equal(primary().validate(box({ cur: '0000', next: '5678', confirm: '5678', letters: false })), 'The PIN is incorrect. Try again.');
  assert.equal(Win.state.account.pin, pin);
  assert.match(primary().validate(box({ cur: pin, next: '12', confirm: '12', letters: false })), /at least 4/);
  assert.match(primary().validate(box({ cur: pin, next: '5678', confirm: '5679', letters: false })), /don't match/);
  assert.equal(primary().validate(box({ cur: pin, next: '5678', confirm: '5678', letters: false })), '');
  assert.equal(Win.state.account.pin, '5678');
});

test('Rename this PC validates names and shows the new one', () => {
  const R = Win.Settings._.renamePC;
  assert.match(R('MY PC'), /spaces/);
  assert.match(R('12345'), /only numbers/);
  assert.match(R('A-VERY-LONG-COMPUTER-NAME'), /15 characters/);
  assert.equal(R('ISAIAH-DESK'), '');
  assert.ok(Win.Settings.render('about').includes('ISAIAH-DESK'));
});

test('search finds pages and rows, including the DNS edit row on Wi-Fi properties', () => {
  const hits = Win.Settings.search('dns');
  assert.ok(hits.some(h => h.page === 'wifi-props'));
  assert.equal(Win.Settings.search('display')[0].page, 'display');
  assert.ok(Win.Settings.search('24-hour').some(h => h.page === 'date-time'));
  assert.ok(Win.Settings.search('rename').some(h => h.page === 'about' || h.page === 'home' || h.page === 'system'));
});

test('cleaning temporary files frees space on C: as reported by Win.FS.used', () => {
  const before = Win.FS.used('c');
  Win.Settings._.ACTIONS['clean-temp']();
  assert.ok(before - Win.FS.used('c') > 4e9);
  assert.equal(Win.state.settings.tempBytes, 0);
});

test('network reset keeps only the home profile and reconnects after the adapter cycles', () => {
  Win.Settings._.editDNS('Sablewave Home', null);
  primary().validate(box({ mode: 'manual', v4: true, dns1: '203.0.113.53', doh1: 'Off' }));
  Win.Settings._.doNetworkReset();
  assert.equal(Win.state.network.adapterEnabled.wifi, false);
  flush();
  assert.equal(Win.state.network.adapterEnabled.wifi, true);
  assert.deepEqual(Win.state.network.known.map(k => k.ssid), ['Sablewave Home']);
  assert.equal(Win.Network.reason(), '');
});

test('troubleshooter names the DNS fault', () => {
  Win.Settings._.editDNS('Sablewave Home', null);
  primary().validate(box({ mode: 'manual', v4: true, dns1: '203.0.113.53', doh1: 'Off' }));
  assert.match(Win.Settings._.diagnose({}, 'network').title, /DNS server/);
  Win.Settings._.editDNS('Sablewave Home', null);
  primary().validate(box({ mode: 'auto' }));
  assert.ok(Win.Settings._.diagnose({}, 'network').ok);
});

console.log(`${passed} settings checks passed`);
