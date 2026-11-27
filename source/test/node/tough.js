// Toughness check: how much damage everyday knocks do. Prints broken bonds and loose molecules per scenario.
const B = require('../../src/builder.js'); const E = require('../../src/engine.js');
const s = +(process.env.S || 0.02), SH = +(process.env.SHATTER || 6);
const d = B.buildBody({ type: 'humanoid', spacing: s, pose: 'stand', height: 1.8, build: 0.6, fat: 0.2, seed: 7 });
function run(name, frames, colFn, addVel) {
  const eng = new E();
  const params = { rigidity: 0.82, tone: 0.85, shatter: SH, friction: 0.6, stiffness: 0.65, drag: 0.03, stand: true, startAsleep: false, anchorStrength: 1, canSleep: true, goo: 0.6, plastic: +(process.env.PL ?? 0.1), damping: +(process.env.DA ?? 0.18), knockout: 2.5, boneSnap: 5.5, firmness: +(process.env.FIRM || 0.05), koTime: process.env.KOT ? +process.env.KOT : undefined, strength: +(process.env.STR || 1) };
  eng.build({ boneTissue: B.T.bone, cartTissue: B.T.cartilage, startFrame: 0, bodies: [{ count: d.count, rest: d.rest, tissue: d.tissue, seg: d.seg, invMass: d.invMass, smw: d.smw, shm: d.shm, anchor: d.anchor, boneRef: d.boneRef, bonds: d.bonds, bondRest: d.bondRest, bondK: d.bondK, bondS: d.bondS, bondC: d.bondC, hasSkeleton: d.hasSkeleton, softSegments: d.softSegments, radius: d.radius, spacing: d.spacing, pos: [0, 0, 0], quat: [0, 0, 0, 1], vel: [0, 0, 0], params }] });
  let r;
  for (let f = 0; f < frames; f++) {
    const cols = colFn ? colFn(f) : [];
    r = eng.step({ dt: 1 / 60, substeps: 6, gravity: [0, -9.81, 0], floor: { enabled: true, y: 0, friction: 0.7 }, colliders: cols, fields: [], bodies: [f === 5 && addVel ? { addVel } : {}], ppEvery: 2, dvMax: 3 });
  }
  let loose = 0; for (let i = 0; i < d.count; i++) if (eng.nbb[i] >= eng.nb0[i]) loose++;
  console.log(`${name.padEnd(22)} broken=${String(r.broken).padStart(6)} (${(100 * r.broken / d.bondRest.length).toFixed(1)}%) loose=${loose} (${(100 * loose / d.count).toFixed(1)}%)`);
}
const swing = (V, Y, power, R = 0.15, stop = 9) => (f) => { const xa = Math.min(stop, -1.5 + Math.max(0, f - 9) * V / 60), xb = Math.min(stop, -1.5 + Math.max(0, f - 10) * V / 60); return [{ key: 'b', shape: 'sphere', dims: [R, R, R], bound: R, friction: 0.5, shatterMul: 1 / power, a: { p: [xa, Y, 0], q: [0, 0, 0, 1] }, b: { p: [xb, Y, 0], q: [0, 0, 0, 1] } }]; };
console.log(`N=${d.count} bonds=${d.bondRest.length} shatter=${SH}`);
run('push over + fall', 150, null, [2.5, 0, 0]);
run('punch 7 m/s head', 90, swing(7, 1.66, 1, 0.07, -0.13));
run('shove 4 m/s chest', 90, swing(4, 1.3, 1, 0.2, -0.42));
run('kick 10 m/s thigh', 90, swing(10, 0.7, 1, 0.08, -0.22));
run('hammer 9 m/s p1.7', 90, swing(9, 1.25, 1.7, 0.25));
