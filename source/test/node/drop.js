// Diagnose: humanoid with no collider. mode=stand (conscious) or limp; prints broken bonds and pose stats over time.
const B = require('../../src/builder.js'); const E = require('../../src/engine.js');
const s = +(process.argv[2] || 0.022), mode = process.argv[3] || 'stand';
const extra = JSON.parse(process.argv[4] || '{}');
const d = B.buildBody({ type: 'humanoid', spacing: s, pose: 'stand', height: 1.8, build: 0.6, fat: 0.2, seed: 7 });
const eng = new E();
const params = Object.assign({ rigidity: 0.82, tone: 0.85, strength: 1, shatter: 6, friction: 0.6, stiffness: 0.7, drag: 0.03, stand: mode === 'stand', startAsleep: false, anchorStrength: 1, canSleep: true, goo: 0.6, plastic: 0.3, damping: 0.3, knockout: 2.5, boneSnap: 5.5 }, extra);
eng.build({ boneTissue: B.T.bone, cartTissue: B.T.cartilage, startFrame: 0, bodies: [{ count: d.count, rest: d.rest, tissue: d.tissue, seg: d.seg, invMass: d.invMass, smw: d.smw, shm: d.shm, anchor: d.anchor, boneRef: d.boneRef, bonds: d.bonds, bondRest: d.bondRest, bondK: d.bondK, bondS: d.bondS, bondC: d.bondC, hasSkeleton: d.hasSkeleton, softSegments: d.softSegments, radius: d.radius, spacing: d.spacing, pos: [0, mode === 'drop' ? 0.6 : 0, 0], quat: mode === 'drop' ? [0.7071, 0, 0, 0.7071] : [0, 0, 0, 1], vel: [0, 0, 0], params }] });
const evs = [];
for (let f = 0; f < 120; f++) {
  const r = eng.step({ dt: 1 / 60, substeps: 6, gravity: [0, -9.81, 0], floor: { enabled: true, y: 0, friction: 0.7 }, colliders: [], fields: [], bodies: [{}], ppEvery: 2, dvMax: 3 });
  evs.push(...r.events);
  if (f % 20 === 19) {
    let ymax = -1e9, ymin = 1e9, xs = 0; const x = eng.x;
    for (let i = 0; i < eng.N; i++) { ymax = Math.max(ymax, x[3 * i + 1]); ymin = Math.min(ymin, x[3 * i + 1]); }
    console.log(`f${f + 1} broken=${r.broken} links=${r.links} ko=${eng.bodies[0].ko.toFixed(2)} height=${ymax.toFixed(2)} min=${ymin.toFixed(2)} asleep=${eng.bodies[0].asleep} fract=${evs.map(e => e.seg).join(',')}`);
  }
}
{
  const names = B.TISSUES.map(t => t.id), cnt = {};
  for (let b = 0; b < eng.B; b++) if (eng.bx[b]) { const k = names[eng.tis[eng.bi[b]]] + '-' + names[eng.tis[eng.bj[b]]] + (eng.seg[eng.bi[b]] !== eng.seg[eng.bj[b]] ? '(joint)' : ''); cnt[k] = (cnt[k] || 0) + 1; }
  console.log(Object.entries(cnt).sort((a, b) => b[1] - a[1]).slice(0, 12).map(e => e.join(':')).join('  '));
}
