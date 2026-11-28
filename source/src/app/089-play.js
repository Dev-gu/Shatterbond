/* ---------- play mode: a live gore sandbox, first person (WASD) or in VR (WebXR, Quest Link / SteamVR) ----------
 * The editor scene is put aside and an arena is simulated live: no timeline, no cache. Every step is built here
 * (bullets are one-shot directional impulses, cannon/grenade balls are real engine balls, VR hands and the sword
 * are moving colliders) and the result is drawn straight away. Spawned bodies are appended to the running
 * engine, so dummies already lying in pieces stay that way. */
const PLAY_SPAWNS = [
  { id: 'adult', label: 'Dummy', props: { bodyType: 'adult' } },
  { id: 'heavy', label: 'Heavy dummy', props: { bodyType: 'heavy' } },
  { id: 'super', label: 'Superhuman', props: { bodyType: 'super' } },
  { id: 'ragdoll', label: 'Ragdoll drop', props: { bodyType: 'adult', stand: false, sleep: false }, lift: 0.8 },
  { id: 'dog', label: 'Dog', props: { bodyType: 'dog' } },
  { id: 'horse', label: 'Horse', props: { bodyType: 'horse' } },
  { id: 'ball', label: 'Wrecking ball', ball: true },
];
const PLAY_GUNS = [
  { id: 'pistol', label: 'Pistol', key: '1', rate: 0, pellets: 1, spread: 0, str: 30, rad: 0.09, dmg: 0.7 },
  { id: 'shotgun', label: 'Shotgun', key: '2', rate: 1.4, pellets: 9, spread: 0.06, str: 16, rad: 0.08, dmg: 0.65 },
  { id: 'rifle', label: 'Rifle (auto)', key: '3', rate: 11, auto: true, pellets: 1, spread: 0.008, str: 26, rad: 0.08, dmg: 0.65 },
  { id: 'cannon', label: 'Cannon', key: '4', rate: 2.5, ball: { r: 0.11, rho: 7800, v: 34, life: 8 } },
  { id: 'grenade', label: 'Grenades', key: '5', rate: 1.5, ball: { r: 0.05, rho: 3000, v: 13, life: 2.4, fuse: true } },
  { id: 'rocket', label: 'Rocket', key: '6', rate: 1.2, blast: { r: 1.4, s: 15 } },
  { id: 'sword', label: 'Sword', key: '7', vrOnly: true },
  { id: 'fists', label: 'Fists', key: '8', vrOnly: true },
];
const PLAY = {
  on: false, mode: null, xr: false, saved: null, token: 0, ready: false, chain: Promise.resolve(), inflight: false,
  bps: [], simT: 0, clock: 0, last: 0, slow: false, steps: 0, rateT: 0, rate: 1, fields: [], prj: [], kills: [], balls: new Map(), ballLife: new Map(), fuses: new Map(), nBall: 0,
  gun: 0, spawnSel: 0, fireCd: 0, held: false, keys: new Set(), yaw: 0, pitch: 0, pos: null, vy: 0, grounded: true,
  seated: false, seatH: 0.5, grab: new Map(), grabPrev: new Map(), detail: 26, prevCols: new Map(), tracers: [], menuOpen: false,
  load() { try { const v = JSON.parse(localStorage.getItem('shatterbond.play') || '{}'); if (v.detail) this.detail = v.detail; if (v.seated != null) this.seated = !!v.seated; if (v.seatH != null) this.seatH = v.seatH; } catch (e) { /* storage unavailable */ } },
  save() { try { localStorage.setItem('shatterbond.play', JSON.stringify({ detail: this.detail, seated: this.seated, seatH: this.seatH })); } catch (e) { /* storage unavailable */ } },
};
PLAY.load();

/* ---------- entering and leaving ---------- */
function playMenuItems() {
  return [{ hdr: 'Play the sandbox' },
    { label: 'First person (WASD + mouse, guns)', icon: 'play', action: () => enterPlay('fps') },
    { label: 'VR (Quest Link / SteamVR)', icon: 'camera', action: () => enterPlay('vr') }];
}
async function enterPlay(mode) {
  if (PLAY.on) { if (mode === 'vr' && !PLAY.xr) startXR(); return; }
  let pending = null;
  if (mode === 'vr') {
    if (!navigator.xr) { playVRHelp('This window has no WebXR (VR) support.'); return; }
    pending = playRequestXR(); pending.catch(() => {}); // asked for straight away: the browser only allows it during the click
    let ok = false; try { ok = await navigator.xr.isSessionSupported('immersive-vr'); } catch (e) { ok = false; }
    if (!ok) { pending.then(s => s.end()).catch(() => {}); playVRHelp('The browser reports no VR headset (immersive-vr is not supported here).'); return; }
  }
  if (APP.recording) return toast('Finish the video render first', true);
  if (APP.playing) togglePlay();
  closeMenu();
  PLAY.on = true; PLAY.mode = mode; PLAY.token++;
  PLAY.saved = snapshot(); PLAY.savedCam = { p: R.camera.position.clone(), t: R.controls.target.clone(), camView: APP.camView };
  APP.camView = false;
  document.body.classList.add('play-on');
  playBuildUI();
  if (!PLAY.cam) {
    PLAY.cam = new THREE.PerspectiveCamera(75, 1, 0.03, 300); PLAY.cam.rotation.order = 'YXZ';
    PLAY.dolly = new THREE.Group(); PLAY.dolly.add(PLAY.cam);
    PLAY.gunModel = playGunMesh(); PLAY.gunModel.position.set(0.2, -0.19, -0.42); PLAY.cam.add(PLAY.gunModel);
    PLAY.ballMat = stdMat('#3b3e46', 0.35, 0.7); PLAY.grenMat = stdMat('#4c6b2f', 0.6, 0.1);
    PLAY.ballInst = new THREE.InstancedMesh(GEO.ball, PLAY.ballMat, 256); PLAY.ballInst.count = 0; PLAY.ballInst.frustumCulled = false; PLAY.ballInst.castShadow = true;
    PLAY.ballInst.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(256 * 3), 3);
  }
  R.scene.add(PLAY.dolly, PLAY.ballInst);
  PLAY.pos = new THREE.Vector3(0, 0, 4.5); PLAY.yaw = 0; PLAY.pitch = -0.08; PLAY.vy = 0;
  PLAY.dolly.position.copy(PLAY.pos); PLAY.dolly.rotation.set(0, 0, 0); PLAY.cam.position.set(0, 1.65, 0);
  PLAY.gunModel.visible = mode === 'fps';
  if (R.gizmo.object) R.gizmo.detach();
  if (mode === 'vr') startXR(pending);
  await playResetArena();
  if (mode === 'vr') { /* already started */ }
  else toast('Click to aim. WASD move, mouse shoot, Tab spawn menu, Esc pause');
}
function exitPlay() {
  if (!PLAY.on) return;
  if (PLAY.session) { const s = PLAY.session; PLAY.session = null; s.end().catch(() => {}); }
  stopXRLoop();
  PLAY.on = false; PLAY.ready = false; PLAY.token++;
  if (document.pointerLockElement) document.exitPointerLock();
  document.body.classList.remove('play-on');
  if (PLAY.ui) PLAY.ui.remove(); PLAY.ui = null;
  PLAY.dolly.removeFromParent(); PLAY.ballInst.removeFromParent();
  for (const t of PLAY.tracers) t.m.removeFromParent(); PLAY.tracers = [];
  PLAY.keys.clear();
  const sv = PLAY.saved; PLAY.saved = null;
  try { activateScene(JSON.parse(sv), {}); } catch (e) { console.error(e); }
  if (PLAY.savedCam) { R.camera.position.copy(PLAY.savedCam.p); R.controls.target.copy(PLAY.savedCam.t); APP.camView = PLAY.savedCam.camView; }
  R.helpers.visible = true; APP.dirtyEval = true; _dispKey = '';
  setTimeout(() => resizeViewport(), 0);
  toast('Back in the editor');
}
function playDummyProps(sp, pos, yawDeg) {
  return Object.assign({ position: pos, rotation: [0, yawDeg, 0], resolution: 'custom', spacingMM: PLAY.detail, sleep: true, stand: true, animation: 'none', release: -1, velocity: [0, 0, 0], react: true }, sp.props);
}
// a fresh arena: floor and three dummies, built like any scene, then handed to the live loop
async function playResetArena() {
  const tok = ++PLAY.token;
  PLAY.ready = false; PLAY.chain = Promise.resolve(); PLAY.inflight = false;
  PLAY.grab.clear(); PLAY.grabPrev.clear(); PLAY.fields = []; PLAY.prj = []; PLAY.kills = []; PLAY.balls.clear(); PLAY.ballLife.clear(); PLAY.fuses.clear(); PLAY.prevCols.clear(); PLAY.ballInst.count = 0;
  const sc = newScene('Play arena');
  Object.assign(sc.world.props, { frameStart: 0, frameEnd: 1e7, floor: true });
  const D = PLAY_SPAWNS[0];
  for (const [x, z, a] of [[-1.6, -1.2, 15], [0, -2, 0], [1.6, -1.2, -15]]) sc.objects.push(makeObj('humanoid', playDummyProps(D, [x, 0, z], a), 'Dummy'));
  activateScene(sc, {});
  APP.dirtyEval = false; evaluateScene(0); applyWorldLook(APP.worldP); MOL.applyStyle();
  const ok = await SIM.begin();
  if (tok !== PLAY.token || !PLAY.on) return;
  if (!ok) { toast('Could not build the arena', true); return; }
  PLAY.bps = SIM.layout.map(L => playBodyParams(L.obj));
  SIM.restPositions(0, SIM.disp); SIM.dispSt.fill(0);
  MOL.applyStyle(); playUpload();
  PLAY.simT = PLAY.clock = 0; PLAY.last = performance.now();
  PLAY.ready = true;
}
function playBodyParams(o) {
  const P = evalProps(o, 0), bp = SIM.bodyParams(o, P);
  if (P.bodyType === 'super' && o.type === 'humanoid') SIM.superParams(bp);
  bp.drag = 0.03;
  return bp;
}
function playUpload() { MOL.upload(SIM.disp, SIM.dispSt, SIM.layout.map(() => null)); }

/* ---------- spawning ---------- */
function playSpawn(spIdx, at, faceYaw) {
  if (!PLAY.ready) return;
  const sp = PLAY_SPAWNS[spIdx];
  if (sp.ball) { // a heavy loose ball dropped from above
    const key = 'w' + (PLAY.nBall++), r = 0.32;
    PLAY.prj.push({ key, r, m: 4.18879 * r * r * r * 7800, friction: 0.5, restitution: 0.2, shatterMul: 1, p: [at.x, 2.4, at.z], v: [0, -2, 0] });
    PLAY.ballLife.set(key, PLAY.simT + 40);
    return;
  }
  if (SIM.layout.length >= 14) return toast('That is plenty of bodies. Reset the arena (R) to start over.', true);
  const yawDeg = +(faceYaw / DEG).toFixed(1);
  const o = makeObj('humanoid', playDummyProps(sp, [+at.x.toFixed(3), sp.lift || 0, +at.z.toFixed(3)], yawDeg), sp.label);
  const tok = PLAY.token;
  toast('Spawning ' + sp.label.toLowerCase() + '…');
  PLAY.chain = PLAY.chain.then(async () => {
    if (tok !== PLAY.token) return;
    const P = evalProps(o, 0), desc = SIM.shapeDesc(o, P), key = JSON.stringify(desc);
    let data = BUILD_CACHE.get(key);
    if (!data) { data = (await SIM.call('buildShape', { desc })).out; BUILD_CACHE.set(key, data); }
    if (tok !== PLAY.token) return;
    const T = SIM.placement(o, 0), bp = playBodyParams(o);
    const params = Object.assign({}, bp, { stand: !!P.stand, startAsleep: !!P.sleep, anchorStrength: 1, canSleep: true, react: true, drive: false });
    const d = data;
    await SIM.call('append', { bodies: [{ count: d.count, rest: d.rest, tissue: d.tissue, seg: d.seg, sk: d.sk, skw: d.skw, invMass: d.invMass, smw: d.smw, shm: d.shm, anchor: d.anchor, boneRef: d.boneRef,
      bonds: d.bonds, bondRest: d.bondRest, bondK: d.bondK, bondS: d.bondS, bondC: d.bondC, hasSkeleton: d.hasSkeleton, softSegments: d.softSegments, radius: d.radius, spacing: d.spacing,
      pos: T.p, quat: T.q, vel: [0, 0, 0], params, kinematic: false }] });
    if (tok !== PLAY.token) return;
    APP.scene.objects.push(o); createView(o);
    const start = SIM.N;
    SIM.layout.push({ obj: o, data, start, key });
    SIM.N = start + d.count;
    const disp = new Float32Array(3 * SIM.N); disp.set(SIM.disp); const dst = new Uint8Array(SIM.N); dst.set(SIM.dispSt);
    const m = new THREE.Matrix4().compose(new THREE.Vector3(...T.p), new THREE.Quaternion(...T.q), new THREE.Vector3(1, 1, 1)).elements;
    for (let i = 0; i < d.count; i++) {
      const x = d.rest[3 * i], y = d.rest[3 * i + 1], z = d.rest[3 * i + 2], o3 = 3 * (start + i);
      disp[o3] = m[0] * x + m[4] * y + m[8] * z + m[12]; disp[o3 + 1] = m[1] * x + m[5] * y + m[9] * z + m[13]; disp[o3 + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
    }
    SIM.disp = disp; SIM.dispSt = dst;
    SIM.layoutSigCur = SIM.layoutSig(); SIM.layoutDirty = false;
    MOL.setLayout(SIM.layout); MOL.applyStyle();
    PLAY.bps.push(bp);
    playUpload();
  }).catch(err => { console.error(err); toast('Spawn failed: ' + err.message, true); });
}
// where a ray meets the floor (or a point ahead when it points up)
function playFloorPoint(origin, dir, maxD) {
  const t = dir.y < -1e-3 ? -origin.y / dir.y : Infinity;
  if (t < (maxD || 20)) return origin.clone().addScaledVector(dir, t);
  const f = new THREE.Vector3(dir.x, 0, dir.z); if (f.lengthSq() < 1e-6) f.set(0, 0, -1);
  return origin.clone().addScaledVector(f.normalize(), 2.5).setY(0);
}

/* ---------- weapons ---------- */
const _pr = new THREE.Raycaster();
function playFire(origin, dir) {
  const g = PLAY_GUNS[PLAY.gun];
  if (g.vrOnly) return;
  if (g.ball) {
    const B = g.ball, key = (B.fuse ? 'g' : 'c') + (PLAY.nBall++), v = dir.clone().multiplyScalar(B.v);
    const p = origin.clone().addScaledVector(dir, 0.35);
    PLAY.prj.push({ key, r: B.r, m: 4.18879 * B.r ** 3 * B.rho, friction: 0.6, restitution: B.fuse ? 0.35 : 0.25, shatterMul: 1, p: [p.x, p.y, p.z], v: [v.x, v.y + (B.fuse ? 2.5 : 0), v.z] });
    PLAY.ballLife.set(key, PLAY.simT + B.life);
    if (B.fuse) PLAY.fuses.set(key, PLAY.simT + B.life - 0.02);
    playKick(0.6); return;
  }
  const n = g.pellets || 1;
  for (let k = 0; k < n; k++) {
    const d = dir.clone();
    if (g.spread) { d.x += (Math.random() - 0.5) * 2 * g.spread; d.y += (Math.random() - 0.5) * 2 * g.spread; d.z += (Math.random() - 0.5) * 2 * g.spread; d.normalize(); }
    _pr.set(origin, d);
    const ph = pickParticles(_pr.ray);
    let hit = ph ? origin.clone().addScaledVector(d, ph.t) : null, onBody = !!ph;
    if (!hit) { const t = d.y < -1e-3 ? -origin.y / d.y : Infinity; if (t < 200) hit = origin.clone().addScaledVector(d, t); }
    playTracer(origin, hit || origin.clone().addScaledVector(d, 60));
    if (!hit) continue;
    if (g.blast) {
      PLAY.fields.push({ type: 'impulse', p: [hit.x, hit.y, hit.z], radius: g.blast.r, strength: g.blast.s, damage: 0.45, lift: 0.3 });
      flashFX(hit, g.blast.r);
    } else if (onBody) {
      PLAY.fields.push({ type: 'impulse', p: [hit.x, hit.y, hit.z], dir: [d.x, d.y, d.z], radius: g.rad, strength: g.str, damage: g.dmg });
      flashFX(hit, 0.06);
    } else flashFX(hit, 0.03);
  }
  playKick(g.id === 'shotgun' ? 1 : g.id === 'rocket' ? 0.8 : 0.4);
}
function playKick(k) { PLAY.recoil = Math.min(1, (PLAY.recoil || 0) + k); }
function playTracer(a, b) {
  const geo = new THREE.BufferGeometry().setFromPoints([a.clone().lerp(b, 0.04), b]);
  const m = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: '#ffd28a', transparent: true, opacity: 0.9, depthWrite: false }));
  R.scene.add(m); PLAY.tracers.push({ m, t0: performance.now() });
}
function playGunMesh() {
  const g = new THREE.Group(), dark = stdMat('#25272c', 0.45, 0.6), grip = stdMat('#3a2f27', 0.8, 0);
  const body = mkMesh(GEO.box, dark); body.scale.set(0.05, 0.07, 0.26); body.position.z = -0.04;
  const barrel = mkMesh(GEO.unitCyl, dark); barrel.scale.set(0.014, 0.2, 0.014); barrel.rotation.x = Math.PI / 2; barrel.position.set(0, 0.012, -0.24);
  const handle = mkMesh(GEO.box, grip); handle.scale.set(0.04, 0.12, 0.05); handle.position.set(0, -0.08, 0.05); handle.rotation.x = 0.25;
  g.add(body, barrel, handle);
  g.traverse(m => { if (m.isMesh) { m.castShadow = false; m.userData.collider = null; } });
  return g;
}
function playSword() {
  const g = new THREE.Group();
  const blade = mkMesh(GEO.box, stdMat('#d8dde4', 0.18, 1)); blade.scale.set(0.012, 0.05, 0.85); blade.position.z = -0.55;
  const guard = mkMesh(GEO.box, stdMat('#5a4630', 0.6, 0.3)); guard.scale.set(0.16, 0.025, 0.03); guard.position.z = -0.11;
  const hilt = mkMesh(GEO.unitCyl, stdMat('#2b2420', 0.8, 0)); hilt.scale.set(0.017, 0.16, 0.017); hilt.rotation.x = Math.PI / 2; hilt.position.z = -0.02;
  g.add(blade, guard, hilt); return g;
}
function playFist(color) { const m = mkMesh(GEO.ball, stdMat(color, 0.7, 0)); m.scale.set(0.045, 0.045, 0.06); return m; }

/* ---------- the live simulation step ---------- */
function playStep() {
  const tok = PLAY.token;
  PLAY.inflight = true;
  const ts = PLAY.slow ? 0.25 : 1;
  const fields = PLAY.fields.splice(0), projectiles = PLAY.prj.splice(0);
  // balls that ran out: grenades go off where they are, the rest just vanish
  const kills = [];
  for (const [k, t] of PLAY.ballLife) if (PLAY.simT >= t) {
    kills.push(k); PLAY.ballLife.delete(k);
    if (PLAY.fuses.has(k)) { PLAY.fuses.delete(k); const b = PLAY.balls.get(k); if (b) { fields.push({ type: 'impulse', p: [b[0], b[1], b[2]], radius: 1.6, strength: 16, damage: 0.45, lift: 0.35 }); flashFX(new THREE.Vector3(b[0], b[1], b[2]), 1.6); } }
  }
  const colliders = playColliders();
  const grabs = [];
  for (const [id, g] of PLAY.grab) { const a = PLAY.grabPrev.get(id) || g; grabs.push({ id, p: g.p, q: g.q, pa: a.p, qa: a.q, r: g.r }); }
  PLAY.grabPrev = new Map([...PLAY.grab].map(([k, g]) => [k, { p: g.p, q: g.q }]));
  const input = { grabs, dt: ts / 60, substeps: 6, gravity: [0, -9.81, 0], floor: { enabled: true, y: 0, friction: 0.7 }, colliders, fields, bodies: PLAY.bps, projectiles, killBalls: kills, ppEvery: 2, dvMax: 3, physics: 'cpu', maxSubsteps: 24 };
  const t0 = performance.now();
  PLAY.chain = PLAY.chain.then(() => SIM.call('step', { input }, [])).then(r => {
    if (tok !== PLAY.token) return;
    PLAY.stepMs = performance.now() - t0;
    if (r.pos.length === SIM.disp.length) { SIM.disp.set(r.pos); SIM.dispSt.set(r.st); }
    PLAY.balls.clear();
    const bs = r.stats.balls;
    if (bs) bs.keys.forEach((k, i) => PLAY.balls.set(k, bs.data.subarray(7 * i, 7 * i + 7)));
    SIM.broken = r.stats.broken; SIM.awake = r.stats.awake;
    playUpload();
    PLAY.steps++;
  }).catch(err => { console.error(err); if (tok === PLAY.token) toast('Simulation error: ' + err.message, true); })
    .finally(() => { if (tok === PLAY.token) PLAY.inflight = false; });
}
// VR hands (fists) and the sword are colliders that move with the controllers
const _cq = new THREE.Quaternion(), _cp = new THREE.Vector3(), _cs = new THREE.Vector3(), _q90 = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
function playColliders() {
  const out = [], now = new Map();
  if (PLAY.xr && PLAY.hands) {
    for (const h of PLAY.hands) {
      if (!h.connected || (h.src && h.src.hand) || PLAY.grab.has('c' + h.side)) continue;
      h.grip.updateMatrixWorld(true);
      h.grip.matrixWorld.decompose(_cp, _cq, _cs);
      const sword = h.side === 'right' && PLAY_GUNS[PLAY.gun].id === 'sword';
      if (sword) {
        const q = _cq.clone().multiply(_q90), c = new THREE.Vector3(0, 0, -0.55).applyQuaternion(_cq).add(_cp);
        now.set('sword', { key: 'sword', shape: 'capsule', dims: [0.02, 0.42, 0], bound: 0.45, friction: 0.15, shatterMul: 1 / 3, spin: null, p: [c.x, c.y, c.z], q: [q.x, q.y, q.z, q.w] });
      }
      if (!sword && (h.side === 'left' || PLAY_GUNS[PLAY.gun].id === 'fists' || true)) {
        const c = new THREE.Vector3(0, 0, -0.03).applyQuaternion(_cq).add(_cp);
        now.set('hand' + h.side, { key: 'hand' + h.side, shape: 'sphere', dims: [0.05, 0.05, 0.05], bound: 0.05, friction: 0.6, shatterMul: 1, spin: null, p: [c.x, c.y, c.z], q: [_cq.x, _cq.y, _cq.z, _cq.w] });
      }
    }
  }
  if (PLAY.xr && PLAY.xhands) for (const H of PLAY.xhands) {
    if (!H.tracked || PLAY.grab.has('h' + H.side)) continue;
    for (const [name, r] of PLAY_HAND_COLS) {
      const j = H.hand.joints[name]; if (!j || !j.visible) continue;
      j.updateMatrixWorld(true); j.matrixWorld.decompose(_cp, _cq, _cs);
      const rr = Math.max(r, (j.jointRadius || 0) * 1.15), key = 'j' + H.side + name;
      now.set(key, { key, shape: 'sphere', dims: [rr, rr, rr], bound: rr, friction: 0.7, shatterMul: 1, spin: null, p: [_cp.x, _cp.y, _cp.z], q: [_cq.x, _cq.y, _cq.z, _cq.w] });
    }
  }
  for (const [k, c] of now) {
    const a = PLAY.prevCols.get(k) || c;
    out.push({ key: k, shape: c.shape, dims: c.dims, bound: c.bound, friction: c.friction, spin: null, shatterMul: c.shatterMul, a: { p: a.p, q: a.q }, b: { p: c.p, q: c.q } });
  }
  PLAY.prevCols = now;
  return out;
}

/* ---------- per screen frame ---------- */
const _fw = new THREE.Vector3(), _rt = new THREE.Vector3(), _pUp = new THREE.Vector3(0, 1, 0), _bm = new THREE.Matrix4(), _bq = new THREE.Quaternion(), _bs = new THREE.Vector3();
function playFrame(now, xrFrame) {
  const dt = Math.min(0.1, Math.max(0, (now - PLAY.last) / 1000)); PLAY.last = now;
  if (PLAY.xr) playXRInput(dt); else playFPSInput(dt);
  // pace the physics to real time; when it can't keep up the world runs in slow motion instead of piling up work
  if (PLAY.ready) {
    PLAY.clock += dt;
    if (PLAY.clock - PLAY.simT > 0.1) PLAY.clock = PLAY.simT + 0.1;
    if (!PLAY.inflight && PLAY.simT <= PLAY.clock) { PLAY.simT += 1 / 60; playStep(); }
    if (now - PLAY.rateT > 1000) { PLAY.rate = PLAY.steps / ((now - PLAY.rateT) / 1000) / 60; PLAY.steps = 0; PLAY.rateT = now; }
  }
  // balls
  let n = 0;
  for (const [k, b] of PLAY.balls) {
    if (n >= 256) break;
    const r = k[0] === 'w' ? 0.32 : k[0] === 'g' ? 0.05 : 0.11;
    _bm.compose(_bs.set(b[0], b[1], b[2]), _bq.set(b[3], b[4], b[5], b[6]), new THREE.Vector3(r, r, r));
    PLAY.ballInst.setMatrixAt(n, _bm);
    PLAY.ballInst.setColorAt(n, k[0] === 'g' ? PLAY.grenMat.color : PLAY.ballMat.color);
    n++;
  }
  PLAY.ballInst.count = n; PLAY.ballInst.instanceMatrix.needsUpdate = true; if (PLAY.ballInst.instanceColor) PLAY.ballInst.instanceColor.needsUpdate = true;
  // tracers fade fast
  PLAY.tracers = PLAY.tracers.filter(t => { const a = (now - t.t0) / 90; if (a >= 1) { t.m.removeFromParent(); t.m.geometry.dispose(); t.m.material.dispose(); return false; } t.m.material.opacity = 0.9 * (1 - a); return true; });
  updateFX(now);
  R.grid.visible = false; R.helpers.visible = false; R.gizmoHelper.visible = false;
  if (!PLAY.xr) {
    const c = R.renderer.domElement; PLAY.cam.aspect = c.clientWidth / Math.max(1, c.clientHeight); PLAY.cam.updateProjectionMatrix();
  }
  R.renderer.render(R.scene, PLAY.cam);
  if (now - (PLAY.hudT || 0) > 200) { PLAY.hudT = now; playHUD(); }
  if (PLAY.xr && PLAY.panel && PLAY.panel.visible && now - (PLAY.panelT || 0) > 120) { PLAY.panelT = now; playDrawPanel(); }
}

/* ---------- first person ---------- */
function playFPSInput(dt) {
  const K = PLAY.keys, sp = K.has('ShiftLeft') || K.has('ShiftRight') ? 7 : 3.6;
  _fw.set(-Math.sin(PLAY.yaw), 0, -Math.cos(PLAY.yaw)); _rt.set(-_fw.z, 0, _fw.x);
  const mv = new THREE.Vector3();
  if (K.has('KeyW')) mv.add(_fw); if (K.has('KeyS')) mv.sub(_fw); if (K.has('KeyD')) mv.add(_rt); if (K.has('KeyA')) mv.sub(_rt);
  if (mv.lengthSq() > 0) PLAY.pos.addScaledVector(mv.normalize(), sp * dt);
  if (K.has('Space') && PLAY.grounded) { PLAY.vy = 4.6; PLAY.grounded = false; }
  PLAY.vy -= 9.81 * dt; PLAY.pos.y += PLAY.vy * dt;
  if (PLAY.pos.y <= 0) { PLAY.pos.y = 0; PLAY.vy = 0; PLAY.grounded = true; }
  const crouch = K.has('KeyC');
  PLAY.dolly.position.copy(PLAY.pos);
  PLAY.cam.position.set(0, crouch ? 1.05 : 1.65, 0);
  PLAY.cam.rotation.set(PLAY.pitch, PLAY.yaw, 0, 'YXZ');
  PLAY.recoil = Math.max(0, (PLAY.recoil || 0) - dt * 6);
  PLAY.gunModel.position.set(0.2, -0.19, -0.42 + PLAY.recoil * 0.06); PLAY.gunModel.rotation.x = PLAY.recoil * 0.25;
  // grabbing: hold G (or the middle mouse button) to pick up what the crosshair is on and carry it
  if (K.has('KeyG') || PLAY.mid) {
    PLAY.cam.updateMatrixWorld(true);
    const o = new THREE.Vector3().setFromMatrixPosition(PLAY.cam.matrixWorld), cq = PLAY.cam.getWorldQuaternion(new THREE.Quaternion()), d = new THREE.Vector3(0, 0, -1).applyQuaternion(cq);
    if (!PLAY.grab.has('fps')) { _pr.set(o, d); const ph = pickParticles(_pr.ray); PLAY.grabDist = ph && ph.t < 6 ? ph.t : 0; }
    if (PLAY.grabDist) { const p = o.addScaledVector(d, PLAY.grabDist); PLAY.grab.set('fps', { p: [p.x, p.y, p.z], q: [cq.x, cq.y, cq.z, cq.w], r: 0.12 }); }
    else PLAY.grab.set('fps', { p: [0, -50, 0], q: [0, 0, 0, 1], r: 0.01 });
  } else PLAY.grab.delete('fps');
  // firing
  PLAY.fireCd -= dt;
  const g = PLAY_GUNS[PLAY.gun];
  if (PLAY.held && PLAY.fireCd <= 0 && PLAY.locked) {
    PLAY.cam.updateMatrixWorld(true);
    const o = new THREE.Vector3().setFromMatrixPosition(PLAY.cam.matrixWorld), d = new THREE.Vector3(0, 0, -1).applyQuaternion(PLAY.cam.getWorldQuaternion(new THREE.Quaternion()));
    playFire(o, d);
    PLAY.fireCd = g.rate ? 1 / g.rate : 0.12;
    if (!g.auto) PLAY.held = false;
  }
}
function playCamRay() {
  PLAY.cam.updateMatrixWorld(true);
  return { o: new THREE.Vector3().setFromMatrixPosition(PLAY.cam.matrixWorld), d: new THREE.Vector3(0, 0, -1).applyQuaternion(PLAY.cam.getWorldQuaternion(new THREE.Quaternion())) };
}
function playSpawnAhead() {
  const { o, d } = playCamRay();
  _pr.set(o, d); const ph = pickParticles(_pr.ray);
  let p = playFloorPoint(o, d, 14);
  if (ph && ph.t < o.distanceTo(p)) p = o.clone().addScaledVector(d, Math.max(1.2, ph.t - 0.7)).setY(0);
  const face = Math.atan2(o.x - p.x, o.z - p.z);
  playSpawn(PLAY.spawnSel, p, face);
}
function playSetGun(i) {
  const list = PLAY_GUNS.map((g, k) => k).filter(k => PLAY.xr || !PLAY_GUNS[k].vrOnly);
  if (!list.includes(i)) return;
  PLAY.gun = i; PLAY.fireCd = 0; playHUD(true);
  if (PLAY.xr) playVRWeaponModels();
}
function playCycleGun(s) {
  const list = PLAY_GUNS.map((g, k) => k).filter(k => PLAY.xr || !PLAY_GUNS[k].vrOnly);
  const at = Math.max(0, list.indexOf(PLAY.gun));
  playSetGun(list[(at + s + list.length) % list.length]);
}
function playKey(e, down) {
  if (!PLAY.on) return;
  if (e.target && /INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return;
  if (/^F\d+$/.test(e.code) || e.ctrlKey) return; // browser keys (reload, dev tools) still work
  e.preventDefault(); e.stopPropagation();
  if (down) PLAY.keys.add(e.code); else PLAY.keys.delete(e.code);
  if (!down || e.repeat) return;
  const c = e.code;
  if (c === 'Tab' || c === 'KeyQ') { playToggleMenu(); return; }
  if (c === 'Escape') { if (PLAY.menuOpen && !PLAY.xr) playToggleMenu(false); return; }
  if (/^Digit[1-8]$/.test(c)) { const i = PLAY_GUNS.findIndex(g => g.key === c.slice(5)); if (i >= 0) playSetGun(i); return; }
  if (c === 'KeyE') { playSpawnAhead(); return; }
  if (c === 'KeyF') { PLAY.slow = !PLAY.slow; toast(PLAY.slow ? 'Slow motion on' : 'Slow motion off'); return; }
  if (c === 'KeyR') { playResetArena(); toast('Arena reset'); return; }
  if (c === 'KeyV') { enterPlay('vr'); return; }
}

/* ---------- DOM: HUD and the spawn menu (first person) ---------- */
function playBuildUI() {
  if (PLAY.ui) PLAY.ui.remove();
  const ui = el('div', { id: 'play-ui' });
  ui.innerHTML = `<div class="pl-cross"></div><div class="pl-hud" id="pl-hud"></div><div class="pl-hint" id="pl-hint"></div>
    <div class="pl-menu" id="pl-menu" hidden></div><div class="pl-vr" id="pl-vr" hidden><div><b>You're in VR</b><br>Put on the headset. Controllers: left X opens the spawn menu. Grip button or a closed fist grabs anything. Hands: turn your left palm toward you for the menu, poke it with your right index finger.<br><br><button class="btn" id="pl-vr-exit">Leave VR</button></div></div>`;
  R.vp.append(ui); PLAY.ui = ui;
  ui.querySelector('#pl-vr-exit').onclick = () => { if (PLAY.session) PLAY.session.end().catch(() => {}); };
  const cv = R.renderer.domElement;
  PLAY.onDown = (e) => {
    if (!PLAY.on || PLAY.xr || PLAY.menuOpen) return;
    if (e.target !== cv && !ui.contains(e.target)) return;
    if (!document.pointerLockElement) { const p = cv.requestPointerLock && cv.requestPointerLock(); if (p && p.catch) p.catch(() => { PLAY.locked = 'drag'; }); if (!cv.requestPointerLock) PLAY.locked = 'drag'; }
    if (e.button === 0) { PLAY.held = true; if (PLAY.locked === 'drag') PLAY.dragging = true; }
    if (e.button === 2) playSpawnAhead();
    if (e.button === 1) PLAY.mid = true;
    e.preventDefault();
  };
  PLAY.onUp = (e) => { if (e.button === 0) { PLAY.held = false; PLAY.dragging = false; } if (e.button === 1) PLAY.mid = false; };
  PLAY.onMove = (e) => {
    if (!PLAY.on || PLAY.xr) return;
    if (document.pointerLockElement === cv || (PLAY.locked === 'drag' && PLAY.dragging)) {
      PLAY.yaw -= e.movementX * 0.0022; PLAY.pitch = clamp(PLAY.pitch - e.movementY * 0.0022, -1.5, 1.5);
    }
  };
  PLAY.onWheel = (e) => { if (PLAY.on && !PLAY.xr && !PLAY.menuOpen) { playCycleGun(e.deltaY > 0 ? 1 : -1); e.preventDefault(); } };
  PLAY.onLock = () => {
    const locked = document.pointerLockElement === cv;
    if (locked) { PLAY.locked = true; playToggleMenu(false); }
    else if (PLAY.locked === true) { PLAY.locked = false; PLAY.held = false; if (PLAY.on && !PLAY.xr) playToggleMenu(true); }
  };
  if (!PLAY.listening) {
    PLAY.listening = true;
    window.addEventListener('mousedown', (e) => PLAY.onDown && PLAY.onDown(e), true);
    window.addEventListener('mouseup', (e) => PLAY.onUp && PLAY.onUp(e), true);
    window.addEventListener('mousemove', (e) => PLAY.onMove && PLAY.onMove(e), true);
    window.addEventListener('wheel', (e) => PLAY.onWheel && PLAY.onWheel(e), { capture: true, passive: false });
    window.addEventListener('contextmenu', (e) => { if (PLAY.on) e.preventDefault(); }, true);
    document.addEventListener('pointerlockchange', () => PLAY.onLock && PLAY.onLock());
    window.addEventListener('keydown', (e) => { if (PLAY.on) playKey(e, true); }, true);
    window.addEventListener('keyup', (e) => { if (PLAY.on) playKey(e, false); }, true);
    window.addEventListener('blur', () => { PLAY.keys.clear(); PLAY.held = false; });
  }
}
// one list of buttons for both menus (the DOM menu and the VR panel)
function playMenuModel() {
  const S = PLAY_SPAWNS.map((s, i) => ({ sec: 'Spawn (E / right click / left trigger)', label: s.label, on: PLAY.spawnSel === i, act: () => { PLAY.spawnSel = i; if (!PLAY.xr) { playToggleMenu(false); setTimeout(playSpawnAhead, 30); } } }));
  const G = PLAY_GUNS.map((g, i) => ({ sec: 'Weapons', label: (PLAY.xr ? '' : g.key + '  ') + g.label, on: PLAY.gun === i, hide: g.vrOnly && !PLAY.xr, act: () => playSetGun(i) })).filter(x => !x.hide);
  const O = [
    { sec: 'Options', label: 'Slow motion' + (PLAY.xr ? '' : ' (F)'), on: PLAY.slow, act: () => { PLAY.slow = !PLAY.slow; } },
    { sec: 'Options', label: 'Reset arena' + (PLAY.xr ? '' : ' (R)'), act: () => playResetArena() },
    { sec: 'Options', label: 'Detail: ' + (PLAY.detail >= 26 ? 'fast' : 'sharper') + ' (next reset)', act: () => { PLAY.detail = PLAY.detail >= 26 ? 20 : 26; PLAY.save(); } },
  ];
  if (PLAY.xr) O.push(
    { sec: 'Options', label: 'Seated mode', on: PLAY.seated, act: () => { PLAY.seated = !PLAY.seated; PLAY.save(); } },
    { sec: 'Options', label: 'View higher', act: () => { PLAY.seatH = Math.min(1.2, PLAY.seatH + 0.1); PLAY.save(); }, hide: !PLAY.seated },
    { sec: 'Options', label: 'View lower', act: () => { PLAY.seatH = Math.max(-0.3, PLAY.seatH - 0.1); PLAY.save(); }, hide: !PLAY.seated },
    { sec: 'Options', label: 'Leave VR', act: () => { if (PLAY.session) PLAY.session.end().catch(() => {}); } });
  else O.push({ sec: 'Options', label: 'Enter VR (V)', act: () => enterPlay('vr') }, { sec: 'Options', label: 'Back to the editor', act: () => exitPlay() });
  return S.concat(G, O.filter(x => !x.hide));
}
function playToggleMenu(force) {
  if (PLAY.xr) { if (PLAY.panel.parent === PLAY.dolly) playVRWeaponModels(); PLAY.handMenu = false; PLAY.panel.visible = force != null ? force : !PLAY.panel.visible; PLAY.menuOpen = PLAY.panel.visible; return; }
  const m = PLAY.ui && PLAY.ui.querySelector('#pl-menu'); if (!m) return;
  const open = force != null ? force : m.hidden;
  PLAY.menuOpen = open; m.hidden = !open;
  if (open) {
    if (document.pointerLockElement) { PLAY.locked = 'menu'; document.exitPointerLock(); }
    playFillMenu();
  }
}
function playFillMenu() {
  const m = PLAY.ui.querySelector('#pl-menu'); m.textContent = '';
  m.append(el('div', { class: 'pl-title' }, 'Sandbox'));
  let sec = null, grid = null;
  for (const it of playMenuModel()) {
    if (it.sec !== sec) { sec = it.sec; m.append(el('div', { class: 'pl-sec' }, sec)); grid = el('div', { class: 'pl-grid' }); m.append(grid); }
    const b = el('button', { class: 'pl-btn' + (it.on ? ' on' : '') }, it.label);
    b.onclick = (e) => { e.stopPropagation(); it.act(); if (PLAY.menuOpen) playFillMenu(); };
    grid.append(b);
  }
  const res = el('button', { class: 'pl-btn pl-go' }, 'Resume');
  res.onclick = (e) => { e.stopPropagation(); playToggleMenu(false); const cv = R.renderer.domElement; const p = cv.requestPointerLock && cv.requestPointerLock(); if (p && p.catch) p.catch(() => { PLAY.locked = 'drag'; }); };
  m.append(res);
  m.append(el('div', { class: 'pl-keys' }, 'WASD move · Shift run · Space jump · C crouch · Mouse shoot · Hold G or middle mouse to grab and carry · Wheel or 1-6 weapons · E spawn at crosshair · F slow motion · R reset · Tab menu · Esc pause'));
}
function playHUD(force) {
  if (!PLAY.ui) return;
  const h = PLAY.ui.querySelector('#pl-hud');
  const g = PLAY_GUNS[PLAY.gun], sp = PLAY_SPAWNS[PLAY.spawnSel];
  const bodies = SIM.layout ? SIM.layout.length : 0;
  h.textContent = `${g.label}   ·   Spawn: ${sp.label} (E)   ·   ${bodies} bodies · ${(SIM.N || 0).toLocaleString()} molecules · sim ${Math.round(Math.min(1, PLAY.rate) * 100 * (PLAY.slow ? 0.25 : 1))}% speed${PLAY.slow ? ' (slow-mo)' : ''}`;
  const hint = PLAY.ui.querySelector('#pl-hint');
  hint.textContent = !PLAY.ready ? 'Building the arena…' : (!PLAY.locked && !PLAY.menuOpen && !PLAY.xr) ? 'Click to play · Tab for the spawn menu' : '';
  PLAY.ui.querySelector('#pl-vr').hidden = !PLAY.xr;
}

/* ---------- VR ---------- */
// the session has to be asked for straight from the click (browsers need the user gesture), so a caller may pass one already requested
function playRequestXR() { return navigator.xr.requestSession('immersive-vr', { optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking'] }); }
async function startXR(pending) {
  if (PLAY.xr || !navigator.xr) return;
  let session;
  try {
    session = await (pending || playRequestXR());
  } catch (err) { playVRHelp('The headset refused the VR session: ' + (err && (err.name + ': ' + err.message))); return; }
  if (!PLAY.on) { session.end().catch(() => {}); return; }
  if (document.pointerLockElement) document.exitPointerLock();
  playToggleMenu(false);
  PLAY.session = session; PLAY.xr = true;
  if (PLAY_GUNS[PLAY.gun].vrOnly === undefined && PLAY.gun > 5) PLAY.gun = 0;
  const xr = R.renderer.xr;
  xr.enabled = true; xr.setReferenceSpaceType('local-floor');
  try { R.renderer.setPixelRatio(1); } catch (e) { /* keep */ }
  await xr.setSession(session);
  PLAY.gunModel.visible = false;
  playSetupHands();
  playVRWeaponModels();
  PLAY.dolly.position.set(PLAY.pos.x, 0, PLAY.pos.z); PLAY.dolly.rotation.set(0, PLAY.yaw, 0);
  R.renderer.setAnimationLoop((t, f) => { if (PLAY.on) playFrame(performance.now(), f); });
  session.addEventListener('end', () => {
    stopXRLoop();
    PLAY.session = null; PLAY.xr = false; PLAY.menuOpen = false;
    if (PLAY.on) { PLAY.gunModel.visible = true; if (PLAY_GUNS[PLAY.gun].vrOnly) PLAY.gun = 0; PLAY.pos.set(PLAY.dolly.position.x, 0, PLAY.dolly.position.z); toast('Left VR. Click to keep playing in first person.'); }
  });
  toast('VR started: put on your headset');
}
function stopXRLoop() {
  const xr = R.renderer.xr;
  R.renderer.setAnimationLoop(null);
  xr.enabled = false;
  if (PLAY.hands) for (const h of PLAY.hands) { h.ctrl.removeFromParent(); h.grip.removeFromParent(); }
  if (PLAY.xhands) for (const H of PLAY.xhands) H.hand.removeFromParent();
  if (PLAY.panel) PLAY.panel.visible = false;
  applyPixelRatio();
}
function playSetupHands() {
  const xr = R.renderer.xr;
  if (!PLAY.hands) {
    PLAY.hands = [0, 1].map(i => {
      const h = { i, ctrl: xr.getController(i), grip: xr.getControllerGrip(i), side: i ? 'right' : 'left', connected: false, prev: [] };
      h.ctrl.addEventListener('connected', (e) => { h.connected = true; h.src = e.data; h.side = e.data.handedness || h.side; playVRWeaponModels(); });
      h.ctrl.addEventListener('disconnected', () => { h.connected = false; h.src = null; });
      const ray = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, -1)]), new THREE.LineBasicMaterial({ color: '#7fd1ff', transparent: true, opacity: 0.7 }));
      ray.scale.z = 6; h.ray = ray; h.ctrl.add(ray);
      h.model = new THREE.Group(); h.grip.add(h.model);
      return h;
    });
    // the spawn menu: a canvas panel held in the left hand, pointed at with the right
    const cv = document.createElement('canvas'); cv.width = 1024; cv.height = 1024;
    PLAY.panelCv = cv; PLAY.panelTex = new THREE.CanvasTexture(cv); PLAY.panelTex.colorSpace = THREE.SRGBColorSpace;
    PLAY.panel = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.42), new THREE.MeshBasicMaterial({ map: PLAY.panelTex, transparent: true, depthTest: false }));
    PLAY.panel.renderOrder = 20; PLAY.panel.visible = false;
  }
  for (const h of PLAY.hands) PLAY.dolly.add(h.ctrl, h.grip);
  if (!PLAY.xhands) {
    PLAY.xhands = [0, 1].map(i => {
      const H = { hand: xr.getHand(i), side: i ? 'right' : 'left', connected: false, tracked: false, pinch: false };
      H.hand.addEventListener('connected', (e) => { H.connected = !!(e.data && e.data.hand); if (e.data && e.data.handedness) H.side = e.data.handedness; });
      H.hand.addEventListener('disconnected', () => { H.connected = false; H.tracked = false; });
      return H;
    });
  }
  for (const H of PLAY.xhands) PLAY.dolly.add(H.hand);
}
// hand-tracking joints that push and tear flesh: palm, knuckles and every finger (metres)
const PLAY_HAND_COLS = [['wrist', 0.035], ['middle-finger-metacarpal', 0.04], ['index-finger-metacarpal', 0.03], ['ring-finger-metacarpal', 0.03],
  ['thumb-phalanx-proximal', 0.018], ['thumb-phalanx-distal', 0.015], ['thumb-tip', 0.012]].concat(...['index', 'middle', 'ring', 'pinky'].map(f => [
  [f + '-finger-phalanx-proximal', 0.016], [f + '-finger-phalanx-intermediate', 0.014], [f + '-finger-tip', 0.012]]));
const _hA = new THREE.Vector3(), _hB = new THREE.Vector3(), _hC = new THREE.Vector3(), _hn = new THREE.Vector3();
function playJoint(H, name, out) { const j = H.hand.joints[name]; if (!j || !j.visible) return null; j.updateMatrixWorld(true); return out.setFromMatrixPosition(j.matrixWorld); }
// tracked hands: draw the joints, pinch to shoot (right) or spawn (left), turn the left palm toward you for the menu, poke it with the right index finger
function playHandInput(dt, xrCam) {
  let anyHand = false;
  for (const H of PLAY.xhands) {
    H.tracked = H.connected && !!H.hand.joints['wrist'] && H.hand.joints['wrist'].visible;
    if (!H.connected) continue;
    for (const name in H.hand.joints) {
      const j = H.hand.joints[name];
      if (!j.userData.vis) { const m = mkMesh(GEO.ball, PLAY.skinHandMat || (PLAY.skinHandMat = stdMat('#e0c2ad', 0.65, 0))); m.castShadow = false; j.add(m); j.userData.vis = m; }
      const r = Math.max(0.006, (j.jointRadius || 0.008)); j.userData.vis.scale.setScalar(r);
    }
    if (!H.tracked) { PLAY.grab.delete('h' + H.side); continue; }
    anyHand = true;
    const tt = playJoint(H, 'thumb-tip', _hA), it = playJoint(H, 'index-finger-tip', _hB);
    if (!tt || !it) continue;
    // a closed fist grabs: every fingertip curled in near the palm
    {
      const palm = playJoint(H, 'middle-finger-metacarpal', new THREE.Vector3());
      let sum = 0, n = 0;
      for (const f of ['index', 'middle', 'ring', 'pinky']) { const t = playJoint(H, f + '-finger-tip', _hC); if (t && palm) { sum += t.distanceTo(palm); n++; } }
      const avg = n ? sum / n : 1, fist = H.fist ? avg < 0.075 : avg < 0.055;
      H.fist = fist;
      if (fist && palm) {
        const wj = H.hand.joints['wrist']; wj.updateMatrixWorld(true); wj.matrixWorld.decompose(_cp, _cq, _cs);
        PLAY.grab.set('h' + H.side, { p: [palm.x, palm.y, palm.z], q: [_cq.x, _cq.y, _cq.z, _cq.w], r: 0.085 });
      } else PLAY.grab.delete('h' + H.side);
      if (fist) continue; // no pinching while the fist is closed
    }
    const d = tt.distanceTo(it), was = H.pinch;
    H.pinch = was ? d < 0.035 : d < 0.018;
    const pinched = H.pinch && !was;
    // pointing direction: from the wrist through the index knuckle
    const w = playJoint(H, 'wrist', new THREE.Vector3()), k = playJoint(H, 'index-finger-phalanx-proximal', new THREE.Vector3());
    if (!w || !k) continue;
    const dir = k.clone().sub(w).normalize(), origin = k.clone();
    if (H.side === 'left') {
      // palm normal: across the hand (index to pinky knuckles) crossed with wrist-to-middle-knuckle
      const ik = playJoint(H, 'index-finger-metacarpal', new THREE.Vector3()), pk = playJoint(H, 'pinky-finger-metacarpal', new THREE.Vector3()), mk = playJoint(H, 'middle-finger-metacarpal', new THREE.Vector3());
      if (ik && pk && mk) {
        _hn.subVectors(pk, ik).cross(_hC.subVectors(mk, w)).normalize();
        const head = new THREE.Vector3().setFromMatrixPosition(xrCam.matrixWorld), toHead = head.clone().sub(mk).normalize();
        const facing = _hn.dot(toHead);
        const show = PLAY.handMenu ? facing > 0.35 : facing > 0.65;
        PLAY.handMenu = show;
        if (show) {
          if (PLAY.panel.parent !== PLAY.dolly) PLAY.dolly.add(PLAY.panel);
          PLAY.panel.visible = true; PLAY.menuOpen = true;
          const pw = mk.clone().addScaledVector(toHead, 0.06).add(new THREE.Vector3(0, 0.2, 0));
          PLAY.dolly.worldToLocal(pw); PLAY.panel.position.copy(pw);
          PLAY.panel.lookAt(head); PLAY.panel.quaternion.premultiply(PLAY.dolly.getWorldQuaternion(new THREE.Quaternion()).invert());
          PLAY.panel.updateMatrixWorld(true);
        } else if (PLAY.panel.parent === PLAY.dolly) { PLAY.panel.visible = false; PLAY.menuOpen = false; }
      }
      if (pinched && !PLAY.handMenu) playSpawn(PLAY.spawnSel, playFloorPoint(origin, dir, 15), Math.atan2(-dir.x, -dir.z));
    } else {
      // poke the menu with the right index fingertip
      PLAY.pokeCd = Math.max(0, (PLAY.pokeCd || 0) - dt);
      if (PLAY.handMenu && PLAY.panel.visible) {
        const local = PLAY.panel.worldToLocal(it.clone());
        PLAY.panelHover = null;
        if (Math.abs(local.x) < 0.21 && Math.abs(local.y) < 0.21 && local.z < 0.05 && local.z > -0.04) {
          const px = (local.x / 0.42 + 0.5) * 1024, py = (0.5 - local.y / 0.42) * 1024;
          const b = (PLAY.panelBtns || []).find(b => !b.head && px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h);
          if (b) { PLAY.panelHover = b.it.label; if (local.z < 0.012 && PLAY.pokeCd <= 0) { b.it.act(); PLAY.pokeCd = 0.6; playDrawPanel(); } }
        }
      } else {
        const g = PLAY_GUNS[PLAY.gun];
        if (!g.vrOnly && H.pinch && PLAY.fireCd <= 0 && (g.auto || pinched)) { playFire(origin, dir); PLAY.fireCd = g.rate ? 1 / g.rate : 0.15; }
      }
    }
  }
  if (!anyHand && PLAY.handMenu) { PLAY.handMenu = false; if (PLAY.panel.parent === PLAY.dolly) { PLAY.panel.visible = false; PLAY.menuOpen = false; } }
  return anyHand;
}
function playVRWeaponModels() {
  if (!PLAY.hands) return;
  for (const h of PLAY.hands) {
    h.model.clear();
    if (h.side === 'right') {
      const id = PLAY_GUNS[PLAY.gun].id;
      if (id === 'sword') h.model.add(playSword());
      else if (id === 'fists') h.model.add(playFist('#d9b8a0'));
      else { const g = playGunMesh(); g.rotation.x = -0.15; h.model.add(g); }
    } else {
      h.model.add(playFist('#d9b8a0'));
      if (PLAY.panel && !PLAY.handMenu) { h.grip.add(PLAY.panel); PLAY.panel.position.set(0.03, 0.12, -0.12); PLAY.panel.rotation.set(-0.7, 0, 0); }
    }
  }
}
function playPanelButtons() {
  // layout: a grid of buttons, laid out once per draw and hit-tested in the same coordinates
  const items = playMenuModel(), out = []; let y = 92, sec = null, col = 0;
  for (const it of items) {
    if (it.sec !== sec) { if (col) y += 78; sec = it.sec; out.push({ head: sec.replace(/ \(.*\)$/, ''), y }); y += 44; col = 0; }
    out.push({ it, x: 24 + col * 330, y, w: 316, h: 66 });
    col++; if (col === 3) { col = 0; y += 78; }
  }
  return out;
}
function playDrawPanel() {
  const c = PLAY.panelCv.getContext('2d'); c.clearRect(0, 0, 1024, 1024);
  c.fillStyle = 'rgba(16,18,24,0.92)'; c.beginPath(); c.roundRect(0, 0, 1024, 1024, 36); c.fill();
  c.fillStyle = '#fff'; c.font = '600 46px system-ui, sans-serif'; c.fillText('Shatterbond sandbox', 28, 62);
  PLAY.panelBtns = playPanelButtons();
  for (const b of PLAY.panelBtns) {
    if (b.head) { c.fillStyle = '#8f96a3'; c.font = '500 30px system-ui, sans-serif'; c.fillText(b.head, 28, b.y + 30); continue; }
    const hot = PLAY.panelHover === b.it.label;
    c.fillStyle = b.it.on ? '#2d6cdf' : hot ? '#3a3f4c' : '#262a33'; c.beginPath(); c.roundRect(b.x, b.y, b.w, b.h, 14); c.fill();
    c.fillStyle = '#f2f4f7'; c.font = '500 30px system-ui, sans-serif'; c.fillText(b.it.label.slice(0, 22), b.x + 18, b.y + 43);
  }
  c.fillStyle = '#8f96a3'; c.font = '26px system-ui, sans-serif';
  c.fillText('Grip / fist: grab · Right trigger: pick · Left trigger: spawn · A/B: weapon', 28, 990);
  PLAY.panelTex.needsUpdate = true;
}
const _vrO = new THREE.Vector3(), _vrD = new THREE.Vector3(), _vrQ = new THREE.Quaternion();
function playXRInput(dt) {
  if (!PLAY.hands) return;
  const xrCam = R.renderer.xr.getCamera();
  // seated: lift the whole play space so a seated player sees from standing height
  PLAY.dolly.position.y = PLAY.seated ? PLAY.seatH : 0;
  PLAY.fireCd -= dt;
  if (PLAY.xhands) playHandInput(dt, xrCam);
  for (const h of PLAY.hands) {
    h.model.visible = !(h.src && h.src.hand);
    const gp = h.src && h.src.gamepad; if (!gp || h.src.hand) { if (h.src && h.src.hand) h.ray.visible = false; continue; }
    const btn = (i) => !!(gp.buttons[i] && gp.buttons[i].pressed), edge = (i) => btn(i) && !h.prev[i];
    const ax = gp.axes.length >= 4 ? [gp.axes[2], gp.axes[3]] : [gp.axes[0] || 0, gp.axes[1] || 0];
    // squeeze: grab whatever is in the hand
    if (btn(1)) {
      h.grip.updateMatrixWorld(true); h.grip.matrixWorld.decompose(_cp, _cq, _cs);
      const c = new THREE.Vector3(0, 0, -0.04).applyQuaternion(_cq).add(_cp);
      PLAY.grab.set('c' + h.side, { p: [c.x, c.y, c.z], q: [_cq.x, _cq.y, _cq.z, _cq.w], r: 0.09 });
    } else PLAY.grab.delete('c' + h.side);
    h.ctrl.updateMatrixWorld(true);
    _vrO.setFromMatrixPosition(h.ctrl.matrixWorld); _vrD.set(0, 0, -1).applyQuaternion(h.ctrl.getWorldQuaternion(_vrQ));
    if (h.side === 'left') {
      // smooth locomotion, relative to where the head looks
      if (Math.hypot(ax[0], ax[1]) > 0.15) {
        xrCam.getWorldDirection(_fw); _fw.y = 0; _fw.normalize(); _rt.set(-_fw.z, 0, _fw.x);
        PLAY.dolly.position.addScaledVector(_fw, -ax[1] * 2.6 * dt).addScaledVector(_rt, ax[0] * 2.6 * dt);
      }
      if (edge(4) || edge(5) || edge(12)) playToggleMenu(); // X (or Y / menu) opens the spawn menu
      if (edge(0) && !PLAY.menuOpen) playSpawn(PLAY.spawnSel, playFloorPoint(_vrO, _vrD, 15), Math.atan2(_vrO.x - (_vrO.x + _vrD.x), _vrO.z - (_vrO.z + _vrD.z)));
      h.ray.visible = !PLAY.menuOpen;
    } else {
      // snap turn around the head
      if (Math.abs(ax[0]) > 0.7 && !h.turned) {
        h.turned = true;
        const head = new THREE.Vector3().setFromMatrixPosition(xrCam.matrixWorld);
        const a = -Math.sign(ax[0]) * Math.PI / 6;
        PLAY.dolly.position.sub(head).applyAxisAngle(_pUp, a).add(head); PLAY.dolly.rotation.y += a;
      } else if (Math.abs(ax[0]) < 0.3) h.turned = false;
      if (edge(4)) playCycleGun(1);
      if (edge(5)) playCycleGun(-1);
      if (edge(3)) PLAY.slow = !PLAY.slow;
      // menu pointing
      PLAY.panelHover = null;
      if (PLAY.menuOpen && PLAY.panel.visible) {
        _pr.set(_vrO, _vrD); const hit = _pr.intersectObject(PLAY.panel, false)[0];
        if (hit && hit.uv) {
          const px = hit.uv.x * 1024, py = (1 - hit.uv.y) * 1024;
          const b = (PLAY.panelBtns || []).find(b => !b.head && px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h);
          if (b) { PLAY.panelHover = b.it.label; if (edge(0)) { b.it.act(); playDrawPanel(); } }
          h.ray.scale.z = hit.distance;
        } else h.ray.scale.z = 6;
        h.ray.visible = true;
      } else {
        h.ray.visible = false;
        const g = PLAY_GUNS[PLAY.gun];
        if (!g.vrOnly && btn(0) && PLAY.fireCd <= 0 && (g.auto || !h.prev[0])) {
          playFire(_vrO, _vrD.clone()); PLAY.fireCd = g.rate ? 1 / g.rate : 0.12;
          if (h.src.gamepad.hapticActuators && h.src.gamepad.hapticActuators[0]) h.src.gamepad.hapticActuators[0].pulse(0.6, 40).catch(() => {});
        }
      }
    }
    h.prev = gp.buttons.map(b => b.pressed);
  }
}

/* ---------- when VR does not start: say exactly why, and offer the Chrome window ---------- */
function playVRHelp(reason) {
  console.warn('VR:', reason);
  const old = document.getElementById('vr-help'); if (old) old.remove();
  const box = el('div', { id: 'vr-help', class: 'modal-bg' });
  const card = el('div', { class: 'modal', style: { maxWidth: '560px' } });
  card.innerHTML = `<div class="modal-h"><h2>VR didn't start</h2></div><div class="modal-b"><p><b>Why:</b> <span id="vr-why"></span></p>
    <p>Check that the headset is in Quest Link or Air Link (the Link home) before you press VR.</p>
    <p>If Link is running and this still appears, open VR in a Chrome window. Chrome's VR support works with Link.</p>
    <p style="color:var(--fg3);font-size:11.5px">Browser: <span id="vr-ua"></span> · WebXR: ${navigator.xr ? 'yes' : 'no'} · secure: ${window.isSecureContext ? 'yes' : 'no'} · in frame: ${window.top !== window ? 'yes' : 'no'}</p></div>
    <div class="modal-f"><button class="btn" id="vr-close">Close</button><button class="btn" id="vr-retry">Try again</button><button class="btn primary" id="vr-chrome">Open VR in Chrome</button></div>`;
  box.append(card); document.body.append(box);
  card.querySelector('#vr-why').textContent = reason;
  card.querySelector('#vr-ua').textContent = (navigator.userAgentData && navigator.userAgentData.brands ? navigator.userAgentData.brands.map(b => b.brand + ' ' + b.version).filter(t => !/Not/.test(t)).join(', ') : navigator.userAgent).slice(0, 120);
  const close = () => box.remove();
  card.querySelector('#vr-close').onclick = close;
  card.querySelector('#vr-retry').onclick = () => { close(); enterPlay('vr'); };
  card.querySelector('#vr-chrome').onclick = async () => {
    try {
      const r = await fetch('/__openvr', { method: 'POST' });
      if (!r.ok) throw new Error(await r.text());
      close(); toast('Opening a Chrome window for VR. Press "Enter VR" in it.');
    } catch (e) { toast('Could not open Chrome from here. With Shatterbond.exe running, paste http://127.0.0.1:47231/?vr=1 into Chrome.', true); }
  };
}
// the VR window opened by the desktop app (?vr=1): straight into the arena with one big button (VR needs a click to start)
function playVRBoot() {
  if (!/[?&]vr=1/.test(location.search)) return;
  setTimeout(() => {
    enterPlay('fps').then(() => {});
    const b = el('button', { class: 'btn primary', style: { position: 'fixed', left: '50%', top: '40%', transform: 'translate(-50%,-50%)', zIndex: 96, fontSize: '22px', height: 'auto', padding: '18px 34px' } }, 'Enter VR');
    b.onclick = (e) => { e.stopPropagation(); b.remove(); enterPlay('vr'); };
    document.body.append(b);
  }, 600);
}
