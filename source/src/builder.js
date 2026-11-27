/* Shatterbond procedural body builder.
 * Turns signed-distance shapes into bonded particle lattices with tissue types,
 * and builds a smooth skin mesh (surface nets) bound to the lattice. */
(function (root) {
  'use strict';

  /* ---------------- tissue & material library ---------------- */
  // stiffness: PBD bond stiffness (0..1). stretch / compress: strain at which a bond snaps.
  // density: relative mass. rigidity: how strongly the tissue holds its shape. shatter: impact speed multiplier.
  const TISSUES = [
    { id: 'skin', name: 'Skin', color: '#e7c2ad', density: 1.1, stiffness: 0.95, stretch: 2.3, compress: 0.95, rigidity: 0.95, shatter: 1.25, kind: 'tissue' },
    { id: 'fat', name: 'Fat', color: '#f1cf6e', density: 0.92, stiffness: 0.4, stretch: 1.6, compress: 0.9, rigidity: 0.55, shatter: 0.85, kind: 'tissue' },
    { id: 'muscle', name: 'Muscle', color: '#a82a36', density: 1.06, stiffness: 0.6, stretch: 1.3, compress: 0.9, rigidity: 0.85, shatter: 1.0, kind: 'tissue' },
    { id: 'bone', name: 'Bone', color: '#f0e8d2', density: 2.6, stiffness: 1.0, stretch: 0.3, compress: 0.35, rigidity: 1.0, shatter: 2.6, kind: 'tissue' },
    { id: 'cartilage', name: 'Cartilage & ligament', color: '#bfdbe6', density: 1.1, stiffness: 0.7, stretch: 1.2, compress: 0.9, rigidity: 0.6, shatter: 1.7, kind: 'tissue' },
    { id: 'brain', name: 'Brain', color: '#e6a3b2', density: 1.04, stiffness: 0.45, stretch: 1.4, compress: 0.85, rigidity: 0.5, shatter: 0.6, kind: 'organ' },
    { id: 'heart', name: 'Heart', color: '#7d1626', density: 1.06, stiffness: 0.6, stretch: 1.1, compress: 0.85, rigidity: 0.75, shatter: 0.9, kind: 'organ' },
    { id: 'lung', name: 'Lungs', color: '#e48a96', density: 0.45, stiffness: 0.35, stretch: 1.2, compress: 0.9, rigidity: 0.5, shatter: 0.7, kind: 'organ' },
    { id: 'liver', name: 'Liver', color: '#6a2220', density: 1.06, stiffness: 0.4, stretch: 0.9, compress: 0.85, rigidity: 0.6, shatter: 0.7, kind: 'organ' },
    { id: 'stomach', name: 'Stomach', color: '#d88b7b', density: 1.0, stiffness: 0.5, stretch: 1.3, compress: 0.9, rigidity: 0.55, shatter: 0.8, kind: 'organ' },
    { id: 'intestine', name: 'Intestines', color: '#d7a08c', density: 1.0, stiffness: 0.45, stretch: 1.6, compress: 0.9, rigidity: 0.45, shatter: 0.8, kind: 'organ' },
    { id: 'kidney', name: 'Kidneys & spleen', color: '#81312f', density: 1.05, stiffness: 0.5, stretch: 1.0, compress: 0.85, rigidity: 0.6, shatter: 0.8, kind: 'organ' },
    { id: 'bladder', name: 'Bladder', color: '#d9b98a', density: 1.0, stiffness: 0.45, stretch: 1.3, compress: 0.9, rigidity: 0.5, shatter: 0.8, kind: 'organ' },
    // generic materials for molecular props
    { id: 'clay', name: 'Clay', color: '#c98b5d', density: 1.6, stiffness: 0.85, stretch: 0.35, compress: 0.5, rigidity: 0.8, shatter: 1.3, kind: 'material' },
    { id: 'stone', name: 'Stone', color: '#9b9a94', density: 2.5, stiffness: 1.0, stretch: 0.1, compress: 0.14, rigidity: 1.0, shatter: 1.8, kind: 'material' },
    { id: 'glass', name: 'Glass', color: '#9fd6e8', density: 2.2, stiffness: 1.0, stretch: 0.05, compress: 0.08, rigidity: 1.0, shatter: 0.8, kind: 'material' },
    { id: 'jelly', name: 'Jelly', color: '#56d38f', density: 1.0, stiffness: 0.3, stretch: 1.2, compress: 0.9, rigidity: 0.35, shatter: 3.0, kind: 'material' },
    { id: 'wood', name: 'Wood', color: '#b07a45', density: 0.7, stiffness: 1.0, stretch: 0.18, compress: 0.25, rigidity: 0.95, shatter: 1.8, kind: 'material' },
    { id: 'ice', name: 'Ice', color: '#cfeefc', density: 0.92, stiffness: 1.0, stretch: 0.07, compress: 0.1, rigidity: 1.0, shatter: 1.0, kind: 'material' },
    { id: 'rubber', name: 'Rubber', color: '#2c2c33', density: 1.2, stiffness: 0.6, stretch: 1.6, compress: 0.95, rigidity: 0.7, shatter: 5.0, kind: 'material' },
    // appended so saved scenes keep their material indices
    { id: 'tendon', name: 'Tendons', color: '#eceee6', density: 1.12, stiffness: 0.95, stretch: 2.3, compress: 0.9, rigidity: 0.8, shatter: 2.2, kind: 'tissue' },
  ];

  const T = {}; TISSUES.forEach((t, i) => { T[t.id] = i; });

  /* ---------------- small math ---------------- */
  function rx(a) { const c = Math.cos(a), s = Math.sin(a); return [1, 0, 0, 0, c, -s, 0, s, c]; }
  function ry(a) { const c = Math.cos(a), s = Math.sin(a); return [c, 0, s, 0, 1, 0, -s, 0, c]; }
  function rz(a) { const c = Math.cos(a), s = Math.sin(a); return [c, -s, 0, s, c, 0, 0, 0, 1]; }
  function mm(A, B) {
    const o = new Array(9);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) o[3 * i + j] = A[3 * i] * B[j] + A[3 * i + 1] * B[3 + j] + A[3 * i + 2] * B[6 + j];
    return o;
  }
  function mv(M, v) { return [M[0] * v[0] + M[1] * v[1] + M[2] * v[2], M[3] * v[0] + M[4] * v[1] + M[5] * v[2], M[6] * v[0] + M[7] * v[1] + M[8] * v[2]]; }
  function mtv(M, v) { return [M[0] * v[0] + M[3] * v[1] + M[6] * v[2], M[1] * v[0] + M[4] * v[1] + M[7] * v[2], M[2] * v[0] + M[5] * v[1] + M[8] * v[2]]; }
  const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const scl = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
  const len = (a) => Math.hypot(a[0], a[1], a[2]);
  const nrm = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
  const crs = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const cross = crs, dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const I3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  const D = Math.PI / 180;

  function mulberry(seed) {
    let a = seed >>> 0;
    return function () { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }

  /* ---------------- SDF primitives ---------------- */
  // Each primitive: {t, ...params, bc (bounding center), br (bounding radius)}
  function frameFrom(c, M) { return { c, M: M || I3 }; }
  function Ellipsoid(c, r, M) { return { t: 0, c, r, M: M || I3, bc: c, br: Math.max(r[0], r[1], r[2]) }; }
  function RoundCone(a, b, ra, rb) {
    const ba = sub(b, a), l2 = ba[0] * ba[0] + ba[1] * ba[1] + ba[2] * ba[2], l = Math.sqrt(l2);
    return { t: 1, a, b, ra, rb, ba, l2, rr: ra - rb, aa: l2 - (ra - rb) * (ra - rb), il2: 1 / l2, bc: scl(add(a, b), 0.5), br: l / 2 + Math.max(ra, rb) };
  }
  function Capsule(a, b, r) { const ba = sub(b, a); const l2 = ba[0] * ba[0] + ba[1] * ba[1] + ba[2] * ba[2]; return { t: 2, a, ba, l2, r, bc: scl(add(a, b), 0.5), br: Math.sqrt(l2) / 2 + r }; }
  function Box(c, h, M, rnd) { return { t: 3, c, h, M: M || I3, rnd: rnd || 0, bc: c, br: len(h) + (rnd || 0) }; }
  function Ring(c, a, b, r, M) { return { t: 4, c, a, b, r, M: M || I3, bc: c, br: Math.max(a, b) + r }; }
  function Shell(c, ro, ri, M) { return { t: 5, c, ro, ri, M: M || I3, bc: c, br: Math.max(ro[0], ro[1], ro[2]) }; }
  function Cyl(c, rx_, hy, rz_, M) { return { t: 6, c, rx: rx_, hy, rz: rz_, M: M || I3, bc: c, br: Math.hypot(Math.max(rx_, rz_), hy) }; }
  function Cone(c, R, hy, M) { return { t: 7, c, R, hy, M: M || I3, bc: c, br: Math.hypot(R, hy) }; }
  function Torus(c, R, r, M) { return { t: 8, c, R, r, M: M || I3, bc: c, br: R + r }; }

  function sdEll(px, py, pz, r) {
    const k0 = Math.sqrt((px / r[0]) ** 2 + (py / r[1]) ** 2 + (pz / r[2]) ** 2);
    const k1 = Math.sqrt((px / (r[0] * r[0])) ** 2 + (py / (r[1] * r[1])) ** 2 + (pz / (r[2] * r[2])) ** 2);
    return k1 < 1e-12 ? -Math.min(r[0], r[1], r[2]) : k0 * (k0 - 1) / k1;
  }
  function local(P, x, y, z) {
    const dx = x - P.c[0], dy = y - P.c[1], dz = z - P.c[2], M = P.M;
    return [M[0] * dx + M[3] * dy + M[6] * dz, M[1] * dx + M[4] * dy + M[7] * dz, M[2] * dx + M[5] * dy + M[8] * dz];
  }
  function sdPrim(P, x, y, z) {
    switch (P.t) {
      case 0: { const q = local(P, x, y, z); return sdEll(q[0], q[1], q[2], P.r); }
      case 1: { // round cone (iq)
        const pax = x - P.a[0], pay = y - P.a[1], paz = z - P.a[2];
        const ba = P.ba, l2 = P.l2;
        const yv = pax * ba[0] + pay * ba[1] + paz * ba[2];
        const zv = yv - l2;
        const qx = pax * l2 - ba[0] * yv, qy = pay * l2 - ba[1] * yv, qz = paz * l2 - ba[2] * yv;
        const x2 = qx * qx + qy * qy + qz * qz, y2 = yv * yv * l2, z2 = zv * zv * l2;
        const rr = P.rr, a2 = P.aa, il2 = P.il2;
        const k = Math.sign(rr) * rr * rr * x2;
        if (Math.sign(zv) * a2 * z2 > k) return Math.sqrt(x2 + z2) * il2 - P.rb;
        if (Math.sign(yv) * a2 * y2 < k) return Math.sqrt(x2 + y2) * il2 - P.ra;
        return (Math.sqrt(x2 * a2 * il2) + yv * rr) * il2 - P.ra;
      }
      case 2: {
        const pax = x - P.a[0], pay = y - P.a[1], paz = z - P.a[2];
        let h = (pax * P.ba[0] + pay * P.ba[1] + paz * P.ba[2]) / P.l2; h = h < 0 ? 0 : h > 1 ? 1 : h;
        return Math.hypot(pax - P.ba[0] * h, pay - P.ba[1] * h, paz - P.ba[2] * h) - P.r;
      }
      case 3: {
        const q = local(P, x, y, z), h = P.h, r = P.rnd;
        const ax = Math.abs(q[0]) - h[0] + r, ay = Math.abs(q[1]) - h[1] + r, az = Math.abs(q[2]) - h[2] + r;
        return Math.hypot(Math.max(ax, 0), Math.max(ay, 0), Math.max(az, 0)) + Math.min(Math.max(ax, ay, az), 0) - r;
      }
      case 4: { // elliptical ring in local xz plane
        const q = local(P, x, y, z);
        const ang = Math.atan2(q[2] / P.b, q[0] / P.a);
        const cx = P.a * Math.cos(ang), cz = P.b * Math.sin(ang);
        return Math.hypot(q[0] - cx, q[1], q[2] - cz) - P.r;
      }
      case 5: { const q = local(P, x, y, z); return Math.max(sdEll(q[0], q[1], q[2], P.ro), -sdEll(q[0], q[1], q[2], P.ri)); }
      case 6: {
        const q = local(P, x, y, z); const R = Math.min(P.rx, P.rz);
        const dr = Math.hypot(q[0] * R / P.rx, q[2] * R / P.rz) - R, dy = Math.abs(q[1]) - P.hy;
        return Math.min(Math.max(dr, dy), 0) + Math.hypot(Math.max(dr, 0), Math.max(dy, 0));
      }
      case 7: {
        const q = local(P, x, y, z);
        const qxz = Math.hypot(q[0], q[2]), h = P.hy, r1 = P.R;
        const k2x = -r1, k2y = 2 * h;
        const cax = qxz - Math.min(qxz, q[1] < 0 ? r1 : 0), cay = Math.abs(q[1]) - h;
        let t = ((-qxz) * k2x + (h - q[1]) * k2y) / (k2x * k2x + k2y * k2y); t = t < 0 ? 0 : t > 1 ? 1 : t;
        const cbx = qxz + k2x * t, cby = q[1] - h + k2y * t;
        const s = (cbx < 0 && cay < 0) ? -1 : 1;
        return s * Math.sqrt(Math.min(cax * cax + cay * cay, cbx * cbx + cby * cby));
      }
      case 8: { const q = local(P, x, y, z); return Math.hypot(Math.hypot(q[0], q[2]) - P.R, q[1]) - P.r; }
    }
    return 1e9;
  }

  // smooth-union set with bounding culling
  function SmoothSet(prims, k) { return { prims, k: k || 0 }; }
  function evalSet(S, x, y, z) {
    if (S.grid) {
      let d = sampleGrid(S.grid, x, y, z);
      // plugs blend in smoothly (a hard union leaves creases and slivers where an ellipsoid just grazes the lips)
      if (S.plugs) for (const P of S.plugs) {
        const e = sdPrim(P, x, y, z), k = P.k || 0;
        if (k > 0) { const h = Math.max(k - Math.abs(d - e), 0) / k; d = Math.min(d, e) - h * h * k * 0.25; } else if (e < d) d = e;
      }
      return d;
    }
    const ps = S.prims, k = S.k;
    let d = 1e9;
    for (let i = 0; i < ps.length; i++) {
      const P = ps[i];
      const kk = P.k != null ? P.k : k;
      const bx = x - P.bc[0], by = y - P.bc[1], bz = z - P.bc[2];
      const bd = Math.sqrt(bx * bx + by * by + bz * bz) - P.br;
      if (P.neg) { // carve (eye sockets, grooves): smooth subtraction
        if (bd > kk) continue;
        const e = -sdPrim(P, x, y, z), h = Math.max(kk - Math.abs(d - e), 0) / kk;
        d = Math.max(d, e) + h * h * kk * 0.25;
        continue;
      }
      if (bd > d + kk) continue;
      const e = sdPrim(P, x, y, z);
      if (kk > 0) {
        const h = Math.max(kk - Math.abs(d - e), 0) / kk;
        d = Math.min(d, e) - h * h * kk * 0.25;
      } else if (e < d) d = e;
    }
    if (S.cutY != null && S.cutY - y > d) d = S.cutY - y;
    return d;
  }

  /* ---------------- anatomical body (MakeHuman base mesh, CC0) ----------------
   * The mesh is posed with the same pose angles as the sculpt (linear blend skinning over 17 bones),
   * then turned into a signed distance grid so the rest of the builder can fill it with molecules. */
  let MHC = null;
  function mhData() {
    if (MHC) return MHC;
    const M = root.SB_MHBODY || (typeof require !== 'undefined' ? (() => { try { return require('./mhbody.js'); } catch (e) { return null; } })() : null);
    if (!M) return null;
    const dec = (b64, T) => { const bin = typeof atob !== 'undefined' ? atob(b64) : Buffer.from(b64, 'base64').toString('binary'); const u = new Uint8Array(bin.length); for (let i = 0; i < u.length; i++) u[i] = bin.charCodeAt(i); return new T(u.buffer); };
    const q = dec(M.pos, Int16Array), pos = new Float32Array(q.length); for (let i = 0; i < q.length; i++) pos[i] = q[i] * M.scale;
    MHC = { n: M.n, pos, idx: dec(M.idx, Uint16Array), bi: dec(M.bi, Uint8Array), bw: dec(M.bw, Uint8Array), bones: M.bones, joints: M.joints };
    return MHC;
  }
  function rotFromTo(a, b) { // smallest rotation taking unit vector a onto b
    const v = crs(a, b), c = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    if (c < -0.9999) { const ax = Math.abs(a[0]) < 0.9 ? nrm(crs(a, [1, 0, 0])) : nrm(crs(a, [0, 1, 0])); return [2 * ax[0] * ax[0] - 1, 2 * ax[0] * ax[1], 2 * ax[0] * ax[2], 2 * ax[1] * ax[0], 2 * ax[1] * ax[1] - 1, 2 * ax[1] * ax[2], 2 * ax[2] * ax[0], 2 * ax[2] * ax[1], 2 * ax[2] * ax[2] - 1]; }
    const k = 1 / (1 + c);
    return [v[0] * v[0] * k + c, v[0] * v[1] * k - v[2], v[0] * v[2] * k + v[1], v[1] * v[0] * k + v[2], v[1] * v[1] * k + c, v[1] * v[2] * k - v[0], v[2] * v[0] * k - v[1], v[2] * v[1] * k + v[0], v[2] * v[2] * k + c];
  }
  // rotation matrix (row-major 3x3) to unit quaternion [x, y, z, w]
  function matQuat(m) {
    const t = m[0] + m[4] + m[8]; let x, y, z, w;
    if (t > 0) { const S = Math.sqrt(t + 1) * 2; w = 0.25 * S; x = (m[7] - m[5]) / S; y = (m[2] - m[6]) / S; z = (m[3] - m[1]) / S; }
    else if (m[0] > m[4] && m[0] > m[8]) { const S = Math.sqrt(1 + m[0] - m[4] - m[8]) * 2; w = (m[7] - m[5]) / S; x = 0.25 * S; y = (m[1] + m[3]) / S; z = (m[2] + m[6]) / S; }
    else if (m[4] > m[8]) { const S = Math.sqrt(1 + m[4] - m[0] - m[8]) * 2; w = (m[2] - m[6]) / S; x = (m[1] + m[3]) / S; y = 0.25 * S; z = (m[5] + m[7]) / S; }
    else { const S = Math.sqrt(1 + m[8] - m[0] - m[4]) * 2; w = (m[3] - m[1]) / S; x = (m[2] + m[6]) / S; y = (m[5] + m[7]) / S; z = 0.25 * S; }
    const l = Math.hypot(x, y, z, w); return [x / l, y / l, z / l, w / l];
  }
  function dqApply(q, e, px, py, pz) {
    const [qx, qy, qz, qw] = q, [ex, ey, ez, ew] = e;
    const tx = 2 * (qy * pz - qz * py), ty = 2 * (qz * px - qx * pz), tz = 2 * (qx * py - qy * px);
    return [px + qw * tx + (qy * tz - qz * ty) + 2 * (-ew * qx + ex * qw - ey * qz + ez * qy),
      py + qw * ty + (qz * tx - qx * tz) + 2 * (-ew * qy + ey * qw - ez * qx + ex * qz),
      pz + qw * tz + (qx * ty - qy * tx) + 2 * (-ew * qz + ez * qw - ex * qy + ey * qx)];
  }
  function tr3(M) { return [M[0], M[3], M[6], M[1], M[4], M[7], M[2], M[5], M[8]]; }
  // humanoid segment tree: 0 head, 1 neck, 2 chest, 3 abdomen, 4 pelvis, 5-7 / 8-10 arm, 11-13 / 14-16 leg
  // then 15 finger bones per hand (thumb, index, middle, ring, little; three each, from the knuckle out): 17 + 15 L + 3 f + k
  const SEG_PARENT = [1, 2, 3, 4, -1, 2, 5, 6, 2, 8, 9, 4, 11, 12, 4, 14, 15];
  // and two shoulder girdles (collarbone and shoulder blade, 47 left / 48 right): they lift the top of the shoulder
  // when an arm goes up, so the turn is shared instead of all happening in the armpit
  const NSEG = 49, fingerSeg = (L, f, k) => 17 + L * 15 + f * 3 + k;
  for (let L = 0; L < 2; L++) for (let f = 0; f < 5; f++) for (let k = 0; k < 3; k++) SEG_PARENT.push(k === 0 ? 7 + 3 * L : fingerSeg(L, f, k - 1));
  SEG_PARENT.push(2, 2);
  // forward kinematics parents: the arm hangs from its girdle
  const FK_PARENT = SEG_PARENT.slice(); FK_PARENT[5] = 47; FK_PARENT[8] = 48;
  // the body segment a bone belongs to for the solver: fingers to their hand, girdles to the chest
  const segBody = (s) => s < 17 ? s : s < 47 ? 7 + 3 * Math.floor((s - 17) / 15) : 2;
  // girdle pivot (MakeHuman units): near the top of the breastbone on that side
  const CREASE_IT = +((typeof globalThis !== 'undefined' && globalThis.SB_CREASE) || 30);
  const girdleC = (S0) => [S0[0] * 0.2, S0[1] - 0.02, S0[2]];
  // collarbone turn (degrees, + lifts) for an arm raised ab degrees: it lifts past about 66 degrees and settles
  // a little when the arm hangs, so the deltoid rounds over instead of standing up as a square pad
  const girdleA = (ab) => ab > 66 ? (ab - 66) * 0.36 : -Math.max(0, 42 - ab) * 0.3;
  function rotAxis(a, t) {
    const c = Math.cos(t), s = Math.sin(t), C = 1 - c, [x, y, z] = a;
    return [c + x * x * C, x * y * C - z * s, x * z * C + y * s, y * x * C + z * s, c + y * y * C, y * z * C - x * s, z * x * C - y * s, z * y * C + x * s, c + z * z * C];
  }
  // finger bones of one hand: rest joints, bend axes (toward the palm) and how far each bends in a fist
  const FIST = [[28, 30, 40], [78, 95, 62], [82, 98, 64], [84, 96, 62], [86, 92, 58]];
  function handRig(MH, L) {
    const J = MH.joints, sd = L === 0 ? 'l' : 'r';
    if (!J[sd + '-finger-1-1']) return null;
    const fj = (f, k) => J[sd + '-finger-' + (f + 1) + '-' + (k + 1)];
    let pn = nrm(cross(sub(fj(1, 0), fj(4, 0)), sub(fj(2, 0), J[sd + '-hand'])));
    const d3 = nrm(sub(fj(2, 1), fj(2, 0))), t3 = sub(fj(2, 3), fj(2, 0));
    const perp = sub(t3, scl(d3, dot(t3, d3)));
    // the base mesh's fingers bow back a little at rest, so the palm is on the side away from that bow
    if (dot(perp, pn) > 0) pn = scl(pn, -1);
    const fingers = [];
    for (let f = 0; f < 5; f++) {
      const bones = [];
      for (let k = 0; k < 3; k++) { const a = fj(f, k), b = fj(f, k + 1), d = nrm(sub(b, a)); bones.push({ a, b, axis: nrm(cross(d, pn)) }); }
      fingers.push(bones);
    }
    return { pn, fingers, knuckle: scl(add(add(fj(1, 0), fj(2, 0)), add(fj(3, 0), fj(4, 0))), 0.25) };
  }
  // finger bones posed below a hand bone (rotation Gh, rest pivot W0, posed pivot Wp); curl 0..1 makes a fist
  function poseFingers(MH, L, Gh, W0, Wp, curl, set) {
    const HR = handRig(MH, L); if (!HR) return null;
    const lines = [];
    for (let f = 0; f < 5; f++) {
      let Gp = Gh, P0p = W0, P1p = Wp;
      for (let k = 0; k < 3; k++) {
        const B = HR.fingers[f][k], s = fingerSeg(L, f, k);
        const p1 = add(P1p, mv(Gp, sub(B.a, P0p)));
        const G = curl ? mm(Gp, rotAxis(B.axis, curl * FIST[f][k] * D)) : Gp;
        set(s, G, B.a, p1);
        lines.push({ seg: s, a: p1, b: add(p1, mv(G, sub(B.b, B.a))) });
        Gp = G; P0p = B.a; P1p = p1;
      }
    }
    return { lines, knuckle: add(Wp, mv(Gh, sub(HR.knuckle, W0))) };
  }
  /* the skeleton in a pose: per bone a rotation G and pivots (p' = G (p - P0) + P1), in MakeHuman units.
   * Same joint model as mhHumanoid (without the skin-only shoulder girdle). Used to animate built bodies. */
  function rigPose(pose, MH) {
    pose = Object.assign({}, POSES.stand, pose || {});
    const Bn = (k) => MH.bones[k], J = MH.joints;
    const dir = (k) => nrm(sub(Bn(k)[1], Bn(k)[0]));
    const W = [0, 1.08, 0];
    const tw = (pose.twist || 0) * D;
    const Rs = mm(ry(tw), rx(-(pose.spine || 0) * D)), Rs2 = mm(ry(tw * 0.5), rx(-(pose.spine || 0) * D * 0.5));
    const up = (p) => add(W, mv(Rs, sub(p, W)));
    const N0 = J.neck, Np = up(N0);
    const Rh = mm(Rs, mm(ry((pose.head[0] || 0) * D), rx(-(pose.head[1] || 0) * D)));
    const G = [], P0 = [], P1 = [];
    const set = (b, g, p0, p1) => { G[b] = g; P0[b] = p0; P1[b] = p1; };
    set(4, I3, W, W); set(3, Rs2, W, W); set(2, Rs, W, W); set(1, Rs, W, W); set(0, Rh, N0, Np);
    for (const side of [1, -1]) {
      const L = side === 1 ? 0 : 1, ua = 5 + 3 * L, fa = 6 + 3 * L, hb = 7 + 3 * L;
      const [ab, fl] = pose.sh[L];
      const Rsh = mm(Rs, mm(rx(-fl * D), rz(side * ab * D)));
      const Rel = mm(Rsh, rx(-pose.el[L] * D));
      const S0 = Bn(ua)[0], E0 = Bn(fa)[0], W0 = Bn(hb)[0];
      const ga = girdleA(ab), Cg = girdleC(S0), Rg = rz(side * ga * D);
      const Sp = up(add(Cg, mv(Rg, sub(S0, Cg))));
      set(47 + L, mm(Rs, Rg), Cg, up(Cg));
      const Gu = mm(Rsh, tr3(rotFromTo([0, -1, 0], dir(ua))));
      const Ep = add(Sp, mv(Gu, sub(E0, S0)));
      const Gf = mm(Rel, tr3(rotFromTo([0, -1, 0], dir(fa))));
      const Wp = add(Ep, mv(Gf, sub(W0, E0)));
      set(ua, Gu, S0, Sp); set(fa, Gf, E0, Ep); set(hb, Gf, W0, Wp);
      poseFingers(MH, L, Gf, W0, Wp, pose.fist ? pose.fist[L] || 0 : 0, set);
      const th = 11 + 3 * L, sh = 12 + 3 * L, ft = 13 + 3 * L;
      const [hf, ha] = pose.hip[L];
      const Rhip = mm(rx(-hf * D), rz(side * ha * D)), Rkn = mm(Rhip, rx(pose.kn[L] * D));
      const Rft = mm(Rkn, rx(-pose.kn[L] * D * 0.6 + hf * D * 0.15 + (pose.ft ? pose.ft[L] : 0) * D));
      const H0 = Bn(th)[0], K0 = Bn(sh)[0], A0 = Bn(ft)[0];
      const Gt = mm(Rhip, tr3(rotFromTo([0, -1, 0], dir(th))));
      const Kp = add(H0, mv(Gt, sub(K0, H0)));
      const Rrs = tr3(rotFromTo([0, -1, 0], dir(sh)));
      const Gs = mm(Rkn, Rrs);
      const Ap = add(Kp, mv(Gs, sub(A0, K0)));
      const Gft = mm(Rft, Rrs);
      set(th, Gt, H0, H0); set(sh, Gs, K0, Kp); set(ft, Gft, A0, Ap);
    }
    return { G, P0, P1 };
  }
  function mhHumanoid(opts, MH) {
    const H = (opts.height || 1.8) / 1.8;
    const build = opts.build != null ? opts.build : 0.5, fatL = opts.fat != null ? opts.fat : 0.35;
    const s = opts.spacing;
    const pose = Object.assign({}, POSES.stand, poseByName(opts.pose) || {});
    const Bn = (k) => MH.bones[k], J = MH.joints;
    const dir = (k) => nrm(sub(Bn(k)[1], Bn(k)[0]));
    const W = [0, 1.08, 0];
    const Rs = rx(-(pose.spine || 0) * D), Rs2 = rx(-(pose.spine || 0) * D * 0.5);
    const up = (p) => add(W, mv(Rs, sub(p, W)));
    const N0 = J.neck, Np = up(N0);
    const Rh = mm(Rs, mm(ry((pose.head[0] || 0) * D), rx(-(pose.head[1] || 0) * D)));
    // per bone: rotation G, rest pivot P0, posed pivot P1   (p' = G (p - P0) + P1)
    const G = [], P0 = [], P1 = [];
    const set = (b, g, p0, p1) => { G[b] = g; P0[b] = p0; P1[b] = p1; };
    set(4, I3, W, W); set(3, Rs2, W, W); set(2, Rs, W, W); set(1, Rs, W, W);
    set(0, Rh, N0, Np);
    const segs = [], posedJ = {}, gird = [];
    for (const side of [1, -1]) {
      const L = side === 1 ? 0 : 1, ua = 5 + 3 * L, fa = 6 + 3 * L, hb = 7 + 3 * L;
      const [ab, fl] = pose.sh[L];
      const Rsh = mm(Rs, mm(rx(-fl * D), rz(side * ab * D)));
      const Rel = mm(Rsh, rx(-pose.el[L] * D));
      const S0 = Bn(ua)[0], E0 = Bn(fa)[0], W0 = Bn(hb)[0];
      // shoulder girdle: raising an arm past about 70 degrees also lifts and turns the collarbone and shoulder
      // blade, so part of the turn happens at the base of the neck and the shoulder skin is not wrung around one joint
      const ga = girdleA(ab), Cg = girdleC(S0), Rg = rz(side * ga * D);
      const Sp = up(add(Cg, mv(Rg, sub(S0, Cg))));
      gird[L] = { R: Rg, C: Cg, S0, ga, on: Math.abs(ga) > 0.5, up: ga > 0.5, down: ga < -0.5 };
      const Gu = mm(Rsh, tr3(rotFromTo([0, -1, 0], dir(ua))));
      const Ep = add(Sp, mv(Gu, sub(E0, S0)));
      const Gf = mm(Rel, tr3(rotFromTo([0, -1, 0], dir(fa))));
      const Wp = add(Ep, mv(Gf, sub(W0, E0)));
      set(ua, Gu, S0, Sp); set(fa, Gf, E0, Ep); set(hb, Gf, W0, Wp);
      // with finger bones the hand itself is the palm (wrist to knuckles) and each finger has its own three bones
      const FG = opts.fingers === false ? null : poseFingers(MH, L, Gf, W0, Wp, 0, () => {});
      segs.push({ seg: ua, a: Sp, b: Ep }, { seg: fa, a: Ep, b: Wp }, { seg: hb, a: Wp, b: FG ? FG.knuckle : add(Wp, mv(Gf, sub(Bn(hb)[1], W0))) });
      if (FG) segs.push(...FG.lines);
      posedJ['S' + L] = Sp;
      const th = 11 + 3 * L, sh = 12 + 3 * L, ft = 13 + 3 * L;
      const [hf, ha] = pose.hip[L];
      const Rhip = mm(rx(-hf * D), rz(side * ha * D)), Rkn = mm(Rhip, rx(pose.kn[L] * D));
      const Rft = mm(Rkn, rx(-pose.kn[L] * D * 0.6 + hf * D * 0.15));
      const H0 = Bn(th)[0], K0 = Bn(sh)[0], A0 = Bn(ft)[0];
      const Gt = mm(Rhip, tr3(rotFromTo([0, -1, 0], dir(th))));
      const Kp = add(H0, mv(Gt, sub(K0, H0)));
      const Rrs = tr3(rotFromTo([0, -1, 0], dir(sh)));
      const Gs = mm(Rkn, Rrs);
      const Ap = add(Kp, mv(Gs, sub(A0, K0)));
      const Gft = mm(Rft, Rrs);
      set(th, Gt, H0, H0); set(sh, Gs, K0, Kp); set(ft, Gft, A0, Ap);
      segs.push({ seg: th, a: H0, b: Kp }, { seg: sh, a: Kp, b: Ap }, { seg: ft, a: Ap, b: add(Ap, mv(Gft, sub(Bn(ft)[1], A0))) });
      posedJ['H' + L] = H0;
    }
    const hsS = opts.headScale || 1;
    segs.push({ seg: 0, a: mv(Rh, scl(sub(Bn(0)[0], N0), hsS)).map((v, i) => v + Np[i]), b: mv(Rh, scl(sub(Bn(0)[1], N0), hsS)).map((v, i) => v + Np[i]) });
    segs.push({ seg: 1, a: up(Bn(1)[0]), b: add(Np, mv(Rh, sub(Bn(1)[1], N0))) });
    segs.push({ seg: 2, a: up(Bn(2)[0]), b: up(Bn(2)[1]) }, { seg: 2, a: posedJ.S1, b: posedJ.S0 });
    segs.push({ seg: 3, a: add(W, mv(Rs2, sub(Bn(3)[0], W))), b: add(W, mv(Rs2, sub(Bn(3)[1], W))) });
    segs.push({ seg: 4, a: posedJ.H1, b: posedJ.H0 }, { seg: 4, a: Bn(4)[0], b: Bn(4)[1] });
    // skin the mesh
    // dual-quaternion skinning: blending rotations instead of positions keeps the volume where bones turn a lot
    // (plain linear blending collapsed and flared the shoulders when the arms go up over the head)
    const n = MH.n, out = new Float32Array(3 * n);
    // a child's head is bigger for its body: head vertices scale about the base of the neck before posing
    const hs = opts.headScale || 1;
    let src = MH.pos;
    if (Math.abs(hs - 1) > 1e-3) {
      src = new Float32Array(MH.pos);
      for (let v = 0; v < n; v++) {
        let w = 0; for (let k = 0; k < 4; k++) { const bi = MH.bi[4 * v + k], bw = MH.bw[4 * v + k] / 255; if (bi === 0) w += bw; else if (bi === 1) w += bw * 0.5; }
        if (w <= 0) continue;
        const f = 1 + (hs - 1) * w;
        for (let k = 0; k < 3; k++) src[3 * v + k] = N0[k] + (src[3 * v + k] - N0[k]) * f;
      }
    }
    const DQ = [];
    for (let b = 0; b < G.length; b++) {
      if (!G[b]) continue;
      const q = matQuat(G[b]), a = P0[b], c = P1[b], ga = mv(G[b], a), t = [c[0] - ga[0], c[1] - ga[1], c[2] - ga[2]];
      // dual part = 0.5 * t * q   (quaternions as [x, y, z, w])
      const d = [0.5 * (t[0] * q[3] + t[1] * q[2] - t[2] * q[1]), 0.5 * (-t[0] * q[2] + t[1] * q[3] + t[2] * q[0]), 0.5 * (t[0] * q[1] - t[1] * q[0] + t[2] * q[3]), -0.5 * (t[0] * q[0] + t[1] * q[1] + t[2] * q[2])];
      DQ[b] = [q, d];
    }
    const mkDQ = (Rm, t) => { const q = matQuat(Rm); return [q, [0.5 * (t[0] * q[3] + t[1] * q[2] - t[2] * q[1]), 0.5 * (-t[0] * q[2] + t[1] * q[3] + t[2] * q[0]), 0.5 * (t[0] * q[1] - t[1] * q[0] + t[2] * q[3]), -0.5 * (t[0] * q[0] + t[1] * q[1] + t[2] * q[2])]]; };
    // chest skin near a raised shoulder follows the girdle: p' = W + Rs (C + Rg (p - C) - W)
    const GD = gird.map(g => { if (!g.on) return null; const M = mm(Rs, g.R), mc = mv(M, g.C), rc = mv(Rs, sub(g.C, W)); return mkDQ(M, [W[0] + rc[0] - mc[0], W[1] + rc[1] - mc[1], W[2] + rc[2] - mc[2]]); });
    const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
    const MODE = (typeof globalThis !== 'undefined' && globalThis.SB_SKIN) || 'dqs';
    const relax = new Float32Array(n), crease = new Float32Array(n);
    for (let v = 0; v < n; v++) {
      const px = src[3 * v], py = src[3 * v + 1], pz = src[3 * v + 2];
      // this vertex's influences as [dual quaternion, weight]
      const inf = [];
      for (let k = 0; k < 4; k++) {
        const w = MH.bw[4 * v + k] / 255; if (!w) continue;
        const bi = MH.bi[4 * v + k]; let D = DQ[bi]; if (!D) continue;
        if (bi === 2 && (GD[0] || GD[1])) {
          // chest skin near a raised shoulder rides with the girdle
          const Ls = px * gird[0].S0[0] > 0 ? 0 : 1, gq = GD[Ls];
          if (gq) {
            const S0 = gird[Ls].S0, gw = 1 - smooth(0.08, 0.2, Math.hypot(px - S0[0], py - S0[1], pz - S0[2]));
            if (gw > 0) { const sg = (gq[0][0] * D[0][0] + gq[0][1] * D[0][1] + gq[0][2] * D[0][2] + gq[0][3] * D[0][3]) < 0 ? -1 : 1; D = [D[0].map((x, m) => x * (1 - gw) + sg * gw * gq[0][m]), D[1].map((x, m) => x * (1 - gw) + sg * gw * gq[1][m])]; }
          }
        }
        inf.push([D, w, bi]);
      }
      // a highly raised arm: around the shoulder, skin outside the joint goes with the arm and skin inside it with
      // the trunk, joined by a short fold (MakeHuman's smooth weights swing the shoulder skin out into a web)
      for (let Ls = 0; Ls < 2; Ls++) {
        const g = gird[Ls]; if (!g || !g.up) continue;
        const ua = 5 + 3 * Ls, S0 = g.S0, sd = Math.sign(S0[0]);
        if (px * sd <= 0) continue;
        const reg = 1 - smooth(0.24, 0.4, Math.hypot(px - S0[0], py - S0[1], pz - S0[2]));
        if (!inf.length || !inf.every(f => f[1] < 0.03 || f[2] === ua || f[2] === 1 || f[2] === 2 || f[2] === 3)) continue;
        let wt = 0, wa = 0; for (const f of inf) { wt += f[1]; if (f[2] === ua) wa += f[1]; }
        if (wt <= 0) continue;
        const aMH = wa / wt, aGeo = smooth(-0.035, 0.025, (px - S0[0]) * sd + Math.max(0, py - S0[1]) * 0.35);
        const a = aMH * (1 - reg) + aGeo * reg;
        relax[v] = a > 0.01 && a < 0.99 ? Math.max(0.6, reg) : 0.8 * (1 - smooth(0.1, 0.2, Math.hypot(px - S0[0], py - S0[1], pz - S0[2])));
        for (const f of inf) f[1] = f[2] === ua ? 0 : f[1] / wt * (1 - a);
        if (a > 0) inf.push([DQ[ua], a, ua]);
        break;
      }
      // a hanging arm: the skin where the deltoid meets the chest and back is pinched into a crease by the
      // arm's turn; mark it (by how evenly it is shared between arm and trunk) for smoothing after skinning
      for (let Ls = 0; Ls < 2; Ls++) {
        const g = gird[Ls]; if (!g || !g.down) continue;
        const ua = 5 + 3 * Ls, S0 = g.S0;
        if (px * Math.sign(S0[0]) <= 0) continue;
        const dS = Math.hypot(px - S0[0], py - S0[1], pz - S0[2]); if (dS > 0.2) continue;
        let wt = 0, wa = 0; for (const f of inf) { wt += f[1]; if (f[2] === ua || f[2] === ua + 1) wa += f[1]; }
        if (wt <= 0) continue;
        const a = wa / wt, mix = Math.min(1, 4 * a * (1 - a) * 1.6);
        crease[v] = mix * (1 - smooth(0.1, 0.2, dS)) * Math.min(1, -g.ga / 6);
      }
      let o0 = 0, o1 = 0, o2 = 0;
      if (MODE === 'lbs') {
        let lw = 0;
        for (const [D, w] of inf) { if (!w) continue; const o3 = dqApply(D[0], D[1], px, py, pz); o0 += w * o3[0]; o1 += w * o3[1]; o2 += w * o3[2]; lw += w; }
        if (lw > 0) { o0 /= lw; o1 /= lw; o2 /= lw; } else { o0 = px; o1 = py; o2 = pz; }
      } else {
        const r = [0, 0, 0, 0], e = [0, 0, 0, 0]; let q0 = null;
        for (const [D, w] of inf) {
          if (!w) continue;
          if (!q0) q0 = D[0];
          const sg = (D[0][0] * q0[0] + D[0][1] * q0[1] + D[0][2] * q0[2] + D[0][3] * q0[3]) < 0 ? -w : w;
          for (let m = 0; m < 4; m++) { r[m] += sg * D[0][m]; e[m] += sg * D[1][m]; }
        }
        const ln = Math.hypot(r[0], r[1], r[2], r[3]);
        if (ln > 1e-9) { for (let m = 0; m < 4; m++) { r[m] /= ln; e[m] /= ln; } [o0, o1, o2] = dqApply(r, e, px, py, pz); } else { o0 = px; o1 = py; o2 = pz; }
      }
      out[3 * v] = o0 * H; out[3 * v + 1] = o1 * H; out[3 * v + 2] = o2 * H;
    }
    // the skin bridging a raised arm and the trunk is stretched into a web: relax it toward a tight, smooth
    // surface (each such vertex moves toward the middle of its neighbours) so it folds into an armpit
    if (relax.some(x => x > 0)) {
      const I = MH.idx, nb = new Map();
      const addN = (a, b) => { if (!relax[a]) return; let l = nb.get(a); if (!l) nb.set(a, l = new Set()); l.add(b); };
      for (let t = 0; t < I.length; t += 3) { const a = I[t], b = I[t + 1], c = I[t + 2]; addN(a, b); addN(a, c); addN(b, a); addN(b, c); addN(c, a); addN(c, b); }
      const vs = [...nb.keys()], ls = vs.map(v => [...nb.get(v)]), tmp = new Float32Array(3 * vs.length);
      const RI = 80;
      for (let it = 0; it < RI; it++) {
        for (let q = 0; q < vs.length; q++) { const l = ls[q]; let x = 0, y = 0, z = 0; for (const u of l) { x += out[3 * u]; y += out[3 * u + 1]; z += out[3 * u + 2]; } tmp[3 * q] = x / l.length; tmp[3 * q + 1] = y / l.length; tmp[3 * q + 2] = z / l.length; }
        for (let q = 0; q < vs.length; q++) { const v = vs[q], k = 0.6 * relax[v]; for (let m = 0; m < 3; m++) out[3 * v + m] += (tmp[3 * q + m] - out[3 * v + m]) * k; }
      }
    }
    // smooth the marked shoulder crease, Taubin style (alternate shrink and inflate) so the shoulder keeps its volume
    if (crease.some(x => x > 0)) {
      const I = MH.idx, nb = new Map();
      const addN = (a, b) => { if (!crease[a]) return; let l = nb.get(a); if (!l) nb.set(a, l = new Set()); l.add(b); };
      for (let t = 0; t < I.length; t += 3) { const a = I[t], b = I[t + 1], c = I[t + 2]; addN(a, b); addN(a, c); addN(b, a); addN(b, c); addN(c, a); addN(c, b); }
      const vs = [...nb.keys()], ls = vs.map(v => [...nb.get(v)]), tmp = new Float32Array(3 * vs.length);
      for (let it = 0; it < 2 * CREASE_IT; it++) {
        const lam = it & 1 ? -0.53 : 0.5;
        for (let q = 0; q < vs.length; q++) { const l = ls[q]; let x = 0, y = 0, z = 0; for (const u of l) { x += out[3 * u]; y += out[3 * u + 1]; z += out[3 * u + 2]; } tmp[3 * q] = x / l.length; tmp[3 * q + 1] = y / l.length; tmp[3 * q + 2] = z / l.length; }
        for (let q = 0; q < vs.length; q++) { const v = vs[q], k = lam * crease[v]; for (let m = 0; m < 3; m++) out[3 * v + m] += (tmp[3 * q + m] - out[3 * v + m]) * k; }
      }
    }
    // body type: a little fuller or leaner along the surface normal (hands, feet and head barely change)
    const idx = MH.idx, nor = new Float32Array(3 * n);
    for (let t = 0; t < idx.length; t += 3) {
      const a = idx[t], b = idx[t + 1], c = idx[t + 2];
      const ux = out[3 * b] - out[3 * a], uy = out[3 * b + 1] - out[3 * a + 1], uz = out[3 * b + 2] - out[3 * a + 2];
      const wx = out[3 * c] - out[3 * a], wy = out[3 * c + 1] - out[3 * a + 1], wz = out[3 * c + 2] - out[3 * a + 2];
      const cx = uy * wz - uz * wy, cy = uz * wx - ux * wz, cz = ux * wy - uy * wx;
      for (const q of [a, b, c]) { nor[3 * q] += cx; nor[3 * q + 1] += cy; nor[3 * q + 2] += cz; }
    }
    const inflate = H * ((fatL - 0.2) * 0.028 + (build - 0.6) * 0.014);
    // per vertex: hands, feet and the head hardly fill out (a heavy build pushed the face 13 mm along its normals:
    // bulbous nose, swollen lips, crumpled eyes)
    const infAt = (v) => {
      const b = MH.bi[4 * v], ext = (b === 0 || b === 7 || b === 10 || b === 13 || b === 16) ? 0.25 : 1;
      let e = inflate * ext;
      const hw = Math.min(1, Math.max(0, (MH.pos[3 * v + 1] - 1.5) / 0.06));
      if (hw > 0 && e > 0.0035 * H) e += (0.0035 * H - e) * hw;
      return e;
    };
    if (Math.abs(inflate) > 1e-5) for (let v = 0; v < n; v++) {
      const l = Math.hypot(nor[3 * v], nor[3 * v + 1], nor[3 * v + 2]) || 1, e = infAt(v);
      for (let k = 0; k < 3; k++) out[3 * v + k] += nor[3 * v + k] / l * e;
    }
    // lips and eyelids are folded thinner than the lattice: a slight swell there keeps them closed (a lean build
    // otherwise leaves pits at the mouth corners and eye slits)
    {
      const need = 0.0028 * H;
      for (let v = 0; v < n; v++) {
        const y = MH.pos[3 * v + 1]; if (y < 1.5) continue;
        const w = Math.min(1, (y - 1.5) / 0.05);
        const extra = Math.max(0, need - (Math.abs(inflate) > 1e-5 ? infAt(v) : 0)) * w;
        if (extra < 1e-6) continue;
        const l = Math.hypot(nor[3 * v], nor[3 * v + 1], nor[3 * v + 2]) || 1;
        for (let k = 0; k < 3; k++) out[3 * v + k] += nor[3 * v + k] / l * extra;
      }
    }
    // heavier builds carry it on the belly, hips and thighs
    const belly = Math.max(0, fatL - 0.4) * 0.16 * H;
    if (belly > 1e-4) for (let v = 0; v < n; v++) {
      const b = MH.bi[4 * v]; if (b !== 2 && b !== 3 && b !== 4 && b !== 11 && b !== 14) continue;
      const x = MH.pos[3 * v], y = MH.pos[3 * v + 1], z = MH.pos[3 * v + 2];
      const g = Math.exp(-(x * x / 0.03 + (y - 1.04) * (y - 1.04) / 0.018)) * (z > -0.02 ? 1 : 0.35) + 0.45 * Math.exp(-((y - 0.88) * (y - 0.88)) / 0.01) * (Math.abs(x) > 0.05 ? 1 : 0.6);
      if (g < 0.01) continue;
      const l = Math.hypot(nor[3 * v], nor[3 * v + 1], nor[3 * v + 2]) || 1;
      for (let k = 0; k < 3; k++) out[3 * v + k] += nor[3 * v + k] / l * belly * g;
    }
    // the band reaches deeper than skin + fat, or a heavy build would be fat all the way through
    const grid = meshSDF(out, idx, Math.max(0.0032, s * 0.4), Math.max((2.6 + fatL) * s, 0.012));
    // organs, as in the sculpt (soft, inside the trunk)
    const fm = 1 + fatL * 0.12, ellU = (c, r, M) => Ellipsoid(up(c), r, mm(Rs, M || I3));
    const organs = [];
    organs.push({ t: T.heart, set: SmoothSet([ellU([0.022, 1.29, 0.035], [0.046, 0.056, 0.044], rz(-25 * D))]) });
    organs.push({ t: T.lung, set: SmoothSet([ellU([0.068, 1.33, -0.015], [0.058, 0.1, 0.062]), ellU([-0.068, 1.33, -0.015], [0.058, 0.1, 0.062])]) });
    organs.push({ t: T.liver, set: SmoothSet([ellU([-0.045, 1.175, 0.012], [0.09, 0.045, 0.062], rz(12 * D))]) });
    organs.push({ t: T.stomach, set: SmoothSet([ellU([0.06, 1.17, 0.025], [0.05, 0.042, 0.042], rz(-30 * D))]) });
    organs.push({ t: T.kidney, set: SmoothSet([ellU([0.058, 1.1, -0.016], [0.025, 0.046, 0.021]), ellU([-0.058, 1.1, -0.016], [0.025, 0.046, 0.021])]) });
    organs.push({ t: T.intestine, set: SmoothSet([Ellipsoid([0, 1.035, 0.018], [0.1 * fm, 0.07, 0.06 * fm])]) });
    organs.push({ t: T.bladder, set: SmoothSet([Ellipsoid([0, 0.925, 0.04], [0.03, 0.028, 0.028])]) });
    const sc = (p) => scl(p, H);
    const scaleE = (P) => Object.assign({}, P, { c: sc(P.c), bc: sc(P.bc), br: P.br * H, r: sc(P.r) });
    return {
      kind: 'humanoid', skin: { grid, prims: [], plugs: [[0, 1.603, 0.13, 0.028, 0.0095, 0.024], [0, 1.615, 0.095, 0.042, 0.04, 0.055], [0, 1.655, 0.12, 0.018, 0.02, 0.03], [0.03, 1.688, 0.131, 0.0165, 0.011, 0.016], [-0.03, 1.688, 0.131, 0.0165, 0.011, 0.016]].map(a => {
        // the mouth opening and the eye sockets are filled: in the mesh they lead into thin hollows
        const c = add(Np, mv(Rh, scl(sub([a[0], a[1], a[2]], N0), hs)));
        return Object.assign(Ellipsoid(sc(c), [a[3] * H * hs, a[4] * H * hs, a[5] * H * hs], Rh), { k: 0.006 * H });
      }) }, bone: SmoothSet([], 0), cart: SmoothSet([], 0),
      organs: organs.map(o => ({ t: o.t, set: SmoothSet(o.set.prims.map(scaleE), 0) })),
      segs: segs.map(g => ({ seg: g.seg, a: sc(g.a), b: sc(g.b) })), nseg: NSEG,
      fatT: (0.6 + 1.0 * fatL) * s, skinT: 0.55 * s,
      bbox: grid.bbox, feetSegs: [13, 16], mesh: { pos: out, idx },
    };
  }
  /* ---------------- quadrupeds (dog, horse) ----------------
   * Sculpted from smooth-unioned round cones and ellipsoids, facing +Z, with a skeleton inside and organs in
   * the trunk. Uses the same 17 segment slots as a humanoid so the solver treats them alike:
   * 0 head, 1 neck, 2 chest, 3 belly, 4 hips + tail, 5-7 / 8-10 front legs (upper, lower, paw), 11-13 / 14-16 hind legs. */
  const QUAD = {
    dog: { h: 0.62, len: 0.9, chest: [0.11, 0.14, 0.17], belly: [0.092, 0.11, 0.17], hip: [0.097, 0.118, 0.12], legX: 0.085, neckL: 0.2, neckR: [0.085, 0.065], neckUp: 0.62, head: [0.085, 0.085, 0.105], muzzle: [0.13, 0.055, 0.034], ears: 1, tail: [0.3, 0.032, 0.014], leg: [0.058, 0.04, 0.033, 0.03], thigh: [0.075, 0.046, 0.033, 0.028], paw: [0.036, 0.03, 0.052], hoof: 0 },
    horse: { h: 1.6, len: 2.25, chest: [0.3, 0.36, 0.46], belly: [0.3, 0.34, 0.5], hip: [0.29, 0.33, 0.38], legX: 0.17, neckL: 0.64, neckR: [0.26, 0.14], neckUp: 0.74, head: [0.12, 0.14, 0.19], muzzle: [0.4, 0.11, 0.085], ears: 1, tail: [0.8, 0.095, 0.05], leg: [0.13, 0.075, 0.058, 0.05], thigh: [0.2, 0.1, 0.065, 0.052], paw: [0.068, 0.05, 0.078], hoof: 1 },
  };
  function quadruped(opts) {
    const sp = opts.species === 'horse' ? 'horse' : 'dog', Q = QUAD[sp];
    const K = (opts.height || Q.h) / Q.h, s = opts.spacing;
    const fatL = opts.fat != null ? opts.fat : 0.3, fm = 1 + fatL * 0.15;
    const skin = [], bone = [], organs = [], segs = [];
    const P = (v) => [v[0] * K, v[1] * K, v[2] * K];
    const RC = (a, b, ra, rb, k) => Object.assign(RoundCone(P(a), P(b), ra * K, rb * K), { k: (k || 0.04) * K });
    const EL = (c, r, M, k) => Object.assign(Ellipsoid(P(c), [r[0] * K, r[1] * K, r[2] * K], M), { k: (k || 0.04) * K });
    const seg = (i, a, b) => segs.push({ seg: i, a: P(a), b: P(b) });
    const L = Q.len, H = Q.h;
    // trunk: shoulders a little above the hips line, belly slung between
    const yS = H - Q.chest[1] * 0.55, yB = yS - Q.chest[1] * 0.08, zC = L * 0.27, zB = 0, zH = -L * 0.25;
    skin.push(EL([0, yS, zC], [Q.chest[0] * fm, Q.chest[1], Q.chest[2]], null, 0.12));
    skin.push(EL([0, yB, zB], [Q.belly[0] * fm, Q.belly[1] * (0.95 + fatL * 0.1), Q.belly[2]], null, 0.14));
    skin.push(EL([0, yS - Q.hip[1] * 0.05, zH], [Q.hip[0] * fm, Q.hip[1], Q.hip[2]], null, 0.12));
    // neck and head
    const nA = [0, yS + Q.chest[1] * 0.25, zC + Q.chest[2] * 0.55];
    const nB = [0, nA[1] + Q.neckL * Math.sin(Q.neckUp), nA[2] + Q.neckL * Math.cos(Q.neckUp)];
    skin.push(RC(nA, nB, Q.neckR[0], Q.neckR[1], 0.06));
    const hc = [0, nB[1] + Q.head[1] * 0.3, nB[2] + Q.head[2] * 0.45];
    skin.push(EL(hc, Q.head, null, 0.05));
    const mz0 = [0, hc[1] - Q.head[1] * 0.25, hc[2] + Q.head[2] * 0.5], mz1 = [0, mz0[1] - Q.muzzle[0] * (sp === 'horse' ? 1.0 : 0.25), mz0[2] + Q.muzzle[0] * (sp === 'horse' ? 0.75 : 1)];
    skin.push(RC(mz0, mz1, Q.muzzle[1], Q.muzzle[2], 0.04));
    for (const sd of [1, -1]) {
      const ec = [sd * Q.head[0] * 0.6, hc[1] + Q.head[1] * 0.95, hc[2] - Q.head[2] * 0.2];
      skin.push(EL(ec, [Q.head[0] * 0.22, Q.head[1] * 0.55, Q.head[0] * 0.35], rz(-sd * 0.25), 0.02));
    }
    seg(0, [0, hc[1], hc[2] - Q.head[2] * 0.6], mz1); seg(1, nA, nB);
    seg(2, [0, yS, zC - Q.chest[2] * 0.6], [0, yS, zC + Q.chest[2] * 0.6]); seg(3, [0, yB, zB - Q.belly[2] * 0.5], [0, yB, zB + Q.belly[2] * 0.5]); seg(4, [0, yS, zH - Q.hip[2] * 0.6], [0, yS, zH + Q.hip[2] * 0.5]);
    // tail
    const t0 = [0, yS + Q.hip[1] * 0.5, zH - Q.hip[2] * 0.85], t1 = [0, t0[1] + Q.tail[0] * (sp === 'horse' ? -0.9 : 0.35), t0[2] - Q.tail[0] * (sp === 'horse' ? 0.35 : 0.85)];
    skin.push(RC(t0, t1, Q.tail[1], Q.tail[2], 0.03)); seg(4, t0, t1);
    // legs: shoulder/elbow/paw in front, hip/hock/paw behind
    const legY = Q.paw[1];
    for (const sd of [1, -1]) {
      const F = sd === 1 ? 0 : 1, x = sd * Q.legX;
      const sh = [x, yS - Q.chest[1] * 0.2, zC + Q.chest[2] * 0.15], el = [x, H * 0.42, zC + Q.chest[2] * 0.05], wr = [x, legY + H * 0.06, zC + Q.chest[2] * 0.1], pw = [x, legY, zC + Q.chest[2] * 0.1 + Q.paw[2] * 0.3];
      skin.push(RC(sh, el, Q.leg[0] * fm, Q.leg[1], 0.05), RC(el, wr, Q.leg[2], Q.leg[3], 0.03));
      if (Q.hoof) { // knee and fetlock bumps, then a hoof that widens to the ground
        skin.push(EL(el, [Q.leg[1] * 1.0, Q.leg[1] * 1.15, Q.leg[1] * 1.05], null, 0.03));
        skin.push(RC([x, legY + H * 0.06, pw[2] - 0.01], [x, legY * 0.5, pw[2] + 0.012], Q.leg[3], Q.leg[3] * 1.12, 0.01));
      } else skin.push(EL(pw, Q.paw, null, 0.02));
      seg(5 + 3 * F, sh, el); seg(6 + 3 * F, el, wr); seg(7 + 3 * F, wr, pw);
      const hp = [x, yS - Q.hip[1] * 0.1, zH - Q.hip[2] * 0.15], kn = [x, H * 0.45, zH + Q.hip[2] * 0.35], hk = [x, H * 0.2, zH - Q.hip[2] * 0.3], hpw = [x, legY, zH - Q.hip[2] * 0.15];
      skin.push(RC(hp, kn, Q.thigh[0] * fm, Q.thigh[1], 0.07), RC(kn, hk, Q.thigh[1] * 0.85, Q.thigh[2], 0.03), RC(hk, [x, legY + H * 0.05, hpw[2]], Q.thigh[2], Q.thigh[3], 0.02));
      if (Q.hoof) {
        skin.push(EL(hk, [Q.thigh[2] * 1.05, Q.thigh[2] * 1.25, Q.thigh[2] * 1.4], null, 0.03));
        skin.push(RC([x, legY + H * 0.06, hpw[2] - 0.01], [x, legY * 0.5, hpw[2] + 0.012], Q.thigh[3], Q.thigh[3] * 1.12, 0.01));
      } else skin.push(EL(hpw, Q.paw, null, 0.02));
      seg(11 + 3 * F, hp, kn); seg(12 + 3 * F, kn, hk); seg(13 + 3 * F, hk, hpw);
      // bones along the legs
      const br = Math.max(0.6 * s / K, Q.leg[3] * 0.38);
      bone.push(RC(sh, el, br * 1.2, br), RC(el, wr, br, br * 0.85), RC(hp, kn, br * 1.3, br), RC(kn, hk, br, br * 0.85), RC(hk, [x, legY + H * 0.05, hpw[2]], br * 0.85, br * 0.8));
    }
    // spine, ribcage hint and skull
    const spR = Math.max(0.6 * s / K, Q.neckR[1] * 0.28);
    bone.push(RC([0, yS + Q.chest[1] * 0.55, zH], [0, yS + Q.chest[1] * 0.6, zC], spR, spR), RC(nA, nB, spR, spR * 0.9));
    bone.push(EL(hc, [Q.head[0] * 0.6, Q.head[1] * 0.6, Q.head[2] * 0.7], null, 0));
    for (let r = 0; r < 5; r++) { const z = zC - Q.chest[2] * 0.5 + r * Q.chest[2] * 0.25; bone.push(Object.assign(Torus(P([0, yS, z]), Q.chest[0] * 0.8 * K, spR * K * 0.55, rx(Math.PI / 2)), { k: 0 })); }
    for (const b of bone) b.k = 0.006 * K;
    // organs in the trunk
    organs.push({ t: T.heart, set: SmoothSet([EL([0.01, yS - Q.chest[1] * 0.25, zC + Q.chest[2] * 0.15], [Q.chest[0] * 0.3, Q.chest[1] * 0.3, Q.chest[2] * 0.25], null, 0)]) });
    organs.push({ t: T.lung, set: SmoothSet([EL([Q.chest[0] * 0.42, yS + Q.chest[1] * 0.05, zC], [Q.chest[0] * 0.35, Q.chest[1] * 0.5, Q.chest[2] * 0.6], null, 0), EL([-Q.chest[0] * 0.42, yS + Q.chest[1] * 0.05, zC], [Q.chest[0] * 0.35, Q.chest[1] * 0.5, Q.chest[2] * 0.6], null, 0)]) });
    organs.push({ t: T.liver, set: SmoothSet([EL([0, yB - Q.belly[1] * 0.05, zB + Q.belly[2] * 0.45], [Q.belly[0] * 0.6, Q.belly[1] * 0.35, Q.belly[2] * 0.25], null, 0)]) });
    organs.push({ t: T.intestine, set: SmoothSet([EL([0, yB - Q.belly[1] * 0.3, zB - Q.belly[2] * 0.1], [Q.belly[0] * 0.65, Q.belly[1] * 0.45, Q.belly[2] * 0.6], null, 0)]) });
    const ext = Math.max(L, H) * K;
    return {
      kind: 'humanoid', species: sp, skin: SmoothSet(skin, 0.04 * K), bone: SmoothSet(bone, 0), cart: SmoothSet([], 0), organs, segs, nseg: 17,
      fatT: (0.6 + 1.0 * fatL) * s, skinT: 0.55 * s,
      bbox: [-ext * 0.5, -0.05, -ext * 1.1, ext * 0.5, (H + Q.neckL + 0.4) * K * 1.1, ext * 1.1],
      feetSegs: [7, 10, 13, 16],
    };
  }
  // narrow-band signed distance grid of a closed triangle mesh; inside found by ray parity along x
  function meshSDF(P, idx, h, band) {
    let x0 = 1e9, y0 = 1e9, z0 = 1e9, x1 = -1e9, y1 = -1e9, z1 = -1e9;
    for (let i = 0; i < P.length; i += 3) { x0 = Math.min(x0, P[i]); x1 = Math.max(x1, P[i]); y0 = Math.min(y0, P[i + 1]); y1 = Math.max(y1, P[i + 1]); z0 = Math.min(z0, P[i + 2]); z1 = Math.max(z1, P[i + 2]); }
    const m = band + 2 * h; x0 -= m; y0 -= m; z0 -= m; x1 += m; y1 += m; z1 += m;
    const nx = Math.ceil((x1 - x0) / h) + 1, ny = Math.ceil((y1 - y0) / h) + 1, nz = Math.ceil((z1 - z0) / h) + 1;
    const d = new Float32Array(nx * ny * nz).fill(band);
    const id = (i, j, k) => (k * ny + j) * nx + i;
    const nb = Math.ceil(band / h);
    for (let t = 0; t < idx.length; t += 3) {
      const a = 3 * idx[t], b = 3 * idx[t + 1], c = 3 * idx[t + 2];
      const ax = P[a], ay = P[a + 1], az = P[a + 2], bx = P[b], by = P[b + 1], bz = P[b + 2], cx = P[c], cy = P[c + 1], cz = P[c + 2];
      const i0 = Math.max(0, Math.floor((Math.min(ax, bx, cx) - x0) / h) - nb), i1 = Math.min(nx - 1, Math.ceil((Math.max(ax, bx, cx) - x0) / h) + nb);
      const j0 = Math.max(0, Math.floor((Math.min(ay, by, cy) - y0) / h) - nb), j1 = Math.min(ny - 1, Math.ceil((Math.max(ay, by, cy) - y0) / h) + nb);
      const k0 = Math.max(0, Math.floor((Math.min(az, bz, cz) - z0) / h) - nb), k1 = Math.min(nz - 1, Math.ceil((Math.max(az, bz, cz) - z0) / h) + nb);
      const abx = bx - ax, aby = by - ay, abz = bz - az, acx = cx - ax, acy = cy - ay, acz = cz - az;
      const d00 = abx * abx + aby * aby + abz * abz, d01 = abx * acx + aby * acy + abz * acz, d11 = acx * acx + acy * acy + acz * acz;
      for (let k = k0; k <= k1; k++) for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const px = x0 + i * h - ax, py = y0 + j * h - ay, pz = z0 + k * h - az;
        // closest point on triangle (Ericson)
        const d1 = abx * px + aby * py + abz * pz, d2 = acx * px + acy * py + acz * pz;
        let u, v;
        if (d1 <= 0 && d2 <= 0) { u = 0; v = 0; }
        else {
          const d3 = d1 - d00, d4 = d2 - d01; // p-b dotted with ab, ac
          const d5 = d1 - d01, d6 = d2 - d11; // p-c dotted with ab, ac
          if (d3 >= 0 && d4 <= d3) { u = 1; v = 0; }
          else if (d6 >= 0 && d5 <= d6) { u = 0; v = 1; }
          else {
            const vc = d1 * d4 - d3 * d2, vb = d5 * d2 - d1 * d6, va = d3 * d6 - d5 * d4;
            if (vc <= 0 && d1 >= 0 && d3 <= 0) { u = d1 / (d1 - d3); v = 0; }
            else if (vb <= 0 && d2 >= 0 && d6 <= 0) { u = 0; v = d2 / (d2 - d6); }
            else if (va <= 0 && (d4 - d3) >= 0 && (d5 - d6) >= 0) { const w = (d4 - d3) / ((d4 - d3) + (d5 - d6)); u = 1 - w; v = w; }
            else { const den = 1 / (va + vb + vc); u = vb * den; v = vc * den; }
          }
        }
        const qx = px - u * abx - v * acx, qy = py - u * aby - v * acy, qz = pz - u * abz - v * acz;
        const dd = Math.sqrt(qx * qx + qy * qy + qz * qz), g = id(i, j, k);
        if (dd < d[g]) d[g] = dd;
      }
    }
    // inside: parity of crossings along +x for each (y, z) row (slightly offset so rays miss vertices and edges)
    const rows = new Array(ny * nz);
    for (let t = 0; t < idx.length; t += 3) {
      const a = 3 * idx[t], b = 3 * idx[t + 1], c = 3 * idx[t + 2];
      const ay = P[a + 1], az = P[a + 2], by = P[b + 1], bz = P[b + 2], cy = P[c + 1], cz = P[c + 2];
      const j0 = Math.max(0, Math.ceil((Math.min(ay, by, cy) - y0) / h - 1e-4)), j1 = Math.min(ny - 1, Math.floor((Math.max(ay, by, cy) - y0) / h + 1e-4));
      const k0 = Math.max(0, Math.ceil((Math.min(az, bz, cz) - z0) / h - 1e-4)), k1 = Math.min(nz - 1, Math.floor((Math.max(az, bz, cz) - z0) / h + 1e-4));
      const den = (by - ay) * (cz - az) - (cy - ay) * (bz - az); if (Math.abs(den) < 1e-14) continue;
      for (let k = k0; k <= k1; k++) for (let j = j0; j <= j1; j++) {
        const yy = y0 + j * h + h * 1.37e-4, zz = z0 + k * h + h * 2.91e-4;
        const l1 = ((yy - ay) * (cz - az) - (cy - ay) * (zz - az)) / den, l2 = ((by - ay) * (zz - az) - (yy - ay) * (bz - az)) / den;
        if (l1 < 0 || l2 < 0 || l1 + l2 > 1) continue;
        const xx = P[a] + l1 * (P[b] - P[a]) + l2 * (P[c] - P[a]);
        const r = k * ny + j; (rows[r] || (rows[r] = [])).push(xx);
      }
    }
    for (let r = 0; r < rows.length; r++) {
      const L = rows[r]; if (!L || L.length < 2) continue;
      L.sort((p, q) => p - q);
      const k = Math.floor(r / ny), j = r - k * ny;
      for (let q = 0; q + 1 < L.length; q += 2) {
        const i0 = Math.max(0, Math.ceil((L[q] - x0) / h)), i1 = Math.min(nx - 1, Math.floor((L[q + 1] - x0) / h));
        for (let i = i0; i <= i1; i++) d[id(i, j, k)] = -d[id(i, j, k)];
      }
    }
    return { d, nx, ny, nz, x0, y0, z0, h, band, bbox: [x0 + h, y0 + h, z0 + h, x1 - h, y1 - h, z1 - h] };
  }
  function sampleGrid(G, x, y, z) {
    const fx = (x - G.x0) / G.h, fy = (y - G.y0) / G.h, fz = (z - G.z0) / G.h;
    const i = Math.floor(fx), j = Math.floor(fy), k = Math.floor(fz);
    if (i < 0 || j < 0 || k < 0 || i >= G.nx - 1 || j >= G.ny - 1 || k >= G.nz - 1) return G.band;
    const tx = fx - i, ty = fy - j, tz = fz - k, d = G.d, nx = G.nx, sl = G.nx * G.ny, o = (k * G.ny + j) * nx + i;
    const c00 = d[o] + (d[o + 1] - d[o]) * tx, c10 = d[o + nx] + (d[o + nx + 1] - d[o + nx]) * tx;
    const c01 = d[o + sl] + (d[o + sl + 1] - d[o + sl]) * tx, c11 = d[o + sl + nx] + (d[o + sl + nx + 1] - d[o + sl + nx]) * tx;
    const c0 = c00 + (c10 - c00) * ty, c1 = c01 + (c11 - c01) * ty;
    return c0 + (c1 - c0) * tz;
  }

  /* ---------------- humanoid ---------------- */
  // a pose by name; 'arest:NN' is the animation rest pose with the arms raised NN degrees (built to suit the clip)
  function poseByName(name) {
    const m = /^arest:(\d+)$/.exec(name || '');
    if (m) return Object.assign({}, POSES.arest, { sh: [[+m[1], 2], [+m[1], 2]] });
    return POSES[name];
  }
  const POSES = {
    stand: { name: 'Standing', sh: [[14, 4], [14, 4]], el: [12, 12], hip: [[0, 4], [0, 4]], kn: [2, 2], spine: 0, head: [0, 0] },
    apose: { name: 'A-pose', sh: [[42, 0], [42, 0]], el: [5, 5], hip: [[0, 6], [0, 6]], kn: [0, 0], spine: 0, head: [0, 0] },
    tpose: { name: 'T-pose', sh: [[88, 0], [88, 0]], el: [0, 0], hip: [[0, 4], [0, 4]], kn: [0, 0], spine: 0, head: [0, 0] },
    armsup: { name: 'Arms up', sh: [[165, 0], [165, 0]], el: [8, 8], hip: [[0, 5], [0, 5]], kn: [0, 0], spine: 0, head: [0, 10] },
    guard: { name: 'Fighting guard', sh: [[22, 62], [18, 70]], el: [120, 128], hip: [[10, 9], [-8, 9]], kn: [14, 10], spine: 6, head: [0, 4] },
    walk: { name: 'Walking', sh: [[8, -22], [8, 24]], el: [14, 22], hip: [[22, 3], [-16, 3]], kn: [6, 22], spine: 3, head: [0, 0] },
    run: { name: 'Running', sh: [[10, -45], [10, 50]], el: [80, 90], hip: [[40, 2], [-25, 2]], kn: [20, 80], spine: 10, head: [0, -4] },
    starfish: { name: 'Starfish', sh: [[125, 0], [125, 0]], el: [0, 0], hip: [[0, 22], [0, 22]], kn: [0, 0], spine: 0, head: [0, 0] },
    crouch: { name: 'Crouching', sh: [[14, 40], [14, 40]], el: [60, 60], hip: [[75, 10], [75, 10]], kn: [110, 110], spine: 28, head: [0, -20] },
    arest: { name: 'Animation rest', hidden: true, sh: [[48, 2], [48, 2]], el: [10, 10], hip: [[0, 9], [0, 9]], kn: [2, 2], spine: 0, head: [0, 0] },
    cower: { name: 'Shielding', sh: [[30, 95], [30, 95]], el: [140, 140], hip: [[18, 6], [6, 6]], kn: [20, 12], spine: 18, head: [0, 22] },
  };

  function humanoid(opts) {
    const H = (opts.height || 1.8) / 1.8;
    const build = opts.build != null ? opts.build : 0.5; // muscle
    const fatL = opts.fat != null ? opts.fat : 0.35;
    const s = opts.spacing;
    const pose = Object.assign({}, POSES.stand, poseByName(opts.pose) || {});
    const bm = 0.88 + build * 0.3; // limb radius scale
    const fm = 1 + fatL * 0.12;
    const rmin = 0.62 * s / H; // minimum bone radius in rest units

    const skin = [], bone = [], cart = [], organs = [], segs = [];
    const segLine = (seg, a, b) => segs.push({ seg, a, b });

    // frames
    const W = [0, 1.08, 0];
    const Rs = rx(-(pose.spine || 0) * D); // forward bend of upper body
    const up = (p) => add(W, mv(Rs, sub(p, W)));
    const Hn = up([0, 1.56, -0.005]);
    const Rh = mm(Rs, mm(ry((pose.head[0] || 0) * D), rx(-(pose.head[1] || 0) * D)));
    const hd = (p) => add(Hn, mv(Rh, sub(p, [0, 1.56, -0.005])));
    const ellU = (c, r, M) => Ellipsoid(up(c), r, mm(Rs, M || I3));
    const ellH = (c, r, M) => Ellipsoid(hd(c), r, mm(Rh, M || I3));

    // ---- skin: an athletic sculpt built from individual muscle masses (smooth-unioned so the
    // definition shows through), then the face. There is no skeleton: the inside is all soft tissue.
    const E_ = (c, r, M, k) => Object.assign(Ellipsoid(c, r, M), { k });
    const EU = (c, r, M, k) => Object.assign(ellU(c, r, M), { k });
    const EH = (c, r, M, k) => Object.assign(ellH(c, r, M), { k });
    const RC = (a, b, ra, rb, k) => Object.assign(RoundCone(a, b, ra, rb), { k });
    // torso
    skin.push(EU([0, 1.300, -0.012], [0.142 * fm, 0.165, 0.097 * fm], null, 0.05));
    skin.push(EU([0, 1.392, -0.018], [0.172, 0.07, 0.084], null, 0.045));
    skin.push(EU([0, 1.150, 0.000], [0.109 * fm, 0.115, 0.079 * fm], null, 0.055));
    skin.push(E_([0, 0.985, -0.012], [0.114 * fm, 0.095, 0.09 * fm], null, 0.1));
    for (const sd of [1, -1]) {
      skin.push(EU([0.068 * sd, 1.345, 0.042], [0.09 * bm, 0.057, 0.041 * bm], rz(-0.14 * sd), 0.04));      // pectorals
      skin.push(EU([0.088 * sd, 1.09, 0.004], [0.034, 0.07, 0.05], rz(0.12 * sd), 0.045));              // obliques
      skin.push(EU([0.098 * sd, 1.27, -0.04], [0.046 * bm, 0.11, 0.05], rz(0.2 * sd), 0.045));          // lats
      skin.push(EU([0.034 * sd, 1.16, -0.064], [0.028, 0.15, 0.026], null, 0.02));                         // spinal erectors
      skin.push(E_([0.066 * sd, 0.925, -0.058], [0.074 * fm, 0.082, 0.064 * fm], null, 0.03));             // glutes
      skin.push(RC(up([0.035 * sd, 1.505, -0.035]), up([0.15 * sd, 1.448, -0.03]), 0.047 * bm, 0.032, 0.035)); // trapezius
      skin.push(RC(up([0.022 * sd, 1.432, 0.048]), up([0.15 * sd, 1.455, 0.008]), 0.016, 0.015, 0.02));    // collarbone ridge
      skin.push(RC(hd([0.042 * sd, 1.575, -0.012]), up([0.016 * sd, 1.438, 0.045]), 0.016, 0.015, 0.018)); // neck strap muscles
    }
    skin.push(EU([0, 1.17, 0.03], [0.07, 0.13, 0.05], null, 0.05)); // rectus abdominis (smooth, as in the video)
    skin.push(E_([0, 0.868, 0.022], [0.036, 0.04, 0.028], null, 0.045));
    // neck and head
    skin.push(RC(up([0, 1.42, -0.016]), hd([0, 1.585, -0.014]), 0.06 * bm, 0.05, 0.035));
    skin.push(EH([0, 1.702, -0.014], [0.088, 0.1, 0.105], null, 0.03));      // cranium
    skin.push(EH([0, 1.640, 0.03], [0.066, 0.078, 0.071], null, 0.03));      // face
    skin.push(EH([0, 1.588, 0.028], [0.059, 0.04, 0.06], null, 0.028));     // jaw
    skin.push(EH([0, 1.566, 0.066], [0.022, 0.02, 0.02], null, 0.015));       // chin
    skin.push(EH([0, 1.692, 0.078], [0.05, 0.012, 0.016], null, 0.022));     // brow ridge
    skin.push(RC(hd([0, 1.684, 0.09]), hd([0, 1.643, 0.11]), 0.009, 0.013, 0.01)); // nose
    skin.push(EH([0, 1.639, 0.102], [0.017, 0.009, 0.011], null, 0.008));     // nostrils
    skin.push(EH([0, 1.614, 0.089], [0.018, 0.0065, 0.009], null, 0.008));      // upper lip
    skin.push(EH([0, 1.601, 0.085], [0.015, 0.006, 0.009], null, 0.008));      // lower lip
    for (const sd of [1, -1]) {
      skin.push(EH([0.04 * sd, 1.646, 0.066], [0.02, 0.013, 0.015], null, 0.02)); // cheekbones
      skin.push(EH([0.086 * sd, 1.664, -0.008], [0.009, 0.026, 0.017], null, 0.012));   // ears
      skin.push(Object.assign(EH([0.031 * sd, 1.668, 0.095], [0.016, 0.0095, 0.013], null, 0.012), { neg: true })); // eye sockets
      skin.push(EH([0.031 * sd, 1.667, 0.074], [0.0125, 0.0125, 0.0125], null, 0.005)); // eyeballs
    }
    segLine(0, hd([0, 1.59, 0.01]), hd([0, 1.72, -0.01]));
    segLine(1, up([0, 1.45, -0.02]), hd([0, 1.56, -0.01]));
    segLine(2, up([0, 1.24, 0]), up([0, 1.42, 0]));
    segLine(2, up([-0.15, 1.42, -0.02]), up([0.15, 1.42, -0.02]));
    segLine(3, up([0, 1.07, 0]), up([0, 1.2, 0]));
    segLine(4, [-0.1, 0.96, 0], [0.1, 0.96, 0]);

    // ---- organs (soft, inside the flesh)
    organs.push({ t: T.heart, set: SmoothSet([ellU([0.022, 1.29, 0.035], [0.046, 0.056, 0.044], rz(-25 * D))]) });
    organs.push({ t: T.lung, set: SmoothSet([ellU([0.068, 1.33, -0.015], [0.058, 0.1, 0.062]), ellU([-0.068, 1.33, -0.015], [0.058, 0.1, 0.062])]) });
    organs.push({ t: T.liver, set: SmoothSet([ellU([-0.045, 1.175, 0.012], [0.09, 0.045, 0.062], rz(12 * D))]) });
    organs.push({ t: T.stomach, set: SmoothSet([ellU([0.06, 1.17, 0.025], [0.05, 0.042, 0.042], rz(-30 * D))]) });
    organs.push({ t: T.kidney, set: SmoothSet([ellU([0.058, 1.1, -0.016], [0.025, 0.046, 0.021]), ellU([-0.058, 1.1, -0.016], [0.025, 0.046, 0.021])]) });
    organs.push({ t: T.intestine, set: SmoothSet([Ellipsoid([0, 1.035, 0.018], [0.11 * fm, 0.075, 0.064 * fm])]) });
    organs.push({ t: T.bladder, set: SmoothSet([Ellipsoid([0, 0.925, 0.04], [0.032, 0.03, 0.03])]) });

    // ---- arms
    const joints = { };
    let footMin = 1e9;
    for (const side of [1, -1]) {
      const L = side === 1 ? 0 : 1;
      const [ab, fl] = pose.sh[L];
      const Rsh = mm(Rs, mm(rx(-fl * D), rz(side * ab * D)));
      const S = up([0.192 * side, 1.418, -0.01]);
      const u = mv(Rsh, [0, -1, 0]), fa = mv(Rsh, [0, 0, 1]), oa = mv(Rsh, [side, 0, 0]);
      const E = add(S, scl(u, 0.29));
      const Rel = mm(Rsh, rx(-pose.el[L] * D));
      const f = mv(Rel, [0, -1, 0]);
      const Wr = add(E, scl(f, 0.255));
      const palm = mv(Rel, [side, 0, 0]); // points toward the body when relaxed
      const fwd = mv(Rel, [0, 0, 1]);
      joints['S' + L] = S; joints['E' + L] = E; joints['W' + L] = Wr;
      skin.push(E_(add(add(S, scl(oa, 0.014)), scl(u, 0.035)), [0.058 * bm, 0.08, 0.062 * bm], Rsh, 0.03)); // deltoid
      skin.push(RC(S, E, 0.056 * bm, 0.042, 0.035));
      skin.push(E_(add(add(S, scl(u, 0.155)), scl(fa, 0.017)), [0.038 * bm, 0.08, 0.037 * bm], Rsh, 0.025));   // biceps
      skin.push(E_(add(add(S, scl(u, 0.12)), scl(fa, -0.02)), [0.04 * bm, 0.095, 0.039 * bm], Rsh, 0.025));    // triceps
      skin.push(E_(E, [0.037, 0.035, 0.036], null, 0.03));
      skin.push(RC(E, Wr, 0.045 * bm, 0.03, 0.03));
      skin.push(E_(add(E, scl(f, 0.075)), [0.044 * bm, 0.08, 0.038 * bm], Rel, 0.03));                        // forearm flexors
      // hand: palm, four fingers curling slightly toward the palm, thumb
      const hx = nrm(crs(f, palm));
      const Mh = [palm[0], f[0], hx[0], palm[1], f[1], hx[1], palm[2], f[2], hx[2]];
      const tw = Math.max(0.021, 0.6 * s / H);
      skin.push(E_(add(Wr, scl(f, 0.052)), [tw * 1.1, 0.056, 0.048], Mh, 0.016));
      const fl_ = [0.075, 0.087, 0.081, 0.064], fo = [-0.03, -0.01, 0.01, 0.029];
      for (let q = 0; q < 4; q++) {
        const base = add(add(Wr, scl(f, 0.1)), scl(hx, fo[q] * (fwd[0] * hx[0] + fwd[1] * hx[1] + fwd[2] * hx[2] >= 0 ? 1 : -1)));
        const mid = add(add(base, scl(f, fl_[q] * 0.55)), scl(palm, 0.008));
        const tip = add(add(base, scl(f, fl_[q])), scl(palm, 0.024));
        skin.push(RC(base, mid, 0.0112, 0.0102, 0.009));
        skin.push(RC(mid, tip, 0.0102, 0.0088, 0.007));
      }
      skin.push(RC(add(add(Wr, scl(f, 0.03)), scl(fwd, 0.026)), add(add(add(Wr, scl(f, 0.09)), scl(fwd, 0.046)), scl(palm, 0.012)), 0.0125, 0.009, 0.012));
      segLine(5 + L * 3, S, E);
      segLine(6 + L * 3, E, Wr);
      segLine(7 + L * 3, Wr, add(Wr, scl(f, 0.16)));
    }
    // ---- legs
    for (const side of [1, -1]) {
      const L = side === 1 ? 0 : 1;
      const [fl, ab] = pose.hip[L];
      const Rhip = mm(rx(-fl * D), rz(side * ab * D));
      const Hp = [0.094 * side, 0.925, 0.0];
      const d = mv(Rhip, [0, -1, 0]), lat = mv(Rhip, [side, 0, 0]);
      const K = add(Hp, scl(d, 0.435));
      const Rkn = mm(Rhip, rx(pose.kn[L] * D));
      const d2 = mv(Rkn, [0, -1, 0]);
      const A = add(K, scl(d2, 0.42));
      const back = mv(Rkn, [0, 0, -1]), backT = mv(Rhip, [0, 0, -1]);
      const Rft = mm(Rkn, rx(-pose.kn[L] * D * 0.6 + pose.hip[L][0] * D * 0.15));
      const fdir = nrm(mv(Rft, [0, -0.08, 1]));
      const fdown = mv(Rft, [0, -1, 0]);
      const heel = add(add(A, scl(fdown, 0.042)), scl(fdir, -0.035));
      const toe = add(add(A, scl(fdown, 0.055)), scl(fdir, 0.165));
      joints['H' + L] = Hp; joints['K' + L] = K; joints['A' + L] = A;
      footMin = Math.min(footMin, heel[1] - 0.036, toe[1] - 0.024);
      skin.push(RC(Hp, K, 0.079 * bm * fm, 0.047 * bm, 0.035));
      skin.push(E_(add(add(Hp, scl(d, 0.2)), scl(backT, -0.04)), [0.048 * bm, 0.16, 0.038 * bm], Rhip, 0.03));                   // rectus femoris
      skin.push(E_(add(add(Hp, scl(d, 0.23)), scl(lat, 0.036)), [0.04 * bm, 0.15, 0.046 * bm], Rhip, 0.03));                      // vastus lateralis
      skin.push(E_(add(add(K, scl(d, -0.095)), add(scl(lat, -0.032), scl(backT, -0.018))), [0.026 * bm, 0.045, 0.026], Rhip, 0.04)); // vastus medialis
      skin.push(E_(add(add(Hp, scl(d, 0.21)), scl(backT, 0.034)), [0.05 * bm, 0.15, 0.04 * bm], Rhip, 0.03));                     // hamstrings
      skin.push(E_(add(K, scl(back, -0.006)), [0.029, 0.033, 0.029], null, 0.02));                                              // knee
      skin.push(RC(K, A, 0.045 * bm, 0.031, 0.025));
      skin.push(E_(add(add(K, scl(d2, 0.15)), scl(back, 0.026)), [0.053 * bm, 0.1, 0.048 * bm], Rkn, 0.03));                    // calf
      skin.push(E_(A, [0.03, 0.03, 0.03], null, 0.02));
      skin.push(RC(heel, toe, 0.036, 0.022, 0.02));
      skin.push(E_(add(add(heel, scl(fdir, 0.09)), scl(fdown, -0.012)), [0.046, 0.032, 0.094], Rft, 0.025));
      segLine(11 + L * 3, Hp, K);
      segLine(12 + L * 3, K, A);
      segLine(13 + L * 3, heel, toe);
    }

    // scale everything by height
    const sc = (p) => scl(p, H);
    const scalePrim = (P) => {
      const Q = Object.assign({}, P);
      if (P.c) Q.c = sc(P.c);
      if (P.bc) Q.bc = sc(P.bc);
      Q.br = P.br * H;
      if (P.k != null) Q.k = P.k * H;
      switch (P.t) {
        case 0: Q.r = sc(P.r); break;
        case 1: return Object.assign(RoundCone(sc(P.a), sc(P.b), P.ra * H, P.rb * H), P.k != null ? { k: P.k * H } : {});
        case 2: return Capsule(sc(P.a), sc(add(P.a, P.ba)), P.r * H);
        case 3: Q.h = sc(P.h); Q.rnd = P.rnd * H; break;
        case 4: Q.a = P.a * H; Q.b = P.b * H; Q.r = P.r * H; break;
        case 5: Q.ro = sc(P.ro); Q.ri = sc(P.ri); break;
      }
      return Q;
    };
    const skinS = SmoothSet(skin.map(scalePrim), 0.015 * H);
    skinS.cutY = (footMin + 0.012) * H;
    const boneS = SmoothSet(bone.map(scalePrim), 0);
    const cartS = SmoothSet(cart.map(scalePrim), 0);
    const orgS = organs.map(o => ({ t: o.t, set: SmoothSet(o.set.prims.map(scalePrim), 0) }));
    const segS = segs.map(g => ({ seg: g.seg, a: sc(g.a), b: sc(g.b) }));
    return {
      kind: 'humanoid', skin: skinS, bone: boneS, cart: cartS, organs: orgS, segs: segS, nseg: 17,
      fatT: (0.6 + 1.0 * fatL) * s, skinT: 0.55 * s,
      bbox: [-0.95 * H, -0.05, -0.75 * H, 0.95 * H, 2.1 * H, 0.75 * H],
      feetSegs: [13, 16],
    };
  }

  /* ---------------- generic shapes for molecular props ---------------- */
  function genericShape(type, size) {
    const hx = size[0] / 2, hy = size[1] / 2, hz = size[2] / 2;
    let P;
    switch (type) {
      case 'sphere': P = Ellipsoid([0, 0, 0], [hx, hy, hz]); break;
      case 'cylinder': P = Cyl([0, 0, 0], hx, hy, hz); break;
      case 'cone': P = Cone([0, 0, 0], Math.min(hx, hz), hy); break;
      case 'torus': P = Torus([0, 0, 0], hx * 0.7, hx * 0.3); break;
      case 'capsule': P = Capsule([0, -hy + hx, 0], [0, hy - hx, 0], hx); break;
      default: P = Box([0, 0, 0], [hx, hy, hz], I3, Math.min(hx, hy, hz) * 0.06);
    }
    const m = Math.max(hx, hy, hz) + 0.05;
    return { kind: 'generic', skin: SmoothSet([P], 0), bbox: [-m, -m, -m, m, m, m], nseg: 1 };
  }

  /* ---------------- lattice + tissues + bonds ---------------- */
  const DIRS = [[1, 0, 0], [0, 1, 0], [0, 0, 1], [1, 1, 0], [1, -1, 0], [1, 0, 1], [1, 0, -1], [0, 1, 1], [0, 1, -1]];

  function segDist(p, a, b) {
    const ab = sub(b, a), ap = sub(p, a);
    let t = (ap[0] * ab[0] + ap[1] * ab[1] + ap[2] * ab[2]) / (ab[0] * ab[0] + ab[1] * ab[1] + ab[2] * ab[2] || 1);
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    return Math.hypot(ap[0] - ab[0] * t, ap[1] - ab[1] * t, ap[2] - ab[2] * t);
  }

  /* Animation skinning weights. Every joint has a plane through it (across the bone); molecules on either side
   * near the plane share the two segments with a smooth ramp, so the skin bends like a rubber sleeve instead of
   * shearing apart where one segment's molecules meet the next. Shoulders, hips and the thumb root only blend
   * close to the joint itself: flesh of the trunk that merely lies near a limb stays with the trunk.
   * Returns sk (segment ids) and skw (weights 0-255, summing to 255), four per molecule. */
  function skinWeights(shape, desc, pos, lab, tis, H) {
    const n = lab.length, quad = !!shape.species, sz = quad ? (desc.height || 1) : (H || 1);
    const NS = Math.max(17, shape.nseg || 17), first = [];
    for (const L of shape.segs) if (!first[L.seg]) first[L.seg] = L;
    const BAND = [0.06, 0.075, 0.09, 0.08, 0, 0.06, 0.04, 0.025, 0.06, 0.04, 0.025, 0.06, 0.045, 0.03, 0.06, 0.045, 0.03];
    const J = [];
    for (let c = 0; c < NS; c++) {
      const L = first[c], p = SEG_PARENT[c]; if (!L || p < 0 || !first[p]) continue;
      const dc = nrm(sub(L.b, L.a)), lenC = len(sub(L.b, L.a));
      const thumb = c >= 17 && (c - 17) % 15 === 0, branch = c === 5 || c === 8 || c === 11 || c === 14 || thumb;
      let nv = dc, nvP = null;
      // seen from the trunk a shoulder splits across the side of the body (the ribs under the armpit stay with the
      // chest); seen from the arm, across the arm
      // (one plane for both sides, so the weights are continuous across the label boundary: no crease at the deltoid)
      if (!quad && (c === 5 || c === 8)) { nvP = nrm(add([1.4 * (Math.sign(L.a[0]) || 1), 0, 0], dc)); nv = nvP; }
      if (!branch && !nvP) {
        // the parent bone's direction arriving at this joint
        let bestD = 1e9, dp = null;
        for (const Q of shape.segs) {
          if (Q.seg !== p) continue;
          const da = len(sub(Q.a, L.a)), db = len(sub(Q.b, L.a));
          if (db < bestD) { bestD = db; dp = nrm(sub(Q.b, Q.a)); }
          if (da < bestD) { bestD = da; dp = nrm(sub(Q.a, Q.b)); }
        }
        if (dp) { const m = add(dp, dc); if (len(m) > 0.2) nv = nrm(m); }
        // the jaw and chin belong to the head: its plane tips forward, under the chin and over the throat
        if (!quad && c === 0) nv = nrm(add(nv, [0, 0, 0.8]));
      }
      let band;
      if (c >= 17) band = ((c - 17) % 3 === 0 ? 0.011 : 0.007) * sz;
      else band = quad ? Math.max(0.02, 0.3 * lenC) : BAND[c] * sz;
      const jr = thumb ? 0.035 * sz : (c === 5 || c === 8 ? 0.11 : 0.13) * sz * (quad ? 1.6 : 1);
      if (nvP) band *= 0.8;
      J[c] = { a: L.a, nv, nvP: nvP || nv, band, bandP: band, branch, jr, p };
    }
    // girdles (humans with finger and girdle bones): pivot, shoulder joint and reach, in builder coordinates
    const GIRD = (!quad && NS >= 49 && first[5] && first[8]) ? [5, 8].map((u, L) => {
      const S = first[u].a, side = Math.sign(S[0]) || (L ? -1 : 1);
      return { S, side, c: [S[0] * 0.2, S[1], S[2]], r0: 0.06 * sz, r1: 0.13 * sz };
    }) : null;
    const kids = Array.from({ length: NS }, () => []);
    for (let c = 0; c < NS; c++) if (J[c]) kids[J[c].p].push(c);
    const sm = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
    // share of the child side at a point: ramp across the plane, limited to near the joint for branches
    const side = (c, x, y, z, bone, fromParent) => {
      const j = J[c], b = (fromParent ? j.bandP : j.band) * (bone ? 0.3 : 1), nv = fromParent ? j.nvP : j.nv;
      const sd = (x - j.a[0]) * nv[0] + (y - j.a[1]) * nv[1] + (z - j.a[2]) * nv[2];
      const t = sm(-b, b, sd);
      let r = 1;
      if (j.branch) { const dj = Math.hypot(x - j.a[0], y - j.a[1], z - j.a[2]); r = 1 - sm(j.jr, j.jr * 1.6, dj); }
      return [t, r];
    };
    const sk = new Uint8Array(4 * n), skw = new Uint8Array(4 * n), ws = new Float32Array(NS), used = [];
    const boneT = T.bone;
    for (let i = 0; i < n; i++) {
      const s0 = lab[i], x = pos[3 * i], y = pos[3 * i + 1], z = pos[3 * i + 2], bone = tis[i] === boneT;
      used.length = 0;
      const put = (q, w) => { if (w <= 1e-4) return; if (!ws[q]) used.push(q); ws[q] += w; };
      let own = 1, give = 0;
      if (J[s0]) { const [t, r] = side(s0, x, y, z, bone); const pw = (1 - t) * r; put(J[s0].p, pw); give += pw; }
      for (const c of kids[s0]) { const [t, r] = side(c, x, y, z, bone, true); const cw = t * r; put(c, cw); give += cw; }
      own = Math.max(0, 1 - give);
      put(s0, own);
      if (!used.length) put(s0, 1);
      // the top of each shoulder rides with its girdle (part of the chest's share near the shoulder)
      if (GIRD && ws[2] > 0) for (let L = 0; L < 2; L++) {
        const g = GIRD[L]; if ((x - g.c[0]) * g.side < 0) continue;
        const dS = Math.hypot(x - g.S[0], y - g.S[1], z - g.S[2]);
        const gw = (1 - sm(g.r0, g.r1, dS)) * sm(g.S[1] - 0.03 * sz, g.S[1] + 0.02 * sz, y);
        if (gw > 0) { const m = ws[2] * gw; ws[2] -= m; put(47 + L, m); }
      }
      used.sort((a, b) => ws[b] - ws[a]);
      let tot = 0; const m = Math.min(4, used.length);
      for (let k = 0; k < m; k++) tot += ws[used[k]];
      let acc = 0;
      for (let k = 0; k < 4; k++) {
        if (k < m) { const q = used[k], w = k === m - 1 ? Math.max(0, 255 - acc) : Math.min(255 - acc, Math.round(255 * ws[q] / tot)); sk[4 * i + k] = q; skw[4 * i + k] = w; acc += w; }
        else { sk[4 * i + k] = s0; skw[4 * i + k] = 0; }
      }
      for (const q of used) ws[q] = 0;
    }
    return { sk, skw };
  }
  /* Smooth the skinning weights along the bonds a few times, so no two bonded molecules move very differently
   * (where a plane split meets a limit, e.g. the armpit). Only between molecules of the same or neighbouring
   * segments: two thighs that touch at rest stay independent. Bone molecules keep theirs (bones stay rigid). */
  function smoothSkin(W, bA, lab, tis, s, itMax) {
    const n = lab.length, sk = W.sk, skw = W.skw;
    const it = Math.max(4, Math.min(itMax || 20, Math.round((0.042 / s) * (0.042 / s))));
    // fingers are small: their plane ramps are already as wide as they should be, so they are left as they are
    const rel = (a, b) => { if ((a >= 17 && a < 47) || (b >= 17 && b < 47)) return false; a = segBody(a); b = segBody(b); return a === b || SEG_PARENT[a] === b || SEG_PARENT[b] === a; };
    // adjacency (CSR) of related bonded pairs
    const deg = new Int32Array(n + 1);
    for (let q = 0; q < bA.length; q += 2) { const i = bA[q], j = bA[q + 1]; if (!rel(lab[i], lab[j])) continue; deg[i + 1]++; deg[j + 1]++; }
    for (let i = 0; i < n; i++) deg[i + 1] += deg[i];
    const adj = new Int32Array(deg[n]), fill = deg.slice(0, n);
    for (let q = 0; q < bA.length; q += 2) { const i = bA[q], j = bA[q + 1]; if (!rel(lab[i], lab[j])) continue; adj[fill[i]++] = j; adj[fill[j]++] = i; }
    let w = new Float32Array(4 * n); for (let q = 0; q < 4 * n; q++) w[q] = skw[q] / 255;
    let ids = Uint8Array.from(sk);
    const acc = new Float32Array(64), boneT = T.bone;
    for (let r = 0; r < it; r++) {
      const nw = new Float32Array(4 * n), ni = new Uint8Array(4 * n);
      for (let i = 0; i < n; i++) {
        const d = deg[i + 1] - deg[i];
        if (!d || tis[i] === boneT) { for (let k = 0; k < 4; k++) { nw[4 * i + k] = w[4 * i + k]; ni[4 * i + k] = ids[4 * i + k]; } continue; }
        const used = [];
        const put = (q, v) => { if (!(v > 0)) return; if (!acc[q]) used.push(q); acc[q] += v; };
        for (let k = 0; k < 4; k++) put(ids[4 * i + k], 0.5 * w[4 * i + k]);
        const f = 0.5 / d;
        for (let e = deg[i]; e < deg[i + 1]; e++) { const j = adj[e]; for (let k = 0; k < 4; k++) put(ids[4 * j + k], f * w[4 * j + k]); }
        used.sort((a, b) => acc[b] - acc[a]);
        let tot = 0; const m = Math.min(4, used.length); for (let k = 0; k < m; k++) tot += acc[used[k]];
        for (let k = 0; k < 4; k++) { if (k < m) { ni[4 * i + k] = used[k]; nw[4 * i + k] = acc[used[k]] / tot; } else { ni[4 * i + k] = ni[4 * i]; nw[4 * i + k] = 0; } }
        for (const q of used) acc[q] = 0;
      }
      w = nw; ids = ni;
    }
    for (let i = 0; i < n; i++) {
      let a = 0; const m = 4;
      for (let k = 0; k < m; k++) { const v = k === m - 1 ? Math.max(0, 255 - a) : Math.min(255 - a, Math.round(255 * w[4 * i + k])); skw[4 * i + k] = v; sk[4 * i + k] = ids[4 * i + k]; a += v; }
    }
  }
  function buildBody(desc) {
    const t0 = Date.now();
    const s = desc.spacing;
    const seed = desc.seed || 1;
    const rand = mulberry(seed * 9301 + 49297);
    const MH = desc.type === 'humanoid' && desc.model !== 'sculpt' && desc.species !== 'dog' && desc.species !== 'horse' ? mhData() : null;
    const quadOn = desc.type === 'humanoid' && (desc.species === 'dog' || desc.species === 'horse');
    const shape = quadOn ? quadruped(desc) : desc.type === 'humanoid' ? (MH ? mhHumanoid(desc, MH) : humanoid(desc)) : genericShape(desc.type, desc.size || [1, 1, 1]);
    const tissues = desc.tissues || TISSUES;
    const matId = desc.material != null ? desc.material : T.clay;
    // tight bounds from the skin primitives' bounding spheres
    let [bx0, by0, bz0, bx1, by1, bz1] = [1e9, 1e9, 1e9, -1e9, -1e9, -1e9];
    if (shape.skin.grid) { [bx0, by0, bz0, bx1, by1, bz1] = shape.bbox; }
    for (const P of shape.skin.prims) {
      const r = Math.min(P.br, 2.0), c = P.bc;
      bx0 = Math.min(bx0, c[0] - r); by0 = Math.min(by0, c[1] - r); bz0 = Math.min(bz0, c[2] - r);
      bx1 = Math.max(bx1, c[0] + r); by1 = Math.max(by1, c[1] + r); bz1 = Math.max(bz1, c[2] + r);
    }
    const B0 = shape.bbox;
    bx0 = Math.max(bx0, B0[0]); by0 = Math.max(by0, B0[1]); bz0 = Math.max(bz0, B0[2]);
    bx1 = Math.min(bx1, B0[3]); by1 = Math.min(by1, B0[4]); bz1 = Math.min(bz1, B0[5]);
    // lattice grid (+2 margin)
    const ox = bx0 - 2 * s, oy = by0 - 2 * s, oz = bz0 - 2 * s;
    const nx = Math.ceil((bx1 - bx0) / s) + 5, ny = Math.ceil((by1 - by0) / s) + 5, nz = Math.ceil((bz1 - bz0) / s) + 5;
    const gsdf = new Float32Array(nx * ny * nz);
    const gidx = new Int32Array(nx * ny * nz).fill(-1);
    const gi = (i, j, k) => (k * ny + j) * nx + i;
    // coarse SDF (with sparse early-out: evaluate every node, cheap enough with culling)
    for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      gsdf[gi(i, j, k)] = evalSet(shape.skin, ox + i * s, oy + j * s, oz + k * s);
    }
    // particles
    const pos = [], tis = [], seg = [], cells = [], fib = [], lab = [];
    const opts_H = (desc.height || 1.8) / 1.8;
    const thr = 0.12 * s;
    for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const g = gi(i, j, k);
      if (gsdf[g] > thr) continue;
      const x = ox + i * s, y = oy + j * s, z = oz + k * s;
      let t;
      if (shape.kind === 'humanoid') {
        const depth = -gsdf[g];
        if (evalSet(shape.cart, x, y, z) < 0 && depth > shape.skinT) t = T.cartilage;
        else if (evalSet(shape.bone, x, y, z) < 0 && depth > shape.skinT * 0.5) t = T.bone;
        else {
          t = -1;
          // organs stay behind the skin, fat and a muscle wall: an organ ellipsoid that reaches the surface (kidneys at a
          // slim back) would otherwise show through as a patch of organ molecules
          if (depth > shape.skinT + shape.fatT + 0.5 * s) for (const o of shape.organs) if (evalSet(o.set, x, y, z) < 0) { t = o.t; break; }
          if (t < 0) t = depth < shape.skinT ? T.skin : (depth < shape.skinT + shape.fatT ? T.fat : T.muscle);
        }
        // nearest segment (finger bones too); the solver groups molecules by body segment, a finger by its hand
        let best = 1e9, bs = 0, bL = null, sec = 1e9, ss = -1;
        for (const L of shape.segs) {
          let dd = segDist([x, y, z], L.a, L.b);
          // a thigh does not reach up the side of the waist: above the hip joint the trunk is nearer than it looks
          if ((L.seg === 11 || L.seg === 14) && y > L.a[1]) dd += (y - L.a[1]) * 0.9;
          if (dd < best) { if (L.seg !== bs) { sec = best; ss = bs; } best = dd; bs = L.seg; bL = L; }
          else if (dd < sec && L.seg !== bs) { sec = dd; ss = L.seg; }
        }
        lab.push(bs);
        seg.push(segBody(bs)); ss = ss >= 0 ? segBody(ss) : -1;
        if (ss === segBody(bs)) ss = -1;
        // muscle fibres run along the limb segment
        const ax = sub(bL.b, bL.a), al = Math.hypot(ax[0], ax[1], ax[2]) || 1; fib.push(ax[0] / al, ax[1] / al, ax[2] / al);
        // tendons: the band of tissue that bridges two limb segments (wrists, elbows, shoulders, neck, hips, knees, ankles)
        const trunk = (q) => q >= 2 && q <= 4;
        if (t === T.muscle && ss >= 0 && !(trunk(segBody(bs)) && trunk(ss)) && sec - best < 1.7 * s) t = T.tendon;
      } else { t = matId; seg.push(0); lab.push(0); fib.push(0, 1, 0); }
      gidx[g] = pos.length / 3;
      pos.push(x, y, z); tis.push(t); cells.push(i, j, k);
    }
    const n = pos.length / 3;
    if (shape.kind === 'humanoid') {
      // drop bone islands too small to matter (lattice aliasing of thin bones)
      const uf = new Int32Array(n).map((_, i) => i);
      const fnd = (i) => { while (uf[i] !== i) { uf[i] = uf[uf[i]]; i = uf[i]; } return i; };
      for (let p = 0; p < n; p++) {
        if (tis[p] !== T.bone) continue;
        const i = cells[3 * p], j = cells[3 * p + 1], k = cells[3 * p + 2];
        for (const dd of DIRS) {
          const ii = i + dd[0], jj = j + dd[1], kk = k + dd[2];
          if (ii >= nx || jj < 0 || jj >= ny || kk < 0 || kk >= nz) continue;
          const q = gidx[gi(ii, jj, kk)];
          if (q < 0 || tis[q] !== T.bone || seg[q] !== seg[p]) continue;
          const a = fnd(p), b = fnd(q); if (a !== b) uf[a] = b;
        }
      }
      const sz = new Int32Array(n);
      for (let p = 0; p < n; p++) if (tis[p] === T.bone) sz[fnd(p)]++;
      for (let p = 0; p < n; p++) if (tis[p] === T.bone && sz[fnd(p)] < 5) tis[p] = T.muscle;
    }
    // body origin: humanoid feet at y=0 (min y), generic centered at 0
    let minY = 1e9; for (let i = 0; i < n; i++) minY = Math.min(minY, pos[3 * i + 1]);
    const yShift = shape.kind === 'humanoid' ? -(minY - s * 0.5) : 0;
    const rest = new Float32Array(3 * n);
    for (let i = 0; i < n; i++) { rest[3 * i] = pos[3 * i]; rest[3 * i + 1] = pos[3 * i + 1] + yShift; rest[3 * i + 2] = pos[3 * i + 2]; }
    // bonds
    const bA = [], bR = [], bK = [], bS = [], bC = [];
    const jointF = desc.jointStrength != null ? desc.jointStrength : 1;
    for (let p = 0; p < n; p++) {
      const i = cells[3 * p], j = cells[3 * p + 1], k = cells[3 * p + 2];
      for (const dd of DIRS) {
        const ii = i + dd[0], jj = j + dd[1], kk = k + dd[2];
        if (ii < 0 || jj < 0 || kk < 0 || ii >= nx || jj >= ny || kk >= nz) continue;
        const q = gidx[gi(ii, jj, kk)];
        if (q < 0) continue;
        const A = tissues[tis[p]], B = tissues[tis[q]];
        let k_ = Math.min(A.stiffness, B.stiffness), st, cp;
        const pb_ = tis[p] === T.bone, qb_ = tis[q] === T.bone;
        if (pb_ !== qb_) { // soft tissue anchored on bone: the attachment tears like the soft side
          const Sft = pb_ ? B : A; st = Sft.stretch * 0.85; cp = Sft.compress * 0.9;
        } else {
          st = Math.min(A.stretch, B.stretch); cp = Math.min(A.compress, B.compress);
          if (tis[p] !== tis[q] && (A.kind === 'organ') !== (B.kind === 'organ')) st *= 0.75;
        }
        if (seg[p] !== seg[q]) { st *= jointF * 2.5; cp = Math.min(0.95, cp * 1.4); k_ *= 0.6; }
        if (shape.kind === 'humanoid') {
          const tp = tis[p], tq = tis[q];
          if (tp === T.muscle && tq === T.muscle) { // fibres: tough along, weak across, so muscle splits lengthwise
            const L_ = Math.hypot(dd[0], dd[1], dd[2]), c = Math.abs((dd[0] * fib[3 * p] + dd[1] * fib[3 * p + 1] + dd[2] * fib[3 * p + 2]) / L_);
            st *= 0.78 + 0.55 * c * c;
          } else if ((tp === T.skin) !== (tq === T.skin) && (tp === T.fat || tq === T.fat)) st *= 0.72; // skin peels off the fat layer
        }
        const v = 0.72 + 0.56 * rand();
        bA.push(p, q); bR.push(s * Math.hypot(dd[0], dd[1], dd[2])); bK.push(k_); bS.push(st * v); bC.push(cp * v);
      }
    }
    // skinning weights for animation: up to four segments per molecule, blended smoothly across each joint
    const skin4 = shape.kind === 'humanoid' ? skinWeights(shape, desc, pos, lab, tis, opts_H) : null;
    if (skin4) smoothSkin(skin4, bA, lab, tis, s);
    // per particle props
    const invMass = new Float32Array(n), smw = new Float32Array(n), shm = new Float32Array(n), tisA = new Uint8Array(n), segA = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      const Tt = tissues[tis[i]];
      invMass[i] = 1 / Tt.density; smw[i] = Tt.rigidity; shm[i] = Tt.shatter; tisA[i] = tis[i]; segA[i] = seg[i];
    }
    // anchors: sole particles of the feet
    const anchor = new Uint8Array(n);
    if (shape.kind === 'humanoid') {
      let fmin = 1e9;
      for (let i = 0; i < n; i++) if (shape.feetSegs.indexOf(segA[i]) >= 0) fmin = Math.min(fmin, rest[3 * i + 1]);
      // the sole: the lowest molecules of the feet (a little deeper when the lattice lands awkwardly on a flat sole)
      for (let th = 0.6; th < 1.6; th += 0.2) {
        let cnt = 0;
        for (let i = 0; i < n; i++) { anchor[i] = rest[3 * i + 1] < fmin + s * th && shape.feetSegs.indexOf(segA[i]) >= 0 ? 1 : 0; cnt += anchor[i]; }
        if (cnt >= 14 * shape.feetSegs.length / 2) break;
      }
    } else {
      let mn = 1e9; for (let i = 0; i < n; i++) mn = Math.min(mn, rest[3 * i + 1]);
      for (let i = 0; i < n; i++) if (rest[3 * i + 1] < mn + s * 0.5) anchor[i] = 1;
    }
    // bone reference for each particle (nearest bone particle in the same segment)
    const boneRef = new Int32Array(n).fill(-1);
    if (shape.kind === 'humanoid') {
      const bySeg = {};
      for (let i = 0; i < n; i++) if (tisA[i] === T.bone) (bySeg[segA[i]] = bySeg[segA[i]] || []).push(i);
      for (let i = 0; i < n; i++) {
        if (tisA[i] === T.bone) { boneRef[i] = i; continue; }
        const list = bySeg[segA[i]]; if (!list) continue;
        let best = 1e9, bi_ = -1;
        const px = rest[3 * i], py = rest[3 * i + 1], pz = rest[3 * i + 2];
        for (let q = 0; q < list.length; q++) {
          const b = list[q], dx = rest[3 * b] - px, dy = rest[3 * b + 1] - py, dz = rest[3 * b + 2] - pz;
          const d2 = dx * dx + dy * dy + dz * dz; if (d2 < best) { best = d2; bi_ = b; }
        }
        boneRef[i] = bi_;
      }
    }

    // ---------- skin mesh (surface nets on a half-spacing grid, narrow band) ----------
    const f = s / (desc.skinDetail || (shape.kind === 'humanoid' ? 3 : 2));
    const ratio = s / f;
    const fx = Math.ceil((nx - 1) * ratio) + 1, fy = Math.ceil((ny - 1) * ratio) + 1, fz = Math.ceil((nz - 1) * ratio) + 1;
    const fv = new Float32Array(fx * fy * fz);
    const fi = (i, j, k) => (k * fy + j) * fx + i;
    for (let k = 0; k < fz; k++) for (let j = 0; j < fy; j++) for (let i = 0; i < fx; i++) {
      const ci = Math.min(nx - 1, Math.round(i / ratio)), cj = Math.min(ny - 1, Math.round(j / ratio)), ck = Math.min(nz - 1, Math.round(k / ratio));
      const cvv = gsdf[gi(ci, cj, ck)];
      fv[fi(i, j, k)] = Math.abs(cvv) > 1.6 * s ? cvv : evalSet(shape.skin, ox + i * f, oy + j * f, oz + k * f);
    }
    const cellV = new Int32Array((fx - 1) * (fy - 1) * (fz - 1)).fill(-1);
    const ci3 = (i, j, k) => (k * (fy - 1) + j) * (fx - 1) + i;
    const verts = [];
    const EDGES = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
    const corner = new Float64Array(8);
    for (let k = 0; k < fz - 1; k++) for (let j = 0; j < fy - 1; j++) for (let i = 0; i < fx - 1; i++) {
      let mask = 0;
      for (let c = 0; c < 8; c++) {
        const v = fv[fi(i + (c & 1), j + ((c >> 1) & 1), k + ((c >> 2) & 1))];
        corner[c] = v; if (v < 0) mask |= 1 << c;
      }
      if (mask === 0 || mask === 255) continue;
      let sx = 0, sy = 0, sz = 0, cnt = 0;
      for (const [a, b] of EDGES) {
        const va = corner[a], vb = corner[b];
        if ((va < 0) === (vb < 0)) continue;
        const t = va / (va - vb);
        const ax = a & 1, ay = (a >> 1) & 1, az = (a >> 2) & 1, bxx = b & 1, byy = (b >> 1) & 1, bzz = (b >> 2) & 1;
        sx += ax + (bxx - ax) * t; sy += ay + (byy - ay) * t; sz += az + (bzz - az) * t; cnt++;
      }
      cellV[ci3(i, j, k)] = verts.length / 3;
      verts.push(ox + (i + sx / cnt) * f, oy + (j + sy / cnt) * f, oz + (k + sz / cnt) * f);
    }
    const tris = [];
    const quad = (a, b, c, d, flip) => { if (a < 0 || b < 0 || c < 0 || d < 0) return; if (flip) tris.push(a, c, b, a, d, c); else tris.push(a, b, c, a, c, d); };
    for (let k = 1; k < fz - 1; k++) for (let j = 1; j < fy - 1; j++) for (let i = 1; i < fx - 1; i++) {
      const v0 = fv[fi(i, j, k)] < 0;
      if (i < fx - 1 && (fv[fi(i + 1, j, k)] < 0) !== v0) quad(cellV[ci3(i, j - 1, k - 1)], cellV[ci3(i, j, k - 1)], cellV[ci3(i, j, k)], cellV[ci3(i, j - 1, k)], !v0);
      if (j < fy - 1 && (fv[fi(i, j + 1, k)] < 0) !== v0) quad(cellV[ci3(i - 1, j, k - 1)], cellV[ci3(i - 1, j, k)], cellV[ci3(i, j, k)], cellV[ci3(i, j, k - 1)], !v0);
      if (k < fz - 1 && (fv[fi(i, j, k + 1)] < 0) !== v0) quad(cellV[ci3(i - 1, j - 1, k)], cellV[ci3(i, j - 1, k)], cellV[ci3(i, j, k)], cellV[ci3(i - 1, j, k)], !v0);
    }
    // project to surface, compute normals
    const nv = verts.length / 3;
    const vpos = new Float32Array(verts), vnor = new Float32Array(3 * nv);
    const e = f * 0.25;
    for (let v = 0; v < nv; v++) {
      let x = vpos[3 * v], y = vpos[3 * v + 1], z = vpos[3 * v + 2];
      let gxx = 0, gyy = 0, gzz = 0;
      for (let it = 0; it < 3; it++) {
        const d0 = evalSet(shape.skin, x, y, z);
        gxx = evalSet(shape.skin, x + e, y, z) - evalSet(shape.skin, x - e, y, z);
        gyy = evalSet(shape.skin, x, y + e, z) - evalSet(shape.skin, x, y - e, z);
        gzz = evalSet(shape.skin, x, y, z + e) - evalSet(shape.skin, x, y, z - e);
        const gl = Math.hypot(gxx, gyy, gzz) || 1;
        gxx /= gl; gyy /= gl; gzz /= gl;
        if (it < 2) { const st = Math.max(-f, Math.min(f, d0)); x -= gxx * st; y -= gyy * st; z -= gzz * st; }
      }
      vpos[3 * v] = x; vpos[3 * v + 1] = y + yShift; vpos[3 * v + 2] = z;
      vnor[3 * v] = gxx; vnor[3 * v + 1] = gyy; vnor[3 * v + 2] = gzz;
    }
    // lips and eyelids: the mesh is folded thinner than the lattice there, so the extracted surface crumples. Relax
    // it (Taubin, keeps volume) around the face plugs, fading out with distance
    if (shape.skin.plugs && shape.skin.plugs.length) {
      const PL = shape.skin.plugs, R0 = 0.016 * (desc.height || 1.8) / 1.8, wv = new Float32Array(nv);
      let any = 0;
      for (let v = 0; v < nv; v++) {
        let dmin = 1e9; for (const P of PL) { const dd = sdPrim(P, vpos[3 * v], vpos[3 * v + 1] - yShift, vpos[3 * v + 2]); if (dd < dmin) dmin = dd; }
        if (dmin < R0) { wv[v] = Math.min(1, 1.5 * (1 - dmin / R0)); any++; }
      }
      if (any) {
        const nb = new Map(), link = (a, b) => { if (!wv[a]) return; let l = nb.get(a); if (!l) nb.set(a, l = new Set()); l.add(b); };
        for (let t = 0; t < tris.length; t += 3) { const a = tris[t], b = tris[t + 1], c = tris[t + 2]; link(a, b); link(a, c); link(b, a); link(b, c); link(c, a); link(c, b); }
        const vs = [...nb.keys()], lists = vs.map(v => [...nb.get(v)]), tmp = new Float32Array(3 * vs.length);
        for (let it = 0; it < 16; it++) {
          const lam = it % 2 ? -0.53 : 0.5;
          for (let q = 0; q < vs.length; q++) {
            const v = vs[q], L = lists[q]; let sx = 0, sy = 0, sz = 0;
            for (const u of L) { sx += vpos[3 * u]; sy += vpos[3 * u + 1]; sz += vpos[3 * u + 2]; }
            const k = lam * wv[v], m = L.length;
            tmp[3 * q] = vpos[3 * v] + k * (sx / m - vpos[3 * v]); tmp[3 * q + 1] = vpos[3 * v + 1] + k * (sy / m - vpos[3 * v + 1]); tmp[3 * q + 2] = vpos[3 * v + 2] + k * (sz / m - vpos[3 * v + 2]);
          }
          for (let q = 0; q < vs.length; q++) { const v = vs[q]; vpos[3 * v] = tmp[3 * q]; vpos[3 * v + 1] = tmp[3 * q + 1]; vpos[3 * v + 2] = tmp[3 * q + 2]; }
        }
        for (const v of vs) {
          const x = vpos[3 * v], y = vpos[3 * v + 1] - yShift, z = vpos[3 * v + 2];
          let gx = evalSet(shape.skin, x + e, y, z) - evalSet(shape.skin, x - e, y, z), gy = evalSet(shape.skin, x, y + e, z) - evalSet(shape.skin, x, y - e, z), gz = evalSet(shape.skin, x, y, z + e) - evalSet(shape.skin, x, y, z - e);
          const gl = Math.hypot(gx, gy, gz) || 1; vnor[3 * v] = gx / gl; vnor[3 * v + 1] = gy / gl; vnor[3 * v + 2] = gz / gl;
        }
      }
    }
    // fix winding against normals
    for (let t = 0; t < tris.length; t += 3) {
      const a = tris[t], b = tris[t + 1], c = tris[t + 2];
      const ux = vpos[3 * b] - vpos[3 * a], uy = vpos[3 * b + 1] - vpos[3 * a + 1], uz = vpos[3 * b + 2] - vpos[3 * a + 2];
      const wx = vpos[3 * c] - vpos[3 * a], wy = vpos[3 * c + 1] - vpos[3 * a + 1], wz = vpos[3 * c + 2] - vpos[3 * a + 2];
      const cx = uy * wz - uz * wy, cy = uz * wx - ux * wz, cz = ux * wy - uy * wx;
      const nx_ = vnor[3 * a] + vnor[3 * b] + vnor[3 * c], ny_ = vnor[3 * a + 1] + vnor[3 * b + 1] + vnor[3 * c + 1], nz_ = vnor[3 * a + 2] + vnor[3 * b + 2] + vnor[3 * c + 2];
      if (cx * nx_ + cy * ny_ + cz * nz_ < 0) { tris[t + 1] = c; tris[t + 2] = b; }
    }
    // bind each skin vertex to a lattice frame (c0 + three axis neighbours)
    const bindIdx = new Float32Array(4 * nv), bindUVW = new Float32Array(3 * nv), bindN = new Float32Array(3 * nv);
    let fails = 0;
    const cand = [];
    // thin features (nose, lips, ears, fingers) can be several cells from a full lattice frame: search wide enough
    for (let R = -4; R <= 4; R++) for (let Q = -4; Q <= 4; Q++) for (let P = -4; P <= 4; P++) cand.push([P, Q, R, P * P + Q * Q + R * R]);
    cand.sort((a, b) => a[3] - b[3]);
    for (let v = 0; v < nv; v++) {
      const px = vpos[3 * v], py = vpos[3 * v + 1] - yShift, pz = vpos[3 * v + 2];
      const fi0 = (px - ox) / s, fj0 = (py - oy) / s, fk0 = (pz - oz) / s;
      const i0 = Math.round(fi0), j0 = Math.round(fj0), k0 = Math.round(fk0);
      let done = false;
      for (let ci = 0; ci < cand.length; ci++) {
        const ii = i0 + cand[ci][0], jj = j0 + cand[ci][1], kk = k0 + cand[ci][2];
        if (ii < 1 || jj < 1 || kk < 1 || ii >= nx - 1 || jj >= ny - 1 || kk >= nz - 1) continue;
        const c0 = gidx[gi(ii, jj, kk)]; if (c0 < 0) continue;
        const pref = [fi0 >= ii ? 1 : -1, fj0 >= jj ? 1 : -1, fk0 >= kk ? 1 : -1];
        const sg = [0, 0, 0], nb = [-1, -1, -1];
        let ok = true;
        for (let a = 0; a < 3 && ok; a++) {
          let found = false;
          for (const sgn of [pref[a], -pref[a]]) {
            const di = a === 0 ? sgn : 0, dj = a === 1 ? sgn : 0, dk = a === 2 ? sgn : 0;
            const q = gidx[gi(ii + di, jj + dj, kk + dk)];
            if (q >= 0) { sg[a] = sgn; nb[a] = q; found = true; break; }
          }
          ok = found;
        }
        if (!ok) continue;
        bindIdx[4 * v] = c0; bindIdx[4 * v + 1] = nb[0]; bindIdx[4 * v + 2] = nb[1]; bindIdx[4 * v + 3] = nb[2];
        bindUVW[3 * v] = (fi0 - ii) * sg[0]; bindUVW[3 * v + 1] = (fj0 - jj) * sg[1]; bindUVW[3 * v + 2] = (fk0 - kk) * sg[2];
        const nxv = vnor[3 * v], nyv = vnor[3 * v + 1], nzv = vnor[3 * v + 2];
        bindN[3 * v] = nxv * sg[1] * sg[2]; bindN[3 * v + 1] = nyv * sg[2] * sg[0]; bindN[3 * v + 2] = nzv * sg[0] * sg[1];
        done = true; break;
      }
      if (!done) {
        fails++;
        // nearest particle only (vertex collapses onto it); hidden quickly when damaged
        let best = 1e9, bq = 0;
        for (let ci = 0; ci < cand.length; ci++) {
          const ii = i0 + cand[ci][0], jj = j0 + cand[ci][1], kk = k0 + cand[ci][2];
          if (ii < 0 || jj < 0 || kk < 0 || ii >= nx || jj >= ny || kk >= nz) continue;
          const c0 = gidx[gi(ii, jj, kk)]; if (c0 >= 0) { bq = c0; best = 0; break; }
        }
        bindIdx[4 * v] = bindIdx[4 * v + 1] = bindIdx[4 * v + 2] = bindIdx[4 * v + 3] = bq;
        bindN[3 * v + 1] = 1; void best;
      }
    }
    const idx = (nv > 65535 ? Uint32Array : Uint16Array).from(tris);
    // skin vertices get their own skinning weights: while a body is animated its skin is posed straight from the
    // bones (smooth fingers and faces at any molecule size), and only follows the molecules once physics takes over
    let vsk = null;
    if (skin4 && shape.segs) {
      const vp = new Float32Array(3 * nv), vl = new Array(nv), vt = new Array(nv).fill(T.skin);
      for (let v = 0; v < nv; v++) {
        const x = vpos[3 * v], y = vpos[3 * v + 1] - yShift, z = vpos[3 * v + 2];
        vp[3 * v] = x; vp[3 * v + 1] = y; vp[3 * v + 2] = z;
        let best = 1e9, bs = 0;
        for (const L of shape.segs) {
          let dd = segDist([x, y, z], L.a, L.b);
          if ((L.seg === 11 || L.seg === 14) && y > L.a[1]) dd += (y - L.a[1]) * 0.9;
          if (dd < best) { best = dd; bs = L.seg; }
        }
        vl[v] = bs;
      }
      vsk = skinWeights(shape, desc, vp, vl, vt, opts_H);
      const edges = new Int32Array(2 * tris.length);
      for (let t = 0; t < tris.length; t += 3) { const a = tris[t], b = tris[t + 1], c = tris[t + 2]; edges.set([a, b, b, c, c, a], 2 * t); }
      smoothSkin(vsk, edges, vl, vt, f * 1.2, 40);
    }
    const out = {
      count: n, spacing: s, radius: s * 0.5,
      rest, tissue: tisA, seg: segA, sk: skin4 && skin4.sk, skw: skin4 && skin4.skw, invMass, smw, shm, anchor, boneRef,
      bonds: Int32Array.from(bA), bondRest: Float32Array.from(bR), bondK: Float32Array.from(bK), bondS: Float32Array.from(bS), bondC: Float32Array.from(bC),
      skin: { pos: vpos, nor: vnor, index: idx, bindIdx, bindUVW, bindN, fails, sk: vsk && vsk.sk, skw: vsk && vsk.skw },
      hasSkeleton: false, softSegments: shape.kind === 'humanoid',
      rig: shape.species ? { quad: shape.species, yShift, segs: shape.segs } : shape.kind === 'humanoid' ? { H: opts_H, yShift, pose: desc.pose || 'stand', model: MH ? 'mh' : 'sculpt', head: desc.headScale || 1, nseg: shape.nseg || 17 } : null,
      species: shape.species || 'human',
      ms: Date.now() - t0,
    };
    return out;
  }

  const api = { TISSUES, T, POSES, poseByName, buildBody, humanoid, mhHumanoid, mhData, evalSet, rigPose, SEG_PARENT, FK_PARENT, girdleC, NSEG, segBody, fingerSeg, handRig, rotAxis, rotFromTo, matQuat, mm, mv, tr3, rx, ry, rz };
  api._mhHumanoid = (o) => mhHumanoid(o, mhData()); api._mhData = () => mhData();
  root.ShatterBuilder = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof self !== 'undefined' ? self : globalThis);
