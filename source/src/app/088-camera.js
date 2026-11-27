/* ===================== cameras: active camera, switching, follow an object ===================== */
// Which camera films a frame: a camera picked with "Look through" (scene world prop activeCam) always wins;
// with no pick, cameras with a "Shot starts at frame" cut between each other; otherwise the first visible camera.
function camList() { return allObjs().filter(o => o.type === 'camera'); }
function camShots() { return camList().filter(o => o.props.shotStart >= 0); }
function pinnedCam() { const id = APP.scene && APP.scene.world.props.activeCam; return id ? camList().find(o => o.id === id) || null : null; }
function setPinnedCam(id) {
  const W = APP.scene.world;
  if ((W.props.activeCam || '') === (id || '')) return false;
  pushUndo(); W.props.activeCam = id || '';
  APP.dirtyEval = true; R.camSync = null; if (UI.timeline) UI.timeline.dirty = true; TL.dirty = true;
  return true;
}
// look through a specific camera (enters camera view if needed) and make it the one renders use
function lookThrough(o) {
  if (!o || o.type !== 'camera') return;
  setPinnedCam(o.id);
  if (!APP.camView) toggleCamView(); else { R.camSync = null; camViewSync(); updateCamLabel(); }
  const shots = camShots().length;
  toast(shots > 1 ? `Looking through ${o.name}. Shot cuts are paused; pick "Follow shots" in the camera menu to use them again.` : `Looking through ${o.name}`);
  if (typeof buildProps === 'function' && PROPS.tab === 'render') buildProps();
}
function followShots() {
  setPinnedCam('');
  if (APP.camView) { R.camSync = null; camViewSync(); updateCamLabel(); }
  toast('Cameras cut by their shot start frames again');
  if (typeof buildProps === 'function' && PROPS.tab === 'render') buildProps();
}
function cycleCam(dir) {
  const cams = camList(); if (!cams.length) return;
  const cur = sceneCamObj(), i = Math.max(0, cams.indexOf(cur));
  lookThrough(cams[(i + dir + cams.length) % cams.length]);
}
function updateCamLabel() {
  const lab = $('.vp-cam-label'); if (!lab) return;
  const o = sceneCamObj(); const P = o && (o._eval || o.props);
  const t = o ? `Camera view · ${o.name}` + (P && P.followObj && objById(P.followObj) ? ` · following ${objById(P.followObj).name}` : '') + (!pinnedCam() && camShots().length > 1 ? ' · shots' : '') : 'Camera view';
  if (lab.textContent !== t) lab.textContent = t;
}
function cameraMenuItems() {
  const cams = camList(), cur = sceneCamObj(), pin = pinnedCam(), shots = camShots();
  const items = [{ hdr: cams.length ? 'Look through' : 'No cameras yet' }];
  for (const o of cams) items.push({ label: o.name + (o.props.shotStart >= 0 ? `  (shot from ${o.props.shotStart})` : ''), checked: APP.camView ? o === cur : o === pin, action: () => lookThrough(o) });
  if (shots.length) items.push('sep', { label: shots.length > 1 ? 'Follow shots (cut between cameras)' : 'Follow shots', checked: !pin, action: () => followShots(), disabled: !pin });
  items.push('sep', { label: 'Add a camera at this view', icon: 'camera', action: () => { const o = addCameraFromView(); if (APP.camView) lookThrough(o); } });
  if (APP.camView) items.push({ label: 'Leave camera view', sc: 'Esc', action: () => toggleCamView() });
  else if (cams.length > 1) items.push({ label: 'Next / previous camera', sc: 'PgDn / PgUp', disabled: true });
  return items;
}

/* ---------- follow an object ---------- */
// The point a camera follows: the centre of mass of a body's molecules where it is simulated (smooth even
// while it breaks apart, unlike a bounding box), else the middle of the object's shape.
function followAnchor(o) {
  const L = SIM.layout && SIM.N && SIM.disp && !SIM.layoutDirty && SIM.layout.find(l => l.obj.id === o.id);
  if (L) {
    const d = SIM.disp, st = SIM.dispSt; let x = 0, y = 0, z = 0, n = 0;
    for (let i = L.start; i < L.start + L.data.count; i++) { if (st && st[i] === 2) continue; x += d[3 * i]; y += d[3 * i + 1]; z += d[3 * i + 2]; n++; }
    if (n) return new THREE.Vector3(x / n, y / n, z / n);
  }
  const b = selectionBox(o); if (b.isEmpty()) return null;
  return b.getCenter(new THREE.Vector3());
}
const CAMF = { key: '', map: new Map() };
// a camera's position, aim and lens right now, with following applied. _fd is how far following moved it
// (subtract it when writing an edited position back), _look is set when following decides where it aims.
function camState(o, P) {
  P = P || o._eval || evalProps(o, APP.frame);
  const fo = P.followObj ? objById(P.followObj) : null;
  if (!fo || fo === o || fo.type === 'camera' || fo.type === 'world') return P;
  // cached per displayed frame; not while motion blur swaps sub-frames in (it clears _dispKey)
  const dk = _dispKey, key = dk + '|' + APP.evalStamp + '|' + APP.frame;
  if (key !== CAMF.key) { CAMF.key = key; CAMF.map.clear(); }
  let a = dk ? CAMF.map.get(fo.id) : null;
  if (!a) { a = followAnchor(fo); if (!a) return P; CAMF.map.set(fo.id, a); }
  const out = Object.assign({}, P), mode = P.followMode || 'look';
  const aim = Array.isArray(P.followAim) ? P.followAim : [0, 0, 0];
  let d = [0, 0, 0];
  if (mode === 'move' || mode === 'chase') {
    // the reference point is where the object was when the camera was anchored (set now if it never was)
    if (!Array.isArray(o.props.followRef)) o.props.followRef = [a.x, a.y, a.z].map(v => +v.toFixed(4));
    const ref = o.props.followRef;
    d = [a.x - ref[0], P.followKeepY ? 0 : a.y - ref[1], a.z - ref[2]];
    out.position = [P.position[0] + d[0], P.position[1] + d[1], P.position[2] + d[2]];
    out.target = [P.target[0] + d[0], P.target[1] + d[1], P.target[2] + d[2]];
  }
  if (mode === 'look' || mode === 'chase') { out.target = [a.x + aim[0], a.y + aim[1], a.z + aim[2]]; out._look = true; }
  out._fd = d;
  return out;
}
// after a change to who or how a camera follows: keep it exactly where it is on screen at this frame
function rebaseFollow(o, before) {
  const P = o.props, fo = P.followObj ? objById(P.followObj) : null;
  if (!fo) delete P.followRef;
  else { const a = followAnchor(fo); if (!a) return; P.followRef = [a.x, a.y, a.z].map(v => +v.toFixed(4)); }
  if (before) {
    const r4 = (v) => +v.toFixed(4), cur = evalProps(o, APP.frame);
    for (let i = 0; i < 3; i++) {
      if (Math.abs(before.position[i] - cur.position[i]) > 1e-6) setProp(o, 'position', r4(before.position[i]), i, { silent: true });
      if (Math.abs(before.target[i] - cur.target[i]) > 1e-6) setProp(o, 'target', r4(before.target[i]), i, { silent: true });
    }
  }
  APP.dirtyEval = true; R.camSync = null;
}
function followOptions(self) {
  return [['', 'Nothing (camera stays put)'], ...allObjs().filter(x => x.type !== 'camera' && (!self || x.id !== self.id)).map(x => [x.id, x.name])];
}
// the camera models in the viewport show where following cameras really are (bodies move after evaluation)
function camFollowVisuals() {
  for (const o of allObjs()) {
    if (o.type !== 'camera') continue;
    const P = o._eval; if (!P || !P.followObj) continue;
    const v = APP.views.get(o.id); if (!v) continue;
    TYPES.camera.apply(v, camState(o, P));
  }
}
