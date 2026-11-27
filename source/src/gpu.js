/* Shatterbond GPU physics (experimental).
 * Runs the per-substep solver (predict, colliders, floor, bonds, goo links, shape matching, anchors,
 * particle contacts, velocities, bond damping) and the end-of-frame bond fracture on the graphics card
 * with WebGPU compute shaders. The engine keeps doing the bookkeeping on the CPU once per frame
 * (clusters, knockouts, wounds, sleeping), so CPU and GPU share one set of rules.
 * Differences from the CPU solver: bonds and contacts are solved with Jacobi iterations (all molecules
 * at once) instead of one after the other, and blood does not stick to weapons. */
(function (root) {
  'use strict';
  const WG = 64, SNAPCAP = 2048, GOOCAP = 8192, SLOT = 256;

  const HEAD = /* wgsl */`
struct Field { a: vec4f, p: vec4f, d: vec4f }
struct Uf { N: u32, nbody: u32, nc: u32, nf: u32, offB: u32, offK: u32, offC: u32, offX: u32,
  nPose: u32, hmask: u32, B: u32, frame: u32, floorOn: u32, iters: u32, lcount: u32, cpOff: u32,
  g: vec4f, fl: vec4f, k: vec4f, snapOff: u32, gooOff: u32, nSoft: u32, hcap: u32, fields: array<Field, 8> }
struct Sf { s: u32, variant: u32, doC: u32, last: u32, ta: f32, tb: f32, h: f32, ih: f32, maxCorr: f32, dt: f32, p0: f32, p1: f32 }
struct PSt { body: u32, adj0: u32, nb0: u32, boneRef: i32, smw: f32, shm: f32, w0: f32, rad: f32 }
@group(0) @binding(0) var<uniform> u: Uf;
@group(1) @binding(0) var<uniform> sb: Sf;
fn fdu(o: u32) -> u32 { return bitcast<u32>(FD[o]); }
fn bodyOf(i: u32) -> u32 { return u.offB + PS[i].body * 32u; }
fn hash32(k: u32) -> f32 {
  var i = k;
  i = (i ^ (i >> 16u)) * 0x45d9f3bu;
  i = (i ^ (i >> 16u)) * 0x45d9f3bu;
  i = i ^ (i >> 16u);
  return f32(i) / 4294967296.0;
}
fn qmat(q: vec4f) -> mat3x3f { // rows as in the CPU quatToMat, returned as columns of the transpose
  let x = q.x; let y = q.y; let z = q.z; let w = q.w;
  let xx = x * x; let yy = y * y; let zz = z * z; let xy = x * y; let xz = x * z; let yz = y * z; let wx = w * x; let wy = w * y; let wz = w * z;
  // mat3x3f(col0, col1, col2): column j holds R[0][j], R[1][j], R[2][j]
  return mat3x3f(vec3f(1.0 - 2.0 * (yy + zz), 2.0 * (xy + wz), 2.0 * (xz - wy)),
                 vec3f(2.0 * (xy - wz), 1.0 - 2.0 * (xx + zz), 2.0 * (yz + wx)),
                 vec3f(2.0 * (xz + wy), 2.0 * (yz - wx), 1.0 - 2.0 * (xx + yy)));
}
fn bxbit(v: u32, q: u32) -> bool { return ((v >> ((q & 3u) * 8u)) & 0xffu) != 0u; }
`;

  // shape SDFs in local space: returns (distance, local normal)
  const SDF = /* wgsl */`
fn sdBox(q: vec3f, hd: vec3f) -> vec4f {
  let a = abs(q) - hd;
  if (a.x > 0.0 || a.y > 0.0 || a.z > 0.0) {
    let m = max(a, vec3f(0.0)); let l = max(length(m), 1e-9);
    return vec4f(l, sign(q) * m / l);
  }
  if (a.x >= a.y && a.x >= a.z) { return vec4f(a.x, select(1.0, -1.0, q.x < 0.0), 0.0, 0.0); }
  if (a.y >= a.z) { return vec4f(a.y, 0.0, select(1.0, -1.0, q.y < 0.0), 0.0); }
  return vec4f(a.z, 0.0, 0.0, select(1.0, -1.0, q.z < 0.0));
}
fn sdEll(q: vec3f, r: vec3f) -> vec4f {
  if (abs(r.x - r.y) < 1e-4 && abs(r.y - r.z) < 1e-4) { let l = max(length(q), 1e-9); return vec4f(l - r.x, q / l); }
  let k0v = q / r; let k1v = q / (r * r);
  let k0 = length(k0v); let k1 = max(length(k1v), 1e-9);
  return vec4f(k0 * (k0 - 1.0) / k1, k1v / k1);
}
fn sdCyl(q: vec3f, d: vec3f) -> vec4f {
  let R = min(d.x, d.z);
  let sx = q.x * R / d.x; let sz = q.z * R / d.z;
  let lr = max(sqrt(sx * sx + sz * sz), 1e-9);
  let dr = lr - R; let dy = abs(q.y) - d.y;
  let nx = sx / lr; let nz = sz / lr; let sy = select(1.0, -1.0, q.y < 0.0);
  if (dr > 0.0 && dy > 0.0) { let l = sqrt(dr * dr + dy * dy); return vec4f(l, nx * dr / l, sy * dy / l, nz * dr / l); }
  if (dr > dy) { return vec4f(dr, nx, 0.0, nz); }
  return vec4f(dy, 0.0, sy, 0.0);
}
fn sdCap(q: vec3f, r: f32, hy: f32) -> vec4f {
  let c = vec3f(q.x, q.y - clamp(q.y, -hy, hy), q.z); let l = max(length(c), 1e-9);
  return vec4f(l - r, c / l);
}
fn sdTor(q: vec3f, R: f32, r: f32) -> vec4f {
  let lr = max(sqrt(q.x * q.x + q.z * q.z), 1e-9);
  let d = vec3f(q.x - q.x / lr * R, q.y, q.z - q.z / lr * R); let l = max(length(d), 1e-9);
  return vec4f(l - r, d / l);
}
fn sdConeRaw(q: vec3f, R: f32, hy: f32) -> f32 {
  let qxz = sqrt(q.x * q.x + q.z * q.z);
  let k1 = vec2f(0.0, hy); let k2 = vec2f(-R, 2.0 * hy);
  let ca = vec2f(qxz - min(qxz, select(0.0, R, q.y < 0.0)), abs(q.y) - hy);
  let t = clamp(dot(k1 - vec2f(qxz, q.y), k2) / dot(k2, k2), 0.0, 1.0);
  let cb = vec2f(qxz, q.y) - k1 + k2 * t;
  let s = select(1.0, -1.0, cb.x < 0.0 && ca.y < 0.0);
  return s * sqrt(min(dot(ca, ca), dot(cb, cb)));
}
fn sdCone(q0: vec3f, d: vec3f) -> vec4f {
  let R = min(d.x, d.z); let q = vec3f(q0.x * R / d.x, q0.y, q0.z * R / d.z);
  let dd = sdConeRaw(q, R, d.y); let e = 1e-3;
  let g = vec3f(sdConeRaw(q + vec3f(e, 0.0, 0.0), R, d.y) - dd, sdConeRaw(q + vec3f(0.0, e, 0.0), R, d.y) - dd, sdConeRaw(q + vec3f(0.0, 0.0, e), R, d.y) - dd);
  return vec4f(dd, g / max(length(g), 1e-9));
}
fn sdShape(t: u32, q: vec3f, d: vec3f) -> vec4f {
  switch (t) {
    case 0u: { return sdBox(q, d); }
    case 1u: { return sdEll(q, d); }
    case 2u: { return sdCyl(q, d); }
    case 3u: { return sdCone(q, d); }
    case 4u: { return sdTor(q, d.x, d.y); }
    case 5u: { return sdCap(q, d.x, d.y); }
    default: { return vec4f(1e9, 0.0, 1.0, 0.0); }
  }
}
`;

  // kernels: [name, bindings [[name, access, type]], body]
  const K = {};
  K.predict = [[['FD', 'r', 'array<f32>'], ['PS', 'r', 'array<PSt>'], ['R', 'r', 'array<vec4f>'], ['X', 'rw', 'array<vec4f>'], ['XP', 'rw', 'array<vec4f>'], ['V', 'rw', 'array<vec4f>'], ['P', 'rw', 'array<vec4u>'], ['ANC', 'rw', 'array<vec4f>']], `
@compute @workgroup_size(${WG}) fn main(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x; if (i >= u.N) { return; }
  let bo = bodyOf(i); let bf = fdu(bo);
  if ((bf & 1u) != 0u) { return; }
  var pd = P[i];
  if ((bf & 2u) != 0u) {
    let ko = u.offK + (sb.s * u.nbody + PS[i].body) * 12u;
    let r = R[i].xyz; let xo = X[i];
    XP[i] = xo;
    let nx = vec3f(FD[ko] * r.x + FD[ko + 1u] * r.y + FD[ko + 2u] * r.z + FD[ko + 9u],
                   FD[ko + 3u] * r.x + FD[ko + 4u] * r.y + FD[ko + 5u] * r.z + FD[ko + 10u],
                   FD[ko + 6u] * r.x + FD[ko + 7u] * r.y + FD[ko + 8u] * r.z + FD[ko + 11u]);
    X[i] = vec4f(nx, 0.0);
    if ((pd.x & 1u) != 0u) { ANC[i] = vec4f(nx, 0.0); }
    return;
  }
  if (bitcast<f32>(pd.y) == 0.0) { return; }
  let h = sb.h; let x = X[i].xyz;
  var v = V[i].xyz + u.g.xyz * h;
  for (var f = 0u; f < u.nf; f++) {
    let F = u.fields[f]; let ty = u32(F.a.x); let st = F.a.y; let rad = F.a.z;
    if (ty == 1u) { v += F.d.xyz * st * h; }
    else if (ty == 2u) {
      let ax = F.d.xyz; let q = x - F.p.xyz; let hgt = dot(q, ax);
      let rv = q - ax * hgt; let rh = length(rv) + 1e-6;
      if (rh > rad || hgt < -0.5) { continue; }
      let fh = 1.0 - rh / rad; let hf = clamp(1.0 - hgt / (rad * 0.9), 0.0, 1.0);
      let uu = rv / rh; let t = cross(ax, uu);
      let Vt = st * 0.17 * min(1.0, rh / 2.0);
      let Vin = -st * 0.3 * max(0.3, fh) * clamp(rh - 1.0, -0.5, 1.0);
      let Vu = F.a.w * 0.45 * hf;
      let k = min(1.0, 5.0 * min(1.0, fh * 4.0) * h);
      v += (t * Vt + uu * Vin + ax * Vu - v) * k;
    } else if (ty == 3u) {
      let dv = F.p.xyz - x; let d2 = dot(dv, dv);
      if (rad > 0.0 && d2 > rad * rad) { continue; }
      let d = sqrt(d2) + 0.05;
      let fall = select(1.0, 1.0 - (d - 0.05) / rad, rad > 0.0);
      let a = st * fall * (1.0 + 0.35 / (d * d)) / d;
      v += dv * a * h;
    }
  }
  v *= max(0.0, 1.0 - FD[bo + 3u] * h);
  V[i] = vec4f(v, 0.0);
  XP[i] = vec4f(x, 0.0);
  X[i] = vec4f(x + v * h, 0.0);
  pd.z = 0u; P[i] = pd;
}`];

  K.collide = [[['FD', 'r', 'array<f32>'], ['PS', 'r', 'array<PSt>'], ['X', 'rw', 'array<vec4f>'], ['XP', 'r', 'array<vec4f>'], ['P', 'rw', 'array<vec4u>'], ['ADJ', 'r', 'array<vec2u>'], ['BX', 'rw', 'array<atomic<u32>>'], ['ATOM', 'rw', 'array<atomic<u32>>']], `
fn slowK(k: f32) -> f32 { if (sb.p0 >= 1.0 || k <= 0.0) { return k; } let c = min(k, 0.98); return (1.0 - pow(1.0 - c, sb.p0)) * k / c; }
fn cutBond(q: u32) { atomicOr(&BX[q >> 2u], 1u << ((q & 3u) * 8u)); }
@compute @workgroup_size(${WG}) fn main(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x; if (i >= u.N) { return; }
  let ps = PS[i]; let bo = u.offB + ps.body * 32u; let bf = fdu(bo);
  if ((bf & 3u) != 0u) { return; }
  var pd = P[i];
  if (bitcast<f32>(pd.y) == 0.0) { return; }
  var x = X[i].xyz; let xp = XP[i].xyz;
  let ri = ps.rad; let h = sb.h; let ih = sb.ih;
  let bmu = FD[bo + 1u]; let shatterV = FD[bo + 2u];
  let damaged = ((pd.x >> 8u) & 0xffu) < ps.nb0;
  var bout = 0u;
  for (var c = 0u; c < u.nc; c++) {
    let co = u.offC + c * 16u; let xo = u.offX + (sb.s * u.nc + c) * 24u;
    // swept collision: a fast thin object is checked in slices along its path through the substep
    let pA = vec3f(FD[xo + 18u], FD[xo + 19u], FD[xo + 20u]); let pB = vec3f(FD[xo + 21u], FD[xo + 22u], FD[xo + 23u]);
    let nsl = u32(clamp(ceil((length(pB - pA) + FD[co + 15u]) / max(1e-4, (FD[co + 14u] + ri) * 0.8)), 1.0, 24.0));
    let MA = mat3x3f(vec3f(FD[xo], FD[xo + 3u], FD[xo + 6u]), vec3f(FD[xo + 1u], FD[xo + 4u], FD[xo + 7u]), vec3f(FD[xo + 2u], FD[xo + 5u], FD[xo + 8u]));
    let MB = mat3x3f(vec3f(FD[xo + 9u], FD[xo + 12u], FD[xo + 15u]), vec3f(FD[xo + 10u], FD[xo + 13u], FD[xo + 16u]), vec3f(FD[xo + 11u], FD[xo + 14u], FD[xo + 17u]));
    for (var sk = 1u; sk <= nsl; sk++) {
    // this slice's pose, and where the same surface point was one whole substep earlier (matches the CPU)
    let fS = f32(sk) / f32(nsl); let gS = fS - 1.0;
    let cp = mix(pA, pB, fS);
    let paK = mix(pA, pB, gS);
    let pr = x - cp;
    if (dot(pr, pr) > FD[co + 9u]) { continue; }
    // slice rotation: local = R^T p
    let mb = MA + (MB - MA) * fS;
    let q = pr * mb; // row vector times matrix = R^T p
    let t = u32(FD[co]); let dims = vec3f(FD[co + 1u], FD[co + 2u], FD[co + 3u]);
    let sd = sdShape(t, q, dims);
    var pen = ri - sd.x;
    if (t == 3u && pen > -2.5 * ri && damaged && sd.z < 0.9) {
      let ax = vec3f(FD[xo + 10u], FD[xo + 13u], FD[xo + 16u]);
      let ra = dot(x - xp, ax);
      if (ra < 0.0) { x -= ax * ra; }
    }
    if (pen <= 0.0) { continue; }
    var n = mb * sd.yzw;
    let cshat = FD[co + 8u]; let sharp = cshat < 0.45; let shat = shatterV * cshat;
    let kAx = i32(FD[co + 10u]); let kH = FD[co + 11u];
    var kSide = 0.0; var kw = vec3f(0.0);
    if (kAx >= 0 && !(t == 4u && dot(q.xz, q.xz) > dims.x * dims.x)) {
      kw = mb[u32(kAx)];
      let qa = q[u32(kAx)];
      kSide = select(-1.0, 1.0, qa >= 0.0);
      if (u.floorOn != 0u && kw.y * kSide > 0.5 && x.y < u.fl.x + 0.12) { kSide = -kSide; }
      let pk = kH + ri - abs(qa);
      if (pk > 0.0) { pen = min(pk, ri * 2.0); n = kw * kSide; }
    }
    let ma = MA + (MB - MA) * gS;
    let wpt = ma * q + paK;
    var sdv = x - wpt;
    let spin = vec3f(FD[co + 5u], FD[co + 6u], FD[co + 7u]);
    sdv += cross(spin, pr) * h;
    let vr = (x - xp) - sdv;
    let iv = -dot(vr, n) * ih;
    let cB = FD[co + 12u];
    var spent = false;
    if (cB < 1e29) {
      let cP = f32(atomicLoad(&ATOM[u.cpOff + c])) * 0.001;
      if (cP > 0.7 * cB) { spent = true; pen *= max(0.0, (cB - cP) / (0.3 * cB)); }
      atomicAdd(&ATOM[u.cpOff + c], u32(FD[bo + 10u] * pen * ih * 1000.0));
    }
    x += n * pen;
    if (!spent) { pd.z = select(2u, 3u, cB < 1e29); }
    bout |= 2u;
    if (iv > FD[bo + 6u]) { bout |= 1u; }
    if (iv > FD[bo + 7u] && (bf & 16u) != 0u && ps.boneRef >= 0) {
      let k = atomicAdd(&ATOM[2], 1u);
      if (k < ${SNAPCAP}u) { let o = u.snapOff + k * 4u; atomicStore(&ATOM[o], i); atomicStore(&ATOM[o + 1u], bitcast<u32>(n.x)); atomicStore(&ATOM[o + 2u], bitcast<u32>(n.y)); atomicStore(&ATOM[o + 3u], bitcast<u32>(n.z)); }
    }
    var ivc = iv;
    if (sharp && hash32(i * 7u + 11u) < select(0.12, 0.3, kAx < 0)) {
      let tn = dot(vr, n); let tv = vr - tn * n; ivc = max(iv, length(tv) * ih * 0.35);
    }
    if (ivc > shat * ps.shm && (damaged || sharp || spent)) { pd.x |= 6u; pd.x &= ~1u; }
    let a0 = ps.adj0; let a1 = PS[i + 1u].adj0;
    if (kSide != 0.0) {
      for (var a = a0; a < a1; a++) {
        let e = ADJ[a];
        if (dot(X[e.y].xyz - cp, kw) * kSide < 0.0) { cutBond(e.x); }
      }
    } else if ((sharp && pen > ri * 0.12 && iv > 0.25 * shat * ps.shm) || (t == 3u && pen > ri * 0.12 && sd.z < 0.9)) {
      let lim = -0.6 * ri;
      for (var a = a0; a < a1; a++) {
        let e = ADJ[a];
        if (dot(X[e.y].xyz - x, n) < lim) { cutBond(e.x); }
      }
    }
    // flesh cannot reach through a solid: a bond whose middle lies deep inside the collider is cut (matches the CPU)
    if (kSide == 0.0 && t != 3u) {
      for (var a = a0; a < a1; a++) {
        let e = ADJ[a];
        let sm = sdShape(t, (0.5 * (x + X[e.y].xyz) - cp) * mb, dims);
        if (sm.x < -0.5 * ri && sdShape(t, (X[e.y].xyz - cp) * mb, dims).x > 0.0) { cutBond(e.x); }
      }
    }
    let rr = (x - xp) - sdv; let rn = dot(rr, n); let tv = rr - rn * n; let tl = length(tv);
    if (tl > 1e-9) {
      let mu = sqrt(FD[co + 4u] * bmu);
      let f = slowK(min(1.0, select(mu, mu * 0.08, kSide != 0.0) * pen * 2.5 / tl));
      x -= tv * f;
    }
    }
  }
  if (u.floorOn != 0u) {
    let pen = u.fl.x + ri - x.y;
    if (pen > 0.0) {
      let vy = (x.y - xp.y) * ih;
      x.y += pen; pd.z = 1u;
      if (-vy > shatterV * 1.15 * ps.shm && damaged) { pd.x |= 6u; pd.x &= ~1u; }
      let tv = vec2f(x.x - xp.x, x.z - xp.z); let tl = length(tv);
      if (tl > 1e-9) { let f = slowK(min(1.0, sqrt(u.fl.y * bmu) * pen * 2.5 / tl)); x.x -= tv.x * f; x.z -= tv.y * f; }
    }
  }
  X[i] = vec4f(x, 0.0);
  P[i] = pd;
  if (bout != 0u) { atomicOr(&ATOM[4u + 2u * ps.body], bout); }
}`];

  K.bonds = [[['FD', 'r', 'array<f32>'], ['PS', 'r', 'array<PSt>'], ['P', 'r', 'array<vec4u>'], ['ADJ', 'r', 'array<vec2u>'], ['BX', 'r', 'array<u32>'], ['BRK', 'r', 'array<vec4f>'], ['X', 'r', 'array<vec4f>'], ['XN', 'rw', 'array<vec4f>']], `
@compute @workgroup_size(${WG}) fn main(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x; if (i >= u.N) { return; }
  let ps = PS[i]; let bo = u.offB + ps.body * 32u; let bf = fdu(bo);
  let xi = X[i];
  let pi = P[i]; let wi = bitcast<f32>(pi.y);
  if ((bf & 3u) != 0u || wi == 0.0 || (pi.x & 4u) != 0u) { XN[i] = xi; return; }
  let stiff = FD[bo + 4u];
  var acc = vec3f(0.0); var cnt = 0.0;
  for (var a = ps.adj0; a < PS[i + 1u].adj0; a++) {
    let e = ADJ[a]; let q = e.x;
    if (bxbit(BX[q >> 2u], q)) { continue; }
    let pj = P[e.y];
    if ((pj.x & 4u) != 0u) { continue; }
    let wj = bitcast<f32>(pj.y); let ws = wi + wj;
    let d = X[e.y].xyz - xi.xyz; let L = length(d);
    if (ws == 0.0 || L < 1e-9) { continue; }
    let br = BRK[q];
    acc += d * (wi * stiff * br.y * (L - br.x) / (L * ws));
    cnt += 1.0;
  }
  XN[i] = vec4f(xi.xyz + acc * (u.k.y / max(1.0, cnt * 0.25)), 0.0);
}`];

  // bonds solved one colour group at a time: no two bonds in a group share a molecule, so each is applied
  // in full straight away (Gauss-Seidel, like the CPU) instead of averaged
  K.bondsGS = [[['FD', 'r', 'array<f32>'], ['PS', 'r', 'array<PSt>'], ['P', 'r', 'array<vec4u>'], ['BX', 'r', 'array<u32>'], ['BRK', 'r', 'array<vec4f>'], ['BIJ', 'r', 'array<vec2u>'], ['BORD', 'r', 'array<u32>'], ['X', 'rw', 'array<vec4f>']], `
struct Cf { start: u32, count: u32, p0: u32, p1: u32 }
@group(2) @binding(0) var<uniform> cc: Cf;
@compute @workgroup_size(${WG}) fn main(@builtin(global_invocation_id) gid: vec3u) {
  let t = gid.x; if (t >= cc.count) { return; }
  let q = BORD[cc.start + t];
  if (bxbit(BX[q >> 2u], q)) { return; }
  let ij = BIJ[q]; let i = ij.x; let j = ij.y;
  let bo = bodyOf(i); let bf = fdu(bo);
  if ((bf & 3u) != 0u) { return; }
  let pi = P[i]; let pj = P[j];
  if (((pi.x | pj.x) & 4u) != 0u) { return; }
  let wi = bitcast<f32>(pi.y); let wj = bitcast<f32>(pj.y); let ws = wi + wj;
  let xi = X[i].xyz; let xj = X[j].xyz;
  let d = xj - xi; let L = length(d);
  if (ws == 0.0 || L < 1e-9) { return; }
  let br = BRK[q];
  let sc = FD[bo + 4u] * br.y * (L - br.x) / (L * ws);
  X[i] = vec4f(xi + d * (wi * sc), 0.0);
  X[j] = vec4f(xj - d * (wj * sc), 0.0);
}`];

  K.links = [[['FD', 'r', 'array<f32>'], ['PS', 'r', 'array<PSt>'], ['P', 'r', 'array<vec4u>'], ['PLK', 'r', 'array<vec4i>'], ['LNK', 'r', 'array<vec4f>'], ['X', 'r', 'array<vec4f>'], ['XN', 'rw', 'array<vec4f>']], `
@compute @workgroup_size(${WG}) fn main(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x; if (i >= u.N) { return; }
  let xi = X[i]; let wi = bitcast<f32>(P[i].y);
  let pl = PLK[i];
  var acc = vec3f(0.0);
  if (wi != 0.0) {
    for (var s = 0u; s < 3u; s++) {
      let L = pl[s]; if (L < 0) { continue; }
      let lk = LNK[u32(L)];
      if (lk.w != 0.0) { continue; }
      let a = bitcast<u32>(lk.x); let b = bitcast<u32>(lk.y);
      let j = select(a, b, a == i);
      if ((fdu(bodyOf(i)) & 1u) != 0u && (fdu(bodyOf(j)) & 1u) != 0u) { continue; }
      let wj = bitcast<f32>(P[j].y); let ws = wi + wj;
      let d = X[j].xyz - xi.xyz; let Ld = length(d);
      if (ws == 0.0 || Ld < 1e-9) { continue; }
      acc += d * (wi * 0.55 * (Ld - lk.z) / (Ld * ws));
    }
  }
  XN[i] = vec4f(xi.xyz + acc * 0.8, 0.0);
}`];

  K.copyX = [[['X', 'rw', 'array<vec4f>'], ['XN', 'r', 'array<vec4f>']], `
@compute @workgroup_size(${WG}) fn main(@builtin(global_invocation_id) gid: vec3u) { let i = gid.x; if (i >= u.N) { return; } X[i] = XN[i]; }`];
  K.copyV = [[['V', 'rw', 'array<vec4f>'], ['XN', 'r', 'array<vec4f>']], `
@compute @workgroup_size(${WG}) fn main(@builtin(global_invocation_id) gid: vec3u) { let i = gid.x; if (i >= u.N) { return; } V[i] = XN[i]; }`];

  // one workgroup per cluster: weighted centroid, covariance, polar decomposition, then pull members to their goals
  K.shape = [[['FD', 'r', 'array<f32>'], ['PS', 'r', 'array<PSt>'], ['P', 'r', 'array<vec4u>'], ['CLM', 'r', 'array<u32>'], ['CQ', 'rw', 'array<vec4f>'], ['R', 'rw', 'array<vec4f>'], ['X', 'rw', 'array<vec4f>'], ['XP', 'rw', 'array<vec4f>']], `
var<workgroup> red: array<array<f32, 9>, 256>;
var<workgroup> hdr: array<u32, 8>;
var<workgroup> prm: array<f32, 8>;
var<workgroup> cen: array<f32, 8>;
var<workgroup> rot: mat3x3f;
fn wgt(i: u32, isF: bool, ctw: f32) -> f32 {
  let pf = P[i]; let ct = pf.z;
  var w = 1.0;
  if ((pf.x & 1u) != 0u) { w = 400.0; } else if (ct != 0u && ct < 3u) { w = ctw; }
  let w0 = PS[i].w0;
  return w / select(1.0, w0, w0 != 0.0) * select(1.0, 0.3, isF);
}
@compute @workgroup_size(256) fn main(@builtin(workgroup_id) wid: vec3u, @builtin(local_invocation_index) lid: u32) {
  let c = wid.x + select(0u, u.nPose, sb.variant == 1u);
  if (lid == 0u) {
    for (var k = 0u; k < 8u; k++) { hdr[k] = CLM[c * 8u + k]; }
    let bo = u.offB + hdr[4] * 32u + 16u + 6u * sb.variant;
    let bf = fdu(u.offB + hdr[4] * 32u);
    for (var k = 0u; k < 6u; k++) { prm[k] = FD[bo + k]; }
    prm[6] = FD[u.offB + hdr[4] * 32u + 13u];
    if ((bf & 3u) != 0u) { prm[0] = 0.0; }
  }
  let isOn = workgroupUniformLoad(&prm[0]);
  if (isOn <= 0.0) { return; }
  let mo = hdr[0]; let n = hdr[1]; let fo = hdr[2]; let nf = hdr[3];
  let ksm = prm[1]; let pp = prm[2] > 0.5; let kfol = prm[3]; let ctw = prm[4]; let dmp = prm[5]; let crush = prm[6];
  let nt = workgroupUniformLoad(&hdr[1]) + workgroupUniformLoad(&hdr[3]);
  var s = array<f32, 9>(0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0);
  for (var k = lid; k < nt; k += 256u) {
    let isF = k >= n; let i = select(CLM[mo + k], CLM[fo + k - n], isF);
    let wt = wgt(i, isF, ctw);
    let x = X[i].xyz; let r = R[i].xyz;
    s[0] += x.x * wt; s[1] += x.y * wt; s[2] += x.z * wt; s[3] += r.x * wt; s[4] += r.y * wt; s[5] += r.z * wt; s[6] += wt;
  }
  red[lid] = s;
  workgroupBarrier();
  for (var st = 128u; st > 0u; st >>= 1u) {
    if (lid < st) { for (var k = 0u; k < 7u; k++) { red[lid][k] += red[lid + st][k]; } }
    workgroupBarrier();
  }
  if (lid == 0u) { let ws = max(red[0][6], 1e-12); for (var k = 0u; k < 6u; k++) { cen[k] = red[0][k] / ws; } }
  workgroupBarrier();
  let cx = vec3f(cen[0], cen[1], cen[2]); let rc = vec3f(cen[3], cen[4], cen[5]);
  workgroupBarrier();
  s = array<f32, 9>(0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0);
  for (var k = lid; k < nt; k += 256u) {
    let isF = k >= n; let i = select(CLM[mo + k], CLM[fo + k - n], isF);
    let wt = wgt(i, isF, ctw);
    let p = (X[i].xyz - cx) * wt; let q = R[i].xyz - rc;
    s[0] += p.x * q.x; s[1] += p.x * q.y; s[2] += p.x * q.z;
    s[3] += p.y * q.x; s[4] += p.y * q.y; s[5] += p.y * q.z;
    s[6] += p.z * q.x; s[7] += p.z * q.y; s[8] += p.z * q.z;
  }
  red[lid] = s;
  workgroupBarrier();
  for (var st = 128u; st > 0u; st >>= 1u) {
    if (lid < st) { for (var k = 0u; k < 9u; k++) { red[lid][k] += red[lid + st][k]; } }
    workgroupBarrier();
  }
  if (lid == 0u) {
    let A = red[0];
    var q = CQ[2u * c];
    let fresh = CQ[2u * c + 1u].y > 0.5;
    let iters = select(4u, 24u, fresh);
    for (var it = 0u; it < iters; it++) {
      let Rm = qmat(q); // columns of R are Rm[0], Rm[1], Rm[2]
      let r0 = vec3f(Rm[0].x, Rm[0].y, Rm[0].z); let r1 = Rm[1]; let r2 = Rm[2];
      let c0 = vec3f(A[0], A[3], A[6]); let c1 = vec3f(A[1], A[4], A[7]); let c2 = vec3f(A[2], A[5], A[8]);
      var o = cross(r0, c0) + cross(r1, c1) + cross(r2, c2);
      let den = abs(dot(r0, c0) + dot(r1, c1) + dot(r2, c2)) + 1e-9;
      o /= den;
      let ang = length(o);
      if (ang < 1e-9) { break; }
      let sa = sin(ang * 0.5) / ang; let ca = cos(ang * 0.5);
      let e = vec4f(o * sa, ca);
      let nq = vec4f(e.w * q.x + e.x * q.w + e.y * q.z - e.z * q.y,
                     e.w * q.y - e.x * q.z + e.y * q.w + e.z * q.x,
                     e.w * q.z + e.x * q.y - e.y * q.x + e.z * q.w,
                     e.w * q.w - e.x * q.x - e.y * q.y - e.z * q.z);
      q = normalize(nq);
    }
    CQ[2u * c] = q;
    rot = qmat(q);
  }
  workgroupBarrier();
  let Rm = workgroupUniformLoad(&rot);
  var res = 0.0;
  for (var k = lid; k < n; k += 256u) {
    let i = CLM[mo + k];
    if (bitcast<f32>(P[i].y) == 0.0) { continue; }
    let x = X[i].xyz;
    let r4 = R[i];
    let g = Rm * (r4.xyz - rc) + cx;
    let kk = select(ksm, min(1.0, ksm * PS[i].smw), pp);
    // crushed flesh keeps its dent: where molecules are squeezed hard, the rest shape yields toward where they are
    if (crush > 0.0 && r4.w > 0.1) {
      let a = min(0.3, (r4.w - 0.1) * 3.0) * crush;
      R[i] = vec4f(r4.xyz + (((x - cx) * Rm) + rc - r4.xyz) * a, r4.w);
    }
    let e = g - x; res += dot(e, e);
    let cc = e * kk;
    X[i] = vec4f(x + cc, 0.0);
    if (dmp > 0.0) { XP[i] = vec4f(XP[i].xyz + cc * dmp, 0.0); }
  }
  if (kfol > 0.0) {
    for (var k = lid; k < nf; k += 256u) {
      let i = CLM[fo + k];
      if (bitcast<f32>(P[i].y) == 0.0) { continue; }
      let x = X[i].xyz;
      let g = Rm * (R[i].xyz - rc) + cx;
      X[i] = vec4f(x + (g - x) * (kfol * PS[i].smw), 0.0);
    }
  }
  red[lid][0] = res;
  workgroupBarrier();
  for (var st = 128u; st > 0u; st >>= 1u) {
    if (lid < st) { red[lid][0] += red[lid + st][0]; }
    workgroupBarrier();
  }
  if (lid == 0u && n > 200u) { let o = CQ[2u * c + 1u]; CQ[2u * c + 1u] = vec4f(max(o.x, red[0][0] / f32(n)), 0.0, o.z, o.w); }
  else if (lid == 0u) { let o = CQ[2u * c + 1u]; CQ[2u * c + 1u] = vec4f(o.x, 0.0, o.z, o.w); }
}`];

  K.anchor = [[['FD', 'r', 'array<f32>'], ['PS', 'r', 'array<PSt>'], ['P', 'rw', 'array<vec4u>'], ['ANC', 'r', 'array<vec4f>'], ['X', 'rw', 'array<vec4f>']], `
@compute @workgroup_size(${WG}) fn main(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x; if (i >= u.N) { return; }
  let ps = PS[i]; let bo = u.offB + ps.body * 32u; let bf = fdu(bo);
  if ((bf & 1u) != 0u) { return; }
  var pd = P[i]; var x = X[i].xyz; var ch = false;
  if ((bf & 4u) != 0u && (pd.x & 1u) != 0u) {
    if ((bf & 32u) != 0u) { pd.x &= ~1u; P[i] = pd; }
    else {
      let d = x - ANC[i].xyz;
      if ((bf & 2u) == 0u && dot(d, d) > FD[bo + 8u]) { pd.x &= ~1u; P[i] = pd; }
      else { x = ANC[i].xyz; ch = true; }
    }
  }
  if (u.floorOn != 0u && (bf & 2u) == 0u && bitcast<f32>(pd.y) != 0.0) {
    let lo = u.fl.x + ps.rad;
    if (x.y < lo) { x.y = lo; ch = true; }
  }
  if (ch) { X[i] = vec4f(x, 0.0); }
}`];

  K.hclear = [[['HT', 'rw', 'array<u32>']], `
@compute @workgroup_size(${WG}) fn main(@builtin(global_invocation_id) gid: vec3u) { let i = gid.x; if (i > u.hmask) { return; } HT[i] = 0u; }`];

  const CELL = `
fn cellOf(p: vec3f) -> vec3i { return vec3i(floor(p * u.k.x)); }
fn hcell(c: vec3i) -> u32 { return ((bitcast<u32>(c.x) * 92837111u) ^ (bitcast<u32>(c.y) * 689287499u) ^ (bitcast<u32>(c.z) * 283923481u)) & u.hmask; }
fn candOk(i: u32) -> bool {
  let pd = P[i];
  if ((pd.x & 2u) == 0u || (pd.x & 8u) != 0u) { return false; }
  return (fdu(bodyOf(i)) & 1u) == 0u;
}`;
  K.hinsert = [[['FD', 'r', 'array<f32>'], ['PS', 'r', 'array<PSt>'], ['P', 'rw', 'array<vec4u>'], ['X', 'r', 'array<vec4f>'], ['ADJ', 'r', 'array<vec2u>'], ['BX', 'r', 'array<u32>'], ['HT', 'rw', 'array<atomic<u32>>']], CELL + `
@compute @workgroup_size(${WG}) fn main(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x; if (i >= u.N) { return; }
  // molecules next to one shattered this frame start colliding with it straight away (the CPU marks them the same way)
  var pd = P[i];
  if ((pd.x & 2u) == 0u && (pd.x & 8u) == 0u) {
    for (var a = PS[i].adj0; a < PS[i + 1u].adj0; a++) {
      let e = ADJ[a];
      if ((P[e.y].x & 4u) != 0u && !bxbit(BX[e.x >> 2u], e.x)) { pd.x |= 2u; P[i] = pd; break; }
    }
  }
  if (!candOk(i)) { return; }
  let hk = hcell(cellOf(X[i].xyz));
  let k = atomicAdd(&HT[hk], 1u);
  if (k < u.hcap) { atomicStore(&HT[u.hmask + 1u + hk * u.hcap + k], i); }
}`];

  K.contacts = [[['FD', 'r', 'array<f32>'], ['PS', 'r', 'array<PSt>'], ['P', 'r', 'array<vec4u>'], ['X', 'r', 'array<vec4f>'], ['XP', 'r', 'array<vec4f>'], ['HT', 'r', 'array<u32>'], ['XN', 'rw', 'array<vec4f>'], ['ATOM', 'rw', 'array<atomic<u32>>']], CELL + `
@compute @workgroup_size(${WG}) fn main(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x; if (i >= u.N) { return; }
  let xi4 = X[i];
  if (!candOk(i)) { XN[i] = xi4; return; }
  let xi = xi4.xyz; let pi = P[i]; let wi = bitcast<f32>(pi.y); let ri = PS[i].rad;
  let c0 = cellOf(xi); let mu = u.fl.w;
  let dxi = xi - XP[i].xyz;
  let nbbi = (pi.x >> 8u) & 0xffu; let bi = PS[i].body;
  var acc = vec3f(0.0);
  for (var ox = -1; ox <= 1; ox++) { for (var oy = -1; oy <= 1; oy++) { for (var oz = -1; oz <= 1; oz++) {
    let hk = hcell(c0 + vec3i(ox, oy, oz));
    let cnt = min(HT[hk], u.hcap);
    for (var e = 0u; e < cnt; e++) {
      let j = HT[u.hmask + 1u + hk * u.hcap + e];
      if (j == i) { continue; }
      let d = X[j].xyz - xi; let d2 = dot(d, d);
      let md = (ri + PS[j].rad) * 0.92;
      if (d2 >= md * md || d2 < 1e-14) { continue; }
      let pj = P[j]; let wj = bitcast<f32>(pj.y); let ws = wi + wj;
      if (ws == 0.0) { continue; }
      let dl = sqrt(d2); let pen = min(md - dl, sb.maxCorr); let nn = d / dl;
      acc -= nn * (pen * wi / ws);
      if (mu > 0.0) {
        let rr = dxi - (X[j].xyz - XP[j].xyz); let rn = dot(rr, nn); let tv = rr - rn * nn;
        acc -= tv * (mu * select(0.24, 1.0, PS[j].body != PS[i].body) * wi / ws);
      }
      // sticky goo: remember pairs of torn molecules that touched; the CPU makes the links
      if (i < j) {
        let nbbj = (pj.x >> 8u) & 0xffu; let bj = PS[j].body;
        if ((nbbi > 0u || nbbj > 0u) && pi.w < 3u && pj.w < 3u && (bi == bj || nbbi == 0u || nbbj == 0u)) {
          let g = min(FD[u.offB + bi * 32u + 9u], FD[u.offB + bj * 32u + 9u]) * select(0.025, select(0.5, 0.03, bi == bj && nbbi * 2u < PS[i].nb0 && nbbj * 2u < PS[j].nb0), nbbi > 0u && nbbj > 0u) * sb.p1;
          if (g > 0.0 && hash32((i * 73856093u) ^ (j * 19349663u) ^ u.frame) < g) {
            let k = atomicAdd(&ATOM[3], 1u);
            if (k < ${GOOCAP}u) { atomicStore(&ATOM[u.gooOff + 2u * k], i); atomicStore(&ATOM[u.gooOff + 2u * k + 1u], j); }
          }
        }
      }
    }
  } } }
  var dx = acc * u.k.w; let dl2 = dot(dx, dx);
  if (dl2 > sb.maxCorr * sb.maxCorr) { dx *= sb.maxCorr / sqrt(dl2); }
  XN[i] = vec4f(xi + dx, 0.0);
}`];

  K.velocity = [[['FD', 'r', 'array<f32>'], ['PS', 'r', 'array<PSt>'], ['P', 'r', 'array<vec4u>'], ['X', 'r', 'array<vec4f>'], ['XP', 'r', 'array<vec4f>'], ['V', 'rw', 'array<vec4f>'], ['ATOM', 'rw', 'array<atomic<u32>>']], `
@compute @workgroup_size(${WG}) fn main(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x; if (i >= u.N) { return; }
  let ps = PS[i]; let bo = u.offB + ps.body * 32u; let bf = fdu(bo);
  if ((bf & 1u) != 0u) { return; }
  let pd = P[i]; let kin = (bf & 2u) != 0u;
  if (bitcast<f32>(pd.y) == 0.0 && !kin) { V[i] = vec4f(0.0); return; }
  var v = (X[i].xyz - XP[i].xyz) * sb.ih;
  let v0 = V[i].xyz;
  if (pd.z < 2u && !kin) {
    let dv = v - v0; let d2 = dot(dv, dv); let m2 = u.fl.z * u.fl.z;
    if (d2 > m2) { v = v0 + dv * sqrt(m2 / d2); }
  }
  let s2 = dot(v, v); let MV = u.g.w;
  if (s2 > MV * MV) { v *= MV / sqrt(s2); }
  else if (sb.last != 0u) { atomicMax(&ATOM[5u + 2u * ps.body], bitcast<u32>(s2)); }
  V[i] = vec4f(v, 0.0);
}`];

  K.bdamp = [[['FD', 'r', 'array<f32>'], ['PS', 'r', 'array<PSt>'], ['P', 'r', 'array<vec4u>'], ['ADJ', 'r', 'array<vec2u>'], ['BX', 'r', 'array<u32>'], ['X', 'r', 'array<vec4f>'], ['V', 'r', 'array<vec4f>'], ['XN', 'rw', 'array<vec4f>']], `
@compute @workgroup_size(${WG}) fn main(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x; if (i >= u.N) { return; }
  let ps = PS[i]; let bo = u.offB + ps.body * 32u; let bf = fdu(bo);
  let vi = V[i];
  let kd = FD[bo + 5u];
  let pi = P[i]; let wi = bitcast<f32>(pi.y);
  if ((bf & 3u) != 0u || kd <= 0.0 || wi == 0.0) { XN[i] = vi; return; }
  let xi = X[i].xyz;
  var acc = vec3f(0.0); var cnt = 0.0;
  for (var a = ps.adj0; a < PS[i + 1u].adj0; a++) {
    let e = ADJ[a]; let q = e.x;
    if (bxbit(BX[q >> 2u], q)) { continue; }
    let wj = bitcast<f32>(P[e.y].y); let ws = wi + wj;
    if (ws == 0.0) { continue; }
    let d = X[e.y].xyz - xi; let nn = d / max(length(d), 1e-9);
    let dv = dot(V[e.y].xyz - vi.xyz, nn) * kd / ws;
    acc += wi * dv * nn; cnt += 1.0;
  }
  XN[i] = vec4f(vi.xyz + acc * (u.k.z / max(1.0, cnt * 0.25)), 0.0);
}`];

  K.press = [[['FD', 'r', 'array<f32>'], ['PS', 'r', 'array<PSt>'], ['P', 'r', 'array<vec4u>'], ['ADJ', 'r', 'array<vec2u>'], ['BX', 'r', 'array<u32>'], ['BRK', 'r', 'array<vec4f>'], ['X', 'r', 'array<vec4f>'], ['R', 'rw', 'array<vec4f>']], `
@compute @workgroup_size(${WG}) fn main(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x; if (i >= u.N) { return; }
  let ps = PS[i]; let bf = fdu(u.offB + ps.body * 32u);
  if ((bf & 3u) != 0u) { return; }
  let xi = X[i].xyz;
  var s = 0.0; var cnt = 0.0;
  for (var a = ps.adj0; a < PS[i + 1u].adj0; a++) {
    let e = ADJ[a]; let q = e.x;
    if (bxbit(BX[q >> 2u], q)) { continue; }
    s += 1.0 - length(X[e.y].xyz - xi) / BRK[q].z; cnt += 1.0;
  }
  R[i].w = select(0.0, s / cnt, cnt > 0.0);
}`];

  K.fracture = [[['FD', 'r', 'array<f32>'], ['PS', 'r', 'array<PSt>'], ['P', 'r', 'array<vec4u>'], ['BIJ', 'r', 'array<vec2u>'], ['BRK', 'rw', 'array<vec4f>'], ['BC2', 'r', 'array<vec2f>'], ['BX', 'rw', 'array<atomic<u32>>'], ['X', 'r', 'array<vec4f>']], `
@compute @workgroup_size(${WG}) fn main(@builtin(global_invocation_id) gid: vec3u) {
  let q = gid.x; if (q >= u.B) { return; }
  if (bxbit(atomicLoad(&BX[q >> 2u]), q)) { return; }
  let ij = BIJ[q];
  let bo = bodyOf(ij.x); let bf = fdu(bo);
  if ((bf & 3u) != 0u) { return; }
  let L = length(X[ij.y].xyz - X[ij.x].xyz);
  var b = BRK[q]; let c2 = BC2[q];
  let pl = FD[bo + 12u]; let str = FD[bo + 11u];
  if (pl > 0.0 && c2.y == 0.0) {
    let st0 = L / b.x - 1.0; let y = 0.06;
    if (st0 > y || st0 < -y) {
      let nr = b.x + (L - b.x * (1.0 + select(-y, y, st0 > 0.0))) * pl;
      b.x = max(nr, b.z * 0.55);
      BRK[q] = b;
    }
  }
  let st = L / b.z - 1.0; let sr = L / b.x - 1.0;
  if (st > b.w * str || sr > b.w * str || sr < -c2.x * str) { atomicOr(&BX[q >> 2u], 1u << ((q & 3u) * 8u)); }
}`];

  function GpuSolver(device, info) {
    this.dev = device; this.info = info || '';
    this.pipes = {}; this.bufs = {}; this.layouts = {};
    this.lost = false;
    device.lost.then(() => { this.lost = true; });
    const S1 = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform', hasDynamicOffset: true, minBindingSize: 48 } }] });
    this.s1Layout = S1;
    this.c2Layout = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform', hasDynamicOffset: true, minBindingSize: 16 } }] });
    for (const name in K) {
      const [binds, body] = K[name];
      let decl = '';
      const entries = [{ binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } }];
      binds.forEach(([bn, acc, ty], k) => {
        decl += `@group(0) @binding(${k + 1}) var<storage, ${acc === 'rw' ? 'read_write' : 'read'}> ${bn}: ${ty};\n`;
        entries.push({ binding: k + 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: acc === 'rw' ? 'storage' : 'read-only-storage' } });
      });
      // helpers refer to FD/PS only when the kernel binds them
      const has = (n) => binds.some(b => b[0] === n);
      let head = HEAD;
      if (!has('FD')) head = head.replace(/fn fdu[^\n]*\n/, '');
      if (!has('PS') || !has('FD')) head = head.replace(/fn bodyOf[^\n]*\n/, '');
      const code = head + decl + (name === 'collide' ? SDF : '') + body.replace('fn main(@builtin(global_invocation_id) gid: vec3u) {', 'fn main(@builtin(global_invocation_id) gid0: vec3u, @builtin(num_workgroups) nw: vec3u) { let gid = vec3u(gid0.x + gid0.y * nw.x * ' + WG + 'u, 0u, 0u);');
      const mod = device.createShaderModule({ code, label: name });
      const l0 = device.createBindGroupLayout({ entries });
      const pl = device.createPipelineLayout({ bindGroupLayouts: name === 'bondsGS' ? [l0, S1, this.c2Layout] : [l0, S1] });
      this.layouts[name] = l0;
      this.pipes[name] = { pipe: device.createComputePipeline({ layout: pl, compute: { module: mod, entryPoint: 'main' }, label: name }), binds: binds.map(b => b[0]), mod };
    }
  }

  GpuSolver.create = async function () {
    const nav = (typeof navigator !== 'undefined') ? navigator : null;
    if (!nav || !nav.gpu) throw new Error('WebGPU is not available');
    const ad = await nav.gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!ad) throw new Error('No WebGPU adapter');
    const L = ad.limits;
    const need = {
      maxStorageBuffersPerShaderStage: Math.min(L.maxStorageBuffersPerShaderStage, 10),
      maxStorageBufferBindingSize: L.maxStorageBufferBindingSize,
      maxBufferSize: L.maxBufferSize,
      maxComputeWorkgroupStorageSize: Math.min(L.maxComputeWorkgroupStorageSize, 16384),
      maxComputeInvocationsPerWorkgroup: Math.min(L.maxComputeInvocationsPerWorkgroup, 256),
      maxComputeWorkgroupSizeX: Math.min(L.maxComputeWorkgroupSizeX, 256),
    };
    if (need.maxStorageBuffersPerShaderStage < 8) throw new Error('GPU allows too few storage buffers');
    const dev = await ad.requestDevice({ requiredLimits: need });
    dev.pushErrorScope('validation');
    let info = '';
    try { const ai = ad.info || (ad.requestAdapterInfo ? await ad.requestAdapterInfo() : null); if (ai) info = [ai.vendor, ai.architecture, ai.device, ai.description].filter(Boolean).join(' '); } catch (e) { /* ignore */ }
    const g = new GpuSolver(dev, info);
    const errs = [];
    for (const n in g.pipes) { const ci = await g.pipes[n].mod.getCompilationInfo(); for (const m of ci.messages) if (m.type === 'error') errs.push(n + ': ' + m.message + ' @' + m.lineNum); }
    const e = await dev.popErrorScope();
    if (e) errs.push(e.message);
    if (errs.length) throw new Error('GPU shader error: ' + errs.join(' | '));
    return g;
  };

  const SU = () => GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC;
  GpuSolver.prototype._buf = function (name, bytes, usage) {
    bytes = Math.max(16, Math.ceil(bytes / 16) * 16);
    const o = this.bufs[name];
    if (o && o.size >= bytes) return o;
    if (o) o.destroy();
    const b = this.dev.createBuffer({ size: bytes, usage: usage || SU(), label: name });
    this.bufs[name] = b; this._bgDirty = true;
    return b;
  };
  GpuSolver.prototype._put = function (name, arr, off) { this.dev.queue.writeBuffer(this.bufs[name], off || 0, arr.buffer, arr.byteOffset, Math.ceil(arr.byteLength / 4) * 4); };

  // topology: once per build (bonds, adjacency, static particle data)
  GpuSolver.prototype._init = function (E) {
    const N = E.N, B = E.B;
    this.N = N; this.B = B; this.serial = E._serial;
    this._buf('U', 512, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
    for (const n of ['X', 'XP', 'V', 'XN', 'R', 'ANC']) this._buf(n, 16 * N);
    this._buf('P', 16 * N);
    this._buf('PS', 32 * (N + 1)); this._buf('ADJ', 8 * 2 * B); this._buf('BIJ', 8 * B);
    this._buf('BRK', 16 * B); this._buf('BC2', 8 * B); this._buf('BX', Math.ceil(B / 4) * 4);
    this._buf('PLK', 16 * N);
    let hs = 4096; while (hs < N) hs <<= 1;
    this.hs = hs; this.hcap = 8;
    this._buf('HT', 4 * hs * (1 + this.hcap));
    // static per particle
    const ps = new ArrayBuffer(32 * (N + 1)), pu = new Uint32Array(ps), pi = new Int32Array(ps), pf = new Float32Array(ps);
    for (let i = 0; i <= N; i++) {
      const o = 8 * i;
      pu[o + 1] = E.adjStart[i];
      if (i === N) break;
      pu[o] = E.pb[i]; pu[o + 2] = E.nb0[i]; pi[o + 3] = E.boneRef[i];
      pf[o + 4] = E.smw[i]; pf[o + 5] = E.shm[i]; pf[o + 6] = E.w0[i]; pf[o + 7] = E.rad[i];
    }
    this._put('PS', pu);
    const adj = new Uint32Array(4 * B);
    for (let a = 0; a < 2 * B; a++) { const q = E.adj[a]; adj[2 * a] = q; adj[2 * a + 1] = E.bi[q] === findOwner(E, a) ? E.bj[q] : E.bi[q]; }
    this._put('ADJ', adj);
    const bij = new Uint32Array(2 * B); for (let q = 0; q < B; q++) { bij[2 * q] = E.bi[q]; bij[2 * q + 1] = E.bj[q]; }
    this._put('BIJ', bij);
    // greedy bond colouring (bonds of one colour never share a molecule), then bonds sorted by colour
    {
      const m0 = new Uint32Array(N), m1 = new Uint32Array(N), col = new Uint8Array(B), cnt = new Uint32Array(64);
      let extra = []; // bonds that did not fit in 64 colours get solved in a last averaged pass
      for (let q = 0; q < B; q++) {
        const i = E.bi[q], j = E.bj[q], a = m0[i] | m0[j], b = m1[i] | m1[j];
        let c = -1;
        if (a !== 0xffffffff) { c = 31 - Math.clz32(~a & (a + 1)); m0[i] |= 1 << c; m0[j] |= 1 << c; }
        else if (b !== 0xffffffff) { const k = 31 - Math.clz32(~b & (b + 1)); m1[i] |= 1 << k; m1[j] |= 1 << k; c = 32 + k; }
        if (c < 0) { extra.push(q); col[q] = 255; continue; }
        col[q] = c; cnt[c]++;
      }
      const ncol = cnt.reduce((m, v, k) => v ? k + 1 : m, 0);
      const start = new Uint32Array(ncol + 1); for (let c = 0; c < ncol; c++) start[c + 1] = start[c] + cnt[c];
      const fillc = start.slice(0, ncol), ord = new Uint32Array(Math.max(1, B));
      for (let q = 0; q < B; q++) if (col[q] !== 255) ord[fillc[col[q]]++] = q;
      this._buf('BORD', 4 * B); this._put('BORD', ord);
      this.colors = []; for (let c = 0; c < ncol; c++) if (cnt[c]) this.colors.push([start[c], cnt[c]]);
      this.colorExtra = extra.length;
      const cu = new Uint32Array(64 * Math.max(1, this.colors.length));
      this.colors.forEach(([s0, n], k) => { cu[64 * k] = s0; cu[64 * k + 1] = n; });
      this._buf('CU', cu.byteLength, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST); this._put('CU', cu);
    }
    const bc = new Float32Array(2 * B); for (let q = 0; q < B; q++) { bc[2 * q] = E.bc[q]; bc[2 * q + 1] = E.bbone[q]; }
    this._put('BC2', bc);
    this.xb = new Float32Array(4 * N); this.vb = new Float32Array(4 * N); this.pb = new Uint32Array(4 * N); this.pbf = new Float32Array(this.pb.buffer);
    this.clSerial = -1; this.resident = false; this.lcount = -1;
    this._bgDirty = true;
  };
  // owner particle of adjacency slot a
  function findOwner(E, a) {
    if (!E._adjOwner || E._adjOwner.length !== E.adj.length) {
      const o = new Int32Array(E.adj.length);
      for (let i = 0; i < E.N; i++) for (let k = E.adjStart[i]; k < E.adjStart[i + 1]; k++) o[k] = i;
      E._adjOwner = o;
    }
    return E._adjOwner[a];
  }

  // engine-owned state that lives on the GPU while it runs there (rest lengths, rest shape, anchors)
  GpuSolver.prototype._uploadResident = function (E) {
    const N = this.N, B = this.B;
    const r4 = new Float32Array(4 * N), a4 = new Float32Array(4 * N);
    for (let i = 0; i < N; i++) { r4[4 * i] = E.r[3 * i]; r4[4 * i + 1] = E.r[3 * i + 1]; r4[4 * i + 2] = E.r[3 * i + 2]; r4[4 * i + 3] = E.press[i]; a4[4 * i] = E.ancPos[3 * i]; a4[4 * i + 1] = E.ancPos[3 * i + 1]; a4[4 * i + 2] = E.ancPos[3 * i + 2]; }
    this._put('R', r4); this._put('ANC', a4);
    const brk = new Float32Array(4 * B);
    for (let q = 0; q < B; q++) { brk[4 * q] = E.br[q]; brk[4 * q + 1] = E.bk[q]; brk[4 * q + 2] = E.br0[q]; brk[4 * q + 3] = E.bs[q]; }
    this._put('BRK', brk);
    this.resident = true; E._bxDirty = true;
  };
  // hand the GPU-owned state back before the CPU solver takes over a frame
  GpuSolver.prototype.download = async function (E) {
    if (!this.resident || this.serial !== E._serial) { this.resident = false; return; }
    const N = this.N, B = this.B, dev = this.dev;
    const sz = 16 * B + 16 * N;
    const st = dev.createBuffer({ size: sz, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    const enc = dev.createCommandEncoder();
    enc.copyBufferToBuffer(this.bufs.BRK, 0, st, 0, 16 * B);
    enc.copyBufferToBuffer(this.bufs.ANC, 0, st, 16 * B, 16 * N);
    dev.queue.submit([enc.finish()]);
    await st.mapAsync(GPUMapMode.READ);
    const f = new Float32Array(st.getMappedRange().slice(0));
    st.unmap(); st.destroy();
    for (let q = 0; q < B; q++) E.br[q] = f[4 * q];
    const o = 4 * B;
    for (let i = 0; i < N; i++) { E.ancPos[3 * i] = f[o + 4 * i]; E.ancPos[3 * i + 1] = f[o + 4 * i + 1]; E.ancPos[3 * i + 2] = f[o + 4 * i + 2]; }
    this.resident = false;
  };

  GpuSolver.prototype._clusters = function (E) {
    const list = [];
    for (let k = 0; k < E.bodies.length; k++) for (const C of E.bodies[k].poseClusters) list.push([C, k]);
    const nPose = list.length;
    for (let k = 0; k < E.bodies.length; k++) for (const C of E.bodies[k].clusters) list.push([C, k]);
    let tot = 0; for (const [C] of list) tot += C.m.length + (C.f ? C.f.length : 0);
    const hdrN = 8 * list.length;
    const clm = new Uint32Array(hdrN + tot + 4);
    let o = hdrN;
    list.forEach(([C, k], c) => {
      const h = 8 * c;
      clm[h] = o; clm[h + 1] = C.m.length; clm.set(C.m, o); o += C.m.length;
      clm[h + 2] = o; clm[h + 3] = C.f ? C.f.length : 0; if (C.f) { clm.set(C.f, o); o += C.f.length; }
      clm[h + 4] = k;
    });
    this._buf('CLM', clm.byteLength); this._put('CLM', clm);
    this._buf('CQ', 32 * Math.max(1, list.length));
    this.clList = list; this.nPose = nPose; this.nSoft = list.length - nPose;
    this.clSerial = E._clSerial;
  };

  GpuSolver.prototype._bind = function () {
    const dev = this.dev;
    this.bg = {};
    for (const name in this.pipes) {
      const P = this.pipes[name];
      const entries = [{ binding: 0, resource: { buffer: this.bufs.U } }];
      P.binds.forEach((bn, k) => entries.push({ binding: k + 1, resource: { buffer: this.bufs[bn] } }));
      this.bg[name] = dev.createBindGroup({ layout: this.layouts[name], entries });
    }
    this.bgC = dev.createBindGroup({ layout: this.c2Layout, entries: [{ binding: 0, resource: { buffer: this.bufs.CU, size: 16 } }] });
    this.bgS = dev.createBindGroup({ layout: this.s1Layout, entries: [{ binding: 0, resource: { buffer: this.bufs.S, size: 48 } }] });
    this._bgDirty = false;
  };

  /* one frame on the GPU. ctx comes from the engine right before its substep loop. */
  GpuSolver.prototype.run = async function (E, ctx) {
    if (this.lost) throw new Error('GPU device lost');
    const dev = this.dev;
    if (this.serial !== E._serial || this.N !== E.N) this._init(E);
    if (!this.resident) this._uploadResident(E);
    if (this.clSerial !== E._clSerial) this._clusters(E);
    const N = E.N, bodies = E.bodies, nb = bodies.length, ns = ctx.ns, cols = ctx.cols, nc = cols.length;
    const H = GpuSolver.H;

    // frame data
    const offB = 0, offK = nb * 32, offC = offK + ns * nb * 12, offX = offC + nc * 16, fdN = offX + ns * nc * 24;
    const fd = new Float32Array(fdN + 4), fu = new Uint32Array(fd.buffer);
    const qb = [0, 0, 0, 1], qa = [0, 0, 0, 1];
    let anyDamp = false;
    for (let k = 0; k < nb; k++) {
      const b = bodies[k], o = offB + 32 * k, sm = ctx.shape[k];
      const kin = b.kinematic && b.kin;
      fu[o] = (b.asleep ? 1 : 0) | (kin ? 2 : 0) | (b.params.stand ? 4 : 0) | (b.softSeg ? 8 : 0) | (b.skeleton ? 16 : 0) | (b.ko > 0.4 && !b.kinematic ? 32 : 0);
      fd[o + 1] = b.mu; fd[o + 2] = b.shatter; fd[o + 3] = b.drag; fd[o + 4] = b.stiff; fd[o + 5] = b.damp;
      fd[o + 6] = Math.min(b.koSpeed, 1e30); fd[o + 7] = Math.min(b.boneSnap, 1e30);
      fd[o + 8] = Math.pow(0.0025 * b.anchorStr * (60 * ctx.dt * 8 / ns), 2);
      fd[o + 9] = b.goo || 0; fd[o + 10] = b.pmass; fd[o + 11] = b.str; fd[o + 12] = b.plastic;
      fd[o + 13] = b.softSeg && E.frame - (b.touchT ?? -99) < 2 ? (b.params.crush != null ? b.params.crush : 1) : 0;
      if (b.damp > 0 && !b.asleep && !b.kinematic) anyDamp = true;
      if (sm) { fd.set(sm[0], o + 16); fd.set(sm[1], o + 22); }
      if (kin) for (let s = 0; s < ns; s++) {
        const tb = (s + 1) / ns;
        H.nlerpQ(b.kin.a.q, b.kin.b.q, tb, qb);
        const m = H.quatToMat(qb[0], qb[1], qb[2], qb[3]), ko = offK + (s * nb + k) * 12;
        for (let j = 0; j < 9; j++) fd[ko + j] = m[j];
        fd[ko + 9] = b.kin.a.p[0] + (b.kin.b.p[0] - b.kin.a.p[0]) * tb; fd[ko + 10] = b.kin.a.p[1] + (b.kin.b.p[1] - b.kin.a.p[1]) * tb; fd[ko + 11] = b.kin.a.p[2] + (b.kin.b.p[2] - b.kin.a.p[2]) * tb;
      }
    }
    for (let c = 0; c < nc; c++) {
      const C = cols[c], o = offC + 16 * c, t = ctx.ctype[c], d0 = ctx.cdim[3 * c], d1 = ctx.cdim[3 * c + 1], d2 = ctx.cdim[3 * c + 2];
      fd[o] = t; fd[o + 1] = d0; fd[o + 2] = d1; fd[o + 3] = d2; fd[o + 4] = ctx.cmu[c];
      fd[o + 5] = ctx.cspin[6 * c]; fd[o + 6] = ctx.cspin[6 * c + 1]; fd[o + 7] = ctx.cspin[6 * c + 2];
      fd[o + 8] = ctx.cshat[c]; fd[o + 9] = (C.bound + 0.06) * (C.bound + 0.06);
      let kAx = -1, kH = 0;
      if (ctx.cshat[c] < 0.45) {
        if (t === 0) { const m = d0 <= d1 && d0 <= d2 ? 0 : d1 <= d2 ? 1 : 2, dm = [d0, d1, d2][m], d2nd = Math.min(...[d0, d1, d2].filter((_, q) => q !== m)); if (dm < 0.3 * d2nd) { kAx = m; kH = dm; } }
        else if (t === 2 && d1 < 0.3 * Math.min(d0, d2)) { kAx = 1; kH = d1; }
      }
      if (C._ring) { kAx = 1; kH = d1; }
      fd[o + 15] = (C._angS || 0) * C.bound; fd[o + 10] = kAx; fd[o + 11] = kH; fd[o + 14] = t === 4 ? d1 : t === 5 ? d0 : Math.min(d0, d1, d2); fd[o + 12] = ctx.cB[c] < Infinity ? ctx.cB[c] : 1e30;
      for (let s = 0; s < ns; s++) {
        const ta = s / ns, tb = (s + 1) / ns, xo = offX + (s * nc + c) * 24;
        H.nlerpQ(C.a.q, C.b.q, ta, qa); H.nlerpQ(C.a.q, C.b.q, tb, qb);
        const ma = H.quatToMat(qa[0], qa[1], qa[2], qa[3]), mb = H.quatToMat(qb[0], qb[1], qb[2], qb[3]);
        for (let j = 0; j < 9; j++) { fd[xo + j] = ma[j]; fd[xo + 9 + j] = mb[j]; }
        for (let j = 0; j < 3; j++) { fd[xo + 18 + j] = C.a.p[j] + (C.b.p[j] - C.a.p[j]) * ta; fd[xo + 21 + j] = C.a.p[j] + (C.b.p[j] - C.a.p[j]) * tb; }
      }
    }
    this._buf('FD', fd.byteLength); this._put('FD', fd);

    // atomics: header, per-body out, collider momentum, logs
    const cpOff = 4 + 2 * nb, snapOff = (cpOff + nc + 3) & ~3, gooOff = snapOff + 4 * SNAPCAP, atomN = gooOff + 2 * GOOCAP;
    this._buf('ATOM', 4 * atomN);
    const head = new Uint32Array(snapOff);
    for (let c = 0; c < nc; c++) head[cpOff + c] = Math.max(0, Math.round(ctx.cP[c] * 1000));
    this._put('ATOM', head);

    // substep uniforms
    const slots = 2 * ns;
    this._buf('S', SLOT * slots, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
    const sbuf = new ArrayBuffer(SLOT * slots), su = new Uint32Array(sbuf), sf = new Float32Array(sbuf);
    for (let s = 0; s < ns; s++) for (let v = 0; v < 2; v++) {
      const o = (2 * s + v) * SLOT / 4;
      su[o] = s; su[o + 1] = v; su[o + 2] = ((s % ctx.ppEvery) === ctx.ppEvery - 1 || s === ns - 1) ? 1 : 0; su[o + 3] = s === ns - 1 ? 1 : 0;
      sf[o + 4] = s / ns; sf[o + 5] = (s + 1) / ns; sf[o + 6] = ctx.h; sf[o + 7] = ctx.ih; sf[o + 8] = 2.0 * ctx.h * ctx.ppEvery; sf[o + 9] = ctx.dt; sf[o + 10] = E._tsK || 1; sf[o + 11] = E._gooK != null ? E._gooK : 1;
    }
    this._put('S', new Uint32Array(sbuf));

    // frame uniform
    const ub = new ArrayBuffer(512), uu = new Uint32Array(ub), uf = new Float32Array(ub);
    const flds = (ctx.fields || []).filter(F => F.type === 'wind' || F.type === 'vortex' || F.type === 'attract').slice(0, 8);
    uu[0] = N; uu[1] = nb; uu[2] = nc; uu[3] = flds.length; uu[4] = offB; uu[5] = offK; uu[6] = offC; uu[7] = offX;
    uu[8] = this.nPose; uu[9] = this.hs - 1; uu[10] = E.B; uu[11] = E.frame >>> 0; uu[12] = ctx.floorOn ? 1 : 0; uu[13] = GpuSolver.ITERS; uu[14] = E.lcount; uu[15] = cpOff;
    uf[16] = ctx.gx; uf[17] = ctx.gy; uf[18] = ctx.gz; uf[19] = H.MAXV;
    uf[20] = ctx.floorY; uf[21] = ctx.floorMu; uf[22] = ctx.dvMax; uf[23] = ctx.ppMu;
    uf[24] = ctx.icell; uf[25] = GpuSolver.OMEGA; uf[26] = GpuSolver.DAMPW; uf[27] = GpuSolver.CONTACTW;
    uu[28] = snapOff; uu[29] = gooOff; uu[30] = this.nSoft; uu[31] = this.hcap;
    flds.forEach((F, k) => {
      const o = 32 + 12 * k, ty = F.type === 'wind' ? 1 : F.type === 'vortex' ? 2 : 3;
      uf[o] = ty; uf[o + 1] = F.strength || 0; uf[o + 2] = ty === 2 ? (F.radius || 4) : (F.radius || 0); uf[o + 3] = F.lift || 0;
      uf[o + 4] = F.p ? F.p[0] : 0; uf[o + 5] = F.p ? F.p[1] : 0; uf[o + 6] = F.p ? F.p[2] : 0;
      const d = ty === 1 ? F.dir : ty === 2 ? F.axis : null;
      if (d) { uf[o + 8] = d[0]; uf[o + 9] = d[1]; uf[o + 10] = d[2]; }
    });
    this._put('U', uu);

    // dynamic particle state
    const xb = this.xb, vb = this.vb, pb = this.pb, pbf = this.pbf, x = E.x, v = E.v;
    for (let i = 0; i < N; i++) {
      const i3 = 3 * i, i4 = 4 * i;
      xb[i4] = x[i3]; xb[i4 + 1] = x[i3 + 1]; xb[i4 + 2] = x[i3 + 2];
      vb[i4] = v[i3]; vb[i4 + 1] = v[i3 + 1]; vb[i4 + 2] = v[i3 + 2];
      pb[i4] = (E.anc[i] ? 1 : 0) | (E.cand[i] ? 2 : 0) | (E.dead[i] ? 8 : 0) | (E.nbb[i] << 8); pbf[i4 + 1] = E.w[i]; pb[i4 + 2] = 0; pb[i4 + 3] = E.plc[i];
    }
    this._put('X', xb); this._put('V', vb); this._put('P', pb);
    if (E._bxDirty) { const n4 = Math.ceil(E.B / 4) * 4; let src = E.bx; if (src.length < n4) { src = new Uint8Array(n4); src.set(E.bx); } this._put('BX', src.subarray(0, n4)); E._bxDirty = false; }
    if (E.lcount > 0) {
      const lc = E.lcount;
      this._buf('LNK', 16 * lc);
      const lk = new Float32Array(4 * lc), lu = new Uint32Array(lk.buffer);
      for (let q = 0; q < lc; q++) { lu[4 * q] = E.li[q]; lu[4 * q + 1] = E.lj[q]; lk[4 * q + 2] = E.lr[q]; lk[4 * q + 3] = E.lx[q]; }
      this._put('LNK', lk);
      if (this.lcount !== lc) { const pl = new Int32Array(4 * N); for (let i = 0; i < N; i++) { pl[4 * i] = E.plk[3 * i]; pl[4 * i + 1] = E.plk[3 * i + 1]; pl[4 * i + 2] = E.plk[3 * i + 2]; pl[4 * i + 3] = -1; } this._put('PLK', pl); }
    } else this._buf('LNK', 16);
    this.lcount = E.lcount;
    // cluster rotations (and whether each is new and needs a full fit)
    const ncl = this.clList.length;
    if (ncl) {
      const cq = new Float32Array(8 * ncl);
      this.clList.forEach(([C], c) => { const q = C.q || [0, 0, 0, 1]; cq[8 * c] = q[0]; cq[8 * c + 1] = q[1]; cq[8 * c + 2] = q[2]; cq[8 * c + 3] = q[3]; cq[8 * c + 5] = C.fresh ? 1 : 0; });
      this._put('CQ', cq);
    }
    if (this._bgDirty || !this.bg) this._bind();

    // encode the whole frame
    const enc = dev.createCommandEncoder();
    const pass = enc.beginComputePass();
    const nwg = Math.ceil(N / WG);
    const SKIP = GpuSolver.SKIP || [];
    let skipped = false;
    const run = (name, slot, wg) => { if (SKIP.includes(name) || (skipped && name.startsWith('copy'))) { skipped = !name.startsWith('copy'); return; } skipped = false; pass.setPipeline(this.pipes[name].pipe); pass.setBindGroup(0, this.bg[name]); pass.setBindGroup(1, this.bgS, [slot * SLOT]); pass.dispatchWorkgroups(wg); };
    const MAXWG = 65535;
    const runN = (name, slot, count) => { if (SKIP.includes(name) || (skipped && name.startsWith('copy'))) { skipped = !name.startsWith('copy'); return; } skipped = false; const w = Math.ceil(count / WG); if (w <= MAXWG) run(name, slot, w); else { pass.setPipeline(this.pipes[name].pipe); pass.setBindGroup(0, this.bg[name]); pass.setBindGroup(1, this.bgS, [slot * SLOT]); pass.dispatchWorkgroups(MAXWG, Math.ceil(w / MAXWG)); } };
    for (let s = 0; s < ns; s++) {
      const sl = 2 * s;
      runN('predict', sl, N);
      runN('collide', sl, N);
      if (GpuSolver.JACOBI || this.colorExtra) { for (let it = 0; it < GpuSolver.ITERS; it++) { runN('bonds', sl, N); runN('copyX', sl, N); } }
      else for (let it = 0; it < GpuSolver.GSITERS; it++) for (let k = 0; k < this.colors.length; k++) {
        const n = this.colors[k][1];
        pass.setPipeline(this.pipes.bondsGS.pipe); pass.setBindGroup(0, this.bg.bondsGS); pass.setBindGroup(1, this.bgS, [sl * SLOT]); pass.setBindGroup(2, this.bgC, [k * 256]);
        const w = Math.ceil(n / WG); if (w <= MAXWG) pass.dispatchWorkgroups(w); else pass.dispatchWorkgroups(MAXWG, Math.ceil(w / MAXWG));
      }
      if (E.lcount > 0) { runN('links', sl, N); runN('copyX', sl, N); }
      if (this.nPose && !SKIP.includes('shapeP')) run('shape', sl, this.nPose);
      if (this.nSoft && !SKIP.includes('shapeS')) run('shape', sl + 1, this.nSoft);
      runN('anchor', sl, N);
      if ((s % ctx.ppEvery) === ctx.ppEvery - 1 || s === ns - 1) { run('hclear', sl, Math.ceil(this.hs / WG)); runN('hinsert', sl, N); runN('contacts', sl, N); runN('copyX', sl, N); }
      runN('velocity', sl, N);
      if (anyDamp) { runN('bdamp', sl, N); runN('copyV', sl, N); }
    }
    runN('press', 0, N);
    runN('fracture', 0, E.B);
    pass.end();

    // read back
    const bxBytes = Math.ceil(E.B / 4) * 4;
    const parts = [['X', 16 * N], ['V', 16 * N], ['P', 16 * N], ['R', 16 * N], ['BX', bxBytes], ['CQ', 32 * ncl], ['ATOM', 4 * atomN]];
    let tot = 0; const offs = {};
    for (const [n, sz] of parts) { offs[n] = tot; tot += Math.ceil(sz / 16) * 16; }
    if (!this.stage || this.stage.size < tot) { if (this.stage) this.stage.destroy(); this.stage = dev.createBuffer({ size: tot, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST }); }
    for (const [n, sz] of parts) if (sz > 0) enc.copyBufferToBuffer(this.bufs[n], 0, this.stage, offs[n], Math.ceil(sz / 4) * 4);
    dev.queue.submit([enc.finish()]);
    await this.stage.mapAsync(GPUMapMode.READ, 0, tot);
    const ab = this.stage.getMappedRange(0, tot);
    try {
      return this._apply(E, ctx, ab, offs, { nb, nc, ncl, cpOff, snapOff, gooOff });
    } finally { this.stage.unmap(); }
  };

  GpuSolver.prototype._apply = function (E, ctx, ab, offs, L) {
    const N = E.N, x = E.x, v = E.v;
    const X = new Float32Array(ab, offs.X, 4 * N), V = new Float32Array(ab, offs.V, 4 * N), P = new Uint32Array(ab, offs.P, 4 * N), RR = new Float32Array(ab, offs.R, 4 * N);
    for (let i = 0; i < N; i++) {
      const i3 = 3 * i, i4 = 4 * i;
      x[i3] = X[i4]; x[i3 + 1] = X[i4 + 1]; x[i3 + 2] = X[i4 + 2];
      v[i3] = V[i4]; v[i3 + 1] = V[i4 + 1]; v[i3 + 2] = V[i4 + 2];
      E.press[i] = RR[i4 + 3]; E.r[i3] = RR[i4]; E.r[i3 + 1] = RR[i4 + 1]; E.r[i3 + 2] = RR[i4 + 2];
    }
    // bonds the GPU broke this frame (fracture, knives, spikes)
    const bx = E.bx, nbb = E.nbb, cand = E.cand, bi = E.bi, bj = E.bj, B = E.B;
    const G = new Uint8Array(ab, offs.BX, B);
    let broken = 0;
    for (let q = 0; q < B; q++) {
      if (G[q] && !bx[q]) {
        bx[q] = 1; const i = bi[q], j = bj[q]; nbb[i]++; nbb[j]++; cand[i] = 1; cand[j] = 1; broken++;
        E.bodies[E.pb[i]].dirty = true;
      }
    }
    // anchors let go; molecules shattered by an impact
    for (let i = 0; i < N; i++) {
      const f = P[4 * i];
      if (E.anc[i] && !(f & 1)) E.anc[i] = 0;
      if (f & 4) { E._breakParticle(i); E._bxDirty = true; }
    }
    const A = new Uint32Array(ab, offs.ATOM, L.gooOff + 2 * GOOCAP), Af = new Float32Array(A.buffer, A.byteOffset, A.length);
    for (let k = 0; k < L.nb; k++) {
      const b = E.bodies[k], fl = A[4 + 2 * k];
      if (fl & 1) b.koHit = true;
      if (fl & 2) b.touchT = E.frame;
      if (!b.asleep) b.maxSpeed = Math.sqrt(Af[5 + 2 * k]);
    }
    for (let c = 0; c < L.nc; c++) ctx.cP[c] = A[L.cpOff + c] / 1000;
    const ns_ = Math.min(A[2], SNAPCAP);
    for (let k = 0; k < ns_; k++) {
      const o = L.snapOff + 4 * k, i = A[o], br_ = E.boneRef[i];
      if (br_ >= 0 && !E.dead[br_] && E._snapBone(br_, Af[o + 1], Af[o + 2], Af[o + 3])) E._bxDirty = true;
    }
    const ng = Math.min(A[3], GOOCAP);
    for (let k = 0; k < ng; k++) E._gooLink(A[L.gooOff + 2 * k], A[L.gooOff + 2 * k + 1]);
    // cluster turns, and squeeze residuals (a body bent far out of its pose gives way)
    const CQ = new Float32Array(ab, offs.CQ, 8 * L.ncl);
    this.clList.forEach(([C, k], c) => {
      if (!C.q) C.q = [0, 0, 0, 1];
      C.q[0] = CQ[8 * c]; C.q[1] = CQ[8 * c + 1]; C.q[2] = CQ[8 * c + 2]; C.q[3] = CQ[8 * c + 3]; C.fresh = false;
      if (c < this.nPose && CQ[8 * c + 4] > 0.0016) E.bodies[k].koHit = true;
    });
    return { broken };
  };

  GpuSolver.ITERS = 4;
  GpuSolver.GSITERS = 1;
  GpuSolver.JACOBI = false;
  GpuSolver.OMEGA = 0.45;
  GpuSolver.DAMPW = 0.45;
  GpuSolver.CONTACTW = 0.7;
  if (root.GPUCFG) Object.assign(GpuSolver, root.GPUCFG);
  root.ShatterGPU = GpuSolver;
})(typeof self !== 'undefined' ? self : globalThis);
