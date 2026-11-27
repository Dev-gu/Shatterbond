/* ===================== keyframe animation ===================== */
// obj.anim = { 'position.0': [{f, v, e}], 'color': [...], ... }   e: 'bezier' | 'linear' | 'constant'
const AXIS = { x: 0, y: 1, z: 2 };
function splitPath(path) { const i = path.indexOf('.'); return i < 0 ? [path, -1] : [path.slice(0, i), +path.slice(i + 1)]; }
function getPath(props, path) { const [k, i] = splitPath(path); const v = props[k]; return i >= 0 ? (v ? v[i] : undefined) : v; }
function setPath(props, path, val) { const [k, i] = splitPath(path); if (i >= 0) { if (!Array.isArray(props[k])) props[k] = [0, 0, 0]; props[k][i] = val; } else props[k] = val; }

function hermite(keys, f) {
  // monotone cubic (auto-clamped) through numeric keys; per-segment easing modes
  const n = keys.length;
  if (f <= keys[0].f) return keys[0].v;
  if (f >= keys[n - 1].f) return keys[n - 1].v;
  let i = 0; while (i < n - 2 && f >= keys[i + 1].f) i++;
  const a = keys[i], b = keys[i + 1];
  const t = (f - a.f) / (b.f - a.f || 1);
  if (a.e === 'constant') return a.v;
  if (a.e === 'linear') return a.v + (b.v - a.v) * t;
  const slope = (k0, k1) => (k1.v - k0.v) / ((k1.f - k0.f) || 1);
  const tan = (k) => {
    if (k === 0 || k === n - 1) return 0;
    const s0 = slope(keys[k - 1], keys[k]), s1 = slope(keys[k], keys[k + 1]);
    if (s0 * s1 <= 0) return 0;
    return 2 / (1 / s0 + 1 / s1);
  };
  const dx = b.f - a.f, m0 = tan(i) * dx, m1 = tan(i + 1) * dx;
  const t2 = t * t, t3 = t2 * t;
  return (2 * t3 - 3 * t2 + 1) * a.v + (t3 - 2 * t2 + t) * m0 + (-2 * t3 + 3 * t2) * b.v + (t3 - t2) * m1;
}
function evalChannel(keys, f) {
  if (!keys || !keys.length) return undefined;
  const v0 = keys[0].v;
  if (typeof v0 === 'number') return hermite(keys, f);
  if (typeof v0 === 'string' && v0[0] === '#' && v0.length === 7) {
    const n = keys.length;
    if (f <= keys[0].f) return keys[0].v; if (f >= keys[n - 1].f) return keys[n - 1].v;
    let i = 0; while (i < n - 2 && f >= keys[i + 1].f) i++;
    const a = keys[i], b = keys[i + 1];
    let t = (f - a.f) / (b.f - a.f || 1);
    if (a.e === 'constant') return a.v; if (a.e !== 'linear') t = t * t * (3 - 2 * t);
    const ca = hexToRgb(a.v), cb = hexToRgb(b.v);
    return rgbToHex(lerp(ca[0], cb[0], t), lerp(ca[1], cb[1], t), lerp(ca[2], cb[2], t));
  }
  // booleans / strings: step
  let v = keys[0].v; for (const k of keys) { if (k.f <= f + 1e-6) v = k.v; else break; } return v;
}
function evalProps(obj, f) {
  const P = deepCloneProps(obj.props);
  if (obj.anim) for (const path in obj.anim) { const v = evalChannel(obj.anim[path], f); if (v !== undefined) setPath(P, path, v); }
  return P;
}
function deepCloneProps(p) { const o = {}; for (const k in p) { const v = p[k]; o[k] = Array.isArray(v) ? v.slice() : v; } return o; }
function isAnimated(obj, path) { return !!(obj.anim && obj.anim[path] && obj.anim[path].length); }
function keyAt(obj, path, f) { const ks = obj.anim && obj.anim[path]; if (!ks) return -1; return ks.findIndex(k => Math.abs(k.f - f) < 0.5); }
function insertKey(obj, path, f, v, e) {
  obj.anim = obj.anim || {};
  const ks = obj.anim[path] = obj.anim[path] || [];
  const i = ks.findIndex(k => Math.abs(k.f - f) < 0.5);
  if (i >= 0) { ks[i].v = v; if (e) ks[i].e = e; }
  else { ks.push({ f: Math.round(f), v, e: e || 'bezier' }); ks.sort((a, b) => a.f - b.f); }
}
function deleteKey(obj, path, f) {
  const ks = obj.anim && obj.anim[path]; if (!ks) return;
  const i = ks.findIndex(k => Math.abs(k.f - f) < 0.5); if (i >= 0) ks.splice(i, 1);
  if (!ks.length) delete obj.anim[path];
}
function allKeyFrames(obj) { const s = new Set(); if (obj.anim) for (const p in obj.anim) for (const k of obj.anim[p]) s.add(k.f); return [...s].sort((a, b) => a - b); }
function channelLabel(obj, path) {
  const [k, i] = splitPath(path);
  const T = obj.type === 'world' ? null : TYPES[obj.type];
  const groups = obj.type === 'world' ? WORLD_GROUPS : T.groups(obj.props);
  let lab = k;
  for (const g of groups) for (const fd of g.fields) if (fd.key === k) lab = fd.label;
  return i >= 0 ? `${lab} ${'XYZ'[i]}` : lab;
}
function fieldOf(obj, key) {
  const groups = obj.type === 'world' ? WORLD_GROUPS : TYPES[obj.type].groups(obj.props);
  for (const g of groups) for (const fd of g.fields) if (fd.key === key) return fd;
  return null;
}
