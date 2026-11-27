// Crush check: a press plate squashes a standing figure. Prints how much bursts open and how many insides spill out.
const B = require('../../src/builder.js'); const E = require('../../src/engine.js');
const s = +(process.env.S || 0.022);
const d = B.buildBody({ type: 'humanoid', spacing: s, pose: 'armsup', height: 1.8, build: 0.6, fat: 0.2, seed: 7 });
const eng = new E(); for (const k of ['CRUSHP', 'CRUSHWEAK', 'CRUSHSQUIRT', 'CRUSHVMAX', 'CRUSHPULP']) if (process.env[k]) E[k] = +process.env[k];
const params = { rigidity: 0.82, tone: 0.85, shatter: 10, friction: 0.6, stiffness: 0.65, drag: 0.03, stand: true, startAsleep: false, anchorStrength: 1, canSleep: true, goo: 0.6, plastic: 0.1, damping: 0.18, knockout: 2.5, boneSnap: 5.5, firmness: 0.05, strength: 1, spill: 0.5 };
eng.build({ boneTissue: B.T.bone, cartTissue: B.T.cartilage, startFrame: 0, bodies: [{ count: d.count, rest: d.rest, tissue: d.tissue, seg: d.seg, invMass: d.invMass, smw: d.smw, shm: d.shm, anchor: d.anchor, boneRef: d.boneRef, bonds: d.bonds, bondRest: d.bondRest, bondK: d.bondK, bondS: d.bondS, bondC: d.bondC, hasSkeleton: d.hasSkeleton, softSegments: d.softSegments, radius: d.radius, spacing: d.spacing, pos: [0, 0, 0], quat: [0, 0, 0, 1], vel: [0, 0, 0], params }] });
const H = 0.3, low = +(process.env.LOW || 0.12);
const yAt = (f) => { const t = Math.max(0, f - 10) / 60; return Math.max(low + H / 2, 2.3 - t * (2.3 - low - H / 2) / 1.4); };
const organ = new Set(B.TISSUES.map((t, i) => t.kind === 'organ' ? i : -1).filter(i => i >= 0));
const F = +(process.env.F || 200);
let r;
for (let f = 0; f < F; f++) {
  const cols = [{ key: 'p', shape: 'box', dims: [+(process.env.PW || 0.75), H / 2, +(process.env.PD || 0.55)], bound: 1, friction: 0.5, shatterMul: 1 / 1.3, a: { p: [0, yAt(f - 1), 0], q: [0, 0, 0, 1] }, b: { p: [0, yAt(f), 0], q: [0, 0, 0, 1] } }];
  r = eng.step({ dt: 1 / 60, substeps: 6, gravity: [0, -9.81, 0], floor: { enabled: true, y: 0, friction: 0.7 }, colliders: cols, fields: [], bodies: [{}], ppEvery: 2, dvMax: 3 });
  if (f % 40 === 39 || f === F - 1) {
    let loose = 0, looseOrg = 0, out = 0, outOrg = 0, skinBroken = 0;
    for (let i = 0; i < d.count; i++) {
      const l = eng.nbb[i] >= eng.nb0[i]; if (l) { loose++; if (organ.has(eng.tis[i])) looseOrg++; }
      const x = eng.x[3 * i], z = eng.x[3 * i + 2];
      if (Math.abs(x) > +(process.env.PW || 0.75) + 0.05 || Math.abs(z) > +(process.env.PD || 0.55) + 0.05) { out++; if (organ.has(eng.tis[i]) || eng.tis[i] === B.T.muscle) outOrg++; }
      if (eng.tis[i] === 0 && eng.nbb[i] > 0) skinBroken++;
    }
    let pm = 0; for (let i = 0; i < d.count; i++) pm = Math.max(pm, eng.press[i]);
    console.log(`f${f + 1} plate=${yAt(f).toFixed(2)} broken=${r.broken} loose=${loose} looseOrgan=${looseOrg} outsidePlate=${out} insidesOut=${outOrg} skinTorn=${skinBroken} maxPress=${pm.toFixed(2)}`);
  }
}
console.log('N', d.count);
{
  const h = { c50: 0, c70: 0, c85: 0, s130: 0, s160: 0, s200: 0 }; let n = 0;
  for (let q = 0; q < eng.B; q++) { if (eng.bx[q]) continue; n++; const i = eng.bi[q], j = eng.bj[q]; const L = Math.hypot(eng.x[3*j]-eng.x[3*i], eng.x[3*j+1]-eng.x[3*i+1], eng.x[3*j+2]-eng.x[3*i+2]) / eng.br0[q];
    if (L < 0.5) h.c50++; else if (L < 0.7) h.c70++; else if (L < 0.85) h.c85++; if (L > 2) h.s200++; else if (L > 1.6) h.s160++; else if (L > 1.3) h.s130++; }
  for (const k in h) h[k] = (100 * h[k] / n).toFixed(1) + '%';
  let ymax = 0; for (let i = 0; i < eng.N; i++) ymax = Math.max(ymax, eng.x[3*i+1]);
  let crm = 0; for (let i = 0; i < eng.N; i++) crm += eng.crx[i];
  console.log('bond L/r0', JSON.stringify(h), 'ymax', ymax.toFixed(2), 'mean crx', (crm / eng.N).toFixed(3), 'rad', eng.rad[100].toFixed(4));
}
{
  const ext = (sel) => { let a = [1e9,1e9,1e9], b = [-1e9,-1e9,-1e9], n = 0; for (let i = 0; i < eng.N; i++) { if (!sel(i)) continue; n++; for (let k = 0; k < 3; k++) { a[k] = Math.min(a[k], eng.x[3*i+k]); b[k] = Math.max(b[k], eng.x[3*i+k]); } } return a.map((v, k) => v.toFixed(2) + '..' + b[k].toFixed(2)).join(' ') + ' n' + n; };
  console.log('all', ext(() => true));
  console.log('rest chest depth', ext((i) => d.rest[3*i+1] > 1.2 && d.rest[3*i+1] < 1.35 && Math.abs(d.rest[3*i]) < 0.12));
  console.log('rest all', (() => { let a = [1e9,1e9,1e9], b = [-1e9,-1e9,-1e9]; for (let i = 0; i < d.count; i++) for (let k = 0; k < 3; k++) { a[k] = Math.min(a[k], d.rest[3*i+k]); b[k] = Math.max(b[k], d.rest[3*i+k]); } return a.map((v, k) => v.toFixed(2) + '..' + b[k].toFixed(2)).join(' '); })());
  const tc = {}; for (let i = 0; i < d.count; i++) tc[B.TISSUES[d.tissue[i]].id] = (tc[B.TISSUES[d.tissue[i]].id] || 0) + 1; console.log(JSON.stringify(tc));
}
{
  const m = new Map(), cs = d.spacing; let mx = 0, over = 0;
  for (let i = 0; i < eng.N; i++) { const k = Math.floor(eng.x[3*i]/cs) + ',' + Math.floor(eng.x[3*i+2]/cs); m.set(k, (m.get(k) || 0) + 1); }
  for (const v of m.values()) { mx = Math.max(mx, v); if (v > 7) over += v - 7; }
  // nearest-neighbour distance stats
  let close = 0; const g = new Map(); for (let i = 0; i < eng.N; i++) { const k = [0,1,2].map(a => Math.floor(eng.x[3*i+a]/cs)).join(); (g.get(k) || g.set(k, []).get(k)).push(i); }
  for (let i = 0; i < eng.N; i++) { const c = [0,1,2].map(a => Math.floor(eng.x[3*i+a]/cs)); let mn = 9; for (let dx=-1;dx<=1;dx++) for (let dy=-1;dy<=1;dy++) for (let dz=-1;dz<=1;dz++) { const L = g.get([c[0]+dx,c[1]+dy,c[2]+dz].join()); if (!L) continue; for (const j of L) if (j !== i) mn = Math.min(mn, Math.hypot(eng.x[3*j]-eng.x[3*i], eng.x[3*j+1]-eng.x[3*i+1], eng.x[3*j+2]-eng.x[3*i+2])); } if (mn < cs * 0.5) close++; }
  console.log('max per column', mx, 'excess', over, 'columns', m.size, 'particles closer than half spacing', close);
}
{
  const cs = 0.03, g = new Set(); for (let i = 0; i < eng.N; i++) if (eng.tis[i] === 0 && eng.nbb[i] < eng.nb0[i]) g.add([0,1,2].map(a => Math.floor(eng.x[3*i+a]/cs)).join());
  let out = 0, outO = 0;
  for (let i = 0; i < eng.N; i++) { if (eng.tis[i] === 0 || eng.tis[i] === B.T.bone) continue; const c = [0,1,2].map(a => Math.floor(eng.x[3*i+a]/cs)); let near = false;
    for (let dx=-2;dx<=2&&!near;dx++) for (let dy=-2;dy<=2&&!near;dy++) for (let dz=-2;dz<=2&&!near;dz++) if (g.has([c[0]+dx,c[1]+dy,c[2]+dz].join())) near = true;
    if (!near) { out++; if (organ.has(eng.tis[i])) outO++; } }
  // inside molecules far from any intact skin = spilled out of the body
  console.log('spilled insides', out, 'of which organ', outO);
}
