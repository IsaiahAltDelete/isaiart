// Expeditions on the World map: a trail from the Guild Hall to a place beyond the edge of the map,
// with the party's marker walking out, waiting at the site while the adventure plays out, and coming home.
import { iconImage } from './icons.js';
import { EXPEDITIONS } from './rpg.js';
import { N, CENTERS, idx, T_WATER } from './world.js';

// where each adventure lies, as a fraction of the map (on its rim: they're out in the wider world)
export const EXP_SITES = {
  mill: [0.05, 0.4],      // downriver
  warren: [0.05, 0.62],   // Fernhill
  barrow: [0.47, 0.05],
  bridge: [0.95, 0.5],    // the east road
  mine: [0.95, 0.07],     // the hills
  marsh: [0.06, 0.93],
  owlbear: [0.6, 0.95],
  dragon: [0.95, 0.94],   // the far hills
};

const esc = t => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const ease = k => k * k * (3 - 2 * k);
// which leg of the trip the party is on, from the share of the expedition's time that has passed
export function expLeg(p, back = false) {
  if (back) return { leg: 'back', k: 0 };
  if (p < 0.3) return { leg: 'out', k: ease(p / 0.3) };
  if (p < 0.7) return { leg: 'site', k: 1 };
  return { leg: 'home', k: 1 - ease(Math.min(1, (p - 0.7) / 0.3)) };
}

// every party out right now, with where it's headed and how far along it is
export function activeExpeditions(sim) {
  const out = [];
  for (const b of sim.s.buildings) {
    const e = b.type === 'guild' && b.data?.exp; if (!e) continue;
    const q = EXPEDITIONS.find(o => o.id === e.q); if (!q) continue;
    const p = Math.min(1, Math.max(0, (sim.s.time - e.t0) / e.dur));
    const line = storyBeat((e.log || []).filter(l => l.f > 0 && l.f <= p && l.f < 1).pop()?.msg || '');
    const left = Math.max(0, e.t0 + e.dur - sim.s.time);
    out.push({ b, e, q, p, line, hours: Math.max(1, Math.round(left / 10)), ...expLeg(p, e.back) });
  }
  return out;
}

const LEG_TEXT = { out: 'on the road to', site: 'camped at', home: 'on the way home from', back: 'walking back into town from' };
// the expedition log, as the storyteller would tell it: no dice rolls or damage numbers
export const storyBeat = t => t.replace(/\s*\([A-Z]{3} (?:check|save)[^)]*\)/g, '').replace(/\s*\(\d+ damage\)/g, '').replace(/\s+([.,!])/g, '$1').trim();

// the overlay canvas sits on top of the map; redrawn a few times a second while the World page is open
export function expMapHtml() {
  return `<canvas id="mapfx" width="384" height="384" aria-hidden="true"></canvas>`;
}
export const EXPMAP_CSS = `.mapstack{position:relative}.mapstack #mapfx{position:absolute;left:3px;top:3px;width:calc(100% - 6px);height:calc(100% - 6px);border-radius:9px;pointer-events:none}
#expnote{margin-top:8px;display:flex;flex-direction:column;gap:6px}#expnote:empty{display:none}
#expnote .xn{display:flex;gap:8px;align-items:flex-start;padding:7px 10px;border-radius:10px;background:var(--panel2,#fff6e4);border:2px solid var(--edge,#e2c89a);font-size:13px;line-height:1.35}
#expnote .xn b{font-weight:600}#expnote .xn i{display:block;color:var(--ink2,#7a5a30);font-size:12px;margin-top:2px}#expnote .xn svg{flex:none;margin-top:1px}`;

export function drawExpMap(ui, svg) {
  const cv = document.getElementById('mapfx'); if (!cv) return false;
  const g = cv.getContext('2d'), W = cv.width, H = cv.height, S = W / N, sim = ui.sim, now = performance.now() / 1000;
  g.clearRect(0, 0, W, H);
  const list = activeExpeditions(sim);
  for (const x of list) {
    const c = sim.bCenter(x.b), a = [(c.x + N / 2) * S, (c.z + N / 2) * S];
    const at = EXP_SITES[x.q.id] || [0.95, 0.5], z = [at[0] * W, at[1] * H];
    // a gentle bow in the road, to whichever side keeps clear of the towns and their labels
    const dx = z[0] - a[0], dy = z[1] - a[1], len = Math.hypot(dx, dy) || 1;
    const curve = bow => {
      const ctl = [(a[0] + z[0]) / 2 - dy / len * bow, (a[1] + z[1]) / 2 + dx / len * bow];
      return { ctl, pt: t => [(1 - t) * (1 - t) * a[0] + 2 * (1 - t) * t * ctl[0] + t * t * z[0], (1 - t) * (1 - t) * a[1] + 2 * (1 - t) * t * ctl[1] + t * t * z[1]] };
    };
    const towns = Object.values(CENTERS).map(t => [(t.x + 0.5) * S, (t.z + 0.5) * S + 12]).filter(w => Math.hypot(w[0] - a[0], w[1] - a[1]) > 45);
    const wet = (px, py) => { const i = idx(Math.max(0, Math.min(N - 1, Math.floor(px / S))), Math.max(0, Math.min(N - 1, Math.floor(py / S)))); return sim.world.type[i] === T_WATER; };
    const clear = cu => { let m = 1e9, w8 = 0; for (let t = 0.1; t < 0.95; t += 0.05) { const q = cu.pt(t); if (wet(q[0], q[1])) w8++; for (const w of towns) m = Math.min(m, Math.hypot(q[0] - w[0], q[1] - w[1])); } return m - w8 * 14; };
    const { ctl, pt } = [0.18, -0.18, 0.32, -0.32, 0.45, -0.45, 0].map(k => curve(k * len)).reduce((best, cu) => clear(cu) > clear(best) + 4 ? cu : best);
    // the trail: dashed parchment with a brown edge
    g.lineCap = 'round';
    for (const [col, w] of [['#5b3416', 7.5], ['#fff4d6', 4]]) {
      g.strokeStyle = col; g.lineWidth = w; g.setLineDash([10, 7]); g.lineDashOffset = -now * 8;
      g.beginPath(); g.moveTo(...a); g.quadraticCurveTo(...ctl, ...z); g.stroke();
    }
    g.setLineDash([]);
    // the site: a red-ringed medallion with the adventure's icon, and its name on a ribbon
    const pulse = x.leg === 'site' ? 1 + Math.sin(now * 4) * 0.5 : 0;
    if (pulse) { g.strokeStyle = `rgba(200,60,40,${0.5 - pulse * 0.25})`; g.lineWidth = 3; g.beginPath(); g.arc(...z, 17 + pulse * 6, 0, Math.PI * 2); g.stroke(); }
    g.fillStyle = '#fff8e8'; g.strokeStyle = '#a8322a'; g.lineWidth = 3;
    g.beginPath(); g.arc(...z, 14, 0, Math.PI * 2); g.fill(); g.stroke();
    const ic = iconImage(x.q.icon); if (ic.complete) g.drawImage(ic, z[0] - 10, z[1] - 10, 20, 20);
    g.font = '600 12px Fredoka, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    // the label sits across the trail's arrival, never on it: above or below when the trail comes in from
    // the side, beside the medallion when it comes up or down; always toward the middle of the map
    const tw = g.measureText(x.q.name).width + 14, tl = Math.hypot(z[0] - ctl[0], z[1] - ctl[1]) || 1, tx = (z[0] - ctl[0]) / tl, ty = (z[1] - ctl[1]) / tl;
    const across = Math.abs(tx) > Math.abs(ty);
    const lx = across ? Math.min(W - tw / 2 - 4, Math.max(tw / 2 + 4, z[0])) : z[0] + (z[0] > W / 2 ? -1 : 1) * (18 + tw / 2);
    const ly = across ? z[1] + (z[1] > H / 2 ? -26 : 26) : Math.min(H - 12, Math.max(12, z[1]));
    g.fillStyle = 'rgba(255,248,232,.96)'; g.strokeStyle = '#a8322a'; g.lineWidth = 2;
    g.beginPath(); g.roundRect(lx - tw / 2, ly - 9, tw, 18, 9); g.fill(); g.stroke();
    g.fillStyle = '#4a3218'; g.fillText(x.q.name, lx, ly + 1);
    // at the site the party has made camp: a striped tent and a crackling fire, set back down the trail
    if (x.leg === 'site') {
      const cx2 = z[0] - tx * 36, cy2 = z[1] - ty * 36;
      g.fillStyle = 'rgba(40,25,10,.25)'; g.beginPath(); g.ellipse(cx2, cy2 + 9, 16, 4, 0, 0, Math.PI * 2); g.fill();
      // a cream canvas ridge tent: two sloped faces, a dark door flap, the pole poking out of the top
      g.lineJoin = 'round'; g.strokeStyle = '#5b3416'; g.lineWidth = 2;
      g.fillStyle = '#d9c393'; g.beginPath(); g.moveTo(cx2 - 15, cy2 + 8); g.lineTo(cx2 - 4, cy2 - 11); g.lineTo(cx2 + 4, cy2 - 9); g.lineTo(cx2 - 5, cy2 + 8); g.closePath(); g.fill(); g.stroke();
      g.fillStyle = '#f3e6c4'; g.beginPath(); g.moveTo(cx2 - 5, cy2 + 8); g.lineTo(cx2 + 4, cy2 - 9); g.lineTo(cx2 + 12, cy2 + 8); g.closePath(); g.fill(); g.stroke();
      g.fillStyle = '#4a2f18'; g.beginPath(); g.moveTo(cx2 + 1, cy2 + 8); g.lineTo(cx2 + 4, cy2 - 2); g.lineTo(cx2 + 7, cy2 + 8); g.closePath(); g.fill();
      g.beginPath(); g.moveTo(cx2 + 4, cy2 - 9); g.lineTo(cx2 + 4.5, cy2 - 14); g.stroke();
      // the campfire: a glow, logs and a two-tone flame
      const fl = 1 + Math.sin(now * 11) * 0.15, fx2 = cx2 + 22, fy2 = cy2 + 7;
      const glow = g.createRadialGradient(fx2, fy2 - 3, 1, fx2, fy2 - 3, 13); glow.addColorStop(0, 'rgba(255,190,80,.7)'); glow.addColorStop(1, 'rgba(255,150,40,0)');
      g.fillStyle = glow; g.beginPath(); g.arc(fx2, fy2 - 3, 13, 0, Math.PI * 2); g.fill();
      g.strokeStyle = '#5b3416'; g.lineWidth = 2.5; g.beginPath(); g.moveTo(fx2 - 6, fy2 + 2); g.lineTo(fx2 + 6, fy2 - 1); g.moveTo(fx2 - 6, fy2 - 1); g.lineTo(fx2 + 6, fy2 + 2); g.stroke();
      g.fillStyle = '#ff9a2e'; g.beginPath(); g.moveTo(fx2 - 5, fy2); g.quadraticCurveTo(fx2, fy2 - 15 * fl, fx2 + 5, fy2); g.closePath(); g.fill();
      g.fillStyle = '#ffe58a'; g.beginPath(); g.moveTo(fx2 - 2.5, fy2); g.quadraticCurveTo(fx2, fy2 - 8 * fl, fx2 + 2.5, fy2); g.closePath(); g.fill();
      // and the party's banner planted beside the tent, so it's clearly them camping
      g.strokeStyle = '#5b3416'; g.lineWidth = 2; g.beginPath(); g.moveTo(cx2 - 20, cy2 + 9); g.lineTo(cx2 - 20, cy2 - 14); g.stroke();
      g.fillStyle = '#ffd25a'; g.beginPath(); g.moveTo(cx2 - 20, cy2 - 14); g.lineTo(cx2 - 8 + Math.sin(now * 5) * 1.5, cy2 - 10); g.lineTo(cx2 - 20, cy2 - 6); g.closePath(); g.fill(); g.stroke();
    }
    // the party: a little banner disc that bobs along the trail
    if (x.leg === 'out' || x.leg === 'home') {
      let [px, py] = pt(x.k * 0.86);   // a travelling party never quite reaches the medallion until it camps
      py += Math.sin(now * 6) * 1.5;
      g.fillStyle = 'rgba(40,25,10,.25)'; g.beginPath(); g.ellipse(px, py + 13, 10, 3.5, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#ffd25a'; g.strokeStyle = '#7a4a22'; g.lineWidth = 3;
      g.beginPath(); g.arc(px, py, 12, 0, Math.PI * 2); g.fill(); g.stroke();
      const si = iconImage('sword'); if (si.complete) g.drawImage(si, px - 8, py - 8, 16, 16);
      // a pennant on top
      g.strokeStyle = '#7a4a22'; g.lineWidth = 2; g.beginPath(); g.moveTo(px + 7, py - 9); g.lineTo(px + 7, py - 24); g.stroke();
      g.fillStyle = '#d9433b'; g.beginPath(); g.moveTo(px + 7, py - 24); g.lineTo(px + 18 + Math.sin(now * 5) * 1.5, py - 20); g.lineTo(px + 7, py - 16); g.closePath(); g.fill();
    }
  }
  // the note under the map
  const note = document.getElementById('expnote');
  if (note) {
    const h = list.map(x => {
      const who = x.e.members.map(id => sim.vById.get(id)?.name.split(' ')[0]).filter(Boolean);
      const names = esc(who.length > 2 ? `${who.slice(0, -1).join(', ')} and ${who.at(-1)}` : who.join(' and '));
      return `<div class="xn">${svg('sword', 18)}<span><b>${names}</b> are ${LEG_TEXT[x.leg]} <b>${esc(x.q.name)}</b>${x.leg === 'back' ? '.' : `, home in about ${x.hours} hour${x.hours === 1 ? '' : 's'}.`}${x.line && x.leg !== 'back' ? `<i>${esc(x.line)}</i>` : ''}</span></div>`;
    }).join('');
    if (note.dataset.h !== h) { note.innerHTML = h; note.dataset.h = h; }
  }
  return true;
}
