// Rebuild the runtime grids after editing assets/pixel/satchel.pxa.
import { readFileSync, writeFileSync } from 'node:fs';
const source = new URL('../assets/pixel/satchel.pxa', import.meta.url);
const frames = {};
let current = null;
for (const raw of readFileSync(source, 'utf8').split(/\r?\n/)) {
  const line = raw.trim();
  if (line.startsWith('@frame ')) {
    current = line.slice(7).trim(); frames[current] = [];
  } else if (current && line && !line.startsWith('#')) frames[current].push(line);
}
for (const direction of ['down', 'left', 'up']) {
  if (frames[direction]?.length !== 24 || frames[direction].some(row => row.length !== 16))
    throw new Error(`Expected a 16x24 ${direction} frame`);
}
writeFileSync(new URL('../src/render/satchel-art.js', import.meta.url),
  '// Generated from assets/pixel/satchel.pxa; retain that file as the pixel source.\nexport const SATCHEL = ' + JSON.stringify(frames, null, 2) + ';\n');
