/* Shatterbond physics engine.
 * Position-based dynamics on bonded particle lattices with breakable bonds,
 * per-fragment shape matching (rigidity), analytic SDF colliders, a floor,
 * particle-particle contacts through a spatial hash, force fields and sleeping.
 * Runs inside a Web Worker (blob) or directly on the main thread as a fallback. */
(function (root) {
  'use strict';

  const SHAPE = { box: 0, sphere: 1, cylinder: 2, cone: 3, torus: 4, capsule: 5 };
  const MAXV = 70;

  function hash32(i) {
    i = Math.imul(i ^ (i >>> 16), 0x45d9f3b);
    i = Math.imul(i ^ (i >>> 16), 0x45d9f3b);
    i = i ^ (i >>> 16);
    return (i >>> 0) / 4294967296;
  }

  function Engine() {
    this.N = 0;
    this.B = 0;
    this.bodies = [];
    this.frame = 0;
    this.statBroken = 0;
  }

  /* ---------- build ---------- */
  Engine.prototype.build = function (d) {
    this._desc = d;
    let N = 0, B = 0;
    for (const b of d.bodies) { N += b.count; B += b.bondRest.length; }
    this.N = N; this.B = B;
    this.balls = []; this.ballKey = new Map();
    this.x = new Float32Array(3 * N); this.xp = new Float32Array(3 * N); this.v = new Float32Array(3 * N);
    this.r = new Float32Array(3 * N); this.w = new Float32Array(N); this.rad = new Float32Array(N);
    this.pb = new Uint16Array(N); this.seg = new Uint8Array(N); this.sk = new Uint8Array(4 * N); this.skw = new Float32Array(4 * N);
    this.nb0 = new Uint8Array(N); this.nbb = new Uint8Array(N); this.spg = new Uint8Array(N).fill(255); this.press = new Float32Array(N); this.pcnt = new Uint8Array(N); this.pdur = new Uint8Array(N); this.crx = new Float32Array(N); this.csus = new Uint8Array(N);
    this.anc = new Uint8Array(N); this.ancPos = new Float32Array(3 * N);
    this.state = new Uint8Array(N); this.cand = new Uint8Array(N); this.ct = new Uint8Array(N);
    this.dead = new Uint8Array(N);
    this.bi = new Int32Array(B); this.bj = new Int32Array(B); this.br = new Float32Array(B); this.br0 = new Float32Array(B); this.bbone = new Uint8Array(B);
    this.bk = new Float32Array(B); this.bs = new Float32Array(B); this.bc = new Float32Array(B); this.bx = new Uint8Array(B);
    this.cl = new Int32Array(N).fill(-1);
    this.tis = new Uint8Array(N); this.smw = new Float32Array(N); this.shm = new Float32Array(N); this.boneRef = new Int32Array(N).fill(-1);
    this.w0 = new Float32Array(N);
    this.boneT = d.boneTissue != null ? d.boneTissue : 255; this.cartT = d.cartTissue != null ? d.cartTissue : 255;
    this.bodies = [];
    this.statBroken = 0;
    this.frame = d.startFrame || 0;
    let po = 0, bo = 0;
    for (let k = 0; k < d.bodies.length; k++) {
      const s = d.bodies[k];
      const n = s.count, nb = s.bondRest.length;
      const q = s.quat, p = s.pos;
      const m = quatToMat(q[0], q[1], q[2], q[3]);
      let maxNb = 0;
      for (let i = 0; i < n; i++) {
        const gi = po + i, i3 = 3 * gi;
        const rx = s.rest[3 * i], ry = s.rest[3 * i + 1], rz = s.rest[3 * i + 2];
        this.r[i3] = rx; this.r[i3 + 1] = ry; this.r[i3 + 2] = rz;
        const wx = m[0] * rx + m[1] * ry + m[2] * rz + p[0];
        const wy = m[3] * rx + m[4] * ry + m[5] * rz + p[1];
        const wz = m[6] * rx + m[7] * ry + m[8] * rz + p[2];
        this.x[i3] = wx; this.x[i3 + 1] = wy; this.x[i3 + 2] = wz;
        this.xp[i3] = wx; this.xp[i3 + 1] = wy; this.xp[i3 + 2] = wz;
        this.w[gi] = s.invMass ? s.invMass[i] : 1; this.w0[gi] = this.w[gi];
        this.tis[gi] = s.tissue ? s.tissue[i] : 0;
        this.smw[gi] = s.smw ? s.smw[i] : 1;
        this.shm[gi] = s.shm ? s.shm[i] : 1;
        this.boneRef[gi] = (s.boneRef && s.boneRef[i] >= 0) ? po + s.boneRef[i] : -1;
        this.rad[gi] = s.radius;
        this.pb[gi] = k;
        this.seg[gi] = s.seg ? s.seg[i] : 0;
        // animation skinning: four segments per molecule (or just its own)
        if (s.sk) for (let k = 0; k < 4; k++) { this.sk[4 * gi + k] = s.sk[4 * i + k]; this.skw[4 * gi + k] = s.skw[4 * i + k] / 255; }
        else { for (let k = 0; k < 4; k++) this.sk[4 * gi + k] = this.seg[gi]; this.skw[4 * gi] = 1; }
        if (s.anchor && s.anchor[i] && s.params.stand) {
          this.anc[gi] = 1;
          this.ancPos[i3] = wx; this.ancPos[i3 + 1] = wy; this.ancPos[i3 + 2] = wz;
          (s._anc0 || (s._anc0 = [])).push(gi);
        }
        const v0 = s.vel || [0, 0, 0];
        this.v[i3] = v0[0]; this.v[i3 + 1] = v0[1]; this.v[i3 + 2] = v0[2];
      }
      for (let b = 0; b < nb; b++) {
        const gi = po + s.bonds[2 * b], gj = po + s.bonds[2 * b + 1];
        this.bi[bo + b] = gi; this.bj[bo + b] = gj;
        this.br[bo + b] = s.bondRest[b]; this.br0[bo + b] = s.bondRest[b];
        this.bk[bo + b] = s.bondK ? s.bondK[b] : 1;
        this.bs[bo + b] = s.bondS ? s.bondS[b] : 0.25;
        this.bc[bo + b] = s.bondC ? s.bondC[b] : 0.4;
        this.nb0[gi]++; this.nb0[gj]++;
      }
      for (let b = 0; b < nb; b++) this.bbone[bo + b] = (this.tis[this.bi[bo + b]] === this.boneT && this.tis[this.bj[bo + b]] === this.boneT) ? 1 : 0;
      for (let i = 0; i < n; i++) if (this.nb0[po + i] > maxNb) maxNb = this.nb0[po + i];
      for (let i = 0; i < n; i++) this.cand[po + i] = this.nb0[po + i] < maxNb ? 1 : 0;
      const body = {
        start: po, count: n, bstart: bo, bcount: nb,
        params: s.params, anc0: s._anc0 || null, q0: (s.quat || [0, 0, 0, 1]).slice(), spacing: s.spacing, pmass: 1000 * Math.pow(s.spacing || 0.02, 3),
        asleep: !!s.params.startAsleep, sleepCnt: 0,
        aabb: new Float32Array(6), kinematic: !!s.kinematic,
        dirty: true, clusters: [], poseClusters: [], skeleton: !!s.hasSkeleton, softSeg: !!s.softSegments,
        maxSpeed: s.vel ? Math.hypot(s.vel[0], s.vel[1], s.vel[2]) : 0, broken: 0, ko: (s.params.limp || (s.hasSkeleton && !s.params.stand)) ? 1 : 0, koHit: false, segBase: null, segLast: null,
      };
      if (body.kinematic) { for (let i = 0; i < n; i++) this.w[po + i] = 0; body.asleep = false; }
      this.bodies.push(body);
      po += n; bo += nb;
    }
    // adjacency (CSR) for per-particle bond lookup
    const adjStart = new Int32Array(N + 1);
    for (let b = 0; b < B; b++) { adjStart[this.bi[b] + 1]++; adjStart[this.bj[b] + 1]++; }
    for (let i = 0; i < N; i++) adjStart[i + 1] += adjStart[i];
    const fill = adjStart.slice(0, N);
    const adj = new Int32Array(2 * B);
    for (let b = 0; b < B; b++) { adj[fill[this.bi[b]]++] = b; adj[fill[this.bj[b]]++] = b; }
    this.adjStart = adjStart; this.adj = adj;
    // spatial hash
    this.hsize = 1; while (this.hsize < 2 * N + 64) this.hsize <<= 1;
    this.hcount = new Int32Array(this.hsize + 1);
    this.hentries = new Int32Array(N);
    this.hlist = new Int32Array(N);
    // union-find scratch
    this.uf = new Int32Array(N); this.uf2 = new Int32Array(N); this.uf3 = new Int32Array(N);
    // sticky goo: links made on contact between torn molecules, and molecules stuck to colliders
    this.LMAX = Math.min(3 * N + 1024, 3000000);
    this.li = new Int32Array(this.LMAX); this.lj = new Int32Array(this.LMAX);
    this.lr = new Float32Array(this.LMAX); this.l0 = new Float32Array(this.LMAX); this.ll = new Float32Array(this.LMAX); this.lx = new Uint8Array(this.LMAX);
    this.lcount = 0; this.plk = new Int32Array(3 * N).fill(-1); this.plc = new Uint8Array(N);
    this.stk = new Int16Array(N).fill(-1); this.stq = new Float32Array(3 * N);
    this.colIds = new Map(); this.events = [];
    for (const body of this.bodies) { this._rebuildClusters(body); this._aabb(body); }
    this.colPrev = null;
    this.xlk = null; this._serial = (this._serial || 0) + 1; this._bxDirty = true; this._slow = null; this.outX = null;
    return { N, B };
  };

  /* ---------- append bodies to a running simulation (play mode spawns) ----------
   * Rebuilds with the old bodies plus the new ones, then copies every per-molecule / per-bond state array back
   * over the old part: new molecules and bonds are appended at the end, so old indices keep their meaning. */
  const APPEND_SKIP = new Set(['hcount', 'hentries', 'hlist', 'uf', 'uf2', 'uf3', 'adjStart', 'adj']);
  const APPEND_DROP = ['piece', 'cvn', 'hbm', 'hcc', 'hec', 'hcf', 'hef', '_cbox', 'xlk', 'outX', '_xb', '_slow', 'colPrev'];
  Engine.prototype.append = function (newBodies) {
    const old = {}; for (const k of Object.keys(this)) old[k] = this[k];
    for (const s of this._desc.bodies) s._anc0 = undefined; // build pushes anchors into this; old bodies keep their own list
    const d = Object.assign({}, this._desc, { bodies: this._desc.bodies.concat(newBodies), startFrame: this.frame });
    this.build(d);
    for (const k in old) {
      const a = old[k], b = this[k];
      if (ArrayBuffer.isView(a)) {
        if (APPEND_SKIP.has(k)) continue;
        if (ArrayBuffer.isView(b) && b.constructor === a.constructor && b.length >= a.length && b !== a) b.set(a);
        continue;
      }
      if (['N', 'B', 'bodies', 'hsize', 'LMAX', '_desc', '_serial', 'boneT', 'cartT'].includes(k)) continue;
      this[k] = a;
    }
    this.bodies = old.bodies.concat(this.bodies.slice(old.bodies.length));
    for (const k of APPEND_DROP) this[k] = null;
    this._bxDirty = true; this._serial = (old._serial || 0) + 1;
    return { N: this.N, B: this.B };
  };

  /* ---------- helpers ---------- */
  function quatToMat(x, y, z, w) {
    const xx = x * x, yy = y * y, zz = z * z, xy = x * y, xz = x * z, yz = y * z, wx = w * x, wy = w * y, wz = w * z;
    return [1 - 2 * (yy + zz), 2 * (xy - wz), 2 * (xz + wy),
      2 * (xy + wz), 1 - 2 * (xx + zz), 2 * (yz - wx),
      2 * (xz - wy), 2 * (yz + wx), 1 - 2 * (xx + yy)];
  }
  // per segment 3x4 transforms (rotation rows, then translation) -> dual quaternions [qx qy qz qw dx dy dz dw]
  function segDQ(S, nS, out) {
    if (!out || out.length < 8 * nS) out = new Float32Array(8 * nS);
    for (let s = 0; s < nS; s++) {
      const o = 12 * s, m0 = S[o], m1 = S[o + 1], m2 = S[o + 2], m3 = S[o + 3], m4 = S[o + 4], m5 = S[o + 5], m6 = S[o + 6], m7 = S[o + 7], m8 = S[o + 8];
      const tr = m0 + m4 + m8; let x, y, z, w;
      if (tr > 0) { const k = Math.sqrt(tr + 1) * 2; w = 0.25 * k; x = (m7 - m5) / k; y = (m2 - m6) / k; z = (m3 - m1) / k; }
      else if (m0 > m4 && m0 > m8) { const k = Math.sqrt(1 + m0 - m4 - m8) * 2; w = (m7 - m5) / k; x = 0.25 * k; y = (m1 + m3) / k; z = (m2 + m6) / k; }
      else if (m4 > m8) { const k = Math.sqrt(1 + m4 - m0 - m8) * 2; w = (m2 - m6) / k; x = (m1 + m3) / k; y = 0.25 * k; z = (m5 + m7) / k; }
      else { const k = Math.sqrt(1 + m8 - m0 - m4) * 2; w = (m3 - m1) / k; x = (m2 + m6) / k; y = (m5 + m7) / k; z = 0.25 * k; }
      const l = Math.hypot(x, y, z, w) || 1; x /= l; y /= l; z /= l; w /= l;
      const t0 = S[o + 9], t1 = S[o + 10], t2 = S[o + 11], d = 8 * s;
      out[d] = x; out[d + 1] = y; out[d + 2] = z; out[d + 3] = w;
      out[d + 4] = 0.5 * (t0 * w + t1 * z - t2 * y); out[d + 5] = 0.5 * (-t0 * z + t1 * w + t2 * x); out[d + 6] = 0.5 * (t0 * y - t1 * x + t2 * w); out[d + 7] = -0.5 * (t0 * x + t1 * y + t2 * z);
    }
    return out;
  }
  // blend up to four dual quaternions (ids sk, weights skw from offset o) and apply to point p
  function dqSkin(DQ, sk, skw, o, px, py, pz, out) {
    let qx = 0, qy = 0, qz = 0, qw = 0, ex = 0, ey = 0, ez = 0, ew = 0, rx = 0, ry = 0, rz = 0, rw = 0, first = true;
    for (let k = o; k < o + 4; k++) {
      let w = skw[k]; if (!(w > 0)) continue;
      const d = 8 * sk[k]; if (d + 7 >= DQ.length) continue;
      if (first) { rx = DQ[d]; ry = DQ[d + 1]; rz = DQ[d + 2]; rw = DQ[d + 3]; first = false; }
      else if (DQ[d] * rx + DQ[d + 1] * ry + DQ[d + 2] * rz + DQ[d + 3] * rw < 0) w = -w;
      qx += w * DQ[d]; qy += w * DQ[d + 1]; qz += w * DQ[d + 2]; qw += w * DQ[d + 3];
      ex += w * DQ[d + 4]; ey += w * DQ[d + 5]; ez += w * DQ[d + 6]; ew += w * DQ[d + 7];
    }
    const l = Math.hypot(qx, qy, qz, qw);
    if (!(l > 1e-9)) { out[0] = px; out[1] = py; out[2] = pz; return; }
    qx /= l; qy /= l; qz /= l; qw /= l; ex /= l; ey /= l; ez /= l; ew /= l;
    const tx = 2 * (qy * pz - qz * py), ty = 2 * (qz * px - qx * pz), tz = 2 * (qx * py - qy * px);
    out[0] = px + qw * tx + (qy * tz - qz * ty) + 2 * (-ew * qx + ex * qw - ey * qz + ez * qy);
    out[1] = py + qw * ty + (qz * tx - qx * tz) + 2 * (-ew * qy + ey * qw - ez * qx + ex * qz);
    out[2] = pz + qw * tz + (qx * ty - qy * tx) + 2 * (-ew * qz + ez * qw - ex * qy + ey * qx);
  }
  function nlerpQ(a, b, t, out) {
    let bx = b[0], by = b[1], bz = b[2], bw = b[3];
    if (a[0] * bx + a[1] * by + a[2] * bz + a[3] * bw < 0) { bx = -bx; by = -by; bz = -bz; bw = -bw; }
    let x = a[0] + (bx - a[0]) * t, y = a[1] + (by - a[1]) * t, z = a[2] + (bz - a[2]) * t, w = a[3] + (bw - a[3]) * t;
    const l = 1 / Math.sqrt(x * x + y * y + z * z + w * w);
    out[0] = x * l; out[1] = y * l; out[2] = z * l; out[3] = w * l;
    return out;
  }

  Engine.prototype._find = function (i) {
    const uf = this.uf;
    while (uf[i] !== i) { uf[i] = uf[uf[i]]; i = uf[i]; }
    return i;
  };

  Engine.prototype._breakParticle = function (i) {
    const a0 = this.adjStart[i], a1 = this.adjStart[i + 1];
    let any = false;
    for (let a = a0; a < a1; a++) {
      const b = this.adj[a];
      if (this.bx[b]) continue;
      this.bx[b] = 1; this.nbb[this.bi[b]]++; this.nbb[this.bj[b]]++;
      this.cand[this.bi[b]] = 1; this.cand[this.bj[b]] = 1;
      this.statBroken++; any = true;
    }
    if (any) { this.bodies[this.pb[i]].dirty = true; this._bxDirty = true; this.candVer = (this.candVer || 0) + 1; }
    this.anc[i] = 0;
  };

  /* shape-matching clusters.
   * all  : connected components over every intact bond (fragments)
   * bone : components over intact bone-bone bonds inside one segment (bone pieces; a fracture splits them)
   * pose : components over intact bone/cartilage bonds across segments (the whole skeleton, for muscle tone)
   * A soft-tissue particle follows the bone piece of its nearest bone (boneRef) while still attached to it. */
  function ufFind(uf, i) { while (uf[i] !== i) { uf[i] = uf[uf[i]]; i = uf[i]; } return i; }
  function ufUnion(uf, a, b) { a = ufFind(uf, a); b = ufFind(uf, b); if (a !== b) { if (a < b) uf[b] = a; else uf[a] = b; } }
  Engine.prototype._find = function (i) { return ufFind(this.uf, i); };

  Engine.prototype._rebuildClusters = function (body) {
    const s0 = body.start, s1 = s0 + body.count;
    const ufA = this.uf, ufB = this.uf2, ufP = this.uf3;
    const nbb = this.nbb, nb0 = this.nb0, tis = this.tis, seg = this.seg, boneT = this.boneT, cartT = this.cartT;
    for (let i = s0; i < s1; i++) { ufA[i] = i; ufB[i] = i; ufP[i] = i; }
    const skel = body.skeleton;
    for (let b = body.bstart, e = body.bstart + body.bcount; b < e; b++) {
      if (this.bx[b]) continue;
      const i = this.bi[b], j = this.bj[b];
      ufUnion(ufA, i, j);
      if (skel) {
        const ti = tis[i], tj = tis[j];
        if (ti === boneT && tj === boneT && seg[i] === seg[j]) ufUnion(ufB, i, j);
      } else if (body.softSeg) {
        if (seg[i] === seg[j]) ufUnion(ufB, i, j); else ufUnion(ufP, i, j);
      }
    }
    if (body.softSeg) for (let b = body.bstart, e = body.bstart + body.bcount; b < e; b++) if (!this.bx[b]) ufUnion(ufP, this.bi[b], this.bj[b]);
    const cl = this.cl;
    const prevCl = new Int32Array(body.count);
    for (let i = s0; i < s1; i++) prevCl[i - s0] = cl[i];
    // bone piece of each particle (or -1 when it has torn away from its bone)
    const piece = this.piece || (this.piece = new Int32Array(this.N));
    for (let i = s0; i < s1; i++) {
      piece[i] = -1;
      if (!skel || this.dead[i]) continue;
      const br = this.boneRef[i];
      if (br < 0 || this.dead[br]) continue;
      if (ufFind(ufA, br) !== ufFind(ufA, i)) continue;
      piece[i] = ufFind(ufB, br);
    }
    if (skel) {
      // joints: bone pieces of neighbouring segments are linked by any intact tissue that spans the joint
      for (let b = body.bstart, e = body.bstart + body.bcount; b < e; b++) {
        if (this.bx[b]) continue;
        const i = this.bi[b], j = this.bj[b];
        if (seg[i] === seg[j]) continue;
        const pi = piece[i], pj = piece[j];
        if (pi < 0 || pj < 0) continue;
        ufUnion(ufP, pi, pj);
      }
    }
    const map = new Map(), groups = [], fol = new Map();
    const pmap = new Map(), pgroups = [];
    for (let i = s0; i < s1; i++) {
      cl[i] = -1;
      if (this.dead[i] || this.w0[i] === 0) continue;
      if (nbb[i] * 4 > nb0[i]) continue; // too damaged to hold shape
      const ra = ufFind(ufA, i);
      let key;
      if (body.softSeg) {
        // soft body regions (head, upper arm, thigh...): each torn-off piece of a region keeps its own shape
        // loosely; regions are joined only by flesh, so the whole body flops like a ragdoll
        key = ufFind(ufB, i) + 1;
        const pr = ufFind(ufP, i);
        let pg = pmap.get(pr);
        if (pg === undefined) { pg = pgroups.length; pmap.set(pr, pg); pgroups.push([]); }
        pgroups[pg].push(i);
      } else if (skel) {
        // bone pieces are rigid; flesh still attached to a bone piece follows it softly (jiggles, sags, tears)
        const pc = piece[i];
        if (pc < 0) continue;
        if (tis[i] !== boneT) {
          (fol.get(pc + 1) || fol.set(pc + 1, []).get(pc + 1)).push(i);
          if (this.anc[i]) { const pr = ufFind(ufP, pc); let pg = pmap.get(pr); if (pg === undefined) { pg = pgroups.length; pmap.set(pr, pg); pgroups.push([]); } pgroups[pg].push(i); }
          continue;
        }
        key = pc + 1;
        const pr = ufFind(ufP, pc);
        let pg = pmap.get(pr);
        if (pg === undefined) { pg = pgroups.length; pmap.set(pr, pg); pgroups.push([]); }
        pgroups[pg].push(i);
      } else key = ra + 1;
      let c = map.get(key);
      if (c === undefined) { c = groups.length; map.set(key, c); groups.push({ members: [], pc: prevCl[i - s0], key }); }
      groups[c].members.push(i);
    }
    const oldQ = body.clusters;
    const mk = (members, q) => {
      const m = Int32Array.from(members);
      let cx = 0, cy = 0, cz = 0;
      for (let k = 0; k < m.length; k++) { const i3 = 3 * m[k]; cx += this.r[i3]; cy += this.r[i3 + 1]; cz += this.r[i3 + 2]; }
      const inv = 1 / m.length;
      // a new cluster starts from the body's current turn, not from no turn at all: the fit cannot find its way
      // round from a half-turn (a figure placed facing backwards would otherwise fold itself inside out)
      if (!q) { const P0 = body.poseClusters && body.poseClusters.find(o => o.q); q = P0 ? P0.q.slice() : body.q0 ? body.q0.slice() : null; }
      return { m, rc: [cx * inv, cy * inv, cz * inv], q: q, fresh: true };
    };
    const out = [];
    for (const g of groups) {
      if (g.members.length < (skel ? 4 : body.softSeg ? 12 : 8)) continue;
      const C = mk(g.members, (g.pc >= 0 && oldQ[g.pc] && oldQ[g.pc].q) ? oldQ[g.pc].q.slice() : null);
      const f = skel ? fol.get(g.key) : null;
      C.f = f ? Int32Array.from(f) : null;
      out.push(C);
    }
    for (let ci = 0; ci < out.length; ci++) { const m = out[ci].m; for (let k = 0; k < m.length; k++) cl[m[k]] = ci; }
    body.clusters = out;
    const oldP = body.poseClusters || [];
    const pout = [];
    for (const g of pgroups) {
      if (g.length < 20) continue;
      let q = null; for (const o of oldP) { if (o.q && o.m.length && ufFind(ufP, o.m[0]) === ufFind(ufP, g[0])) { q = o.q.slice(); break; } }
      pout.push(mk(g, q));
    }
    body.poseClusters = pout;
    body.dirty = false;
    this._clSerial = (this._clSerial || 0) + 1;
    // fracture bookkeeping: bone pieces per segment (chips under 6 molecules do not count)
    if (skel) {
      const cnt = new Map(), per = new Int16Array(32), pos = new Float64Array(32 * 3);
      for (let i = s0; i < s1; i++) { if (tis[i] !== boneT || this.dead[i]) continue; const r0 = ufFind(ufB, i); cnt.set(r0, (cnt.get(r0) || 0) + 1); }
      const tot = new Int32Array(32); for (let i = s0; i < s1; i++) if (tis[i] === boneT && !this.dead[i]) tot[seg[i] & 31]++;
      if (!body.segTot) body.segTot = tot.slice();
      for (const [r0, c] of cnt) { const sg = seg[r0] & 31; if (c < Math.max(6, body.segTot[sg] * 0.12)) continue; per[sg]++; }
      for (let i = s0; i < s1; i++) { if (tis[i] !== boneT || this.dead[i]) continue; const sg = seg[i] & 31; pos[3 * sg] += this.x[3 * i]; pos[3 * sg + 1] += this.x[3 * i + 1]; pos[3 * sg + 2] += this.x[3 * i + 2]; }
      if (!body.segBase) { body.segBase = per.slice(); body.segLast = per.slice(); }
      else for (let sg = 0; sg < 32; sg++) {
        if (per[sg] > body.segLast[sg]) {
          const t = tot[sg] || 1;
          this.events.push({ type: 'fracture', body: this.bodies.indexOf(body), seg: sg, pieces: per[sg], base: body.segBase[sg], p: [pos[3 * sg] / t, pos[3 * sg + 1] / t, pos[3 * sg + 2] / t] });
        }
        body.segLast[sg] = Math.max(body.segLast[sg], per[sg]);
      }
    }
  };

  /* procedural snap: cut a bone piece along a jagged plane through molecule `bi`.
   * Long bones break across their length; compact ones (skull, pelvis) split on a random plane. */
  Engine.prototype._snapBone = function (bref, nx, ny, nz) {
    const body = this.bodies[this.pb[bref]], c = this.cl[bref];
    if (c < 0 || !body.clusters[c]) return false;
    const C = body.clusters[c];
    if (C.m.length < 24) return false;
    if (C.snapF != null && this.frame - C.snapF < 6) return false;
    C.snapF = this.frame;
    const r = this.r, m = C.m;
    if (!C.axis) { // principal axis of the piece in rest space (power iteration on the covariance)
      let cx = 0, cy = 0, cz = 0; for (let k = 0; k < m.length; k++) { const i3 = 3 * m[k]; cx += r[i3]; cy += r[i3 + 1]; cz += r[i3 + 2]; }
      cx /= m.length; cy /= m.length; cz /= m.length;
      let xx = 0, xy = 0, xz = 0, yy = 0, yz = 0, zz = 0;
      for (let k = 0; k < m.length; k++) { const i3 = 3 * m[k], dx = r[i3] - cx, dy = r[i3 + 1] - cy, dz = r[i3 + 2] - cz; xx += dx * dx; xy += dx * dy; xz += dx * dz; yy += dy * dy; yz += dy * dz; zz += dz * dz; }
      let ax = 0.3, ay = 1, az = 0.2;
      for (let it = 0; it < 30; it++) { const tx = xx * ax + xy * ay + xz * az, ty = xy * ax + yy * ay + yz * az, tz = xz * ax + yz * ay + zz * az; const l = Math.hypot(tx, ty, tz) || 1; ax = tx / l; ay = ty / l; az = tz / l; }
      const lam = (xx * ax + xy * ay + xz * az) * ax + (xy * ax + yy * ay + yz * az) * ay + (xz * ax + yz * ay + zz * az) * az;
      const tr = xx + yy + zz;
      C.axis = [ax, ay, az]; C.elong = lam / Math.max(1e-9, (tr - lam) * 0.5);
    }
    let px, py, pz;
    if (C.elong > 3) { px = C.axis[0]; py = C.axis[1]; pz = C.axis[2]; }
    else { // plane containing the impact direction
      const h = hash32(bref * 3 + this.frame);
      const ux = Math.cos(h * 6.283), uz = Math.sin(h * 6.283);
      px = ny * uz - nz * 0; py = nz * ux - nx * uz; pz = nx * 0 - ny * ux;
      const l = Math.hypot(px, py, pz); if (l < 1e-6) { px = 1; py = 0; pz = 0; } else { px /= l; py /= l; pz /= l; }
    }
    const b3 = 3 * bref, ox = r[b3], oy = r[b3 + 1], oz = r[b3 + 2];
    const sp = body.spacing, jag = sp * 1.1;
    const side = (i) => { const i3 = 3 * i; return (r[i3] - ox) * px + (r[i3 + 1] - oy) * py + (r[i3 + 2] - oz) * pz + (hash32(i * 977 + 13) - 0.5) * jag; };
    let cut = 0;
    for (let k = 0; k < m.length; k++) {
      const i = m[k], si = side(i);
      for (let a = this.adjStart[i], a1 = this.adjStart[i + 1]; a < a1; a++) {
        const b = this.adj[a]; if (this.bx[b] || !this.bbone[b]) continue;
        const j = this.bi[b] === i ? this.bj[b] : this.bi[b];
        if (j < i) continue;
        if ((si < 0) !== (side(j) < 0)) { this.bx[b] = 1; this.nbb[i]++; this.nbb[j]++; this.cand[i] = 1; this.cand[j] = 1; this.statBroken++; cut++; }
      }
    }
    if (cut) { body.dirty = true; this._bxDirty = true; }
    return cut > 0;
  };

  Engine.prototype._aabb = function (body) {
    const x = this.x, a = body.aabb;
    let x0 = 1e9, y0 = 1e9, z0 = 1e9, x1 = -1e9, y1 = -1e9, z1 = -1e9;
    for (let i = body.start, e = body.start + body.count; i < e; i++) {
      if (this.dead[i]) continue;
      const i3 = 3 * i, px = x[i3], py = x[i3 + 1], pz = x[i3 + 2];
      if (px < x0) x0 = px; if (px > x1) x1 = px;
      if (py < y0) y0 = py; if (py > y1) y1 = py;
      if (pz < z0) z0 = pz; if (pz > z1) z1 = pz;
    }
    a[0] = x0; a[1] = y0; a[2] = z0; a[3] = x1; a[4] = y1; a[5] = z1;
  };

  function sphereAabb(cx, cy, cz, r, a) {
    const dx = Math.max(a[0] - cx, 0, cx - a[3]);
    const dy = Math.max(a[1] - cy, 0, cy - a[4]);
    const dz = Math.max(a[2] - cz, 0, cz - a[5]);
    return dx * dx + dy * dy + dz * dz <= r * r;
  }
  function aabbOverlap(a, b, m) {
    return a[0] - m <= b[3] && a[3] + m >= b[0] && a[1] - m <= b[4] && a[4] + m >= b[1] && a[2] - m <= b[5] && a[5] + m >= b[2];
  }

  /* ---------- colliders: SDF in local space. writes into out[0]=dist, out[1..3]=local normal ---------- */
  const _o = new Float64Array(4); const _o2 = new Float64Array(4);
  function sdBox(qx, qy, qz, hx, hy, hz, o) {
    const ax = Math.abs(qx) - hx, ay = Math.abs(qy) - hy, az = Math.abs(qz) - hz;
    if (ax > 0 || ay > 0 || az > 0) {
      const mx = ax > 0 ? ax : 0, my = ay > 0 ? ay : 0, mz = az > 0 ? az : 0;
      const l = Math.sqrt(mx * mx + my * my + mz * mz) || 1e-9;
      o[0] = l; o[1] = (qx < 0 ? -mx : mx) / l; o[2] = (qy < 0 ? -my : my) / l; o[3] = (qz < 0 ? -mz : mz) / l;
    } else if (ax >= ay && ax >= az) { o[0] = ax; o[1] = qx < 0 ? -1 : 1; o[2] = 0; o[3] = 0; }
    else if (ay >= az) { o[0] = ay; o[1] = 0; o[2] = qy < 0 ? -1 : 1; o[3] = 0; }
    else { o[0] = az; o[1] = 0; o[2] = 0; o[3] = qz < 0 ? -1 : 1; }
  }
  function sdEllipsoid(qx, qy, qz, rx, ry, rz, o) {
    if (Math.abs(rx - ry) < 1e-4 && Math.abs(ry - rz) < 1e-4) {
      const l = Math.sqrt(qx * qx + qy * qy + qz * qz) || 1e-9;
      o[0] = l - rx; o[1] = qx / l; o[2] = qy / l; o[3] = qz / l; return;
    }
    const k0x = qx / rx, k0y = qy / ry, k0z = qz / rz;
    const k1x = qx / (rx * rx), k1y = qy / (ry * ry), k1z = qz / (rz * rz);
    const k0 = Math.sqrt(k0x * k0x + k0y * k0y + k0z * k0z), k1 = Math.sqrt(k1x * k1x + k1y * k1y + k1z * k1z) || 1e-9;
    o[0] = k0 * (k0 - 1) / k1; o[1] = k1x / k1; o[2] = k1y / k1; o[3] = k1z / k1;
  }
  function sdCylinder(qx, qy, qz, rx, hy, rz, o) {
    const R = Math.min(rx, rz);
    const sx = qx * R / rx, sz = qz * R / rz;
    const lr = Math.sqrt(sx * sx + sz * sz) || 1e-9;
    const dr = lr - R, dy = Math.abs(qy) - hy;
    const nx = sx / lr, nz = sz / lr, sy = qy < 0 ? -1 : 1;
    if (dr > 0 && dy > 0) {
      const l = Math.sqrt(dr * dr + dy * dy);
      o[0] = l; o[1] = nx * dr / l; o[2] = sy * dy / l; o[3] = nz * dr / l;
    } else if (dr > dy) { o[0] = dr; o[1] = nx; o[2] = 0; o[3] = nz; }
    else { o[0] = dy; o[1] = 0; o[2] = sy; o[3] = 0; }
  }
  function sdCapsule(qx, qy, qz, r, hy, o) {
    const cy = qy > hy ? hy : (qy < -hy ? -hy : qy);
    const dx = qx, dy = qy - cy, dz = qz;
    const l = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-9;
    o[0] = l - r; o[1] = dx / l; o[2] = dy / l; o[3] = dz / l;
  }
  function sdTorusRaw(qx, qy, qz, R, r) {
    const l = Math.sqrt(qx * qx + qz * qz) - R;
    return Math.sqrt(l * l + qy * qy) - r;
  }
  function sdTorus(qx, qy, qz, R, r, o) {
    const lr = Math.sqrt(qx * qx + qz * qz) || 1e-9;
    const cx = qx / lr * R, cz = qz / lr * R;
    const dx = qx - cx, dy = qy, dz = qz - cz;
    const l = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-9;
    o[0] = l - r; o[1] = dx / l; o[2] = dy / l; o[3] = dz / l;
  }
  function sdConeRaw(qx, qy, qz, R, hy) {
    // capped cone, base radius R at y=-hy, apex at y=+hy
    const qxz = Math.sqrt(qx * qx + qz * qz);
    const h = hy, r1 = R, r2 = 0;
    const k1x = r2, k1y = h, k2x = r2 - r1, k2y = 2 * h;
    const cax = qxz - Math.min(qxz, qy < 0 ? r1 : r2), cay = Math.abs(qy) - h;
    const dk = k2x * k2x + k2y * k2y;
    let t = ((k1x - qxz) * k2x + (k1y - qy) * k2y) / dk;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const cbx = qxz - k1x + k2x * t, cby = qy - k1y + k2y * t;
    const s = (cbx < 0 && cay < 0) ? -1 : 1;
    return s * Math.sqrt(Math.min(cax * cax + cay * cay, cbx * cbx + cby * cby));
  }
  function sdCone(qx, qy, qz, rx, hy, rz, o) {
    const R = Math.min(rx, rz); qx *= R / rx; qz *= R / rz;
    const d = sdConeRaw(qx, qy, qz, R, hy), e = 1e-3;
    const gx = sdConeRaw(qx + e, qy, qz, R, hy) - d, gy = sdConeRaw(qx, qy + e, qz, R, hy) - d, gz = sdConeRaw(qx, qy, qz + e, R, hy) - d;
    const l = Math.sqrt(gx * gx + gy * gy + gz * gz) || 1e-9;
    o[0] = d; o[1] = gx / l; o[2] = gy / l; o[3] = gz / l;
  }
  function sdShape(type, qx, qy, qz, d0, d1, d2, o) {
    switch (type) {
      case 0: sdBox(qx, qy, qz, d0, d1, d2, o); break;
      case 1: sdEllipsoid(qx, qy, qz, d0, d1, d2, o); break;
      case 2: sdCylinder(qx, qy, qz, d0, d1, d2, o); break;
      case 3: sdCone(qx, qy, qz, d0, d1, d2, o); break;
      case 4: sdTorus(qx, qy, qz, d0, d1, o); break;
      case 5: sdCapsule(qx, qy, qz, d0, d1, o); break;
      default: o[0] = 1e9;
    }
  }

  /* ---------- skeleton animation ----------
   * An animated body is moved by its skeleton: kin.sa / kin.sb hold, per segment, a 3x4 transform (row-major
   * rotation then translation) from rest shape to the body's own frame at the start and end of the frame.
   * Particles near a joint blend the transforms of the two segments that meet there. */
  Engine.prototype._kinSeg = function (b, tb, qb) {
    const K = b.kin, sa = K.sa, sb = K.sb;
    if (!this._segT || this._segT.length < sa.length) this._segT = new Float32Array(sa.length);
    const S = this._segT, nS = Math.min(sa.length, sb.length);
    for (let q = 0; q < nS; q++) S[q] = sa[q] + (sb[q] - sa[q]) * tb;
    const DQ = segDQ(S, nS / 12, this._segDQ);
    this._segDQ = DQ;
    nlerpQ(K.a.q, K.b.q, tb, qb);
    const m = quatToMat(qb[0], qb[1], qb[2], qb[3]);
    const px = K.a.p[0] + (K.b.p[0] - K.a.p[0]) * tb, py = K.a.p[1] + (K.b.p[1] - K.a.p[1]) * tb, pz = K.a.p[2] + (K.b.p[2] - K.a.p[2]) * tb;
    const x = this.x, xp = this.xp, anc = this.anc, ancPos = this.ancPos, o3 = this._o3 || (this._o3 = new Float32Array(3));
    for (let i = b.start, e = b.start + b.count; i < e; i++) {
      this._skinPt(DQ, i, o3);
      const lx = o3[0], ly = o3[1], lz = o3[2], i3 = 3 * i;
      xp[i3] = x[i3]; xp[i3 + 1] = x[i3 + 1]; xp[i3 + 2] = x[i3 + 2];
      x[i3] = m[0] * lx + m[1] * ly + m[2] * lz + px;
      x[i3 + 1] = m[3] * lx + m[4] * ly + m[5] * lz + py;
      x[i3 + 2] = m[6] * lx + m[7] * ly + m[8] * lz + pz;
      if (anc[i]) { ancPos[i3] = x[i3]; ancPos[i3 + 1] = x[i3 + 1]; ancPos[i3 + 2] = x[i3 + 2]; }
    }
  };
  // one molecule's rest position posed by the segments' dual quaternions (blending turns rather than positions,
  // so flesh between two bones that turn far apart keeps its volume instead of collapsing or flaring)
  Engine.prototype._skinPt = function (DQ, i, out) {
    const r = this.r, i3 = 3 * i;
    dqSkin(DQ, this.sk, this.skw, 4 * i, r[i3], r[i3 + 1], r[i3 + 2], out);
  };
  // physics takes over a kinematic body. An animated one keeps the pose it was in: its rest shape and the rest
  // lengths of its intact bonds become that pose, so muscle tone holds it there instead of snapping back
  Engine.prototype._release = function (b, hit) {
    const w = this.w, dead = this.dead;
    b.kinematic = false;
    for (let i = b.start, e = b.start + b.count; i < e; i++) if (!dead[i]) w[i] = this.w0[i];
    b.asleep = false;
    const L = b.lastSeg; b.lastSeg = null;
    if (!L) return;
    const DQ = segDQ(L.s, L.s.length / 12, null), r = this.r, o3 = new Float32Array(3), tmp = new Float32Array(3 * b.count);
    for (let i = b.start, e = b.start + b.count; i < e; i++) { this._skinPt(DQ, i, o3); const q = 3 * (i - b.start); tmp[q] = o3[0]; tmp[q + 1] = o3[1]; tmp[q + 2] = o3[2]; }
    if (!b.rRest) b.rRest = r.slice(3 * b.start, 3 * (b.start + b.count)); // the built rest shape, for driving later
    r.set(tmp, 3 * b.start);
    const x = this.x;
    for (let q = b.bstart, e = b.bstart + b.bcount; q < e; q++) {
      if (this.bx[q]) continue;
      const i3 = 3 * this.bi[q], j3 = 3 * this.bj[q];
      const d = Math.hypot(x[i3] - x[j3], x[i3 + 1] - x[j3 + 1], x[i3 + 2] - x[j3 + 2]);
      // flesh that only touched at rest (an arm hanging against the side) was pulled apart by the pose: let it go
      // (not a wound: the bond is simply dropped, so neither side counts as torn or shows its insides)
      if (d > this.br0[q] * 1.6) { this.bx[q] = 1; this.nb0[this.bi[q]]--; this.nb0[this.bj[q]]--; this._bxDirty = true; continue; }
      this.br[q] = d; this.br0[q] = d;
    }
    // feet that were in the air (mid stride, mid jump) are not planted
    let mnY = 1e9; for (let i = b.start, e = b.start + b.count; i < e; i++) if (!dead[i]) mnY = Math.min(mnY, x[3 * i + 1]);
    // handed over on purpose (not hit): it stops where it is and stands balanced in that pose
    if (!hit) { const v = this.v, xp = this.xp; for (let i = 3 * b.start, e = 3 * (b.start + b.count); i < e; i++) { v[i] = 0; xp[i] = x[i]; } }
    // hit mid-move: keep the body's momentum, but an animated limb can be swinging far faster than a real one could
    // (a flying knee from a clip reaches 12 m/s) and every molecule of it would land on the other body at that speed
    else {
      const v = this.v; let mx = 0, my = 0, mz = 0, n = 0;
      for (let i = b.start, e = b.start + b.count; i < e; i++) { if (dead[i]) continue; mx += v[3 * i]; my += v[3 * i + 1]; mz += v[3 * i + 2]; n++; }
      if (n) { mx /= n; my /= n; mz /= n; }
      const RV = Engine.RELVMAX;
      for (let i = b.start, e = b.start + b.count; i < e; i++) {
        const i3 = 3 * i, dx = v[i3] - mx, dy = v[i3 + 1] - my, dz = v[i3 + 2] - mz, d = Math.hypot(dx, dy, dz);
        if (d > RV) { const f = RV / d; v[i3] = mx + dx * f; v[i3 + 1] = my + dy * f; v[i3 + 2] = mz + dz * f; }
      }
    }
    for (let i = b.start, e = b.start + b.count; i < e; i++) if (this.anc[i] && x[3 * i + 1] > mnY + 0.035) this.anc[i] = 0;
    b.q0 = L.q.slice(); b.clusters = []; b.poseClusters = [];
    this._rebuildClusters(b);
    for (const C of b.poseClusters) C.q = L.q.slice();
    for (const C of b.clusters) C.q = L.q.slice();
    this._clSerial = (this._clSerial || 0) + 1; this._serial = (this._serial || 0) + 1;
  };
  /* Active ragdoll: physics has the body, and the animation's pose for this frame becomes its rest shape. Muscle tone
   * (shape matching) and the bonds pull it into that pose, so it keeps moving the way the clip does while it is
   * pushed, hit and falls. Feet stay planted while the clip's feet are on the ground and lift when the clip lifts them. */
  Engine.prototype._drive = function (b, S, K, dt) {
    const DQ = segDQ(S, S.length / 12, this._segDQd); this._segDQd = DQ;
    const r = this.r, x = this.x, dead = this.dead, o3 = this._o3 || (this._o3 = new Float32Array(3));
    let mnY = 1e9;
    // the muscles ease toward the animated shape (a fast move right at the hit would otherwise yank the flesh apart)
    const first = b.driveF !== this.frame - 1, A = first ? 0.2 : Engine.DRIVE_EASE;
    b.driveF = this.frame;
    const R0 = b.rRest; if (!R0) return;
    for (let i = b.start, e = b.start + b.count; i < e; i++) {
      const i3 = 3 * i, k3 = 3 * (i - b.start);
      dqSkin(DQ, this.sk, this.skw, 4 * i, R0[k3], R0[k3 + 1], R0[k3 + 2], o3);
      r[i3] += (o3[0] - r[i3]) * A; r[i3 + 1] += (o3[1] - r[i3 + 1]) * A; r[i3 + 2] += (o3[2] - r[i3 + 2]) * A;
      if (!dead[i] && o3[1] < mnY) mnY = o3[1];
    }
    if (!b.br00) b.br00 = this.br0.slice(b.bstart, b.bstart + b.bcount);
    const br = this.br, br0 = this.br0, bi = this.bi, bj = this.bj, bx = this.bx, B0 = b.br00;
    for (let q = b.bstart, e = b.bstart + b.bcount; q < e; q++) {
      if (bx[q]) continue;
      const i3 = 3 * bi[q], j3 = 3 * bj[q];
      const d = Math.hypot(r[i3] - r[j3], r[i3 + 1] - r[j3 + 1], r[i3 + 2] - r[j3 + 2]);
      // rest lengths follow the pose, within what flesh can stretch or squash, and never in one jump
      const b0 = B0[q - b.bstart], cur = br0[q];
      // flesh that only touched in the pose at the hit (arm against the side) and is pulled well apart now: let it go
      if (d > b0 * 1.8) { bx[q] = 1; this.nb0[bi[q]]--; this.nb0[bj[q]]--; this._bxDirty = true; continue; }
      const nd = Math.min(b0 * 1.6, Math.max(b0 * 0.6, d));
      const k = cur > 0 ? br[q] / cur : 1;
      br0[q] = nd; br[q] = nd * k;
    }
    if (b.params.stand && b.anc0) {
      const anc = this.anc, ancPos = this.ancPos;
      for (const i of b.anc0) {
        if (dead[i]) continue;
        const i3 = 3 * i, up = r[i3 + 1] - mnY;
        if (up > 0.04) anc[i] = 0;
        else if (!anc[i] && x[i3 + 1] < (this._floorY || 0) + 0.03) { anc[i] = 1; ancPos[i3] = x[i3]; ancPos[i3 + 1] = x[i3 + 1]; ancPos[i3 + 2] = x[i3 + 2]; }
      }
    }
    // balance: muscles hold the animated stance (upright, at its height), but not its place, so a push still moves
    // the body; a body knocked well off its feet goes limp (the animation stops driving it) and falls as a ragdoll
    if (K && K.b && dt > 0 && !b.balLost && Engine.BALANCE > 0) {
      const q = K.b.q, m = quatToMat(q[0], q[1], q[2], q[3]), pp = K.b.p, w = this.w, v = this.v;
      let ax = 0, ay = 0, az = 0, cx = 0, cy = 0, cz = 0, nn = 0;
      for (let i = b.start, e = b.start + b.count; i < e; i++) {
        if (dead[i] || w[i] === 0) continue;
        const i3 = 3 * i, X = r[i3], Y = r[i3 + 1], Z = r[i3 + 2];
        ax += m[0] * X + m[1] * Y + m[2] * Z; ay += m[3] * X + m[4] * Y + m[5] * Z; az += m[6] * X + m[7] * Y + m[8] * Z;
        cx += x[i3]; cy += x[i3 + 1]; cz += x[i3 + 2]; nn++;
      }
      if (nn) {
        ax = ax / nn + pp[0]; ay = ay / nn + pp[1]; az = az / nn + pp[2]; cx /= nn; cy /= nn; cz /= nn;
        const ox = cx - ax, oz = cz - az;
        let err = 0;
        const T = this._balT && this._balT.length >= 3 * b.count ? this._balT : (this._balT = new Float32Array(3 * b.count));
        for (let i = b.start, e = b.start + b.count; i < e; i++) {
          const i3 = 3 * i, k3 = 3 * (i - b.start), X = r[i3], Y = r[i3 + 1], Z = r[i3 + 2];
          T[k3] = m[0] * X + m[1] * Y + m[2] * Z + pp[0] + ox; T[k3 + 1] = m[3] * X + m[4] * Y + m[5] * Z + pp[1]; T[k3 + 2] = m[6] * X + m[7] * Y + m[8] * Z + pp[2] + oz;
          if (!dead[i] && w[i] !== 0) err += Math.hypot(T[k3] - x[i3], T[k3 + 1] - x[i3 + 1], T[k3 + 2] - x[i3 + 2]);
        }
        err /= nn;
        if (err > 0.3 || ay - cy > 0.35) b.balLost = true;
        else {
          const kp = Engine.BALANCE * (1 - b.ko / 0.3) * (1 - err / 0.3) * dt;
          for (let i = b.start, e = b.start + b.count; i < e; i++) {
            if (dead[i] || w[i] === 0) continue;
            const i3 = 3 * i, k3 = 3 * (i - b.start);
            v[i3] += (T[k3] - x[i3]) * kp; v[i3 + 1] += (T[k3 + 1] - x[i3 + 1]) * kp; v[i3 + 2] += (T[k3 + 2] - x[i3 + 2]) * kp;
          }
        }
      }
    }
    b.drive = this.frame;
  };
  // will a collider, a loose ball, a strong field or another moving body touch this animated body by the end of the frame?
  Engine.prototype._animHit = function (b, cols, ctype, cdim, fields) {
    const K = b.kin, S = K.sb, m = quatToMat(K.b.q[0], K.b.q[1], K.b.q[2], K.b.q[3]), p = K.b.p;
    const r = this.r, seg = this.seg, rad = this.rad, o4 = [0, 0, 0, 0];
    for (const F of fields) {
      if (F.type === 'explode' || F.type === 'impulse') { if (sphereAabb(F.p[0], F.p[1], F.p[2], F.radius, b.aabb)) return true; continue; }
      let acc = Math.abs(F.strength || 0);
      if (F.type !== 'wind' && F.p) { const dx = F.p[0] - (b.aabb[0] + b.aabb[3]) / 2, dy = F.p[1] - (b.aabb[1] + b.aabb[4]) / 2, dz = F.p[2] - (b.aabb[2] + b.aabb[5]) / 2, d = Math.hypot(dx, dy, dz); acc = F.radius && d > F.radius ? 0 : acc * (F.radius ? 1 - d / F.radius : 1); }
      if (acc > 8) return true;
    }
    const near = [];
    for (let c = 0; c < cols.length; c++) { const C = cols[c]; if (sphereAabb(C.b.p[0], C.b.p[1], C.b.p[2], C.bound + 0.1, b.aabb)) near.push(c); }
    const balls = this.balls.filter(B => sphereAabb(B.x[0], B.x[1], B.x[2], B.r + Math.hypot(B.v[0], B.v[1], B.v[2]) * 0.05 + 0.05, b.aabb));
    // other bodies, sleeping or animated ones too (a body standing still is usually asleep), within this frame's reach
    const others = this.bodies.filter(o => o !== b && o.count && aabbOverlap(o.aabb, b.aabb, 0.25));
    if (!near.length && !balls.length && !others.length) return false;
    const step = Math.max(1, Math.floor(b.count / 1500));
    let hp = null;
    for (let i = b.start, e = b.start + b.count; i < e; i += step) {
      const i3 = 3 * i, rx = r[i3], ry = r[i3 + 1], rz = r[i3 + 2], o = 12 * seg[i];
      const lx = S[o] * rx + S[o + 1] * ry + S[o + 2] * rz + S[o + 9], ly = S[o + 3] * rx + S[o + 4] * ry + S[o + 5] * rz + S[o + 10], lz = S[o + 6] * rx + S[o + 7] * ry + S[o + 8] * rz + S[o + 11];
      const wx = m[0] * lx + m[1] * ly + m[2] * lz + p[0], wy = m[3] * lx + m[4] * ly + m[5] * lz + p[1], wz = m[6] * lx + m[7] * ly + m[8] * lz + p[2];
      const R = rad[i] * 2 + 0.01;
      for (const c of near) {
        const C = cols[c], cm = quatToMat(C.b.q[0], C.b.q[1], C.b.q[2], C.b.q[3]);
        const dx = wx - C.b.p[0], dy = wy - C.b.p[1], dz = wz - C.b.p[2];
        if (dx * dx + dy * dy + dz * dz > (C.bound + R) * (C.bound + R)) continue;
        const qx = cm[0] * dx + cm[3] * dy + cm[6] * dz, qy = cm[1] * dx + cm[4] * dy + cm[7] * dz, qz = cm[2] * dx + cm[5] * dy + cm[8] * dz;
        sdShape(ctype[c], qx, qy, qz, cdim[3 * c], cdim[3 * c + 1], cdim[3 * c + 2], o4);
        if (o4[0] < R) return true;
      }
      for (const B of balls) { const dx = wx - B.x[0], dy = wy - B.x[1], dz = wz - B.x[2], RR = B.r + R + Math.hypot(B.v[0], B.v[1], B.v[2]) * 0.034; if (dx * dx + dy * dy + dz * dz < RR * RR) return true; }
      if (others.length) { if (!hp) hp = []; hp.push(wx, wy, wz); }
    }
    if (others.length && hp) {
      // another body's molecules near where this one's will be at the end of the frame (not where they are now: a
      // running or jumping body covers several centimetres a frame and would already be inside the other one)
      const x = this.x, v = this.v, hitV = Math.min(b.koSpeed || 2.5, Engine.HITBYV), CS = 0.06, inv = 1 / CS, H = new Map(), key = (a, c, d) => (a * 73856093) ^ (c * 19349663) ^ (d * 83492791);
      for (let q = 0; q < hp.length; q += 3) { const k = key(Math.floor(hp[q] * inv), Math.floor(hp[q + 1] * inv), Math.floor(hp[q + 2] * inv)); let L = H.get(k); if (!L) H.set(k, L = []); L.push(q); }
      const reach = Math.max(0.035, 2.2 * b.spacing), r2 = reach * reach;
      // closing speed averaged over the whole contact patch: single molecules of flesh it is shoving bounce about
      let cvS = 0, cvN = 0;
      for (const o of others) for (let j = o.start, e = o.start + o.count; j < e; j += 2) {
        if (this.dead[j]) continue;
        const j3 = 3 * j, px = x[j3], py = x[j3 + 1], pz = x[j3 + 2], cx = Math.floor(px * inv), cy = Math.floor(py * inv), cz = Math.floor(pz * inv);
        for (let a = -1; a <= 1; a++) for (let c = -1; c <= 1; c++) for (let d = -1; d <= 1; d++) {
          const L = H.get(key(cx + a, cy + c, cz + d)); if (!L) continue;
          for (const q of L) {
            const dx = hp[q] - px, dy = hp[q + 1] - py, dz = hp[q + 2] - pz, dd = dx * dx + dy * dy + dz * dz;
            if (dd >= r2) continue;
            if (o.asleep) o.asleep = false; // it is about to be touched, so it has to take part in contacts
            // this body is the one doing the touching (a headbutt, a punch landing on someone standing there): it stays
            // on its animation and shoves the other body, feet planted. Only the other body coming at it (another
            // animated body, or one flying, falling or swinging into it faster than would knock it out) makes it react
            if (o.kinematic && o.kin && o.kin.sb) return true;
            const d = Math.sqrt(dd) || 1; cvS += (v[j3] * dx + v[j3 + 1] * dy + v[j3 + 2] * dz) / d; cvN++;
          }
        }
      }
      if (cvN && cvS / cvN > hitV) return true;
    }
    return false;
  };

  /* ---------- step ---------- */
  Engine.prototype._stepGen = function* (inp, gpuOk) {
    const t0 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    const N = this.N, x = this.x, xp = this.xp, v = this.v, w = this.w, rad = this.rad;
    // fast weapons (or fast flying flesh) would skip straight through thin limbs between substeps, so the frame
    // is cut into more substeps until nothing moves more than a few molecules' width per substep
    // slow motion: fewer substeps per (shorter) frame, so a substep covers about the same sim time as at full speed
    const tsK = Math.min(1, Math.max(1e-4, inp.dt * 60));
    let ns = Math.max(1, Math.round((inp.substeps | 0) * tsK));
    const nsSlow = ns;
    // real cannonballs and other loose rigid balls: spawned by the scene, then fully simulated here
    if (!this.balls) { this.balls = []; this.ballKey = new Map(); }
    for (const P of (inp.projectiles || [])) {
      if (this.ballKey.has(P.key)) continue;
      const B = { key: P.key, x: P.p.slice(), xp: P.p.slice(), v: P.v.slice(), r: P.r, m: Math.max(0.05, P.m), mu: P.friction != null ? P.friction : 0.5,
        shat: P.shatterMul != null ? P.shatterMul : 1, rest: P.restitution != null ? P.restitution : 0.3, q: [0, 0, 0, 1], floor: false, vyPre: 0, gk: P.noGravity ? 0 : 1 };
      this.ballKey.set(P.key, B); this.balls.push(B);
    }
    // balls whose lifetime ran out (emitters): removed for good, their key stays so they are never spawned again
    if (inp.killBalls && inp.killBalls.length && this.balls.length) {
      const kill = new Set(inp.killBalls);
      this.balls = this.balls.filter(B => !kill.has(B.key));
    }
    {
      let minSp = 1e9; for (const b of this.bodies) if (!b.asleep) minSp = Math.min(minSp, b.spacing || 0.02);
      if (minSp < 1e9) {
        const lim = Math.max(0.025, minSp * 2.2);
        let move = 0;
        for (const C of (inp.colliders || [])) {
          if (!C.a || !C.b) continue;
          const dx = C.b.p[0] - C.a.p[0], dy = C.b.p[1] - C.a.p[1], dz = C.b.p[2] - C.a.p[2];
          const dq = Math.abs(C.a.q[0] * C.b.q[0] + C.a.q[1] * C.b.q[1] + C.a.q[2] * C.b.q[2] + C.a.q[3] * C.b.q[3]);
          const ang = 2 * Math.acos(Math.min(1, dq));
          const sp = C.spin ? Math.hypot(C.spin[0], C.spin[1], C.spin[2]) * (C.bound || 0) * inp.dt * 0.15 : 0; // spinning saws cut anyway; only a little extra
          move = Math.max(move, Math.sqrt(dx * dx + dy * dy + dz * dz) + ang * (C.bound || 0) + sp);
        }
        for (const b of this.bodies) if (!b.asleep && b.maxSpeed) move = Math.max(move, b.maxSpeed * inp.dt * 0.6);
        for (const B of this.balls) move = Math.max(move, Math.hypot(B.v[0], B.v[1], B.v[2]) * inp.dt);
        ns = Math.min(Math.max(ns, Math.ceil(move / lim)), Math.max(ns, inp.maxSubsteps || 40));
      }
    }
    // extra substeps for body-vs-body speed keep the per-substep pose stiffness (weakening it lets a body wrap around a weapon)
    const nsK = ns;
    // bodies flying into each other (a thrown prop, a falling body onto another) collide through their whole
    // volume, not only at torn surfaces, and get enough substeps that one cannot skip through the other
    {
      const bl = this.bodies, nbl = bl.length;
      if (!this._xb || this._xb.length !== nbl) this._xb = new Uint8Array(nbl); else this._xb.fill(0);
      let xs = 0, minSp = 1e9;
      for (let a = 0; a < nbl; a++) for (let c = a + 1; c < nbl; c++) {
        const A = bl[a], C = bl[c]; if (A.asleep && C.asleep) continue;
        const sa = A.asleep ? 0 : (A.maxSpeed || 0), sc = C.asleep ? 0 : (C.maxSpeed || 0), rel = (sa + sc) * inp.dt;
        if (!aabbOverlap(A.aabb, C.aabb, rel + 0.03)) continue;
        this._xb[a] = 1; this._xb[c] = 1; xs = Math.max(xs, rel); minSp = Math.min(minSp, A.spacing || 0.02, C.spacing || 0.02);
      }
      // a body being pressed by a collider also collides with itself through its whole volume, so squashed flesh
      // can't pass through itself and lose its volume: it has to go somewhere, which is what bursts it open
      for (let a = 0; a < nbl; a++) { const A = bl[a]; A.selfCol = !!A.softSeg && !A.asleep && !A.kinematic && this.frame - (A.colT ?? -99) < 150 && this.frame - (A.bluntT ?? -99) < 3; if (A.selfCol) this._xb[a] = 1; }
      this._xFast = xs;
      if (xs > 0) ns = Math.min(Math.max(ns, Math.ceil(xs / Math.max(0.006, minSp * 0.9))), Math.max(ns, inp.maxSubsteps || 40));
    }
    this.lastSubsteps = ns;
    // keep shape-matching stiffness per frame the same however many substeps this frame uses
    // slow motion: frames are shorter, so every per-substep and per-frame rate is scaled to sim time (otherwise
    // bodies get far stiffer in slow motion and weapons stop breaking them)
    const nsBase = Math.max(1, inp.substeps | 0), rS = Math.min(1, tsK * nsBase / nsSlow);
    const kAdj = (k) => (k >= 1 || (nsK === nsBase && rS === 1) ? k : 1 - Math.pow(1 - k, nsBase / nsK * tsK));
    // per-substep rates: a substep shorter than at full speed does proportionally less
    const slowK = (k) => { if (rS === 1 || !(k > 0)) return k; const c = Math.min(k, 0.98); return (1 - Math.pow(1 - c, rS)) * k / c; };
    this._tsK = rS;
    const dt = inp.dt, h = dt / ns, ih = 1 / h;
    const gx = inp.gravity[0], gy = inp.gravity[1], gz = inp.gravity[2];
    const floorOn = inp.floor && inp.floor.enabled, floorY = inp.floor ? inp.floor.y : 0, floorMu = inp.floor ? inp.floor.friction : 0.6;
    this._floorY = floorY;
    const bodies = this.bodies, nbBody = bodies.length;
    const bx = this.bx, bi = this.bi, bj = this.bj, br = this.br, bk = this.bk, bsl = this.bs, bcl = this.bc, shm = this.shm;
    const nbb = this.nbb, cand = this.cand, dead = this.dead, anc = this.anc, ancPos = this.ancPos, ct = this.ct;
    let brokenThisFrame = 0;

    // per-body params for this frame
    const bp = inp.bodies || [];
    for (let k = 0; k < nbBody; k++) {
      const b = bodies[k], p = bp[k] || {};
      b.rig = p.rigidity != null ? p.rigidity : b.params.rigidity;
      b.tone = p.tone != null ? p.tone : (b.params.tone != null ? b.params.tone : 0);
      // finer lattices need more solver work to carry a load across the same flesh, so without this a
      // high-detail body would tear more easily than a low-detail one; humanoids also get human toughness
      const resK = Math.min(2.2, Math.max(1, Math.pow(0.02 / (b.spacing || 0.02), 1.1))) * (b.softSeg ? 1.35 : 1);
      b.str = (p.strength != null ? p.strength : b.params.strength) * resK;
      b.shatter = p.shatter != null ? p.shatter : b.params.shatter;
      b.mu = p.friction != null ? p.friction : (b.params.friction != null ? b.params.friction : 0.5);
      b.stiff = p.stiffness != null ? p.stiffness : (b.params.stiffness != null ? b.params.stiffness : 1);
      b.anchorStr = p.anchorStrength != null ? p.anchorStrength : (b.params.anchorStrength || 1);
      b.drag = p.drag != null ? p.drag : (b.params.drag || 0.02);
      b.kin = b.animOff ? null : (p.kin || null);
      if (b.kin && b.kin.sb) b.lastSeg = { s: b.kin.sb, q: b.kin.b.q };
      b.goo = p.goo != null ? p.goo : (b.params.goo != null ? b.params.goo : 0);
      b.plastic = p.plastic != null ? p.plastic : (b.params.plastic != null ? b.params.plastic : 0);
      b.damp = p.damping != null ? p.damping : (b.params.damping != null ? b.params.damping : 0);
      b.koSpeed = p.knockout != null ? p.knockout : (b.params.knockout != null ? b.params.knockout : 1e9);
      b.boneSnap = p.boneSnap != null ? p.boneSnap : (b.params.boneSnap != null ? b.params.boneSnap : 1e9);
      b.koHit = false;
      b.firm = p.firmness != null ? p.firmness : (b.params.firmness != null ? b.params.firmness : 0.12);
      if (tsK < 1) { b.stiff = slowK(b.stiff); b.damp = slowK(b.damp); const pl = Math.min(b.plastic, 0.98); if (pl > 0) b.plastic = (1 - Math.pow(1 - pl, tsK)) * b.plastic / pl; }
      if (p.addVel) { const a = p.addVel; for (let i = b.start, e = b.start + b.count; i < e; i++) { if (w[i] === 0 && !b.kinematic) continue; v[3 * i] += a[0]; v[3 * i + 1] += a[1]; v[3 * i + 2] += a[2]; } b.asleep = false; }
      if (b.kinematic && !b.kin) this._release(b);
      // hit while animated: the animation keeps playing through the muscles (active ragdoll) until it is knocked out
      if (b.animOff && !b.kinematic && b.softSeg && p.kin && p.kin.sb && b.params.drive !== false && b.ko < 0.3 && !b.balLost) this._drive(b, p.kin.sb, p.kin, dt);
    }

    // colliders
    const cols = inp.colliders || [];
    const nc = cols.length;
    const cA = new Float64Array(nc * 32), cSave = new Float64Array(24); // per-collider scratch: interpolated transforms
    // wake checks
    for (let c = 0; c < nc; c++) {
      const C = cols[c];
      const sweep = Math.hypot(C.b.p[0] - C.a.p[0], C.b.p[1] - C.a.p[1], C.b.p[2] - C.a.p[2]);
      C._R = C.bound + sweep + 0.1;
      { const dq = Math.abs(C.a.q[0] * C.b.q[0] + C.a.q[1] * C.b.q[1] + C.a.q[2] * C.b.q[2] + C.a.q[3] * C.b.q[3]); C._angS = 2 * Math.acos(Math.min(1, dq)) / ns; }
      for (let k = 0; k < nbBody; k++) {
        const b = bodies[k];
        if (b.asleep) for (let q = 0; q <= 4; q++) { // swept: fast projectiles can cross a body within one frame
          const tq = q / 4, qx = C.a.p[0] + (C.b.p[0] - C.a.p[0]) * tq, qy = C.a.p[1] + (C.b.p[1] - C.a.p[1]) * tq, qz = C.a.p[2] + (C.b.p[2] - C.a.p[2]) * tq;
          if (sphereAabb(qx, qy, qz, C._R + 0.05, b.aabb)) { b.asleep = false; b.sleepCnt = 0; break; }
        }
      }
    }
    // fields
    const fields = inp.fields || [];
    for (const F of fields) {
      if (F.type === 'explode' || F.type === 'impulse') {
        for (let k = 0; k < nbBody; k++) { const b = bodies[k]; if (sphereAabb(F.p[0], F.p[1], F.p[2], F.radius, b.aabb)) { b.asleep = false; b.sleepCnt = 0; } }
      } else if (F.strength) {
        for (let k = 0; k < nbBody; k++) { const b = bodies[k]; if (F.radius == null || sphereAabb(F.p[0], F.p[1], F.p[2], F.radius, b.aabb)) { b.asleep = false; b.sleepCnt = 0; } }
      }
    }
    // body-body wake
    for (let k = 0; k < nbBody; k++) {
      const a = bodies[k]; if (a.asleep) continue;
      for (let m = 0; m < nbBody; m++) {
        const b = bodies[m]; if (!b.asleep) continue;
        if (aabbOverlap(a.aabb, b.aabb, 0.06)) { b.asleep = false; b.sleepCnt = 0; }
      }
    }
    for (const B of this.balls) {
      const sp = Math.hypot(B.v[0], B.v[1], B.v[2]) * dt;
      for (const b of bodies) if (b.asleep && sphereAabb(B.x[0], B.x[1], B.x[2], B.r + sp + 0.05, b.aabb)) { b.asleep = false; b.sleepCnt = 0; }
    }
    // gravity change wakes (e.g. animated gravity)
    if (this._lastG && (this._lastG[0] !== gx || this._lastG[1] !== gy || this._lastG[2] !== gz)) for (const b of bodies) { if (b.asleep && !b.params.stand) b.asleep = false; }
    this._lastG = [gx, gy, gz];

    // one-shot impulses (explosions)
    for (const F of fields) {
      if (F.type !== 'explode' && F.type !== 'impulse') continue;
      const R = F.radius, R2 = R * R, dmgR = R * (F.damage != null ? F.damage : 0.35);
      for (let k = 0; k < nbBody; k++) {
        const b = bodies[k]; if (b.asleep) continue;
        for (let i = b.start, e = b.start + b.count; i < e; i++) {
          if (w[i] === 0) continue;
          const i3 = 3 * i, dx = x[i3] - F.p[0], dy = x[i3 + 1] - F.p[1], dz = x[i3 + 2] - F.p[2];
          const d2 = dx * dx + dy * dy + dz * dz;
          if (d2 > R2) continue;
          const d = Math.sqrt(d2) || 1e-6, f = F.strength * (1 - d / R);
          if (f > b.koSpeed) b.koHit = true;
          const jit = 0.75 + 0.5 * hash32(i * 7 + this.frame);
          if (F.dir) { // a bullet: mostly along its path, with a little spray outwards
            const D = F.dir; v[i3] += (D[0] * 0.8 + dx / d * 0.35) * f * jit; v[i3 + 1] += (D[1] * 0.8 + dy / d * 0.35) * f * jit; v[i3 + 2] += (D[2] * 0.8 + dz / d * 0.35) * f * jit;
          } else { v[i3] += dx / d * f * jit; v[i3 + 1] += (dy / d * f + f * (F.lift || 0)) * jit; v[i3 + 2] += dz / d * f * jit; }
          if (d < dmgR && hash32(i * 13 + 5) < (1 - d / dmgR) * 1.6) this._breakParticle(i);
        }
      }
    }

    // collider SDF parameters
    const ctype = new Int32Array(nc), cdim = new Float64Array(nc * 3), cmu = new Float64Array(nc), cspin = new Float64Array(nc * 6), cshat = new Float64Array(nc);
    for (let c = 0; c < nc; c++) {
      const C = cols[c];
      ctype[c] = SHAPE[C.shape] != null ? SHAPE[C.shape] : 0;
      cdim[3 * c] = C.dims[0]; cdim[3 * c + 1] = C.dims[1]; cdim[3 * c + 2] = C.dims[2];
      cmu[c] = C.friction != null ? C.friction : 0.5;
      cshat[c] = C.shatterMul != null ? C.shatterMul : 1;
      if (C.spin) { cspin[6 * c] = C.spin[0]; cspin[6 * c + 1] = C.spin[1]; cspin[6 * c + 2] = C.spin[2]; }
    }
    const qa = [0, 0, 0, 1], qb = [0, 0, 0, 1];
    // stable ids for colliders (molecules stuck to a collider remember it across frames)
    const idToCol = new Int32Array(this.colIds.size + nc + 1).fill(-1);
    for (let c = 0; c < nc; c++) {
      const key = cols[c].key || ('c' + c);
      let id = this.colIds.get(key); if (id === undefined) { id = this.colIds.size; this.colIds.set(key, id); }
      if (id < idToCol.length) idToCol[id] = c;
      cols[c]._id = id;
      // a ring that is closing (a torus shrinking) slices through what it encircles instead of squeezing it into a
      // bundle: it cuts across its own plane like a blade (stays on for a moment after it stops shrinking)
      if (ctype[c] === 4) {
        if (!this.ringT) this.ringT = new Map();
        const pv = this.ringT.get(key);
        let last = pv ? pv.last : -1e9;
        if (pv && cdim[3 * c] < pv.d0 * 0.9995) last = this.frame;
        this.ringT.set(key, { d0: cdim[3 * c], last });
        cols[c]._ring = this.frame - last < 12;
      } else cols[c]._ring = false;
    }
    const stk = this.stk, stq = this.stq, nbb0 = this.nbb;
    // fast projectiles carry a finite momentum: once a light fast object has spent it on the body it punches through
    // instead of carrying the whole body along at its own speed (an animated collider would otherwise have infinite mass)
    if (!this.colMom) this.colMom = new Map();
    const cP = new Float64Array(nc), cB = new Float64Array(nc).fill(Infinity);
    for (let c = 0; c < nc; c++) {
      const C = cols[c], d0 = cdim[3 * c], d1 = cdim[3 * c + 1], d2 = cdim[3 * c + 2], t = ctype[c];
      const vol = t === 0 ? 8 * d0 * d1 * d2 : t === 1 ? 4.19 * d0 * d1 * d2 : t === 2 ? 6.28 * d0 * d1 * d2 : t === 3 ? 2.09 * d0 * d1 * d2 : t === 4 ? 19.7 * d0 * d1 * d1 : 3.14 * d0 * d0 * (2 * d1 + 1.33 * d0);
      const M = C.mass != null ? C.mass : Math.max(0.5, vol * (C.density || Engine.COLDENS));
      const sp = Math.hypot(C.b.p[0] - C.a.p[0], C.b.p[1] - C.a.p[1], C.b.p[2] - C.a.p[2]) / dt;
      const m = this.colMom.get(C._id);
      if (m && this.frame - m.f < 8) cP[c] = m.P * Math.exp(-dt / 0.3);
      if (sp > Engine.FASTV && M < Engine.LIGHTM && !C.fixed && !(C.spin && (C.spin[0] || C.spin[1] || C.spin[2]))) cB[c] = M * sp;
    }

    // an animated body that something is about to hit (by the end of this frame) goes over to physics now
    for (let k = 0; k < nbBody; k++) {
      const b = bodies[k];
      if (!b.kinematic || !b.kin || !b.kin.sb || !b.params.react) continue;
      if (this._animHit(b, cols, ctype, cdim, fields)) { b.animOff = true; b.kin = null; this._release(b, true); }
    }
    // grabs (play mode hands): a closing hand takes hold of the molecules (and loose balls) inside it; they then
    // follow the hand rigidly every substep, so a held limb swings with it and pulls hard enough to tear off
    if (!this._grabs) this._grabs = new Map();
    {
      const G = inp.grabs || [], live = new Set();
      for (const g of G) {
        live.add(g.id);
        let S = this._grabs.get(g.id);
        if (!S) {
          const m = quatToMat(g.q[0], g.q[1], g.q[2], g.q[3]), r2 = g.r * g.r, idx = [], off = [], held = new Set();
          for (let k = 0; k < nbBody; k++) {
            const b = bodies[k]; if (b.kinematic || !sphereAabb(g.p[0], g.p[1], g.p[2], g.r, b.aabb)) continue;
            for (let i = b.start, e = b.start + b.count; i < e; i++) {
              if (w[i] === 0 || this.dead[i]) continue;
              const i3 = 3 * i, dx = x[i3] - g.p[0], dy = x[i3 + 1] - g.p[1], dz = x[i3 + 2] - g.p[2];
              if (dx * dx + dy * dy + dz * dz > r2) continue;
              idx.push(i); off.push(m[0] * dx + m[3] * dy + m[6] * dz, m[1] * dx + m[4] * dy + m[7] * dz, m[2] * dx + m[5] * dy + m[8] * dz);
              held.add(k);
            }
          }
          let ball = null, boff = null;
          if (!idx.length) for (const B of this.balls) {
            const dx = B.x[0] - g.p[0], dy = B.x[1] - g.p[1], dz = B.x[2] - g.p[2];
            if (dx * dx + dy * dy + dz * dz < (g.r + B.r) * (g.r + B.r)) { ball = B; boff = [m[0] * dx + m[3] * dy + m[6] * dz, m[1] * dx + m[4] * dy + m[7] * dz, m[2] * dx + m[5] * dy + m[8] * dz]; break; }
          }
          for (const k of held) { const b = bodies[k]; b.asleep = false; b.sleepCnt = 0; b.koHit = true; }
          S = { idx: Int32Array.from(idx), off: Float32Array.from(off), held: [...held], ball, boff, k: g.k != null ? g.k : 0.85 };
          this._grabs.set(g.id, S);
        }
        S.a = g.pa || g.p; S.qa = g.qa || g.q; S.b = g.p; S.qb = g.q;
        for (const k of S.held) { const b = bodies[k]; if (b) { b.asleep = false; b.sleepCnt = 0; } }
      }
      for (const id of [...this._grabs.keys()]) if (!live.has(id)) this._grabs.delete(id);
    }
    // hash cell size
    let maxRad = 0; for (const b of bodies) maxRad = Math.max(maxRad, b.spacing * 0.5);
    const cell = Math.max(2 * maxRad, 1e-3), icell = 1 / cell;
    const ppEvery = this._xFast > 0.01 ? 1 : (inp.ppEvery || 2);
    // goo sticks per contact check: keep its rate per second of sim time whatever the substeps and contact cadence
    this._gooK = Math.min(1, nsBase * ppEvery * dt * 60 / ((inp.ppEvery || 2) * ns));
    const ppMu = inp.ppFriction != null ? inp.ppFriction : 0.25;
    const dvMax = (inp.dvMax != null ? inp.dvMax : 3.0) * rS, dvMax2 = dvMax * dvMax;

    let useGpu = !!gpuOk && !this.balls.length && !this._grabs.size && !bodies.some(b => (b.kinematic && b.kin && b.kin.sa) || b.drive === this.frame), gpuBack = null;
    if (useGpu) {
      // knocked off its feet by a strong field (the CPU path checks this inside its predict step)
      for (let k = 0; k < nbBody; k++) {
        const b = bodies[k]; if (b.asleep || b.kinematic || b.koHit || !fields.length) continue;
        const bx_ = (b.aabb[0] + b.aabb[3]) / 2, by_ = (b.aabb[1] + b.aabb[4]) / 2, bz_ = (b.aabb[2] + b.aabb[5]) / 2;
        for (const F of fields) {
          if (F.type !== 'vortex' && F.type !== 'attract' && F.type !== 'wind') continue;
          let acc = Math.abs(F.strength);
          if (F.type !== 'wind') { const dx = F.p[0] - bx_, dy = F.p[1] - by_, dz = F.p[2] - bz_, d = Math.sqrt(dx * dx + dy * dy + dz * dz); acc = F.radius && d > F.radius ? 0 : acc * (F.radius ? 1 - d / F.radius : 1); }
          if (acc > 14) b.koHit = true;
        }
      }
      // shape-matching settings per body for this frame: [pose pass], [own clusters pass] as active, ksm, perParticle, kfol, ctw, damp
      const shape = [];
      for (let k = 0; k < nbBody; k++) {
        const b = bodies[k];
        const koHold = b.params.koHold != null ? b.params.koHold : 0.18;
        const tone = b.tone * (1 - b.ko) + (b.softSeg ? koHold : 0) * b.ko;
        if (b.ko > 0.5 && b.poseClusters.length > 1) { if (b.cutF == null) b.cutF = this.frame; } else b.cutF = null;
        const cutK = b.cutF != null ? 1 + 1.2 * Math.min(1, (this.frame - b.cutF) * tsK / 60) : 1;
        const ctwK = 12 + (Engine.KOCTW - 12) * b.ko;
        const P = tone > 0.001 && b.poseClusters.length ? [1, kAdj(Math.min(1, tone * tone * 0.5 * cutK)), 0, 0, ctwK, Engine.KODAMP * b.ko] : [0, 0, 0, 0, 12, 0];
        const S = b.skeleton ? [1, 0.85, 0, b.firm, 12, 0] : b.softSeg ? [1, kAdj(b.firm), 1, 0, ctwK, 0] : b.rig > 0 ? [1, Math.min(1, b.rig * b.rig * 0.9), 1, 0, 12, 0] : [0, 0, 0, 0, 12, 0];
        shape.push([P, S]);
      }
      gpuBack = yield { ns, h, ih, dt, gx, gy, gz, floorOn, floorY, floorMu, cols, ctype, cdim, cmu, cspin, cshat, cB, cP, fields, ppEvery, ppMu, dvMax, icell, shape };
      brokenThisFrame += gpuBack.broken;
    } else
    for (let s = 0; s < ns; s++) {
      const ta = s / ns, tb = (s + 1) / ns;
      // interpolate colliders
      for (let c = 0; c < nc; c++) {
        const C = cols[c], o = c * 32;
        nlerpQ(C.a.q, C.b.q, ta, qa); nlerpQ(C.a.q, C.b.q, tb, qb);
        const ma = quatToMat(qa[0], qa[1], qa[2], qa[3]), mb = quatToMat(qb[0], qb[1], qb[2], qb[3]);
        for (let k = 0; k < 9; k++) { cA[o + k] = ma[k]; cA[o + 9 + k] = mb[k]; }
        cA[o + 18] = C.a.p[0] + (C.b.p[0] - C.a.p[0]) * ta; cA[o + 19] = C.a.p[1] + (C.b.p[1] - C.a.p[1]) * ta; cA[o + 20] = C.a.p[2] + (C.b.p[2] - C.a.p[2]) * ta;
        cA[o + 21] = C.a.p[0] + (C.b.p[0] - C.a.p[0]) * tb; cA[o + 22] = C.a.p[1] + (C.b.p[1] - C.a.p[1]) * tb; cA[o + 23] = C.a.p[2] + (C.b.p[2] - C.a.p[2]) * tb;
      }

      // predict
      for (let k = 0; k < nbBody; k++) {
        const b = bodies[k]; if (b.asleep) continue;
        const e = b.start + b.count;
        if (b.kinematic && b.kin && b.kin.sa) { this._kinSeg(b, tb, qb); continue; }
        if (b.kinematic && b.kin) {
          nlerpQ(b.kin.a.q, b.kin.b.q, tb, qb);
          const m = quatToMat(qb[0], qb[1], qb[2], qb[3]);
          const px = b.kin.a.p[0] + (b.kin.b.p[0] - b.kin.a.p[0]) * tb, py = b.kin.a.p[1] + (b.kin.b.p[1] - b.kin.a.p[1]) * tb, pz = b.kin.a.p[2] + (b.kin.b.p[2] - b.kin.a.p[2]) * tb;
          const r = this.r;
          for (let i = b.start; i < e; i++) {
            const i3 = 3 * i, rx = r[i3], ry = r[i3 + 1], rz = r[i3 + 2];
            xp[i3] = x[i3]; xp[i3 + 1] = x[i3 + 1]; xp[i3 + 2] = x[i3 + 2];
            x[i3] = m[0] * rx + m[1] * ry + m[2] * rz + px;
            x[i3 + 1] = m[3] * rx + m[4] * ry + m[5] * rz + py;
            x[i3 + 2] = m[6] * rx + m[7] * ry + m[8] * rz + pz;
            if (anc[i]) { ancPos[i3] = x[i3]; ancPos[i3 + 1] = x[i3 + 1]; ancPos[i3 + 2] = x[i3 + 2]; }
          }
          continue;
        }
        const damp = Math.max(0, 1 - b.drag * h);
        // a field strong enough to beat gravity (tornado, black hole) knocks the body off its feet: anchors and pose let go
        if (!b.koHit && fields.length) {
          const bx_ = (b.aabb[0] + b.aabb[3]) / 2, by_ = (b.aabb[1] + b.aabb[4]) / 2, bz_ = (b.aabb[2] + b.aabb[5]) / 2;
          for (let f = 0; f < fields.length; f++) {
            const F = fields[f]; if (F.type !== 'vortex' && F.type !== 'attract' && F.type !== 'wind') continue;
            let acc = Math.abs(F.strength);
            if (F.type !== 'wind') { const dx = F.p[0] - bx_, dy = F.p[1] - by_, dz = F.p[2] - bz_, d = Math.sqrt(dx * dx + dy * dy + dz * dz); acc = F.radius && d > F.radius ? 0 : acc * (F.radius ? 1 - d / F.radius : 1); }
            if (acc > 14) b.koHit = true;
          }
        }
        for (let i = b.start; i < e; i++) {
          if (w[i] === 0) continue;
          const i3 = 3 * i;
          let vx = v[i3] + gx * h, vy = v[i3 + 1] + gy * h, vz = v[i3 + 2] + gz * h;
          for (let f = 0; f < fields.length; f++) {
            const F = fields[f];
            if (F.type === 'wind') { vx += F.dir[0] * F.strength * h; vy += F.dir[1] * F.strength * h; vz += F.dir[2] * F.strength * h; }
            else if (F.type === 'vortex') {
              // a tornado is wind: everything is dragged toward a swirling, rising flow, so bodies orbit and lift instead of being flung out
              const ax = F.axis[0], ay = F.axis[1], az = F.axis[2];
              const qx = x[i3] - F.p[0], qy = x[i3 + 1] - F.p[1], qz = x[i3 + 2] - F.p[2];
              const hgt = qx * ax + qy * ay + qz * az;
              const rx = qx - ax * hgt, ry = qy - ay * hgt, rz = qz - az * hgt, rh = Math.sqrt(rx * rx + ry * ry + rz * rz) + 1e-6;
              const R_ = F.radius || 4;
              if (rh > R_ || hgt < -0.5) continue;
              const fh = 1 - rh / R_, hf = Math.max(0, Math.min(1, 1 - hgt / (R_ * 0.9)));
              const ux = rx / rh, uy = ry / rh, uz = rz / rh;
              const tx = ay * uz - az * uy, ty = az * ux - ax * uz, tz = ax * uy - ay * ux;
              const Vt = F.strength * 0.17 * Math.min(1, rh / 2), Vin = -F.strength * 0.3 * Math.max(0.3, fh) * Math.max(-0.5, Math.min(1, rh - 1)), Vu = F.lift * 0.45 * hf;
              const k_ = Math.min(1, 5 * Math.min(1, fh * 4) * h);
              vx += (tx * Vt + ux * Vin + ax * Vu - vx) * k_; vy += (ty * Vt + uy * Vin + ay * Vu - vy) * k_; vz += (tz * Vt + uz * Vin + az * Vu - vz) * k_;
            }
            else if (F.type === 'attract') {
              const dx = F.p[0] - x[i3], dy = F.p[1] - x[i3 + 1], dz = F.p[2] - x[i3 + 2];
              const d2 = dx * dx + dy * dy + dz * dz;
              if (F.radius && d2 > F.radius * F.radius) continue;
              const d = Math.sqrt(d2) + 0.05;
              const fall = F.radius ? (1 - (d - 0.05) / F.radius) : 1;
              // pull grows sharply near the core, so the side nearer the hole is pulled harder (tidal tearing)
              const a = F.strength * fall * (1 + 0.35 / (d * d)) / d;
              vx += dx * a * h; vy += dy * a * h; vz += dz * a * h;
            }
          }
          vx *= damp; vy *= damp; vz *= damp;
          v[i3] = vx; v[i3 + 1] = vy; v[i3 + 2] = vz;
          xp[i3] = x[i3]; xp[i3 + 1] = x[i3 + 1]; xp[i3 + 2] = x[i3 + 2];
          x[i3] += vx * h; x[i3 + 1] += vy * h; x[i3 + 2] += vz * h;
          ct[i] = 0;
        }
      }

      // colliders + floor
      for (let k = 0; k < nbBody; k++) {
        const b = bodies[k]; if (b.asleep || b.kinematic) continue;
        const e = b.start + b.count, bmu = b.mu;
        const shatterV = b.shatter;
        for (let c = 0; c < nc; c++) {
          const C = cols[c], o = c * 32;
          // swept collision: a fast thin object (or the far end of a swinging rod) moves further than its own
          // thickness in one substep and would skip past molecules, so its path through the substep is checked in slices
          const tq = ctype[c], minHalf = tq === 4 ? cdim[3 * c + 1] : tq === 5 ? cdim[3 * c] : Math.min(cdim[3 * c], cdim[3 * c + 1], cdim[3 * c + 2]);
          const mvd = Math.hypot(cA[o + 21] - cA[o + 18], cA[o + 22] - cA[o + 19], cA[o + 23] - cA[o + 20]) + (C._angS || 0) * C.bound;
          const nsl = Math.min(Engine.SWEEPMAX, Math.max(1, Math.ceil(mvd / Math.max(1e-4, (minHalf + (b.spacing || 0.02) * 0.5) * 0.8))));
          if (nsl > 1) for (let q = 0; q < 24; q++) cSave[q] = cA[o + q];
          for (let sk = 0; sk < nsl; sk++) {
          if (nsl > 1) {
            // this slice's pose, and where the same surface point was one whole substep earlier (so speeds stay right)
            const f = (sk + 1) / nsl, g = f - 1;
            for (let q = 0; q < 9; q++) { const A = cSave[q], Bm = cSave[9 + q]; cA[o + 9 + q] = A + (Bm - A) * f; cA[o + q] = A + (Bm - A) * g; }
            for (let q = 0; q < 3; q++) { const A = cSave[18 + q], Bp = cSave[21 + q]; cA[o + 21 + q] = A + (Bp - A) * f; cA[o + 18 + q] = A + (Bp - A) * g; }
          }
          const cx = cA[o + 21], cy = cA[o + 22], cz = cA[o + 23];
          if (!sphereAabb(cx, cy, cz, C._R + 0.05, b.aabb)) continue;
          const R2 = (C.bound + 0.06) * (C.bound + 0.06);
          const t = ctype[c], d0 = cdim[3 * c], d1 = cdim[3 * c + 1], d2 = cdim[3 * c + 2];
          const mu = Math.sqrt(cmu[c] * bmu);
          const ax = cA[o + 18], ay = cA[o + 19], az = cA[o + 20];
          const spx = cspin[6 * c], spy = cspin[6 * c + 1], spz = cspin[6 * c + 2];
          const shat = shatterV * cshat[c], sharp = cshat[c] < 0.45;
          // knives: a sharp thin box (blade) or thin disc (saw) wedges flesh apart across its own plane
          let kAx = -1, kH = 0;
          if (sharp) {
            if (t === 0) { const m = d0 <= d1 && d0 <= d2 ? 0 : d1 <= d2 ? 1 : 2, dm = [d0, d1, d2][m], d2nd = Math.min(...[d0, d1, d2].filter((_, q) => q !== m)); if (dm < 0.3 * d2nd) { kAx = m; kH = dm; } }
            else if (t === 2 && d1 < 0.3 * Math.min(d0, d2)) { kAx = 1; kH = d1; }
          }
          if (C._ring) { kAx = 1; kH = d1; }
          const kwx = kAx >= 0 ? cA[o + 9 + kAx] : 0, kwy = kAx >= 0 ? cA[o + 12 + kAx] : 0, kwz = kAx >= 0 ? cA[o + 15 + kAx] : 0;
          for (let i = b.start; i < e; i++) {
            if (w[i] === 0) continue;
            const i3 = 3 * i;
            const px = x[i3] - cx, py = x[i3 + 1] - cy, pz = x[i3 + 2] - cz;
            if (px * px + py * py + pz * pz > R2) continue;
            // local coords (R^T p), current (b) rotation at o+9
            const qx = cA[o + 9] * px + cA[o + 12] * py + cA[o + 15] * pz;
            const qy = cA[o + 10] * px + cA[o + 13] * py + cA[o + 16] * pz;
            const qz = cA[o + 11] * px + cA[o + 14] * py + cA[o + 17] * pz;
            sdShape(t, qx, qy, qz, d0, d1, d2, _o);
            const ri = rad[i];
            let pen = ri - _o[0];
            // impaled flesh grips a spike's shaft: molecules on or right next to a cone barely slide along it,
            // so a body dropped on spikes is pierced and hangs on them instead of sliding down to the base
            if (t === 3 && pen > -2.5 * ri && nbb[i] < this.nb0[i] && _o[2] < 0.9) {
              const axx = cA[o + 10], axy = cA[o + 13], axz = cA[o + 16];
              const ra = (x[i3] - xp[i3]) * axx + (x[i3 + 1] - xp[i3 + 1]) * axy + (x[i3 + 2] - xp[i3 + 2]) * axz, g = Engine.SPIKEGRIP;
              if (ra < 0) { x[i3] -= axx * ra * g; x[i3 + 1] -= axy * ra * g; x[i3 + 2] -= axz * ra * g; }
            }
            if (pen <= 0) continue;
            let nx = cA[o + 9] * _o[1] + cA[o + 10] * _o[2] + cA[o + 11] * _o[3];
            let ny = cA[o + 12] * _o[1] + cA[o + 13] * _o[2] + cA[o + 14] * _o[3];
            let nz = cA[o + 15] * _o[1] + cA[o + 16] * _o[2] + cA[o + 17] * _o[3];
            let kSide = 0;
            if (kAx >= 0 && !(t === 4 && qx * qx + qz * qz > d0 * d0)) {
              const qa_ = kAx === 0 ? qx : kAx === 1 ? qy : qz;
              kSide = qa_ >= 0 ? 1 : -1;
              // flesh squashed into a block against the floor is never lifted out through the block's top as it rises
              // (that hung crushed bodies from a piston): it goes out through the bottom, onto the floor
              if (floorOn && kwy * kSide > 0.5 && x[i3 + 1] < floorY + 0.12) kSide = -kSide;
              const pk = kH + ri - Math.abs(qa_);
              if (pk > 0) { pen = Math.min(pk, ri * 2); nx = kwx * kSide; ny = kwy * kSide; nz = kwz * kSide; }
            }
            // surface velocity: map the local point through the previous transform
            const wx = cA[o + 0] * qx + cA[o + 1] * qy + cA[o + 2] * qz + ax;
            const wy = cA[o + 3] * qx + cA[o + 4] * qy + cA[o + 5] * qz + ay;
            const wz = cA[o + 6] * qx + cA[o + 7] * qy + cA[o + 8] * qz + az;
            let sdx = x[i3] - wx, sdy = x[i3 + 1] - wy, sdz = x[i3 + 2] - wz; // surface displacement this substep
            if (spx || spy || spz) { sdx += (spy * pz - spz * py) * h; sdy += (spz * px - spx * pz) * h; sdz += (spx * py - spy * px) * h; }
            // impact speed (approach along the normal)
            const vrx = (x[i3] - xp[i3]) - sdx, vry = (x[i3 + 1] - xp[i3 + 1]) - sdy, vrz = (x[i3 + 2] - xp[i3 + 2]) - sdz;
            const vn = (vrx * nx + vry * ny + vrz * nz) * ih;
            const iv = -vn;
            let spent = false;
            if (cB[c] < Infinity) {
              if (cP[c] > 0.7 * cB[c]) { spent = true; pen *= Math.max(0, (cB[c] - cP[c]) / (0.3 * cB[c])); }
              cP[c] += b.pmass * pen * ih;
            }
            x[i3] += nx * pen; x[i3 + 1] += ny * pen; x[i3 + 2] += nz * pen;
            // a fast projectile's contacts do not steer the shape fit (that would drag whole clusters along at its speed)
            if (!spent) ct[i] = cB[c] < Infinity ? 3 : 2;
            b.touchT = this.frame; if (cB[c] === Infinity && cshat[c] >= 0.45) { // blunt only: spikes and blades cut, they do not crush
              b.bluntT = this.frame; // and only a moving one starts a crush (lying on a table or spike base is not one)
              if (sdx * sdx + sdy * sdy + sdz * sdz > 0.0025 * h * h) b.colT = this.frame; }
            if (iv > b.koSpeed) b.koHit = true;
            if (iv > b.boneSnap && b.skeleton) { const br_ = this.boneRef[i]; if (br_ >= 0 && !dead[br_]) this._snapBone(br_, nx, ny, nz); }
            // sharp weapons (blades, saws, spikes) also cut with their sliding edge, not only by ramming
            let ivc = iv;
            // knives (thin blades, saw discs) slice cleanly: their sliding edge only sprays a sparse fixed subset of molecules
            if (sharp && hash32(i * 7 + 11) < (kAx < 0 ? 0.3 : 0.12)) { const tn = vrx * nx + vry * ny + vrz * nz, tx_ = vrx - tn * nx, ty_ = vry - tn * ny, tz_ = vrz - tn * nz; ivc = Math.max(iv, Math.sqrt(tx_ * tx_ + ty_ * ty_ + tz_ * tz_) * ih * 0.35); }
            if (ivc > shat * shm[i] && (nbb[i] < this.nb0[i] || sharp || spent)) this._breakParticle(i);
            if (kSide !== 0) {
              // knife: cut every bond from this molecule to one on the other side of the blade's plane
              for (let a = this.adjStart[i], a1 = this.adjStart[i + 1]; a < a1; a++) {
                const bq = this.adj[a]; if (this.bx[bq]) continue;
                const j = this.bi[bq] === i ? this.bj[bq] : this.bi[bq], j3 = 3 * j;
                if (((x[j3] - cx) * kwx + (x[j3 + 1] - cy) * kwy + (x[j3 + 2] - cz) * kwz) * kSide < 0) {
                  this.bx[bq] = 1; nbb[i]++; nbb[j]++; this.cand[i] = 1; this.cand[j] = 1; this.statBroken++; b.dirty = true;
                }
              }
            } else if ((sharp && pen > ri * 0.12 && iv > 0.25 * shat * shm[i]) || (t === 3 && pen > ri * 0.12 && _o[2] < 0.9)) {
              // spikes always pierce: the shaft parts the flesh it pushes into instead of the body draping round it
              // only a fast stab parts the flesh; once the body has slowed on the point it grips the spike and stays impaled
              // a sharp edge pressing in parts the flesh: bonds that reach through the blade are cut
              const lim = -0.6 * ri;
              for (let a = this.adjStart[i], a1 = this.adjStart[i + 1]; a < a1; a++) {
                const bq = this.adj[a]; if (this.bx[bq]) continue;
                const j = this.bi[bq] === i ? this.bj[bq] : this.bi[bq], j3 = 3 * j;
                if ((x[j3] - x[i3]) * nx + (x[j3 + 1] - x[i3 + 1]) * ny + (x[j3 + 2] - x[i3 + 2]) * nz < lim) {
                  this.bx[bq] = 1; nbb[i]++; nbb[j]++; this.cand[i] = 1; this.cand[j] = 1; this.statBroken++; b.dirty = true;
                }
              }
            }
            // flesh cannot reach through a solid: a bond whose middle now lies deep inside the collider has had the
            // collider pass between its two ends (a ring closing through a waist, a bar pushed through an arm), so it is cut
            if (kSide === 0 && Engine.THRUCUT && t !== 3) {
              const lim = -Engine.THRUCUT * ri;
              for (let a = this.adjStart[i], a1 = this.adjStart[i + 1]; a < a1; a++) {
                const bq = this.adj[a]; if (this.bx[bq]) continue;
                const j = this.bi[bq] === i ? this.bj[bq] : this.bi[bq], j3 = 3 * j;
                const mx = 0.5 * (x[i3] + x[j3]) - cx, my = 0.5 * (x[i3 + 1] + x[j3 + 1]) - cy, mz = 0.5 * (x[i3 + 2] + x[j3 + 2]) - cz;
                const lx = cA[o + 9] * mx + cA[o + 12] * my + cA[o + 15] * mz;
                const ly = cA[o + 10] * mx + cA[o + 13] * my + cA[o + 16] * mz;
                const lz = cA[o + 11] * mx + cA[o + 14] * my + cA[o + 17] * mz;
                sdShape(t, lx, ly, lz, d0, d1, d2, _o2);
                if (_o2[0] >= lim) continue;
                // ...and only when the far end is out on the other side too (a molecule merely not pushed out yet is not)
                const ex = x[j3] - cx, ey = x[j3 + 1] - cy, ez = x[j3 + 2] - cz;
                sdShape(t, cA[o + 9] * ex + cA[o + 12] * ey + cA[o + 15] * ez, cA[o + 10] * ex + cA[o + 13] * ey + cA[o + 16] * ez, cA[o + 11] * ex + cA[o + 14] * ey + cA[o + 17] * ez, d0, d1, d2, _o2);
                if (_o2[0] > 0) { this.bx[bq] = 1; nbb[i]++; nbb[j]++; this.cand[i] = 1; this.cand[j] = 1; this.statBroken++; b.dirty = true; }
              }
            }
            // sticky goo: loose drops that touch a weapon can stick to it for a moment (only drops: torn flesh still
            // attached would hang the whole crushed body from a piston as it goes back up)
            if (b.goo > 0 && cB[c] === Infinity && nbb0[i] >= this.nb0[i] && stk[i] === -1 && C.sticky !== false && hash32(i * 31 + this.frame * 7 + s) < b.goo * 0.6) {
              const lx = cA[o + 9] * (x[i3] - cx) + cA[o + 12] * (x[i3 + 1] - cy) + cA[o + 15] * (x[i3 + 2] - cz);
              const ly = cA[o + 10] * (x[i3] - cx) + cA[o + 13] * (x[i3 + 1] - cy) + cA[o + 16] * (x[i3 + 2] - cz);
              const lz = cA[o + 11] * (x[i3] - cx) + cA[o + 14] * (x[i3 + 1] - cy) + cA[o + 17] * (x[i3 + 2] - cz);
              stk[i] = C._id; stq[i3] = lx; stq[i3 + 1] = ly; stq[i3 + 2] = lz;
            }
            // friction relative to the moving surface
            const rx = (x[i3] - xp[i3]) - sdx, ry = (x[i3 + 1] - xp[i3 + 1]) - sdy, rz = (x[i3 + 2] - xp[i3 + 2]) - sdz;
            const rn = rx * nx + ry * ny + rz * nz;
            const tx = rx - rn * nx, ty = ry - rn * ny, tz = rz - rn * nz;
            const tl = Math.sqrt(tx * tx + ty * ty + tz * tz);
            if (tl > 1e-9) {
              // a blade's polished face barely drags flesh (a spinning saw face would otherwise shred everything it brushes)
              let f = slowK(Math.min(1, (kSide !== 0 ? mu * 0.08 : mu) * pen * 2.5 / tl));
              // impaled flesh grips a spike: once it slows down it stops sliding further down the shaft
              x[i3] -= tx * f; x[i3 + 1] -= ty * f; x[i3 + 2] -= tz * f;
            }
          }
          }
          if (nsl > 1) for (let q = 0; q < 24; q++) cA[o + q] = cSave[q];
        }
        if (floorOn && b.aabb[1] < floorY + 0.5 + MAXV * dt) {
          const fmu = Math.sqrt(floorMu * bmu);
          for (let i = b.start; i < e; i++) {
            if (w[i] === 0) continue;
            const i3 = 3 * i, ri = rad[i];
            const pen = floorY + ri - x[i3 + 1];
            if (pen <= 0) continue;
            const vy = (x[i3 + 1] - xp[i3 + 1]) * ih;
            x[i3 + 1] += pen;
            ct[i] = 1;
            if (-vy > shatterV * 1.15 * shm[i] && nbb[i] < this.nb0[i]) this._breakParticle(i);
            // blood: loose molecules that land on the floor stay there as splats
            if (b.goo > 0 && stk[i] === -1 && nbb0[i] >= this.nb0[i] && hash32(i * 17 + this.frame * 3 + s) < b.goo * 0.8) {
              stk[i] = -2; stq[i3] = x[i3]; stq[i3 + 1] = floorY + ri * 0.9; stq[i3 + 2] = x[i3 + 2];
            }
            const tx = x[i3] - xp[i3], tz = x[i3 + 2] - xp[i3 + 2];
            const tl = Math.sqrt(tx * tx + tz * tz);
            if (tl > 1e-9) { const f = slowK(Math.min(1, fmu * pen * 2.5 / tl)); x[i3] -= tx * f; x[i3 + 2] -= tz * f; }
          }
        }
      }

      if (this.balls.length) this._balls(h, ih, gx, gy, gz, floorOn, floorY, floorMu, cA, ctype, cdim, nc, cols);

      // molecules stuck to colliders follow the surface until pulled away
      for (let k = 0; k < nbBody; k++) {
        const b = bodies[k]; if (b.asleep || b.kinematic || !(b.goo > 0)) continue;
        for (let i = b.start, e = b.start + b.count; i < e; i++) {
          const sid = stk[i]; if (sid === -1) continue;
          if (sid === -2) { // stuck on the floor
            const i3 = 3 * i, dx = stq[i3] - x[i3], dy = stq[i3 + 1] - x[i3 + 1], dz = stq[i3 + 2] - x[i3 + 2];
            if (w[i] === 0 || nbb[i] < this.nb0[i] || dx * dx + dy * dy + dz * dz > 9 * rad[i] * rad[i]) { stk[i] = -1; continue; }
            x[i3] = stq[i3]; x[i3 + 1] = stq[i3 + 1]; x[i3 + 2] = stq[i3 + 2];
            continue;
          }
          const c = sid < idToCol.length ? idToCol[sid] : -1;
          if (c < 0 || w[i] === 0) { stk[i] = -1; continue; }
          const o = c * 32, i3 = 3 * i, lx = stq[i3], ly = stq[i3 + 1], lz = stq[i3 + 2];
          const tx = cA[o + 9] * lx + cA[o + 10] * ly + cA[o + 11] * lz + cA[o + 21];
          const ty = cA[o + 12] * lx + cA[o + 13] * ly + cA[o + 14] * lz + cA[o + 22];
          const tz = cA[o + 15] * lx + cA[o + 16] * ly + cA[o + 17] * lz + cA[o + 23];
          const dx = tx - x[i3], dy = ty - x[i3 + 1], dz = tz - x[i3 + 2];
          // a drop holds only its own weight: anything hanging from it (other drops, flesh linked by goo) pulls it
          // off the surface, so a rising block never lifts a body up by its blood
          if (dx * dx + dy * dy + dz * dz > 0.3 * rad[i] * rad[i]) { stk[i] = -1; continue; }
          // loose blood rides the surface rigidly; molecules still attached to flesh are held more gently
          const kf = nbb[i] >= this.nb0[i] ? 1 : 0.4;
          x[i3] += dx * kf; x[i3 + 1] += dy * kf; x[i3 + 2] += dz * kf;
        }
      }

      // bonds
      for (let k = 0; k < nbBody; k++) {
        const b = bodies[k]; if (b.asleep || b.kinematic) continue;
        this._bondPass(b.bstart, b.bstart + b.bcount, b.stiff);
      }

      // goo links
      if (this.lcount) {
        const li = this.li, lj = this.lj, lr = this.lr, lx = this.lx;
        for (let q = 0, e = this.lcount; q < e; q++) {
          if (lx[q]) continue;
          const i = li[q], j = lj[q], i3 = 3 * i, j3 = 3 * j;
          if (bodies[this.pb[i]].asleep && bodies[this.pb[j]].asleep) continue;
          const dx = x[j3] - x[i3], dy = x[j3 + 1] - x[i3 + 1], dz = x[j3 + 2] - x[i3 + 2];
          const L = Math.sqrt(dx * dx + dy * dy + dz * dz);
          const wi = w[i], wj = w[j], ws = wi + wj;
          if (ws === 0 || L < 1e-9) continue;
          const sc = 0.55 * (L - lr[q]) / (L * ws);
          x[i3] += wi * sc * dx; x[i3 + 1] += wi * sc * dy; x[i3 + 2] += wi * sc * dz;
          x[j3] -= wj * sc * dx; x[j3 + 1] -= wj * sc * dy; x[j3 + 2] -= wj * sc * dz;
        }
      }

      // shape matching
      for (let k = 0; k < nbBody; k++) {
        const b = bodies[k]; if (b.asleep || b.kinematic) continue;
        // knocked out bodies do not go limp: every intact piece keeps springing back toward its pose (elastic, wobbly)
        // while a weapon squeezes the body, flesh pushed far from its shape yields and keeps the dent afterwards
        this._crush = b.softSeg && this.frame - (b.touchT ?? -99) < 2 ? (b.params.crush != null ? b.params.crush : 1) : 0;
        this._crushY2 = Math.pow(2.5 * (b.spacing || 0.02), 2);
        const koHold = b.params.koHold != null ? b.params.koHold : 0.18;
        const tone = b.tone * (1 - b.ko) + (b.softSeg ? koHold : 0) * b.ko;
        // a body cut into pieces: each piece keeps its own shape firmly instead of draping like wet cloth
        // eased in over about a second so a freshly cut piece settles into shape instead of springing up
        if (b.ko > 0.5 && b.poseClusters.length > 1) { if (b.cutF == null) b.cutF = this.frame; } else b.cutF = null;
        const cutK = b.cutF != null ? 1 + 1.2 * Math.min(1, (this.frame - b.cutF) * tsK / 60) : 1;
        if (tone > 0.001 && b.poseClusters.length) this._shapeMatch(b.poseClusters, kAdj(Math.min(1, tone * tone * 0.5 * cutK)), false, 0, 12 + (Engine.KOCTW - 12) * b.ko, Engine.KODAMP * b.ko);
        // squeezed or bent far out of its pose (a press, a wall pin) the body gives way instead of standing like a statue
        if (!b.koHit && !b.params.rend && b.poseClusters.length && this._smRes > 0.0016) b.koHit = true;
        if (b.skeleton) this._shapeMatch(b.clusters, 0.85, false, b.firm);
        else if (b.softSeg) this._shapeMatch(b.clusters, kAdj(b.firm), true, 0, 12 + (Engine.KOCTW - 12) * b.ko);
        else if (b.rig > 0) this._shapeMatch(b.clusters, Math.min(1, b.rig * b.rig * 0.9), true);
      }

      // anchors
      for (let k = 0; k < nbBody; k++) {
        const b = bodies[k]; if (b.asleep || !b.params.stand) continue;
        if (b.ko > 0.4 && !b.kinematic) { for (let i = b.start, e = b.start + b.count; i < e; i++) anc[i] = 0; continue; }
        const lim2 = Math.pow(0.0025 * b.anchorStr * (60 * dt * 8 / ns), 2);
        for (let i = b.start, e = b.start + b.count; i < e; i++) {
          if (!anc[i]) continue;
          const i3 = 3 * i;
          const dx = x[i3] - ancPos[i3], dy = x[i3 + 1] - ancPos[i3 + 1], dz = x[i3 + 2] - ancPos[i3 + 2];
          if (!b.kinematic && dx * dx + dy * dy + dz * dz > lim2) { anc[i] = 0; continue; }
          x[i3] = ancPos[i3]; x[i3 + 1] = ancPos[i3 + 1]; x[i3 + 2] = ancPos[i3 + 2];
        }
      }

      // held molecules follow the hand
      if (this._grabs.size) for (const S of this._grabs.values()) {
        if (!S.idx.length && !S.ball) continue;
        const gq = nlerpQ(S.qa, S.qb, tb, [0, 0, 0, 1]), m = quatToMat(gq[0], gq[1], gq[2], gq[3]);
        const px = S.a[0] + (S.b[0] - S.a[0]) * tb, py = S.a[1] + (S.b[1] - S.a[1]) * tb, pz = S.a[2] + (S.b[2] - S.a[2]) * tb, K = S.k;
        const idx = S.idx, off = S.off;
        for (let n = 0; n < idx.length; n++) {
          const i = idx[n]; if (this.dead[i]) continue;
          const i3 = 3 * i, ox = off[3 * n], oy = off[3 * n + 1], oz = off[3 * n + 2];
          x[i3] += (m[0] * ox + m[1] * oy + m[2] * oz + px - x[i3]) * K;
          x[i3 + 1] += (m[3] * ox + m[4] * oy + m[5] * oz + py - x[i3 + 1]) * K;
          x[i3 + 2] += (m[6] * ox + m[7] * oy + m[8] * oz + pz - x[i3 + 2]) * K;
        }
        if (S.ball) {
          const B = S.ball, o = S.boff, tx = m[0] * o[0] + m[1] * o[1] + m[2] * o[2] + px, ty = m[3] * o[0] + m[4] * o[1] + m[5] * o[2] + py, tz = m[6] * o[0] + m[7] * o[1] + m[8] * o[2] + pz;
          B.v[0] = (tx - B.x[0]) * ih; B.v[1] = (ty - B.x[1]) * ih; B.v[2] = (tz - B.x[2]) * ih; B.x[0] = tx; B.x[1] = ty; B.x[2] = tz;
        }
      }

      // keep the floor non-penetrating after constraints
      if (floorOn) for (let k = 0; k < nbBody; k++) {
        const b = bodies[k]; if (b.asleep || b.kinematic) continue;
        if (b.aabb[1] > floorY + 0.5 + MAXV * dt) continue;
        for (let i = b.start, e = b.start + b.count; i < e; i++) {
          const i3 = 3 * i, lo = floorY + rad[i];
          if (x[i3 + 1] < lo && w[i] !== 0) x[i3 + 1] = lo;
        }
      }

      // particle-particle contacts
      if ((s % ppEvery) === ppEvery - 1 || s === ns - 1) this._contacts(icell, ppMu, 2.0 * h * ppEvery, ih);

      // velocities
      const cvn = this.cvn;
      for (let k = 0; k < nbBody; k++) {
        const b = bodies[k]; if (b.asleep) continue;
        b.maxSpeed = this._velPass(b.start, b.start + b.count, !!b.kinematic, ih, dvMax, dvMax2);
        // internal damping: bonds resist the speed at which they stretch, so flesh wobbles and settles instead of ringing
        if (b.damp > 0 && !b.kinematic) this._dampPass(b.bstart, b.bstart + b.bcount, b.damp);
      }
    }
    for (let c = 0; c < nc; c++) if (cB[c] < Infinity && cP[c] > 0) this.colMom.set(cols[c]._id, { P: cP[c], f: this.frame });

    // fracture: bonds whose strain at the end of the frame exceeds their limit snap (done on the GPU in GPU mode)
    const press = this.press, pcnt = this.pcnt, crx = this.crx, csus = this.csus;
    if (!useGpu) for (let k = 0; k < nbBody; k++) {
      const b = bodies[k]; if (b.asleep || b.kinematic) continue;
      const str = b.str, pl = b.plastic, br0 = this.br0, bbone = this.bbone;
      press.fill(0, b.start, b.start + b.count); pcnt.fill(0, b.start, b.start + b.count);
      for (let q = b.bstart, e = b.bstart + b.bcount; q < e; q++) {
        if (bx[q]) continue;
        const i = bi[q], j = bj[q], i3 = 3 * i, j3 = 3 * j;
        const dx = x[j3] - x[i3], dy = x[j3 + 1] - x[i3 + 1], dz = x[j3 + 2] - x[i3 + 2];
        const L = Math.sqrt(dx * dx + dy * dy + dz * dz);
        // internal pressure: how squeezed each molecule's bonds are
        const cpr = 1 - L / br0[q]; press[i] += cpr; press[j] += cpr; if (pcnt[i] < 255) pcnt[i]++; if (pcnt[j] < 255) pcnt[j]++;
        // soft tissue yields: beyond a small strain its rest length creeps toward the current length (dough, not a spring)
        if (pl > 0 && !bbone[q]) {
          const st0 = L / br[q] - 1, y = 0.06;
          if (st0 > y || st0 < -y) {
            let nr = br[q] + (L - br[q] * (1 + (st0 > 0 ? y : -y))) * pl;
            const r0 = br0[q]; nr = nr < r0 * 0.55 ? r0 * 0.55 : nr;
            br[q] = nr;
          }
        }
        const st = L / br0[q] - 1, sr = L / br[q] - 1;
        // crushed flesh: held under a press it can't take the stretching of being squashed flat, so it splits open
        const cz = crx[i] > crx[j] ? crx[i] : crx[j], sk = cz > 0 ? str * (1 - Engine.CRUSHWEAK * cz) : str;
        if (st > bsl[q] * sk || sr > bsl[q] * sk || sr < -bcl[q] * str) {
          bx[q] = 1; nbb[i]++; nbb[j]++; cand[i] = 1; cand[j] = 1; brokenThisFrame++; b.dirty = true;
        }
      }
    }

    // pressure: mean bond squeeze per molecule (positive = compressed). Skin over flesh under extreme pressure bursts.
    for (let k = 0; k < nbBody; k++) {
      const b = bodies[k]; if (b.asleep || b.kinematic) continue;
      const burst = b.softSeg && this.frame - (b.touchT ?? -99) < 2 ? 0.15 * (b.params.burst != null ? b.params.burst : 1) * Math.max(0.5, b.shatter / 10) : 1e9;
      for (let i = b.start, e = b.start + b.count; i < e; i++) {
        if (!useGpu) press[i] = pcnt[i] ? press[i] / pcnt[i] : 0;
        // only sustained squeezing (a press, not the jolt of a fall) bursts the skin
        if (this.tis[i] === 0 && press[i] > burst) { if (this.pdur[i] < 255) this.pdur[i]++; } else this.pdur[i] = 0;
        if (this.pdur[i] > Math.min(250, 8 / tsK) && nbb[i] < this.nb0[i]) { this._breakParticle(i); }
      }
      // crushing: flesh squeezed for a while (not the jolt of a hit) builds up crush damage, which weakens it (see fracture)
      if (!b.softSeg) continue;
      const touching = b.selfCol, c0 = Engine.CRUSHP, sus = Math.min(250, Math.round(5 / tsK));
      let nCr = 0;
      for (let i = b.start, e = b.start + b.count; i < e; i++) {
        const p = press[i];
        if (touching && p > c0) { if (csus[i] < 255) csus[i]++; } else csus[i] = 0;
        if (csus[i] > sus) crx[i] = Math.min(1, crx[i] + (p - c0) * 1.5 * tsK);
        else if (crx[i] > 0) crx[i] *= 1 - 0.01 * tsK;
        if (crx[i] > 0.5) nCr++;
        // badly crushed soft insides turn to pulp (loose molecules), and the skin over them gives way here and there
        const cz = crx[i];
        if (cz > Engine.CRUSHPULP && nbb[i] < this.nb0[i] && this.tis[i] !== this.boneT && this.tis[i] !== this.cartT) {
          const rate = (cz - Engine.CRUSHPULP) * (this.tis[i] === 0 ? 0.15 : 0.3) * tsK;
          if (hash32(i * 2246822519 + this.frame * 3266489917) < rate) this._breakParticle(i);
        }
      }
      b.crushAmt = nCr / b.count;
      // the squeezed insides of a torn, crushed body squirt out toward wherever the pressure is lower (the openings)
      if (nCr > 0) {
        const adj = this.adj, as = this.adjStart, kv = Engine.CRUSHSQUIRT;
        for (let i = b.start, e = b.start + b.count; i < e; i++) {
          if (crx[i] < 0.3 || press[i] < c0 || w[i] === 0 || this.tis[i] === this.boneT) continue;
          if (nbb[i] === 0 && this.tis[i] !== 0) continue; // still whole flesh: it doesn't flow
          const i3 = 3 * i; let gx = 0, gy = 0, gz = 0;
          for (let a = as[i]; a < as[i + 1]; a++) {
            const q = adj[a], j = bi[q] === i ? bj[q] : bi[q], j3 = 3 * j;
            const dx = x[j3] - x[i3], dy = x[j3 + 1] - x[i3 + 1], dz = x[j3 + 2] - x[i3 + 2], l = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6;
            const dp = press[i] - press[j]; gx += dx / l * dp; gy += dy / l * dp; gz += dz / l * dp;
          }
          const gl = Math.sqrt(gx * gx + gz * gz + gy * gy); if (gl < 1e-6) continue;
          const sp = Math.min(Engine.CRUSHVMAX, (press[i] - c0) * kv * crx[i]);
          // mostly sideways: the floor and the plate are in the way above and below
          v[i3] += gx / gl * sp; v[i3 + 1] += gy / gl * sp * 0.3; v[i3 + 2] += gz / gl * sp;
        }
      }
    }

    // open wounds: where the skin is torn, the soft insides behind it loosen and ooze out, a few layers deep
    for (let k = 0; k < nbBody; k++) {
      const b = bodies[k]; if (b.asleep || b.kinematic || !b.softSeg) continue;
      const sp = b.params.spill != null ? b.params.spill : 0.5; if (!(sp > 0)) continue;
      const depth = Math.round(2 + sp * 4) + Math.round(8 * Math.min(1, (b.crushAmt || 0) * 5)), cap = b.count * sp * 0.035 * (1 + 10 * Math.min(1, (b.crushAmt || 0) * 5)), pr = Math.min(0.5, sp * 0.08 * dt * 60), spg = this.spg, tis = this.tis, adj = this.adj, as = this.adjStart, nb0 = this.nb0;
      let any = false;
      for (let i = b.start, e = b.start + b.count; i < e; i++) {
        if (dead[i]) continue;
        // seed: a torn skin molecule exposes the flesh bonded to it
        if (tis[i] === 0) {
          if (nbb[i] * 3 >= nb0[i] && spg[i] === 255 && nbb[i] < nb0[i]) {
            spg[i] = 254;
            for (let a = as[i]; a < as[i + 1]; a++) { const q = adj[a], j = bi[q] === i ? bj[q] : bi[q]; if (tis[j] !== 0 && tis[j] !== this.boneT && spg[j] === 255) spg[j] = 0; }
          }
          continue;
        }
        const g = spg[i]; if (g >= depth || nbb[i] >= nb0[i]) continue;
        any = true;
        if ((b.spilled | 0) >= cap || hash32(i * 2654435 + this.frame * 97) >= pr) continue;
        b.spilled = (b.spilled | 0) + 1;
        // this molecule comes loose and the flesh behind it is now exposed
        this._breakParticle(i);
        for (let a = as[i]; a < as[i + 1]; a++) { const q = adj[a], j = bi[q] === i ? bj[q] : bi[q]; if (tis[j] !== 0 && tis[j] !== this.boneT && spg[j] > g + 1) spg[j] = g + 1; }
        const i3 = 3 * i; v[i3 + 1] -= 0.3; // a nudge out of the wound
      }
      if (any) b.spillT = this.frame;
    }

    // kill far particles
    for (let i = 0; i < N; i++) {
      if (dead[i]) continue;
      const i3 = 3 * i;
      if (x[i3 + 1] < -40 || Math.abs(x[i3]) > 300 || Math.abs(x[i3 + 2]) > 300 || x[i3 + 1] > 300) {
        dead[i] = 1; w[i] = 0; v[i3] = v[i3 + 1] = v[i3 + 2] = 0; this._breakParticle(i);
      }
    }

    this._maintainLinks();
    // stuck molecules drip off now and then
    for (let i = 0; i < N; i++) if (stk[i] >= 0 && hash32(i * 7 + this.frame * 131) < 0.008 * tsK) stk[i] = -1;

    // knockouts: a hard hit (or toppling over) and the body goes limp
    for (let k = 0; k < nbBody; k++) {
      const b = bodies[k]; if (b.asleep || b.kinematic) continue;
      if (!b.koHit && b.ko === 0 && b.poseClusters.length) {
        let big = b.poseClusters[0]; for (const P of b.poseClusters) if (P.m.length > big.m.length) big = P;
        const q = big.q; if (q) { const upY = 1 - 2 * (q[0] * q[0] + q[2] * q[2]); if (upY < 0.8) b.koHit = true; }
      }
      // cut into big pieces (halved, a leg off): it cannot stand any more
      if (!b.koHit && b.ko === 0 && b.poseClusters.length > 1 && b.softSeg) {
        let a1 = 0, a2 = 0; for (const P of b.poseClusters) { const m = P.m.length; if (m > a1) { a2 = a1; a1 = m; } else if (m > a2) a2 = m; }
        if (a2 > 0.15 * b.count) b.koHit = true;
      }
      if (b.koHit && b.ko < 1) b.ko = Math.min(1, b.ko + Math.max(dt, tsK / 240) / (b.params.koTime != null ? b.params.koTime : (b.softSeg ? 0.03 : 0.12)));
      else if (b.ko > 0 && b.ko < 1) b.ko = Math.min(1, b.ko + dt / 0.12);
    }

    this.statBroken += brokenThisFrame;
    // post-frame: clusters, aabb, sleep
    for (let k = 0; k < nbBody; k++) {
      const b = bodies[k];
      if (b.asleep) continue;
      if (b.dirty) this._rebuildClusters(b);
      this._aabb(b);
      // crushed flat (a press, a piston): the flesh stays squashed instead of springing back up into its old shape
      // like rubber once the weight lifts; its new rest shape is the squashed one and it is out cold
      if (b.softSeg && !b.kinematic && b.count > 50) {
        const hgt = b.aabb[4] - b.aabb[1];
        if (b.h0 == null) b.h0 = hgt;
        else if (!b.crushed && hgt < 0.08 * b.h0 && b.h0 > 0.3 && !Engine.NOCRUSH) {
          b.crushed = true; b.koHit = true; b.ko = 1;
          const r = this.r, br0 = this.br0, br = this.br, bi = this.bi, bj = this.bj, bx = this.bx;
          for (let i = 3 * b.start, e = 3 * (b.start + b.count); i < e; i++) r[i] = x[i];
          for (let q = b.bstart, e = b.bstart + b.bcount; q < e; q++) {
            if (bx[q]) continue;
            const i3 = 3 * bi[q], j3 = 3 * bj[q], d = Math.hypot(x[i3] - x[j3], x[i3 + 1] - x[j3 + 1], x[i3 + 2] - x[j3 + 2]);
            br0[q] = d; br[q] = d;
          }
          for (let i = b.start, e = b.start + b.count; i < e; i++) this.anc[i] = 0;
          b.dirty = true; this._rebuildClusters(b);
        }
      }
      if (!b.kinematic && b.maxSpeed < 0.08 && b.params.canSleep !== false && !(this.frame - (b.touchT ?? -99) < 3) && !(this.frame - (b.spillT ?? -99) < 3)) {
        if (++b.sleepCnt > 40 / tsK) { b.asleep = true; for (let i = b.start, e = b.start + b.count; i < e; i++) { const i3 = 3 * i; v[i3] = v[i3 + 1] = v[i3 + 2] = 0; } }
      } else b.sleepCnt = 0;
    }
    // particle display state
    const st = this.state, nb0 = this.nb0;
    for (let i = 0; i < N; i++) {
      const a = nbb[i], z = nb0[i];
      st[i] = a === 0 ? 0 : (a >= z ? 2 : ((a >= 2 || a * 3 >= z) ? 1 : 0));
    }
    this.frame++;
    let awake = 0; for (const b of bodies) if (!b.asleep) awake++;
    const t1 = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    const events = this.events; this.events = [];
    let balls = null;
    if (this.balls.length) { balls = { keys: this.balls.map(B => B.key), data: new Float32Array(this.balls.length * 7) }; this.balls.forEach((B, k) => { balls.data.set([B.x[0], B.x[1], B.x[2], B.q[0], B.q[1], B.q[2], B.q[3]], 7 * k); }); }
    // bodies still posed by their skeleton at the end of this frame (the renderer skins them straight from the bones)
    const kin = []; for (let k = 0; k < bodies.length; k++) { const b = bodies[k]; if (b.kinematic && b.kin && b.kin.sa) kin.push(k); }
    return { ms: t1 - t0, awake, broken: this.statBroken, bonds: this.B, links: this.lcount, events, balls, kin, bst: bodies.map(b => [b.kinematic ? 1 : 0, b.animOff ? 1 : 0, b.balLost ? 1 : 0, +(b.ko || 0).toFixed(2), b.drive === this.frame ? 1 : 0, b.dbgWhy || ''].join(',')) };
  };

  Engine.prototype._step1 = function (inp) { this.outX = null; return this._stepGen(inp, false).next().value; };
  // GPU mode: the frame's substeps (and bond fracture) run on the graphics card; frames with loose cannonballs stay on the CPU
  Engine.prototype._step1Async = async function (inp, gpu) {
    this.outX = null;
    const willGpu = !!gpu && !this.balls.length && !(inp.projectiles || []).some(P => !this.ballKey.has(P.key)) && !(inp.bodies || []).some(b => b && b.kin && b.kin.sa);
    if (!willGpu && gpu && gpu.resident) await gpu.download(this);
    const g = this._stepGen(inp, willGpu);
    let r = g.next();
    while (!r.done) r = g.next(await gpu.run(this, r.value));
    r.value.gpu = willGpu;
    return r.value;
  };

  /* slow motion: frames shorter than one physics tick are not simulated one by one (position-based physics gets
   * far too stiff with tiny steps, so weapons stop breaking things). The solver runs fixed ticks of sim time and
   * each frame shows the molecules blended between the two ticks around it. */
  Engine.TICK = 1 / 240;
  // crushing: mean bond squeeze that counts as being crushed, how much crush damage weakens flesh against stretching,
  // and how hard the insides squirt out of a crushed, torn body (m/s per unit of pressure, capped)
  Engine.SQUEEZEV = 1.2; // max speed a ball pinned under flesh can squirt out at (m/s)
  Engine.CRUSHP = 0.035; Engine.CRUSHWEAK = 0.8; Engine.CRUSHSQUIRT = 40; Engine.CRUSHVMAX = 5; Engine.CRUSHPULP = 0.35;
  Engine.prototype._slowPlan = function (inp) {
    const TICK = Engine.TICK;
    if (!(inp.dt < TICK * 0.999)) { this._slow = null; return null; }
    let S = this._slow;
    if (!S) S = this._slow = { T: 0, tCur: 0, pend: [], prj: [], addV: [], last: null, xPrev: null };
    S.T += inp.dt;
    // one-shot things wait for the next tick
    for (const F of inp.fields || []) if (F.type === 'explode' || F.type === 'impulse') S.pend.push(F);
    for (const P of inp.projectiles || []) S.prj.push(P);
    (inp.bodies || []).forEach((b, k) => { if (b && b.addVel) S.addV[k] = b.addVel; });
    const ticks = [];
    const t0 = S.T - inp.dt;
    const lerpP = (a, b, t) => { const f = (t - t0) / inp.dt; return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f]; };
    const lerpQ = (a, b, t) => { const f = (t - t0) / inp.dt, o = [0, 0, 0, 1]; let bx = b[0], by = b[1], bz = b[2], bw = b[3]; if (a[0] * bx + a[1] * by + a[2] * bz + a[3] * bw < 0) { bx = -bx; by = -by; bz = -bz; bw = -bw; } o[0] = a[0] + (bx - a[0]) * f; o[1] = a[1] + (by - a[1]) * f; o[2] = a[2] + (bz - a[2]) * f; o[3] = a[3] + (bw - a[3]) * f; const l = 1 / Math.hypot(o[0], o[1], o[2], o[3]); o[0] *= l; o[1] *= l; o[2] *= l; o[3] *= l; return o; };
    const lerpA = (a, b, t) => { const f = (t - t0) / inp.dt, o = new Float32Array(a.length); for (let i = 0; i < a.length; i++) o[i] = a[i] + (b[i] - a[i]) * f; return o; };
    const seg = (A, ta, tb) => { const o = { a: { p: lerpP(A.a.p, A.b.p, ta), q: lerpQ(A.a.q, A.b.q, ta) }, b: { p: lerpP(A.a.p, A.b.p, tb), q: lerpQ(A.a.q, A.b.q, tb) } }; if (A.sa) { o.sa = lerpA(A.sa, A.sb, ta); o.sb = lerpA(A.sa, A.sb, tb); } return o; };
    let first = true;
    while (S.tCur < S.T - 1e-9) {
      const ta = S.tCur, tb = S.tCur + TICK;
      const ti = Object.assign({}, inp, { dt: TICK });
      ti.colliders = (inp.colliders || []).map(C => Object.assign({}, C, seg(C, ta, tb)));
      ti.bodies = (inp.bodies || []).map((b, k) => { const o = Object.assign({}, b); delete o.addVel; if (b && b.kin) o.kin = seg(b.kin, ta, tb); if (first && S.addV[k]) o.addVel = S.addV[k]; return o; });
      ti.fields = (inp.fields || []).filter(F => F.type !== 'explode' && F.type !== 'impulse').concat(first ? S.pend : []);
      ti.projectiles = first ? S.prj : [];
      if (first) { S.pend = []; S.prj = []; S.addV = []; }
      ticks.push(ti); first = false;
      S.tCur = tb;
    }
    return ticks;
  };
  Engine.prototype._slowOut = function (stats) {
    const S = this._slow;
    if (stats) S.last = stats;
    if (!S.xPrev) { this.outX = null; return S.last; }
    const f = Math.max(0, Math.min(1, 1 - (S.tCur - S.T) / Engine.TICK));
    const a = S.xPrev, b = this.x, o = this.outX && this.outX.length === b.length ? this.outX : (this.outX = new Float32Array(b.length));
    for (let i = 0; i < b.length; i++) o[i] = a[i] + (b[i] - a[i]) * f;
    const st = S.last ? Object.assign({}, S.last, { events: stats ? S.last.events : [] }) : { ms: 0, awake: 0, broken: this.statBroken, bonds: this.B, links: this.lcount, events: [] };
    return st;
  };
  Engine.prototype.step = function (inp) {
    const ticks = this._slowPlan(inp);
    if (!ticks) return this._step1(inp);
    let st = null; const ev = [];
    for (const ti of ticks) { this._slow.xPrev = (this._slow.xPrev && this._slow.xPrev.length === this.x.length) ? (this._slow.xPrev.set(this.x), this._slow.xPrev) : this.x.slice(); st = this._step1(ti); ev.push(...st.events); }
    if (st) st.events = ev;
    return this._slowOut(st);
  };
  Engine.prototype.stepAsync = async function (inp, gpu) {
    const ticks = this._slowPlan(inp);
    if (!ticks) return this._step1Async(inp, gpu);
    let st = null; const ev = [];
    for (const ti of ticks) { this._slow.xPrev = (this._slow.xPrev && this._slow.xPrev.length === this.x.length) ? (this._slow.xPrev.set(this.x), this._slow.xPrev) : this.x.slice(); st = await this._step1Async(ti, gpu); ev.push(...st.events); }
    if (st) st.events = ev;
    return this._slowOut(st);
  };

  Engine.COLDENS = 1500; // kg/m^3 for animated colliders
  Engine.SPIKEGRIP = typeof process !== 'undefined' && process.env && process.env.SPIKEGRIP ? +process.env.SPIKEGRIP : 1;
  Engine.LIGHTM = 150; // kg: heavier colliders (hammers, rams, presses) still act as unstoppable
  Engine.BALANCE = 30; Engine.HITBYV = 2.5; Engine.RENDV = 1.2; Engine.THRUCUT = 0.5; Engine.CUTMU = 0.12;
  Engine.DRIVE_EASE = 0.35; // share of the way to the animated shape the muscles move each frame // 1/s²: how hard a driven (hit but still animated) body holds its animated stance
  Engine.RELVMAX = 4; // m/s: fastest a limb may move relative to its body when physics takes over from an animation
  Engine.FASTV = 6; // m/s: only faster colliders have a momentum budget
  Engine.KOCTW = typeof process !== 'undefined' && process.env && process.env.KOCTW ? +process.env.KOCTW : 1;
  Engine.BALLZONE = typeof process !== 'undefined' && process.env && process.env.BALLZONE ? +process.env.BALLZONE : 1;
  Engine.FLESHREST = 0.1;
  Engine.BLUNTX = typeof process !== 'undefined' && process.env && process.env.BLUNTX ? +process.env.BLUNTX : 1.8;
  Engine.SWEEPMAX = 24; // most slices per substep for swept collision
  Engine.KODAMP = typeof process !== 'undefined' && process.env && process.env.KODAMP ? +process.env.KODAMP : 0.6;
  // solver passes kept as small functions so the JS engine optimizes them once and keeps them optimized
  // (inside the per-frame step generator they were recompiled again and again, and contact frames ran them slowly)
  Engine.prototype._bondPass = function (q0, q1, stiff) {
    const x = this.x, w = this.w, bx = this.bx, bi = this.bi, bj = this.bj, br = this.br, bk = this.bk;
    for (let q = q0; q < q1; q++) {
      if (bx[q]) continue;
      const i = bi[q], j = bj[q], i3 = 3 * i, j3 = 3 * j;
      const dx = x[j3] - x[i3], dy = x[j3 + 1] - x[i3 + 1], dz = x[j3 + 2] - x[i3 + 2];
      const L = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const rest = br[q];
      const C = L - rest;
      const wi = w[i], wj = w[j], ws = wi + wj;
      if (ws === 0 || L < 1e-9) continue;
      const sc = stiff * bk[q] * C / (L * ws);
      x[i3] += wi * sc * dx; x[i3 + 1] += wi * sc * dy; x[i3 + 2] += wi * sc * dz;
      x[j3] -= wj * sc * dx; x[j3 + 1] -= wj * sc * dy; x[j3 + 2] -= wj * sc * dz;
    }
  };
  // velocities from the substep's motion; returns the body's top speed
  Engine.prototype._velPass = function (i0, i1, kinematic, ih, dvMax, dvMax2) {
    const x = this.x, xp = this.xp, v = this.v, w = this.w, ct = this.ct, cvn = this.cvn;
    let ms = 0;
    for (let i = i0; i < i1; i++) {
      const i3 = 3 * i;
      if (w[i] === 0 && !kinematic) { v[i3] = v[i3 + 1] = v[i3 + 2] = 0; continue; }
      let vx = (x[i3] - xp[i3]) * ih, vy = (x[i3 + 1] - xp[i3 + 1]) * ih, vz = (x[i3 + 2] - xp[i3 + 2]) * ih;
      if (ct[i] < 2 && !kinematic) {
        // constraint fights must not launch particles: cap the velocity change a substep can add
        const dvx = vx - v[i3], dvy = vy - v[i3 + 1], dvz = vz - v[i3 + 2];
        const d2 = dvx * dvx + dvy * dvy + dvz * dvz;
        if (d2 > dvMax2) { const f = Math.sqrt(dvMax2 / d2); vx = v[i3] + dvx * f; vy = v[i3 + 1] + dvy * f; vz = v[i3 + 2] + dvz * f; }
      } else if (cvn && cvn[i] > 0 && !kinematic) {
        // hit by another body: the hit may change the speed by up to the closing speed (a thrown stone still
        // sends flesh flying), but not by the size of the overlap push, which at many substeps read as 15+ m/s
        const dvx = vx - v[i3], dvy = vy - v[i3 + 1], dvz = vz - v[i3 + 2];
        const d2 = dvx * dvx + dvy * dvy + dvz * dvz, lim = Math.max(dvMax, 1.2 * cvn[i]);
        if (d2 > lim * lim) { const f = lim / Math.sqrt(d2); vx = v[i3] + dvx * f; vy = v[i3 + 1] + dvy * f; vz = v[i3 + 2] + dvz * f; }
        // and never ends up faster than it was or than the hit came in (repeated pushes over several substeps added up)
        const s0 = Math.hypot(v[i3], v[i3 + 1], v[i3 + 2]), sMax = Math.max(s0, 1.2 * cvn[i]), s1 = Math.hypot(vx, vy, vz);
        if (s1 > sMax) { const f = sMax / s1; vx *= f; vy *= f; vz *= f; }
        cvn[i] = 0;
      }
      const s2 = vx * vx + vy * vy + vz * vz;
      if (s2 > MAXV * MAXV) { const f = MAXV / Math.sqrt(s2); vx *= f; vy *= f; vz *= f; }
      else if (s2 > ms) ms = s2;
      v[i3] = vx; v[i3 + 1] = vy; v[i3 + 2] = vz;
    }
    return Math.sqrt(ms);
  };
  // internal damping along intact bonds
  Engine.prototype._dampPass = function (q0, q1, kd) {
    const x = this.x, v = this.v, w = this.w, bx = this.bx, bi = this.bi, bj = this.bj;
    for (let q = q0; q < q1; q++) {
      if (bx[q]) continue;
      const i = bi[q], j = bj[q], i3 = 3 * i, j3 = 3 * j;
      const wi = w[i], wj = w[j], ws = wi + wj; if (ws === 0) continue;
      const dx = x[j3] - x[i3], dy = x[j3 + 1] - x[i3 + 1], dz = x[j3 + 2] - x[i3 + 2];
      const il = 1 / (Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-9), nx = dx * il, ny = dy * il, nz = dz * il;
      const dv = ((v[j3] - v[i3]) * nx + (v[j3 + 1] - v[i3 + 1]) * ny + (v[j3 + 2] - v[i3 + 2]) * nz) * kd / ws;
      v[i3] += wi * dv * nx; v[i3 + 1] += wi * dv * ny; v[i3 + 2] += wi * dv * nz;
      v[j3] -= wj * dv * nx; v[j3 + 1] -= wj * dv * ny; v[j3 + 2] -= wj * dv * nz;
    }
  };

  Engine.prototype._shapeMatch = function (cls, ksm, perParticle, kfol, ctw, damp) {
    if (ctw == null) ctw = 12;
    const xp = this.xp, dmp = damp || 0;
    let resMax = 0;
    const x = this.x, r = this.r, w = this.w, smw = this.smw, ct = this.ct, anc = this.anc, w0 = this.w0, press = this.press, crush = this._crush || 0, crushY2 = this._crushY2 || 1e9;
    for (let c = 0; c < cls.length; c++) {
      const C = cls[c], m = C.m, n = m.length;
      // mass-weighted fit; anchored and touching particles weigh more so support and impacts carry through the cluster
      let cx = 0, cy = 0, cz = 0, rcx = 0, rcy = 0, rcz = 0, ws = 0;
      const F = C.f, nf = F ? F.length : 0, fw = 0.3;
      for (let k = 0; k < n + nf; k++) {
        const i = k < n ? m[k] : F[k - n], i3 = 3 * i;
        const wt = (anc[i] ? 400 : (ct[i] && ct[i] < 3 ? ctw : 1)) / (w0[i] || 1) * (k < n ? 1 : fw);
        cx += x[i3] * wt; cy += x[i3 + 1] * wt; cz += x[i3 + 2] * wt;
        rcx += r[i3] * wt; rcy += r[i3 + 1] * wt; rcz += r[i3 + 2] * wt; ws += wt;
      }
      cx /= ws; cy /= ws; cz /= ws; rcx /= ws; rcy /= ws; rcz /= ws;
      let a00 = 0, a01 = 0, a02 = 0, a10 = 0, a11 = 0, a12 = 0, a20 = 0, a21 = 0, a22 = 0;
      for (let k = 0; k < n + nf; k++) {
        const i = k < n ? m[k] : F[k - n], i3 = 3 * i;
        const wt = (anc[i] ? 400 : (ct[i] && ct[i] < 3 ? ctw : 1)) / (w0[i] || 1) * (k < n ? 1 : fw);
        const px = (x[i3] - cx) * wt, py = (x[i3 + 1] - cy) * wt, pz = (x[i3 + 2] - cz) * wt;
        const qx = r[i3] - rcx, qy = r[i3 + 1] - rcy, qz = r[i3 + 2] - rcz;
        a00 += px * qx; a01 += px * qy; a02 += px * qz;
        a10 += py * qx; a11 += py * qy; a12 += py * qz;
        a20 += pz * qx; a21 += pz * qy; a22 += pz * qz;
      }
      // polar decomposition via quaternion iteration (Mueller et al. 2016)
      let q = C.q;
      if (!q) q = C.q = [0, 0, 0, 1];
      const iters = C.fresh ? 24 : 4; C.fresh = false;
      for (let it = 0; it < iters; it++) {
        const R = quatToMat(q[0], q[1], q[2], q[3]);
        // columns of R: (R0,R3,R6),(R1,R4,R7),(R2,R5,R8); columns of A: (a00,a10,a20)...
        const r0x = R[0], r0y = R[3], r0z = R[6];
        const r1x = R[1], r1y = R[4], r1z = R[7];
        const r2x = R[2], r2y = R[5], r2z = R[8];
        let ox = (r0y * a20 - r0z * a10) + (r1y * a21 - r1z * a11) + (r2y * a22 - r2z * a12);
        let oy = (r0z * a00 - r0x * a20) + (r1z * a01 - r1x * a21) + (r2z * a02 - r2x * a22);
        let oz = (r0x * a10 - r0y * a00) + (r1x * a11 - r1y * a01) + (r2x * a12 - r2y * a02);
        const den = Math.abs(r0x * a00 + r0y * a10 + r0z * a20 + r1x * a01 + r1y * a11 + r1z * a21 + r2x * a02 + r2y * a12 + r2z * a22) + 1e-9;
        ox /= den; oy /= den; oz /= den;
        const ang = Math.sqrt(ox * ox + oy * oy + oz * oz);
        if (ang < 1e-9) break;
        const sa = Math.sin(ang * 0.5) / ang, ca = Math.cos(ang * 0.5);
        const ex = ox * sa, ey = oy * sa, ez = oz * sa, ew = ca;
        const nx = ew * q[0] + ex * q[3] + ey * q[2] - ez * q[1];
        const ny = ew * q[1] - ex * q[2] + ey * q[3] + ez * q[0];
        const nz = ew * q[2] + ex * q[1] - ey * q[0] + ez * q[3];
        const nw = ew * q[3] - ex * q[0] - ey * q[1] - ez * q[2];
        const l = 1 / Math.sqrt(nx * nx + ny * ny + nz * nz + nw * nw);
        q[0] = nx * l; q[1] = ny * l; q[2] = nz * l; q[3] = nw * l;
      }
      const R = quatToMat(q[0], q[1], q[2], q[3]);
      let res_ = 0;
      for (let k = 0; k < n; k++) {
        const i = m[k]; if (w[i] === 0) continue;
        const i3 = 3 * i;
        const qx = r[i3] - rcx, qy = r[i3 + 1] - rcy, qz = r[i3 + 2] - rcz;
        const gx = R[0] * qx + R[1] * qy + R[2] * qz + cx;
        const gy = R[3] * qx + R[4] * qy + R[5] * qz + cy;
        const gz = R[6] * qx + R[7] * qy + R[8] * qz + cz;
        const kk = perParticle ? Math.min(1, ksm * smw[i]) : ksm;
        // crushed flesh keeps its dent: where molecules are squeezed hard, the rest shape yields toward where they are
        if (crush > 0 && press[i] > 0.1) {
          const a = Math.min(0.3, (press[i] - 0.1) * 3) * crush;
          const dx = x[i3] - cx, dy = x[i3 + 1] - cy, dz = x[i3 + 2] - cz;
          r[i3] += (R[0] * dx + R[3] * dy + R[6] * dz + rcx - r[i3]) * a;
          r[i3 + 1] += (R[1] * dx + R[4] * dy + R[7] * dz + rcy - r[i3 + 1]) * a;
          r[i3 + 2] += (R[2] * dx + R[5] * dy + R[8] * dz + rcz - r[i3 + 2]) * a;
        }
        const ex_ = gx - x[i3], ey_ = gy - x[i3 + 1], ez_ = gz - x[i3 + 2]; res_ += ex_ * ex_ + ey_ * ey_ + ez_ * ez_;
        const cx_ = (gx - x[i3]) * kk, cy_ = (gy - x[i3 + 1]) * kk, cz_ = (gz - x[i3 + 2]) * kk;
        x[i3] += cx_; x[i3 + 1] += cy_; x[i3 + 2] += cz_;
        // inelastic share: that part of the correction moves the molecule without giving it speed, so a squashed limb
        // eases back into shape instead of bouncing
        if (dmp > 0) { xp[i3] += cx_ * dmp; xp[i3 + 1] += cy_ * dmp; xp[i3 + 2] += cz_ * dmp; }
      }
      if (n > 200 && res_ / n > resMax) resMax = res_ / n;
      const f = C.f;
      if (f && kfol > 0) for (let k = 0; k < f.length; k++) {
        const i = f[k]; if (w[i] === 0) continue;
        const i3 = 3 * i;
        const qx = r[i3] - rcx, qy = r[i3 + 1] - rcy, qz = r[i3 + 2] - rcz;
        const gx = R[0] * qx + R[1] * qy + R[2] * qz + cx;
        const gy = R[3] * qx + R[4] * qy + R[5] * qz + cy;
        const gz = R[6] * qx + R[7] * qy + R[8] * qz + cz;
        const kk = kfol * smw[i];
        x[i3] += (gx - x[i3]) * kk; x[i3 + 1] += (gy - x[i3 + 1]) * kk; x[i3 + 2] += (gz - x[i3 + 2]) * kk;
      }
    }
    this._smRes = resMax;
  };

  // loose rigid balls (cannonballs): gravity, two-way contact with molecules (mass weighted, so a light ball is stopped
  // by a body and a heavy one ploughs through), the floor with bounce and rolling, and each other
  Engine.prototype._balls = function (h, ih, gx, gy, gz, floorOn, floorY, floorMu, cA, ctype, cdim, nc, cols) {
    const x = this.x, xp = this.xp, w = this.w, rad = this.rad, ct = this.ct, nbb = this.nbb, nb0 = this.nb0, shm = this.shm, balls = this.balls, nB = balls.length;
    for (const B of balls) {
      B.xp[0] = B.x[0]; B.xp[1] = B.x[1]; B.xp[2] = B.x[2];
      const gk = B.gk != null ? B.gk : 1; B.v[0] += gx * h * gk; B.v[1] += gy * h * gk; B.v[2] += gz * h * gk;
      const dmp = Math.max(0, 1 - 0.02 * h); B.v[0] *= dmp; B.v[1] *= dmp; B.v[2] *= dmp;
      B.vyPre = B.v[1];
      B.x[0] += B.v[0] * h; B.x[1] += B.v[1] * h; B.x[2] += B.v[2] * h;
      B.floor = false;
    }
    for (const B of balls) {
      let ax = 0, ay = 0, az = 0, fvx = 0, fvy = 0, fvz = 0, fn = 0, mpen = 0;
      const bvx = B.x[0] - B.xp[0], bvy = B.x[1] - B.xp[1], bvz = B.x[2] - B.xp[2];
      for (const b of this.bodies) {
        if (b.asleep || !sphereAabb(B.x[0], B.x[1], B.x[2], B.r + 0.05, b.aabb)) continue;
        const shatterV = b.shatter * B.shat;
        // the flesh around an impact moves together: attached molecules push back with the mass of the
        // dent zone (about two ball radii of tissue), shared among the molecules touching the ball
        let nc = 0;
        for (let i = b.start, e = b.start + b.count; i < e; i++) {
          const i3 = 3 * i, dx = x[i3] - B.x[0], dy = x[i3 + 1] - B.x[1], dz = x[i3 + 2] - B.x[2], R = B.r + rad[i];
          if (dx * dx + dy * dy + dz * dz < R * R && nbb[i] < nb0[i]) nc++;
        }
        const zone = 1000 * 2.1 * Math.pow(2 * B.r, 3) * Engine.BALLZONE, mpA = Math.max(b.pmass, nc ? zone / nc : 0);
        let touched = false;
        for (let i = b.start, e = b.start + b.count; i < e; i++) {
          const i3 = 3 * i, dx = x[i3] - B.x[0], dy = x[i3 + 1] - B.x[1], dz = x[i3 + 2] - B.x[2], ri = rad[i], R = B.r + ri;
          const d2 = dx * dx + dy * dy + dz * dz; if (d2 >= R * R) continue;
          const d = Math.sqrt(d2) || 1e-6, nx = dx / d, ny = dy / d, nz = dz / d, pen = R - d;
          const iv = ((bvx - (x[i3] - xp[i3])) * nx + (bvy - (x[i3 + 1] - xp[i3 + 1])) * ny + (bvz - (x[i3 + 2] - xp[i3 + 2])) * nz) * ih;
          if (pen > mpen) mpen = pen;
          if (w[i] === 0) { ax -= nx * pen; ay -= ny * pen; az -= nz * pen; continue; }
          const mp = nbb[i] < nb0[i] ? mpA : b.pmass, kp = B.m / (mp + B.m), kb = mp / (mp + B.m);
          fvx += (x[i3] - xp[i3]) * ih; fvy += (x[i3 + 1] - xp[i3 + 1]) * ih; fvz += (x[i3 + 2] - xp[i3 + 2]) * ih; fn++;
          x[i3] += nx * pen * kp; x[i3 + 1] += ny * pen * kp; x[i3 + 2] += nz * pen * kp;
          ax -= nx * pen * kb; ay -= ny * pen * kb; az -= nz * pen * kb;
          ct[i] = 3; touched = true;
          if (iv > b.koSpeed) b.koHit = true;
          if (iv > shatterV * shm[i] && nbb[i] < nb0[i]) this._breakParticle(i);
        }
        if (touched) b.touchT = this.frame;
      }
      // the contacts' pushes are summed, so a ball buried in flesh (a body landing on it) got shoved many times its
      // deepest overlap in one substep and shot out through the body at 20+ m/s; never move it further than that
      const al = Math.hypot(ax, ay, az); if (al > mpen && al > 0) { const k = mpen / al; ax *= k; ay *= k; az *= k; }
      B.x[0] += ax; B.x[1] += ay; B.x[2] += az;
      B.hit = [ax, ay, az]; B.fv = fn ? [fvx / fn, fvy / fn, fvz / fn] : null;
    }
    const pairs = [];
    for (let a = 0; a < nB; a++) for (let c = a + 1; c < nB; c++) {
      const A = balls[a], C = balls[c], dx = C.x[0] - A.x[0], dy = C.x[1] - A.x[1], dz = C.x[2] - A.x[2], R = A.r + C.r, d2 = dx * dx + dy * dy + dz * dz;
      if (d2 >= R * R) continue;
      const d = Math.sqrt(d2) || 1e-6, pen = R - d, ka = C.m / (A.m + C.m), kc = 1 - ka, nx = dx / d, ny = dy / d, nz = dz / d;
      // separate without injecting speed (xp moves too); the bounce itself is a proper impulse below
      for (let q = 0; q < 3; q++) { const n = q === 0 ? nx : q === 1 ? ny : nz; A.x[q] -= n * pen * ka; A.xp[q] -= n * pen * ka; C.x[q] += n * pen * kc; C.xp[q] += n * pen * kc; }
      pairs.push(A, C, nx, ny, nz);
    }
    // solid props, walls and weapons: balls are pushed out of them and bounce off (emitter objects hit scenery too)
    for (const B of balls) {
      B.cn = null;
      for (let c = 0; c < (nc || 0); c++) {
        const o = c * 32, C = cols[c];
        const px = B.x[0] - cA[o + 21], py = B.x[1] - cA[o + 22], pz = B.x[2] - cA[o + 23];
        const RB = (C.bound || 1) + B.r + 0.05; if (px * px + py * py + pz * pz > RB * RB) continue;
        const qx = cA[o + 9] * px + cA[o + 12] * py + cA[o + 15] * pz;
        const qy = cA[o + 10] * px + cA[o + 13] * py + cA[o + 16] * pz;
        const qz = cA[o + 11] * px + cA[o + 14] * py + cA[o + 17] * pz;
        sdShape(ctype[c], qx, qy, qz, cdim[3 * c], cdim[3 * c + 1], cdim[3 * c + 2], _o2);
        const pen = B.r - _o2[0]; if (pen <= 0) continue;
        const nx = cA[o + 9] * _o2[1] + cA[o + 10] * _o2[2] + cA[o + 11] * _o2[3];
        const ny = cA[o + 12] * _o2[1] + cA[o + 13] * _o2[2] + cA[o + 14] * _o2[3];
        const nz = cA[o + 15] * _o2[1] + cA[o + 16] * _o2[2] + cA[o + 17] * _o2[3];
        B.x[0] += nx * pen; B.x[1] += ny * pen; B.x[2] += nz * pen;
        if (!B.cn) { const vn = (B.x[0] - B.xp[0]) * nx + (B.x[1] - B.xp[1]) * ny + (B.x[2] - B.xp[2]) * nz; B.cn = [nx, ny, nz, B.v[0] * nx + B.v[1] * ny + B.v[2] * nz, vn]; }
      }
    }
    for (const B of balls) {
      if (floorOn && B.x[1] < floorY + B.r) { B.x[1] = floorY + B.r; B.floor = true; }
      let vx = (B.x[0] - B.xp[0]) * ih, vy = (B.x[1] - B.xp[1]) * ih, vz = (B.x[2] - B.xp[2]) * ih;
      if (B.floor) {
        vy = B.vyPre < -1 ? -B.vyPre * B.rest : Math.max(0, vy);
        const k = Math.max(0, 1 - (1.2 * Math.sqrt(floorMu * B.mu) + 0.4) * h); vx *= k; vz *= k; // rolling resistance
        // roll: spin about the axis perpendicular to the motion
        const sp = Math.hypot(vx, vz);
        if (sp > 1e-4) { const ang = sp * h / B.r, ux = vz / sp, uz = -vx / sp, sa = Math.sin(ang / 2), ca = Math.cos(ang / 2);
          const q = B.q, rx = ux * sa, rz = uz * sa, rw = ca;
          const nx = rw * q[0] + rx * q[3] + 0 - rz * q[1], ny = rw * q[1] - rx * q[2] + 0 + rz * q[0], nz = rw * q[2] + rx * q[1] - 0 + rz * q[3], nw = rw * q[3] - rx * q[0] - 0 - rz * q[2];
          const l = 1 / Math.hypot(nx, ny, nz, nw); q[0] = nx * l; q[1] = ny * l; q[2] = nz * l; q[3] = nw * l; }
      }
      // flesh is soft and soaks up the hit: relative to the flesh it touches, a ball barely rebounds and
      // is gripped (no skipping off), so it moves with the body or drops away instead of being flung
      if (B.hit && B.fv) { const hx = B.hit[0], hy = B.hit[1], hz = B.hit[2], hl = Math.hypot(hx, hy, hz);
        if (hl > 1e-9) { const nx = hx / hl, ny = hy / hl, nz = hz / hl, fv = B.fv;
          let rx = vx - fv[0], ry = vy - fv[1], rz = vz - fv[2];
          let rn = rx * nx + ry * ny + rz * nz; if (rn > 0) { rx -= nx * rn * (1 - Engine.FLESHREST); ry -= ny * rn * (1 - Engine.FLESHREST); rz -= nz * rn * (1 - Engine.FLESHREST); }
          rn = rx * nx + ry * ny + rz * nz; const kf = Math.min(1, 40 * h);
          rx -= (rx - nx * rn) * kf; ry -= (ry - ny * rn) * kf; rz -= (rz - nz * rn) * kf;
          vx = fv[0] + rx; vy = fv[1] + ry; vz = fv[2] + rz;
          // pinned between flesh and the floor: the push out is a squeeze, not a kick. Without this a body landing
          // on a resting ball shot it out sideways at 6+ m/s like a pip; now it rolls out slowly or stays under
          if (B.floor && ny < -0.3) { const ux = vx - fv[0], uz = vz - fv[2], us = Math.hypot(ux, uz);
            if (us > Engine.SQUEEZEV) { const k = Engine.SQUEEZEV / us; vx = fv[0] + ux * k; vz = fv[2] + uz * k; }
            vy = Math.min(vy, Math.max(0, fv[1])); } } }
      if (B.cn) { // bounce off a prop: the speed into its surface comes back scaled by the bounciness, sliding loses a little
        const [nx, ny, nz, vin] = B.cn, vn = vx * nx + vy * ny + vz * nz;
        if (vin < -0.5) { const add = -vin * B.rest - vn; vx += nx * add; vy += ny * add; vz += nz * add; }
        const kf = Math.max(0, 1 - B.mu * 6 * h); const vn2 = vx * nx + vy * ny + vz * nz;
        vx = nx * vn2 + (vx - nx * vn2) * kf; vy = ny * vn2 + (vy - ny * vn2) * kf; vz = nz * vn2 + (vz - nz * vn2) * kf;
      }
      const sp2 = vx * vx + vy * vy + vz * vz; if (sp2 > MAXV * MAXV) { const f = MAXV / Math.sqrt(sp2); vx *= f; vy *= f; vz *= f; }
      B.v[0] = vx; B.v[1] = vy; B.v[2] = vz;
      if (B.x[1] < -40) { B.x[1] = -40; B.v[0] = B.v[1] = B.v[2] = 0; }
    }
    for (let p = 0; p < pairs.length; p += 5) {
      const A = pairs[p], C = pairs[p + 1], nx = pairs[p + 2], ny = pairs[p + 3], nz = pairs[p + 4];
      const vr = (C.v[0] - A.v[0]) * nx + (C.v[1] - A.v[1]) * ny + (C.v[2] - A.v[2]) * nz; if (vr >= 0) continue;
      const e = Math.min(A.rest, C.rest), J = -(1 + e) * vr / (1 / A.m + 1 / C.m);
      A.v[0] -= nx * J / A.m; A.v[1] -= ny * J / A.m; A.v[2] -= nz * J / A.m;
      C.v[0] += nx * J / C.m; C.v[1] += ny * J / C.m; C.v[2] += nz * J / C.m;
    }
  };

  Engine.prototype._contacts = function (icell, mu, maxCorr, ihc) {
    const N = this.N, x = this.x, xp = this.xp, v = this.v, w = this.w, rad = this.rad, cand = this.cand, dead = this.dead;
    const nbb = this.nbb, plc = this.plc, plk = this.plk, li = this.li, lj = this.lj, frame = this.frame;
    if (!this.cvn || this.cvn.length < N) this.cvn = new Float32Array(N);
    const hs = this.hsize, mask = hs - 1, hc = this.hcount, he = this.hentries, hl = this.hlist;
    const bodies = this.bodies, pb = this.pb, xb = this._xb;
    hc.fill(0);
    // which bodies have molecules in each block of cells (one bit per body, bodies past 32 share bits): a whole molecule
    // with no other body in its 27 cells has nothing to collide with, so the pair search skips it (two bodies
    // touching put both whole volumes in the hash, and searching all of it was most of the frame)
    if (!this.hbm || this.hbm.length !== hs) this.hbm = new Int32Array(hs);
    const hbm = this.hbm; hbm.fill(0);
    // torn/surface molecules also get their own copy of the table: a torn molecule with no other body nearby only
    // meets torn molecules of its own body, so it searches just those
    if (!this.hcc || this.hcc.length !== hs + 1) { this.hcc = new Int32Array(hs + 1); this.hec = new Int32Array(N); }
    const hcc = this.hcc, hec = this.hec; hcc.fill(0);
    // a fine body next to a coarse one: the table's cells are sized for the coarse molecules, so a fine body's torn
    // molecules would each test dozens of their own neighbours; they get a table with cells sized for them instead
    let fineR = Infinity;
    for (const b of bodies) { if (b.asleep) continue; if (b._maxRad == null) { let m = 0; for (let i = b.start, e = b.start + b.count; i < e; i++) if (rad[i] > m) m = rad[i]; b._maxRad = m; } fineR = Math.min(fineR, b._maxRad); }
    const fcell = 2 * fineR, useFine = fcell * icell < 0.8, ifc = 1 / fcell;
    if (useFine && (!this.hcf || this.hcf.length !== hs + 1)) { this.hcf = new Int32Array(hs + 1); this.hef = new Int32Array(N); }
    const hcf = this.hcf, hef = this.hef, fineB = this._fineB || (this._fineB = []);
    for (let k = 0; k < bodies.length; k++) fineB[k] = useFine && 2 * bodies[k]._maxRad * 0.92 <= fcell * 1.0000001 ? 1 : 0;
    if (useFine) hcf.fill(0);
    // whole flesh of a body touching another only matters close to that other body: a molecule further than a few
    // cells outside every other touching body's box can't meet it, so it stays out of the table
    const nbd = bodies.length, xbl = this._xbl || (this._xbl = []); xbl.length = 0;
    if (xb && nbd <= 12) {
      const bx = this._cbox && this._cbox.length >= 6 * nbd ? this._cbox : (this._cbox = new Float64Array(6 * nbd));
      for (let k = 0; k < nbd; k++) {
        const b = bodies[k]; if (!xb[k] || b.asleep) continue;
        let x0 = 1e9, y0 = 1e9, z0 = 1e9, x1 = -1e9, y1 = -1e9, z1 = -1e9;
        for (let i = b.start, e = b.start + b.count; i < e; i++) {
          if (dead[i]) continue;
          const i3 = 3 * i, px = x[i3], py = x[i3 + 1], pz = x[i3 + 2];
          if (px < x0) x0 = px; if (px > x1) x1 = px; if (py < y0) y0 = py; if (py > y1) y1 = py; if (pz < z0) z0 = pz; if (pz > z1) z1 = pz;
        }
        const g = 3 / icell;
        bx[6 * k] = x0 - g; bx[6 * k + 1] = y0 - g; bx[6 * k + 2] = z0 - g; bx[6 * k + 3] = x1 + g; bx[6 * k + 4] = y1 + g; bx[6 * k + 5] = z1 + g;
        xbl.push(k);
      }
    }
    const cbox = this._cbox, filt = xbl.length > 0;
    let n = 0, lgx = 1e9, lgy = 0, lgz = 0, lpb = -1;
    for (let i = 0; i < N; i++) {
      const pi = pb[i];
      if ((!cand[i] && !(xb && xb[pi])) || dead[i] || bodies[pi].asleep) continue;
      const i3 = 3 * i;
      if (filt && !cand[i] && !bodies[pi].selfCol) {
        const px = x[i3], py = x[i3 + 1], pz = x[i3 + 2]; let near = false;
        for (let q = 0; q < xbl.length; q++) {
          const k = xbl[q]; if (k === pi) continue; const o = 6 * k;
          if (px >= cbox[o] && px <= cbox[o + 3] && py >= cbox[o + 1] && py <= cbox[o + 4] && pz >= cbox[o + 2] && pz <= cbox[o + 5]) { near = true; break; }
        }
        if (!near) continue;
      }
      const cx = Math.floor(x[i3] * icell), cy = Math.floor(x[i3 + 1] * icell), cz = Math.floor(x[i3 + 2] * icell);
      const hk = (Math.imul(cx, 92837111) ^ Math.imul(cy, 689287499) ^ Math.imul(cz, 283923481)) & mask;
      hc[hk]++; hl[n++] = i;
      if (cand[i]) { if (fineB[pb[i]]) hcf[(Math.imul(Math.floor(x[i3] * ifc), 92837111) ^ Math.imul(Math.floor(x[i3 + 1] * ifc), 689287499) ^ Math.imul(Math.floor(x[i3 + 2] * ifc), 283923481)) & mask]++; else hcc[hk]++; }
      const gx = Math.floor(cx / 3), gy = Math.floor(cy / 3), gz = Math.floor(cz / 3);
      if (gx !== lgx || gy !== lgy || gz !== lgz || pi !== lpb) { hbm[(Math.imul(gx, 92837111) ^ Math.imul(gy, 689287499) ^ Math.imul(gz, 283923481)) & mask] |= 1 << (pi & 31); lgx = gx; lgy = gy; lgz = gz; lpb = pi; }
    }
    if (n < 2) return;
    let acc = 0, acc2 = 0; for (let k = 0; k < hs; k++) { acc += hc[k]; hc[k] = acc; acc2 += hcc[k]; hcc[k] = acc2; } hc[hs] = acc; hcc[hs] = acc2;
    if (useFine) { let a3 = 0; for (let k = 0; k < hs; k++) { a3 += hcf[k]; hcf[k] = a3; } hcf[hs] = a3; }
    for (let t = 0; t < n; t++) {
      const i = hl[t], i3 = 3 * i;
      const cx = Math.floor(x[i3] * icell), cy = Math.floor(x[i3 + 1] * icell), cz = Math.floor(x[i3 + 2] * icell);
      const hk = (Math.imul(cx, 92837111) ^ Math.imul(cy, 689287499) ^ Math.imul(cz, 283923481)) & mask;
      he[--hc[hk]] = i;
      if (cand[i]) { if (fineB[pb[i]]) hef[--hcf[(Math.imul(Math.floor(x[i3] * ifc), 92837111) ^ Math.imul(Math.floor(x[i3 + 1] * ifc), 689287499) ^ Math.imul(Math.floor(x[i3 + 2] * ifc), 283923481)) & mask]] = i; else hec[--hcc[hk]] = i; }
    }
    // every bucket lists its molecules from the highest index down (and bodies own consecutive index ranges), so a
    // search stops at the first j <= i, and the part of a bucket holding the molecule's own body can be skipped or
    // read from the torn-molecule table instead
    const cv0 = this.candVer || 0;
    // neighbouring molecules mostly share the same blocks: remember the last block lookup
    let mgx = 1e9, mgy = 0, mgz = 0, mlast = 0;
    for (let t = 0; t < n; t++) {
      const i = hl[t], i3 = 3 * i;
      const pbi = pb[i], candI = cand[i], selfI = bodies[pbi].selfCol, eP = bodies[pbi].start + bodies[pbi].count;
      const ri = rad[i];
      const cx = Math.floor(x[i3] * icell), cy = Math.floor(x[i3 + 1] * icell), cz = Math.floor(x[i3 + 2] * icell);
      let near = true;
      if (!selfI) {
        // whole flesh only meets other bodies: skip it unless another body is in a block next to it
        // (checked on blocks of 3x3x3 cells: a per-cell mask in a table this size would be all hash collisions)
        const own = 1 << (pbi & 31);
        // (a molecule in the same cell as the last one checked sees the same blocks)
        if (cx !== mgx || cy !== mgy || cz !== mgz) {
          let m = 0;
          const gx0 = Math.floor((cx - 1) / 3), gx1 = Math.floor((cx + 1) / 3), gy0 = Math.floor((cy - 1) / 3), gy1 = Math.floor((cy + 1) / 3), gz0 = Math.floor((cz - 1) / 3), gz1 = Math.floor((cz + 1) / 3);
          for (let gx = gx0; gx <= gx1; gx++) for (let gy = gy0; gy <= gy1; gy++) for (let gz = gz0; gz <= gz1; gz++)
            m |= hbm[(Math.imul(gx, 92837111) ^ Math.imul(gy, 689287499) ^ Math.imul(gz, 283923481)) & mask];
          mgx = cx; mgy = cy; mgz = cz; mlast = m;
        }
        near = (mlast & ~own) !== 0;
        if (!near && !candI) continue;
      }
      const fresh = (this.candVer || 0) === cv0, fineOwn = fineB[pbi] && fresh;
      for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) for (let oz = -1; oz <= 1; oz++) {
        const hk = (Math.imul(cx + ox, 92837111) ^ Math.imul(cy + oy, 689287499) ^ Math.imul(cz + oz, 283923481)) & mask;
        let e = hc[hk];
        const ee = hc[hk + 1];
        if (near) {
          // molecules of bodies after this one in the table
          for (; e < ee; e++) {
            const j = he[e]; if (j < eP) break;
            const j3 = 3 * j, dx = x[j3] - x[i3], dy = x[j3 + 1] - x[i3 + 1], dz = x[j3 + 2] - x[i3 + 2], d2 = dx * dx + dy * dy + dz * dz, md = (ri + rad[j]) * 0.92;
            if (d2 < md * md && d2 >= 1e-14) this._pairHit(i, j, dx, dy, dz, d2, md, mu, maxCorr, ihc);
          }
        }
        // its own body: everything while it is being pressed, otherwise torn molecules only
        if (selfI || !fresh) {
          for (; e < ee; e++) {
            const j = he[e]; if (j >= eP) continue; if (j <= i) break;
            if (!selfI && !(cand[i] && cand[j])) continue;
            const j3 = 3 * j, dx = x[j3] - x[i3], dy = x[j3 + 1] - x[i3 + 1], dz = x[j3 + 2] - x[i3 + 2], d2 = dx * dx + dy * dy + dz * dz, md = (ri + rad[j]) * 0.92;
            if (d2 < md * md && d2 >= 1e-14) this._pairHit(i, j, dx, dy, dz, d2, md, mu, maxCorr, ihc);
          }
        } else if (cand[i] && !fineOwn) {
          for (let f = hcc[hk], fe = hcc[hk + 1]; f < fe; f++) {
            const j = hec[f]; if (j >= eP) continue; if (j <= i) break;
            const j3 = 3 * j, dx = x[j3] - x[i3], dy = x[j3 + 1] - x[i3 + 1], dz = x[j3 + 2] - x[i3 + 2], d2 = dx * dx + dy * dy + dz * dz, md = (ri + rad[j]) * 0.92;
            if (d2 < md * md && d2 >= 1e-14) this._pairHit(i, j, dx, dy, dz, d2, md, mu, maxCorr, ihc);
          }
        }
      }
      // a fine body's own torn molecules sit in their own finer table
      if (!selfI && fineOwn && cand[i]) {
        const fx = Math.floor(x[i3] * ifc), fy = Math.floor(x[i3 + 1] * ifc), fz = Math.floor(x[i3 + 2] * ifc);
        for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) for (let oz = -1; oz <= 1; oz++) {
          const hk = (Math.imul(fx + ox, 92837111) ^ Math.imul(fy + oy, 689287499) ^ Math.imul(fz + oz, 283923481)) & mask;
          for (let f = hcf[hk], fe = hcf[hk + 1]; f < fe; f++) {
            const j = hef[f]; if (j >= eP) continue; if (j <= i) break;
            const j3 = 3 * j, dx = x[j3] - x[i3], dy = x[j3 + 1] - x[i3 + 1], dz = x[j3 + 2] - x[i3 + 2], d2 = dx * dx + dy * dy + dz * dz, md = (ri + rad[j]) * 0.92;
            if (d2 < md * md && d2 >= 1e-14) this._pairHit(i, j, dx, dy, dz, d2, md, mu, maxCorr, ihc);
          }
        }
      }
    }
  };

  // two molecules found overlapping: push them apart (with friction), stick torn ones, and register body-on-body hits
  Engine.prototype._pairHit = function (i, j, dx, dy, dz, d2, md, mu, maxCorr, ihc) {
    const x = this.x, xp = this.xp, v = this.v, w = this.w, cand = this.cand, nbb = this.nbb, plc = this.plc, bodies = this.bodies, pb = this.pb, frame = this.frame;
    const i3 = 3 * i, j3 = 3 * j, wi = w[i];
    const other = pb[i] !== pb[j];
    if (!other && !(cand[i] && cand[j]) && !bodies[pb[i]].selfCol) return; // inside one body only torn molecules collide (unless it is being pressed)
    const wj = w[j], ws = wi + wj;
    if (ws === 0) return;
    const d = Math.sqrt(d2), pen = Math.min(md - d, other ? Math.max(maxCorr, 0.45 * md) : maxCorr);
    const nx = dx / d, ny = dy / d, nz = dz / d;
    // sticky goo: torn molecules that bump into each other (or into a body) cling together
    // (two different bodies never glue together, only loose beads (no bonds left) cling across bodies)
    if ((nbb[i] > 0 || nbb[j] > 0) && plc[i] < 3 && plc[j] < 3 && this.lcount < this.LMAX && (pb[i] === pb[j] || nbb[i] === 0 || nbb[j] === 0)) {
      // (torn flesh to torn flesh holds; a loose drop only rarely sticks to whole skin, so blood runs off and drips
      // instead of coating the head)
      // two faces of a clean cut (both molecules still mostly whole) barely glue back together, or a severed piece
      // never comes off; shredded flesh still clumps
      const nb0 = this.nb0, cutFace = !other && nbb[i] * 2 < nb0[i] && nbb[j] * 2 < nb0[j];
      const g = Math.min(bodies[pb[i]].goo || 0, bodies[pb[j]].goo || 0) * ((nbb[i] > 0 && nbb[j] > 0) ? (cutFace ? 0.03 : 0.5) : 0.025) * this._gooK;
      if (g > 0 && hash32(i * 73856093 ^ j * 19349663 ^ frame) < g) this._gooLink(i, j);
    }
    if (other && ihc) {
      // one body slamming into another: a hard enough hit knocks it out and shatters already torn flesh, as a weapon would
      // closing speed from the molecules' velocities at the start of the substep: the distance moved this substep
      // also holds the bond and contact corrections, which at many substeps read as tens of m/s and shattered
      // flesh on first touch (a punch landing on a face)
      const vn = (v[i3] - v[j3]) * nx + (v[i3 + 1] - v[j3 + 1]) * ny + (v[i3 + 2] - v[j3 + 2]) * nz;
      if (vn > 0.5) {
        const bI = bodies[pb[i]], bJ = bodies[pb[j]];
        bI.touchT = frame; bJ.touchT = frame;
        // a hard hit is not softened by the speed-change limit (that turned a thrown stone into a rubber ball)
        if (vn > 2) { this.ct[i] = 3; this.ct[j] = 3; const cv = this.cvn; if (vn > cv[i]) cv[i] = vn; if (vn > cv[j]) cv[j] = vn; }
        if (vn > bI.koSpeed) bI.koHit = true;
        if (vn > bJ.koSpeed) bJ.koHit = true;
        // a superhuman landing a blow (a headbutt, a punch, a knee): whatever it strikes at speed is torn apart
        const rI = bI.params.rend && !bJ.params.rend, rJ = bJ.params.rend && !bI.params.rend;
        if ((rI || rJ) && vn > Engine.RENDV) {
          const t = rI ? j : i, bt = rI ? bJ : bI;
          bt.koHit = true;
          if (nbb[t] < this.nb0[t] || vn > Engine.RENDV * 1.6) this._breakParticle(t);
          this.ct[t] = 3; const cv = this.cvn; if (vn > cv[t]) cv[t] = vn;
        }
        // already torn flesh shatters at weapon speeds; intact flesh only at extreme ones (a bullet, a fast stone)
        const tI = bI.shatter * this.shm[i] * (nbb[i] > 0 ? 1 : Engine.BLUNTX), tJ = bJ.shatter * this.shm[j] * (nbb[j] > 0 ? 1 : Engine.BLUNTX);
        if (vn > tI && nbb[i] < this.nb0[i]) { this._breakParticle(i); }
        if (vn > tJ && nbb[j] < this.nb0[j]) { this._breakParticle(j); }
      }
    }
    const si = pen * wi / ws, sj = pen * wj / ws;
    x[i3] -= nx * si; x[i3 + 1] -= ny * si; x[i3 + 2] -= nz * si;
    x[j3] += nx * sj; x[j3 + 1] += ny * sj; x[j3 + 2] += nz * sj;
    if (mu > 0) {
      const rx = (x[i3] - xp[i3]) - (x[j3] - xp[j3]), ry = (x[i3 + 1] - xp[i3 + 1]) - (x[j3 + 1] - xp[j3 + 1]), rz = (x[i3 + 2] - xp[i3 + 2]) - (x[j3 + 2] - xp[j3 + 2]);
      const rn = rx * nx + ry * ny + rz * nz;
      const tx = rx - rn * nx, ty = ry - rn * ny, tz = rz - rn * nz;
      // wet cut faces of one body slide over each other (a severed half slips off instead of balancing)
      const f = mu * (other ? 0.5 : Engine.CUTMU);
      x[i3] -= tx * f * wi / ws * 2; x[i3 + 1] -= ty * f * wi / ws * 2; x[i3 + 2] -= tz * f * wi / ws * 2;
      x[j3] += tx * f * wj / ws * 2; x[j3 + 1] += ty * f * wj / ws * 2; x[j3 + 2] += tz * f * wj / ws * 2;
    }
  };

  // make a goo link between two touching torn molecules (at most 3 per molecule, no duplicates)
  Engine.prototype._gooLink = function (i, j) {
    const plk = this.plk, plc = this.plc, li = this.li, lj = this.lj;
    if (plc[i] >= 3 || plc[j] >= 3 || this.lcount >= this.LMAX) return;
    // a loose bead may cling to another body, but never bridge two bodies (that glued people together)
    if (!this.xlk || this.xlk.length !== this.N) this.xlk = new Uint8Array(this.N);
    if (this.pb[i] !== this.pb[j]) { const bd = this.nbb[i] === 0 ? i : j; if (plc[bd] > 0) return; this.xlk[bd] = 1; }
    else if (this.xlk[i] || this.xlk[j]) return;
    for (let s2 = 0; s2 < 3; s2++) { const L = plk[3 * i + s2]; if (L >= 0 && (li[L] === j || lj[L] === j)) return; }
    const L = this.lcount++;
    li[L] = i; lj[L] = j; this.lr[L] = (this.rad[i] + this.rad[j]) * 0.9; this.l0[L] = this.lr[L]; this.ll[L] = (this.nbb[i] === 0 || this.nbb[j] === 0) ? 1.15 + 0.5 * hash32(L * 7 + this.frame) : 1.2 + 2.6 * hash32(L * 7 + this.frame); this.lx[L] = 0;
    for (let s2 = 0; s2 < 3; s2++) if (plk[3 * i + s2] < 0) { plk[3 * i + s2] = L; break; }
    for (let s2 = 0; s2 < 3; s2++) if (plk[3 * j + s2] < 0) { plk[3 * j + s2] = L; break; }
    plc[i]++; plc[j]++;
  };

  // goo links stretch plastically into strands and snap when drawn out too far
  Engine.prototype._maintainLinks = function () {
    const n = this.lcount; if (!n) return;
    const x = this.x, li = this.li, lj = this.lj, lr = this.lr, l0 = this.l0, ll = this.ll, lx = this.lx, dead = this.dead;
    let alive = 0;
    for (let q = 0; q < n; q++) {
      if (lx[q]) continue;
      const i = li[q], j = lj[q];
      if (dead[i] || dead[j]) { lx[q] = 1; continue; }
      const i3 = 3 * i, j3 = 3 * j;
      const L = Math.hypot(x[j3] - x[i3], x[j3 + 1] - x[i3 + 1], x[j3 + 2] - x[i3 + 2]);
      if (L > lr[q] * 1.12) lr[q] += (L - lr[q] * 1.12) * 0.45;
      if (lr[q] > l0[q] * (1 + ll[q]) || L > lr[q] * 1.9) { lx[q] = 1; continue; }
      alive++;
    }
    if (alive < n * 0.8 || n > this.LMAX - 1024) {
      // compact and rebuild the per-molecule link slots
      const plk = this.plk, plc = this.plc; plk.fill(-1); plc.fill(0);
      let m = 0;
      for (let q = 0; q < n; q++) {
        if (lx[q]) continue;
        const i = li[q], j = lj[q];
        if (plc[i] >= 3 || plc[j] >= 3) continue;
        li[m] = i; lj[m] = j; lr[m] = lr[q]; l0[m] = l0[q]; ll[m] = ll[q]; lx[m] = 0;
        plk[3 * i + plc[i]++] = m; plk[3 * j + plc[j]++] = m;
        m++;
      }
      this.lcount = m;
    }
  };

  Engine.prototype.blast = function (p, radius, strength, damage) {
    this._pendingBlasts = this._pendingBlasts || [];
    this._pendingBlasts.push({ type: 'impulse', p, radius, strength, damage });
  };

  if (root.ShatterGPU) root.ShatterGPU.H = { nlerpQ, quatToMat, MAXV };

  /* ---------- worker glue ---------- */
  const isWorker = typeof WorkerGlobalScope !== 'undefined' && typeof self !== 'undefined' && self instanceof WorkerGlobalScope;
  if (isWorker) {
    const eng = new Engine();
    // GPU solver (experimental): created on first request; any failure falls back to the CPU for good
    let gpu = null, gpuState = 'off', gpuErr = '', gpuInit = null;
    const wantGpu = (mode) => mode === 'gpu' || (mode === 'auto' && eng.N > 40000);
    async function getGpu() {
      if (gpu || gpuState === 'failed') return gpu;
      if (!gpuInit) gpuInit = (self.ShatterGPU ? self.ShatterGPU.create() : Promise.reject(new Error('no GPU solver'))).then(g => { gpu = g; gpuState = 'on'; return g; }, e => { gpuState = 'failed'; gpuErr = String(e && e.message || e); return null; });
      return gpuInit;
    }
    let chain = Promise.resolve();
    async function handle(m) {
      try {
        if (m.type === 'build') {
          const info = eng.build(m.data);
          self.postMessage({ type: 'built', id: m.id, info, nb0: eng.nb0.slice() });
        } else if (m.type === 'buildShape') {
          const out = self.ShatterBuilder.buildBody(m.desc);
          const tr = [];
          for (const k in out) if (out[k] && out[k].buffer instanceof ArrayBuffer) tr.push(out[k].buffer);
          for (const k in out.skin) if (out.skin[k] && out.skin[k].buffer instanceof ArrayBuffer) tr.push(out.skin[k].buffer);
          self.postMessage({ type: 'shape', id: m.id, out }, tr);
        } else if (m.type === 'append') {
          if (gpu && gpu.resident) await gpu.download(eng);
          const info = eng.append(m.bodies);
          self.postMessage({ type: 'appended', id: m.id, info });
        } else if (m.type === 'step') {
          let stats;
          const g = wantGpu(m.input.physics) ? await getGpu() : null;
          if (g && !g.lost) {
            try { stats = await eng.stepAsync(m.input, g); }
            catch (e) { gpuState = 'failed'; gpuErr = String(e && e.message || e); gpu = null; throw e; }
          } else {
            if (gpu && gpu.resident) await gpu.download(eng);
            stats = eng.step(m.input);
          }
          stats.physics = { mode: m.input.physics || 'cpu', gpu: gpuState, on: !!stats.gpu, err: gpuErr, adapter: gpu ? gpu.info : '' };
          const pos = (m.pos && m.pos.length === eng.x.length) ? m.pos : new Float32Array(eng.x.length);
          pos.set(eng.outX || eng.x);
          const st = (m.st && m.st.length === eng.state.length) ? m.st : new Uint8Array(eng.state.length);
          st.set(eng.state);
          self.postMessage({ type: 'stepped', id: m.id, stats, pos, st }, [pos.buffer, st.buffer]);
        }
      } catch (err) {
        self.postMessage({ type: 'error', id: m.id, message: String(err && err.stack || err) });
      }
    }
    self.onmessage = function (e) { const m = e.data; chain = chain.then(() => handle(m)); };
  } else {
    Engine.segDQ = segDQ; Engine.dqSkin = dqSkin;
    root.ShatterEngine = Engine;
    if (typeof module !== 'undefined' && module.exports) module.exports = Engine;
  }
})(typeof self !== 'undefined' ? self : globalThis);
