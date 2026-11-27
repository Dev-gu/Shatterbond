/* ---------- phone remote (desktop app only) ----------
   The Windows launcher serves a touch remote on this PC's Tailscale address. This window keeps doing
   the simulation and rendering: while a phone is watching it renders an extra view from a phone
   camera at the phone's shape, sends it as a JPEG, and applies the phone's commands. In the browser
   and the Artifact there is no launcher, so /remote/info fails and none of this switches on. */
const REMOTE = {
  on: false, info: null, viewers: 0, busy: false, last: 0, stateT: 0,
  aspect: 16 / 9, outLong: 1280, camMode: 'scene', cam: null, target: null, canvas: null,
  // the finished simulation as a video the phone plays by itself (smooth, unlike the live JPEG stream)
  clip: { key: '', id: '', state: 'none', prog: 0 }, clipping: null, movedT: 0, phoneClip: false, clipReq: false,
  async init() {
    if (!/^https?:$/.test(location.protocol) || !/^(127\.0\.0\.1|localhost)$/.test(location.hostname)) return;
    try {
      const r = await fetch('/remote/info', { cache: 'no-store' });
      if (!r.ok) return;
      this.info = await r.json();
    } catch (e) { return; }
    this.on = true;
    this.canvas = document.createElement('canvas');
    this.addButton();
    this.pollLoop();
    // a minimised window gets no animation frames: keep simulating and streaming for the phone
    setInterval(() => { if (document.hidden && this.viewers) frameBody(performance.now()); }, 50);
    setInterval(() => this.clipTick(), 400);
  },
  addButton() {
    const g = document.querySelector('#vp-header .vp-group[aria-label="View"]');
    if (!g || $('#vb-phone')) return;
    const b = el('button', { class: 'vp-btn', id: 'vb-phone', title: 'Control this simulation from your phone over Tailscale', html: S('<rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M11 18.5h2"/>') }, el('span', { class: 'vl' }, 'Phone'));
    b.onclick = () => this.showLink();
    g.append(b);
  },
  async showLink() {
    try { const r = await fetch('/remote/info', { cache: 'no-store' }); if (r.ok) this.info = await r.json(); } catch (e) {}
    const I = this.info || { links: [] };
    const p = (t, st) => el('p', { style: Object.assign({ margin: '0 0 10px', color: 'var(--fg2)', lineHeight: '1.5' }, st || {}) }, t);
    const body = el('div');
    if (!I.links || !I.links.length) {
      body.append(p('Tailscale isn’t connected on this PC yet, so there’s no phone link.'),
        p('Open Tailscale on this PC and sign in. The link shows up here within about 20 seconds, no restart needed.'));
    } else {
      const ipLink = I.links.find(u => /^http:\/\/\d+\.\d+\.\d+\.\d+[:/]/.test(u)) || I.links[0];
      const main = I.links[0];
      const linkRow = (u, big) => {
        const a = el('a', { href: u, target: '_blank', rel: 'noopener', style: { fontSize: big ? '18px' : '13px', fontWeight: big ? '600' : '400', color: 'var(--fg)', wordBreak: 'break-all' } }, u);
        const c = el('button', { class: 'btn sm' }, 'Copy');
        c.onclick = () => { try { navigator.clipboard.writeText(u); toast('Link copied'); } catch (e) { toast('Copy failed: select the link instead', true); } };
        return el('div', { style: { display: 'flex', gap: '10px', alignItems: 'center', margin: '0 0 8px' } }, a, c);
      };
      const qr = el('img', { src: '/remote/qr.png?u=' + encodeURIComponent(ipLink), alt: 'QR code for ' + ipLink, width: 180, height: 180, style: { borderRadius: '10px', background: '#fff', padding: '6px', flex: 'none' } });
      const steps = el('ol', { style: { margin: '0', paddingLeft: '18px', color: 'var(--fg2)', lineHeight: '1.55' } },
        el('li', null, 'On your phone, open the Tailscale app and sign in to the same account as this PC.'),
        el('li', null, 'Scan the QR code, or open the link in the phone’s browser.'),
        el('li', null, 'Add it to your home screen (Share › Add to Home Screen on iPhone, ⋮ › Add to home screen on Android) to use it like an app.'));
      body.append(linkRow(main, true), ...I.links.slice(1).map(u => linkRow(u, false)),
        el('div', { style: { display: 'flex', gap: '16px', alignItems: 'flex-start', marginTop: '10px', flexWrap: 'wrap' } }, qr, el('div', { style: { flex: '1', minWidth: '220px' } }, steps)),
        p('The simulation runs here on this PC and streams to the phone, so keep this window open. If Windows asks whether Shatterbond may use the network, allow it. Only devices on your tailnet can open the link.', { marginTop: '12px' }),
        p(I.viewers ? 'A phone is connected right now.' : 'No phone connected yet.', { color: I.viewers ? 'var(--ok, #3ccf8e)' : 'var(--fg2)' }),
        I.serve ? p('Connection: through Tailscale Serve, so Windows Firewall can’t block it.') :
          p('Connection: direct on port 47231. If the phone can’t load the page, Windows Firewall is probably blocking it: allow Shatterbond in Windows Security › Firewall › Allow an app, for both Private and Public networks.' + (I.serveMsg ? ' (' + I.serveMsg + ')' : ''), { color: 'var(--warn, #f5b84a)' }));
    }
    openModal('Phone link', body, [{ label: 'Done', primary: true }], { icon: 'camera', wide: true });
  },
  async pollLoop() {
    for (;;) {
      try {
        const r = await fetch('/remote/poll', { cache: 'no-store' });
        const d = await r.json();
        this.viewers = d.viewers || 0;
        for (const c0 of d.cmds || []) for (const c of (Array.isArray(c0) ? c0 : [c0])) { try { this.apply(c); } catch (e) { console.warn('remote command failed', e); } }
        if (this.viewers && performance.now() - this.stateT > 350) this.pushState();
      } catch (e) { await new Promise(r => setTimeout(r, 3000)); }
    }
  },
  libList() { const now = performance.now(); if (!this._lib || now - this._libT > 3000) { this._libT = now; this._lib = libRead().map(e => ({ id: e.id, name: e.name })); } return this._lib; },
  currentDemo() { const d = DEMOS.find(x => x.name === APP.scene.name); return d ? d.id : null; },
  // one state upload at a time, always the newest (parallel uploads could land out of order and an older state
  // would overwrite a newer one on the phone)
  pushState() {
    this.stateT = performance.now();
    if (this._pushing) { this._pushAgain = true; return; }
    this._pushing = true; this._pushAgain = false;
    const done = () => { this._pushing = false; if (this._pushAgain) this.pushState(); };
    let body;
    try { body = this.stateJSON(); } catch (e) { done(); throw e; }
    fetch('/remote/pushstate', { method: 'POST', body }).catch(() => {}).finally(done);
  },
  stateJSON() {
    const [s, e] = frameRange();
    const st = { connected: true, name: APP.scene.name, demo: this.currentDemo(), playing: !!APP.playing, frame: APP.frame, start: s, end: e,
      cached: SIM.cache ? SIM.cache.end : -1, shading: MOL.shading, fps: fpsOf(),
      clip: { id: this.clip.key === this.clipKey() ? this.clip.id : '', state: this.clipping ? 'making' : this.clip.state, prog: this.clip.prog, start: this.clip.start, end: this.clip.end, type: this.clip.type || '' }, smoothReq: this.clipReq, camMode: this.camMode, status: ($('#pill-sim') || {}).textContent || '',
      demos: DEMOS.map(d => ({ id: d.id, name: d.name })), lib: this.libList(), libId: APP.libId || null,
      edit: this.editState() };
    return JSON.stringify(st);
  },
  apply(c) {
    switch (c.t) {
      case 'size': if (c.w > 0 && c.h > 0) { this.aspect = clamp(c.w / c.h, 0.3, 4); this.outLong = clamp(Math.max(c.w, c.h) * (c.dpr || 1), 480, 1280); } break;
      case 'play': if (!!c.on !== !!APP.playing) togglePlay(); break;
      case 'toggle': togglePlay(); if (APP.playing && SIM.active()) SIM.target = Math.max(SIM.target, frameRange()[1]); break;
      case 'reset': resetSim(); break;
      case 'frame': { if (APP.playing) togglePlay(); const [s, e] = frameRange(); setFrame(clamp(Math.round(+c.f || 0), s, e)); break; }
      case 'shade': if (['skin', 'xray', 'molecules', 'tissue'].includes(c.mode)) setShading(c.mode); break;
      case 'lib': { const e = libRead().find(x => x.id === c.id); if (e) { try { activateScene(JSON.parse(e.json), { undoable: true, toCamera: true }); APP.libId = e.id; this.camMode = 'scene'; } catch (err) { toast('That scene could not be read', true); } } break; }
      case 'demo': if (DEMOS.some(d => d.id === c.id)) { loadDemo(c.id); this.camMode = 'scene'; } break;
      case 'cam': if (c.mode === 'free') this.freeCam(); else this.camMode = 'scene'; break;
      case 'orbit': case 'zoom': case 'pan': this.move(c); this.movedT = performance.now(); break;
      case 'clipmode': this.phoneClip = !!c.on; break;
      // the phone's Smooth button: make the clip only when asked, so moving around never starts a render
      case 'smooth':
        this.clipReq = !!c.on;
        if (!c.on && this.clipping) this.clipping.cancel = true;
        if (c.on && this.clip.state === 'failed') this.clip = { key: '', id: '', state: 'none', prog: 0 };
        if (c.on) this.movedT = 0;
        break;
      default: this.applyEdit(c);
    }
    this.pushState();
  },
  freeCam() {
    const base = camForOutput(this.aspect, true);
    if (!this.cam) { this.cam = new THREE.PerspectiveCamera(base.fov, this.aspect, 0.05, 600); this.target = new THREE.Vector3(); }
    this.cam.position.copy(base.position); this.cam.quaternion.copy(base.quaternion); this.cam.fov = base.fov;
    const co = sceneCamObj();
    if (co) { const P = camState(co); this.target.set(...P.target); }
    else this.target.copy(R.controls.target);
    this.camMode = 'free';
  },
  move(c) {
    if (this.camMode !== 'free') this.freeCam();
    const cam = this.cam, off = cam.position.clone().sub(this.target), sph = new THREE.Spherical().setFromVector3(off);
    if (c.t === 'orbit') { sph.theta -= (+c.dx || 0) * 5; sph.phi = clamp(sph.phi - (+c.dy || 0) * 5, 0.05, Math.PI - 0.05); }
    if (c.t === 'zoom') sph.radius = clamp(sph.radius * clamp(+c.f || 1, 0.5, 2), 0.3, 80);
    if (c.t === 'pan') {
      cam.updateMatrixWorld(true);
      const right = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0), up = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 1);
      const k = sph.radius * 1.4;
      this.target.addScaledVector(right, -(+c.dx || 0) * k).addScaledVector(up, (+c.dy || 0) * k);
    }
    cam.position.copy(this.target).add(new THREE.Vector3().setFromSpherical(sph));
    cam.lookAt(this.target);
  },
  phoneCam() {
    if (this.camMode === 'free' && this.cam) { this.cam.aspect = this.aspect; this.cam.updateProjectionMatrix(); this.cam.updateMatrixWorld(true); return this.cam; }
    return camForOutput(this.aspect, true);
  },
  // called from the frame loop just before the main render, so the phone view is drawn and copied first
  capture(now) {
    if (!this.on || !this.viewers || this.busy || now - this.last < 55 || APP.recording || this.phoneClip) return;
    this.last = now;
    const rd = R.renderer, size = rd.getSize(new THREE.Vector2()), pr = rd.getPixelRatio();
    const W = Math.floor(size.x), H = Math.floor(size.y); if (W < 8 || H < 8) return;
    let rw = W, rh = Math.round(W / this.aspect);
    if (rh > H) { rh = H; rw = Math.round(H * this.aspect); }
    const scale = Math.min(1, this.outLong / Math.max(rw * pr, rh * pr));
    const ow = Math.max(2, Math.round(rw * pr * scale)), oh = Math.max(2, Math.round(rh * pr * scale));
    const keep = { helpers: R.helpers.visible, grid: R.grid.visible };
    // while editing from the phone, its view shows the selection box (and nothing else of the editor's helpers)
    const hid = [];
    if (this.edit) { R.helpers.visible = true; for (const ch of R.helpers.children) if (ch.visible && !SELBOX.pool.includes(ch)) { ch.visible = false; hid.push(ch); } }
    else R.helpers.visible = false;
    R.grid.visible = this.camMode === 'free' && (APP.showGrid || this.edit);
    const gzv = R.gizmoHelper.visible; R.gizmoHelper.visible = false;
    rd.setViewport(0, 0, rw, rh); rd.setScissor(0, 0, rw, rh); rd.setScissorTest(true);
    rd.render(R.scene, this.phoneCam());
    const cv = this.canvas; if (cv.width !== ow || cv.height !== oh) { cv.width = ow; cv.height = oh; }
    const g = cv.getContext('2d');
    g.drawImage(rd.domElement, 0, (H - rh) * pr, rw * pr, rh * pr, 0, 0, ow, oh);
    rd.setScissorTest(false); rd.setViewport(0, 0, W, H);
    for (const ch of hid) ch.visible = true;
    R.gizmoHelper.visible = gzv;
    R.helpers.visible = keep.helpers; R.grid.visible = keep.grid;
    this.busy = true;
    cv.toBlob((blob) => {
      if (!blob) { this.busy = false; return; }
      fetch('/remote/push', { method: 'POST', body: blob }).catch(() => {}).finally(() => { this.busy = false; });
    }, 'image/jpeg', 0.74);
  },
  /* ---------- editing from the phone ----------
     The phone gets the object list, the Add menu and the selected object's settings (built from the same field
     definitions as the desktop panel, so every setting shows up there) and sends edits back as commands. */
  edit: false, undoKey: '', undoT: 0, grab: null,
  addItems() { return ADD_ITEMS().filter(x => x && typeof x === 'object' && !x.hdr); },
  addMenu() {
    if (this._addMenu) return this._addMenu;
    const out = []; let hdr = '';
    for (const x of ADD_ITEMS()) { if (!x || typeof x !== 'object') continue; if (x.hdr) { hdr = x.hdr; continue; } out.push({ l: x.label, g: hdr }); }
    return (this._addMenu = out);
  },
  fieldJSON(o, fd, P) {
    const f = { k: fd.key, l: fd.label, ty: fd.type };
    for (const q of ['min', 'max', 'step', 'unit']) if (fd[q] != null) f[q] = fd[q];
    if (fd.help) f.h = fd.help;
    if (fd.type === 'select') { const op = typeof fd.options === 'function' ? fd.options() : fd.options; f.opt = (op || []).map(x => Array.isArray(x) ? [String(x[0]), String(x[1])] : [String(x), String(x)]); }
    if (fd.type === 'button') { f.text = fd.text || fd.label; }
    let v = P[fd.key]; if (Array.isArray(v)) v = v.slice();
    f.v = v;
    if (fd.anim && o.anim) {
      const paths = Array.isArray(P[fd.key]) ? [0, 1, 2].map(i => fd.key + '.' + i) : [fd.key];
      if (paths.some(pth => isAnimated(o, pth))) f.an = paths.some(pth => keyAt(o, pth, APP.frame) >= 0) ? 2 : 1;
    }
    if (fd.anim) f.ka = 1;
    return f;
  },
  editState() {
    if (!APP.scene) return null;
    const act = APP.active ? objById(APP.active) : null;
    const st = { objs: allObjs().map(o => ({ id: o.id, n: o.name, ty: o.type })), sel: APP.sel.slice(), act: act ? act.id : null,
      undo: APP.undo.length, redo: APP.redo.length, autokey: !!APP.autokey, add: this.addMenu() };
    const o = act || (this.propsWorld ? APP.scene.world : null);
    if (o) {
      const P = o.type === 'world' ? o.props : evalProps(o, APP.frame);
      const groups = o.type === 'world' ? WORLD_GROUPS : TYPES[o.type].groups(o.props);
      st.props = { id: o.id, n: o.type === 'world' ? 'World' : o.name, ty: o.type, g: groups.map(g => ({ t: g.title, f: g.fields.map(fd => this.fieldJSON(o, fd, P)) })) };
    }
    return st;
  },
  // one undo step per burst of changes to the same setting (a slider drag sends many)
  undoOnce(key) { const now = performance.now(); if (key !== this.undoKey || now - this.undoT > 1500) pushUndo(); this.undoKey = key; this.undoT = now; },
  rayAt(x, y) {
    const cam = this.phoneCam();
    RAY.setFromCamera(new THREE.Vector2(clamp(+x || 0, 0, 1) * 2 - 1, -(clamp(+y || 0, 0, 1) * 2 - 1)), cam);
    return RAY.ray;
  },
  phoneFocus(o) {
    if (this.camMode !== 'free') this.freeCam();
    const box = new THREE.Box3();
    for (const q of (o ? [o] : selObjs().length ? selObjs() : allObjs())) if (q.type !== 'camera') box.union(selectionBox(q));
    if (box.isEmpty()) return;
    const c = box.getCenter(new THREE.Vector3()), r = Math.max(0.4, box.getSize(new THREE.Vector3()).length() / 2);
    const dir = this.cam.position.clone().sub(this.target).normalize();
    const fit = Math.min(this.cam.fov, this.cam.fov * this.aspect) * DEG / 2;
    this.target.copy(c); this.cam.position.copy(c).addScaledVector(dir, r / Math.sin(fit) * 1.1); this.cam.lookAt(c);
  },
  // the object under a point of the phone's view (0..1 across and down), or null
  pickPhone(x, y) {
    const ray = this.rayAt(x, y), r0 = ray.clone();
    const hit = pickRay(ray);
    if (hit && hit.objId) return hit.objId;
    // a fingertip is not a mouse pointer: a tap that misses every mesh and molecule takes the nearest object
    // whose bounding box it passes through (slightly padded)
    let best = null; const pt = new THREE.Vector3();
    for (const o of allObjs()) {
      if (o.type === 'camera' || (o._eval || o.props).visible === false) continue;
      const box = selectionBox(o); if (box.isEmpty()) continue;
      box.expandByScalar(0.06);
      if (r0.intersectBox(box, pt)) { const d = pt.distanceTo(r0.origin); if (!best || d < best.d) best = { d, id: o.id }; }
    }
    return best ? best.id : null;
  },
  applyEdit(c) {
    const act = () => (APP.active ? objById(APP.active) : null);
    switch (c.t) {
      case 'edit': this.edit = !!c.on; if (this.edit) { this.phoneClip = false; this.clipReq = false; if (this.clipping) this.clipping.cancel = true; } else setTimeout(() => { this.movedT = performance.now(); }, 50); break;
      case 'pick': {
        const id = this.pickPhone(c.x, c.y);
        if (id) { select([id], !!c.add); this.propsWorld = false; }
        else if (!c.add) select([]);
        break;
      }
      case 'sel': if (c.id === 'world') { select([]); this.propsWorld = true; } else { this.propsWorld = false; select(c.id && objById(c.id) ? [c.id] : []); } break;
      case 'focus': { // double tap: frames what is under the finger (and selects it), else the selection
        let o = c.id ? objById(c.id) : null;
        if (!o && c.x != null) { const id = this.pickPhone(c.x, c.y); if (id) { select([id]); this.propsWorld = false; o = objById(id); } }
        this.phoneFocus(o); this.movedT = performance.now(); break;
      }
      case 'add': {
        const it = this.addItems()[c.i | 0]; if (!it) break;
        const keep = R.controls.target.clone();
        if (this.camMode === 'free' && this.target) R.controls.target.set(this.target.x, 0, this.target.z);
        try { it.action(); } finally { R.controls.target.copy(keep); }
        this.propsWorld = false; break;
      }
      case 'del': deleteSelected(); break;
      case 'dup': duplicateSelected(); break;
      case 'key': insertKeyframeSelected(); break;
      case 'unkey': if (typeof deleteKeyframeSelected === 'function') deleteKeyframeSelected(); break;
      case 'undo': doUndo(); break;
      case 'redo': doRedo(); break;
      case 'autokey': if (!!c.on !== !!APP.autokey) toggleAutokey(); break;
      case 'rename': { const o = objById(c.id); if (o && o.type !== 'world' && typeof c.name === 'string' && c.name.trim()) { pushUndo(); o.name = c.name.trim().slice(0, 60); UI.refreshAll(); } break; }
      case 'set': {
        const o = objById(c.id); if (!o) break;
        const fd = fieldOf(o, c.k); if (!fd || fd.type === 'button') break;
        let v = c.v;
        if (fd.type === 'num' || fd.type === 'int') { v = +v; if (!isFinite(v)) break; if (fd.min != null) v = Math.max(fd.min, v); if (fd.max != null) v = Math.min(fd.max, v); if (fd.type === 'int') v = Math.round(v); }
        else if (fd.type === 'bool') v = !!v;
        else if (fd.type === 'vec3') { if (!Array.isArray(v) || v.length !== 3 || v.some(q => !isFinite(+q))) break; v = v.map(Number); if (fd.min != null) v = v.map(q => Math.max(fd.min, q)); }
        else if (fd.type === 'color') { if (!/^#[0-9a-f]{6}$/i.test(v)) break; }
        else v = String(v);
        this.undoOnce(o.id + '.' + c.k);
        if (fd.type === 'vec3' && fd.anim) { for (let i = 0; i < 3; i++) setProp(o, c.k, v[i], i, { silent: i < 2 }); }
        else setProp(o, c.k, v);
        if (fd.onSet) try { fd.onSet(o, v); } catch (e) { /* field hook */ }
        break;
      }
      case 'keyfield': { // key (or unkey) one setting of the active object at this frame
        const o = objById(c.id); if (!o || o.type === 'world') break;
        const fd = fieldOf(o, c.k); if (fd && fd.anim) toggleKey(o, fd);
        break;
      }
      case 'grab': { // start moving the active object with one finger: it slides over the floor plane at its own height
        const o = act(); if (!o || !Array.isArray(o.props.position)) break;
        const P = evalProps(o, APP.frame), y = P.position[1];
        const ray = this.rayAt(c.x, c.y), t = (y - ray.origin.y) / ray.direction.y;
        if (!(t > 0) || !isFinite(t)) break;
        const hit = ray.at(t, new THREE.Vector3());
        pushUndo(); this.undoKey = ''; this.grab = { id: o.id, y, off: [P.position[0] - hit.x, P.position[2] - hit.z] };
        break;
      }
      case 'drag': {
        const g = this.grab, o = g && objById(g.id); if (!o) break;
        const ray = this.rayAt(c.x, c.y), t = (g.y - ray.origin.y) / ray.direction.y;
        if (!(t > 0) || !isFinite(t) || t > 400) break;
        const hit = ray.at(t, new THREE.Vector3());
        setProp(o, 'position', +(hit.x + g.off[0]).toFixed(3), 0, { silent: true });
        setProp(o, 'position', +(hit.z + g.off[1]).toFixed(3), 2);
        break;
      }
      case 'drop': this.grab = null; break;
      case 'lift': { // move the active object up or down (two-finger vertical drag in move mode)
        const o = act(); if (!o || !Array.isArray(o.props.position)) break;
        this.undoOnce(o.id + '.lift');
        const P = evalProps(o, APP.frame);
        setProp(o, 'position', +(P.position[1] + (+c.d || 0)).toFixed(3), 1);
        break;
      }
      case 'rot': {
        const o = act(); if (!o || !Array.isArray(o.props.rotation)) break;
        this.undoOnce(o.id + '.rot' + (c.axis | 0));
        const P = evalProps(o, APP.frame), ax = clamp(c.axis | 0, 0, 2);
        let r = P.rotation[ax] + (+c.d || 0); r = ((r + 180) % 360 + 360) % 360 - 180;
        setProp(o, 'rotation', +r.toFixed(2), ax);
        break;
      }
      case 'scl': {
        const o = act(); if (!o) break;
        const f = clamp(+c.f || 1, 0.5, 2);
        this.undoOnce(o.id + '.scl');
        const P = evalProps(o, APP.frame);
        if (Array.isArray(o.props.scale)) { for (let i = 0; i < 3; i++) setProp(o, 'scale', +Math.max(0.001, P.scale[i] * f).toFixed(4), i, { silent: i < 2 }); }
        else if (o.type === 'humanoid' && P.height) setProp(o, 'height', +clamp(P.height * f, 0.5, 3).toFixed(3));
        break;
      }
      case 'scene': {
        if (c.op === 'new') newSceneCmd();
        else if (c.op === 'save') { saveSceneCmd(false); this._lib = null; }
        else if (c.op === 'copy') { saveSceneCmd(true); this._lib = null; }
        else if (c.op === 'bake') bakeAll();
        break;
      }
    }
  },
  // everything that changes what the clip shows
  clipKey() {
    const [s, e] = frameRange();
    const cam = this.camMode === 'free' && this.cam ? [...this.cam.position.toArray(), ...this.target.toArray()].map(v => v.toFixed(3)).join(',')
      : sceneCamObj() ? 'scene' : [...R.camera.position.toArray(), ...R.camera.quaternion.toArray()].map(v => v.toFixed(3)).join(',');
    return [APP.scene && APP.scene.name, SIM.token, APP.editGen || 0, MOL.shading, cam, this.aspect.toFixed(3), Math.round(this.outLong), s, e, fpsOf()].join('|');
  },
  // once the whole range is simulated, render it from the phone's camera into a video for the phone
  clipTick() {
    if (!this.on || !this.viewers || !this.clipReq || this.clipping || APP.recording || !VIDEO.supported || this.edit) return;
    const key = this.clipKey();
    if (key === this.clip.key && this.clip.state === 'ready') { this.clipReq = false; return; }
    if (this.clip.state === 'failed' && key === this.clip.key) return;
    const [, e] = frameRange(), c = SIM.cache, hasBodies = SIM.active();
    const done = !hasBodies || (SIM.ready && (c.end >= e || c.full) && c.end > c.start);
    if (!done || performance.now() - this.movedT < 300 || R.gizmoDragging) return;
    this.makeClip(key).catch(err => { console.warn('phone clip failed', err); this.clip = { key, id: '', state: 'failed', prog: 0 }; this.clipping = null; });
  },
  async makeClip(key) {
    const [s, e0] = frameRange(), c = SIM.cache, hasBodies = SIM.active();
    const e = hasBodies ? Math.min(e0, c.end) : e0, n = e - s + 1;
    if (n < 2) return;
    const fps = fpsOf();
    let w = Math.round(this.aspect >= 1 ? this.outLong : this.outLong * this.aspect), h = Math.round(this.aspect >= 1 ? this.outLong / this.aspect : this.outLong);
    w = Math.max(2, w & ~1); h = Math.max(2, h & ~1);
    const bitrate = Math.round(9e6 * (w * h) / (1280 * 720) * Math.sqrt(clamp(fps / 30, 0.5, 2.5)));
    let fmt = 'mp4', cfg = await VIDEO.pick('mp4', w, h, fps, bitrate);
    if (!cfg) { fmt = 'webm'; cfg = await VIDEO.pick('webm', w, h, fps, bitrate); }
    if (!cfg) { this.clip = { key, id: '', state: 'failed', prog: 0 }; return; }
    const rec = { phase: 'enc', phone: true, cancel: false, frame0: APP.frame };
    const wasPlaying = APP.playing; if (wasPlaying) togglePlay();
    APP.recording = rec; this.clipping = rec; this.clip = { key, id: '', state: 'making', prog: 0 };
    const chunks = []; let desc = null, fail = null;
    const enc = new VideoEncoder({
      output: (chunk, meta) => {
        const data = new Uint8Array(chunk.byteLength); chunk.copyTo(data);
        chunks.push({ data, key: chunk.type === 'key', ts: chunk.timestamp });
        const d = meta && meta.decoderConfig && meta.decoderConfig.description;
        if (d && !desc) desc = ArrayBuffer.isView(d) ? new Uint8Array(d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength)) : new Uint8Array(d.slice(0));
      },
      error: (err) => { fail = err; },
    });
    const saved = enterOutputMode(w, h);
    setStatusHint('Making the phone clip… press Esc to cancel');
    const camFn = () => this.camMode === 'free' && this.cam ? (this.cam.aspect = w / h, this.cam.updateProjectionMatrix(), this.cam.updateMatrixWorld(true), this.cam) : camForOutput(w / h, true);
    try {
      enc.configure(cfg);
      const gop = Math.max(1, Math.round(fps));
      for (let i = 0; i < n && !rec.cancel && !fail; i++) {
        const f = s + i;
        APP.frame = f; APP.lastEvalFrame = f; APP.evalStamp++;
        evaluateScene(f); applyWorldLook(APP.worldP); MOL.applyStyle(); updateBodies(true);
        hideHelpers(true); R.gizmoHelper.visible = false;
        renderScene(camFn(), { sceneCam: this.camMode !== 'free', frame: f, camFn });
        const vf = new VideoFrame(R.renderer.domElement, { timestamp: Math.round(i * 1e6 / fps), duration: Math.round(1e6 / fps) });
        enc.encode(vf, { keyFrame: i % gop === 0 }); vf.close();
        this.clip.prog = (i + 1) / n;
        if (i % 6 === 0) this.pushState();
        while (enc.encodeQueueSize > 2 && !fail && !rec.cancel) await sleep(3);
        await sleep(0);
      }
      if (!fail && !rec.cancel) await enc.flush();
    } catch (err) { fail = fail || err; }
    try { enc.close(); } catch (err) { /* closed */ }
    leaveOutputMode(saved);
    APP.recording = null; this.clipping = null; setStatusHint(null);
    APP.frame = rec.frame0; APP.dirtyEval = true; TL.dirty = true; TL.updateFrameField();
    if (wasPlaying && !APP.playing) togglePlay();
    if (rec.cancel) { this.clip = { key: '', id: '', state: 'none', prog: 0 }; this.clipReq = false; return; }
    if (fail || !chunks.length) { this.clip = { key, id: '', state: 'failed', prog: 0 }; return; }
    const track = { w, h, fps, codec: cfg.codec, desc };
    const blob = fmt === 'mp4' ? muxMP4(chunks, track) : muxWebM(chunks, track);
    const id = Math.random().toString(36).slice(2, 10);
    const r = await fetch('/remote/pushclip?id=' + id, { method: 'POST', headers: { 'Content-Type': blob.type }, body: blob });
    if (!r.ok) throw new Error('upload ' + r.status);
    this.clip = { key, id, state: 'ready', prog: 1, start: s, end: e, type: blob.type }; this.clipReq = false;
    this.pushState();
  },
};
