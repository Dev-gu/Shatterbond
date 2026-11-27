const B = require('../../src/builder.js'); const E = require('../../src/engine.js');
const s = +(process.argv[2] || 0.022), mode = process.argv[3] || 'stand';
const extra = JSON.parse(process.argv[4] || '{}');
const d = B.buildBody({ type: 'humanoid', spacing: s, pose: 'stand', height: 1.8, build: 0.5, fat: 0.35, seed: 7 });
const eng = new E();
const params = Object.assign({ rigidity: 0.82, tone: 0.85, strength: 1, shatter: 6, friction: 0.6, stiffness: 0.7, drag: 0.03, stand: mode === 'stand', startAsleep: false, anchorStrength: 1, canSleep: true, goo: 0, plastic: 0, damping: 0, knockout: 2.5, boneSnap: 5.5 }, extra);
eng.build({ boneTissue: B.T.bone, cartTissue: B.T.cartilage, startFrame: 0, bodies: [{ count: d.count, rest: d.rest, tissue: d.tissue, seg: d.seg, invMass: d.invMass, smw: d.smw, shm: d.shm, anchor: d.anchor, boneRef: d.boneRef, bonds: d.bonds, bondRest: d.bondRest, bondK: d.bondK, bondS: d.bondS, bondC: d.bondC, hasSkeleton: d.hasSkeleton, softSegments: d.softSegments, radius: d.radius, spacing: d.spacing, pos: [0, 0, 0], quat: [0, 0, 0, 1], vel: [0, 0, 0], params }] });
const b0 = eng.bodies[0];
console.log('clusters', b0.clusters.length, 'bone members', b0.clusters.reduce((a, c) => a + c.m.length, 0), 'followers', b0.clusters.reduce((a, c) => a + (c.f ? c.f.length : 0), 0), 'pose', b0.poseClusters.map(p => p.m.length).join(','), 'anchors', eng.anc.reduce((a, v) => a + v, 0));
let prev = 0;
for (let f = 0; f < +(process.argv[5] || 40); f++) {
  const r = eng.step({ dt: 1 / 60, substeps: 6, gravity: [0, -9.81, 0], floor: { enabled: true, y: 0, friction: 0.7 }, colliders: [], fields: [], bodies: [{}], ppEvery: 2, dvMax: 3 });
  let ymax = -1e9, vmax = 0; const x = eng.x, v = eng.v;
  for (let i = 0; i < eng.N; i++) { ymax = Math.max(ymax, x[3 * i + 1]); vmax = Math.max(vmax, Math.hypot(v[3 * i], v[3 * i + 1], v[3 * i + 2])); }
  console.log(`f${f + 1} +broken=${r.broken - prev} ko=${b0.ko.toFixed(2)} h=${ymax.toFixed(3)} vmax=${vmax.toFixed(2)} clusters=${b0.clusters.length} anc=${eng.anc.reduce((a, v) => a + v, 0)}`);
  prev = r.broken;
}
{
  const names = B.TISSUES.map(t => t.id), v = eng.v, hist = {};
  let n = 0;
  for (let i = 0; i < eng.N; i++) {
    const sp = Math.hypot(v[3 * i], v[3 * i + 1], v[3 * i + 2]);
    if (sp > 0.5) { n++; const k = names[eng.tis[i]] + '/seg' + eng.seg[i] + (eng.cl[i] >= 0 ? '/bonecl' : '') + '/nb' + eng.nb0[i]; hist[k] = (hist[k] || 0) + 1; }
  }
  console.log('fast particles', n, Object.entries(hist).sort((a, b) => b[1] - a[1]).slice(0, 15).map(e => e.join(':')).join('  '));
}
