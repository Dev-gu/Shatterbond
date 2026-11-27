/* cache memory: saved per browser; the default scales with the computer's memory (browsers report at most 8 GB) */
function cacheBudgetDefault() {
  try { const v = +localStorage.getItem('shatterbond.cacheMB'); if (v > 0) return v * 1048576; } catch (e) { /* storage unavailable */ }
  const dm = navigator.deviceMemory || 8;
  return (dm >= 8 ? 3072 : dm >= 4 ? 1536 : 768) * 1048576;
}
function cacheCompactDefault() { try { return localStorage.getItem('shatterbond.cacheCompact') !== '0'; } catch (e) { return true; } }
/* ===================== scene model, views, evaluation, simulation ===================== */
const APP = {
  scene: null, views: new Map(), sel: [], active: null,
  frame: 0, playing: false, loop: true, autokey: false, tool: 'move', camView: false, renderMode: false,
  worldP: null, undo: [], redo: [], dirtyEval: true, lastEvalFrame: -1, stats: {},
};
// looks only: changing these must not throw away the simulated frames
const VISUAL_KEY = /(^|[a-z])(color|Color)$|^(roughness|metalness|opacity|emissive|label)$/;
function simKey(obj, key) { return obj.type === 'camera' ? false : obj.type === 'world' ? SIM_FIELDS.has(key) : !VISUAL_KEY.test(key); }
const SIM_FIELDS = new Set(['frameStart', 'fps', 'timeScale', 'gravity', 'substeps', 'floor', 'floorFriction', 'airDrag']);

function newScene(name) {
  return { name: name || 'Untitled scene', tissues: {}, events: [], clips: {}, world: { id: 'world', type: 'world', name: 'World', props: WORLD_DEFAULTS(), anim: {} }, objects: [] };
}
function allObjs() { return APP.scene.objects; }
function objById(id) { return id === 'world' ? APP.scene.world : APP.scene.objects.find(o => o.id === id); }
function uniqueName(base) {
  const names = new Set(allObjs().map(o => o.name));
  if (!names.has(base)) return base;
  for (let i = 1; ; i++) { const n = `${base}.${String(i).padStart(3, '0')}`; if (!names.has(n)) return n; }
}
/* ---------- your own defaults for every new humanoid (colors, body, physics) ---------- */
const HDEF = { KEY: 'shatterbond.humanDefaults', SKIP: new Set(['position', 'rotation', 'velocity', 'release', 'visible', 'animation', 'animSpeed']), props: null, demos: false,
  load() { try { const v = JSON.parse(localStorage.getItem(this.KEY) || 'null'); if (v && v.props) { this.props = v.props; this.demos = !!v.demos; } } catch (e) { /* storage unavailable */ } },
  save() { try { localStorage.setItem(this.KEY, JSON.stringify({ props: this.props, demos: this.demos })); return true; } catch (e) { return false; } },
  // only the look and physics settings, never where a body stands or its keyframes
  pick(P) { const o = {}; const D = TYPES.humanoid.defaults(); for (const k in D) if (!this.SKIP.has(k) && P[k] !== undefined) o[k] = deepClone(P[k]); return o; },
  apply(base, props, fromDemo) {
    if (!this.props) return Object.assign(base, props || {});
    if (fromDemo && this.demos) { // a demo keeps how its bodies are posed, everything else becomes yours
      const u = deepClone(this.props); for (const k of ['pose', 'stand', 'sleep', 'bodyType', 'height', 'fat', 'build', 'react', 'animation']) if (props && props[k] !== undefined) delete u[k];
      return Object.assign(base, props || {}, u);
    }
    return Object.assign(base, deepClone(this.props), props || {});
  },
};
HDEF.load();
function makeObj(type, props, name, fromDemo) {
  const T = TYPES[type];
  const P = type === 'humanoid' ? HDEF.apply(T.defaults(), props, fromDemo) : Object.assign(T.defaults(), props || {});
  return { id: newId(), type, name: uniqueName(name || T.label), props: P, anim: {} };
}
function createView(obj) {
  const view = { obj, root: new THREE.Group(), world: R.world, editor: true, pick: [] };
  view.root.userData.objId = obj.id;
  R.world.add(view.root);
  TYPES[obj.type].build(view);
  for (const m of view.pick) m.userData.objId = obj.id;
  APP.views.set(obj.id, view);
  return view;
}
function destroyView(id) {
  const v = APP.views.get(id); if (!v) return;
  const T = TYPES[v.obj.type]; if (T.dispose) T.dispose(v);
  v.root.removeFromParent();
  if (v.proxy) v.proxy.geometry.dispose();
  APP.views.delete(id);
}
function rebuildViews() {
  for (const id of [...APP.views.keys()]) destroyView(id);
  for (const o of allObjs()) createView(o);
}

/* ---------- time ---------- */
const TIME = { table: null, key: '' };
function fpsOf() { return +(APP.scene.world.props.fps) || 60; }
function rebuildTimeTable() {
  const W = APP.scene.world, fps = fpsOf();
  const s = W.props.frameStart, e = Math.max(W.props.frameEnd, s + 1) + 2;
  const tab = new Float64Array(e - s + 2);
  let t = 0;
  for (let f = s; f <= e + 1; f++) {
    tab[f - s] = t;
    const ts = isAnimated(W, 'timeScale') ? evalChannel(W.anim.timeScale, f) : W.props.timeScale;
    t += Math.max(0.001, ts) / fps;
  }
  TIME.table = tab; TIME.start = s; TIME.fps = fps;
}
function timeOf(f) {
  const tab = TIME.table, s = TIME.start;
  if (!tab) return f / 60;
  const k = f - s;
  if (k <= 0) return k / TIME.fps;
  if (k >= tab.length - 1) return tab[tab.length - 1] + (k - tab.length + 1) / TIME.fps;
  const i = Math.floor(k), fr = k - i;
  return tab[i] + (tab[i + 1] - tab[i]) * fr;
}
function ctxAt(frame) {
  const W = APP.worldP || APP.scene.world.props;
  return { frame, t: timeOf(frame), timeOf, g: isAnimated(APP.scene.world, 'gravity') ? evalChannel(APP.scene.world.anim.gravity, frame) : W.gravity };
}

/* ---------- evaluation ---------- */
function evaluateScene(frame, forSim) {
  const W = APP.scene.world;
  const WP = evalProps(W, frame);
  if (!forSim) { APP.worldP = WP; APP.evalF = frame; }
  const ctx = ctxAt(frame);
  ctx.dyn = forSim ? null : SIM.ballsFor(frame);
  for (const o of allObjs()) {
    const v = APP.views.get(o.id); if (!v) continue;
    const P = evalProps(o, frame);
    if (!forSim) o._eval = P; else o._simP = P;
    v.editor = !APP.renderMode && !(APP.camView && o.type === 'camera');
    v.root.visible = P.visible !== false;
    TYPES[o.type].apply(v, P, ctx);
    if (v.proxy) v.proxy.visible = false;
  }
  R.world.updateMatrixWorld(true);
  return WP;
}
const _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _w = new THREE.Vector3();
function extractColliders() {
  const out = [];
  for (const o of allObjs()) {
    const v = APP.views.get(o.id); if (!v) continue;
    const P = o._simP || o.props;
    if (P.visible === false) continue;
    const visit = (m) => {
      const c = m.userData.collider; if (!c || c.off) return;
      if (m.visible === false && !(m.type === 'Object3D')) return;
      m.matrixWorld.decompose(_p, _q, _s);
      const b = c.base;
      let dims, bound;
      switch (c.shape) {
        case 'box': dims = [b[0] * _s.x, b[1] * _s.y, b[2] * _s.z]; bound = Math.hypot(dims[0], dims[1], dims[2]); break;
        case 'sphere': dims = [b[0] * _s.x, b[1] * _s.y, b[2] * _s.z]; bound = Math.max(...dims); break;
        case 'cylinder': case 'cone': dims = [b[0] * _s.x, b[1] * _s.y, b[2] * _s.z]; bound = Math.hypot(Math.max(dims[0], dims[2]), dims[1]); break;
        case 'torus': dims = [b[0] * _s.x, b[1] * _s.x, 0]; bound = dims[0] + dims[1]; break;
        case 'capsule': dims = [b[0] * _s.x, b[1] * _s.y, 0]; bound = dims[0] + dims[1]; break;
      }
      let spin = null;
      if (c.spinLocal) { _w.set(c.spinLocal[0], c.spinLocal[1], c.spinLocal[2]).applyQuaternion(_q); spin = [_w.x, _w.y, _w.z]; }
      const shatterMul = c.blunt ? 1 : (TYPES[o.type].cat === 'weapon' || P.power != null) ? 1 / Math.max(0.05, P.power || 1) : 1; // frames, walls and base plates of a sharp weapon are blunt: lying on them must not slice the body
      out.push({ key: o.id + ':' + c.key, shape: c.shape, dims, p: [_p.x, _p.y, _p.z], q: [_q.x, _q.y, _q.z, _q.w], bound, friction: c.friction != null ? c.friction : 0.5, spin, shatterMul });
    };
    v.root.traverse(visit);
    if (v.ballGroup) v.ballGroup.traverse(visit); // projectiles live in world space, outside the object's root
  }
  return out;
}

/* ---------- undo ---------- */
function snapshot() { return JSON.stringify({ name: APP.scene.name, tissues: APP.scene.tissues || {}, events: APP.scene.events || [], clips: APP.scene.clips || {}, world: APP.scene.world, objects: APP.scene.objects.map(o => ({ id: o.id, type: o.type, name: o.name, props: o.props, anim: o.anim })) }); }
function pushUndo() { APP.undo.push(snapshot()); if (APP.undo.length > 80) APP.undo.shift(); APP.redo.length = 0; }
function restore(json) {
  const d = JSON.parse(json);
  APP.scene = { name: d.name, world: d.world, objects: d.objects, tissues: d.tissues || {}, events: d.events || [], clips: d.clips || {} };
  if (TL.sel) TL.sel.clear();
  APP.blastSel = null;
  rebuildViews();
  APP.sel = APP.sel.filter(id => objById(id)); APP.active = APP.sel[APP.sel.length - 1] || null;
  rebuildTimeTable(); SIM.invalidate(); UI.refreshAll();
}
function doUndo() { if (!APP.undo.length) return toast('Nothing to undo'); APP.redo.push(snapshot()); restore(APP.undo.pop()); toast('Undo'); }
function doRedo() { if (!APP.redo.length) return toast('Nothing to redo'); APP.undo.push(snapshot()); restore(APP.redo.pop()); toast('Redo'); }

/* ---------- editing API ---------- */
function changed(obj, simRelevant = true) {
  APP.dirtyEval = true; APP.editGen = (APP.editGen || 0) + 1;
  if (obj && obj.type === 'world') rebuildTimeTable();
  if (simRelevant) SIM.invalidate();
}
function setProp(obj, key, val, idx, opts = {}) {
  const path = idx != null && idx >= 0 ? `${key}.${idx}` : key;
  const fd = fieldOf(obj, key);
  const canAnim = fd ? fd.anim : true;
  const f = APP.frame;
  // re-entering the same value (focus/blur, a slider released where it started) changes nothing
  if (!isAnimated(obj, path) && !APP.autokey && JSON.stringify(getPath(obj.props, path)) === JSON.stringify(val)) return;
  if (canAnim && (isAnimated(obj, path) || APP.autokey)) insertKey(obj, path, f, val);
  if (!isAnimated(obj, path)) setPath(obj.props, path, val);
  const sim = simKey(obj, key);
  changed(obj, sim);
  if (!opts.silent) UI.onPropChanged(obj, key);
}
function addObject(type, props, name) {
  pushUndo();
  const o = makeObj(type, props, name);
  APP.scene.objects.push(o);
  createView(o);
  select([o.id]);
  changed(o, o.type !== 'camera');
  UI.refreshAll();
  return o;
}
function deleteSelected() {
  const ids = APP.sel.slice();
  if (!ids.length) { if (APP.blastSel != null) deleteBlast(APP.blastSel); return; }
  pushUndo();
  APP.scene.objects = APP.scene.objects.filter(o => !ids.includes(o.id));
  ids.forEach(destroyView);
  APP.sel = []; APP.active = null;
  changed(null); UI.refreshAll(); toast(`Deleted ${ids.length} object${ids.length > 1 ? 's' : ''}`);
}
function duplicateSelected() {
  const ids = APP.sel.slice(); if (!ids.length) return;
  pushUndo();
  const fresh = [];
  for (const id of ids) {
    const o = objById(id); if (!o || o.type === 'world') continue;
    const c = { id: newId(), type: o.type, name: uniqueName(o.name.replace(/\.\d{3}$/, '')), props: deepClone(o.props), anim: deepClone(o.anim || {}) };
    if (c.props.position) c.props.position[0] += 1;
    APP.scene.objects.push(c); createView(c); fresh.push(c.id);
  }
  select(fresh); changed(null); UI.refreshAll();
}
// interactive blasts (made with the Blast tool) live in scene.events; each one can be picked and deleted on its own
function deleteBlast(i) {
  const evs = APP.scene.events || []; if (!(i >= 0 && i < evs.length)) return;
  pushUndo();
  const ev = evs.splice(i, 1)[0]; APP.blastSel = null;
  SIM.invalidate(); TL.dirty = true; APP.dirtyEval = true; UI.refreshAll();
  toast(`Deleted the blast at frame ${ev.f}`);
}
function selectBlast(i) {
  APP.sel = []; APP.active = null; APP.blastSel = i;
  UI.onSelection(); TL.dirty = true;
}
function select(ids, additive) {
  if (ids.length || !additive) APP.blastSel = null;
  if (additive) { for (const id of ids) { const i = APP.sel.indexOf(id); if (i >= 0) APP.sel.splice(i, 1); else APP.sel.push(id); } }
  else APP.sel = ids.slice();
  APP.active = APP.sel.length ? APP.sel[APP.sel.length - 1] : null;
  UI.onSelection();
}

/* ---------- simulation controller ---------- */
const BUILD_CACHE = new Map();
const SIM = {
  worker: null, local: null, busy: false, msgId: 1, waiters: new Map(),
  layout: [], fractures: [], fracSeen: new Set(), ready: false, building: false, token: 0,
  cache: { start: 0, end: -1, pos: [], st: [], bytes: 0, full: false },
  live: null, liveSt: null, prevCols: new Map(), target: -1, ms: 0, broken: 0, awake: 0,
  disp: null, dispSt: null, budget: cacheBudgetDefault(), compact: cacheCompactDefault(),
  init() {
    try {
      const src = document.getElementById('engine-src').textContent;
      const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
      this.worker = new Worker(url);
      this.worker.onmessage = (e) => this.onMsg(e.data);
      this.worker.onerror = (e) => { console.warn('worker error, falling back', e.message); this.fallback(); };
    } catch (err) { console.warn('worker unavailable, using main thread', err); this.fallback(); }
  },
  fallback() {
    if (this.local) return;
    this.worker = null; this.local = new window.ShatterEngine();
    for (const [id, w] of this.waiters) { w.reject(new Error('worker failed')); }
    this.waiters.clear(); this.busy = false; this.ready = false; this.invalidate();
  },
  call(type, payload, transfer) {
    const id = this.msgId++;
    return new Promise((resolve, reject) => {
      if (this.worker) {
        this.waiters.set(id, { resolve, reject });
        this.worker.postMessage(Object.assign({ type, id }, payload), transfer || []);
      } else {
        setTimeout(() => {
          try {
            if (type === 'buildShape') resolve({ out: BLD.buildBody(payload.desc) });
            else if (type === 'build') { const info = this.local.build(payload.data); resolve({ info }); }
            else if (type === 'step') {
              const stats = this.local.step(payload.input);
              resolve({ stats, pos: (this.local.outX || this.local.x).slice(), st: this.local.state.slice() });
            }
          } catch (err) { reject(err); }
        }, 0);
      }
    });
  },
  onMsg(m) {
    const w = this.waiters.get(m.id); if (!w) return;
    this.waiters.delete(m.id);
    if (m.type === 'error') { console.error(m.message); w.reject(new Error(m.message)); }
    else w.resolve(m);
  },
  // bone fractures reported by the engine: remember them for the timeline and tell the user once per bone
  onEvents(f, evs) {
    const layout = this.layout || [];
    for (const ev of evs) {
      if (ev.type !== 'fracture') continue;
      const L = layout[ev.body], o = L && L.obj, key = ev.body + ':' + ev.seg;
      const name = (o && o.name ? o.name + ': ' : '') + boneName(ev.seg, o);
      this.fractures.push({ f, body: ev.body, seg: ev.seg, p: ev.p, name });
      if (!this.fracSeen.has(key)) {
        this.fracSeen.add(key);
        if (!APP.recording && this.fracSeen.size <= 6) toast(name + ' fractured');
      }
    }
    if (UI.timeline) UI.timeline.dirty = true;
  },
  invalidate() {
    this.fractures = []; this.fracSeen = new Set();
    this.token++; this._fullTold = false; this._prevEnc = null; this._posMemo = null;
    this.ready = false; this.building = false; this.busy = false; this.inflight = 0; this.nextF = 0;
    this.cache = { start: APP.scene ? APP.scene.world.props.frameStart : 0, end: -1, pos: [], st: [], bytes: 0, full: false };
    this.live = null; this.prevCols.clear(); this.target = -1;
    this.layoutDirty = true;
    APP.dirtyEval = true;
    this.lastChange = performance.now();
    if (UI.timeline) UI.timeline.dirty = true;
  },
  // anything to simulate: molecular bodies, or real physics balls from cannons and emitters
  active() { return this.bodyObjs().length > 0 || allObjs().some(o => (o.type === 'emitter' || (o.type === 'cannon' && o.props.dynamic !== false)) && o.props.visible !== false); },
  killsFor(f) {
    const ctx = ctxAt(f), prev = ctxAt(f - 1), out = [];
    for (const o of allObjs()) {
      const T = TYPES[o.type]; if (!T.kills) continue;
      const v = APP.views.get(o.id), P = o._simP || evalProps(o, f); if (!v) continue;
      out.push(...T.kills(v, P, ctx, prev, o));
    }
    return out;
  },
  bodyObjs() { return allObjs().filter(o => (o.type === 'humanoid' || (TYPES[o.type].cat === 'mesh' && o.props.physics === 'molecular'))); },
  shapeDesc(o, P) {
    const res = resSpacing(P);
    const tt = tissueTable();
    const tissues = tt ? tt.map(t => { const c = Object.assign({}, t); delete c.color; delete c.name; return c; }) : undefined;
    if (o.type === 'humanoid') {
      const bt = P.bodyType || 'adult', quad = bt === 'dog' || bt === 'horse';
      // a horse is far bigger than a person: coarser molecules keep it to a similar count
      const sp = bt === 'horse' ? +(res * 2.2).toFixed(4) : res;
      if (quad) return { type: 'humanoid', species: bt, spacing: sp, height: P.height, fat: P.fat, seed: P.seed | 0, jointStrength: P.jointStrength, tissues };
      // an animated body is built with its arms and legs a little apart, so limbs are not fused to the torso
      const animd = RIG.isAnimated(P) || !!(o.anim && o.anim.animation && o.anim.animation.some(k => k.v && k.v !== 'none'));
      return { type: 'humanoid', model: P.model === 'sculpt' ? 'sculpt' : 'anatomical', spacing: res, pose: animd ? RIG.restFor(o) : P.pose, height: P.height, build: P.build, fat: P.fat, seed: P.seed | 0, jointStrength: P.jointStrength, headScale: bt === 'child' ? 1.2 : undefined, tissues };
    }
    const base = o.type === 'plane' ? [1, 0.02, 1] : [1, 1, 1];
    const size = [0, 1, 2].map(i => Math.max(0.02, Math.abs(P.scale[i]) * base[i]));
    const maxN = { low: 3000, medium: 8000, high: 16000, ultra: 32000, extreme: 64000, cinematic: 120000, custom: Math.round(8000 * Math.pow(0.0145 / res, 3)) }[P.resolution] || 8000;
    const vol = size[0] * size[1] * size[2] * (o.type === 'sphere' ? 0.52 : o.type === 'cylinder' ? 0.785 : o.type === 'cone' ? 0.26 : o.type === 'torus' ? 0.5 : 1);
    const sp = Math.max(res * PROP_RES_SCALE, Math.cbrt(vol / maxN));
    return { type: o.type, size: size.map(v => +v.toFixed(3)), spacing: +sp.toFixed(4), material: +P.material, tissues };
  },
  // cheap check: does the current layout still describe the scene's bodies?
  layoutSig() {
    const start = APP.scene.world.props.frameStart;
    return this.bodyObjs().map(o => o.id + '|' + JSON.stringify(this.shapeDesc(o, evalProps(o, start)))).join('\n');
  },
  // keep the displayed layout in sync; rebuilds only when shapes really changed
  syncLayout() {
    if (!this.layoutDirty || this.layoutBusy || this.layoutQueued) return;
    const sig = this.layoutSig();
    if (sig === this.layoutSigCur) {
      const objs = this.bodyObjs();
      this.layout.forEach((L, i) => { L.obj = objs[i]; });
      MOL.bodies.forEach((b, i) => { b.obj = objs[i]; });
      this.layoutDirty = false; MOL.applyStyle(); APP.dirtyEval = true;
      return;
    }
    if (performance.now() - (this.lastChange || 0) < 220) return; // let edits settle before rebuilding
    this.layoutQueued = true;
    this.ensureLayout().catch(err => { console.error(err); toast('Could not build bodies: ' + err.message, true); }).finally(() => { this.layoutQueued = false; });
  },
  async ensureLayout() {
    while (this.layoutBusy) { try { await this.layoutBusy; } catch (e) { /* the first caller reports it */ } }
    if (!this.layoutDirty && this.layout) return this.layout;
    this.layoutBusy = this._ensureLayout();
    try { return await this.layoutBusy; } finally { this.layoutBusy = null; }
  },
  async _ensureLayout() {
    const token = this.token;
    const objs = this.bodyObjs();
    const start = APP.scene.world.props.frameStart;
    const layout = [];
    let N = 0, needBuild = false;
    try {
    for (const o of objs) {
      const P = evalProps(o, start);
      const desc = this.shapeDesc(o, P);
      const key = JSON.stringify(desc);
      let data = BUILD_CACHE.get(key);
      if (!data) {
        needBuild = true;
        UI.busy(`Building ${o.type === 'humanoid' ? 'anatomy for' : 'molecules for'} ${o.name}…`);
        const r = await this.call('buildShape', { desc });
        data = r.out; BUILD_CACHE.set(key, data);
        if (BUILD_CACHE.size > 24) BUILD_CACHE.delete(BUILD_CACHE.keys().next().value);
      }
      if (token !== this.token) return null;
      layout.push({ obj: o, data, start: N, key });
      N += data.count;
    }
    } finally { if (needBuild) UI.busy(null); }
    if (token !== this.token) return null;
    const sig = this.layoutSig();
    this.layout = layout; this.N = N; this.layoutDirty = false; this.layoutSigCur = sig;
    MOL.setLayout(layout);
    if (PROPS.tab === 'physics' && !document.querySelector('#prop-body .dragging, #prop-body input:focus')) buildProps();
    this.disp = new Float32Array(3 * N); this.dispSt = new Uint8Array(N);
    APP.dirtyEval = true;
    return layout;
  },
  // Frame physics takes over. release -1 means automatic: a body whose location or rotation is
  // keyframed follows those keys until its last one, otherwise physics runs from the start.
  releaseOf(o, P) {
    if (P.release >= 0) return P.release;
    // an animated body plays its animation the whole time, unless something hits it
    if (o.type === 'humanoid' && RIG.isAnimated(P)) return APP.scene.world.props.frameEnd + 1;
    let last = -1;
    if (o.anim) for (const path in o.anim) if (/^(position|rotation)\b/.test(path)) for (const k of o.anim[path]) last = Math.max(last, k.f);
    return last;
  },
  placement(o, f) {
    const P = evalProps(o, f);
    const e = new THREE.Euler(P.rotation[0] * DEG, P.rotation[1] * DEG, P.rotation[2] * DEG, 'XYZ');
    const q = new THREE.Quaternion().setFromEuler(e);
    return { p: P.position.slice(), q: [q.x, q.y, q.z, q.w], P };
  },
  // what the skins are drawn from at frame f (src: 'cache' or 'rest'); a = fraction toward f + 1 (motion blur)
  skelAt(f, src, a) {
    if (!this.layout) return null;
    const c = this.cache, out = [];
    for (let k = 0; k < this.layout.length; k++) {
      let K = null, R = null;
      if (src === 'rest') K = this.restKin ? this.restKin[k] || null : null;
      else {
        K = this.kinAt(f, k);
        if (K && a > 1e-4) { const K1 = this.kinAt(f + 1, k); if (K1) K = this.lerpKin(K, K1, a); }
        if (!K && this.layout[k].data.rig) {
          for (let g = f - 1; g >= c.start; g--) { const Kg = this.kinAt(g, k); if (Kg) { const pf = this.posOf(g); if (pf) R = { fr: g, pos: pf, K: Kg }; break; } }
        }
      }
      out.push(K || R ? { K, R } : null);
    }
    return out;
  },
  lerpKin(A, B, a) {
    const S = new Float32Array(Math.min(A.S.length, B.S.length)); for (let i = 0; i < S.length; i++) S[i] = A.S[i] + (B.S[i] - A.S[i]) * a;
    const qa = A.q, qb = B.q, sg = qa[0] * qb[0] + qa[1] * qb[1] + qa[2] * qb[2] + qa[3] * qb[3] < 0 ? -1 : 1;
    const q = qa.map((v, i) => v + (qb[i] * sg - v) * a), l = Math.hypot(...q);
    return { S, p: A.p.map((v, i) => v + (B.p[i] - v) * a), q: q.map(v => v / l) };
  },
  restPositions(f, out) {
    this.restKin = [];
    for (const L of this.layout) {
      const T = this.placement(L.obj, f), m = new THREE.Matrix4().compose(new THREE.Vector3(...T.p), new THREE.Quaternion(...T.q), new THREE.Vector3(1, 1, 1)).elements;
      const n = L.data.count, o3 = 3 * L.start;
      let r = L.data.rest;
      const S = L.data.rig && L.obj.type === 'humanoid' && RIG.isAnimated(T.P) ? RIG.segXforms(L, f, 0) : null;
      if (S) r = RIG.posed(L.data, S);
      this.restKin.push(S ? { S, p: T.p, q: T.q } : null);
      for (let i = 0; i < n; i++) {
        const x = r[3 * i], y = r[3 * i + 1], z = r[3 * i + 2];
        out[o3 + 3 * i] = m[0] * x + m[4] * y + m[8] * z + m[12];
        out[o3 + 3 * i + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
        out[o3 + 3 * i + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
      }
    }
    return out;
  },
  bodyParams(o, P) {
    const W = APP.worldP || APP.scene.world.props;
    return { rigidity: P.rigidity, tone: P.tone != null ? P.tone : 0, strength: P.strength, shatter: P.shatter, friction: P.friction, stiffness: 1 - (P.softness || 0), drag: W.airDrag != null ? W.airDrag : 0.03,
      goo: P.goo != null ? P.goo : 0.3, plastic: P.plastic != null ? P.plastic : 0.2, damping: P.damping != null ? P.damping : 0.2,
      firmness: P.firmness != null ? P.firmness : 0.05, koHold: P.koHold != null ? P.koHold : 0.18, spill: P.spill != null ? P.spill : 0.5, knockout: P.knockout != null ? P.knockout : 2.5, boneSnap: P.boneSnap != null ? P.boneSnap : 5.5 };
  },
  async begin() {
    if (this.building) return false;
    this.building = true;
    const token = this.token;
    try {
      const layout = await this.ensureLayout();
      if (!layout || token !== this.token) return false;
      const W = APP.scene.world.props, start = W.frameStart;
      const bodies = layout.map(L => {
        const o = L.obj, d = L.data;
        const T = this.placement(o, start), P = T.P;
        const rel = this.releaseOf(o, P), kin = rel > start;
        const params = Object.assign(this.bodyParams(o, P), { stand: !!P.stand, startAsleep: !!P.sleep && !kin && Math.hypot(...P.velocity) < 1e-6, anchorStrength: 1, canSleep: true, react: P.react !== false, drive: P.animDrive !== false });
        return { count: d.count, rest: d.rest, tissue: d.tissue, seg: d.seg, sk: d.sk, skw: d.skw, invMass: d.invMass, smw: d.smw, shm: d.shm, anchor: d.anchor, boneRef: d.boneRef,
          bonds: d.bonds, bondRest: d.bondRest, bondK: d.bondK, bondS: d.bondS, bondC: d.bondC, hasSkeleton: d.hasSkeleton, softSegments: d.softSegments, radius: d.radius, spacing: d.spacing,
          pos: T.p, quat: T.q, vel: kin ? [0, 0, 0] : P.velocity, params, kinematic: kin };
      });
      await this.call('build', { data: { boneTissue: TI.bone, cartTissue: TI.cartilage, startFrame: start, bodies } });
      if (token !== this.token) return false;
      const pos = this.restPositions(start, new Float32Array(3 * this.N));
      this.live = pos; this.liveSt = new Uint8Array(this.N);
      this.cache.start = start; this.cache.end = start - 1;
      this.store(start, pos, this.liveSt);
      this.nextF = start + 1; this.inflight = 0;
      this.prevCols.clear();
      evaluateScene(start, true); APP.dirtyEval = true;
      for (const c of extractColliders()) this.prevCols.set(c.key, c);
      this.ready = true;
      return true;
    } catch (err) {
      console.error(err); toast('Simulation failed to start: ' + err.message, true); return false;
    } finally { if (token === this.token) this.building = false; UI.busy(null); }
  },
  /* Cached frames are stored in chunks of CH molecules. A chunk that did not change since the previous frame
   * (sleeping bodies, settled debris, a figure waiting for the hit) is shared instead of stored again. In compact
   * mode each chunk is 16-bit relative to its own bounding box: the rounding is a few micrometres for a body part
   * (well under a thousandth of a molecule), and frames take about half the memory. */
  store(f, pos, st, balls, kin) {
    const c = this.cache;
    const k = f - c.start;
    if (c.full) return;
    const fr = this.budget - c.bytes > 0 ? this.encodeFrame(pos, st) : null;
    if (!fr) { this.cacheFull(f); return; }
    if (!c.balls) c.balls = [];
    c.balls[k] = balls || null;
    if (!c.kin) c.kin = [];
    c.kin[k] = kin || null;
    c.pos[k] = fr; c.st[k] = fr.st; c.bytes += fr.bytes;
    c.end = f;
  },
  encodeFrame(pos, st) {
    const CH = 4096, N = st.length, nch = Math.ceil(N / CH) || 0, compact = this.compact !== false;
    const prev = this._prevEnc && this._prevEnc.n === N && this._prevEnc.compact === compact && this._prevEnc.token === this.token ? this._prevEnc : null;
    const ch = new Array(nch), sc = new Array(nch);
    let bytes = 64;
    try {
      for (let j = 0; j < nch; j++) {
        const a = j * CH, b = Math.min(N, a + CH);
        // unchanged since the previous frame: share it
        if (prev) {
          const pr = prev.raw, pst = prev.rawSt; let same = true;
          for (let i = 3 * a, e = 3 * b; i < e; i++) if (pr[i] !== pos[i]) { same = false; break; }
          if (same) ch[j] = prev.ch[j];
          let sameS = true;
          for (let i = a; i < b; i++) if (pst[i] !== st[i]) { sameS = false; break; }
          if (sameS) sc[j] = prev.sc[j];
        }
        if (!ch[j]) {
          if (compact) {
            let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
            for (let i = a; i < b; i++) { const x = pos[3 * i], y = pos[3 * i + 1], z = pos[3 * i + 2]; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; if (z < z0) z0 = z; if (z > z1) z1 = z; }
            // a chunk spread over more than 4 m (debris flung far away) keeps full precision instead
            if (x1 - x0 > 4 || y1 - y0 > 4 || z1 - z0 > 4) { ch[j] = { f: pos.slice(3 * a, 3 * b) }; bytes += 12 * (b - a) + 16; if (!sc[j]) { sc[j] = st.slice(a, b); bytes += b - a; } continue; }
            const kx = (x1 - x0) / 65535 || 0, ky = (y1 - y0) / 65535 || 0, kz = (z1 - z0) / 65535 || 0;
            const ix = kx ? 1 / kx : 0, iy = ky ? 1 / ky : 0, iz = kz ? 1 / kz : 0, q = new Uint16Array(3 * (b - a));
            for (let i = a, o = 0; i < b; i++, o += 3) { q[o] = Math.round((pos[3 * i] - x0) * ix); q[o + 1] = Math.round((pos[3 * i + 1] - y0) * iy); q[o + 2] = Math.round((pos[3 * i + 2] - z0) * iz); }
            ch[j] = { q, m: [x0, y0, z0, kx, ky, kz] };
            bytes += q.byteLength + 48;
          } else { ch[j] = { f: pos.slice(3 * a, 3 * b) }; bytes += 12 * (b - a) + 16; }
        }
        if (!sc[j]) { sc[j] = st.slice(a, b); bytes += b - a; }
      }
    } catch (err) { console.warn('cache allocation failed', err); return null; }
    this._prevEnc = { n: N, compact, token: this.token, raw: pos, rawSt: st, ch, sc };
    return { n: N, ch, sc, bytes, st: sc };
  },
  decodeFrame(fr, outPos, outSt) {
    const CH = 4096;
    for (let j = 0; j < fr.ch.length; j++) {
      const a = j * CH, C = fr.ch[j];
      if (C.f) outPos.set(C.f, 3 * a);
      else {
        const q = C.q, m = C.m, n = q.length / 3;
        for (let i = 0, o = 3 * a, t = 0; i < n; i++, o += 3, t += 3) { outPos[o] = m[0] + q[t] * m[3]; outPos[o + 1] = m[1] + q[t + 1] * m[4]; outPos[o + 2] = m[2] + q[t + 2] * m[5]; }
      }
      if (outSt) outSt.set(fr.sc[j], a);
    }
  },
  // positions of a cached frame as a plain array (kept for the last frame asked, the skins re-read it every frame)
  posOf(f) {
    const c = this.cache, fr = c.pos[f - c.start]; if (!fr) return null;
    const M = this._posMemo;
    if (M && M.fr === fr) return M.pos;
    const pos = new Float32Array(3 * fr.n); this.decodeFrame(fr, pos, null);
    this._posMemo = { fr, pos };
    return pos;
  },
  // the memory limit was reached: stop simulating further and say so, once, in plain words
  cacheFull(f) {
    const c = this.cache; c.full = true;
    const gb = (c.bytes / 1073741824).toFixed(2);
    if (!this._fullTold) {
      this._fullTold = true;
      const msg = `Cache memory full at frame ${c.end} (${gb} GB). Frames after that are not simulated. Raise "Cache memory" in the Render tab > Performance, keep "Compact cache" on, or use a lower body resolution.`;
      toast(msg, true);
      if (typeof setStatusHint === 'function') setStatusHint(msg);
    }
    if (UI.timeline) UI.timeline.dirty = true;
  },
  // where the simulated balls are at frame f (null when that frame is not simulated yet)
  ballsFor(f) {
    const c = this.cache; if (!c.balls) return null;
    if (f > c.end && this.ready && c.end >= c.start) f = c.end;
    if (f < c.start || f > c.end) return null;
    const b = c.balls[f - c.start], m = new Map();
    if (b) b.keys.forEach((k, i) => m.set(k, b.data.subarray(7 * i, 7 * i + 7)));
    return m;
  },
  projectilesFor(f) {
    const ctx = ctxAt(f), prev = ctxAt(f - 1), out = [];
    for (const o of allObjs()) {
      const T = TYPES[o.type]; if (!T.projectiles) continue;
      const v = APP.views.get(o.id), P = o._simP || evalProps(o, f); if (!v || P.visible === false) continue;
      out.push(...T.projectiles(v, P, ctx, prev, o));
    }
    return out;
  },
  has(f) { const c = this.cache; return f >= c.start && f <= c.end && !!c.pos[f - c.start]; },
  // skeleton pose of body k at frame f, if it was still animated then
  kinAt(f, k) { const c = this.cache, a = c.kin && f >= c.start && f <= c.end ? c.kin[f - c.start] : null; return a ? a[k] || null : null; },
  load(f, outPos, outSt) {
    const c = this.cache, k = f - c.start, q = c.pos[k];
    if (!q) return false;
    this.decodeFrame(q, outPos, outSt);
    return true;
  },
  fieldsFor(f) {
    const ctx = ctxAt(f), prev = ctxAt(f - 1), out = [];
    for (const o of allObjs()) {
      const T = TYPES[o.type]; if (!T.fields) continue;
      const P = evalProps(o, f); if (P.visible === false) continue;
      out.push(...T.fields(P, ctx, prev));
    }
    return out;
  },
  // posts the next frame to the solver; several frames can be in flight (the worker runs them in order)
  async step() {
    if (!this.ready) return;
    const W = APP.scene.world;
    const f = this.nextF++;
    const token = this.token;
    this.inflight++; this.busy = true;
    try {
      const WP = evalProps(W, f);
      evaluateScene(f, true); APP.dirtyEval = true;
      const cols = extractColliders();
      this.prevColsBrace = new Map(this.prevCols);
      const colliders = cols.map(c => { const a = this.prevCols.get(c.key) || c; return { shape: c.shape, dims: c.dims, bound: c.bound, friction: c.friction, spin: c.spin, shatterMul: c.shatterMul, a: { p: a.p, q: a.q }, b: { p: c.p, q: c.q } }; });
      this.prevCols.clear(); for (const c of cols) this.prevCols.set(c.key, c);
      const bodies = this.layout.map(L => {
        const o = L.obj, P = evalProps(o, f), bp = this.bodyParams(o, P);
        bp.drag = WP.airDrag;
        const rel = this.releaseOf(o, P);
        if (rel > W.props.frameStart && f <= rel) {
          const a = this.placement(o, f - 1), b = this.placement(o, f);
          bp.kin = f < rel ? { a: { p: a.p, q: a.q }, b: { p: b.p, q: b.q } } : null;
          if (bp.kin && L.data.rig && RIG.isAnimated(P)) {
            const bw = RIG.braceFor(o, P, cols, [b.p[0], b.p[1] + 1.0 * (P.height || 1.8) / 1.8, b.p[2]]);
            const BR = this.braceW || (this.braceW = new Map()), key = o.id;
            const prevW = (BR.get(key) || new Map()).get(f - 1) || 0;
            // shielding comes up quickly and goes down slowly
            const wNow = bw > prevW ? Math.min(bw, prevW + 0.2) : Math.max(bw, prevW - 0.05);
            if (!BR.has(key)) BR.set(key, new Map()); BR.get(key).set(f, wNow);
            bp.kin.sa = RIG.segXforms(L, f - 1, prevW); bp.kin.sb = RIG.segXforms(L, f, wNow);
            if (!bp.kin.sa || !bp.kin.sb) { delete bp.kin.sa; delete bp.kin.sb; }
          }
          if (f === rel && Math.hypot(...P.velocity) > 0) bp.addVel = P.velocity;
        }
        return bp;
      });
      const fields = this.fieldsFor(f).concat((APP.scene.events || []).filter(ev => ev.f === f).map(ev => ({ type: 'impulse', p: ev.p, radius: ev.r, strength: ev.s, damage: 0.4, lift: 0.25 })));
      const ts = Math.max(0.001, isAnimated(W, 'timeScale') ? evalChannel(W.anim.timeScale, f) : W.props.timeScale);
      const input = { dt: ts / fpsOf(), substeps: W.props.substeps | 0, gravity: [0, WP.gravity, 0], floor: { enabled: !!W.props.floor, y: 0, friction: WP.floorFriction }, colliders, fields, bodies, projectiles: this.projectilesFor(f), killBalls: this.killsFor(f), ppEvery: 2, dvMax: 3, physics: typeof PERF !== 'undefined' ? PERF.physics : 'cpu' };
      const r = await this.call('step', { input }, []);
      if (token !== this.token) return;
      this.live = r.pos; this.liveSt = r.st;
      this.ms = r.stats.ms; this.broken = r.stats.broken; this.awake = r.stats.awake; this.physics = r.stats.physics || null; (this.bstLog || (this.bstLog = []))[f] = r.stats.bst;
      // skeleton pose of each body still animated at the end of the frame: the skin is drawn from it directly
      let kin = null;
      if (r.stats.kin && r.stats.kin.length) { kin = []; for (const k of r.stats.kin) { const bp = bodies[k]; if (bp && bp.kin && bp.kin.sb) kin[k] = { S: bp.kin.sb, p: bp.kin.b.p, q: bp.kin.b.q }; } }
      this.store(f, r.pos, r.st, r.stats.balls, kin);
      if (r.stats.events && r.stats.events.length) this.onEvents(f, r.stats.events);
      APP.dirtyEval = true;
      if (UI.timeline) UI.timeline.dirty = true;
    } catch (err) {
      console.error(err);
      if (token === this.token) { toast('Simulation error: ' + err.message, true); APP.playing = false; this.target = -1; }
    } finally {
      if (token === this.token) {
        this.inflight--; this.busy = this.inflight > 0;
        this.pump(); // keep going without waiting for the next screen refresh
      }
    }
  },
  // keep simulating towards target frame
  pump() {
    if (this.target < 0) return;
    const end = APP.scene.world.props.frameEnd;
    if (!this.ready) { if (!this.building) this.begin(); return; }
    const goal = Math.min(this.target, end);
    while (this.inflight < 3 && this.nextF <= goal && !this.cache.full) this.step();
  },
};
