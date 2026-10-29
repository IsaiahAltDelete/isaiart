/* Smoke tests for Edge, Terminal, Task Manager, Calculator and Clock.
   Loads the shared core (01-06) and the app modules into a node vm with a
   stubbed DOM and checks the pure parts: the command runner, the calculator
   engine and Edge's error classification. Run: node windows/tests/tools.cjs */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const storage = new Map();
const element = () => ({
  classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } }, style: { setProperty() {} }, dataset: {},
  innerHTML: '', textContent: '', querySelector() { return element(); }, querySelectorAll() { return []; }, appendChild() {},
  addEventListener() {}, removeEventListener() {}, setAttribute() {}, remove() {}, focus() {}, contains() { return false; },
});
const document = {
  querySelector() { return element(); }, querySelectorAll() { return []; }, getElementById() { return element(); },
  createElement() { return element(); }, addEventListener() {}, removeEventListener() {}, body: element(), documentElement: element(), hidden: false,
};
const ctx = vm.createContext({
  console, document, structuredClone, Date, Math, Intl, URL, URLSearchParams, Blob, AbortController,
  innerWidth: 1440, innerHeight: 900, location: { search: '' }, navigator: {}, performance: { now: () => Date.now() },
  setTimeout() {}, clearTimeout() {}, setInterval() {}, clearInterval() {}, requestAnimationFrame() {}, cancelAnimationFrame() {},
  addEventListener() {}, matchMedia() { return { matches: false, addEventListener() {} }; },
  localStorage: { setItem(k, v) { storage.set(k, v); }, getItem(k) { return storage.get(k) || null; }, removeItem(k) { storage.delete(k); } },
});
ctx.window = ctx;

const files = ['01-core.js', '02-icons.js', '03-state.js', '04-network.js', '05-ui.js', '06-wm.js',
  '40-edge.js', '41-terminal.js', '42-taskmgr.js', '43-calculator.js', '44-clock.js'];
for (const name of files) vm.runInContext(fs.readFileSync(path.join(root, 'scripts', name), 'utf8'), ctx, { filename: name });

const W = ctx.Win;
W.state = W.clone(W.DefaultState);

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`PASS ${name}`);
}

test('modules register their apps and default state', () => {
  for (const id of ['edge', 'terminal', 'cmd', 'powershell', 'taskmgr', 'calculator', 'clock']) assert.ok(W.apps.get(id), id);
  assert.equal(W.apps.get('edge').customTitle, true);
  assert.equal(W.apps.get('terminal').customTitle, true);
  assert.equal(typeof W.apps.get('cmd').launch, 'function');
  assert.equal(typeof W.apps.get('powershell').launch, 'function');
  assert.equal(W.apps.get('taskmgr').single, true);
  assert.equal(W.apps.get('clock').single, true);
  for (const key of ['edge', 'terminal', 'taskmgr', 'calculator', 'clock']) assert.ok(W.DefaultState[key], key);
  assert.equal(W.DefaultState.edge.homepage, 'edge://newtab');
});

test('ipconfig reports the configured IPv4 address and gateway', () => {
  const s = W.Terminal.session('powershell');
  const out = W.Terminal.run('ipconfig', s);
  const c = W.Network.config();
  assert.match(out, /Windows IP Configuration/);
  assert.match(out, /Wireless LAN adapter Wi-Fi:/);
  assert.ok(out.includes(`   IPv4 Address. . . . . . . . . . . : ${c.ip}`), out);
  assert.ok(out.includes(`   Default Gateway . . . . . . . . . : ${c.gateway}`));
  const all = W.Terminal.run('ipconfig /all', s);
  assert.ok(all.includes(`Physical Address. . . . . . . . . : ${W.Network.ADAPTER.mac}`));
  assert.ok(all.includes('Host Name . . . . . . . . . . . . : ISAIAH-LAPTOP'));
});

test('ping google.com succeeds online with Windows formatting', () => {
  const out = W.Terminal.run('ping google.com', W.Terminal.session('cmd'));
  assert.match(out, /Pinging google\.com \[142\.250\.72\.14\] with 32 bytes of data:/);
  assert.equal((out.match(/Reply from 142\.250\.72\.14: bytes=32 time=\d+ms TTL=117/g) || []).length, 4);
  assert.match(out, /Packets: Sent = 4, Received = 4, Lost = 0 \(0% loss\),/);
  assert.match(out, /Minimum = \d+ms, Maximum = \d+ms, Average = \d+ms/);
});

test('broken manual DNS breaks name lookups but not ping by address', () => {
  const err = W.Network.saveIP('Sablewave Home', { dnsMode: 'manual', dns: ['203.0.113.53'] });
  assert.equal(err, '');
  assert.equal(W.Network.reason(), 'no-dns');
  const s = W.Terminal.session('powershell');
  assert.equal(W.Terminal.run('ping google.com', s).trim(), 'Ping request could not find host google.com. Please check the name and try again.');
  const byIp = W.Terminal.run('ping 8.8.8.8', s);
  assert.match(byIp, /Reply from 8\.8\.8\.8: bytes=32/);
  assert.match(W.Terminal.run('nslookup google.com', s), /DNS request timed out/);
  assert.equal(W.Edge.classify(W.Network.webReason(), 'example.com').code, 'DNS_PROBE_FINISHED_NO_INTERNET');
  W.Network.saveIP('Sablewave Home', { dnsMode: 'auto', dns: [] });
  assert.equal(W.Network.reason(), '');
});

test('cd Documents then dir lists Meeting notes.txt in both shells', () => {
  for (const profile of ['powershell', 'cmd']) {
    const s = W.Terminal.session(profile);
    assert.equal(W.Terminal.run('cd Documents', s), '');
    assert.equal(W.FS.path(s.cwd), 'C:\\Users\\isaiah\\Documents');
    const out = W.Terminal.run('dir', s);
    assert.ok(out.includes('Meeting notes.txt'), out);
    if (profile === 'cmd') {
      assert.match(out, / Directory of C:\\Users\\isaiah\\Documents/);
      assert.match(out, /\d+ File\(s\)\s+[\d,]+ bytes/);
    } else {
      assert.match(out, /Directory: C:\\Users\\isaiah\\Documents/);
      assert.match(out, /Mode {17}LastWriteTime {9}Length Name/);
    }
    assert.equal(W.Terminal.prompt(s), profile === 'cmd' ? 'C:\\Users\\isaiah\\Documents>' : 'PS C:\\Users\\isaiah\\Documents> ');
  }
});

test('unknown commands use the exact Windows error wording', () => {
  const ps = W.Terminal.run('frobnicate', W.Terminal.session('powershell'));
  assert.ok(ps.startsWith("frobnicate : The term 'frobnicate' is not recognized as the name of a cmdlet, function, script file, or operable program. Check the spelling of the name, or if a path was included, verify that the path is correct and try again."));
  assert.match(ps, /CommandNotFoundException/);
  const cmd = W.Terminal.run('frobnicate', W.Terminal.session('cmd'));
  assert.equal(cmd, "'frobnicate' is not recognized as an internal or external command,\noperable program or batch file.\n");
  assert.match(W.Terminal.run('ls', W.Terminal.session('cmd')), /'ls' is not recognized/);
});

test('file commands work against the virtual file system', () => {
  const s = W.Terminal.session('cmd');
  W.Terminal.run('mkdir Scratch', s);
  W.Terminal.run('cd Scratch', s);
  W.Terminal.run('echo hello world> note.txt', s);
  assert.equal(W.Terminal.run('type note.txt', s), 'hello world\n');
  W.Terminal.run('ren note.txt renamed.txt', s);
  assert.match(W.Terminal.run('dir /b', s), /renamed\.txt/);
  W.Terminal.run('del renamed.txt', s);
  assert.match(W.Terminal.run('dir', s), /File Not Found|0 File\(s\)/);
  assert.equal(W.Terminal.run('E:', s), '');
  assert.equal(W.FS.path(s.cwd), 'E:\\');
});

test('disconnected Wi-Fi shows media disconnected and general failure', () => {
  W.Network.disconnect();
  const s = W.Terminal.session('cmd');
  assert.match(W.Terminal.run('ipconfig', s), /Wireless LAN adapter Wi-Fi:\n\n {3}Media State \. \. \. \. \. \. \. \. \. \. \. : Media disconnected/);
  assert.match(W.Terminal.run('ping 8.8.8.8', s), /PING: transmit failed\. General failure\./);
  assert.equal(W.Edge.classify(W.Network.webReason()).code, 'ERR_INTERNET_DISCONNECTED');
  W.state.network.connected = 'Sablewave Home';
});

test('edge error classification for DNS and proxy problems', () => {
  const dns = W.Edge.classify('no-dns', 'example.com');
  assert.equal(dns.code, 'DNS_PROBE_FINISHED_NO_INTERNET');
  assert.match(dns.title, /can.t reach this page/);
  assert.ok(dns.tips.some(t => /typo/.test(t)));
  const proxy = W.Edge.classify('proxy', 'example.com');
  assert.equal(proxy.code, 'ERR_PROXY_CONNECTION_FAILED');
  assert.ok(proxy.actions.some(a => a.act === 'proxy' && /proxy settings/i.test(a.label)));
  assert.equal(W.Edge.classify('nxdomain', 'nope.example').code, 'DNS_PROBE_FINISHED_NXDOMAIN');
  assert.equal(W.Edge.classify('no-internet').code, 'ERR_NAME_NOT_RESOLVED');
  W.state.network.proxy.manual = true;
  W.state.network.proxy.address = '10.0.0.99';
  assert.equal(W.Edge.classify(W.Network.webReason()).code, 'ERR_PROXY_CONNECTION_FAILED');
  W.state.network.proxy.manual = false;
  assert.equal(W.Edge.normalize('support.example'), 'https://support.example/');
  assert.equal(W.Edge.normalize('how to reset dns'), 'https://search.example/search?q=how%20to%20reset%20dns');
  assert.equal(W.Edge.normalize('edge://Settings'), 'edge://settings');
});

test('calculator follows Windows semantics', () => {
  const calc = keys => W.Calculator.engine().pressAll(keys);
  assert.equal(calc(['1', '2', '+', '7', '=']).display(), '19');
  assert.equal(calc(['1', '/', '0', '=']).display(), 'Cannot divide by zero');
  assert.equal(calc(['0', 'inv']).display(), 'Cannot divide by zero');
  assert.equal(calc(['0', '/', '0', '=']).display(), 'Result is undefined');
  assert.equal(calc(['2', '+', '3', '=', '=']).display(), '8');
  assert.equal(calc(['2', '+', '3', '*', '4', '=']).display(), '20');
  assert.equal(W.Calculator.engine('scientific').pressAll(['2', '+', '3', '*', '4', '=']).display(), '14');
  assert.equal(calc(['2', '0', '0', '+', '1', '0', '%']).display(), '20');
  assert.equal(calc(['9', 'sqrt']).display(), '3');
  assert.equal(calc(['9', 'sqrt']).expression(), '\u221a(9)');
  assert.equal(calc(['1', '2', '3', '4', '5', '6', '7']).display(), '1,234,567');
  assert.equal(calc(['5', '+', '=']).display(), '10');
  const ce = calc(['5', '+', '3', 'CE', '2', '=']);
  assert.equal(ce.display(), '7');
  assert.equal(calc(['0', '.', '1', '+', '0', '.', '2', '=']).display(), '0.3');
  assert.equal(calc(['1', '2', 'Backspace']).display(), '1');
});

test('task manager process list includes open apps and system processes', () => {
  const list = W.Processes.list();
  assert.ok(list.some(p => p.image === 'System' && p.pid === 4));
  assert.ok(list.some(p => p.image === 'explorer.exe'));
  const tasklist = W.Terminal.run('tasklist', W.Terminal.session('cmd'));
  assert.match(tasklist, /Image Name {21}PID Session Name {8}Session# {4}Mem Usage/);
  assert.match(W.Terminal.run('taskkill /im nothere.exe /f', W.Terminal.session('cmd')), /ERROR: The process "nothere.exe" not found\./);
  assert.match(W.Terminal.run('taskkill /pid 4 /f', W.Terminal.session('cmd')), /Access is denied/);
});

test('clock helpers compute world time offsets', () => {
  const z = W.Clock.zoneInfo('UTC', new Date());
  assert.ok(['Today', 'Tomorrow', 'Yesterday'].includes(z.day));
  assert.equal(W.Clock.hms(3723000), '01:02:03');
  assert.equal(W.Clock.hms(1234, { cs: true }), '00:00:01.23');
});

console.log(`\n${passed} tests passed`);
