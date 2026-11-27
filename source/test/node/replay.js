// Replays a captured demo (test/browser/capture.js) in node: CAP=<json> F=<frames>. Prints broken bonds every 10 frames.
const E = require('../../src/engine.js'); global.ShatterBuilder = require('../../src/builder.js');
const fs = require('fs');
const dec = (v) => (v && v.__t ? new globalThis[v.__t](v.d) : Array.isArray(v) ? v.map(dec) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, dec(x)])) : v);
const cap = JSON.parse(fs.readFileSync(process.env.CAP || '/tmp/cap.json'));
for (const k of Object.keys(process.env)) if (/^[A-Z]+$/.test(k) && typeof E[k] === 'number') E[k] = +process.env[k];
const B0 = dec(cap.build); if (process.env.PARAMS) Object.assign(B0.bodies[0].params, JSON.parse(process.env.PARAMS)); const eng = new E(); eng.build(B0);
const steps = cap.steps.map(dec), F = +(process.env.F || steps.length);
const p0 = dec(cap.build).bodies[0].params; if (process.env.SHOWP) console.log(JSON.stringify(p0));
let r;
for (let f = 0; f < F; f++) { const inp = steps[Math.min(f, steps.length - 1)]; inp.physics = "cpu"; if (process.env.FR) inp.colliders.forEach(c => { if (c.shape === "cone") c.friction = +process.env.FR; }); if (process.env.NOBASE) inp.colliders = inp.colliders.filter(c => c.shape === "cone"); r = eng.step(inp); if (f % 10 === 9) console.log(`f${f + 1} broken=${r.broken} ns=${r.substeps || ''}`); }
