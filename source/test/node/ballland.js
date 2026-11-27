// A body falls face-down onto a cannonball resting on the floor. It should bruise and drape over it, not burst; the ball should stay put.
const B = require('../../src/builder.js'); const E = require('../../src/engine.js');
const s = +(process.env.S || 0.022), H = +(process.env.H || 1.2), NB = +(process.env.NB || 3);
const d = B.buildBody({ type: 'humanoid', spacing: s, pose: 'starfish', height: 1.8, build: 0.6, fat: 0.2, seed: 7 });
const eng = new E(); for (const k of ['CRUSHP', 'CRUSHWEAK', 'CRUSHPULP']) if (process.env[k]) E[k] = +process.env[k];
const params = { rigidity: 0.82, tone: 0.35, shatter: 10, friction: 0.6, stiffness: 0.65, drag: 0.03, stand: false, startAsleep: false, anchorStrength: 1, canSleep: true, goo: 0.6, plastic: 0.1, damping: 0.18, knockout: 2.5, boneSnap: 5.5, firmness: 0.05, strength: 1, spill: 0.5 };
const q = [Math.sin(-88 * Math.PI / 360), 0, 0, Math.cos(-88 * Math.PI / 360)];
eng.build({ boneTissue: B.T.bone, cartTissue: B.T.cartilage, startFrame: 0, bodies: [{ count: d.count, rest: d.rest, tissue: d.tissue, seg: d.seg, invMass: d.invMass, smw: d.smw, shm: d.shm, anchor: d.anchor, boneRef: d.boneRef, bonds: d.bonds, bondRest: d.bondRest, bondK: d.bondK, bondS: d.bondS, bondC: d.bondC, hasSkeleton: d.hasSkeleton, softSegments: d.softSegments, radius: d.radius, spacing: d.spacing, pos: [0, H, 0.9], quat: q, vel: [0, 0, 0], params }] });
const r0 = 0.11, m0 = 4.18879 * r0 ** 3 * 300;
const proj = []; for (let k = 0; k < NB; k++) proj.push({ key: 'b' + k, p: [(k - (NB - 1) / 2) * 0.3, r0, 0.2 * k], v: [0, 0, 0], r: r0, m: m0, friction: 0.5, restitution: 0.35, shatterMul: 1 / 1.8 });
let r;
for (let f = 0; f < 200; f++) {
  r = eng.step({ dt: 1 / 60, substeps: 6, gravity: [0, -9.81, 0], floor: { enabled: true, y: 0, friction: 0.7 }, colliders: [], fields: [], bodies: [{}], projectiles: f === 0 ? proj : [], ppEvery: 2, dvMax: 3 });
  if (f % 20 === 19) { let loose = 0, vmax = 0; for (let i = 0; i < d.count; i++) { if (eng.nbb[i] >= eng.nb0[i]) loose++; }
    const bs = eng.balls.map(b => `(${b.x.map(v => v.toFixed(2)).join(',')}|${Math.hypot(...b.v).toFixed(1)})`).join(' ');
    let crx = 0; for (let i = 0; i < d.count; i++) crx = Math.max(crx, eng.crx ? eng.crx[i] : 0);
    console.log(`f${f + 1} broken=${r.broken} (${(100 * r.broken / d.bondRest.length).toFixed(1)}%) loose=${loose} (${(100 * loose / d.count).toFixed(1)}%) maxCrx=${crx.toFixed(2)} balls ${bs}`); }
}
