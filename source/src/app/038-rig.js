/* ===================== skeleton animation =====================
 * A humanoid can play an animation: its skeleton (the same 17 segments its molecules are grouped by) is posed
 * every frame and the molecules follow it exactly, so the body walks, waves or fights on its own feet. When something
 * hits it (or at "Physics from frame") physics takes over from the pose it is in.
 * Built-in clips are made here from joint angles. Mixamo clips are imported by the user (FBX "without skin" or with)
 * and retargeted onto the same skeleton: per segment a rotation from the MakeHuman bind pose, plus the hip path. */

// pose vector: shoulder [abduct, forward] L/R, elbow L/R, hip [forward, out] L/R, knee L/R, spine lean, head [turn, nod],
// torso twist, ankle L/R, root lift (m), root sideways sway (m), finger curl L/R (0 open hand .. 1 fist)
const PV = ['shL0', 'shL1', 'shR0', 'shR1', 'elL', 'elR', 'hipL0', 'hipL1', 'hipR0', 'hipR1', 'knL', 'knR', 'spine', 'head0', 'head1', 'twist', 'ftL', 'ftR', 'lift', 'sway', 'fsL', 'fsR'];
const PV_STAND = { shL0: 17, shL1: 4, shR0: 17, shR1: 4, elL: 12, elR: 12, hipL0: 0, hipL1: 4, hipR0: 0, hipR1: 4, knL: 2, knR: 2, spine: 0, head0: 0, head1: 0, twist: 0, ftL: 0, ftR: 0, lift: 0, sway: 0, fsL: 0.22, fsR: 0.22 };
function pv(base, o) { const v = Object.assign({}, base || PV_STAND, o || {}); return PV.map(k => v[k] || 0); }
function pvMirror(v) {
  // left and right swapped (for the second half of a stride)
  const o = {}; PV.forEach((k, i) => { o[k] = v[i]; });
  const sw = (a, b) => { const t = o[a]; o[a] = o[b]; o[b] = t; };
  sw('shL0', 'shR0'); sw('shL1', 'shR1'); sw('elL', 'elR'); sw('hipL0', 'hipR0'); sw('hipL1', 'hipR1'); sw('knL', 'knR'); sw('ftL', 'ftR'); sw('fsL', 'fsR');
  o.twist = -o.twist; o.head0 = -o.head0; o.sway = -o.sway;
  return PV.map(k => o[k]);
}
function pvToPose(v) {
  const o = {}; PV.forEach((k, i) => { o[k] = v[i]; });
  return { sh: [[o.shL0, o.shL1], [o.shR0, o.shR1]], el: [o.elL, o.elR], hip: [[o.hipL0, o.hipL1], [o.hipR0, o.hipR1]], kn: [o.knL, o.knR], spine: o.spine, head: [o.head0, o.head1], twist: o.twist, ft: [o.ftL, o.ftR], lift: o.lift, sway: o.sway, fist: [o.fsL, o.fsR] };
}
const GUARD = { shL0: 18, shL1: 30, shR0: 16, shR1: 36, elL: 108, elR: 114, hipL0: 12, hipL1: 9, hipR0: -8, hipR1: 9, knL: 16, knR: 12, spine: 6, head1: 4, twist: 8, fsL: 0.92, fsR: 0.92 };
const ANIM_CLIPS = (() => {
  const C = {};
  const walkA = pv(null, { hipL0: 24, hipL1: 3, knL: 4, hipR0: -14, hipR1: 3, knR: 14, ftR: 10, shL0: 9, shL1: -18, shR0: 9, shR1: 20, elL: 14, elR: 26, spine: 3, twist: -5 });
  const walkB = pv(null, { hipL0: 3, hipL1: 3, knL: 9, hipR0: 22, hipR1: 3, knR: 58, ftR: -8, shL0: 9, shL1: 1, shR0: 9, shR1: 1, elL: 16, elR: 18, spine: 3, lift: 0.012 });
  C.idle = { name: 'Idle (breathing)', len: 3.4, keys: [[0, pv()], [0.5, pv(null, { shL0: 16, shR0: 16, spine: 2, head0: 5, head1: 2, hipL1: 5, hipR1: 3, sway: 0.008 })]] };
  C.walk = { name: 'Walk', len: 1.1, speed: 1.35, keys: [[0, walkA], [0.25, walkB], [0.5, pvMirror(walkA)], [0.75, pvMirror(walkB)]] };
  const runA = pv(null, { fsL: 0.6, fsR: 0.6, hipL0: 44, hipL1: 2, knL: 28, hipR0: -24, hipR1: 2, knR: 45, ftR: 18, shL0: 10, shL1: -42, shR0: 10, shR1: 48, elL: 88, elR: 96, spine: 12, twist: -8 });
  const runB = pv(null, { fsL: 0.6, fsR: 0.6, hipL0: 10, hipL1: 2, knL: 22, hipR0: 38, hipR1: 2, knR: 105, shL0: 10, shL1: 2, shR0: 10, shR1: 2, elL: 90, elR: 90, spine: 12, lift: 0.07 });
  C.run = { name: 'Run', len: 0.72, speed: 3.4, keys: [[0, runA], [0.25, runB], [0.5, pvMirror(runA)], [0.75, pvMirror(runB)]] };
  const wv = { shR0: 138, shR1: 12, head0: -8, head1: -3, spine: -2, fsR: 0.05 };
  C.wave = { name: 'Wave', len: 1.4, keys: [[0, pv(null, Object.assign({}, wv, { elR: 22 }))], [0.5, pv(null, Object.assign({}, wv, { elR: 78 }))]] };
  const guard = pv(null, GUARD), guardUp = pv(GUARD, { knL: 22, knR: 18, hipL0: 16, hipR0: -4, lift: 0 });
  C.guard = { name: 'Fighting stance', len: 1.0, keys: [[0, guard], [0.5, guardUp]] };
  C.punch = { name: 'Punch', len: 1.3, keys: [[0, guard], [0.18, pv(GUARD, { twist: 14 })], [0.32, pv(GUARD, { shR0: 14, shR1: 88, elR: 4, twist: -26, spine: 10, hipR0: -14 })], [0.46, pv(GUARD, { shR0: 14, shR1: 86, elR: 8, twist: -24, spine: 10, hipR0: -14 })], [0.7, guard], [1, guard]], noLoopEnd: 0.72 };
  C.kick = { name: 'Kick', len: 1.6, keys: [[0, guard], [0.22, pv(GUARD, { hipR0: 78, hipR1: 6, knR: 105, spine: -4 })], [0.36, pv(GUARD, { hipR0: 86, hipR1: 6, knR: 6, spine: -12, ftR: 25 })], [0.5, pv(GUARD, { hipR0: 80, knR: 100, spine: -6 })], [0.75, guard], [1, guard]], noLoopEnd: 0.78 };
  const crouch = pv(null, { hipL0: 58, hipR0: 58, knL: 96, knR: 96, ftL: 30, ftR: 30, spine: 42, shL0: 12, shL1: -38, shR0: 12, shR1: -38, elL: 20, elR: 20 });
  C.jump = { name: 'Jump', len: 1.5, keys: [[0, pv()], [0.18, crouch], [0.3, pv(null, { shL0: 20, shL1: 150, shR0: 20, shR1: 150, elL: 10, elR: 10, ftL: -20, ftR: -20, lift: 0.08 })], [0.46, pv(null, { shL0: 30, shL1: 120, shR0: 30, shR1: 120, hipL0: 34, hipR0: 34, knL: 50, knR: 50, lift: 0.42 })], [0.62, pv(null, { hipL0: 20, hipR0: 20, knL: 30, knR: 30, shL0: 40, shL1: 60, shR0: 40, shR1: 60, lift: 0.06 })], [0.74, crouch], [1, pv()]], noLoopEnd: 1 };
  C.cheer = { name: 'Cheer', len: 0.9, keys: [[0, pv(null, { shL0: 160, shL1: 8, shR0: 148, shR1: 8, elL: 10, elR: 34, head1: -12, fsL: 0.95, fsR: 0.95 })], [0.5, pv(null, { shL0: 148, shL1: 8, shR0: 160, shR1: 8, elL: 34, elR: 10, head1: -12, knL: 10, knR: 10, lift: 0.07, fsL: 0.95, fsR: 0.95 })]] };
  const dA = pv(null, { twist: 16, hipL1: 12, hipR1: 2, knL: 14, knR: 4, shL0: 70, shL1: 30, shR0: 30, shR1: -20, elL: 70, elR: 40, sway: 0.05, head0: 10, spine: 4 });
  const dB = pv(null, { knL: 22, knR: 22, hipL0: 12, hipR0: 12, shL0: 40, shL1: 60, shR0: 40, shR1: 60, elL: 100, elR: 100, spine: 8, lift: -0.01 });
  C.dance = { name: 'Dance', len: 1.6, keys: [[0, dA], [0.25, dB], [0.5, pvMirror(dA)], [0.75, dB]] };
  C.cower = { name: 'Shield (cower)', len: 2, keys: [[0, pv(null, { shL0: 30, shL1: 95, shR0: 30, shR1: 95, elL: 140, elR: 140, hipL0: 18, hipL1: 6, hipR0: 6, hipR1: 6, knL: 20, knR: 12, spine: 18, head1: 22, fsL: 0.5, fsR: 0.5 })]] };
  C.tpose = { name: 'T-pose (hold)', len: 2, keys: [[0, pv(null, { shL0: 88, shL1: 0, shR0: 88, shR1: 0, elL: 0, elR: 0, knL: 0, knR: 0, fsL: 0, fsR: 0 })]] };
  return C;
})();
const ANIM_OPTS = () => {
  const o = [['none', 'None (physics only)']];
  for (const k in ANIM_CLIPS) o.push([k, ANIM_CLIPS[k].name]);
  const cl = (APP.scene && APP.scene.clips) || {};
  for (const id in cl) o.push(['clip:' + id, (ANIMLIB.items.has(id) ? 'Saved: ' : 'Imported: ') + cl[id].name]);
  for (const e of ANIMLIB.list()) if (!cl[e.id]) o.push(['clip:' + e.id, 'Saved: ' + e.clip.name]);
  return o;
};

// cyclic Catmull-Rom between keys (phase 0..1); a non-looping clip holds its last key
function clipVec(clip, t, loop) {
  const K = clip.keys, n = K.length;
  if (n === 1) return K[0][1];
  let ph = t / clip.len;
  if (loop) ph -= Math.floor(ph); else ph = Math.min(ph, clip.noLoopEnd != null ? clip.noLoopEnd : 0.9999);
  let i = n - 1; for (let k = 0; k < n; k++) if (K[k][0] <= ph) i = k;
  const j = (i + 1) % n, f0 = K[i][0], f1 = j === 0 ? 1 : K[j][0];
  const u = Math.max(0, Math.min(1, (ph - f0) / ((f1 - f0) || 1)));
  const a = K[(i - 1 + n) % n][1], b = K[i][1], c = K[j][1], d = K[(j + 1) % n][1];
  const u2 = u * u, u3 = u2 * u;
  return b.map((bv, q) => 0.5 * ((2 * bv) + (-a[q] + c[q]) * u + (2 * a[q] - 5 * bv + 4 * c[q] - d[q]) * u2 + (-a[q] + 3 * bv - 3 * c[q] + d[q]) * u3));
}

/* clip storage: rotations per segment as base64 Int16 quaternions (x32767), hip path as base64 Float32.
 * Older scenes keep plain number arrays (q / hip); both read through clipQ / clipHip. */
const _clipCache = new WeakMap();
function b64ToBytes(b) { const bin = atob(b), u = new Uint8Array(bin.length); for (let i = 0; i < u.length; i++) u[i] = bin.charCodeAt(i); return u; }
function bytesToB64(u) { let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); }
function clipQ(C) {
  if (C.q) return C.q;
  let D = _clipCache.get(C);
  if (!D) { D = { q: (C.qp || []).map(b => { if (!b) return null; const i16 = new Int16Array(b64ToBytes(b).buffer); const f = new Float32Array(i16.length); for (let k = 0; k < f.length; k++) f[k] = i16[k] / 32767; return f; }), hip: C.hp ? new Float32Array(b64ToBytes(C.hp).buffer) : new Float32Array(3 * C.n) }; _clipCache.set(C, D); }
  return D.q;
}
function clipHip(C) { if (C.hip) return C.hip; clipQ(C); return _clipCache.get(C).hip; }
function packClip(name, fps, n, q, hip) {
  const qp = q.map(a => { if (!a || !a.length) return ''; const i16 = new Int16Array(a.length); for (let k = 0; k < a.length; k++) i16[k] = Math.round(Math.max(-1, Math.min(1, a[k])) * 32767); return bytesToB64(new Uint8Array(i16.buffer)); });
  return { name, fps, n, qp, hp: bytesToB64(new Uint8Array(Float32Array.from(hip).buffer)), src: 'mixamo', v: 2 };
}

const RIG = {
  restCache: new Map(), track: new Map(), brace: new Map(),
  mh() { return BLD.mhData ? BLD.mhData() : null; },
  isAnimated(P) { return !!P.animation && P.animation !== 'none'; },
  rest(pose) {
    let R = this.restCache.get(pose);
    if (!R) { R = BLD.rigPose(BLD.poseByName(pose) || BLD.POSES.stand, this.mh()); this.restCache.set(pose, R); }
    return R;
  },
  /* The rest pose an animated body is built in: arms raised to about where the animation keeps them, so the
   * shoulders turn as little as possible (skin bends cleanly near its rest shape). Median arm elevation over the
   * timeline, between 48 and 120 degrees, in 12 degree steps so similar clips share a build. */
  restFor(o) {
    const T = this.trackOf(o), MH = this.mh();
    if (!MH) return 'arest';
    const key = T.sig; this._restKey = this._restKey || new Map();
    const hit = this._restKey.get(o.id); if (hit && hit.key === key) return hit.pose;
    const d5 = BLD.mv([1, 0, 0, 0, 1, 0, 0, 0, 1], [MH.bones[5][1][0] - MH.bones[5][0][0], MH.bones[5][1][1] - MH.bones[5][0][1], MH.bones[5][1][2] - MH.bones[5][0][2]]);
    const d8 = [MH.bones[8][1][0] - MH.bones[8][0][0], MH.bones[8][1][1] - MH.bones[8][0][1], MH.bones[8][1][2] - MH.bones[8][0][2]];
    const elev = (G, dv) => { const v = BLD.mv(G, dv), l = Math.hypot(v[0], v[1], v[2]) || 1; return Math.acos(Math.max(-1, Math.min(1, -v[1] / l))) * 180 / Math.PI; };
    const a = [], n = T.clip.length, step = Math.max(1, Math.floor(n / 60));
    for (let k = 0; k < n; k += step) {
      const c = T.clip[k]; if (!c || c === 'none') continue;
      let R; try { R = this.clipRig(c, T.tt[k], true); } catch (e) { continue; }
      if (!R || !R.G[5] || !R.G[8]) continue;
      a.push(elev(R.G[5], d5), elev(R.G[8], d8));
    }
    let pose = 'arest';
    if (a.length) {
      a.sort((x, y) => x - y);
      const med = a[Math.floor(a.length / 2)], q = Math.max(48, Math.min(120, 48 + Math.round((med - 48) / 12) * 12));
      pose = q === 48 ? 'arest' : 'arest:' + q;
    }
    this._restKey.set(o.id, { key, pose });
    return pose;
  },
  // per frame: which clip plays, since when, and what it blends from; root travel integrated over time
  trackOf(o) {
    const W = APP.scene.world.props, fps = fpsOf(), f0 = W.frameStart, f1 = W.frameEnd;
    const sig = JSON.stringify([o.props.bodyType, SIM.layout && SIM.layout.length, o.anim && o.anim.animation, o.anim && o.anim.animSpeed, o.props.animation, o.props.animSpeed, o.props.animMove, f0, f1, fps]);
    let T = this.track.get(o.id);
    if (T && T.sig === sig) return T;
    const n = f1 - f0 + 2;
    const qsp = (L0 => { const L = SIM.layout && SIM.layout.find(x => x.obj === o); const q = L && L.data.rig && L.data.rig.quad; return q ? { walk: q === 'horse' ? 1.7 : 1.1, run: q === 'horse' ? 6 : 4.5 } : null; })();
    T = { sig, f0, qdist: qsp ? new Float32Array(n) : null, clip: new Array(n), start: new Int32Array(n), prev: new Array(n), pstart: new Int32Array(n), dist: new Float32Array(n), ldist: new Float32Array(n), tt: new Float32Array(n), ptt: new Float32Array(n) };
    let cur = null, st = f0, prv = null, pst = f0, d = 0, t = 0, pt = 0;
    for (let k = 0; k < n; k++) {
      const f = f0 + k;
      const a = isAnimated(o, 'animation') ? evalChannel(o.anim.animation, f) : o.props.animation;
      const sp = Math.max(0.05, isAnimated(o, 'animSpeed') ? evalChannel(o.anim.animSpeed, f) : (o.props.animSpeed || 1));
      if (a !== cur) { prv = cur; pst = st; pt = t; cur = a; st = f; t = 0; }
      else if (k > 0) { t += sp / fps; pt += sp / fps; }
      const cl = ANIM_CLIPS[cur];
      if (k > 0 && o.props.animMove !== false) {
        const blendW = Math.min(1, (f - st) / (0.35 * fps));
        const pc = ANIM_CLIPS[prv];
        d += ((cl && cl.speed || 0) * blendW + (pc && pc.speed || 0) * (1 - blendW)) * sp / fps;
      }
      if (qsp && k > 0 && o.props.animMove !== false) T.qdist[k] = T.qdist[k - 1] + (qsp[cur] || 0) * Math.min(1, (f - st) / (0.35 * fps)) * sp / fps;
      T.clip[k] = cur; T.start[k] = st; T.prev[k] = prv; T.pstart[k] = pst; T.dist[k] = d; T.tt[k] = t; T.ptt[k] = pt;
    }
    this.track.set(o.id, T);
    return T;
  },
  // skeleton state {G[17], P1[17]} (MakeHuman units) for one clip at local time t
  clipRig(name, t, loop) {
    if (name && name.startsWith('clip:')) return this.mixRig(name.slice(5), t, loop);
    const c = ANIM_CLIPS[name] || ANIM_CLIPS.idle;
    const v = clipVec(c, t, loop), pose = pvToPose(v);
    const R = BLD.rigPose(pose, this.mh());
    R.lift = pose.lift; R.sway = pose.sway; R.ground = true;
    return R;
  },
  mixRig(id, t, loop) {
    const C = clipById(id);
    const R0 = this.rest('stand');
    if (!C) return Object.assign({}, R0, { lift: 0, sway: 0, ground: true });
    let fr = t * C.fps;
    if (loop) fr = ((fr % (C.n - 1)) + (C.n - 1)) % (C.n - 1); else fr = Math.min(fr, C.n - 1);
    const a = Math.floor(fr), b = Math.min(C.n - 1, a + 1), u = fr - a;
    const G = [], P1 = [], NS = R0.G.length, Q = clipQ(C);
    for (let s = 0; s < NS; s++) {
      const q = Q[s]; if (!q || q.length < 4 * C.n) { G[s] = s >= 17 ? null : R0.G[s]; continue; }
      let bx = q[4 * b], by = q[4 * b + 1], bz = q[4 * b + 2], bw = q[4 * b + 3];
      const ax = q[4 * a], ay = q[4 * a + 1], az = q[4 * a + 2], aw = q[4 * a + 3];
      if (ax * bx + ay * by + az * bz + aw * bw < 0) { bx = -bx; by = -by; bz = -bz; bw = -bw; }
      const x = ax + (bx - ax) * u, y = ay + (by - ay) * u, z = az + (bz - az) * u, w = aw + (bw - aw) * u, l = Math.hypot(x, y, z, w) || 1;
      G[s] = new THREE.Matrix3().setFromMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(new THREE.Quaternion(x / l, y / l, z / l, w / l))).transpose().elements.slice();
    }
    const HP = clipHip(C), hp = [0, 1, 2].map(k => HP[3 * a + k] + (HP[3 * b + k] - HP[3 * a + k]) * u);
    // forward kinematics down the segment tree with our own bone lengths; fingers the clip has no keys for follow the hand
    const P0 = R0.P0, par = BLD.FK_PARENT, order = [4, 3, 2, 1, 0, 47, 48, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16].filter(s => s < NS);
    for (let s = 17; s < Math.min(47, NS); s++) order.push(s);
    for (const s of order) {
      const p = par[s];
      if (!G[s]) G[s] = G[p];
      if (p < 0) { P1[s] = [P0[s][0] + hp[0], P0[s][1] + hp[1], P0[s][2] + hp[2]]; continue; }
      const d = BLD.mv(G[p], [P0[s][0] - P0[p][0], P0[s][1] - P0[p][1], P0[s][2] - P0[p][2]]);
      P1[s] = [P1[p][0] + d[0], P1[p][1] + d[1], P1[p][2] + d[2]];
    }
    return { G, P0, P1, lift: 0, sway: 0, ground: true, mix: id };
  },
  blendRig(A, B, w) {
    if (w <= 0) return A; if (w >= 1) return B;
    const G = [], P1 = [];
    for (let s = 0, NS = Math.min(A.G.length, B.G.length); s < NS; s++) {
      if (!A.G[s] || !B.G[s]) { G[s] = A.G[s] || B.G[s]; P1[s] = A.P1[s] || B.P1[s]; continue; }
      const qa = BLD.matQuat(A.G[s]), qb = BLD.matQuat(B.G[s]);
      const sg = qa[0] * qb[0] + qa[1] * qb[1] + qa[2] * qb[2] + qa[3] * qb[3] < 0 ? -1 : 1;
      const q = qa.map((v, k) => v * (1 - w) + qb[k] * sg * w), l = Math.hypot(...q);
      G[s] = new THREE.Matrix3().setFromMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(new THREE.Quaternion(q[0] / l, q[1] / l, q[2] / l, q[3] / l))).transpose().elements.slice();
      P1[s] = A.P1[s].map((v, k) => v + (B.P1[s][k] - v) * w);
    }
    return { G, P0: A.P0, P1, lift: A.lift * (1 - w) + B.lift * w, sway: A.sway * (1 - w) + B.sway * w, ground: A.ground || B.ground };
  },
  // a few molecules per segment, to find the lowest point of the posed body (feet on the floor)
  samples(L) {
    if (L.rigSamp) return L.rigSamp;
    const d = L.data, n = d.count, by = Array.from({ length: 17 }, () => []);
    for (let i = 0; i < n; i++) by[d.seg[i]].push(i);
    const out = [];
    for (const list of by) { if (!list.length) continue; list.sort((a, b) => d.rest[3 * a + 1] - d.rest[3 * b + 1]); const st = Math.max(1, Math.floor(list.length / 40)); for (let k = 0; k < list.length; k += st) out.push(list[k]); out.push(list[0]); }
    return (L.rigSamp = Int32Array.from(out));
  },
  // per segment rest-shape -> body frame transforms (12 floats each) for frame f, or null when not animated
  segXforms(L, f, braceW) {
    const o = L.obj, d = L.data;
    if (!d.rig) return null;
    const P = evalProps(o, f);
    if (!this.isAnimated(P)) return null;
    const T = this.trackOf(o), k = Math.max(0, Math.min(T.clip.length - 1, f - T.f0));
    if (d.rig.quad) return this.quadXforms(L, T, k, f);
    if (!this.mh()) return null;
    const loop = P.animLoop !== false, fps = fpsOf();
    let R = this.clipRig(T.clip[k], T.tt[k], loop);
    const bw = T.prev[k] && T.prev[k] !== 'none' ? 1 - Math.min(1, (f - T.start[k]) / (0.35 * fps)) : 0;
    if (bw > 0) R = this.blendRig(R, this.clipRig(T.prev[k], T.ptt[k], loop), bw);
    if (braceW > 0) R = this.blendRig(R, this.clipRig('cower', 0, true), Math.min(1, braceW));
    const Rr = this.rest(d.rig.pose), H = d.rig.H, yS = d.rig.yShift;
    const NS = Math.min(d.rig.nseg || 17, Rr.G.length), out = new Float32Array(NS * 12);
    for (let s = 0; s < NS; s++) {
      if (!Rr.G[s]) { out.set(out.subarray(12 * BLD.segBody(s), 12 * BLD.segBody(s) + 12), 12 * s); continue; }
      const Gt = R.G[s] || Rr.G[s], Gr = Rr.G[s], M = BLD.mm(Gt, BLD.tr3(Gr)), P1 = R.P1[s] || Rr.P1[s];
      const a = BLD.mv(M, [H * Rr.P1[s][0], yS + H * Rr.P1[s][1], H * Rr.P1[s][2]]);
      out.set(M, 12 * s);
      out[12 * s + 9] = H * P1[0] - a[0]; out[12 * s + 10] = yS + H * P1[1] - a[1]; out[12 * s + 11] = H * P1[2] - a[2];
    }
    // feet on the floor: the posed body's lowest point goes where the rest shape's lowest point was, then the clip's own lift
    const smp = this.samples(L), r = d.rest;
    let mn = 1e9, mnR = 1e9;
    for (let q = 0; q < smp.length; q++) {
      const i = smp[q], s = d.seg[i], O = 12 * s, x = r[3 * i], y = r[3 * i + 1], z = r[3 * i + 2];
      mn = Math.min(mn, out[O + 3] * x + out[O + 4] * y + out[O + 5] * z + out[O + 10]); mnR = Math.min(mnR, y);
    }
    let dy = mnR - mn;
    // an imported clip keeps its own up and down (jumps): only lifted where it would sink into the floor,
    // measured against how it stands at its first frame
    if (R.mix) {
      const key = R.mix + '|' + d.rig.pose;
      L.mixG = L.mixG || {};
      if (L.mixG[key] == null) { const R0 = this.mixRig(R.mix, 0, false); L.mixG[key] = this._lowest(L, R0, Rr, H, yS) ; }
      dy = Math.max(mnR - L.mixG[key], dy);
    }
    dy += (R.lift || 0) * H;
    const dz = T.dist[k], dx = (R.sway || 0) * H;
    for (let s = 0; s < NS; s++) { out[12 * s + 9] += dx; out[12 * s + 10] += dy; out[12 * s + 11] += dz; }
    return out;
  },
  /* four-legged gaits: legs swing about the shoulder and hip, lower legs fold while they swing forward,
   * the head nods with the stride. walk: one foot at a time; run: a trot (diagonal pairs) for a horse, a bounding
   * gallop for a dog. Everything else is a calm idle. */
  quadXforms(L, T, k, f) {
    const d = L.data, R = d.rig, yS = R.yShift, out = new Float32Array(17 * 12);
    const name = T.clip[k], fps = fpsOf();
    const horse = R.quad === 'horse';
    const gait = name === 'walk' ? 'walk' : name === 'run' ? 'run' : 'idle';
    const blend = T.prev[k] ? Math.min(1, (f - T.start[k]) / (0.35 * fps)) : 1;
    const per = gait === 'run' ? (horse ? 0.7 : 0.42) : gait === 'walk' ? (horse ? 1.2 : 0.75) : 3;
    const amp = (gait === 'run' ? (horse ? 30 : 38) : gait === 'walk' ? 22 : 0) * blend * Math.PI / 180;
    const ph = T.tt[k] / per;
    // phase offsets: [LF, RF, LH, RH] = segments 5, 8, 11, 14
    const off = gait === 'walk' ? [0.25, 0.75, 0, 0.5] : horse ? [0, 0.5, 0.5, 0] : [0, 0.1, 0.55, 0.65];
    const segL = (i) => R.segs.find(g => g.seg === i);
    const ident = (s) => { out.set([1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0], 12 * s); };
    for (let s2 = 0; s2 < 17; s2++) ident(s2);
    // rotation about the x axis through pivot c (builder coordinates; rest = builder + yShift)
    const setRot = (s2, a, c, pre) => {
      const ca = Math.cos(a), sa = Math.sin(a), M = [1, 0, 0, 0, ca, -sa, 0, sa, ca];
      const cy = c[1] + yS, cz = c[2];
      // p' = M (p - c) + c', where c' is the pivot after the parent moved it (pre)
      const cy2 = pre ? pre[1] : cy, cz2 = pre ? pre[2] : cz;
      out.set(M, 12 * s2);
      out[12 * s2 + 9] = 0; out[12 * s2 + 10] = cy2 - (ca * cy - sa * cz); out[12 * s2 + 11] = cz2 - (sa * cy + ca * cz);
    };
    const apply = (s2, p) => { const O = 12 * s2, x = p[0], y = p[1] + yS, z = p[2]; return [out[O] * x + out[O + 1] * y + out[O + 2] * z + out[O + 9], out[O + 3] * x + out[O + 4] * y + out[O + 5] * z + out[O + 10], out[O + 6] * x + out[O + 7] * y + out[O + 8] * z + out[O + 11]]; };
    [5, 8, 11, 14].forEach((u, q) => {
      const t = 2 * Math.PI * (ph + off[q]), sw = Math.sin(t), lift = Math.max(0, Math.cos(t));
      const front = u < 11;
      const a1 = -amp * sw, a2 = (front ? 1 : -1) * amp * 1.6 * lift, a3 = (front ? 1 : 1) * amp * 0.8 * lift;
      const U = segL(u), Lw = segL(u + 1), Pw = segL(u + 2); if (!U || !Lw || !Pw) return;
      setRot(u, a1, U.a);
      const e = apply(u, Lw.a); setRot(u + 1, a1 + a2, Lw.a, [0, e[1], e[2]]);
      const w = apply(u + 1, Pw.a); setRot(u + 2, a1 + a2 + a3 * (front ? -1 : 1), Pw.a, [0, w[1], w[2]]);
    });
    // head and neck nod with the stride; idle looks around a little
    const nod = gait === 'idle' ? 0.05 * Math.sin(2 * Math.PI * T.tt[k] / 3.1) : 0.06 * blend * Math.sin(4 * Math.PI * ph);
    const N = segL(1), Hd = segL(0);
    if (N && Hd) { setRot(1, nod, N.a); const hp = apply(1, Hd.a); setRot(0, nod * 1.6, Hd.a, [0, hp[1], hp[2]]); }
    // feet on the ground, then travel forward
    const smp = this.samples(L), r = d.rest; let mn = 1e9, mnR = 1e9;
    for (let q = 0; q < smp.length; q++) { const i = smp[q], O = 12 * d.seg[i], x = r[3 * i], y = r[3 * i + 1], z = r[3 * i + 2]; mn = Math.min(mn, out[O + 3] * x + out[O + 4] * y + out[O + 5] * z + out[O + 10]); mnR = Math.min(mnR, y); }
    const sp = gait === 'run' ? (horse ? 6 : 4.5) : gait === 'walk' ? (horse ? 1.7 : 1.1) : 0;
    const dz = T.qdist ? T.qdist[k] : 0;
    for (let s2 = 0; s2 < 17; s2++) { out[12 * s2 + 10] += mnR - mn; out[12 * s2 + 11] += dz; }
    void sp;
    return out;
  },
  // rest shape posed by segment transforms (the same blend the solver uses)
  posed(d, S) {
    const n = d.count, r = d.rest, out = new Float32Array(3 * n), o3 = new Float32Array(3), E = window.ShatterEngine;
    const DQ = E.segDQ(S, S.length / 12, null);
    const sk = d.sk || Uint8Array.from({ length: 4 * n }, (_, q) => d.seg[q >> 2]), skw = d.skw || Uint8Array.from({ length: 4 * n }, (_, q) => (q & 3) ? 0 : 1);
    for (let i = 0; i < n; i++) { E.dqSkin(DQ, sk, skw, 4 * i, r[3 * i], r[3 * i + 1], r[3 * i + 2], o3); out[3 * i] = o3[0]; out[3 * i + 1] = o3[1]; out[3 * i + 2] = o3[2]; }
    return out;
  },
  // lowest point of the body posed by rig R (before any floor offset)
  _lowest(L, R, Rr, H, yS) {
    const d = L.data, smp = this.samples(L), r = d.rest;
    let mn = 1e9;
    for (let q = 0; q < smp.length; q++) {
      const i = smp[q], s = d.seg[i], Gt = R.G[s] || Rr.G[s], M = BLD.mm(Gt, BLD.tr3(Rr.G[s]));
      const a = BLD.mv(M, [H * Rr.P1[s][0], yS + H * Rr.P1[s][1], H * Rr.P1[s][2]]);
      const ty = yS + H * R.P1[s][1] - a[1];
      mn = Math.min(mn, M[3] * r[3 * i] + M[4] * r[3 * i + 1] + M[5] * r[3 * i + 2] + ty);
    }
    return mn;
  },
  // how strongly the body shields itself: a weapon close by and coming closer
  braceFor(o, P, cols, bodyPos) {
    if (!P.braceDanger) return 0;
    let w = 0;
    for (const c of cols) {
      const prev = SIM.prevColsBrace && SIM.prevColsBrace.get(c.key);
      if (!prev) continue;
      const dx = bodyPos[0] - c.p[0], dy = bodyPos[1] - c.p[1], dz = bodyPos[2] - c.p[2], d = Math.hypot(dx, dy, dz) || 1;
      const vx = c.p[0] - prev.p[0], vy = c.p[1] - prev.p[1], vz = c.p[2] - prev.p[2];
      const closing = (vx * dx + vy * dy + vz * dz) / d * fpsOf();
      if (closing < 1.2) continue;
      const gap = d - (c.bound || 0.3);
      const k = gap > 2.4 ? 0 : gap < 0.7 ? 1 : 1 - (gap - 0.7) / 1.7;
      w = Math.max(w, k * k * (3 - 2 * k));
    }
    return w;
  },
};

/* ---------- Mixamo import ----------
 * The FBX is read with three's FBXLoader, played at 30 fps, and each of our segments copies how its Mixamo bone
 * turns in the world (relative to the file's bind pose). Limbs are first lined up with the Mixamo bind direction,
 * so a T-pose file drives our skeleton correctly. Hip movement is scaled to our leg length. */
const MIX_MAP = [
  [0, 'Head', 'HeadTop_End'], [1, 'Neck', 'Head'], [2, 'Spine2', 'Neck'], [3, 'Spine1', 'Spine2'], [4, 'Hips', 'Spine'],
  [5, 'LeftArm', 'LeftForeArm'], [6, 'LeftForeArm', 'LeftHand'], [7, 'LeftHand', 'LeftHandMiddle1'],
  [8, 'RightArm', 'RightForeArm'], [9, 'RightForeArm', 'RightHand'], [10, 'RightHand', 'RightHandMiddle1'],
  [11, 'LeftUpLeg', 'LeftLeg'], [12, 'LeftLeg', 'LeftFoot'], [13, 'LeftFoot', 'LeftToeBase'],
  [14, 'RightUpLeg', 'RightLeg'], [15, 'RightLeg', 'RightFoot'], [16, 'RightFoot', 'RightToeBase'],
];
// shoulder girdles (collarbone) onto our girdle segments
MIX_MAP.push([47, 'LeftShoulder', 'LeftArm'], [48, 'RightShoulder', 'RightArm']);
// finger bones: Mixamo <Side>Hand<Finger>1..3 (4 is the tip) onto our 15 finger segments per hand
['Left', 'Right'].forEach((sd, L) => ['Thumb', 'Index', 'Middle', 'Ring', 'Pinky'].forEach((fn, f) => { for (let k = 0; k < 3; k++) MIX_MAP.push([17 + 15 * L + 3 * f + k, sd + 'Hand' + fn + (k + 1), sd + 'Hand' + fn + (k + 2)]); }));
// a segment's rest bone (start, end) in MakeHuman units: body bones from the mesh data, fingers from the hand joints
function boneOf(MH, s) {
  if (s < 17) return MH.bones[s];
  if (s >= 47) { const S0 = MH.bones[s === 47 ? 5 : 8][0]; return [BLD.girdleC(S0), S0]; }
  const L = Math.floor((s - 17) / 15), f = Math.floor((s - 17) % 15 / 3), k = (s - 17) % 3, sd = L === 0 ? 'l' : 'r';
  const a = MH.joints[sd + '-finger-' + (f + 1) + '-' + (k + 1)], b = MH.joints[sd + '-finger-' + (f + 1) + '-' + (k + 2)];
  return a && b ? [a, b] : null;
}
async function retargetFBX(buf, fileName) {
  const { FBXLoader } = await import('three/addons/loaders/FBXLoader.js');
  const root = new FBXLoader().parse(buf, '');
  const clip = (root.animations || []).slice().sort((a, b) => b.duration - a.duration)[0];
  if (!clip || !(clip.duration > 0)) throw new Error('this file has no animation in it');
  const bones = {};
  root.traverse(o => { if (o.isBone || o.isObject3D) { const nm = String(o.name || '').replace(/^mixamorig\d*[:_]?/i, '').replace(/^.*:/, ''); if (nm && !bones[nm]) bones[nm] = o; } });
  const miss = MIX_MAP.filter(m => m[0] < 17 && !bones[m[1]]).map(m => m[1]);
  if (miss.length > 3) throw new Error('not a Mixamo skeleton (missing ' + miss.slice(0, 4).join(', ') + ')');
  const MH = RIG.mh(), R0 = RIG.rest('stand');
  root.updateMatrixWorld(true);
  const wq = (o) => o.getWorldQuaternion(new THREE.Quaternion()), wp = (o) => o.getWorldPosition(new THREE.Vector3());
  const bind = {};
  for (const [s, b, c] of MIX_MAP) { if (!bones[b]) continue; bind[s] = { q: wq(bones[b]), p: wp(bones[b]), c: bones[c] ? wp(bones[c]) : null }; }
  // a fingertip bone without an end marker points the way its parent bone did
  for (const [s, b] of MIX_MAP) { const B = bind[s]; if (!B || B.c || s < 17) continue; const pb = bind[BLD.SEG_PARENT[s]]; if (pb) B.c = B.p.clone().add(B.p.clone().sub(pb.p)); }
  // our bind directions (MakeHuman), lined up onto the Mixamo bind directions for limbs
  const align = [];
  for (const [s] of MIX_MAP) {
    const B = bind[s];
    if (s <= 4 || !B || !B.c) { align[s] = [1, 0, 0, 0, 1, 0, 0, 0, 1]; continue; }
    const dm = B.c.clone().sub(B.p).normalize(), bo = boneOf(MH, s);
    if (!bo) { align[s] = [1, 0, 0, 0, 1, 0, 0, 0, 1]; continue; }
    const d0 = new THREE.Vector3(bo[1][0] - bo[0][0], bo[1][1] - bo[0][1], bo[1][2] - bo[0][2]).normalize();
    align[s] = BLD.rotFromTo([d0.x, d0.y, d0.z], [dm.x, dm.y, dm.z]);
  }
  // scale: Mixamo hip height above the toes -> our pelvis pivot height
  const hips = bones.Hips, toes = [bones.LeftToeBase, bones.RightToeBase, bones.LeftFoot].filter(Boolean);
  const hip0 = wp(hips), floorY = Math.min(...toes.map(t => wp(t).y));
  const k = R0.P0[4][1] / Math.max(1e-3, hip0.y - floorY + (hip0.y - floorY) * 0.06);
  const mixer = new THREE.AnimationMixer(root); const act = mixer.clipAction(clip); act.play();
  const fps = 30, n = Math.max(2, Math.round(clip.duration * fps) + 1);
  const q = Array.from({ length: BLD.NSEG }, () => []), hip = [];
  const tmp = new THREE.Quaternion(), M3 = new THREE.Matrix3(), M4 = new THREE.Matrix4();
  for (let i = 0; i < n; i++) {
    mixer.setTime(Math.min(clip.duration, i / fps)); root.updateMatrixWorld(true);
    for (const [s, b] of MIX_MAP) {
      if (!bones[b] || !bind[s]) { if (s < 17) q[s].push(0, 0, 0, 1); continue; }
      tmp.copy(wq(bones[b])).multiply(bind[s].q.clone().invert());
      const D = M3.setFromMatrix4(M4.makeRotationFromQuaternion(tmp)).clone().transpose().elements;
      const G = BLD.mm(Array.from(D), align[s]), gq = BLD.matQuat(G);
      // keep consecutive quaternions on the same side so playback blends the short way
      const L = q[s].length; if (L >= 4 && gq[0] * q[s][L - 4] + gq[1] * q[s][L - 3] + gq[2] * q[s][L - 2] + gq[3] * q[s][L - 1] < 0) for (let m = 0; m < 4; m++) gq[m] = -gq[m];
      q[s].push(...gq);
    }
    const hp = wp(hips).sub(hip0).multiplyScalar(k);
    hip.push(hp.x, hp.y, hp.z);
  }
  const name = String(fileName || 'Mixamo clip').replace(/\.fbx$/i, '').slice(0, 40);
  return packClip(name, fps, n, q, hip);
}
/* ---------- saved animations ----------
 * Every imported Mixamo clip is also kept in this browser's (or the desktop app's) own storage, so it is there in
 * every scene from then on. A scene that uses one carries its own copy, so scene files stay complete. */
const ANIMLIB = {
  items: new Map(), ready: false, db: null,
  open() {
    if (this.db) return this.db;
    this.db = new Promise((res) => {
      try {
        const rq = indexedDB.open('shatterbond-animations', 1);
        rq.onupgradeneeded = () => { rq.result.createObjectStore('clips', { keyPath: 'id' }); };
        rq.onsuccess = () => res(rq.result); rq.onerror = () => res(null); rq.onblocked = () => res(null);
      } catch (e) { res(null); }
    });
    return this.db;
  },
  async tx(mode, fn) {
    const db = await this.open(); if (!db) return null;
    return new Promise((res) => { try { const t = db.transaction('clips', mode), st = t.objectStore('clips'); const r = fn(st); t.oncomplete = () => res(r && r.result !== undefined ? r.result : true); t.onerror = () => res(null); t.onabort = () => res(null); } catch (e) { res(null); } });
  },
  async load() {
    const all = await this.tx('readonly', st => st.getAll());
    this.items.clear();
    if (Array.isArray(all)) for (const e of all) if (e && e.id && e.clip && e.clip.n > 1) this.items.set(e.id, e);
    this.ready = true;
    return this.items;
  },
  list() { return [...this.items.values()].sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0)); },
  get(id) { const e = this.items.get(id); return e ? e.clip : null; },
  async put(id, clip) {
    const e = { id, clip, savedAt: Date.now() };
    this.items.set(id, e);
    const ok = await this.tx('readwrite', st => st.put(e));
    return !!ok;
  },
  async rename(id, name) { const e = this.items.get(id); if (!e) return; e.clip = Object.assign({}, e.clip, { name: String(name).slice(0, 40) }); await this.tx('readwrite', st => st.put(e)); },
  async remove(id) { this.items.delete(id); await this.tx('readwrite', st => st.delete(id)); },
};
// the clip a humanoid plays by id: the scene's own copy, else the saved one (copied into the scene so it travels with it)
function clipById(id) {
  const sc = APP.scene && APP.scene.clips;
  if (sc && sc[id]) return sc[id];
  const c = ANIMLIB.get(id);
  if (c && APP.scene) { APP.scene.clips = APP.scene.clips || {}; APP.scene.clips[id] = c; }
  return c;
}
async function importMixamo(files) {
  if (!files) {
    const inp = el('input', { type: 'file', accept: '.fbx', multiple: true, style: { display: 'none' } });
    inp.addEventListener('change', () => { const fs = [...(inp.files || [])]; inp.remove(); if (fs.length) importMixamo(fs); });
    document.body.append(inp); inp.click();
    return;
  }
  const done = [];
  for (const file of files) {
    UI.busy('Importing ' + file.name + '…');
    try {
      const clip = await retargetFBX(await file.arrayBuffer(), file.name);
      const id = 'c' + Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36);
      if (!done.length) pushUndo();
      APP.scene.clips = APP.scene.clips || {};
      APP.scene.clips[id] = clip;
      const saved = await ANIMLIB.put(id, clip);
      done.push({ id, clip, saved });
    } catch (err) { console.error(err); toast('Could not import ' + file.name + ': ' + err.message, true); }
  }
  UI.busy(null);
  if (!done.length) return;
  const hs = APP.sel.map(id2 => objById(id2)).filter(o => o && o.type === 'humanoid' && !(o.props.bodyType === 'dog' || o.props.bodyType === 'horse'));
  for (const o of hs) setProp(o, 'animation', 'clip:' + done[0].id);
  RIG.track.clear(); SIM.invalidate();
  buildProps();
  const c = done[0].clip, more = done.length > 1 ? ` and ${done.length - 1} more` : '';
  toast(`Imported "${c.name}" (${(c.n / c.fps).toFixed(1)} s)${more}` + (done.every(d => d.saved) ? '. Saved to your animations.' : '. (This browser could not save it for later.)') + (hs.length ? '' : ' Pick it under Animation on any humanoid.'));
}
// Animation library: saved clips, rename, delete, use, export and import as a file
function openAnimLibrary() {
  const body = el('div');
  let modal = null;
  const render = () => {
    body.textContent = '';
    const list = ANIMLIB.list();
    const unsaved = Object.entries((APP.scene && APP.scene.clips) || {}).filter(([id]) => !ANIMLIB.items.has(id));
    body.append(el('div', { class: 'section-t' }, `Saved animations (${list.length})`));
    if (!list.length) body.append(el('div', { class: 'p-help', style: { margin: '0 0 14px' } }, 'Nothing saved yet. Download an animation from mixamo.com as FBX and import it: it is saved here and can be used in every scene from then on.'));
    const row = (id, clip, saved) => {
      const name = el('input', { type: 'text', value: clip.name || 'Animation', 'aria-label': 'Name', class: 'al-name' });
      name.addEventListener('change', async () => { const v = name.value.trim() || 'Animation'; if (saved) await ANIMLIB.rename(id, v); if (APP.scene.clips && APP.scene.clips[id]) APP.scene.clips[id] = Object.assign({}, APP.scene.clips[id], { name: v }); buildProps(); });
      const len = el('span', { class: 'al-len' }, `${(clip.n / (clip.fps || 30)).toFixed(1)} s` + (clip.qp && clip.qp.slice(17, 47).some(Boolean) ? ' · fingers' : ''));
      const use = el('button', { class: 'btn sm', title: 'Play this on the selected humanoids' }, 'Use');
      use.onclick = () => {
        const hs = APP.sel.map(i => objById(i)).filter(o => o && o.type === 'humanoid' && !(o.props.bodyType === 'dog' || o.props.bodyType === 'horse'));
        if (!hs.length) { toast('Select a humanoid first', true); return; }
        pushUndo(); clipById(id); for (const o of hs) setProp(o, 'animation', 'clip:' + id); RIG.track.clear(); SIM.invalidate(); buildProps();
        toast(`"${clip.name}" plays on ${hs.length === 1 ? hs[0].name : hs.length + ' bodies'}`);
      };
      const acts = el('div', { class: 'al-acts' }, use);
      if (saved) {
        const del = el('button', { class: 'btn sm danger', title: 'Remove from saved animations', html: ICON.trash }, 'Delete');
        del.onclick = () => confirmModal('Delete this animation?', `"${clip.name}" will be removed from your saved animations. Scenes that already use it keep their own copy.`, 'Delete', async () => { await ANIMLIB.remove(id); render(); buildProps(); }, true);
        acts.append(del);
      } else {
        const sv = el('button', { class: 'btn sm', title: 'Keep it for every scene' }, 'Save');
        sv.onclick = async () => { const ok = await ANIMLIB.put(id, clip); toast(ok ? `Saved "${clip.name}"` : 'This browser could not save it', !ok); render(); buildProps(); };
        acts.append(sv);
      }
      return el('div', { class: 'al-row' }, name, len, acts);
    };
    if (list.length) body.append(el('div', { class: 'al-list' }, ...list.map(e => row(e.id, e.clip, true))));
    if (unsaved.length) {
      body.append(el('div', { class: 'section-t', style: { marginTop: '16px' } }, 'In this scene only'));
      body.append(el('div', { class: 'al-list' }, ...unsaved.map(([id, c]) => row(id, c, false))));
    }
    body.append(el('div', { class: 'p-help', style: { marginTop: '14px' } }, 'Saved animations are kept on this device (in this browser, or in the desktop app). Export them as a file to move them to another device.'));
  };
  render();
  const imp = el('button', { class: 'btn', html: ICON.upload }, 'Import FBX…');
  imp.onclick = () => { modal.close(); importMixamo(); };
  const exp = el('button', { class: 'btn', html: ICON.download }, 'Export all');
  exp.onclick = () => {
    const list = ANIMLIB.list(); if (!list.length) { toast('No saved animations yet', true); return; }
    saveFile('shatterbond-animations.json', JSON.stringify({ shatterbondAnimations: 1, clips: list.map(e => ({ id: e.id, clip: e.clip })) }));
  };
  const load = el('button', { class: 'btn', html: ICON.upload }, 'Load file…');
  load.onclick = () => {
    const inp = el('input', { type: 'file', accept: '.json,application/json', style: { display: 'none' } });
    inp.addEventListener('change', () => {
      const f = inp.files && inp.files[0]; inp.remove(); if (!f) return;
      const r = new FileReader();
      r.onload = async () => {
        try {
          const d = JSON.parse(r.result);
          if (!d || !Array.isArray(d.clips)) throw new Error('not a Shatterbond animations file');
          let k = 0;
          for (const e of d.clips) { const c = e && e.clip; if (!e.id || !/^[\w-]{1,40}$/.test(e.id) || !c || !(c.n > 1) || !Array.isArray(c.qp) || typeof c.hp !== 'string') continue; await ANIMLIB.put(e.id, c); k++; }
          toast(`Loaded ${k} animation${k === 1 ? '' : 's'}`); render(); buildProps();
        } catch (err) { toast('Could not load: ' + err.message, true); }
      };
      r.readAsText(f);
    });
    document.body.append(inp); inp.click();
  };
  modal = openModal('Animations', body, [], { icon: 'film', headExtra: [imp, load, exp], wide: true });
}
