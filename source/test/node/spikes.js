// Spike pit check: a body drops flat onto a bed of cones. It should be pierced and hang on them, not dissolve.
const B = require('../../src/builder.js'); const E = require('../../src/engine.js');
const s = +(process.env.S || 0.022);
const d = B.buildBody({ type: 'humanoid', spacing: s, pose: 'starfish', height: 1.8, build: 0.6, fat: 0.2, seed: 7 });
const eng = new E(); for (const k of ['CRUSHP', 'CRUSHWEAK', 'CRUSHPULP']) if (process.env[k]) E[k] = +process.env[k];
const params = { rigidity: 0.82, tone: 0.35, shatter: 10, friction: 0.6, stiffness: 0.65, drag: 0.03, stand: false, startAsleep: false, anchorStrength: 1, canSleep: true, goo: 0.6, plastic: 0.1, damping: 0.18, knockout: 2.5, boneSnap: 5.5, firmness: 0.05, strength: 1, spill: 0.5 };
const q = [Math.sin(-88 * Math.PI / 360), 0, 0, Math.cos(-88 * Math.PI / 360)];
eng.build({ boneTissue: B.T.bone, cartTissue: B.T.cartilage, startFrame: 0, bodies: [{ count: d.count, rest: d.rest, tissue: d.tissue, seg: d.seg, invMass: d.invMass, smw: d.smw, shm: d.shm, anchor: d.anchor, boneRef: d.boneRef, bonds: d.bonds, bondRest: d.bondRest, bondK: d.bondK, bondS: d.bondS, bondC: d.bondC, hasSkeleton: d.hasSkeleton, softSegments: d.softSegments, radius: d.radius, spacing: d.spacing, pos: [0, 1.75, 0.9], quat: q, vel: [0, 0, 0], params }] });
const cols = [];
for (let r = 0; r < 6; r++) for (let c = 0; c < 6; c++) { const p = [(c - 2.5) * 0.32, 0.3, (r - 2.5) * 0.32]; cols.push({ key: 's' + r + c, shape: 'cone', dims: [0.06, 0.3, 0.06], bound: 0.31, friction: 0.5, shatterMul: 1 / 2.6, a: { p, q: [0, 0, 0, 1] }, b: { p, q: [0, 0, 0, 1] } }); }
let r;
for (let f = 0; f < 200; f++) {
  r = eng.step({ dt: 1 / 60, substeps: 6, gravity: [0, -9.81, 0], floor: { enabled: true, y: 0, friction: 0.7 }, colliders: cols, fields: [], bodies: [{}], ppEvery: 2, dvMax: 3 });
  if (f % 40 === 39) { let loose = 0, crx = 0; for (let i = 0; i < d.count; i++) { if (eng.nbb[i] >= eng.nb0[i]) loose++; crx += eng.crx ? eng.crx[i] : 0; }
    console.log(`f${f + 1} broken=${r.broken} (${(100 * r.broken / d.bondRest.length).toFixed(1)}%) loose=${loose} (${(100 * loose / d.count).toFixed(1)}%) meanCrx=${(crx / d.count).toFixed(3)}`); }
}
