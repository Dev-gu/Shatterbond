/* ===================== timeline: transport, dope sheet, keyframe editing ===================== */
const TL = {
  dirty: true, sig: '', rows: [], f0: -4, f1: 304, scrollY: 0, rowH: 20, rulerH: 24, cacheH: 5,
  sel: new Map(), // key object -> { obj, path }
  expanded: new Set(), collapsed: new Set(), w: 1, h: 1, dpr: 1, drag: null, hoverKey: null, lastFrame: -1, lastCache: -1,
  canvas: null, ctx: null,
};
UI.timeline = TL;

/* ---------- frame helpers & transport ---------- */
function frameRange() { const W = APP.scene.world.props; return [W.frameStart | 0, Math.max((W.frameEnd | 0), (W.frameStart | 0) + 1)]; }
function setFrame(f, opts = {}) {
  const [s, e] = frameRange();
  f = Math.round(clamp(f, s, e));
  if (f === APP.frame && !opts.force) return;
  APP.frame = f; APP.dirtyEval = true; TL.dirty = true;
  if (SIM.active() && !opts.noSim) SIM.target = Math.max(SIM.target, f);
  if (!APP.playing) { syncProps(); syncGizmo(); }
  TL.updateFrameField();
}
function togglePlay() {
  if (APP.playing) { APP.playing = false; APP.playFrameF = APP.frame; }
  else {
    const [s, e] = frameRange();
    if (APP.frame >= e) setFrame(s);
    APP.playing = true; APP.playClock = performance.now(); APP.playFrameF = APP.frame; APP.waiting = false;
  }
  syncGizmo(); TL.updateBar();
  if (!APP.playing) syncProps();
}
function jumpStart() { setFrame(frameRange()[0]); }
function jumpEnd() { setFrame(frameRange()[1]); }
function stepFrame(d) { if (APP.playing) togglePlay(); setFrame(APP.frame + d); }
function resetSim() {
  APP.playing = false;
  SIM.invalidate();
  setFrame(frameRange()[0], { force: true, noSim: true });
  TL.updateBar(); syncGizmo(); syncProps();
  toast('Simulation reset to the start');
}
function clearCache() { SIM.invalidate(); APP.dirtyEval = true; TL.dirty = true; syncProps(); toast('Simulation cache cleared'); }
function bakeAll() {
  if (!SIM.active()) return toast('Nothing to simulate: add a humanoid or a breakable prop');
  SIM.target = frameRange()[1];
  toast('Simulating every frame in the background…');
}
function visibleAnimObjs() {
  const sel = APP.sel.map(objById).filter(Boolean);
  return sel.length ? sel : [APP.scene.world, ...allObjs()];
}
function jumpKey(dir) {
  const frames = new Set();
  for (const o of visibleAnimObjs()) for (const f of allKeyFrames(o)) frames.add(f);
  const list = [...frames].sort((a, b) => a - b);
  const f = dir > 0 ? list.find(x => x > APP.frame) : list.reverse().find(x => x < APP.frame);
  if (f == null) return toast(dir > 0 ? 'No later keyframe' : 'No earlier keyframe');
  if (APP.playing) togglePlay();
  setFrame(f);
}
function keyPathsFor(o) {
  if (o.type === 'world') return ['timeScale', 'gravity'];
  const P = o.props, out = [];
  if (o.type === 'camera') { for (const k of ['position', 'target']) for (let i = 0; i < 3; i++) out.push(`${k}.${i}`); out.push('fov'); return out; }
  for (const k of ['position', 'rotation', 'scale']) if (Array.isArray(P[k])) for (let i = 0; i < 3; i++) out.push(`${k}.${i}`);
  return out;
}
function insertKeyframeSelected(field) {
  const objs = APP.sel.map(objById).filter(Boolean);
  if (!objs.length) return toast('Select something to keyframe');
  pushUndo();
  let n = 0;
  for (const o of objs) {
    const P = evalProps(o, APP.frame);
    for (const p of keyPathsFor(o)) { insertKey(o, p, APP.frame, getPath(P, p)); n++; }
    changed(o, simRel(o, 'position'));
  }
  UI.onPropChanged(objs[0], 'position'); TL.rebuildLabels();
  toast(`Keyed ${objs.length === 1 ? objs[0].name : objs.length + ' objects'} at frame ${APP.frame}`);
}
function deleteKeyframeSelected() {
  const objs = APP.sel.map(objById).filter(Boolean);
  let n = 0; pushUndo();
  for (const o of objs) {
    if (!o.anim) continue;
    const P = evalProps(o, APP.frame);
    for (const p of Object.keys(o.anim)) if (keyAt(o, p, APP.frame) >= 0) { deleteKey(o, p, APP.frame); if (!isAnimated(o, p)) setPath(o.props, p, getPath(P, p)); n++; }
    changed(o);
  }
  if (!n) { APP.undo.pop(); return toast('No keyframes on this frame'); }
  TL.sel.clear(); UI.onPropChanged(objs[0], 'position'); TL.rebuildLabels();
  toast(`Removed ${n} keyframe${n > 1 ? 's' : ''}`);
}
function clearAnimSelected() {
  const objs = APP.sel.map(objById).filter(o => o && o.anim && Object.keys(o.anim).length);
  if (!objs.length) return toast('Nothing animated in the selection');
  pushUndo();
  for (const o of objs) { o.props = evalProps(o, APP.frame); o.anim = {}; changed(o); }
  TL.sel.clear(); UI.onPropChanged(objs[0], 'position'); TL.rebuildLabels();
  toast('Animation cleared');
}

/* ---------- rows ---------- */
TL.labelSig = function () {
  const objs = this.objs();
  return objs.map(o => o.id + (this.isOpen(o) ? '+' + Object.keys(o.anim || {}).sort().join(',') : '') + ':' + o.name).join('|');
};
TL.objs = function () {
  const sel = APP.sel.map(objById).filter(Boolean);
  if (sel.length) return sel;
  return [APP.scene.world, ...allObjs()].filter(o => o.anim && Object.keys(o.anim).length);
};
TL.isOpen = function (o) { return this.expanded.has(o.id) || (APP.sel.includes(o.id) && !this.collapsed.has(o.id)); };
TL.rebuildLabels = function () {
  const objs = this.objs();
  const rows = [{ type: 'sum', label: APP.sel.length ? 'Selection' : 'Animated objects' }];
  for (const o of objs) {
    rows.push({ type: 'obj', obj: o, label: o.type === 'world' ? 'World & time' : o.name });
    if (this.isOpen(o) && o.anim) {
      const paths = Object.keys(o.anim).filter(p => o.anim[p].length);
      const order = (p) => { const [k, i] = splitPath(p); const g = ['position', 'rotation', 'scale', 'target'].indexOf(k); return (g < 0 ? 9 : g) * 10 + Math.max(0, i); };
      paths.sort((a, b) => order(a) - order(b) || a.localeCompare(b));
      for (const p of paths) rows.push({ type: 'ch', obj: o, path: p, label: channelLabel(o, p) });
    }
  }
  this.rows = rows;
  this.sig = this.labelSig();
  const box = $('#tl-labels'); box.textContent = '';
  const inner = el('div', { class: 'tl-lab-inner' });
  for (const r of rows) {
    let row;
    if (r.type === 'sum') row = el('div', { class: 'lab sum' }, el('span', { class: 'dot', style: { background: 'var(--fg3)' } }), r.label);
    else if (r.type === 'obj') {
      const open = this.isOpen(r.obj);
      const has = r.obj.anim && Object.keys(r.obj.anim).length;
      row = el('div', { class: 'lab obj' + (APP.sel.includes(r.obj.id) ? ' on' : ''), title: has ? 'Click to show or hide channels' : 'No keyframes yet' },
        el('span', { class: 'car', html: has ? ICON.chev : '' }), el('span', { class: 'lic', html: r.obj.type === 'world' ? ICON.world : ICON[TYPES[r.obj.type].icon] }), el('span', { class: 'ln' }, r.label));
      if (!open) row.classList.add('closed');
      row.onclick = () => { if (open) { this.expanded.delete(r.obj.id); this.collapsed.add(r.obj.id); } else { this.expanded.add(r.obj.id); this.collapsed.delete(r.obj.id); } this.rebuildLabels(); this.dirty = true; };
    } else {
      const [, i] = splitPath(r.path);
      const col = i >= 0 ? ['var(--axis-x)', 'var(--axis-y)', 'var(--axis-z)'][i] : 'var(--keyanim)';
      row = el('div', { class: 'lab ch' }, el('span', { class: 'dot', style: { background: col } }), el('span', { class: 'ln' }, r.label));
      row.onclick = (e) => { if (!e.shiftKey) this.sel.clear(); for (const k of r.obj.anim[r.path] || []) this.sel.set(k, { obj: r.obj, path: r.path }); this.dirty = true; };
      row.oncontextmenu = (e) => menuAt([
        { label: 'Select keys in this channel', action: () => { this.sel.clear(); for (const k of r.obj.anim[r.path] || []) this.sel.set(k, { obj: r.obj, path: r.path }); this.dirty = true; } },
        { label: 'Clear this channel', icon: 'trash', action: () => { pushUndo(); const P = evalProps(r.obj, APP.frame); delete r.obj.anim[r.path]; setPath(r.obj.props, r.path, getPath(P, r.path)); changed(r.obj); UI.onPropChanged(r.obj, splitPath(r.path)[0]); this.rebuildLabels(); } },
      ], e);
    }
    inner.append(row);
  }
  if (rows.length === 1) inner.append(el('div', { class: 'lab hint' }, APP.sel.length ? 'Press I to keyframe' : 'Select an object'));
  box.append(inner);
  this.labInner = inner;
  this.clampScroll();
  this.dirty = true;
};
TL.clampScroll = function () {
  const total = this.rows.length * this.rowH, avail = this.h - this.rulerH - this.cacheH;
  this.scrollY = clamp(this.scrollY, 0, Math.max(0, total - avail + 4));
  if (this.labInner) this.labInner.style.transform = `translateY(${-this.scrollY}px)`;
};
TL.rowKeys = function (r) {
  if (r.type === 'ch') return (r.obj.anim && r.obj.anim[r.path] || []).map(k => ({ f: k.f, keys: [{ k, obj: r.obj, path: r.path }], e: k.e }));
  const objs = r.type === 'obj' ? [r.obj] : this.objs();
  const m = new Map();
  for (const o of objs) if (o.anim) for (const p in o.anim) for (const k of o.anim[p]) {
    let g = m.get(k.f); if (!g) m.set(k.f, g = { f: k.f, keys: [], e: k.e });
    g.keys.push({ k, obj: o, path: p });
  }
  return [...m.values()];
};

/* ---------- geometry ---------- */
TL.ppf = function () { return this.w / (this.f1 - this.f0); };
TL.xOf = function (f) { return (f - this.f0) * this.ppf(); };
TL.fOf = function (x) { return this.f0 + x / this.ppf(); };
TL.top = function () { return this.rulerH + this.cacheH; };
TL.rowAt = function (y) { const i = Math.floor((y - this.top() + this.scrollY) / this.rowH); return i >= 0 && i < this.rows.length ? i : -1; };
TL.fit = function () { const [s, e] = frameRange(); const pad = Math.max(2, (e - s) * 0.03); this.f0 = s - pad; this.f1 = e + pad; this.dirty = true; };
TL.resize = function () {
  const wrap = $('#tl-canvas-wrap'), cv = this.canvas;
  const r = wrap.getBoundingClientRect(); this.dpr = Math.min(window.devicePixelRatio || 1, 2);
  this.w = Math.max(1, r.width); this.h = Math.max(1, r.height);
  cv.width = Math.round(this.w * this.dpr); cv.height = Math.round(this.h * this.dpr);
  this.clampScroll(); this.dirty = true;
};

/* ---------- drawing ---------- */
TL.draw = function () {
  const c = this.ctx; if (!c) return;
  const W = this.w, H = this.h, dpr = this.dpr;
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.fillStyle = '#18181d'; c.fillRect(0, 0, W, H);
  const [s, e] = frameRange();
  const top = this.top();
  // rows
  c.save(); c.beginPath(); c.rect(0, top, W, H - top); c.clip();
  for (let i = 0; i < this.rows.length; i++) {
    const y = top + i * this.rowH - this.scrollY;
    if (y > H || y + this.rowH < top) continue;
    const r = this.rows[i];
    c.fillStyle = r.type === 'sum' ? '#202027' : r.type === 'obj' ? '#1d1d23' : (i % 2 ? '#1a1a1f' : '#1c1c21');
    c.fillRect(0, y, W, this.rowH);
  }
  // outside frame range
  c.fillStyle = 'rgba(0,0,0,.28)';
  const xs = this.xOf(s), xe = this.xOf(e);
  if (xs > 0) c.fillRect(0, top, xs, H - top);
  if (xe < W) c.fillRect(xe, top, W - xe, H - top);
  // grid lines
  const step = this.tickStep();
  c.strokeStyle = 'rgba(255,255,255,.045)'; c.lineWidth = 1; c.beginPath();
  for (let f = Math.ceil(this.f0 / step) * step; f <= this.f1; f += step) { const x = Math.round(this.xOf(f)) + 0.5; c.moveTo(x, top); c.lineTo(x, H); }
  c.stroke();
  // keys
  const ppf = this.ppf();
  const dragD = this.drag && this.drag.kind === 'move' ? this.drag.delta : 0;
  for (let i = 0; i < this.rows.length; i++) {
    const y = top + i * this.rowH - this.scrollY + this.rowH / 2;
    if (y > H + 10 || y < top - 10) continue;
    const r = this.rows[i];
    const groups = this.rowKeys(r);
    // hold bars between keys with equal values (channel rows)
    if (r.type === 'ch' && groups.length > 1) {
      c.fillStyle = 'rgba(141,107,255,.18)';
      for (let k = 0; k < groups.length - 1; k++) {
        const a = groups[k].keys[0].k, b = groups[k + 1].keys[0].k;
        if (a.v === b.v || a.e === 'constant') { const x0 = this.xOf(a.f), x1 = this.xOf(b.f); c.fillRect(x0, y - 2, x1 - x0, 4); }
      }
    }
    const size = r.type === 'ch' ? 5 : r.type === 'obj' ? 5.5 : 6;
    for (const g of groups) {
      const selN = g.keys.filter(x => this.sel.has(x.k)).length;
      const sel = selN > 0;
      const fx = g.f + (sel && dragD ? dragD : 0);
      const x = Math.round(this.xOf(fx)) + 0.5;
      if (x < -10 || x > W + 10) continue;
      const shape = r.type === 'ch' ? g.e : 'bezier';
      c.beginPath();
      if (shape === 'constant') c.rect(x - size * 0.8, y - size * 0.8, size * 1.6, size * 1.6);
      else { c.moveTo(x, y - size); c.lineTo(x + size, y); c.lineTo(x, y + size); c.lineTo(x - size, y); c.closePath(); }
      c.fillStyle = sel ? (selN === g.keys.length ? '#ffae42' : '#d8a15a') : r.type === 'sum' ? '#b9b8c6' : '#e7e6ee';
      c.fill();
      c.strokeStyle = sel ? '#5a3a10' : '#0c0c0f'; c.lineWidth = 1.2; c.stroke();
      if (shape === 'linear') { c.beginPath(); c.arc(x, y, 1.6, 0, Math.PI * 2); c.fillStyle = '#0c0c0f'; c.fill(); }
    }
  }
  // box select
  if (this.drag && this.drag.kind === 'box') {
    const d = this.drag, x0 = Math.min(d.x0, d.x), y0 = Math.min(d.y0, d.y);
    c.fillStyle = 'rgba(141,107,255,.12)'; c.strokeStyle = 'rgba(141,107,255,.8)'; c.lineWidth = 1;
    c.fillRect(x0, y0, Math.abs(d.x - d.x0), Math.abs(d.y - d.y0)); c.strokeRect(x0 + 0.5, y0 + 0.5, Math.abs(d.x - d.x0), Math.abs(d.y - d.y0));
  }
  c.restore();
  // ruler
  c.fillStyle = '#212128'; c.fillRect(0, 0, W, this.rulerH);
  c.fillStyle = '#16161b'; c.fillRect(0, this.rulerH, W, this.cacheH);
  c.font = '500 10.5px "JetBrains Mono", ui-monospace, monospace'; c.textBaseline = 'middle'; c.textAlign = 'center';
  c.strokeStyle = 'rgba(255,255,255,.18)'; c.beginPath();
  for (let f = Math.ceil(this.f0 / step) * step; f <= this.f1; f += step) {
    const x = Math.round(this.xOf(f)) + 0.5;
    c.moveTo(x, this.rulerH - 6); c.lineTo(x, this.rulerH);
    c.fillStyle = (f < s || f > e) ? '#5b5a66' : '#a9a8b6'; c.fillText(String(f), x, this.rulerH / 2 - 1);
  }
  const sub = step / 5;
  if (sub * ppf > 6 && sub >= 1) for (let f = Math.ceil(this.f0 / sub) * sub; f <= this.f1; f += sub) { const x = Math.round(this.xOf(f)) + 0.5; c.moveTo(x, this.rulerH - 3); c.lineTo(x, this.rulerH); }
  c.stroke();
  // sim cache bar
  const cc = SIM.cache;
  if (SIM.active()) {
    if (cc.end >= cc.start) { c.fillStyle = cc.full ? '#c08a3a' : '#7a5ce0'; c.fillRect(this.xOf(cc.start), this.rulerH + 1, this.xOf(cc.end + 1) - this.xOf(cc.start), this.cacheH - 2); }
    if (SIM.target > cc.end && (SIM.busy || SIM.building || SIM.layoutBusy)) { c.fillStyle = 'rgba(122,92,224,.35)'; c.fillRect(this.xOf(cc.end + 1), this.rulerH + 1, this.xOf(Math.min(SIM.target, e) + 1) - this.xOf(cc.end + 1), this.cacheH - 2); }
  }
  // bone fractures: small white ticks on the cache bar
  if (SIM.fractures && SIM.fractures.length) {
    c.fillStyle = '#f4efe2';
    const seen = new Set();
    for (const fr of SIM.fractures) {
      const x = Math.round(this.xOf(fr.f)); if (x < 0 || x > W || seen.has(x)) continue; seen.add(x);
      c.fillRect(x - 1, this.rulerH + 1, 2, this.cacheH - 2);
    }
  }
  // camera shots: a camera mark where each shot starts (the output cuts to that camera there)
  c.font = '10px ' + (getComputedStyle(document.body).fontFamily || 'sans-serif'); c.textAlign = 'left'; c.textBaseline = 'middle';
  for (const o of allObjs()) {
    if (o.type !== 'camera' || !(o.props.shotStart >= 0)) continue;
    const x = Math.round(this.xOf(o.props.shotStart)) + 0.5; if (x < -60 || x > W + 6) continue;
    c.fillStyle = '#3fb6a8'; c.fillRect(x - 0.5, this.rulerH, 2, this.cacheH + 6);
    const lb = o.name.slice(0, 14), tw2 = c.measureText(lb).width + 8;
    c.beginPath(); if (c.roundRect) c.roundRect(x + 2, this.rulerH + this.cacheH - 1, tw2, 12, 3); else c.rect(x + 2, this.rulerH + this.cacheH - 1, tw2, 12); c.fill();
    c.fillStyle = '#fff'; c.fillText(lb, x + 6, this.rulerH + this.cacheH + 5);
  }
  c.textAlign = 'center';
  // interactive blast markers
  for (const [bi, ev] of (APP.scene.events || []).entries()) {
    const x = Math.round(this.xOf(ev.f)) + 0.5; if (x < -6 || x > W + 6) continue;
    c.fillStyle = bi === APP.blastSel ? '#ffe08a' : '#ff9b42'; c.beginPath(); c.moveTo(x - 4, this.rulerH + this.cacheH); c.lineTo(x + 4, this.rulerH + this.cacheH); c.lineTo(x, this.rulerH + this.cacheH + 6); c.closePath(); c.fill();
  }
  // playhead
  const px = Math.round(this.xOf(APP.frame)) + 0.5;
  c.strokeStyle = '#8d6bff'; c.lineWidth = 1.5; c.beginPath(); c.moveTo(px, this.rulerH); c.lineTo(px, H); c.stroke();
  const lab = String(APP.frame), tw = Math.max(24, c.measureText(lab).width + 10);
  c.fillStyle = '#8d6bff';
  const bx = clamp(px - tw / 2, 0, W - tw);
  c.beginPath(); if (c.roundRect) c.roundRect(bx, 3, tw, this.rulerH - 6, 4); else c.rect(bx, 3, tw, this.rulerH - 6); c.fill();
  c.fillStyle = '#fff'; c.fillText(lab, bx + tw / 2, this.rulerH / 2);
  this.dirty = false; this.lastFrame = APP.frame; this.lastCache = cc.end;
};
TL.tickStep = function () {
  const ppf = this.ppf();
  for (const s of [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000]) if (s * ppf >= 46) return s;
  return 10000;
};

/* ---------- interaction ---------- */
TL.hitBlast = function (x, y) {
  if (y > this.rulerH + this.cacheH + 10) return -1;
  let best = -1, bd = 7;
  (APP.scene.events || []).forEach((ev, i) => { const d = Math.abs(this.xOf(ev.f) - x); if (d < bd) { bd = d; best = i; } });
  return best;
};
TL.hitKey = function (x, y) {
  const i = this.rowAt(y); if (i < 0) return null;
  const r = this.rows[i];
  let best = null, bd = 7;
  for (const g of this.rowKeys(r)) { const d = Math.abs(this.xOf(g.f) - x); if (d < bd) { bd = d; best = g; } }
  return best ? { row: r, g: best } : null;
};
TL.selectGroup = function (g, additive) {
  if (!additive) this.sel.clear();
  const allSel = g.keys.every(x => this.sel.has(x.k));
  for (const x of g.keys) { if (additive && allSel) this.sel.delete(x.k); else this.sel.set(x.k, { obj: x.obj, path: x.path }); }
  this.dirty = true;
};
TL.deleteSelected = function () {
  if (!this.sel.size) return false;
  pushUndo();
  const touched = new Set();
  for (const [k, info] of this.sel) {
    const ks = info.obj.anim && info.obj.anim[info.path]; if (!ks) continue;
    const i = ks.indexOf(k); if (i < 0) continue;
    const P = evalProps(info.obj, APP.frame);
    ks.splice(i, 1);
    if (!ks.length) { delete info.obj.anim[info.path]; setPath(info.obj.props, info.path, getPath(P, info.path)); }
    touched.add(info.obj);
  }
  const n = this.sel.size; this.sel.clear();
  for (const o of touched) changed(o);
  if (touched.size) UI.onPropChanged([...touched][0], 'position');
  this.rebuildLabels();
  toast(`Deleted ${n} keyframe${n > 1 ? 's' : ''}`);
  return true;
};
TL.setInterp = function (e) {
  if (!this.sel.size) return;
  pushUndo();
  const touched = new Set();
  for (const [k, info] of this.sel) { k.e = e; touched.add(info.obj); }
  for (const o of touched) changed(o);
  this.dirty = true; APP.dirtyEval = true;
  toast(`Interpolation: ${e === 'bezier' ? 'smooth' : e}`);
};
TL.copyToFrame = function () {
  if (!this.sel.size) return;
  pushUndo();
  const minF = Math.min(...[...this.sel.keys()].map(k => k.f));
  const touched = new Set();
  for (const [k, info] of [...this.sel]) { insertKey(info.obj, info.path, APP.frame + (k.f - minF), k.v, k.e); touched.add(info.obj); }
  for (const o of touched) changed(o);
  this.dirty = true; UI.onPropChanged([...touched][0], 'position');
  toast('Pasted keys at the playhead');
};
TL.keyMenu = function (e) {
  menuAt([
    { hdr: 'Interpolation' },
    { label: 'Smooth (bezier)', checked: () => [...this.sel.keys()].every(k => k.e === 'bezier'), action: () => this.setInterp('bezier') },
    { label: 'Linear', checked: () => [...this.sel.keys()].every(k => k.e === 'linear'), action: () => this.setInterp('linear') },
    { label: 'Constant (hold)', checked: () => [...this.sel.keys()].every(k => k.e === 'constant'), action: () => this.setInterp('constant') },
    'sep',
    { label: 'Duplicate to playhead', icon: 'copy', action: () => this.copyToFrame() },
    { label: 'Delete keys', icon: 'trash', sc: 'X', action: () => this.deleteSelected() },
  ], e);
};
function initTimeline() {
  const cv = TL.canvas = $('#tl-canvas'); TL.ctx = cv.getContext('2d');
  new ResizeObserver(() => TL.resize()).observe($('#tl-canvas-wrap'));
  TL.resize(); TL.fit();
  const pos = (e) => { const r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  cv.addEventListener('pointerdown', (e) => {
    cv.focus({ preventScroll: true });
    const p = pos(e);
    if (e.button === 1 || e.button === 2) { TL.drag = { kind: 'pan', x: p.x, y: p.y, f0: TL.f0, f1: TL.f1, sy: TL.scrollY, id: e.pointerId }; cv.setPointerCapture(e.pointerId); e.preventDefault(); return; }
    if (p.y < TL.top()) { TL.drag = { kind: 'scrub', id: e.pointerId }; cv.setPointerCapture(e.pointerId); if (APP.playing) togglePlay(); setFrame(TL.fOf(p.x)); return; }
    const hit = TL.hitKey(p.x, p.y);
    if (hit) {
      const allSel = hit.g.keys.every(x => TL.sel.has(x.k));
      if (e.shiftKey) TL.selectGroup(hit.g, true);
      else if (!allSel) TL.selectGroup(hit.g, false);
      TL.drag = { kind: 'pend', x: p.x, y: p.y, id: e.pointerId, g: hit.g };
      cv.setPointerCapture(e.pointerId);
    } else {
      TL.drag = { kind: 'pbox', x0: p.x, y0: p.y, x: p.x, y: p.y, id: e.pointerId, add: e.shiftKey };
      cv.setPointerCapture(e.pointerId);
    }
  });
  cv.addEventListener('pointermove', (e) => {
    const p = pos(e), d = TL.drag;
    if (!d) { const h = p.y >= TL.top() && TL.hitKey(p.x, p.y); cv.style.cursor = p.y < TL.top() ? 'ew-resize' : h ? 'pointer' : 'default'; return; }
    if (d.id !== e.pointerId) return;
    if (d.kind === 'pan') {
      const df = (p.x - d.x) / TL.ppf(); TL.f0 = d.f0 - df; TL.f1 = d.f1 - df;
      TL.scrollY = d.sy - (p.y - d.y); TL.clampScroll(); TL.dirty = true;
    } else if (d.kind === 'scrub') setFrame(TL.fOf(p.x));
    else if (d.kind === 'pend') {
      if (Math.abs(p.x - d.x) > 3) {
        pushUndo();
        const items = [...TL.sel.entries()].map(([k, info]) => ({ k, info, f0: k.f }));
        TL.drag = { kind: 'move', x: d.x, id: d.id, items, delta: 0 };
      }
    } else if (d.kind === 'move') {
      const delta = Math.round((p.x - d.x) / TL.ppf());
      if (delta !== d.delta) {
        d.delta = 0; // keys are moved for real below; drawing offset stays 0
        for (const it of d.items) it.k.f = it.f0 + delta;
        const chans = new Set(d.items.map(it => it.info.obj.anim[it.info.path]));
        for (const ks of chans) if (ks) ks.sort((a, b) => a.f - b.f);
        d.cur = delta;
        for (const o of new Set(d.items.map(it => it.info.obj))) changed(o);
        TL.dirty = true; APP.dirtyEval = true;
        setStatusHint(`Move keys ${delta >= 0 ? '+' : ''}${delta} frames`);
      }
    } else if (d.kind === 'pbox' || d.kind === 'box') {
      d.x = p.x; d.y = p.y;
      if (d.kind === 'pbox' && Math.hypot(p.x - d.x0, p.y - d.y0) > 4) d.kind = 'box';
      TL.dirty = true;
    }
  });
  const up = (e) => {
    const d = TL.drag; if (!d || d.id !== e.pointerId) return;
    TL.drag = null;
    if (d.kind === 'move') {
      setStatusHint(null);
      // merge keys that landed on the same frame (moved key wins)
      const moved = new Set(d.items.map(it => it.k));
      const chans = new Map();
      for (const it of d.items) chans.set(it.info.obj.anim[it.info.path], it.info);
      for (const [ks] of chans) {
        if (!ks) continue;
        for (let i = ks.length - 1; i >= 0; i--) {
          const k = ks[i];
          if (moved.has(k)) continue;
          if (ks.some(o => o !== k && moved.has(o) && Math.abs(o.f - k.f) < 0.5)) ks.splice(i, 1);
        }
      }
      const objs = new Set(d.items.map(it => it.info.obj));
      for (const o of objs) changed(o);
      if (objs.size) UI.onPropChanged([...objs][0], 'position');
      if (!d.cur) APP.undo.pop();
    } else if (d.kind === 'pend') {
      if (!e.shiftKey) TL.selectGroup(d.g, false);
    } else if (d.kind === 'pbox') {
      if (!d.add) TL.sel.clear();
      if (APP.playing) togglePlay();
      setFrame(TL.fOf(d.x0));
    } else if (d.kind === 'box') {
      if (!d.add) TL.sel.clear();
      const fa = TL.fOf(Math.min(d.x0, d.x)), fb = TL.fOf(Math.max(d.x0, d.x));
      const ra = TL.rowAt(Math.min(d.y0, d.y)), rb = TL.rowAt(Math.max(d.y0, d.y));
      const r0 = ra < 0 ? 0 : ra, r1 = rb < 0 ? TL.rows.length - 1 : rb;
      for (let i = r0; i <= r1; i++) for (const g of TL.rowKeys(TL.rows[i])) if (g.f >= fa && g.f <= fb) for (const x of g.keys) TL.sel.set(x.k, { obj: x.obj, path: x.path });
    }
    TL.dirty = true;
  };
  cv.addEventListener('pointerup', up);
  cv.addEventListener('pointercancel', up);
  cv.addEventListener('dblclick', (e) => { const p = pos(e); const h = TL.hitKey(p.x, p.y); if (h) setFrame(h.g.f); });
  cv.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const p = pos(e); const h = TL.hitKey(p.x, p.y);
    if (TL.drag && TL.drag.kind === 'pan' && (Math.abs(p.x - TL.drag.x) > 3)) return;
    if (h) { if (!h.g.keys.every(x => TL.sel.has(x.k))) TL.selectGroup(h.g, false); TL.keyMenu(e); return; }
    // right-click on an orange blast marker (just under the cache bar): delete that blast
    const bi = TL.hitBlast(p.x, p.y);
    if (bi >= 0) {
      selectBlast(bi);
      menuAt([
        { label: `Delete blast at frame ${APP.scene.events[bi].f}`, icon: 'trash', sc: 'X', action: () => deleteBlast(bi) },
        { label: `Delete all blasts (${APP.scene.events.length})`, icon: 'trash', action: clearBlasts },
      ], e);
    }
  });
  const wheel = (e) => {
    e.preventDefault();
    if (e.shiftKey || (Math.abs(e.deltaX) > Math.abs(e.deltaY) && !e.ctrlKey)) {
      const dx = e.shiftKey ? e.deltaY : e.deltaX;
      if (e.shiftKey && e.currentTarget === cv && !e.altKey) { TL.scrollY += e.deltaY * 0.5; TL.clampScroll(); TL.dirty = true; return; }
      const df = dx / TL.ppf(); TL.f0 += df; TL.f1 += df; TL.dirty = true; return;
    }
    if (e.currentTarget !== cv) { TL.scrollY += e.deltaY * 0.5; TL.clampScroll(); TL.dirty = true; return; }
    const p = pos(e), f = TL.fOf(p.x);
    const k = Math.exp(e.deltaY * 0.0015);
    const span = clamp((TL.f1 - TL.f0) * k, 8, 20000);
    TL.f0 = f - (p.x / TL.w) * span; TL.f1 = TL.f0 + span; TL.dirty = true;
  };
  cv.addEventListener('wheel', wheel, { passive: false });
  $('#tl-labels').addEventListener('wheel', wheel, { passive: false });
  cv.tabIndex = 0;
  cv.setAttribute('aria-label', 'Dope sheet timeline');
  cv.addEventListener('keydown', (e) => {
    if ((e.key === 'x' || e.key === 'X' || e.key === 'Delete' || e.key === 'Backspace') && TL.sel.size) { e.preventDefault(); e.stopPropagation(); TL.deleteSelected(); }
    else if ((e.key === 'a' || e.key === 'A') && !e.altKey && !e.ctrlKey) { e.preventDefault(); e.stopPropagation(); for (const r of TL.rows) if (r.type === 'ch') for (const k of r.obj.anim[r.path]) TL.sel.set(k, { obj: r.obj, path: r.path }); TL.dirty = true; }
    else if (e.key === 'a' && e.altKey) { e.preventDefault(); e.stopPropagation(); TL.sel.clear(); TL.dirty = true; }
    else if (e.key === 'Home') { e.preventDefault(); e.stopPropagation(); TL.fit(); }
    else if (e.key === 't' || e.key === 'T') { e.preventDefault(); e.stopPropagation(); if (TL.sel.size) showMenu([{ label: 'Smooth', action: () => TL.setInterp('bezier') }, { label: 'Linear', action: () => TL.setInterp('linear') }, { label: 'Constant', action: () => TL.setInterp('constant') }], TL.canvas.getBoundingClientRect().left + 40, TL.canvas.getBoundingClientRect().top + 30); }
  });
  buildTimelineBar();
  TL.rebuildLabels();
}

/* ---------- transport bar ---------- */
const TLB = {};
function buildTimelineBar() {
  const bar = $('#tl-bar'); bar.textContent = '';
  const btn = (icon, title, fn, cls = '') => { const b = el('button', { class: 'tl-btn ' + cls, title, 'aria-label': title, html: ICON[icon] }); b.onclick = fn; bar.append(b); return b; };
  btn('first', 'Jump to start (Shift ←)', jumpStart);
  btn('prevKey', 'Previous keyframe (↓)', () => jumpKey(-1));
  btn('stepBack', 'Back one frame (←)', () => stepFrame(-1));
  TLB.play = btn('play', 'Play / pause (Space)', togglePlay, 'play');
  btn('stepFwd', 'Forward one frame (→)', () => stepFrame(1));
  btn('nextKey', 'Next keyframe (↑)', () => jumpKey(1));
  btn('last', 'Jump to end (Shift →)', jumpEnd);
  bar.append(el('div', { class: 'tl-sep' }));
  const fieldBox = (label, nf, cls) => { const f = el('div', { class: 'tl-field ' + (cls || '') }, el('span', null, label), nf.el); bar.append(f); return nf; };
  TLB.frame = fieldBox('Frame', numberField({ label: 'Current frame', int: true, step: 1, onCommit: (v) => setFrame(v) }));
  TLB.start = fieldBox('Start', numberField({ label: 'Start frame', int: true, step: 1, min: 0, onStart: pushUndo, onCommit: (v) => { setProp(APP.scene.world, 'frameStart', Math.min(v, APP.scene.world.props.frameEnd - 1)); TL.fit(); TL.updateBar(); } }), 'hide-sm');
  TLB.end = fieldBox('End', numberField({ label: 'End frame', int: true, step: 1, min: 1, onStart: pushUndo, onCommit: (v) => { setProp(APP.scene.world, 'frameEnd', Math.max(v, APP.scene.world.props.frameStart + 1)); TL.fit(); TL.updateBar(); } }), 'hide-sm');
  bar.append(el('div', { class: 'tl-sep' }));
  TLB.rec = btn('record', 'Auto-keying: record a keyframe whenever a value changes', toggleAutokey, 'rec');
  btn('diamond', 'Insert keyframe on selection (I)', () => insertKeyframeSelected());
  TLB.loop = btn('loop', 'Loop playback', () => { APP.loop = !APP.loop; TL.updateBar(); });
  bar.append(el('div', { class: 'tl-sep' }));
  btn('reset', 'Reset simulation to the start', resetSim);
  btn('bake', 'Simulate the whole range in the background', bakeAll);
  const sp = el('select', { class: 'selectf tl-speed', title: 'Playback speed', 'aria-label': 'Playback speed' });
  for (const [v, t] of [['1', '1×'], ['0.5', '½×'], ['0.25', '¼×'], ['0.1', '⅒×']]) sp.append(el('option', { value: v }, t));
  sp.onchange = () => { APP.playSpeed = +sp.value; APP.playClock = performance.now(); APP.playFrameF = APP.frame; };
  bar.append(el('div', { class: 'tl-field hide-sm' }, el('span', null, 'Speed'), sp));
  TLB.cache = el('span', { class: 'tl-cache' });
  bar.append(el('span', { style: { flex: '1' } }), TLB.cache);
  TL.updateBar();
}
TL.updateBar = function () {
  if (!TLB.play) return;
  TLB.play.innerHTML = APP.playing ? ICON.pause : ICON.play;
  TLB.play.title = APP.playing ? 'Pause (Space)' : 'Play (Space)';
  TLB.rec.classList.toggle('on', APP.autokey);
  TLB.loop.classList.toggle('on', APP.loop);
  const W = APP.scene.world.props;
  TLB.start.set(W.frameStart); TLB.end.set(W.frameEnd);
  this.updateFrameField();
};
TL.updateFrameField = function () { if (TLB.frame) TLB.frame.set(APP.frame); };
TL.updateCacheText = function () {
  if (!TLB.cache) return;
  const c = SIM.cache;
  let t = '';
  if (!SIM.active()) t = 'No molecular bodies';
  else if (SIM.layoutBusy || SIM.building) t = 'Building bodies…';
  else if (c.end < c.start) t = 'Not simulated yet';
  else t = `Cached ${c.start}–${c.end}${SIM.target > c.end && SIM.busy ? ' · simulating' : ''}`;
  if (TLB.cache.textContent !== t) TLB.cache.textContent = t;
};
