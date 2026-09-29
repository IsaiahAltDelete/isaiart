// Browser checks for a built Sports Desk page.
// Usage (from repo root):  NODE_PATH=$(npm root -g) node sports/_desk/check.mjs [pagePath=sports/index.html] [expectedDate=YYYY-MM-DD] [shotDir]
// Serves the repo locally, blocks all external requests (forces the logo-fallback path),
// and exercises date, counts, filters, search, empty state, timezone switching and mobile layout.
import { createRequire } from 'module';
import http from 'http';
import fs from 'fs';
import path from 'path';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const root = process.cwd();
const pagePath = process.argv[2] || 'sports/index.html';
const expectedDate = process.argv[3] || new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
const shotDir = process.argv[4] || null;
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };

const server = http.createServer((req, res) => {
  const p = path.join(root, decodeURIComponent(req.url.split('?')[0]));
  fs.readFile(p, (e, buf) => { if (e) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' }); res.end(buf); });
});
await new Promise(r => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}/`;

const fails = [], info = {};
const fail = m => fails.push(m);
const ZONES = { ET: 'America/New_York', CT: 'America/Chicago', MT: 'America/Denver', PT: 'America/Los_Angeles' };
const dayKey = (d, tz) => new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(d);
const expectTime = (iso, zone, upcoming) => {
  const d = new Date(iso), tz = ZONES[zone];
  let t = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: true }).format(d) + ' ' + zone;
  if (upcoming) return new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', month: 'short', day: 'numeric' }).format(d) + ' • ' + t;
  const k = dayKey(d, tz);
  return t + (k > expectedDate ? ' (next day)' : k < expectedDate ? ' (previous day)' : '');
};

const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 1300 } });
  await ctx.route('**/*', r => r.request().url().startsWith(base) ? r.continue() : r.abort());
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  await page.goto(base + pagePath, { waitUntil: 'load' });
  await page.waitForTimeout(300);
  if (errors.length) fail('script errors: ' + errors.join(' | '));

  // Date + counts
  const meta = await page.evaluate(() => ({
    date: document.querySelector('meta[name=desk-date]')?.content,
    events: +document.querySelector('meta[name=desk-events]')?.content,
    header: document.querySelector('header')?.innerText || '',
    cards: document.querySelectorAll('.card[data-counted]').length,
    upcoming: document.querySelectorAll('.next48 .card').length,
    visible: +document.getElementById('visibleCount')?.textContent,
    total: +document.getElementById('totalCount')?.textContent,
    sectionSum: [...document.querySelectorAll('.league-section .section-title')].reduce((a, el) => a + (+(el.textContent.match(/(\d+) events?$/) || [0, 0])[1]), 0),
  }));
  Object.assign(info, meta); delete info.header;
  if (meta.date !== expectedDate) fail(`desk-date ${meta.date} != expected ${expectedDate}`);
  const longDate = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }).format(new Date(expectedDate + 'T12:00:00Z'));
  if (!meta.header.includes(longDate)) fail(`header does not show "${longDate}"`);
  if (!/Updated .+ ET/.test(meta.header)) fail('header missing "Updated … ET"');
  if (!(meta.cards === meta.events && meta.events === meta.visible && meta.visible === meta.total && meta.total === meta.sectionSum))
    fail(`count mismatch: cards=${meta.cards} meta=${meta.events} visible=${meta.visible} total=${meta.total} sections=${meta.sectionSum}`);

  // Logo fallback (all external blocked, so every logo must fall back to a visible bordered abbreviation)
  const logo = await page.evaluate(() => [...document.querySelectorAll('.team')].map(t => {
    const img = t.querySelector('img'), fb = t.querySelector('.fallback');
    return { name: t.innerText.trim(), img: !!img, imgShown: img ? getComputedStyle(img).display !== 'none' : false, fb: fb ? getComputedStyle(fb).display !== 'none' && fb.textContent.trim() !== '' : false };
  }));
  info.teams = logo.length; info.logoImgs = logo.filter(l => l.img).length;
  logo.filter(l => !l.fb || l.imgShown).forEach(l => fail(`logo fallback not showing for "${l.name}"`));

  // Duplicate cards (same competitors + time)
  const dupes = await page.evaluate(() => { const seen = {}, d = []; document.querySelectorAll('.card[data-counted]').forEach(c => { const k = [...c.querySelectorAll('.team')].map(t => t.innerText.split('\n')[0]).sort().join('|') + '@' + (c.querySelector('.time')?.dataset.base || ''); if (seen[k]) d.push(k); seen[k] = 1; }); return d; });
  dupes.forEach(d => fail('duplicate card: ' + d));

  // Filters
  const leagues = await page.$$eval('.filter', bs => bs.map(b => b.dataset.league));
  if (leagues[0] !== 'all') fail('first filter is not All');
  for (const lg of leagues.slice(1)) {
    await page.click(`.filter[data-league="${lg}"]`);
    const detail = await page.evaluate(lg => { const s = [...document.querySelectorAll('.card[data-counted]')].filter(c => !c.hidden); return { n: s.length, wrong: s.filter(c => c.dataset.league !== lg).length, expect: document.querySelectorAll(`.card[data-counted][data-league="${lg}"]`).length, count: +document.getElementById('visibleCount').textContent, visibleSections: [...document.querySelectorAll('.league-section')].filter(x => !x.hidden).map(x => x.dataset.section) }; }, lg);
    if (detail.n !== detail.expect || detail.wrong || detail.count !== detail.n) fail(`filter ${lg}: shown=${detail.n} expected=${detail.expect} wrong=${detail.wrong} count=${detail.count}`);
    if (detail.visibleSections.length !== 1 || detail.visibleSections[0] !== lg) fail(`filter ${lg}: visible sections ${detail.visibleSections}`);
  }
  await page.click('.filter[data-league="all"]');
  if (+(await page.textContent('#visibleCount')) !== meta.events) fail('All filter did not restore full count');

  // Search
  if (meta.cards) {
    const term = (await page.$eval('.card[data-counted] .team span:not(.fallback)', el => el.childNodes[0].textContent.trim())).toLowerCase();
    await page.fill('#search', term);
    const s = await page.evaluate(t => { const v = [...document.querySelectorAll('.card[data-counted]')].filter(c => !c.hidden); return { n: v.length, bad: v.filter(c => !c.textContent.toLowerCase().includes(t) && !c.dataset.search.includes(t)).length, count: +document.getElementById('visibleCount').textContent }; }, term);
    if (s.n < 1 || s.bad || s.count !== s.n) fail(`search "${term}": shown=${s.n} bad=${s.bad} count=${s.count}`);
    await page.fill('#search', 'zzqqxxnomatch');
    const e = await page.evaluate(() => ({ n: +document.getElementById('visibleCount').textContent, empty: getComputedStyle(document.getElementById('empty')).display }));
    if (e.n !== 0 || e.empty === 'none') fail('empty state did not show for a no-match search');
    await page.fill('#search', '');
    if (+(await page.textContent('#visibleCount')) !== meta.events) fail('clearing search did not restore count');
  }

  // Timezones
  for (const z of ['CT', 'MT', 'PT', 'ET']) {
    const t0 = Date.now();
    await page.click(`.zone[data-zone="${z}"]`);
    const r = await page.evaluate(() => ({ zone: document.getElementById('zoneName').textContent, times: [...document.querySelectorAll('.time[data-base]')].map(el => ({ iso: el.dataset.base, up: !!el.dataset.upcoming, text: el.textContent })) }));
    if (r.zone !== z) fail(`active zone label shows ${r.zone} after clicking ${z}`);
    for (const t of r.times) { const exp = expectTime(t.iso, z, t.up); if (t.text !== exp) fail(`${z}: time "${t.text}" expected "${exp}"`); }
    info['tz_' + z + '_ms'] = Date.now() - t0;
  }
  const defaultActive = await page.$eval('.zone.active', b => b.dataset.zone);
  if (defaultActive !== 'ET') fail('ET is not active after returning to ET');
  if (shotDir) await page.screenshot({ path: path.join(shotDir, 'desk-desktop.png'), fullPage: true });

  // Mobile
  const m = await ctx.newPage();
  await m.setViewportSize({ width: 390, height: 844 });
  await m.goto(base + pagePath, { waitUntil: 'load' });
  const ov = await m.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth, cols: getComputedStyle(document.querySelector('.grid') || document.body).gridTemplateColumns }));
  if (ov.sw > ov.iw + 1) fail(`mobile horizontal overflow: scrollWidth ${ov.sw} > ${ov.iw}`);
  if (ov.cols && ov.cols.trim().split(/\s+/).length > 1) fail('mobile grid is not single-column');
  if (shotDir) await m.screenshot({ path: path.join(shotDir, 'desk-mobile.png'), fullPage: true });
} catch (e) {
  fail('check crashed: ' + e.message);
} finally {
  await browser.close(); server.close();
}
console.log(JSON.stringify({ ok: !fails.length, expectedDate, ...info, fails }, null, 1));
process.exit(fails.length ? 1 : 0);
