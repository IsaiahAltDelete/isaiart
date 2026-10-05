// Share codes: a whole village squeezed into one line of text.
//   VLG1.<base64url of deflate-raw(JSON)>   when the browser has CompressionStream
//   VLG0.<base64url of the plain JSON>      fallback (longer, still works everywhere)
export const BACKUP_KEY = 'isaiart.villages.backup';

const b64url = u8 => {
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const unb64url = str => {
  const s = atob(str.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((str.length + 3) % 4));
  const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
  return u;
};
const pipe = async (u8, stream) => new Uint8Array(await new Response(new Blob([u8]).stream().pipeThrough(stream)).arrayBuffer());

export async function encodeSave(save) {
  const bytes = new TextEncoder().encode(JSON.stringify(save));
  if (typeof CompressionStream === 'function') {
    try { return 'VLG1.' + b64url(await pipe(bytes, new CompressionStream('deflate-raw'))); } catch { /* fall back */ }
  }
  return 'VLG0.' + b64url(bytes);
}

// returns the save object, or throws an Error with a friendly message
export async function decodeSave(code) {
  const clean = String(code || '').trim().replace(/\s+/g, '');
  const m = /^VLG([01])\.([A-Za-z0-9_-]+)$/.exec(clean);
  if (!m) throw new Error('That doesn\'t look like a village share code (they start with "VLG").');
  let bytes;
  try { bytes = unb64url(m[2]); } catch { throw new Error('The code is damaged — check it was copied completely.'); }
  if (m[1] === '1') {
    if (typeof DecompressionStream !== 'function') throw new Error('This browser can\'t unpack compressed codes. Try a newer browser.');
    try { bytes = await pipe(bytes, new DecompressionStream('deflate-raw')); } catch { throw new Error('The code is damaged — check it was copied completely.'); }
  }
  let save;
  try { save = JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new Error('The code is damaged — check it was copied completely.'); }
  if (!save || typeof save.seed !== 'number' || !Array.isArray(save.buildings) || !Array.isArray(save.villagers) || !save.world?.alive) throw new Error('That code doesn\'t hold a village.');
  return save;
}

// a little summary for the confirm step
export function describeSave(save) {
  const names = save.names || {};
  return { name: names.meadow || 'Meadowbrook', pop: save.villagers.length, buildings: save.buildings.filter(b => b.type !== 'campfire').length,
    level: save.level || 1, day: Math.floor((save.time || 0) / 240) + 1, settled: Object.keys(save.unlocked || {}).length };
}

export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* fall back */ }
  try {
    const ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select(); const ok = document.execCommand('copy'); ta.remove(); return ok;
  } catch { return false; }
}
