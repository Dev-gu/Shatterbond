/* ===================== main: scenes in/out, viewport interaction, render loop ===================== */
Object.assign(APP, { showGrid: true, snap: false, gizmoSpace: 'world', playSpeed: 1, libId: null, waiting: false });
const DL = (window.claude && typeof window.claude.use === 'function') ? window.claude.use('downloads').catch(() => null) : Promise.resolve(null);
const slug = (s) => (s || 'scene').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'scene';

async function saveFile(filename, data) {
  const d = await DL;
  if (d) {
    try { await d.save({ filename, data }); toast(`Saved ${filename}`); return true; }
    catch (err) {
      const code = err && err.code;
      if (code === 'declined') { toast('Download cancelled'); return false; }
      if (code === 'rate_limited') { toast('Another download is waiting for approval', true); return false; }
      if (code === 'host_unavailable') { toast('This app can’t save files. Open the page in a browser to download.', true); return false; }
      console.warn('downloads capability failed, falling back', err);
    }
  }
  try {
    const blob = data instanceof Blob ? data : new Blob([data]);
    const url = URL.createObjectURL(blob);
    const a = el('a', { href: url, download: filename, style: { display: 'none' } });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 8000);
    toast(`Downloaded ${filename}`);
    return true;
  } catch (err) { toast('Could not save the file: ' + err.message, true); return false; }
}

/* ---------- scene activation & normalisation ---------- */
function normalizeScene(d) {
  const sc = { name: String(d.name || 'Untitled scene').slice(0, 80), tissues: d.tissues && typeof d.tissues === 'object' ? d.tissues : {}, events: Array.isArray(d.events) ? d.events.filter(e => e && Array.isArray(e.p)) : [], clips: {}, world: null, objects: [] };
  if (d.clips && typeof d.clips === 'object') for (const id in d.clips) { const c = d.clips[id]; if (/^[\w-]{1,40}$/.test(id) && c && c.n > 1 && ((Array.isArray(c.q) && Array.isArray(c.hip)) || (Array.isArray(c.qp) && typeof c.hp === 'string'))) sc.clips[id] = c; }
  const w = d.world || {};
  sc.world = { id: 'world', type: 'world', name: 'World', props: Object.assign(WORLD_DEFAULTS(), w.props || {}), anim: w.anim && typeof w.anim === 'object' ? w.anim : {} };
  const ids = new Set();
  for (const o of (Array.isArray(d.objects) ? d.objects : [])) {
    if (!o || !TYPES[o.type]) continue;
    let id = typeof o.id === 'string' && /^[\w-]{1,40}$/.test(o.id) && !ids.has(o.id) ? o.id : newId();
    ids.add(id);
    const props = Object.assign(TYPES[o.type].defaults(), o.props || {});
    for (const k of ['position', 'rotation', 'scale', 'velocity', 'target']) if (props[k] != null && (!Array.isArray(props[k]) || props[k].length !== 3)) props[k] = TYPES[o.type].defaults()[k];
    sc.objects.push({ id, type: o.type, name: String(o.name || TYPES[o.type].label).slice(0, 60), props, anim: o.anim && typeof o.anim === 'object' ? o.anim : {} });
  }
  return sc;
}
function activateScene(sc, opts = {}) {
  if (opts.undoable && APP.scene) pushUndo();
  APP.playing = false; APP.recording = null;
  APP.scene = normalizeScene(sc);
  rebuildViews();
  rebuildTimeTable();
  SIM.invalidate();
  APP.frame = APP.scene.world.props.frameStart;
  APP.sel = []; APP.active = null;
  TL.sel.clear(); TL.expanded.clear(); TL.collapsed.clear();
  APP.dirtyEval = true;
  evaluateScene(APP.frame);
  MOL.applyStyle();
  TL.fit(); TL.updateBar();
  PROPS.want = null; PROPS.tab = 'scene';
  UI.refreshAll();
  if (opts.toCamera) viewFromSceneCamera(true);
  if (APP.camView && !allObjs().some(o => o.type === 'camera')) APP.camView = false;
  updateToolbar();
}
function viewFromSceneCamera(instant) {
  const cam = sceneCamObj(); if (!cam) return;
  const P = camState(cam, evalProps(cam, APP.frame));
  // a wider view from a little to the side of the shot, so the set-up and the camera are both visible
  const p = new THREE.Vector3(...P.position), t = new THREE.Vector3(...P.target);
  // portrait viewports (phones) see less sideways, so step further back
  const asp = Math.max(0.2, R.vp.clientWidth / Math.max(1, R.vp.clientHeight));
  p.sub(t).applyAxisAngle(new THREE.Vector3(0, 1, 0), 20 * DEG).multiplyScalar(1.3 * (asp < 1.2 ? Math.min(2.2, (1.2 / asp) ** 0.8) : 1)).add(t);
  p.y += 0.35;
  animateView(p, t, instant);
}
function defaultNewScene() {
  return sceneFromDemo({ name: 'Untitled scene', world: { frameEnd: 250 }, objects: [HUMAN([0, 0, 0]), CAM([4.4, 1.9, 5.4], [0, 1.0, 0], 40)] });
}
function newSceneCmd() {
  confirmModal('Start a new scene?', 'The current scene will be replaced by an empty studio with one figure. You can undo this with Ctrl+Z, or save the current scene to your library first.', 'New scene', () => {
    activateScene(defaultNewScene(), { undoable: true, toCamera: true }); APP.libId = null; toast('New scene');
  });
}

/* ---------- library (browser storage) ---------- */
const LIB_KEY = 'shatterbond.library', AUTO_KEY = 'shatterbond.autosave';
function libRead() { try { const v = JSON.parse(localStorage.getItem(LIB_KEY) || '[]'); return Array.isArray(v) ? v : []; } catch (e) { return []; } }
function libWrite(list) { try { localStorage.setItem(LIB_KEY, JSON.stringify(list)); return true; } catch (e) { toast('Browser storage is full or unavailable. Export the scene as a file instead.', true); return false; } }
function makeThumb() {
  const src = R.renderer.domElement, w = 320, h = 180;
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d');
  const sa = src.width / src.height, da = w / h;
  let sw = src.width, sh = src.height, sx = 0, sy = 0;
  if (sa > da) { sw = sh * da; sx = (src.width - sw) / 2; } else { sh = sw / da; sy = (src.height - sh) / 2; }
  try { g.drawImage(src, sx, sy, sw, sh, 0, 0, w, h); return c.toDataURL('image/jpeg', 0.72); } catch (e) { return ''; }
}
function saveSceneCmd(asCopy) {
  const list = libRead();
  let entry = !asCopy && APP.libId ? list.find(e => e.id === APP.libId) : null;
  if (!entry) { entry = { id: 's' + Date.now().toString(36) }; list.unshift(entry); if (asCopy) APP.scene.name = APP.scene.name.replace(/( copy)*$/, '') + ' copy'; }
  entry.name = APP.scene.name; entry.savedAt = Date.now(); entry.thumb = makeThumb(); entry.json = snapshot();
  entry.objects = allObjs().length; entry.frames = APP.scene.world.props.frameEnd - APP.scene.world.props.frameStart;
  if (libWrite(list)) { APP.libId = entry.id; $('#scene-name').value = APP.scene.name; toast(`Saved “${entry.name}” to your library`); }
}
function openLibrary() {
  const body = el('div');
  let modal = null;
  const render = () => {
    body.textContent = '';
    const list = libRead();
    body.append(el('div', { class: 'section-t' }, `Your scenes (${list.length})`));
    if (!list.length) body.append(el('div', { class: 'p-help', style: { margin: '0 0 14px' } }, 'Nothing saved yet. Press Ctrl+S to save the current scene here. Scenes are stored in this browser; export a .json file to keep a copy anywhere.'));
    else {
      const g = el('div', { class: 'scene-grid', style: { marginBottom: '18px' } });
      for (const e of list) {
        const card = el('div', { class: 'scard', tabindex: 0, role: 'button', 'aria-label': 'Open ' + e.name });
        const th = el('div', { class: 'thumb', style: e.thumb ? { backgroundImage: `url("${e.thumb}")` } : null }, e.thumb ? null : svgEl(ICON.scene));
        const when = new Date(e.savedAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
        const meta = el('div', { class: 'meta' }, el('b', null, e.name), el('span', null, `${when} · ${e.objects || 0} objects`));
        const open = () => { try { activateScene(JSON.parse(e.json), { undoable: true, toCamera: true }); APP.libId = e.id; modal.close(); toast(`Opened “${e.name}”`); } catch (err) { toast('That scene could not be read', true); } };
        const ex = el('button', { class: 'btn sm', title: 'Export as .json file', html: ICON.download }, 'Export');
        ex.onclick = (ev) => { ev.stopPropagation(); saveFile(slug(e.name) + '.shatterbond.json', e.json); };
        const del = el('button', { class: 'btn sm danger', title: 'Delete from library', html: ICON.trash }, 'Delete');
        del.onclick = (ev) => { ev.stopPropagation(); confirmModal('Delete this scene?', `“${e.name}” will be removed from your library. This can’t be undone.`, 'Delete', () => { libWrite(libRead().filter(x => x.id !== e.id)); if (APP.libId === e.id) APP.libId = null; render(); }, true); };
        card.append(th, meta, el('div', { class: 'acts' }, ex, del));
        card.addEventListener('click', open);
        card.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') open(); });
        g.append(card);
      }
      body.append(g);
    }
    body.append(el('div', { class: 'section-t' }, 'Demo scenes'));
    const g2 = el('div', { class: 'scene-grid' });
    for (const d of DEMOS) {
      const card = el('div', { class: 'scard demo', tabindex: 0, role: 'button', 'aria-label': 'Open demo ' + d.name });
      card.append(el('div', { class: 'thumb' }, svgEl(ICON[d.icon] || ICON.scene)), el('div', { class: 'meta' }, el('b', null, d.name), el('span', null, d.desc)));
      const open = () => { loadDemo(d.id); modal.close(); };
      card.addEventListener('click', open);
      card.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') open(); });
      g2.append(card);
    }
    body.append(g2);
  };
  render();
  const imp = el('button', { class: 'btn', html: ICON.upload }, 'Import .json');
  imp.onclick = () => { modal.close(); importJSON(); };
  modal = openModal('Scene library', body, [], { icon: 'folder', headExtra: [imp], wide: true });
}
function importJSON() {
  const inp = el('input', { type: 'file', accept: '.json,application/json', style: { display: 'none' } });
  inp.addEventListener('change', () => {
    const f = inp.files && inp.files[0]; inp.remove(); if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      try {
        const d = JSON.parse(r.result);
        if (!d || !d.world || !Array.isArray(d.objects)) throw new Error('not a Shatterbond scene');
        activateScene(d, { undoable: true, toCamera: true }); APP.libId = null;
        toast(`Imported “${APP.scene.name}”`);
      } catch (err) { toast('Could not import: ' + err.message, true); }
    };
    r.readAsText(f);
  });
  document.body.append(inp); inp.click();
}
function exportJSON() { saveFile(slug(APP.scene.name) + '.shatterbond.json', JSON.stringify(JSON.parse(snapshot()), null, 1)); }
let _lastAuto = '';
function autosave() {
  if (!APP.scene || APP.recording || PLAY.on) return;
  const s = snapshot(); if (s === _lastAuto) return;
  _lastAuto = s;
  try { localStorage.setItem(AUTO_KEY, s); } catch (e) { /* quota: ignore */ }
}

/* ---------- camera helpers ---------- */
function animateView(pos, target, instant) {
  if (instant) { R.camera.position.copy(pos); R.controls.target.copy(target); R.controls.update(); APP.viewAnim = null; return; }
  APP.viewAnim = { t0: performance.now(), dur: 320, p0: R.camera.position.clone(), t0v: R.controls.target.clone(), p1: pos.clone(), t1: target.clone() };
}
function setView(name) {
  if (APP.camView) toggleCamView();
  const t = R.controls.target.clone(), d = R.camera.position.distanceTo(t);
  const dir = { front: [0, 0, 1], back: [0, 0, -1], right: [1, 0, 0], left: [-1, 0, 0], top: [0, 1, 0.0001], bottom: [0, -1, 0.0001] }[name];
  if (!dir) return;
  animateView(t.clone().add(new THREE.Vector3(...dir).normalize().multiplyScalar(d)), t);
}
function selectionBox(o) {
  const box = new THREE.Box3();
  const L = SIM.layout && SIM.N && SIM.disp && SIM.layout.find(l => l.obj.id === o.id);
  if (L && !SIM.layoutDirty) {
    const d = SIM.disp, st = SIM.dispSt;
    let any = false;
    for (let i = L.start; i < L.start + L.data.count; i++) { if (st && st[i] === 2) continue; box.expandByPoint(_tmpV.set(d[3 * i], d[3 * i + 1], d[3 * i + 2])); any = true; }
    if (any) return box;
  }
  const v = APP.views.get(o.id); if (!v) return box;
  if (o.type === 'humanoid') { const P = o._eval || o.props; const h = P.height || 1.8; box.setFromCenterAndSize(new THREE.Vector3(P.position[0], P.position[1] + h / 2, P.position[2]), new THREE.Vector3(0.6, h, 0.4)); return box; }
  for (const m of v.pick) { if (!m.visible) continue; m.updateWorldMatrix(true, false); box.expandByObject(m); }
  if (box.isEmpty()) box.setFromCenterAndSize(v.root.getWorldPosition(new THREE.Vector3()), new THREE.Vector3(0.5, 0.5, 0.5));
  return box;
}
const _tmpV = new THREE.Vector3();
function frameSelected(all) {
  const objs = all ? allObjs() : (selObjs().length ? selObjs() : allObjs());
  if (!objs.length) return;
  const box = new THREE.Box3();
  for (const o of objs) if (o.type !== 'camera') box.union(selectionBox(o));
  if (box.isEmpty()) return;
  const c = box.getCenter(new THREE.Vector3()), r = Math.max(0.4, box.getSize(new THREE.Vector3()).length() / 2);
  const dir = R.camera.position.clone().sub(R.controls.target).normalize();
  const dist = r / Math.sin((R.camera.fov * DEG) / 2) * 1.05;
  if (APP.camView) toggleCamView();
  animateView(c.clone().addScaledVector(dir, dist), c);
}
// the camera that films frame f: the camera picked with "Look through" if any; with shots set up, the camera
// whose shot started last; otherwise the first visible camera
function sceneCamObj(f) {
  const fr = f != null ? f : (APP.evalF != null ? APP.evalF : APP.frame);
  const pin = pinnedCam(); if (pin) return pin;
  const cams = camList();
  let best = null, bs = -Infinity, first = null;
  for (const o of cams) {
    const s = o.props.shotStart; if (!(s >= 0)) continue;
    if (s <= fr && s > bs) { bs = s; best = o; }
    if (!first || s < first.props.shotStart) first = o;
  }
  return best || first || cams.find(o => (o._eval || o.props).visible !== false) || cams[0];
}
function toggleCamView() {
  // with a camera selected, C looks through that camera (any camera, not only the active one)
  const sel = activeObj();
  if (!APP.camView && sel && sel.type === 'camera' && sel !== sceneCamObj()) { lookThrough(sel); return; }
  if (!APP.camView && !sceneCamObj()) {
    addCameraFromView();
    toast('Added a camera at this view. Press C again to leave camera view.');
  }
  APP.camView = !APP.camView;
  // in camera view, orbit / pan / zoom drive the scene camera itself (like "lock camera to view")
  R.controls.enabled = true; APP.viewAnim = null;
  if (APP.camView) {
    R.editView = { p: R.camera.position.clone(), t: R.controls.target.clone(), fov: R.camera.fov };
    R.camSync = null; camViewSync();
  } else if (R.editView) {
    R.camera.position.copy(R.editView.p); R.controls.target.copy(R.editView.t); R.camera.fov = R.editView.fov; R.camera.updateProjectionMatrix(); R.controls.update(); R.editView = null;
  }
  APP.dirtyEval = true; updateToolbar(); syncGizmo();
  let fr = $('.vp-cam-frame'), lab = $('.vp-cam-label');
  if (APP.camView) {
    if (!fr) { R.vp.append(el('div', { class: 'vp-cam-frame' }), el('div', { class: 'vp-cam-label' }, 'Camera view')); }
    updateCamLabel();
  } else { if (fr) fr.remove(); if (lab) lab.remove(); }
  updateCropGuide();
}
// keeps the editor view and the scene camera in step while looking through it: navigating moves the camera
// object (one undo step per gesture, keys if it is animated or auto-key is on), otherwise the view follows it
function camViewSync() {
  const o = sceneCamObj(); if (!o) return;
  const c = R.camera, t = R.controls.target, S = R.camSync;
  const moved = S && (c.position.distanceToSquared(S.p) > 1e-10 || t.distanceToSquared(S.t) > 1e-10);
  if (moved && !APP.playing && S.id === o.id) {
    const now = performance.now();
    if (!R.camEditT || now - R.camEditT > 700) pushUndo();
    R.camEditT = now;
    // a following camera stores its position relative to where following moved it; what it aims at is
    // decided by following when it watches the object, so only the position is written then
    const r4 = (v) => +v.toFixed(4), P = evalProps(o, APP.frame), st = camState(o, P), fd = st._fd || [0, 0, 0];
    for (let i = 0; i < 3; i++) {
      const pv = r4(c.position.getComponent(i) - fd[i]), tv = r4(t.getComponent(i) - fd[i]);
      if (Math.abs(pv - P.position[i]) > 1e-6) setProp(o, 'position', pv, i, { silent: true });
      if (!st._look && Math.abs(tv - P.target[i]) > 1e-6) setProp(o, 'target', tv, i, { silent: true });
    }
    APP.dirtyEval = true; syncProps(); if (UI.timeline) UI.timeline.dirty = true;
    clearTimeout(R.camEditTimer); R.camEditTimer = setTimeout(() => UI.onPropChanged(o, 'position'), 300);
  } else {
    const P = camState(o);
    c.position.set(P.position[0], P.position[1], P.position[2]); t.set(P.target[0], P.target[1], P.target[2]);
    if (c.fov !== P.fov) { c.fov = P.fov; c.updateProjectionMatrix(); }
    c.up.set(0, 1, 0); c.lookAt(t);
  }
  R.camSync = { p: c.position.clone(), t: t.clone(), id: o.id };
  if (!S || S.id !== o.id) updateCamLabel();
}
function camForOutput(aspect, useScene, output) {
  const co = useScene ? sceneCamObj() : null;
  const cam = new THREE.PerspectiveCamera(R.camera.fov, aspect, 0.05, 600);
  if (co) {
    const P = camState(co);
    cam.fov = P.fov; cam.position.set(...P.position); cam.up.set(0, 1, 0); cam.lookAt(new THREE.Vector3(...P.target));
  } else { cam.position.copy(R.camera.position); cam.quaternion.copy(R.camera.quaternion); }
  if (output) {
    // export exactly the crop frame shown in the viewport (same vertical view as the viewport, narrowed by the crop)
    const vp = R.vp, av = Math.max(1, vp.clientWidth) / Math.max(1, vp.clientHeight), fr = cropFrame(aspect, av);
    cam.fov = 2 * Math.atan(Math.tan(cam.fov * DEG / 2) * fr.h) / DEG;
  }
  cam.aspect = aspect; cam.updateProjectionMatrix(); cam.updateMatrixWorld(true);
  return cam;
}
function viewCam() {
  if (!APP.camView) return R.camera;
  const vp = R.vp; const a = Math.max(1, vp.clientWidth) / Math.max(1, vp.clientHeight);
  R.camCam = camForOutput(a, true);
  return R.camCam;
}

/* ---------- picking & blasting ---------- */
const RAY = new THREE.Raycaster();
function rayFrom(e) {
  const r = R.renderer.domElement.getBoundingClientRect();
  const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  RAY.setFromCamera(ndc, viewCam());
  return RAY.ray;
}
function visibleChain(m) { for (let o = m; o; o = o.parent) if (o.visible === false) return false; return true; }
function pickParticles(ray) {
  if (!SIM.layout || !SIM.disp || SIM.layoutDirty) return null;
  const d = SIM.disp, st = SIM.dispSt, o = ray.origin, v = ray.direction;
  let best = null;
  for (const L of SIM.layout) {
    const P = L.obj._eval || L.obj.props; if (P.visible === false) continue;
    const r = L.data.spacing * 0.8, r2 = r * r;
    for (let i = L.start; i < L.start + L.data.count; i++) {
      if (MOL.shading === 'skin' && st && st[i] === 0 && false) continue;
      const px = d[3 * i] - o.x, py = d[3 * i + 1] - o.y, pz = d[3 * i + 2] - o.z;
      const t = px * v.x + py * v.y + pz * v.z; if (t < 0.05) continue;
      const q = px * px + py * py + pz * pz - t * t;
      if (q < r2 && (!best || t < best.t)) best = { t, objId: L.obj.id, i };
    }
  }
  return best;
}
function pickAt(e) { return pickRay(rayFrom(e)); }
// what the ray (already set on RAY) hits first: an object's mesh, a body's molecules, or the floor
function pickRay(ray) {
  const meshes = [];
  for (const [id, v] of APP.views) {
    const o = v.obj; if (o.type === 'camera' && (APP.camView || APP.renderMode)) continue;
    for (const m of v.pick) if (visibleChain(m) || (o.type === 'camera')) meshes.push(m);
  }
  if (BLASTMK.group.visible) for (const m of BLASTMK.group.children) meshes.push(m);
  const hits = RAY.intersectObjects(meshes, false).filter(h => visibleChain(h.object));
  const mh = hits[0] ? { t: hits[0].distance, objId: hits[0].object.userData.objId, blast: hits[0].object.userData.blastIdx, point: hits[0].point } : null;
  const ph = pickParticles(ray);
  let best = mh;
  if (ph && (!best || ph.t < best.t)) best = { t: ph.t, objId: ph.objId, point: ray.at(ph.t, new THREE.Vector3()) };
  if (!best) { const t = -ray.origin.y / ray.direction.y; if (t > 0 && isFinite(t)) return { floor: true, point: ray.at(t, new THREE.Vector3()) }; }
  return best;
}
function blastAt(p, radius, strength) {
  if (!SIM.bodyObjs().length) { flashFX(p, radius); return toast('Nothing breakable to blast. Add a humanoid or a breakable prop.'); }
  const ev = { f: 0, p: [+p.x.toFixed(3), +p.y.toFixed(3), +p.z.toFixed(3)], r: radius, s: strength };
  const c = SIM.cache;
  if (APP.playing && SIM.ready) ev.f = Math.max(SIM.nextF, APP.frame + 1);
  else {
    ev.f = APP.frame + 1;
    if (c.end >= ev.f) SIM.invalidate(); // re-simulate from the start so the blast lands exactly here
  }
  APP.scene.events = APP.scene.events || [];
  pushUndo(); // Ctrl+Z takes a blast back
  APP.scene.events.push(ev);
  if (typeof buildOutliner === 'function') buildOutliner();
  SIM.target = Math.max(SIM.target, ev.f + 2);
  if (!APP.playing) togglePlay();
  flashFX(p, radius);
  TL.dirty = true;
}
// editor markers for interactive blasts: an orange star where each went off (click to select, X to delete)
const BLASTMK = { group: null, key: '', geo: null, mat: null, matSel: null, ring: null };
function syncBlastMarks() {
  if (!BLASTMK.group) {
    BLASTMK.group = new THREE.Group(); R.helpers.add(BLASTMK.group);
    BLASTMK.geo = new THREE.OctahedronGeometry(0.1, 0);
    BLASTMK.mat = new THREE.MeshBasicMaterial({ color: '#ff9b42', wireframe: true, transparent: true, opacity: 0.85, depthTest: false });
    BLASTMK.matSel = new THREE.MeshBasicMaterial({ color: '#ffd27a', transparent: true, opacity: 0.95, depthTest: false });
    BLASTMK.ring = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 12), new THREE.MeshBasicMaterial({ color: '#ff9b42', wireframe: true, transparent: true, opacity: 0.18, depthWrite: false }));
    BLASTMK.ring.raycast = () => {}; R.helpers.add(BLASTMK.ring);
  }
  const evs = APP.scene.events || [];
  const key = JSON.stringify(evs) + '|' + APP.blastSel;
  BLASTMK.group.visible = !APP.renderMode && !APP.camView && evs.length > 0;
  BLASTMK.ring.visible = BLASTMK.group.visible && APP.blastSel != null && !!evs[APP.blastSel];
  if (key === BLASTMK.key) return;
  BLASTMK.key = key;
  if (APP.blastSel != null && !evs[APP.blastSel]) APP.blastSel = null;
  BLASTMK.group.clear();
  evs.forEach((ev, i) => {
    const m = new THREE.Mesh(BLASTMK.geo, i === APP.blastSel ? BLASTMK.matSel : BLASTMK.mat);
    m.position.set(ev.p[0], ev.p[1], ev.p[2]); m.renderOrder = 7; m.userData.blastIdx = i;
    m.scale.setScalar(i === APP.blastSel ? 1.6 : 1.2);
    BLASTMK.group.add(m);
  });
  const sel = APP.blastSel != null ? evs[APP.blastSel] : null;
  BLASTMK.ring.visible = BLASTMK.group.visible && !!sel;
  if (sel) { BLASTMK.ring.position.set(sel.p[0], sel.p[1], sel.p[2]); BLASTMK.ring.scale.setScalar(sel.r); }
}
function clearBlasts() {
  if (!APP.scene.events || !APP.scene.events.length) return toast('No interactive blasts recorded');
  pushUndo(); const n = APP.scene.events.length; APP.scene.events = []; APP.blastSel = null; SIM.invalidate(); TL.dirty = true; UI.refreshAll(); toast(`Removed ${n} blast${n > 1 ? 's' : ''}`);
}
const FX = [];
function flashFX(p, radius) {
  const m = new THREE.Mesh(GEO.ball, new THREE.MeshBasicMaterial({ color: '#ffb35c', transparent: true, opacity: 0.7, depthWrite: false, blending: THREE.AdditiveBlending }));
  m.position.copy(p); m.scale.setScalar(0.01); R.scene.add(m);
  FX.push({ m, t0: performance.now(), r: radius });
}
function updateFX(now) {
  for (let i = FX.length - 1; i >= 0; i--) {
    const f = FX[i], k = (now - f.t0) / 380;
    if (k >= 1) { R.scene.remove(f.m); f.m.material.dispose(); FX.splice(i, 1); continue; }
    f.m.scale.setScalar(f.r * (0.2 + 0.8 * Math.sqrt(k))); f.m.material.opacity = 0.7 * (1 - k);
  }
}
function initViewportInput() {
  const cv = R.renderer.domElement;
  let down = null;
  cv.addEventListener('pointerdown', (e) => {
    if (APP.recording) return;
    down = { x: e.clientX, y: e.clientY, b: e.button, t: performance.now(), gizmo: !!(R.gizmo.axis) };
  });
  cv.addEventListener('pointerup', (e) => {
    const d = down; down = null;
    if (!d || d.b !== 0 || d.gizmo || R.gizmoDragging) return;
    if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 4) return;
    const hit = pickAt(e);
    if (APP.tool === 'blast') {
      const p = hit ? hit.point.clone() : null;
      if (p) { if (hit.floor) p.y += 0.3; blastAt(p, e.shiftKey ? 1.7 : 0.85, e.shiftKey ? 24 : 13); }
      return;
    }
    if (hit && hit.blast != null) selectBlast(hit.blast);
    else if (hit && hit.objId) select([hit.objId], e.shiftKey || e.ctrlKey || e.metaKey);
    else if (!e.shiftKey) select([]);
  });
  cv.addEventListener('dblclick', (e) => { if (APP.tool !== 'blast') { const h = pickAt(e); if (h && h.objId) { select([h.objId]); frameSelected(); } } });
  cv.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4) return;
  });
  // right-click without drag on the viewport opens the object menu
  cv.addEventListener('pointerup', (e) => {
    if (e.button !== 2) return;
    if (!rdown || Math.hypot(e.clientX - rdown.x, e.clientY - rdown.y) > 4) return;
    const h = pickAt(e);
    if (h && h.blast != null) {
      const bi = h.blast; selectBlast(bi);
      return showMenu([
        { label: `Delete this blast (frame ${(APP.scene.events[bi] || {}).f})`, icon: 'trash', sc: 'X', action: () => deleteBlast(bi) },
        { label: `Delete all blasts (${APP.scene.events.length})`, icon: 'trash', action: clearBlasts },
      ], e.clientX, e.clientY);
    }
    if (h && h.objId && !APP.sel.includes(h.objId)) select([h.objId]);
    const has = selObjs().length;
    showMenu([
      { label: 'Add…', icon: 'plus', sc: '⇧ A', action: () => showMenu(ADD_ITEMS(), e.clientX, e.clientY, null, { cols: true }) },
      'sep',
      { label: 'Insert keyframe', icon: 'diamond', sc: 'I', disabled: !APP.sel.length, action: () => insertKeyframeSelected() },
      { label: 'Duplicate', icon: 'copy', sc: '⇧ D', disabled: !has, action: duplicateSelected },
      { label: 'Delete', icon: 'trash', sc: 'X', disabled: !has, action: deleteSelected },
      { label: 'Frame selected', sc: 'F', disabled: !has, action: () => frameSelected() },
      'sep',
      { label: 'Blast here', icon: 'blast', action: () => { const p = h ? h.point.clone() : null; if (p) { if (h.floor) p.y += 0.3; blastAt(p, 0.85, 13); } } },
    ], e.clientX, e.clientY);
  });
  let rdown = null;
  cv.addEventListener('pointerdown', (e) => { rdown = e.button === 2 ? { x: e.clientX, y: e.clientY } : null; });
}

/* ---------- keyboard ---------- */
const MOUSE = { x: 0, y: 0, target: null };
document.addEventListener('pointermove', (e) => { MOUSE.x = e.clientX; MOUSE.y = e.clientY; MOUSE.target = e.target; }, { passive: true });
function hoveredField() { const r = MOUSE.target && MOUSE.target.closest && MOUSE.target.closest('.row'); return r && r._field; }
function inViewport() { return MOUSE.target && R.vp.contains(MOUSE.target); }
function onKey(e) {
  if (PLAY.on) return;
  const t = e.target;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
  if (APP.recording) { if (e.key === 'Escape') { e.preventDefault(); stopRecording(true); } return; }
  const k = e.key, code = e.code, ctrl = e.ctrlKey || e.metaKey;
  const handled = () => { e.preventDefault(); e.stopPropagation(); };
  if (ctrl) {
    if (k === 'z' || k === 'Z') { handled(); e.shiftKey ? doRedo() : doUndo(); return; }
    if (k === 'y') { handled(); doRedo(); return; }
    if (k === 's' || k === 'S') { handled(); saveSceneCmd(e.shiftKey); return; }
    if (k === 'o') { handled(); openLibrary(); return; }
    if (k === 'n') { handled(); newSceneCmd(); return; }
    if (k === 'F12') { handled(); recordVideo(); return; }
    if (code === 'Numpad0') { handled(); const o = activeObj(); if (o && o.type === 'camera') lookThrough(o); else toast('Select a camera first'); return; }
    if (code && code.startsWith('Numpad') && '137'.includes(code.slice(6))) { handled(); setView({ 1: 'back', 3: 'left', 7: 'bottom' }[code.slice(6)]); return; }
    return;
  }
  if (code && code.startsWith('Numpad')) {
    const n = code.slice(6);
    if (n === '1') { handled(); setView('front'); return; }
    if (n === '3') { handled(); setView('right'); return; }
    if (n === '7') { handled(); setView('top'); return; }
    if (n === '0') { handled(); toggleCamView(); return; }
    if (n === 'Decimal') { handled(); frameSelected(); return; }
  }
  switch (k) {
    case ' ': handled(); togglePlay(); return;
    case 'ArrowLeft': handled(); e.shiftKey ? jumpStart() : stepFrame(-1); return;
    case 'ArrowRight': handled(); e.shiftKey ? jumpEnd() : stepFrame(1); return;
    case 'ArrowUp': handled(); jumpKey(1); return;
    case 'ArrowDown': handled(); jumpKey(-1); return;
    case 'F12': handled(); renderStill(); return;
    case 'Escape': if (APP.tool === 'blast') { handled(); setTool('select'); } else if (APP.camView) { handled(); toggleCamView(); } return;
    case '?': handled(); showShortcuts(); return;
    case 'Home': handled(); frameSelected(true); return;
    case 'PageDown': if (camList().length) { handled(); cycleCam(1); } return;
    case 'PageUp': if (camList().length) { handled(); cycleCam(-1); } return;
    case 'Delete': case 'Backspace': handled(); deleteSelected(); return;
  }
  const lk = k.length === 1 ? k.toLowerCase() : k;
  if (e.altKey) {
    if (lk === 'i' || code === 'KeyI') { handled(); const f = hoveredField(); if (f && keyAt(f.obj, fieldPaths(f.fd)[0], APP.frame) >= 0) toggleKey(f.obj, f.fd); else deleteKeyframeSelected(); return; }
    if (lk === 'a' || code === 'KeyA') { handled(); select([]); return; }
    return;
  }
  if (e.shiftKey) {
    if (code === 'KeyA') { handled(); showMenu(ADD_ITEMS(), MOUSE.x, MOUSE.y, null, { cols: true }); return; }
    if (code === 'KeyD') { handled(); duplicateSelected(); if (APP.tool === 'select') setTool('move'); return; }
    if (code === 'KeyH') { handled(); APP.renderMode = !APP.renderMode; updateToolbar(); APP.dirtyEval = true; syncGizmo(); return; }
    return;
  }
  switch (lk) {
    case 'g': handled(); setTool('move'); return;
    case 'r': handled(); setTool('rotate'); return;
    case 's': handled(); setTool('scale'); return;
    case 'q': handled(); setTool('select'); return;
    case 'w': handled(); setTool('select'); return;
    case 'b': handled(); setTool(APP.tool === 'blast' ? 'select' : 'blast'); return;
    case 'x': handled(); deleteSelected(); return;
    case 'a': handled(); select(allObjs().map(o => o.id)); return;
    case 'f': handled(); frameSelected(); return;
    case 'c': handled(); toggleCamView(); return;
    case 'h': handled(); APP.showGrid = !APP.showGrid; updateToolbar(); return;
    case 'i': { handled(); const f = hoveredField(); if (f && f.fd.anim) toggleKey(f.obj, f.fd); else insertKeyframeSelected(); return; }
    case '1': handled(); setShading('skin'); return;
    case '2': handled(); setShading('xray'); return;
    case '3': handled(); setShading('tissue'); return;
    case '4': handled(); setShading('molecules'); return;
  }
}

/* ---------- still image & video ---------- */
function outSize() {
  const vp = R.vp;
  if (OUT.res === 'viewport') return [Math.round(vp.clientWidth * Math.min(2, window.devicePixelRatio || 1)), Math.round(vp.clientHeight * Math.min(2, window.devicePixelRatio || 1))];
  if (OUT.res === 'custom') return [clamp(Math.round(OUT.cw) || 1920, 64, 7680), clamp(Math.round(OUT.ch) || 1080, 64, 7680)];
  const p = outPreset(OUT.res); return p ? [p[2], p[3]] : [1920, 1080];
}
// the part of the viewport (fractions of its width and height) that an output of aspect ao shows
function cropFrame(ao, av) {
  const z = Math.max(1, +OUT.zoom || 1);
  let w = 1, h = 1; if (ao >= av) h = av / ao; else w = ao / av;
  return { w: w / z, h: h / z };
}
// export range: the scene range, or the trimmed part of it
function exportRange() {
  const [s, e] = frameRange();
  let a = OUT.trimS >= 0 ? clamp(OUT.trimS | 0, s, e) : s, b = OUT.trimE >= 0 ? clamp(OUT.trimE | 0, s, e) : e;
  if (b <= a) { a = s; b = e; }
  return [a, b];
}
function enterOutputMode(w, h) {
  const r = R.renderer;
  const saved = { pr: r.getPixelRatio(), renderMode: APP.renderMode };
  APP.renderMode = true; APP.dirtyEval = true;
  r.setPixelRatio(1); r.setSize(w, h, false);
  r.domElement.style.objectFit = 'contain';
  R.gizmoHelper.visible = false;
  updateCropGuide();
  return saved;
}
function leaveOutputMode(saved) {
  const r = R.renderer;
  APP.renderMode = saved.renderMode; APP.dirtyEval = true;
  r.setPixelRatio(saved.pr); r.domElement.style.objectFit = '';
  resizeViewport(); updateCropGuide();
  R.gizmoHelper.visible = !!R.gizmo.object; R.helpers.visible = true;
}
function hideHelpers(on) {
  R.grid.visible = !on && APP.showGrid; R.helpers.visible = !on;
  for (const b of SELBOX.pool) b.visible = false;
}
async function renderStill() {
  if (APP.recording) return;
  const [w, h] = outSize();
  const saved = enterOutputMode(w, h);
  try {
    evaluateScene(APP.frame); MOL.applyStyle(); updateBodies(true); hideHelpers(true);
    const cam = camForOutput(w / h, OUT.useCam, true);
    renderScene(cam, { sceneCam: OUT.useCam, frame: APP.frame, camFn: () => camForOutput(w / h, OUT.useCam, true) });
    const blob = await new Promise(res => R.renderer.domElement.toBlob(res, 'image/png'));
    leaveOutputMode(saved);
    if (!blob) throw new Error('the browser returned no image');
    await saveFile(`${slug(APP.scene.name)}-frame-${String(APP.frame).padStart(4, '0')}.png`, blob);
  } catch (err) { leaveOutputMode(saved); toast('Render failed: ' + err.message, true); }
  APP.dirtyEval = true;
}
function pickMime() {
  const c = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4;codecs=avc1', 'video/mp4'];
  for (const m of c) if (window.MediaRecorder && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(m)) return m;
  return null;
}
async function recordVideo() {
  if (APP.recording) return stopRecording(false);
  const mime = pickMime();
  if (!VIDEO.supported && (!mime || !R.renderer.domElement.captureStream)) return toast('This browser can’t make videos. Try Chrome, Edge or Firefox.', true);
  if (APP.playing) togglePlay();
  const [s, e] = exportRange();
  APP.recording = { phase: 'sim', s, e, mime, chunks: [], frame0: APP.frame };
  setStatusHint('Preparing video… press Esc to cancel');
  if (SIM.active()) SIM.target = Math.max(SIM.target, e);
}
function recTick(now) {
  const rec = APP.recording; if (!rec) return;
  if (rec.phase === 'sim') {
    const hasBodies = SIM.active();
    const c = SIM.cache;
    const done = !hasBodies || (SIM.ready && (c.end >= rec.e || c.full));
    const prog = hasBodies && SIM.ready ? (c.end - rec.s) / Math.max(1, rec.e - rec.s) : 0;
    UI.busy(`Simulating frames for the video… ${Math.round(clamp(prog, 0, 1) * 100)}%  (Esc cancels)`, prog);
    if (!done) return;
    if (c.full && c.end < rec.e) { rec.e = c.end; toast('Memory limit reached: the video stops at frame ' + rec.e, true); }
    UI.busy(null);
    // frame-exact offline encoding where the browser has WebCodecs; real-time capture otherwise
    if (VIDEO.supported && !rec.triedEnc) {
      rec.triedEnc = true; rec.phase = 'prep';
      encodeVideo(rec).then(done => {
        if (done) return;
        if (!rec.mime || !R.renderer.domElement.captureStream) { APP.recording = null; setStatusHint(null); UI.busy(null); toast('This browser can’t make videos. Try Chrome, Edge or Firefox.', true); return; }
        rec.phase = 'sim';
      }).catch(err => { APP.recording = null; setStatusHint(null); UI.busy(null); toast('Video failed: ' + err.message, true); });
      return;
    }
    if (!rec.mime) { APP.recording = null; setStatusHint(null); return toast('This browser can’t make videos. Try Chrome, Edge or Firefox.', true); }
    // start recording
    const [w, h] = outSize();
    rec.saved = enterOutputMode(w, h);
    rec.cam = null;
    const fps = fpsOf();
    const stream = R.renderer.domElement.captureStream(fps);
    const bits = { high: 16e6, med: 8e6, low: 3e6 }[OUT.quality] || 8e6;
    try { rec.mr = new MediaRecorder(stream, { mimeType: rec.mime, videoBitsPerSecond: bits }); }
    catch (err) { leaveOutputMode(rec.saved); APP.recording = null; setStatusHint(null); return toast('Could not start recording: ' + err.message, true); }
    rec.mr.ondataavailable = (ev) => { if (ev.data && ev.data.size) rec.chunks.push(ev.data); };
    rec.mr.onstop = () => finishRecording(rec);
    APP.frame = rec.s; APP.dirtyEval = true;
    rec.mr.start(250);
    rec.t0 = now; rec.phase = 'rec'; rec.fps = fps;
    setStatusHint('Recording… press Esc to stop early');
    return;
  }
  if (rec.phase === 'rec') {
    const f = rec.s + Math.floor((now - rec.t0) / 1000 * rec.fps);
    if (f > rec.e) { rec.phase = 'stop'; rec.mr.stop(); return; }
    if (f !== APP.frame) { APP.frame = f; APP.dirtyEval = true; TL.dirty = true; TL.updateFrameField(); }
    UI.busy(null);
  }
}
function stopRecording(cancel) {
  const rec = APP.recording; if (!rec) return;
  if (rec.phase === 'prep' || rec.phase === 'enc') { rec.cancel = true; return; }
  if (rec.phase === 'sim') { APP.recording = null; UI.busy(null); setStatusHint(null); toast('Video cancelled'); return; }
  // Esc while recording stops early and keeps what was recorded so far
  if (rec.phase === 'rec') { rec.phase = 'stop'; rec.mr.stop(); }
}
async function finishRecording(rec) {
  leaveOutputMode(rec.saved);
  APP.recording = null; setStatusHint(null); UI.busy(null);
  if (rec.cancel || !rec.chunks.length) { toast('Video cancelled'); return; }
  const type = rec.mime.split(';')[0];
  const blob = new Blob(rec.chunks, { type });
  const ext = type === 'video/mp4' ? 'mp4' : 'webm';
  await saveFile(`${slug(APP.scene.name)}.${ext}`, blob);
}

/* ---------- display of molecular bodies ---------- */
const SELBOX = { pool: [] };
let _dispKey = '';
function updateBodies(force) {
  if (!SIM.layout || !SIM.disp || !SIM.N) { if (MOL.pts) MOL.pts.count = 0; for (const b of MOL.bodies) b.skin.visible = b.inner.visible = false; return; }
  const c = SIM.cache, f = APP.frame;
  let src = 'rest', sf = f;
  if (SIM.has(f)) src = 'cache';
  else if (SIM.ready && c.end >= c.start && f > c.end) { src = 'cache'; sf = c.end; }
  else if (!SIM.ready && SIM.target >= f && _dispKey && !SIM.layoutDirty && (SIM.building || SIM.layoutBusy || SIM.layoutQueued)) src = 'hold';
  const key = `${MOL.shading}|${MOL.style}|${MOL.size}|${SIM.token}|${src}|${sf}|${SIM.layoutSigCur ? SIM.layoutSigCur.length : 0}|${src === 'rest' ? APP.evalStamp : ''}`;
  if (!force && key === _dispKey) return;
  if (src === 'hold') return;
  _dispKey = key;
  if (src === 'cache') SIM.load(sf, SIM.disp, SIM.dispSt);
  else { SIM.restPositions(f, SIM.disp); SIM.dispSt.fill(0); }
  MOL.upload(SIM.disp, SIM.dispSt, SIM.skelAt(sf, src, 0));
}
function updateSelectionBoxes() {
  const show = !APP.renderMode && !APP.recording;
  const objs = show ? selObjs().filter(o => o.type !== 'camera' && (o._eval || o.props).visible !== false) : [];
  while (SELBOX.pool.length < objs.length) { const b = new THREE.Box3Helper(new THREE.Box3(), new THREE.Color('#ffae42')); b.material.transparent = true; b.material.opacity = 0.9; b.material.depthTest = false; b.renderOrder = 10; R.helpers.add(b); SELBOX.pool.push(b); }
  SELBOX.pool.forEach((b, i) => {
    if (i >= objs.length) { b.visible = false; return; }
    const o = objs[i]; b.visible = true;
    b.box.copy(selectionBox(o)).expandByScalar(0.02);
    b.material.color.set(o.id === APP.active ? '#ffae42' : '#b8772c');
  });
}

/* ---------- main loop ---------- */
const LOOP = { last: performance.now(), frames: 0, fpsT: performance.now(), fps: 0, statsT: 0 };
APP.evalStamp = 0;
function frameLoop(now) {
  requestAnimationFrame(frameLoop);
  // play mode runs its own loop (VR drives it from the headset's frame loop instead)
  if (PLAY.on) { if (!PLAY.xr) playFrame(now); return; }
  // optional frame cap (saves battery and heat on laptops)
  if (PERF.fpsCap > 0 && now - LOOP.last < 1000 / PERF.fpsCap - 2) return;
  const ms = now - LOOP.last; LOOP.last = now;
  frameBody(now);
  perfWatch(now, ms);
}
function frameBody(now) {
  LOOP.frames++;
  if (now - LOOP.fpsT > 500) { LOOP.fps = LOOP.frames * 1000 / (now - LOOP.fpsT); LOOP.frames = 0; LOOP.fpsT = now; }
  // view animation
  if (APP.viewAnim) {
    const a = APP.viewAnim, k = clamp((now - a.t0) / a.dur, 0, 1), s = k * k * (3 - 2 * k);
    R.camera.position.lerpVectors(a.p0, a.p1, s); R.controls.target.lerpVectors(a.t0v, a.t1, s);
    if (k >= 1) APP.viewAnim = null;
  }
  R.controls.update();
  // playback
  const [s, e] = frameRange();
  const hasBodies = SIM.active();
  if (APP.recording && (APP.recording.phase === 'enc' || APP.recording.phase === 'prep')) {
    // the offline encoder drives rendering itself
    if (now - LOOP.statsT > 250) { LOOP.statsT = now; updateStats(); }
    if (APP.recording.phase === 'enc') return;
  }
  if (APP.recording) recTick(now);
  else if (APP.playing) {
    const rate = fpsOf() * (APP.playSpeed || 1);
    let ff = APP.playFrameF + (now - APP.playClock) / 1000 * rate;
    // past the end: wrap (or stop) before the cache-wait clamp, which would otherwise pin playback to the last frame
    if (Math.floor(ff) > e) {
      if (APP.loop) { ff = s + (ff - s) % (e - s + 1); APP.playFrameF = ff; APP.playClock = now; }
      else { ff = e; APP.playFrameF = e; APP.playClock = now; togglePlay(); }
    }
    if (APP.playing && hasBodies) {
      SIM.target = Math.max(SIM.target, Math.min(e, Math.floor(ff) + 8));
      const avail = SIM.ready ? SIM.cache.end : s - 1;
      // the cache is full: nothing more will be simulated, so play up to the last cached frame and loop or stop there
      if (SIM.cache.full && Math.floor(ff) > avail && avail > s) {
        if (APP.loop) { ff = s + (ff - s) % (avail - s + 1); APP.playFrameF = ff; APP.playClock = now; }
        else { ff = avail; APP.playFrameF = avail; APP.playClock = now; togglePlay(); }
        APP.waiting = false;
      } else if (Math.floor(ff) > avail) {
        const hold = Math.max(Math.min(APP.frame, avail), s);
        APP.waiting = true;
        APP.playFrameF = Math.max(hold, Math.min(Math.floor(ff), avail)); APP.playClock = now; ff = APP.playFrameF;
      } else APP.waiting = false;
    }
    let nf = Math.floor(ff);
    if (nf > e) {
      if (APP.loop) { nf = s; APP.playFrameF = s; APP.playClock = now; }
      else { nf = e; togglePlay(); }
    }
    if (nf !== APP.frame) { APP.frame = nf; APP.dirtyEval = true; TL.dirty = true; TL.updateFrameField(); }
  }
  // simulation and layout
  SIM.syncLayout();
  SIM.pump();
  // scene evaluation
  if (APP.dirtyEval || APP.frame !== APP.lastEvalFrame) {
    APP.dirtyEval = false; APP.lastEvalFrame = APP.frame; APP.evalStamp++;
    evaluateScene(APP.frame);
    applyWorldLook(APP.worldP);
    for (const b of MOL.bodies) if (!b.isHuman) { const P = b.obj._eval || b.obj.props; if ((P.color || '') !== b.colorKey) { MOL.recolor(); break; } }
    MOL.applyStyle();
    if (!APP.playing && !R.gizmoDragging) syncGizmo();
    if (!APP.playing && !APP.recording && PROPS.lastSyncFrame !== APP.frame) { PROPS.lastSyncFrame = APP.frame; syncProps(); }
  }
  updateBodies();
  camFollowVisuals();
  // after the bodies so a camera following one sees where it is this frame
  if (APP.camView) camViewSync();
  updateFX(now);
  // helpers
  const out = !!APP.recording && APP.recording.phase !== 'sim';
  R.grid.visible = APP.showGrid && !APP.renderMode && !APP.camView && !out;
  if (R.gizmo.object && (APP.playing || out)) R.gizmo.detach();
  R.gizmoHelper.visible = !out && !!R.gizmo.object;
  updateSelectionBoxes();
  syncBlastMarks();
  // render
  R.helpers.visible = !out;
  const cam = out ? camForOutput(R.renderer.domElement.width / R.renderer.domElement.height, OUT.useCam, true) : viewCam();
  R.gizmo.camera = cam;
  if (REMOTE.on && !out) REMOTE.capture(now);
  viewportRender(cam, out);
  drawNavGizmo();
  if (TL.dirty || TL.lastFrame !== APP.frame || TL.lastCache !== SIM.cache.end) TL.draw();
  if (now - LOOP.statsT > 250) { LOOP.statsT = now; updateStats(); }
}
// editor view: effects show only while looking through the scene camera (or in output mode). Motion blur
// waits until the view has been still for a moment, then the blurred image is kept until something changes.
const VFX = { sig: '', still: 0, valid: false };
function viewportRender(cam, out) {
  const scene = out ? OUT.useCam : APP.camView;
  // not while the simulation is still running either: each new frame re-rendered all the blur samples, and on a
  // graphics card that also runs the GPU physics that slowed the simulation itself down a lot
  const simming = SIM.target >= 0 && SIM.cache.end < SIM.target;
  const wantMB = FXS.mblur && scene && !APP.playing && !APP.recording && !R.gizmoDragging && !simming;
  const dofNow = !!scene && dofEnabled(sceneCamObj());
  if (!dofNow && !wantMB) { VFX.valid = false; R.renderer.render(R.scene, cam); return; }
  const e = cam.matrixWorld.elements;
  const sig = (dofNow ? 'd' : '') + (wantMB ? 'm' + FXS.samples + FXS.shutter : '') + '|' + APP.frame + '|' + APP.evalStamp + '|' + _dispKey + '|' + (SIM.cache.end > APP.frame ? 1 : 0) + '|' + R.renderer.domElement.width + 'x' + R.renderer.domElement.height + '|' + e[12].toFixed(4) + e[13].toFixed(4) + e[14].toFixed(4) + e[8].toFixed(4) + e[9].toFixed(4) + e[10].toFixed(4) + '|' + cam.fov;
  const now = performance.now();
  if (sig !== VFX.sig) { VFX.sig = sig; VFX.still = now; VFX.valid = false; }
  if (wantMB && VFX.valid && POSTFX.acc) { POSTFX.matCopy.uniforms.tColor.value = POSTFX.acc.texture; POSTFX.pass(POSTFX.matCopy, null, false); return; }
  if (wantMB && now - VFX.still > 250) {
    const key0 = _dispKey;
    renderScene(cam, { sceneCam: true, frame: APP.frame, camFn: () => viewCam() });
    _dispKey = key0; VFX.valid = true; VFX.sig = sig; return;
  }
  renderScene(cam, { sceneCam: true, frame: APP.frame, motion: false });
}
function updateStats() {
  $('#pill-fps').textContent = `${Math.round(LOOP.fps)} fps`;
  const pill = $('#pill-sim');
  const c = SIM.cache, hasBodies = SIM.active();
  let t = 'Ready', cls = '';
  if (APP.recording) { const ph = APP.recording.phase; t = APP.recording.phone ? 'Making phone clip' : ph === 'sim' || ph === 'prep' ? 'Preparing video' : ph === 'enc' ? 'Rendering video' : '● Recording'; cls = 'warn'; }
  else if (SIM.layoutBusy || SIM.building) { t = 'Building bodies…'; cls = 'warn'; }
  else if (c.full) { t = `Cache full at ${c.end}`; cls = 'warn'; }
  else if (hasBodies && SIM.target > c.end && SIM.ready && c.end < frameRange()[1] && !c.full) { t = `Simulating ${c.end}`; cls = 'live'; }
  else if (APP.playing && APP.waiting) { t = 'Waiting for simulation'; cls = 'warn'; }
  else if (APP.playing) { t = 'Playing'; cls = 'live'; }
  else if (hasBodies && c.end >= c.start) t = `Cached to ${c.end}`;
  pill.textContent = t; pill.className = 'pill ' + cls;
  const N = SIM.N || 0;
  const broken = SIM.has(APP.frame) || c.end >= c.start ? SIM.broken : 0;
  const tsec = timeOf(APP.frame) - timeOf(frameRange()[0]);
  const fx = (SIM.fractures || []).filter(x => x.f <= APP.frame), nb = new Set(fx.map(x => x.body + ':' + x.seg)).size;
  $('#status-stats').textContent = `${N.toLocaleString()} molecules · ${broken.toLocaleString()} bonds broken · ${SIM.ms ? SIM.ms.toFixed(1) + ' ms/step' : 'idle'} · frame ${APP.frame}`;
  const vs = $('#vp-stats');
  const lines = [`${APP.scene.name}`, `Frame ${APP.frame}  ·  ${tsec.toFixed(2)} s`, `Objects ${allObjs().length}  ·  Molecules ${N.toLocaleString()}`];
  if (N) lines.push(`Visible molecules ${(MOL.visibleCount || 0).toLocaleString()}  ·  Awake ${SIM.awake || 0}`);
  if (nb) lines.push('Fractures: ' + [...new Set(fx.map(x => x.name))].slice(0, 4).join(', ') + (nb > 4 ? ` +${nb - 4}` : ''));
  vs.textContent = APP.renderMode ? '' : lines.join('\n');
  TL.updateCacheText();
  if (PROPS.tab === 'scene') { const ci = $('#cache-info'); if (ci) ci.textContent = cacheSummary(); }
}

/* ---------- boot ---------- */
function boot() {
  try {
    initRenderer();
    initPerf();
  } catch (err) {
    console.error(err);
    $('#viewport').append(el('div', { class: 'vp-hint', style: { bottom: 'auto', top: '45%' } }, 'WebGL is not available in this browser, so the 3D view can’t start.'));
    return;
  }
  APP.scene = newScene(); rebuildTimeTable();
  initUI();
  // saved animations come in from storage shortly after start; the Animation menus list them once they are there
  ANIMLIB.load().then(() => { if (ANIMLIB.items.size) buildProps(); }).catch(() => {});
  // dropping .fbx files onto the window imports them as animations
  window.addEventListener('dragover', (e) => { if (e.dataTransfer && [...e.dataTransfer.items || []].some(i => i.kind === 'file')) e.preventDefault(); });
  window.addEventListener('drop', (e) => {
    const fs = [...((e.dataTransfer && e.dataTransfer.files) || [])].filter(f => /\.fbx$/i.test(f.name));
    if (!fs.length) return;
    e.preventDefault(); importMixamo(fs);
  });
  initTimeline();
  initViewportInput();
  SIM.init();
  applyPixelRatio();
  document.addEventListener('keydown', onKey);
  // restore the last session, else open the signature demo
  let restored = false;
  try {
    const s = localStorage.getItem(AUTO_KEY);
    if (s) { const d = JSON.parse(s); if (d && d.world && Array.isArray(d.objects)) { activateScene(d, { toCamera: true }); restored = true; _lastAuto = s; } }
  } catch (e) { restored = false; }
  if (!restored) { activateScene(sceneFromDemo(DEMOS[0]), { toCamera: true }); }
  APP.undo = []; APP.redo = [];
  setInterval(autosave, 4000);
  window.addEventListener('beforeunload', autosave);
  requestAnimationFrame(frameLoop);
  REMOTE.init();
  playVRBoot();
  setTimeout(() => {
    if (restored) toast('Restored your last session');
    else toast('Press Space to play the hammer demo. More demos are in the Scenes menu.');
  }, 400);
  // build the anatomy ahead of time so the first Play starts quickly
  setTimeout(() => { if (!SIM.ready && SIM.active()) SIM.ensureLayout().catch(() => {}); }, 300);
}
// handle for debugging from the browser console
window.SB = { APP, SIM, HDEF, PERF, FXS, POSTFX, RIG, ANIM_CLIPS, ANIMLIB, TL, MOL, R, UI, REMOTE, PLAY, PROPS, OUT, TYPES, DEMOS, MOTIONS, fn: { updateCropGuide, outSize, camForOutput, exportRange, loadDemo, addObject, addObjectAtCursor, select, setTool, setShading, insertKeyframeSelected, togglePlay, setFrame, renderStill, recordVideo, openLibrary, saveSceneCmd, showShortcuts, showAbout, showTips, applyMotion, doUndo, doRedo, buildProps, setProp, duplicateSelected, deleteSelected, resetSim, bakeAll, toggleCamView, frameSelected, blastAt, exportJSON, evalProps, snapshot, insertKey, changed, selectionBox, activateScene, retargetFBX, importMixamo, openAnimLibrary, sceneCam: (f) => sceneCamObj(f), camState, lookThrough, followShots, cycleCam, followAnchor, deleteBlast, selectBlast, clearBlasts, dofParams, dofEnabled, camFocusDist, emitTable, emitCount, pickAt, V3: THREE.Vector3, enterPlay, exitPlay, playSpawn, playFire, playStep, emptyScene: () => activateScene(newScene('Test'), { undoable: false }) } };
boot();
