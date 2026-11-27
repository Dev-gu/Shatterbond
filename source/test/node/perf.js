// Build a humanoid at several spacings and time the build and a few steps with a swinging box hitting it.
const B = require('../../src/builder.js'); const E = require('../../src/engine.js');
const sp = (process.argv[2] || '0.022,0.0165,0.0135').split(',').map(Number);
for (const s of sp) {
  let t = Date.now();
  const d = B.buildBody({ type: 'humanoid', spacing: s, pose: 'stand', height: 1.8, build: 0.6, fat: 0.2, seed: 7 });
  const tb = Date.now() - t;
  const eng = new E();
  const params = { rigidity: 0.82, tone: 0.85, strength: 1, shatter: 6, friction: 0.6, stiffness: 0.7, drag: 0.03, stand: true, startAsleep: false, anchorStrength: 1, canSleep: true, goo: 0.6, plastic: 0.3, damping: 0.3, knockout: 2.5, boneSnap: 5.5, firmness: 0.15 };
  eng.build({ boneTissue: B.T.bone, cartTissue: B.T.cartilage, startFrame: 0, bodies: [{ count: d.count, rest: d.rest, tissue: d.tissue, seg: d.seg, invMass: d.invMass, smw: d.smw, shm: d.shm, anchor: d.anchor, boneRef: d.boneRef, bonds: d.bonds, bondRest: d.bondRest, bondK: d.bondK, bondS: d.bondS, bondC: d.bondC, hasSkeleton: d.hasSkeleton, softSegments: d.softSegments, radius: d.radius, spacing: d.spacing, pos: [0, 0, 0], quat: [0, 0, 0, 1], vel: [0, 0, 0], params }] });
  // a box sweeping through the chest at 8 m/s from frame 10
  let ms = 0, frames = 90, evs = [];
  for (let f = 0; f < frames; f++) {
    const V = +(process.env.V || 8), Y = +(process.env.Y || 1.25); const xa = -2 + Math.max(0, f - 10) * V / 60, xb = -2 + Math.max(0, f - 9) * V / 60;
    const col = { key: 'box', shape: 'cylinder', dims: [0.3, 0.45, 0.3], bound: 0.6, friction: 0.5, shatterMul: 1 / 1.7, a: { p: [xa, Y, 0], q: [0, 0, 0.7071, 0.7071] }, b: { p: [xb, Y, 0], q: [0, 0, 0.7071, 0.7071] } };
    const r = eng.step({ dt: 1 / 60, substeps: 6, gravity: [0, -9.81, 0], floor: { enabled: true, y: 0, friction: 0.7 }, colliders: [col], fields: [], bodies: [{}], ppEvery: 2, dvMax: 3 });
    ms += r.ms; evs.push(...r.events);
    if (f === frames - 1) console.log(`s=${s} N=${d.count} bonds=${d.bondRest.length} skinVerts=${d.skin.pos.length / 3} fails=${d.skin.fails} build=${tb}ms step=${(ms / frames).toFixed(1)}ms broken=${r.broken} links=${r.links} ko=${eng.bodies[0].ko.toFixed(2)} fractures=${evs.map(e => e.seg).join(',')}`);
  }
}
