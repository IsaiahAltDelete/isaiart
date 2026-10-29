/* State-level checks for File Explorer, Notepad, Photos and Paint.
   Run: node windows/tests/files.cjs */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const storage = new Map();
const element = () => ({
  classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } }, style: { setProperty() {} }, dataset: {},
  innerHTML: '', textContent: '', querySelector() { return element(); }, querySelectorAll() { return []; }, focus() {},
  setAttribute() {}, removeAttribute() {}, remove() {}, appendChild() {}, addEventListener() {}, getContext() { return null; },
});
const document = {
  querySelector() { return element(); }, querySelectorAll() { return []; }, getElementById() { return element(); },
  createElement() { return element(); }, addEventListener() {}, removeEventListener() {}, documentElement: element(), body: element(),
};
const context = vm.createContext({
  console, document, structuredClone, Date, Math, URL, Blob, Intl, encodeURIComponent, decodeURIComponent, Promise,
  innerWidth: 1440, innerHeight: 900, navigator: {}, location: { search: '' },
  setTimeout() { return 0; }, clearTimeout() {}, setInterval() { return 0; }, clearInterval() {},
  requestAnimationFrame() { return 0; }, cancelAnimationFrame() {}, addEventListener() {}, matchMedia() { return { matches: false, addEventListener() {} }; },
  localStorage: { setItem(k, v) { storage.set(k, v); }, getItem(k) { return storage.get(k) || null; }, removeItem(k) { storage.delete(k); } },
});
context.window = context;

const scripts = ['01-core.js', '02-icons.js', '03-state.js', '04-network.js', '05-ui.js', '06-wm.js', '20-explorer.js', '21-notepad.js', '22-photos.js', '23-paint.js'];
for (const name of scripts) vm.runInContext(fs.readFileSync(path.join(root, 'scripts', name), 'utf8'), context, { filename: name });

const W = context.Win;
W.state = W.clone(W.DefaultState);
const opened = [];
W.wm.open = (app, args = {}) => { opened.push({ app, args }); return null; };
W.dialog = () => Promise.resolve(null);
W.toast = () => {};

let passed = 0;
const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test('openFile routes text to Notepad, pictures to Photos, folders to Explorer', () => {
  opened.length = 0;
  W.openFile('f-todo');
  W.openFile('f-pic1');
  W.openFile('documents');
  W.openFile('f-receipt1');
  W.openFile('f-zip');
  W.openFile('f-hosts');
  assert.deepEqual(opened.map(o => o.app), ['notepad', 'photos', 'explorer', 'edge', 'explorer', 'notepad']);
  assert.equal(opened[0].args.fileId, 'f-todo');
  assert.equal(opened[1].args.fileId, 'f-pic1');
  assert.equal(opened[2].args.path, 'documents');
  assert.equal(opened[3].args.fileId, 'f-receipt1');
  assert.equal(opened[4].args.path, 'zip:f-zip');
  assert.equal(W.state.recent[0], 'f-hosts');
});

test('shortcut nodes launch their app', () => {
  opened.length = 0;
  const sc = W.FS.create('desktop', 'Calculator', 'shortcut', { app: 'calculator' });
  W.openFile(sc.id);
  assert.equal(opened[0].app, 'calculator');
});

test('new folder on the Desktop refuses invalid names and keeps valid ones', () => {
  const folder = W.Explorer.newFolder('desktop');
  assert.equal(folder.parent, 'desktop');
  assert.equal(folder.name, 'New folder');
  assert.ok(W.Explorer.rename(folder.id, 'Bad:name').length > 0);
  assert.ok(W.Explorer.rename(folder.id, 'CON').length > 0);
  assert.ok(W.Explorer.rename(folder.id, '   ').length > 0);
  assert.equal(W.FS.get(folder.id).name, 'New folder');
  assert.equal(W.Explorer.rename(folder.id, 'Taxes'), '');
  assert.equal(W.FS.get(folder.id).name, 'Taxes');
  const second = W.Explorer.newFolder('desktop');
  assert.ok(W.Explorer.rename(second.id, 'taxes').length > 0, 'duplicate name is refused');
});

test('delete moves to the Recycle Bin and restore returns it to its folder', async () => {
  const file = W.Explorer.newTextDocument('documents');
  const count = await W.Explorer.remove([file.id]);
  assert.equal(count, 1);
  assert.equal(W.FS.get(file.id).parent, 'bin');
  assert.equal(W.FS.get(file.id).trashedFrom, 'documents');
  W.Explorer.restore([file.id]);
  assert.equal(W.FS.get(file.id).parent, 'documents');
  assert.equal(W.FS.get(file.id).trashedFrom, undefined);
});

test('system files cannot be deleted', async () => {
  const count = await W.Explorer.remove(['f-hosts']);
  assert.equal(count, 0);
  assert.equal(W.FS.get('f-hosts').parent, 'c-etc');
});

test('copy and cut through the shared clipboard', () => {
  W.Explorer.setClipboard('copy', ['f-notes']);
  const [copy] = W.Explorer.paste('documents');
  assert.equal(W.FS.get(copy).name, 'Meeting notes - Copy.txt');
  W.Explorer.setClipboard('cut', [copy]);
  const moved = W.Explorer.paste('desktop');
  assert.deepEqual([...moved], [copy]);
  assert.equal(W.FS.get(copy).parent, 'desktop');
  assert.equal(W.state.clipboard, null);
  const text = W.Explorer.copyAsPath(['f-notes']);
  assert.equal(text, '"C:\\Users\\isaiah\\Documents\\Meeting notes.txt"');
  assert.equal(W.state.clipboard.text, text);
});

test('ZIP archives compress, browse and extract', async () => {
  const zip = W.Explorer.compress(['doc-projects']);
  assert.equal(zip.name, 'Projects.zip');
  const items = W.Explorer.zipItems(`zip:${zip.id}`);
  assert.equal(items.length, 1);
  assert.equal(items[0].kind, 'folder');
  assert.equal(W.Explorer.zipItems(items[0].zipLoc).length, 2);
  const seeded = W.Explorer.zipItems('zip:f-zip');
  assert.ok(seeded.some(n => n.art === 'beach'));
  const folder = await W.Explorer.extractAll('f-zip', { silent: true });
  const out = W.FS.children(folder).map(n => n.name).sort();
  assert.ok(out.includes('IMG_2041.jpg') && out.includes('Captions.txt'));
  assert.equal(W.FS.get(folder).name, 'Photos from Sam');
});

test('address bar input resolves paths and virtual locations', () => {
  assert.deepEqual({ ...W.Explorer.resolveInput('C:\\Users\\isaiah\\Documents', 'home') }, { loc: 'documents' });
  assert.deepEqual({ ...W.Explorer.resolveInput('this pc', 'home') }, { loc: 'pc' });
  assert.deepEqual({ ...W.Explorer.resolveInput('C:\\Users\\isaiah', 'home') }, { loc: 'profile' });
  assert.deepEqual({ ...W.Explorer.resolveInput('%userprofile%\\Desktop\\To-do.txt', 'home') }, { file: 'f-todo' });
  assert.equal(W.Explorer.resolveInput('C:\\Nope', 'home'), null);
  assert.ok(W.Explorer.locExists('zip:f-zip'));
});

test('Win.Art returns an SVG data URL for every seeded art name', () => {
  for (const name of ['sunset', 'mountain', 'city', 'beach', 'screenshot']) {
    const url = W.Art.url(name);
    assert.ok(url.startsWith('data:image/svg+xml'), name);
    assert.ok(decodeURIComponent(url).includes('<svg'), name);
  }
  assert.ok(W.Art.url('sunset', 320, 200).includes('width%3D%22320%22'));
  assert.equal(W.imageURL(W.FS.get('f-pic1')), W.Art.url('sunset'));
  assert.equal(W.imageURL({ data: 'data:image/png;base64,AAAA' }), 'data:image/png;base64,AAAA');
  assert.equal(W.imageURL(W.FS.get('f-todo')), '');
});

test('Win.pickFile exists and resolves null when cancelled', async () => {
  assert.equal(typeof W.pickFile, 'function');
  assert.equal(await W.pickFile({ mode: 'save', exts: ['txt'], defaultName: 'a.txt' }), null);
  const types = W.Explorer.fileTypes(['png', 'jpg']);
  assert.equal(types[0].label.startsWith('All Picture Files'), true);
  assert.equal(types[types.length - 1].exts, null);
});

test('apps are registered with the contracted ids', () => {
  for (const id of ['explorer', 'notepad', 'photos', 'paint']) assert.ok(W.apps.get(id), id);
  assert.equal(W.apps.get('explorer').customTitle, true);
  assert.equal(W.apps.get('notepad').customTitle, true);
  assert.ok(W.DefaultState.explorer && W.DefaultState.notepad && W.DefaultState.paint);
});

test('Notepad shows readable noise for binary documents', () => {
  const text = W.Notepad.binaryText(W.FS.get('f-resume'));
  assert.ok(text.startsWith('PK'));
  assert.equal(text, W.Notepad.binaryText(W.FS.get('f-resume')));
});

test('Paint flood fill stops at boundaries', () => {
  const Wd = 6;
  const H = 4;
  const data = new Uint8ClampedArray(Wd * H * 4).fill(255);
  for (let y = 0; y < H; y += 1) { const i = (y * Wd + 3) * 4; data[i] = 0; data[i + 1] = 0; data[i + 2] = 0; }
  const ctx = { canvas: { width: Wd, height: H }, getImageData: () => ({ data }), putImageData() {} };
  assert.equal(W.Paint.floodFill(ctx, 0, 0, [255, 0, 0, 255], 0), true);
  assert.deepEqual([...data.slice(0, 4)], [255, 0, 0, 255]);
  assert.deepEqual([...data.slice((2 * Wd + 2) * 4, (2 * Wd + 2) * 4 + 4)], [255, 0, 0, 255]);
  assert.deepEqual([...data.slice((2 * Wd + 4) * 4, (2 * Wd + 4) * 4 + 4)], [255, 255, 255, 255]);
});

test('visible UI copy avoids training language', () => {
  for (const name of ['20-explorer.js', '21-notepad.js', '22-photos.js', '23-paint.js']) {
    const src = fs.readFileSync(path.join(root, 'scripts', name), 'utf8');
    assert.ok(!/simulat/i.test(src), name);
  }
});

(async () => {
  for (const [name, fn] of tests) {
    try { await fn(); passed += 1; console.log(`PASS ${name}`); } catch (error) { console.log(`FAIL ${name}`); console.error(error); process.exitCode = 1; }
  }
  console.log(`${passed}/${tests.length} passed`);
})();
