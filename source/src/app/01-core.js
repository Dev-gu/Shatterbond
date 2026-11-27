/* ===================== core: utilities, icons, schema ===================== */
const BLD = window.ShatterBuilder;
const TISSUES = BLD.TISSUES;
const TI = BLD.T;
const DEG = Math.PI / 180;
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp = (a, b, t) => a + (b - a) * t;
const deepClone = (o) => JSON.parse(JSON.stringify(o));
let _uid = Date.now() % 100000;
const newId = () => 'o' + (++_uid).toString(36);

function el(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  if (attrs) for (const k in attrs) {
    const v = attrs[k];
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
    else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
    else if (k === 'html') e.innerHTML = v;
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) { if (c == null || c === false) continue; e.append(c.nodeType ? c : document.createTextNode(String(c))); }
  return e;
}
function svgEl(markup) { const t = document.createElement('template'); t.innerHTML = markup.trim(); return t.content.firstChild; }

function hexToRgb(h) { h = (h || '#000000').replace('#', ''); if (h.length === 3) h = h.split('').map(c => c + c).join(''); const n = parseInt(h, 16); return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; }
function rgbToHex(r, g, b) { const f = (v) => clamp(Math.round(v * 255), 0, 255).toString(16).padStart(2, '0'); return '#' + f(r) + f(g) + f(b); }

const S = (d, extra = '') => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" ${extra}>${d}</svg>`;
const ICON = {
  cube: S('<path d="M12 3 20 7.5v9L12 21l-8-4.5v-9z"/><path d="M4 7.5 12 12l8-4.5M12 12v9"/>'),
  sphere: S('<circle cx="12" cy="12" r="8.5"/><ellipse cx="12" cy="12" rx="8.5" ry="3.2"/>'),
  cylinder: S('<ellipse cx="12" cy="5.5" rx="7" ry="2.5"/><path d="M5 5.5v13c0 1.4 3.1 2.5 7 2.5s7-1.1 7-2.5v-13"/>'),
  cone: S('<path d="M12 3 5 18.5"/><path d="M12 3l7 15.5"/><ellipse cx="12" cy="18.5" rx="7" ry="2.5"/>'),
  torus: S('<ellipse cx="12" cy="12" rx="9" ry="5.5"/><ellipse cx="12" cy="11.5" rx="3.5" ry="1.6"/>'),
  capsule: S('<rect x="7" y="2.5" width="10" height="19" rx="5"/>'),
  plane: S('<path d="M2.5 15.5 9 8.5h12.5L15 15.5z"/>'),
  humanoid: S('<circle cx="12" cy="4.5" r="2.2"/><path d="M8 9.5h8l-1 6h-6zM9 15.5l-.6 6M15 15.5l.6 6M8 9.5 5.5 15M16 9.5l2.5 5.5"/>'),
  hammer: S('<path d="M8 2v9M16 2v9"/><rect x="4" y="11" width="16" height="7" rx="1.6"/><path d="M8 11v7M16 11v7" opacity=".5"/>'),
  ball: S('<path d="M12 2v8"/><circle cx="12" cy="15.5" r="6"/><path d="M8.5 13.5a4 4 0 0 1 3-2" opacity=".6"/>'),
  saw: S('<circle cx="12" cy="12" r="3"/><path d="M12 2.5l1.6 3 3.3-.9-.6 3.4 3.1 1.5-2.4 2.5 2.4 2.5-3.1 1.5.6 3.4-3.3-.9-1.6 3-1.6-3-3.3.9.6-3.4-3.1-1.5L5.6 12 3.2 9.5l3.1-1.5-.6-3.4 3.3.9z"/>'),
  press: S('<rect x="4" y="2.5" width="16" height="4" rx="1"/><path d="M12 6.5v7"/><rect x="5" y="13.5" width="14" height="4" rx="1"/><path d="M3 21.5h18"/>'),
  wall: S('<rect x="9" y="3" width="5" height="18" rx="1"/><path d="M14 12h7M18 9l3 3-3 3"/>'),
  cannon: S('<path d="M4 14 17 6.5l2.2 3.8L6.2 17.8z"/><circle cx="8" cy="18" r="3"/><circle cx="21" cy="5" r="1.4"/>'),
  spinner: S('<path d="M12 4v17"/><path d="M3 9.5h18"/><ellipse cx="12" cy="9.5" rx="9" ry="3" opacity=".45"/>'),
  blade: S('<path d="M12 2v10"/><path d="M5 12h14l-3 7a8 8 0 0 1-8 0z"/>'),
  guillotine: S('<path d="M5 2v20M19 2v20M5 3h14"/><path d="M7 9h10l-10 4z"/>'),
  spikes: S('<path d="M2 20h20M4 20l2.5-9L9 20M10 20l2.5-12L15 20M16 20l2.5-9L21 20"/>'),
  emitter: S('<path d="M3 9h5v6H3z"/><path d="M8 10l4-2v8l-4-2"/><circle cx="16" cy="8" r="1.5"/><circle cx="19.5" cy="12" r="1.5"/><circle cx="16" cy="16" r="1.5"/>'),
  bomb: S('<circle cx="11" cy="14" r="6.5"/><path d="M15 9l2-2M17 7c1-1 2.5-1 3 0M19.5 4.5l.7-1.4M21 6.5l1.4-.4"/>'),
  wind: S('<path d="M3 8h11a3 3 0 1 0-3-3M3 12h16a3 3 0 1 1-3 3M3 16h8"/>'),
  vortex: S('<path d="M12 12a2 2 0 1 1 2 2c-3 0-5-2-5-4.5S11.5 4 15 5s5 4.5 4 8-5 6.5-9 5.5S3 13.5 4 9.5"/>'),
  blackhole: S('<circle cx="12" cy="12" r="3.5" fill="currentColor"/><ellipse cx="12" cy="12" rx="10" ry="3.5"/><path d="M12 3c-3 2-3 5 0 5.5M12 21c3-2 3-5 0-5.5" opacity=".6"/>'),
  camera: S('<rect x="2.5" y="7" width="13" height="10" rx="2"/><path d="M15.5 10.5 21.5 7v10l-6-3.5"/>'),
  world: S('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.8 3 2.8 15 0 18M12 3c-2.8 3-2.8 15 0 18"/>'),
  eye: S('<path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z"/><circle cx="12" cy="12" r="2.8"/>'),
  eyeOff: S('<path d="M3 3l18 18M10.6 6.1A9 9 0 0 1 12 6c6.4 0 10 6 10 6a17 17 0 0 1-3.2 3.7M6.5 7.6A16 16 0 0 0 2 12s3.6 6.5 10 6.5a9 9 0 0 0 4.2-1"/>'),
  play: S('<path d="M7 4.5v15l13-7.5z" fill="currentColor"/>'),
  pause: S('<path d="M7 4.5v15M17 4.5v15" stroke-width="3.2"/>'),
  first: S('<path d="M5 4v16M19 4.5v15L8 12z" fill="currentColor"/>'),
  last: S('<path d="M19 4v16M5 4.5v15L16 12z" fill="currentColor"/>'),
  prevKey: S('<path d="M15 5 8 12l7 7"/><path d="M5 12 3 10l-2 2 2 2z" fill="currentColor" stroke="none" transform="translate(16 0)"/>'),
  nextKey: S('<path d="M9 5l7 7-7 7"/><path d="M3 12 5 10l2 2-2 2z" fill="currentColor" stroke="none" transform="translate(-2 0)"/>'),
  stepBack: S('<path d="M15 5 8 12l7 7"/>'),
  stepFwd: S('<path d="M9 5l7 7-7 7"/>'),
  record: S('<circle cx="12" cy="12" r="6" fill="currentColor"/>'),
  loop: S('<path d="M17 2l3 3-3 3"/><path d="M4 11V9a4 4 0 0 1 4-4h12M7 22l-3-3 3-3"/><path d="M20 13v2a4 4 0 0 1-4 4H4"/>'),
  select: S('<path d="M5 3l14 8-6 1.5L10 19z"/>'),
  move: S('<path d="M12 2v20M2 12h20M12 2l-3 3M12 2l3 3M12 22l-3-3M12 22l3-3M2 12l3-3M2 12l3 3M22 12l-3-3M22 12l-3 3"/>'),
  rotate: S('<path d="M20 12a8 8 0 1 1-2.3-5.6"/><path d="M20 4v5h-5"/>'),
  scale: S('<rect x="3" y="11" width="10" height="10" rx="1"/><path d="M13 11l8-8M15 3h6v6"/>'),
  blast: S('<path d="M12 2l1.8 5.2L19 5l-2.2 5.2L22 12l-5.2 1.8L19 19l-5.2-2.2L12 22l-1.8-5.2L5 19l2.2-5.2L2 12l5.2-1.8L5 5l5.2 2.2z"/>'),
  grab: S('<path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V11m0-1.5v-6a1.5 1.5 0 0 1 3 0V11m0-5.5a1.5 1.5 0 0 1 3 0V12m0-4.5a1.5 1.5 0 0 1 3 0V15a7 7 0 0 1-7 7h-1.5a7 7 0 0 1-5.2-2.3L3.5 16a1.6 1.6 0 0 1 2.4-2.1L8 16"/>'),
  plus: S('<path d="M12 5v14M5 12h14"/>'),
  trash: S('<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>'),
  save: S('<path d="M5 3h11l4 4v14H4V4a1 1 0 0 1 1-1z"/><path d="M8 3v5h7V3M7 21v-7h10v7"/>'),
  folder: S('<path d="M3 6a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>'),
  film: S('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4"/>'),
  image: S('<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-9 9"/>'),
  undo: S('<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>'),
  redo: S('<path d="M15 14l5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>'),
  diamond: S('<path d="M12 2.5 21.5 12 12 21.5 2.5 12z" fill="currentColor" stroke-width="2"/>'),
  diamondO: S('<path d="M12 3.5 20.5 12 12 20.5 3.5 12z" stroke-width="2.6"/>'),
  chev: S('<path d="M6 9l6 6 6-6"/>'),
  object: S('<path d="M12 3 20 7.5v9L12 21l-8-4.5v-9z"/><circle cx="12" cy="12" r="2" fill="currentColor"/>'),
  physics: S('<circle cx="12" cy="12" r="2.2" fill="currentColor"/><ellipse cx="12" cy="12" rx="10" ry="4"/><ellipse cx="12" cy="12" rx="10" ry="4" transform="rotate(60 12 12)"/><ellipse cx="12" cy="12" rx="10" ry="4" transform="rotate(-60 12 12)"/>'),
  material: S('<circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 0 0 18z" fill="currentColor" opacity=".35"/>'),
  weapon: S('<path d="M14.5 4.5l5 5-9.5 9.5H5v-5z"/><path d="M12 7l5 5"/>'),
  anatomy: S('<path d="M12 2v20M8 6c-3 1-3 4 0 5M16 6c3 1 3 4 0 5M8 13c-3 1-3 4 0 5M16 13c3 1 3 4 0 5"/>'),
  scene: S('<path d="M3 20h18M5 20V9l7-5 7 5v11"/><path d="M10 20v-6h4v6"/>'),
  render: S('<rect x="3" y="5" width="18" height="13" rx="2"/><path d="M8 21h8M12 18v3"/>'),
  info: S('<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>'),
  copy: S('<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M4 16V5a1 1 0 0 1 1-1h11"/>'),
  upload: S('<path d="M12 16V4M7 9l5-5 5 5M4 20h16"/>'),
  download: S('<path d="M12 4v12M7 11l5 5 5-5M4 20h16"/>'),
  reset: S('<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/>'),
  bake: S('<path d="M4 18h16M6 18V9h12v9M9 9V6h6v3"/><path d="M9 13h6" />'),
  grid: S('<path d="M3 9h18M3 15h18M9 3v18M15 3v18"/><rect x="3" y="3" width="18" height="18" rx="2"/>'),
  skin: S('<circle cx="12" cy="7" r="3"/><path d="M6 21v-3a6 6 0 0 1 12 0v3"/>'),
  xray: S('<circle cx="12" cy="6.5" r="3" stroke-dasharray="2 2"/><path d="M12 10v7M8.5 12.5h7M9 20l3-3 3 3"/>'),
  molecule: S('<circle cx="6" cy="7" r="2.5"/><circle cx="18" cy="6" r="2"/><circle cx="12" cy="16" r="3"/><circle cx="20" cy="17" r="1.5"/><path d="M8 8.5l2.6 5M14.6 14.4l3.4-6.6M8.4 6.6l7.6-.5"/>'),
  tissue: S('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="6" opacity=".6"/><circle cx="12" cy="12" r="3" fill="currentColor"/>'),
  key: S('<path d="M12 2.5 21.5 12 12 21.5 2.5 12z"/>'),
  snap: S('<path d="M6 3v7a6 6 0 0 0 12 0V3"/><path d="M6 7h4M14 7h4"/>'),
  local: S('<path d="M4 20 20 4M4 20h7M4 20v-7"/>'),
  cog: S('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>'),
  help: S('<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .9-1 1.7M12 17v.5"/>'),
  clapper: S('<path d="M4 9h16v11H4z"/><path d="M4 9l2-5 14 0-2 5M9 4l-2 5M14 4l-2 5"/>'),
};

/* ---------------- schema ---------------- */
// field types: num | vec3 | color | bool | select | text | int
function F(key, label, type, o = {}) { return Object.assign({ key, label, type, anim: !(type === 'text' || type === 'select' || o.noanim) }, o); }
const RESOLUTION = { low: 0.02, medium: 0.0145, high: 0.012, ultra: 0.0098, extreme: 0.0078, cinematic: 0.0064 };
const RES_OPTS = [['low', 'Low · ~9k molecules (fast)'], ['medium', 'Medium · ~23k'], ['high', 'High · ~40k'], ['ultra', 'Ultra · ~75k (slow)'], ['extreme', 'Extreme · ~150k (very slow)'], ['cinematic', 'Cinematic · ~280k (for final renders)'], ['custom', 'Custom spacing…']];
// molecule spacing in metres for a body (custom lets you dial any detail between about 5k and 600k molecules)
function resSpacing(P) { return P.resolution === 'custom' ? Math.min(0.03, Math.max(0.005, (+P.spacingMM || 10) / 1000)) : (RESOLUTION[P.resolution] || RESOLUTION.medium); }
const POSE_OPTS = Object.keys(BLD.POSES).filter(k => !BLD.POSES[k].hidden).map(k => [k, BLD.POSES[k].name]);
const MAT_OPTS = TISSUES.map((t, i) => [String(i), t.name]).filter(o => TISSUES[+o[0]].kind === 'material' || ['skin', 'fat', 'muscle', 'bone'].includes(TISSUES[+o[0]].id));
const PROP_RES_SCALE = 1.45; // props use a coarser lattice than people

const G_TRANSFORM = { id: 'transform', title: 'Transform', fields: [
  F('position', 'Location', 'vec3', { step: 0.05, unit: 'm' }),
  F('rotation', 'Rotation', 'vec3', { step: 1, unit: '°' }),
  F('scale', 'Scale', 'vec3', { step: 0.05, min: 0.001 }),
] };
const G_VIS = { id: 'visibility', title: 'Visibility', fields: [F('visible', 'Show in viewport', 'bool')] };
const G_MAT = { id: 'material', title: 'Surface', fields: [
  F('color', 'Color', 'color'),
  F('roughness', 'Roughness', 'num', { min: 0, max: 1, step: 0.02 }),
  F('metalness', 'Metalness', 'num', { min: 0, max: 1, step: 0.02 }),
  F('opacity', 'Opacity', 'num', { min: 0.05, max: 1, step: 0.02 }),
] };
const G_COLLIDER = { id: 'physics', title: 'Physics', fields: [
  F('physics', 'Behaves as', 'select', { options: [['collider', 'Solid (pushes particles)'], ['molecular', 'Molecular (breakable)'], ['none', 'Visual only']] }),
  F('friction', 'Friction', 'num', { min: 0, max: 2, step: 0.05 }),
] };
const G_MOLECULAR = (humanoid) => ({ id: 'molecular', title: humanoid ? 'Body physics' : 'Molecular body', fields: [
  F('resolution', 'Resolution', 'select', { options: RES_OPTS }),
  F('spacingMM', 'Custom spacing', 'num', { min: 5, max: 30, step: 0.1, unit: 'mm', noanim: true, help: 'Used when Resolution is Custom. Distance between molecules: halving it gives about 8 times as many molecules. 10 mm is about 70k molecules in a humanoid, 6 mm about 330k.' }),
  ...(humanoid ? [] : [F('material', 'Material', 'select', { options: MAT_OPTS })]),
  F('strength', 'Bond strength', 'num', { min: 0.05, max: 20, step: 0.05, help: 'Multiplies every bond’s tear limit.' }),
  F('rigidity', 'Rigidity', 'num', { min: 0, max: 1, step: 0.02 }),
  ...(humanoid ? [F('tone', 'Muscle tone', 'num', { min: 0, max: 1, step: 0.02, help: '1 holds the pose like a statue, 0 is a limp ragdoll.' })] : []),
  F('shatter', 'Shatter speed', 'num', { min: 0.5, max: 120, step: 0.5, unit: 'm/s', help: 'Impacts faster than this blast molecules loose.' }),
  F('softness', 'Softness', 'num', { min: 0, max: 0.95, step: 0.02 }),
  F('goo', 'Stickiness', 'num', { min: 0, max: 1, step: 0.02, help: 'How much torn flesh clings together in strands and sticks to weapons.' }),
  F('plastic', 'Squish', 'num', { min: 0, max: 1, step: 0.02, help: 'How much flesh stays dented and stretched instead of springing back.' }),
  F('damping', 'Flesh damping', 'num', { min: 0, max: 1, step: 0.02, help: 'Higher settles wobble faster; lower jiggles longer.' }),
  ...(humanoid ? [
    F('firmness', 'Flesh firmness', 'num', { min: 0, max: 1, step: 0.02, help: 'How tightly each body region keeps its sculpted shape. Low is floppy and jiggly.' }),
    F('knockout', 'Knockout speed', 'num', { min: 0.2, max: 60, step: 0.1, unit: 'm/s', help: 'A hit faster than this knocks the body out and it falls over.' }),
    F('spill', 'Wound spill', 'num', { min: 0, max: 1, step: 0.02, help: 'How much of the soft insides oozes out where the skin is torn open. 0 keeps wounds closed.' }),
    F('koHold', 'Pose memory', 'num', { min: 0, max: 0.6, step: 0.01, help: 'After a knockout, how strongly the body springs back to its pose. Low is soft and elastic, 0 folds up like a ragdoll, high is stiff.' }),
  ] : []),
  F('friction', 'Friction', 'num', { min: 0, max: 2, step: 0.05 }),
  F('stand', humanoid ? 'Feet planted' : 'Glued to floor', 'bool', { noanim: true }),
  F('sleep', 'Wait until touched', 'bool', { noanim: true }),
  F('release', 'Physics from frame', 'int', { min: -1, max: 100000, step: 1, noanim: true, help: 'Before this frame the body follows its keyframes, then physics takes over. -1 is automatic: a body with keyframed location or rotation follows them until its last key, otherwise physics runs from the start.' }),
  F('velocity', 'Launch velocity', 'vec3', { step: 0.5, unit: 'm/s', noanim: true }),
] });
const BODY_TYPES = { adult: { height: 1.8, fat: 0.2, build: 0.6 }, child: { height: 1.25, fat: 0.25, build: 0.3 }, heavy: { height: 1.78, fat: 0.8, build: 0.5 }, dog: { height: 0.62, fat: 0.3 }, horse: { height: 1.6, fat: 0.3 } };
const G_BODY = { id: 'body', title: 'Body', fields: [
  F('bodyType', 'Body type', 'select', { options: [['adult', 'Adult'], ['child', 'Child'], ['heavy', 'Heavier build'], ['dog', 'Dog'], ['horse', 'Horse']], noanim: true,
    onSet: (o, v) => { const D = BODY_TYPES[v]; if (D) for (const k in D) setProp(o, k, D[k]); if (v === 'dog' || v === 'horse') { setProp(o, 'pose', 'stand'); if (o.name === 'Humanoid' || /^Humanoid/.test(o.name)) o.name = v === 'dog' ? 'Dog' : 'Horse'; } },
    help: 'Same molecular body system for every type. Choosing one sets a typical height and build, which you can still change.' }),
  F('model', 'Body model', 'select', { options: [['anatomical', 'Anatomical (realistic)'], ['sculpt', 'Classic sculpt']], noanim: true, help: 'Anatomical is a realistic human body (from the CC0 MakeHuman base mesh). Classic is the earlier hand-built sculpt.' }),
  F('pose', 'Pose', 'select', { options: POSE_OPTS }),
  F('height', 'Height', 'num', { min: 0.5, max: 3, step: 0.01, unit: 'm', noanim: true }),
  F('build', 'Musculature', 'num', { min: 0, max: 1, step: 0.02, noanim: true }),
  F('fat', 'Body fat', 'num', { min: 0, max: 1, step: 0.02, noanim: true }),
  F('jointStrength', 'Joint strength', 'num', { min: 0.2, max: 4, step: 0.05, noanim: true }),
  F('seed', 'Variation seed', 'int', { min: 1, max: 99999, step: 1, noanim: true }),
  F('skinColor', 'Skin color', 'color'),
  F('insideColor', 'Inside color', 'color', { help: 'Color of the molecules inside the body (flesh and blood).' }),
] };

const G_ANIM = { id: 'anim', title: 'Animation', fields: [
  F('animation', 'Animation', 'select', { options: () => ANIM_OPTS(), anim: true, onSet: (o, v) => { if (typeof v === 'string' && v.startsWith('clip:')) clipById(v.slice(5)); }, help: 'The body moves by its skeleton and stays on its feet. Physics takes over when something hits it, or at "Physics from frame". Key this to switch animations over time (they blend).' }),
  F('animSpeed', 'Speed', 'num', { min: 0.1, max: 4, step: 0.05, help: 'Plays the animation faster or slower.' }),
  F('animLoop', 'Loop', 'bool', { noanim: true }),
  F('animMove', 'Walk forward', 'bool', { noanim: true, help: 'Walking and running carry the body forward (in the direction it faces).' }),
  F('react', 'React to hits', 'bool', { noanim: true, help: 'When something hits the animated body, physics takes over and it reacts from the pose it is in. Touching someone itself (a punch or headbutt landing) does not stop the animation: it plays through and shoves them.' }),
  F('animDrive', 'Keep animating after a hit', 'bool', { noanim: true, help: 'After physics takes over, the body keeps doing its animation with its muscles while it is pushed and hit (an active ragdoll), until a hard hit knocks it out. Off: it holds the pose it was in.' }),
  F('braceDanger', 'Flinch from danger', 'bool', { noanim: true, help: 'Raises the arms to shield the head when a weapon comes close.' }),
  F('importClip', 'Mixamo clip', 'button', { noanim: true, text: 'Import FBX…', action: () => importMixamo(), help: 'Download an animation from mixamo.com as FBX (any skin option, 30 fps) and import it here, or drop the files onto the window. It plays on this body, fingers included, and is saved so every scene can use it (Animation menu > Saved animations).' }),
  F('animLib', 'Saved clips', 'button', { noanim: true, text: 'Manage…', action: () => openAnimLibrary() }),
] };

// names of the humanoid skeleton segments the engine reports fractures for (+X is the figure's left)
const BONE_NAMES = ['Skull', 'Neck', 'Ribs', 'Lower spine', 'Pelvis',
  'Left upper arm', 'Left forearm', 'Left hand', 'Right upper arm', 'Right forearm', 'Right hand',
  'Left femur', 'Left shin', 'Left foot', 'Right femur', 'Right shin', 'Right foot'];
const BONE_NAMES_QUAD = ['Skull', 'Neck', 'Ribs', 'Spine', 'Pelvis', 'Left shoulder', 'Left foreleg', 'Left front foot', 'Right shoulder', 'Right foreleg', 'Right front foot',
  'Left thigh', 'Left hind leg', 'Left hind foot', 'Right thigh', 'Right hind leg', 'Right hind foot'];
function boneName(seg, o) { const q = o && o.props && (o.props.bodyType === 'dog' || o.props.bodyType === 'horse'); return (q ? BONE_NAMES_QUAD : BONE_NAMES)[seg] || 'Bone'; }
