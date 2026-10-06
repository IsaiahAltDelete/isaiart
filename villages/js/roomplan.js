// How a home's room is laid out for a peek inside (peek.js): pure, so it can be tested headless.
// The biggest rectangle of grid cells that all carry the same non-zero label and aren't used yet.
// Labels count how many of the house's wall volumes cover a cell, so a rectangle never crosses a wall.
export function largestRect(cnt, nx, nz, used, minW = 1, minD = 1) {
  let best = null;
  for (let z0 = 0; z0 < nz; z0++) for (let x0 = 0; x0 < nx; x0++) {
    const lab = cnt[z0 * nx + x0]; if (!lab || used[z0 * nx + x0]) continue;
    let maxX = nx;
    for (let z1 = z0; z1 < nz; z1++) {
      let x1 = x0;
      while (x1 < maxX && cnt[z1 * nx + x1] === lab && !used[z1 * nx + x1]) x1++;
      maxX = x1; if (maxX === x0) break;
      const w = maxX - x0, d = z1 - z0 + 1;
      if (w >= minW && d >= minD && (!best || w * d > best.w * best.d)) best = { x: x0, z: z0, w, d };
    }
  }
  return best;
}
export function markRect(used, nx, r) { for (let z = r.z; z < r.z + r.d; z++) for (let x = r.x; x < r.x + r.w; x++) used[z * nx + x] = 1; }

// where the beds, table and hearth go, from the floor grid (cell size `s`, origin at gx/gz)
export function roomLayout(G, beds) {
  const { cnt, nx, nz, s, gx, gz } = G, used = new Uint8Array(nx * nz), cells = m => Math.ceil(m / s - 1e-6);
  const toW = (r, fx, fz) => ({ x: gx + (r.x + r.w * fx) * s, z: gz + (r.z + r.d * fz) * s });
  const out = { beds: [], table: null, hearth: null };
  // the bedroom: room for full-length beds if the house has it, otherwise the deepest that fits
  const R1 = largestRect(cnt, nx, nz, used, cells(0.5), cells(0.86)) || largestRect(cnt, nx, nz, used, cells(0.5), cells(0.62));
  if (R1) {
    const W = R1.w * s, D = R1.d * s, bw = 0.42, n = Math.max(1, Math.min(beds, Math.floor((W + 0.04) / (bw + 0.04))));
    const gap = (W - n * bw) / (n + 1), bedL = Math.min(0.88, D - 0.04), back = gz + R1.z * s;
    for (let i = 0; i < n; i++) out.beds.push({ x: gx + R1.x * s + gap + bw / 2 + i * (bw + gap), z: back + 0.02 + bedL / 2, w: bw, l: bedL });
    // a deep room keeps the table in front of the beds; otherwise it goes to the next room along
    if (D - bedL >= 0.6) { out.table = { ...toW(R1, 0.4, 1), r: 0.18 }; out.table.z = back + bedL + (D - bedL) / 2; }
    markRect(used, nx, R1);
    // anyone without a bed gets a bedroll on the floor of the next room along (up to two)
    for (let k = 0; k < Math.min(2, beds - n); k++) {
      const Rz = largestRect(cnt, nx, nz, used, cells(0.36), cells(0.68)), Rx = !Rz && largestRect(cnt, nx, nz, used, cells(0.68), cells(0.36));
      const R = Rz || Rx; if (!R) break;
      const c = toW(R, 0.5, 0.5);
      out.beds.push(Rz ? { x: c.x, z: gz + R.z * s + 0.35, w: 0.34, l: 0.66, roll: true } : { x: gx + R.x * s + 0.35, z: c.z, w: 0.34, l: 0.66, roll: true, yaw: Math.PI / 2 });
      markRect(used, nx, Rz ? { ...R, d: Math.min(R.d, cells(0.78)) } : { ...R, w: Math.min(R.w, cells(0.78)) });
    }
  }
  let R2 = null;
  if (!out.table) { R2 = largestRect(cnt, nx, nz, used, cells(0.45), cells(0.45)); if (R2) { out.table = { ...toW(R2, 0.5, 0.5), r: Math.min(0.2, Math.min(R2.w, R2.d) * s / 2 - 0.07) }; markRect(used, nx, R2); } }
  const R3 = largestRect(cnt, nx, nz, used, cells(0.34), cells(0.3));
  if (R3) { out.hearth = toW(R3, 0.5, 0.35); markRect(used, nx, R3); }
  else if (R2 && R2.w * s >= 0.85) {
    // share the table's room: table to the left, the stove against the right wall
    out.table.x = gx + R2.x * s + Math.max(0.3, out.table.r + 0.12); out.hearth = { x: gx + (R2.x + R2.w) * s - 0.2, z: gz + R2.z * s + 0.16 };
  } else if (R1 && out.table && R1.w * s > 1.2) out.hearth = { x: gx + (R1.x + R1.w) * s - 0.22, z: out.table.z };
  // and if a room is still bare, a chest and a little rug
  const R4 = largestRect(cnt, nx, nz, used, cells(0.36), cells(0.3));
  if (R4) out.chest = toW(R4, 0.5, 0.4);
  return out;
}
