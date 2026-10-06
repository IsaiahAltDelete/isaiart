// The model index must point at the data file that ships beside it, and every mesh must fit inside it.
// (An export written under another name once shipped with "bin": "c4.bin" and the live game failed to load.)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const J = JSON.parse(fs.readFileSync(new URL('../models/models.json', import.meta.url), 'utf8'));
const bin = fs.statSync(new URL('../models/models.bin', import.meta.url)).size;

test('models.json names models.bin and every mesh fits inside it', () => {
  assert.equal(J.bin, 'models.bin');
  let max = 0, meshes = 0;
  for (const m of Object.values(J.models)) for (const n of m.nodes) for (const me of n.meshes || []) {
    meshes++;
    max = Math.max(max, me.pos + me.nv * 6, me.idx + me.ni * 2, me.nrm >= 0 ? me.nrm + me.nv * 3 : 0);
    assert.equal(me.pos % 2, 0); assert.equal(me.idx % 2, 0);
  }
  assert.ok(meshes > 100);
  assert.ok(max <= bin, `index needs ${max} bytes, bin has ${bin}`);
  assert.ok(J.models.villager, 'the villager is in the set');
});
