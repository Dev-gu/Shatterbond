/* ===================== object types: visuals, motion, colliders ===================== */
const GEO = {
  box: new THREE.BoxGeometry(1, 1, 1),
  sphere: new THREE.SphereGeometry(0.5, 48, 32),
  cylinder: new THREE.CylinderGeometry(0.5, 0.5, 1, 48),
  cone: new THREE.ConeGeometry(0.5, 1, 48),
  torus: (() => { const g = new THREE.TorusGeometry(0.35, 0.15, 24, 64); g.rotateX(Math.PI / 2); return g; })(),
  capsule: new THREE.CapsuleGeometry(0.25, 0.5, 12, 32),
  plane: new THREE.BoxGeometry(1, 0.02, 1),
  unitCyl: new THREE.CylinderGeometry(1, 1, 1, 24),
  disc: new THREE.CylinderGeometry(1, 1, 1, 72),
  ball: new THREE.SphereGeometry(1, 32, 20),
};
const COLLIDER_BASE = { box: [0.5, 0.5, 0.5], sphere: [0.5, 0.5, 0.5], cylinder: [0.5, 0.5, 0.5], cone: [0.5, 0.5, 0.5], torus: [0.35, 0.15, 0], capsule: [0.25, 0.25, 0] };

function stdMat(color, rough = 0.45, metal = 0.05) { return new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal }); }
function mkMesh(geo, mat, shadow = true) { const m = new THREE.Mesh(geo, mat); m.castShadow = shadow; m.receiveShadow = shadow; return m; }
function colliderOf(mesh, shape, key, base, extra) { mesh.userData.collider = Object.assign({ shape, key, base: base || COLLIDER_BASE[shape] }, extra || {}); return mesh; }
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _q1 = new THREE.Quaternion(), _up = new THREE.Vector3(0, 1, 0);
function placeRod(mesh, a, b, r) {
  _v1.subVectors(b, a); const L = _v1.length() || 1e-6;
  mesh.position.copy(a).addScaledVector(_v1, 0.5);
  mesh.quaternion.setFromUnitVectors(_up, _v1.multiplyScalar(1 / L));
  mesh.scale.set(r, L, r);
}
function applyTransform(view, P, noScale) {
  const g = view.root;
  g.position.set(P.position[0], P.position[1], P.position[2]);
  g.rotation.set(P.rotation[0] * DEG, P.rotation[1] * DEG, P.rotation[2] * DEG, 'XYZ');
  if (!noScale && P.scale) g.scale.set(P.scale[0] || 1e-3, P.scale[1] || 1e-3, P.scale[2] || 1e-3); else g.scale.set(1, 1, 1);
}
function setMat(m, P) {
  if (P.color) m.color.set(P.color);
  if (P.roughness != null) m.roughness = P.roughness;
  if (P.metalness != null) m.metalness = P.metalness;
  if (P.opacity != null) { m.opacity = P.opacity; m.transparent = P.opacity < 0.999; m.depthWrite = P.opacity >= 0.999; }
}
const easeIO = (x) => x < 0 ? 0 : x > 1 ? 1 : x * x * (3 - 2 * x);

function pendulumAngle(P, ctx) {
  const L = Math.max(0.2, P.length), th0 = P.angle * DEG;
  const t0 = ctx.timeOf(P.release);
  if (ctx.t <= t0) return th0;
  const tt = ctx.t - t0;
  const w = Math.sqrt(Math.abs(ctx.g) / L) * (1 - th0 * th0 / 16);
  return th0 * Math.cos(w * tt) * Math.exp(-P.damping * tt);
}

const BASE_T = (extra) => Object.assign({ position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1], visible: true }, extra);
const MESH_DEF = (P) => Object.assign(BASE_T({ color: '#d9d9dc', roughness: 0.55, metalness: 0.0, opacity: 1, physics: 'collider', friction: 0.6,
  resolution: 'medium', spacingMM: 10, material: String(TI.clay), strength: 1, rigidity: 0.85, shatter: 6, softness: 0, goo: 0.3, plastic: 0.2, damping: 0.2, stand: false, sleep: true, release: -1, velocity: [0, 0, 0] }), P || {});

function meshType(label, icon, shape, geo, defaults) {
  return {
    label, icon, cat: 'mesh', shape,
    defaults: () => MESH_DEF(defaults),
    groups: (P) => P.physics === 'molecular' ? [G_TRANSFORM, G_COLLIDER, G_MOLECULAR(false), G_MAT, G_VIS] : [G_TRANSFORM, G_COLLIDER, G_MAT, G_VIS],
    build(view) {
      view.mat = stdMat('#d9d9dc', 0.55, 0);
      view.mesh = mkMesh(geo, view.mat);
      colliderOf(view.mesh, shape, 'main');
      view.root.add(view.mesh);
      view.pick = [view.mesh];
    },
    apply(view, P) {
      applyTransform(view, P);
      setMat(view.mat, P);
      const mol = P.physics === 'molecular';
      view.mesh.visible = !mol;
      view.mesh.userData.collider.off = P.physics !== 'collider';
      view.mesh.userData.collider.friction = P.friction;
    },
  };
}

const TYPES = {
  cube: meshType('Cube', 'cube', 'box', GEO.box),
  sphere: meshType('Sphere', 'sphere', 'sphere', GEO.sphere),
  cylinder: meshType('Cylinder', 'cylinder', 'cylinder', GEO.cylinder),
  cone: meshType('Cone', 'cone', 'cone', GEO.cone),
  torus: meshType('Torus', 'torus', 'torus', GEO.torus),
  capsule: meshType('Capsule', 'capsule', 'capsule', GEO.capsule),
  plane: Object.assign(meshType('Plane', 'plane', 'box', GEO.plane, { scale: [4, 1, 4] }), { shapeBase: [0.5, 0.01, 0.5] }),
};
TYPES.plane.build = function (view) {
  view.mat = stdMat('#d9d9dc', 0.55, 0); view.mesh = mkMesh(GEO.plane, view.mat);
  colliderOf(view.mesh, 'box', 'main', [0.5, 0.01, 0.5]); view.root.add(view.mesh); view.pick = [view.mesh];
};
TYPES.plane.groups = () => [G_TRANSFORM, G_COLLIDER, G_MAT, G_VIS];

/* ---------- humanoid ---------- */
TYPES.humanoid = {
  label: 'Humanoid', icon: 'humanoid', cat: 'body',
  defaults: () => ({ position: [0, 0, 0], rotation: [0, 0, 0], visible: true, physics: 'molecular',
    model: 'anatomical', pose: 'stand', height: 1.8, build: 0.6, fat: 0.2, jointStrength: 1, seed: 7, skinColor: '#e3e6eb', insideColor: '#4b22c9',
    resolution: 'medium', spacingMM: 10, strength: 1, rigidity: 0.82, tone: 0.85, shatter: 10, softness: 0.35, goo: 0.6, plastic: 0.1, damping: 0.18, firmness: 0.05, koHold: 0.18, spill: 0.5, knockout: 2.5, boneSnap: 5.5, friction: 0.6,
    bodyType: 'adult', stand: true, sleep: true, release: -1, velocity: [0, 0, 0], animation: 'none', animSpeed: 1, animLoop: true, animMove: true, react: true, animDrive: true, braceDanger: true }),
  groups: (P) => {
    const quad = P && (P.bodyType === 'dog' || P.bodyType === 'horse');
    const body = quad ? Object.assign({}, G_BODY, { fields: G_BODY.fields.filter(f => !['model', 'pose', 'build'].includes(f.key)) }) : G_BODY;
    const anim = quad ? Object.assign({}, G_ANIM, { fields: G_ANIM.fields.filter(f => !['braceDanger', 'importClip'].includes(f.key)).map(f => f.key === 'animation' ? Object.assign({}, f, { options: [['none', 'None (physics only)'], ['idle', 'Stand (idle)'], ['walk', 'Walk'], ['run', 'Run']], help: 'Four-legged walk and run cycles. Physics takes over when something hits the body.' }) : f) }) : G_ANIM;
    return [{ id: 'transform', title: 'Transform', fields: G_TRANSFORM.fields.slice(0, 2) }, body, anim, G_MOLECULAR(true), G_VIS];
  },
  build(view) { view.pick = []; },
  apply(view, P) { applyTransform(view, P, true); },
};

/* ---------- weapons ---------- */
const HAMMER_BLUE = '#1f7fd0';
TYPES.hammer = {
  label: 'Pendulum hammer', icon: 'hammer', cat: 'weapon',
  defaults: () => BASE_T({ position: [0, 4.3, 0], length: 3.1, headRadius: 0.32, headLength: 1.15, angle: 78, damping: 0.04, release: 0, orient: 'ram', color: HAMMER_BLUE, ropeColor: '#8eb4ff', friction: 0.4, showRopes: true }),
  groups: () => [G_TRANSFORM, { id: 'weapon', title: 'Pendulum hammer', fields: [
    F('length', 'Rope length', 'num', { min: 0.3, max: 20, step: 0.05, unit: 'm' }),
    F('angle', 'Pull-back angle', 'num', { min: -175, max: 175, step: 1, unit: '°' }),
    F('release', 'Release at frame', 'int', { min: 0, max: 100000, step: 1 }),
    F('damping', 'Damping', 'num', { min: 0, max: 3, step: 0.01 }),
    F('headRadius', 'Head radius', 'num', { min: 0.05, max: 3, step: 0.01, unit: 'm' }),
    F('headLength', 'Head length', 'num', { min: 0.1, max: 6, step: 0.02, unit: 'm' }),
    F('orient', 'Head faces', 'select', { options: [['ram', 'Along the swing (ram)'], ['log', 'Across the swing (log)']] }),
    F('friction', 'Friction', 'num', { min: 0, max: 2, step: 0.05 }),
    F('showRopes', 'Show ropes', 'bool'),
  ] }, { id: 'material', title: 'Colors', fields: [F('color', 'Head', 'color'), F('ropeColor', 'Ropes', 'color')] }, G_VIS],
  build(view) {
    view.headMat = stdMat(HAMMER_BLUE, 0.28, 0.15);
    view.ropeMat = new THREE.MeshStandardMaterial({ color: '#8eb4ff', roughness: 0.4, emissive: '#3b5bd6', emissiveIntensity: 0.35 });
    view.head = new THREE.Group(); view.root.add(view.head);
    view.headMesh = mkMesh(GEO.cylinder, view.headMat); view.head.add(view.headMesh);
    colliderOf(view.headMesh, 'cylinder', 'head');
    view.capA = mkMesh(GEO.cylinder, stdMat('#5fb6ff', 0.3, 0.1)); view.capB = mkMesh(GEO.cylinder, stdMat('#5fb6ff', 0.3, 0.1));
    view.head.add(view.capA, view.capB);
    view.ropes = [mkMesh(GEO.unitCyl, view.ropeMat, false), mkMesh(GEO.unitCyl, view.ropeMat, false)];
    view.ropes.forEach(r => view.root.add(r));
    view.bar = mkMesh(GEO.box, stdMat('#6f7480', 0.6, 0.2)); view.root.add(view.bar);
    view.pick = [view.headMesh, view.bar];
  },
  apply(view, P, ctx) {
    applyTransform(view, P, true);
    view.headMat.color.set(P.color); view.ropeMat.color.set(P.ropeColor); view.ropeMat.emissive.set(P.ropeColor).multiplyScalar(0.4);
    const th = pendulumAngle(P, ctx), L = P.length;
    view.head.position.set(0, -L * Math.cos(th), L * Math.sin(th));
    const R = P.headRadius, HL = P.headLength;
    const ram = P.orient !== 'log';
    view.headMesh.scale.set(R * 2, HL, R * 2);
    view.headMesh.rotation.set(ram ? Math.PI / 2 : 0, 0, ram ? 0 : Math.PI / 2);
    const capT = Math.min(0.08, HL * 0.08);
    for (const [cap, sg] of [[view.capA, 1], [view.capB, -1]]) {
      cap.scale.set(R * 2.06, capT, R * 2.06); cap.rotation.copy(view.headMesh.rotation);
      const off = (HL / 2 - capT / 2 + 0.006) * sg; cap.position.set(ram ? 0 : off, 0, ram ? off : 0);
    }
    const d = HL * 0.34;
    for (let k = 0; k < 2; k++) {
      const s = k ? -1 : 1;
      const a = new THREE.Vector3(ram ? 0 : d * s, 0, ram ? d * s : 0);
      const b = new THREE.Vector3(a.x, 0, a.z).add(view.head.position).add(new THREE.Vector3(0, R * 0.92, 0));
      placeRod(view.ropes[k], a, b, 0.022);
      view.ropes[k].visible = P.showRopes;
    }
    view.bar.scale.set(ram ? 0.12 : HL * 0.9, 0.12, ram ? HL * 0.9 : 0.12);
    view.bar.visible = P.showRopes;
    view.headMesh.userData.collider.friction = P.friction;
  },
};

TYPES.wreckingball = {
  label: 'Wrecking ball', icon: 'ball', cat: 'weapon',
  defaults: () => BASE_T({ position: [0, 5, 0], length: 4, radius: 0.5, angle: 70, damping: 0.03, release: 0, color: '#2b2e35', chainColor: '#9aa1ad', friction: 0.5 }),
  groups: () => [G_TRANSFORM, { id: 'weapon', title: 'Wrecking ball', fields: [
    F('length', 'Chain length', 'num', { min: 0.3, max: 30, step: 0.05, unit: 'm' }),
    F('angle', 'Pull-back angle', 'num', { min: -175, max: 175, step: 1, unit: '°' }),
    F('release', 'Release at frame', 'int', { min: 0, max: 100000, step: 1 }),
    F('damping', 'Damping', 'num', { min: 0, max: 3, step: 0.01 }),
    F('radius', 'Ball radius', 'num', { min: 0.05, max: 4, step: 0.01, unit: 'm' }),
    F('friction', 'Friction', 'num', { min: 0, max: 2, step: 0.05 }),
  ] }, { id: 'material', title: 'Colors', fields: [F('color', 'Ball', 'color'), F('chainColor', 'Chain', 'color')] }, G_VIS],
  build(view) {
    view.ballMat = stdMat('#2b2e35', 0.35, 0.7);
    view.ball = mkMesh(GEO.sphere, view.ballMat); colliderOf(view.ball, 'sphere', 'ball');
    view.chainMat = stdMat('#9aa1ad', 0.35, 0.8);
    view.chain = mkMesh(GEO.unitCyl, view.chainMat, false);
    view.root.add(view.ball, view.chain); view.pick = [view.ball];
  },
  apply(view, P, ctx) {
    applyTransform(view, P, true);
    view.ballMat.color.set(P.color); view.chainMat.color.set(P.chainColor);
    const th = pendulumAngle(P, ctx), L = P.length;
    view.ball.position.set(0, -L * Math.cos(th), L * Math.sin(th));
    view.ball.scale.setScalar(P.radius * 2);
    placeRod(view.chain, new THREE.Vector3(), view.ball.position.clone().multiplyScalar(1 - P.radius / L), 0.035);
    view.ball.userData.collider.friction = P.friction;
  },
};

TYPES.blade = {
  label: 'Pendulum blade', icon: 'blade', cat: 'weapon',
  defaults: () => BASE_T({ position: [0, 4.2, 0], length: 3.2, width: 1.3, bladeHeight: 0.45, thickness: 0.05, angle: 75, damping: 0.02, release: 0, color: '#c9ced8', armColor: '#59606c', friction: 0.2 }),
  groups: () => [G_TRANSFORM, { id: 'weapon', title: 'Pendulum blade', fields: [
    F('length', 'Arm length', 'num', { min: 0.3, max: 20, step: 0.05, unit: 'm' }),
    F('angle', 'Pull-back angle', 'num', { min: -175, max: 175, step: 1, unit: '°' }),
    F('release', 'Release at frame', 'int', { min: 0, max: 100000, step: 1 }),
    F('damping', 'Damping', 'num', { min: 0, max: 3, step: 0.01 }),
    F('width', 'Blade width', 'num', { min: 0.1, max: 6, step: 0.02, unit: 'm' }),
    F('bladeHeight', 'Blade height', 'num', { min: 0.05, max: 3, step: 0.01, unit: 'm' }),
    F('thickness', 'Thickness', 'num', { min: 0.01, max: 0.5, step: 0.005, unit: 'm' }),
    F('friction', 'Friction', 'num', { min: 0, max: 2, step: 0.05 }),
  ] }, { id: 'material', title: 'Colors', fields: [F('color', 'Blade', 'color'), F('armColor', 'Arm', 'color')] }, G_VIS],
  build(view) {
    view.arm = new THREE.Group(); view.root.add(view.arm);
    view.bMat = stdMat('#c9ced8', 0.18, 0.9); view.aMat = stdMat('#59606c', 0.5, 0.4);
    view.bladeM = mkMesh(GEO.box, view.bMat); colliderOf(view.bladeM, 'box', 'blade');
    view.rod = mkMesh(GEO.box, view.aMat); view.arm.add(view.bladeM, view.rod);
    view.pick = [view.bladeM, view.rod];
  },
  apply(view, P, ctx) {
    applyTransform(view, P, true);
    view.bMat.color.set(P.color); view.aMat.color.set(P.armColor);
    view.arm.rotation.set(-pendulumAngle(P, ctx), 0, 0);
    const L = P.length;
    view.bladeM.scale.set(P.thickness, P.bladeHeight, P.width); view.bladeM.position.set(0, -L, 0);
    view.rod.scale.set(0.07, L - P.bladeHeight / 2, 0.07); view.rod.position.set(0, -(L - P.bladeHeight / 2) / 2, 0);
    view.bladeM.userData.collider.friction = P.friction;
  },
};

TYPES.saw = {
  label: 'Buzzsaw', icon: 'saw', cat: 'weapon',
  defaults: () => BASE_T({ position: [0, 1.25, 0.55], rotation: [0, 90, 0], radius: 0.55, thickness: 0.035, rpm: 900, travel: 0, travelSpeed: 1, travelStart: 0, mountWall: true, color: '#1d86c8', wallColor: '#6b6e74', friction: 0.8 }),
  groups: () => [G_TRANSFORM, { id: 'weapon', title: 'Buzzsaw', fields: [
    F('radius', 'Radius', 'num', { min: 0.05, max: 4, step: 0.01, unit: 'm' }),
    F('thickness', 'Thickness', 'num', { min: 0.005, max: 0.5, step: 0.005, unit: 'm' }),
    F('rpm', 'Spin', 'num', { min: -6000, max: 6000, step: 10, unit: 'rpm' }),
    F('travel', 'Travel distance', 'num', { min: -20, max: 20, step: 0.05, unit: 'm' }),
    F('travelSpeed', 'Travel speed', 'num', { min: 0.01, max: 40, step: 0.05, unit: 'm/s' }),
    F('travelStart', 'Start travel at frame', 'int', { min: 0, max: 100000, step: 1 }),
    F('mountWall', 'Mount wall', 'bool'),
    F('friction', 'Grip', 'num', { min: 0, max: 2, step: 0.05 }),
  ] }, { id: 'material', title: 'Colors', fields: [F('color', 'Disc', 'color'), F('wallColor', 'Wall', 'color')] }, G_VIS],
  build(view) {
    view.mover = new THREE.Group(); view.root.add(view.mover);
    view.dMat = new THREE.MeshPhysicalMaterial({ color: '#1d86c8', roughness: 0.12, metalness: 0.0, clearcoat: 1, clearcoatRoughness: 0.08 });
    view.disc = mkMesh(GEO.disc, view.dMat); view.disc.rotation.z = Math.PI / 2;
    view.discCol = new THREE.Object3D(); view.discCol.rotation.z = Math.PI / 2;
    colliderOf(view.discCol, 'cylinder', 'disc', [1, 0.5, 1]);
    view.rim = mkMesh(new THREE.TorusGeometry(1, 0.03, 10, 96), stdMat('#121418', 0.4, 0.3)); view.rim.rotation.y = Math.PI / 2;
    view.mover.add(view.disc, view.rim, view.discCol);
    view.wMat = stdMat('#6b6e74', 0.85, 0);
    view.wall = mkMesh(GEO.box, view.wMat); colliderOf(view.wall, 'box', 'wall');
    view.root.add(view.wall);
    view.pick = [view.disc, view.wall];
  },
  apply(view, P, ctx) {
    applyTransform(view, P, true);
    view.dMat.color.set(P.color); view.wMat.color.set(P.wallColor);
    const t0 = ctx.timeOf(P.travelStart);
    const off = ctx.t > t0 ? Math.sign(P.travel) * Math.min(Math.abs(P.travel), (ctx.t - t0) * P.travelSpeed) : 0;
    view.mover.position.set(0, 0, off);
    const R = P.radius;
    view.disc.scale.set(R, P.thickness, R);
    view.rim.scale.set(R, R, R * 0.6);
    const ang = ctx.t * P.rpm / 60 * Math.PI * 2;
    view.disc.rotation.set(ang, 0, Math.PI / 2);
    view.rim.rotation.set(0, Math.PI / 2, 0);
    view.wall.visible = P.mountWall; view.wall.userData.collider.off = !P.mountWall;
    view.wall.scale.set(0.3, R * 2 + 2.2, R * 2 + 0.6);
    view.wall.position.set(-(P.thickness / 2 + 0.17), (R * 2 + 2.2) / 2 - view.root.position.y, off);
    view.discCol.scale.set(R, P.thickness, R);
    const c = view.discCol.userData.collider;
    c.friction = P.friction;
    c.spinLocal = [0, P.rpm / 60 * Math.PI * 2, 0];
  },
};

TYPES.crusher = {
  label: 'Hydraulic press', icon: 'press', cat: 'weapon',
  defaults: () => BASE_T({ position: [0, 4.2, 0], width: 1.4, depth: 1.0, plateThick: 0.3, stroke: 3.9, start: 30, downTime: 0.7, hold: 0.6, upTime: 1.4, repeat: true, color: '#d24a3c', frameColor: '#3c3f47', friction: 0.6 }),
  groups: () => [G_TRANSFORM, { id: 'weapon', title: 'Hydraulic press', fields: [
    F('stroke', 'Stroke', 'num', { min: 0.1, max: 20, step: 0.05, unit: 'm' }),
    F('start', 'Start at frame', 'int', { min: 0, max: 100000, step: 1 }),
    F('downTime', 'Press time', 'num', { min: 0.05, max: 20, step: 0.05, unit: 's' }),
    F('hold', 'Hold', 'num', { min: 0, max: 20, step: 0.05, unit: 's' }),
    F('upTime', 'Return time', 'num', { min: 0.05, max: 20, step: 0.05, unit: 's' }),
    F('repeat', 'Repeat', 'bool'),
    F('width', 'Plate width', 'num', { min: 0.1, max: 10, step: 0.05, unit: 'm' }),
    F('depth', 'Plate depth', 'num', { min: 0.1, max: 10, step: 0.05, unit: 'm' }),
    F('plateThick', 'Plate thickness', 'num', { min: 0.05, max: 2, step: 0.01, unit: 'm' }),
    F('friction', 'Friction', 'num', { min: 0, max: 2, step: 0.05 }),
  ] }, { id: 'material', title: 'Colors', fields: [F('color', 'Plate', 'color'), F('frameColor', 'Housing', 'color')] }, G_VIS],
  build(view) {
    view.pMat = stdMat('#d24a3c', 0.35, 0.3); view.fMat = stdMat('#3c3f47', 0.5, 0.5);
    view.plate = mkMesh(GEO.box, view.pMat); colliderOf(view.plate, 'box', 'plate');
    view.house = mkMesh(GEO.box, view.fMat); colliderOf(view.house, 'box', 'house');
    view.rod = mkMesh(GEO.unitCyl, stdMat('#c7ccd6', 0.15, 0.95));
    view.root.add(view.plate, view.house, view.rod); view.pick = [view.plate, view.house];
  },
  apply(view, P, ctx) {
    applyTransform(view, P, true);
    view.pMat.color.set(P.color); view.fMat.color.set(P.frameColor);
    const t0 = ctx.timeOf(P.start);
    let s = 0;
    if (ctx.t > t0) {
      let tt = ctx.t - t0; const cyc = P.downTime + P.hold + P.upTime + 0.4;
      if (P.repeat) tt %= cyc;
      if (tt < P.downTime) { const x = tt / P.downTime; s = x * x; }
      else if (tt < P.downTime + P.hold) s = 1;
      else if (tt < P.downTime + P.hold + P.upTime) s = 1 - easeIO((tt - P.downTime - P.hold) / P.upTime);
      else s = P.repeat ? 0 : 1 - 1;
      if (!P.repeat && tt >= P.downTime + P.hold + P.upTime) s = 0;
    }
    // the plate stops just above the floor instead of driving through it (and through whatever is under it)
    const W_ = APP.worldP || WORLD_DEFAULTS(), up = !(P.rotation && (Math.abs(P.rotation[0]) > 1 || Math.abs(P.rotation[2]) > 1));
    const sc = P.scale ? P.scale[1] || 1 : 1;
    const stroke = W_.floor !== false && up ? Math.max(0, Math.min(P.stroke, (P.position[1] - 0.04) / sc - 0.5 - P.plateThick)) : P.stroke;
    const y = -0.5 - P.plateThick / 2 - s * stroke;
    view.plate.scale.set(P.width, P.plateThick, P.depth); view.plate.position.set(0, y, 0);
    view.house.scale.set(P.width * 0.7, 0.6, P.depth * 0.7); view.house.position.set(0, 0, 0);
    placeRod(view.rod, new THREE.Vector3(0, -0.2, 0), new THREE.Vector3(0, y + P.plateThick / 2, 0), 0.09);
    view.plate.userData.collider.friction = P.friction;
  },
};

TYPES.pusher = {
  label: 'Wall ram', icon: 'wall', cat: 'weapon',
  defaults: () => BASE_T({ position: [0, 0, -2.4], width: 2.4, height: 2.4, thick: 0.35, distance: 3.2, speed: 6, start: 30, returnAfter: 1.5, color: '#7b7f88', friction: 0.6 }),
  groups: () => [G_TRANSFORM, { id: 'weapon', title: 'Wall ram', fields: [
    F('distance', 'Push distance', 'num', { min: 0, max: 40, step: 0.05, unit: 'm' }),
    F('speed', 'Speed', 'num', { min: 0.05, max: 60, step: 0.05, unit: 'm/s' }),
    F('start', 'Start at frame', 'int', { min: 0, max: 100000, step: 1 }),
    F('returnAfter', 'Return after', 'num', { min: -1, max: 60, step: 0.05, unit: 's', help: '-1 keeps the wall extended.' }),
    F('width', 'Width', 'num', { min: 0.1, max: 20, step: 0.05, unit: 'm' }),
    F('height', 'Height', 'num', { min: 0.1, max: 20, step: 0.05, unit: 'm' }),
    F('thick', 'Thickness', 'num', { min: 0.05, max: 4, step: 0.01, unit: 'm' }),
    F('friction', 'Friction', 'num', { min: 0, max: 2, step: 0.05 }),
  ] }, { id: 'material', title: 'Colors', fields: [F('color', 'Wall', 'color')] }, G_VIS],
  build(view) {
    view.wMat = stdMat('#7b7f88', 0.7, 0.05);
    view.wall = mkMesh(GEO.box, view.wMat); colliderOf(view.wall, 'box', 'wall');
    view.rods = [0, 1].map(() => mkMesh(GEO.unitCyl, stdMat('#c7ccd6', 0.15, 0.95)));
    view.root.add(view.wall, ...view.rods); view.pick = [view.wall];
  },
  apply(view, P, ctx) {
    applyTransform(view, P, true);
    view.wMat.color.set(P.color);
    const t0 = ctx.timeOf(P.start);
    let z = 0;
    if (ctx.t > t0) {
      const tt = ctx.t - t0, tout = P.distance / Math.max(P.speed, 1e-3);
      z = Math.min(P.distance, tt * P.speed);
      if (P.returnAfter >= 0 && tt > tout + P.returnAfter) z = Math.max(0, P.distance - (tt - tout - P.returnAfter) * P.speed * 0.4);
    }
    view.wall.scale.set(P.width, P.height, P.thick); view.wall.position.set(0, P.height / 2, z);
    view.rods.forEach((r, k) => placeRod(r, new THREE.Vector3((k ? -1 : 1) * P.width * 0.25, P.height / 2, -1.2), new THREE.Vector3((k ? -1 : 1) * P.width * 0.25, P.height / 2, z - P.thick / 2), 0.06));
    view.wall.userData.collider.friction = P.friction;
  },
};

TYPES.spinner = {
  label: 'Spinning sweeper', icon: 'spinner', cat: 'weapon',
  defaults: () => BASE_T({ position: [0, 0, 0], barHeight: 0.45, barLength: 4.2, barThick: 0.16, rpm: 45, start: 20, spinUp: 1.2, color: '#f0a32e', postColor: '#40444c', friction: 0.6 }),
  groups: () => [G_TRANSFORM, { id: 'weapon', title: 'Spinning sweeper', fields: [
    F('rpm', 'Speed', 'num', { min: -600, max: 600, step: 1, unit: 'rpm' }),
    F('start', 'Start at frame', 'int', { min: 0, max: 100000, step: 1 }),
    F('spinUp', 'Spin-up time', 'num', { min: 0, max: 20, step: 0.05, unit: 's' }),
    F('barHeight', 'Bar height', 'num', { min: 0.05, max: 10, step: 0.01, unit: 'm' }),
    F('barLength', 'Bar length', 'num', { min: 0.2, max: 20, step: 0.05, unit: 'm' }),
    F('barThick', 'Bar thickness', 'num', { min: 0.02, max: 1, step: 0.01, unit: 'm' }),
    F('friction', 'Friction', 'num', { min: 0, max: 2, step: 0.05 }),
  ] }, { id: 'material', title: 'Colors', fields: [F('color', 'Bar', 'color'), F('postColor', 'Post', 'color')] }, G_VIS],
  build(view) {
    view.spin = new THREE.Group(); view.root.add(view.spin);
    view.bMat = stdMat('#f0a32e', 0.35, 0.2); view.pMat = stdMat('#40444c', 0.5, 0.4);
    view.bar = mkMesh(GEO.box, view.bMat); colliderOf(view.bar, 'box', 'bar');
    view.post = mkMesh(GEO.cylinder, view.pMat); colliderOf(view.post, 'cylinder', 'post');
    view.spin.add(view.bar); view.root.add(view.post); view.pick = [view.bar, view.post];
  },
  apply(view, P, ctx) {
    applyTransform(view, P, true);
    view.bMat.color.set(P.color); view.pMat.color.set(P.postColor);
    const t0 = ctx.timeOf(P.start), w = P.rpm / 60 * Math.PI * 2;
    let a = 0;
    if (ctx.t > t0) { const tt = ctx.t - t0, su = Math.max(1e-3, P.spinUp); a = tt < su ? 0.5 * w * tt * tt / su : w * (tt - su / 2); }
    view.spin.rotation.set(0, a, 0);
    view.bar.scale.set(P.barThick, P.barThick, P.barLength); view.bar.position.set(0, P.barHeight, 0);
    view.post.scale.set(0.22, P.barHeight + 0.25, 0.22); view.post.position.set(0, (P.barHeight + 0.25) / 2, 0);
    view.bar.userData.collider.friction = P.friction;
  },
};

TYPES.guillotine = {
  label: 'Guillotine', icon: 'guillotine', cat: 'weapon',
  defaults: () => BASE_T({ position: [0, 0, 0], frameHeight: 3.4, width: 1.2, bladeHeight: 0.45, thickness: 0.04, drop: 40, speed: 0, color: '#d7dbe3', frameColor: '#5a3e2b', friction: 0.15 }),
  groups: () => [G_TRANSFORM, { id: 'weapon', title: 'Guillotine', fields: [
    F('drop', 'Drop at frame', 'int', { min: 0, max: 100000, step: 1 }),
    F('speed', 'Lowering speed', 'num', { min: 0, max: 40, step: 0.05, unit: 'm/s', help: '0 lets the blade free-fall. Above 0 it lowers at this steady speed.' }),
    F('frameHeight', 'Frame height', 'num', { min: 0.5, max: 20, step: 0.05, unit: 'm' }),
    F('width', 'Blade width', 'num', { min: 0.1, max: 6, step: 0.02, unit: 'm' }),
    F('bladeHeight', 'Blade height', 'num', { min: 0.05, max: 3, step: 0.01, unit: 'm' }),
    F('thickness', 'Thickness', 'num', { min: 0.005, max: 0.5, step: 0.005, unit: 'm' }),
    F('friction', 'Friction', 'num', { min: 0, max: 2, step: 0.05 }),
  ] }, { id: 'material', title: 'Colors', fields: [F('color', 'Blade', 'color'), F('frameColor', 'Frame', 'color')] }, G_VIS],
  build(view) {
    view.bMat = stdMat('#d7dbe3', 0.15, 0.95); view.fMat = stdMat('#5a3e2b', 0.75, 0);
    view.blade = mkMesh(GEO.box, view.bMat); colliderOf(view.blade, 'box', 'blade');
    view.posts = [0, 1].map(k => colliderOf(mkMesh(GEO.box, view.fMat), 'box', 'post' + k));
    view.beam = mkMesh(GEO.box, view.fMat);
    view.root.add(view.blade, ...view.posts, view.beam); view.pick = [view.blade, ...view.posts, view.beam];
  },
  apply(view, P, ctx) {
    applyTransform(view, P, true);
    view.bMat.color.set(P.color); view.fMat.color.set(P.frameColor);
    const H = P.frameHeight, top = H - 0.35 - P.bladeHeight / 2, bot = P.bladeHeight / 2 + 0.01;
    const t0 = ctx.timeOf(P.drop);
    let y = top;
    if (ctx.t > t0) { const tt = ctx.t - t0; y = Math.max(bot, top - (P.speed > 0 ? P.speed * tt : 0.5 * Math.abs(ctx.g) * tt * tt)); }
    view.blade.scale.set(P.width, P.bladeHeight, P.thickness); view.blade.position.set(0, y, 0);
    view.posts.forEach((p, k) => { p.scale.set(0.16, H, 0.22); p.position.set((k ? -1 : 1) * (P.width / 2 + 0.1), H / 2, 0); });
    view.beam.scale.set(P.width + 0.36, 0.22, 0.26); view.beam.position.set(0, H - 0.11, 0);
    view.blade.userData.collider.friction = P.friction;
  },
};

TYPES.spikes = {
  label: 'Spike bed', icon: 'spikes', cat: 'weapon',
  defaults: () => BASE_T({ rows: 5, cols: 5, spacing: 0.34, spikeHeight: 0.55, spikeRadius: 0.07, color: '#b9bec8', baseColor: '#3a3d44', friction: 0.8 }),
  groups: () => [G_TRANSFORM, { id: 'weapon', title: 'Spike bed', fields: [
    F('rows', 'Rows', 'int', { min: 1, max: 12, step: 1, noanim: true }),
    F('cols', 'Columns', 'int', { min: 1, max: 12, step: 1, noanim: true }),
    F('spacing', 'Spacing', 'num', { min: 0.05, max: 3, step: 0.01, unit: 'm' }),
    F('spikeHeight', 'Spike height', 'num', { min: 0.05, max: 4, step: 0.01, unit: 'm' }),
    F('spikeRadius', 'Spike radius', 'num', { min: 0.01, max: 1, step: 0.005, unit: 'm' }),
    F('friction', 'Friction', 'num', { min: 0, max: 2, step: 0.05 }),
  ] }, { id: 'material', title: 'Colors', fields: [F('color', 'Spikes', 'color'), F('baseColor', 'Base', 'color')] }, G_VIS],
  build(view) {
    view.sMat = stdMat('#b9bec8', 0.2, 0.9); view.bMat = stdMat('#3a3d44', 0.6, 0.2);
    view.base = mkMesh(GEO.box, view.bMat); colliderOf(view.base, 'box', 'base');
    view.root.add(view.base); view.spikes = []; view.pick = [view.base];
  },
  apply(view, P) {
    applyTransform(view, P, true);
    view.sMat.color.set(P.color); view.bMat.color.set(P.baseColor);
    const n = clamp(P.rows | 0, 1, 12) * clamp(P.cols | 0, 1, 12);
    while (view.spikes.length < n) { const m = mkMesh(GEO.cone, view.sMat); colliderOf(m, 'cone', 'spike' + view.spikes.length); view.spikes.push(m); view.root.add(m); view.pick.push(m); }
    const R = clamp(P.rows | 0, 1, 12), C = clamp(P.cols | 0, 1, 12);
    view.spikes.forEach((m, k) => {
      const on = k < n; m.visible = on; m.userData.collider.off = !on; if (!on) return;
      const r = Math.floor(k / C), c = k % C;
      m.scale.set(P.spikeRadius * 2, P.spikeHeight, P.spikeRadius * 2);
      m.position.set((c - (C - 1) / 2) * P.spacing, 0.08 + P.spikeHeight / 2, (r - (R - 1) / 2) * P.spacing);
      m.userData.collider.friction = P.friction;
    });
    view.base.scale.set(C * P.spacing + 0.2, 0.08, R * P.spacing + 0.2); view.base.position.set(0, 0.04, 0);
  },
};

TYPES.cannon = {
  label: 'Cannon', icon: 'cannon', cat: 'weapon',
  defaults: () => BASE_T({ position: [0, 1.3, -6], ballRadius: 0.16, speed: 28, interval: 0.35, count: 6, first: 30, gravity: true, color: '#2d3038', ballColor: '#1a1b1f', friction: 0.4, impactDist: 0, dynamic: true, ballDensity: 1800, bounce: 0.3, power: 1 }),
  groups: () => [G_TRANSFORM, { id: 'weapon', title: 'Cannon', fields: [
    F('first', 'First shot at frame', 'int', { min: 0, max: 100000, step: 1 }),
    F('count', 'Shots', 'int', { min: 1, max: 40, step: 1, noanim: true }),
    F('interval', 'Time between shots', 'num', { min: 0.02, max: 20, step: 0.01, unit: 's' }),
    F('speed', 'Muzzle speed', 'num', { min: 0.5, max: 200, step: 0.5, unit: 'm/s' }),
    F('ballRadius', 'Ball radius', 'num', { min: 0.01, max: 2, step: 0.005, unit: 'm' }),
    F('gravity', 'Balls fall', 'bool'),
    F('dynamic', 'Real physics balls', 'bool', { help: 'Balls are fully simulated: they hit, slow down, bounce off, roll and pile up. Off = the old scripted flight path.' }),
    F('ballDensity', 'Ball density', 'num', { min: 50, max: 12000, step: 50, unit: 'kg/m³', help: 'Rubber ~1100, stone ~2500, steel 7800. Heavier balls plough through instead of bouncing off.' }),
    F('bounce', 'Bounciness', 'num', { min: 0, max: 0.95, step: 0.05 }),
    F('power', 'Shatter power', 'num', { min: 0.1, max: 20, step: 0.1, help: 'How easily the balls tear flesh.' }),
    F('impactDist', 'Impact distance', 'num', { min: 0, max: 200, step: 0.05, unit: 'm', help: 'Scripted balls only: where they stop instead of flying on (0 = never).' }),
  ] }, { id: 'material', title: 'Colors', fields: [F('color', 'Barrel', 'color'), F('ballColor', 'Balls', 'color')] }, G_VIS],
  build(view) {
    view.cMat = stdMat('#2d3038', 0.35, 0.75); view.ballMat = stdMat('#1a1b1f', 0.3, 0.8);
    view.barrel = mkMesh(GEO.cylinder, view.cMat); view.barrel.rotation.x = Math.PI / 2; view.barrel.scale.set(0.42, 1.2, 0.42); view.barrel.position.z = 0.2;
    view.breech = mkMesh(GEO.sphere, view.cMat); view.breech.scale.setScalar(0.5); view.breech.position.z = -0.4;
    view.root.add(view.barrel, view.breech);
    view.balls = []; view.ballGroup = new THREE.Group(); view.pick = [view.barrel, view.breech];
    view.world.add(view.ballGroup);
  },
  dispose(view) { view.ballGroup.removeFromParent(); },
  // balls leaving the barrel during this frame, handed to the physics engine
  projectiles(view, P, ctx, prev, o) {
    if (P.dynamic === false) return [];
    const n = clamp(P.count | 0, 1, 40), out = [];
    view.root.updateMatrixWorld(true);
    const muzzle = new THREE.Vector3(0, 0, 0.85).applyMatrix4(view.root.matrixWorld);
    const dir = new THREE.Vector3(0, 0, 1).transformDirection(view.root.matrixWorld);
    const t0 = ctx.timeOf(P.first), r = P.ballRadius, m = 4.18879 * r * r * r * (P.ballDensity || 1800);
    for (let k = 0; k < n; k++) {
      const tk = t0 + k * P.interval; if (!(tk > prev.t && tk <= ctx.t)) continue;
      const tau = ctx.t - tk, g = P.gravity ? ctx.g : 0;
      out.push({ key: o.id + ':ball' + k, r, m, friction: P.friction, restitution: P.bounce != null ? P.bounce : 0.3, shatterMul: 1 / Math.max(0.05, P.power || 1),
        p: [muzzle.x + dir.x * P.speed * tau, muzzle.y + dir.y * P.speed * tau + 0.5 * g * tau * tau, muzzle.z + dir.z * P.speed * tau],
        v: [dir.x * P.speed, dir.y * P.speed + g * tau, dir.z * P.speed] });
    }
    return out;
  },
  apply(view, P, ctx) {
    applyTransform(view, P, true);
    view.cMat.color.set(P.color); view.ballMat.color.set(P.ballColor);
    const n = clamp(P.count | 0, 1, 40);
    while (view.balls.length < n) { const b = mkMesh(GEO.sphere, view.ballMat); colliderOf(b, 'sphere', 'ball' + view.balls.length); view.balls.push(b); view.ballGroup.add(b); }
    view.root.updateMatrixWorld(true);
    const muzzle = new THREE.Vector3(0, 0, 0.85).applyMatrix4(view.root.matrixWorld);
    const dir = new THREE.Vector3(0, 0, 1).transformDirection(view.root.matrixWorld);
    const t0 = ctx.timeOf(P.first);
    if (P.dynamic !== false) {
      // simulated balls: the engine owns them, the view only shows where the simulation put them
      view.balls.forEach((b, k) => {
        b.userData.collider.off = true;
        const tau = ctx.t - (t0 + k * P.interval);
        b.scale.setScalar(P.ballRadius * 2);
        const d = ctx.dyn && ctx.dyn.get(view.obj.id + ':ball' + k);
        if (d) { b.position.set(d[0], d[1], d[2]); b.quaternion.set(d[3], d[4], d[5], d[6]); b.visible = P.visible && k < n; return; }
        // not simulated yet: show the free flight out of the barrel
        b.visible = !ctx.dyn && P.visible && k < n && tau >= 0 && tau < 0.6 && ctx.frame >= 0;
        b.quaternion.identity();
        b.position.copy(muzzle).addScaledVector(dir, P.speed * Math.max(0, tau));
        if (P.gravity) b.position.y += 0.5 * ctx.g * tau * tau;
        if (b.position.y < P.ballRadius) b.position.y = P.ballRadius;
      });
      view.ballGroup.updateMatrixWorld(true);
      return;
    }
    view.balls.forEach((b, k) => {
      b.quaternion.identity();
      const tk = t0 + k * P.interval, tau = ctx.t - tk;
      const live = k < n && tau >= 0 && tau < (P.impactDist > 0 ? 1e6 : 4) && ctx.frame >= 0;
      b.visible = live && P.visible; b.userData.collider.off = !live;
      if (!live) { b.position.copy(muzzle); return; }
      b.scale.setScalar(P.ballRadius * 2);
      const D = P.impactDist || 0, ti = D > 0 ? D / Math.max(0.1, P.speed) : Infinity;
      if (tau <= ti) {
        b.position.copy(muzzle).addScaledVector(dir, P.speed * tau);
        if (P.gravity) b.position.y += 0.5 * ctx.g * tau * tau;
      } else {
        // the ball hits its target: it sinks in a little, loses its speed, rebounds slightly and drops to the floor
        const yi = muzzle.y + (P.gravity ? 0.5 * ctx.g * ti * ti : 0) + dir.y * D;
        const tf = Math.sqrt(Math.max(0, 2 * (yi - P.ballRadius) / Math.max(0.1, -ctx.g)));
        const sa = Math.min(tau - ti, tf), pen = (P.impactDepth != null ? P.impactDepth : 0.14);
        const along = D + pen * (1 - Math.exp(-sa / 0.012)) - 1.1 * sa;
        b.position.copy(muzzle).addScaledVector(dir, along);
        b.position.y = yi + 0.5 * ctx.g * (tau - ti) * (tau - ti);
      }
      if (b.position.y < P.ballRadius) b.position.y = P.ballRadius;
    });
    view.ballGroup.updateMatrixWorld(true);
  },
};

/* ---------- emitter: keeps spawning real physics balls at a rate, speed and spread ----------
 * Balls leave along the emitter's forward (blue, +Z) axis. Rate and speed can be keyframed: the number of balls
 * emitted so far is integrated frame by frame (emitTable), so ball k always gets the same launch moment and
 * random numbers, and re-simulating gives the same result. Lifetime removes balls from the simulation again. */
function emitRand(o, k, n) { if (o._seed == null) o._seed = [...o.id].reduce((a, c) => Math.imul(a, 31) + c.charCodeAt(0) | 0, 7); return hash01(hash01i(o._seed ^ Math.imul(k + 1, 0x9E3779B1)) ^ Math.imul(n + 1, 0x85EBCA77)); }
function hash01i(i) { i = i | 0; i = Math.imul(i ^ (i >>> 16), 0x45d9f3b); i = Math.imul(i ^ (i >>> 16), 0x45d9f3b); return i ^ (i >>> 16); }
function hash01(i) { i = i | 0; i = Math.imul(i ^ (i >>> 16), 0x45d9f3b); i = Math.imul(i ^ (i >>> 16), 0x45d9f3b); i ^= i >>> 16; return (i >>> 0) / 4294967296; }
function emitTable(o) {
  const [s, e] = frameRange(), gen = (APP.editGen || 0) + ':' + s + ':' + e + ':' + (TIME.table ? TIME.table.length : 0);
  if (o._et && o._et.gen === gen) return o._et;
  const n = e - s + 3, T = new Float64Array(n), C = new Float64Array(n);
  let c = 0;
  for (let i = 0; i < n; i++) {
    const f = s + i, P = evalProps(o, f), t = timeOf(f);
    if (i > 0) {
      const on = f > P.start && (P.end < 0 || f <= P.end) && P.visible !== false;
      if (on) c += Math.max(0, P.rate) * (t - T[i - 1]);
    }
    T[i] = t; C[i] = c;
  }
  // a ball is emitted when the running count passes a whole number; the first one leaves right at the start frame
  return (o._et = { gen, s, T, C, cap: () => Math.max(1, evalProps(o, s).limit | 0) });
}
// how many balls have left by time t (fractional), and when ball k left
function emitCount(et, t) {
  const T = et.T, C = et.C, n = T.length;
  if (t <= T[0]) return 0;
  if (t >= T[n - 1]) return C[n - 1];
  let lo = 0, hi = n - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (T[m] <= t) lo = m; else hi = m; }
  return C[lo] + (C[hi] - C[lo]) * (t - T[lo]) / Math.max(1e-9, T[hi] - T[lo]);
}
function emitTime(et, k) {
  const T = et.T, C = et.C, n = T.length;
  if (!(C[n - 1] > k)) return Infinity;
  let lo = 0, hi = n - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (C[m] <= k) lo = m; else hi = m; }
  return T[lo] + (T[hi] - T[lo]) * (k - C[lo]) / Math.max(1e-9, C[hi] - C[lo]);
}
// index range [k0, k1) of balls emitted in (ta, tb]: ball k leaves when the count reaches k (ball 0 at the first moment it is on)
function emitRange(et, ta, tb, cap) {
  const ca = emitCount(et, ta), cb = emitCount(et, tb);
  const k0 = ca > 0 ? Math.floor(ca) + 1 : 0, k1 = cb > 0 ? Math.floor(cb) + 1 : 0;
  return [Math.min(k0, cap), Math.min(Math.max(k0, k1), cap)];
}
function emitKTime(et, k) { return k === 0 ? emitTime(et, 1e-9) : emitTime(et, k); }
// launch state of ball k: position, velocity, radius (in the emitter's pose at frame f)
function emitLaunch(o, view, P, k) {
  const r = (n) => emitRand(o, k, n);
  const sp = Math.max(0, P.speed * (1 + (r(1) * 2 - 1) * P.speedVar));
  const cone = P.spread * DEG * 0.5, ca = Math.cos(cone), cz = 1 - r(2) * (1 - ca), sz = Math.sqrt(Math.max(0, 1 - cz * cz)), ph = r(3) * Math.PI * 2;
  const dl = new THREE.Vector3(sz * Math.cos(ph), sz * Math.sin(ph), cz);
  const m = view.root.matrixWorld, dir = dl.transformDirection(m);
  const ar = Math.sqrt(r(4)) * P.area, aph = r(5) * Math.PI * 2;
  const pos = new THREE.Vector3(Math.cos(aph) * ar, Math.sin(aph) * ar, 0.3).applyMatrix4(m);
  const rad = Math.max(0.005, P.size * (1 + (r(6) * 2 - 1) * P.sizeVar));
  const v = [dir.x * sp + P.velocity[0], dir.y * sp + P.velocity[1], dir.z * sp + P.velocity[2]];
  return { p: pos, v, r: rad };
}
TYPES.emitter = {
  label: 'Emitter', icon: 'emitter', cat: 'weapon',
  defaults: () => BASE_T({ position: [-3.2, 1.3, 0], rotation: [0, 90, 0], start: 10, end: -1, rate: 12, speed: 9, speedVar: 0.15, spread: 12, velocity: [0, 0, 0],
    size: 0.07, sizeVar: 0.25, area: 0.08, gravity: true, life: 0, limit: 300, density: 1100, bounce: 0.45, friction: 0.5, power: 1, color: '#3a3d46', ballColor: '#e0a33a' }),
  groups: () => [G_TRANSFORM, { id: 'emit', title: 'Emitter', fields: [
    F('start', 'Start at frame', 'int', { min: 0, max: 100000, step: 1 }),
    F('end', 'Stop at frame', 'int', { min: -1, max: 100000, step: 1, help: '-1 keeps emitting until the end (or until the object limit).' }),
    F('rate', 'Objects per second', 'num', { min: 0, max: 240, step: 0.5, help: 'Keyframe it to make bursts or ramp the stream up and down.' }),
    F('limit', 'Object limit', 'int', { min: 1, max: 2000, step: 1, noanim: true, help: 'Most objects this emitter ever releases. Lots of objects slow the simulation down.' }),
    F('life', 'Lifetime', 'num', { min: 0, max: 600, step: 0.1, unit: 's', help: 'Objects disappear this long after leaving. 0 keeps them forever.' }),
  ] }, { id: 'launch', title: 'Velocity', fields: [
    F('speed', 'Speed', 'num', { min: 0, max: 200, step: 0.1, unit: 'm/s', help: 'Launch speed along the blue arrow.' }),
    F('speedVar', 'Speed randomness', 'num', { min: 0, max: 1, step: 0.01, help: '0.2 gives each object a speed up to 20% faster or slower.' }),
    F('spread', 'Spread angle', 'num', { min: 0, max: 180, step: 0.5, unit: '°', help: 'Width of the cone the objects fly out in. 0 is a straight line, 180 a half sphere.' }),
    F('velocity', 'Added velocity', 'vec3', { step: 0.1, unit: 'm/s', help: 'Extra velocity in world directions added to every object, for example sideways drift.' }),
    F('area', 'Nozzle radius', 'num', { min: 0, max: 5, step: 0.01, unit: 'm', help: 'Objects start anywhere on a disc this big.' }),
    F('gravity', 'Objects fall', 'bool', { noanim: true }),
  ] }, { id: 'weapon', title: 'Objects', fields: [
    F('size', 'Radius', 'num', { min: 0.01, max: 1.5, step: 0.005, unit: 'm' }),
    F('sizeVar', 'Size randomness', 'num', { min: 0, max: 0.9, step: 0.01 }),
    F('density', 'Density', 'num', { min: 50, max: 12000, step: 50, unit: 'kg/m³', help: 'Rubber ~1100, stone ~2500, steel 7800.' }),
    F('bounce', 'Bounciness', 'num', { min: 0, max: 0.95, step: 0.05 }),
    F('friction', 'Friction', 'num', { min: 0, max: 1.5, step: 0.05 }),
    F('power', 'Shatter power', 'num', { min: 0.1, max: 20, step: 0.1, help: 'How easily the objects tear flesh when they hit.' }),
  ] }, { id: 'material', title: 'Colors', fields: [F('color', 'Emitter', 'color'), F('ballColor', 'Objects', 'color')] }, G_VIS],
  build(view) {
    view.cMat = stdMat('#3a3d46', 0.4, 0.6); view.ballMat = stdMat('#e0a33a', 0.45, 0.1);
    view.body = mkMesh(GEO.cylinder, view.cMat); view.body.rotation.x = Math.PI / 2; view.body.scale.set(0.34, 0.36, 0.34); view.body.position.z = -0.05;
    view.nozzle = mkMesh(GEO.cone, view.cMat); view.nozzle.rotation.x = -Math.PI / 2; view.nozzle.scale.set(0.3, 0.2, 0.3); view.nozzle.position.z = 0.2;
    view.arrow = arrowGroup('#4a8cff'); view.arrow.rotation.x = Math.PI / 2; view.arrow.scale.setScalar(0.55);
    view.root.add(view.body, view.nozzle, view.arrow); view.pick = [view.body, view.nozzle];
    view.inst = null; view.cap = 0;
    view.ballGroup = new THREE.Group(); view.world.add(view.ballGroup);
  },
  dispose(view) { view.ballGroup.removeFromParent(); if (view.inst) view.inst.dispose(); },
  // balls leaving during this frame, handed to the physics engine
  projectiles(view, P, ctx, prev, o) {
    const et = emitTable(o), cap = et.cap();
    const [k0, k1] = emitRange(et, prev.t, ctx.t, cap); if (k1 <= k0) return [];
    view.root.updateMatrixWorld(true);
    const out = [], g = P.gravity ? ctx.g : 0;
    for (let k = k0; k < k1; k++) {
      const tk = emitKTime(et, k), tau = Math.max(0, ctx.t - tk), L = emitLaunch(o, view, P, k);
      if (P.life > 0 && tau >= P.life) continue;
      out.push({ key: o.id + ':e' + k, r: L.r, m: 4.18879 * L.r * L.r * L.r * (P.density || 1100), friction: P.friction, restitution: P.bounce, shatterMul: 1 / Math.max(0.05, P.power || 1),
        noGravity: !P.gravity,
        p: [L.p.x + L.v[0] * tau, L.p.y + L.v[1] * tau + 0.5 * g * tau * tau, L.p.z + L.v[2] * tau], v: [L.v[0], L.v[1] + g * tau, L.v[2]] });
    }
    return out;
  },
  // balls whose lifetime ends during this frame
  kills(view, P, ctx, prev, o) {
    if (!(P.life > 0)) return [];
    const et = emitTable(o), cap = et.cap();
    const [k0, k1] = emitRange(et, prev.t - P.life, ctx.t - P.life, cap), out = [];
    for (let k = k0; k < k1; k++) out.push(o.id + ':e' + k);
    return out;
  },
  apply(view, P, ctx) {
    applyTransform(view, P, true);
    view.cMat.color.set(P.color); view.ballMat.color.set(P.ballColor);
    view.arrow.visible = view.editor;
    view.root.updateMatrixWorld(true);
    const o = view.obj, et = emitTable(o), cap = et.cap();
    // balls alive now: emitted before t and (with a lifetime) not expired yet
    const [, kEnd] = emitRange(et, -1e9, ctx.t, cap);
    const kStart = P.life > 0 ? emitRange(et, -1e9, ctx.t - P.life, cap)[1] : 0;
    const n = Math.max(0, kEnd - kStart);
    if (!view.inst || view.cap < n) {
      const c = Math.max(32, Math.min(2000, 1 << Math.ceil(Math.log2(Math.max(1, n)))));
      if (view.inst) { view.ballGroup.remove(view.inst); view.inst.dispose(); }
      view.inst = new THREE.InstancedMesh(GEO.sphere, view.ballMat, c); view.inst.castShadow = view.inst.receiveShadow = true;
      view.inst.frustumCulled = false; view.cap = c; view.ballGroup.add(view.inst);
    }
    const M = _emM, Q = _emQ, S3 = _emS, Pp = _emP;
    let i = 0;
    const g = P.gravity ? ctx.g : 0, floor = APP.scene.world.props.floor;
    for (let k = kStart; k < kEnd && i < view.cap; k++) {
      const L = emitLaunch(o, view, P, k);
      const d = ctx.dyn && ctx.dyn.get(o.id + ':e' + k);
      if (d) { Pp.set(d[0], d[1], d[2]); Q.set(d[3], d[4], d[5], d[6]); }
      else if (ctx.dyn) continue; // simulated frame without this ball: it is gone
      else {
        // not simulated yet: show the free flight
        const tau = ctx.t - emitKTime(et, k); if (!(tau >= 0)) continue;
        Pp.set(L.p.x + L.v[0] * tau, L.p.y + L.v[1] * tau + 0.5 * g * tau * tau, L.p.z + L.v[2] * tau);
        if (floor && Pp.y < L.r) Pp.y = L.r;
        Q.identity();
      }
      S3.setScalar(L.r * 2); M.compose(Pp, Q, S3); view.inst.setMatrixAt(i++, M);
    }
    view.inst.count = i; view.inst.instanceMatrix.needsUpdate = true;
    view.inst.visible = P.visible !== false;
  },
};
const _emM = new THREE.Matrix4(), _emQ = new THREE.Quaternion(), _emS = new THREE.Vector3(), _emP = new THREE.Vector3();

/* ---------- force fields ---------- */
TYPES.bomb = {
  label: 'Explosive', icon: 'bomb', cat: 'field',
  defaults: () => BASE_T({ position: [0, 0.2, 0.35], strength: 22, radius: 1.8, damage: 0.45, lift: 0.35, detonate: 45, color: '#262830' }),
  groups: () => [{ id: 'transform', title: 'Transform', fields: G_TRANSFORM.fields.slice(0, 1) }, { id: 'weapon', title: 'Explosive', fields: [
    F('detonate', 'Detonate at frame', 'int', { min: 0, max: 100000, step: 1 }),
    F('strength', 'Blast speed', 'num', { min: 0, max: 200, step: 0.5, unit: 'm/s' }),
    F('radius', 'Blast radius', 'num', { min: 0.05, max: 30, step: 0.05, unit: 'm' }),
    F('damage', 'Shatter core', 'num', { min: 0, max: 1, step: 0.01, help: 'Fraction of the radius where molecules are torn loose.' }),
    F('lift', 'Upward kick', 'num', { min: -2, max: 3, step: 0.05 }),
  ] }, { id: 'material', title: 'Colors', fields: [F('color', 'Casing', 'color')] }, G_VIS],
  build(view) {
    view.cMat = stdMat('#262830', 0.4, 0.5);
    view.body = mkMesh(GEO.sphere, view.cMat); view.body.scale.setScalar(0.28);
    view.fuse = mkMesh(GEO.unitCyl, stdMat('#a8834a', 0.8, 0)); view.fuse.scale.set(0.02, 0.12, 0.02); view.fuse.position.y = 0.18;
    view.flashMat = new THREE.MeshBasicMaterial({ color: '#ffd27a', transparent: true, opacity: 0.8, depthWrite: false });
    view.flash = new THREE.Mesh(GEO.sphere, view.flashMat); view.flash.visible = false;
    view.ring = new THREE.Mesh(new THREE.RingGeometry(0.95, 1, 64), new THREE.MeshBasicMaterial({ color: '#ff8a3d', transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false }));
    view.ring.rotation.x = -Math.PI / 2; view.ring.visible = false;
    view.root.add(view.body, view.fuse, view.flash, view.ring); view.pick = [view.body];
  },
  apply(view, P, ctx) {
    applyTransform(view, P, true);
    view.cMat.color.set(P.color);
    const tD = ctx.timeOf(P.detonate), dt = ctx.t - tD;
    const boom = dt >= 0;
    // after it goes off the casing stays as a faint ghost in the editor, so it can still be clicked, moved or deleted
    view.body.visible = !boom || view.editor; view.fuse.visible = !boom;
    if (!view.ghostMat) view.ghostMat = new THREE.MeshBasicMaterial({ color: '#ff8a3d', wireframe: true, transparent: true, opacity: 0.45, depthWrite: false });
    view.body.material = boom ? view.ghostMat : view.cMat; view.body.castShadow = !boom;
    const k = boom ? dt / 0.35 : 1;
    view.flash.visible = boom && k < 1;
    view.ring.visible = view.editor && !boom;
    view.ring.scale.setScalar(P.radius);
    if (view.flash.visible) { view.flash.scale.setScalar(P.radius * 2 * (0.25 + 0.75 * Math.sqrt(k))); view.flashMat.opacity = 0.85 * (1 - k); }
  },
  fields(P, ctx, prev) {
    const tD = ctx.timeOf(P.detonate);
    if (prev.t < tD && ctx.t >= tD) return [{ type: 'explode', p: P.position.slice(), radius: P.radius, strength: P.strength, damage: P.damage, lift: P.lift }];
    return [];
  },
};

const FIELD_T = (extra) => BASE_T(Object.assign({ start: 0, end: -1, strength: 12 }, extra));
const FIELD_TIMING = [F('start', 'Active from frame', 'int', { min: 0, max: 100000, step: 1 }), F('end', 'Until frame', 'int', { min: -1, max: 100000, step: 1, help: '-1 keeps it on.' })];
function fieldActive(P, ctx) { return ctx.frame >= P.start && (P.end < 0 || ctx.frame <= P.end) && P.strength !== 0; }
function arrowGroup(color) {
  const g = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, depthTest: false });
  const shaft = new THREE.Mesh(GEO.unitCyl, mat); shaft.scale.set(0.035, 1.2, 0.035); shaft.position.y = 0.6;
  const tip = new THREE.Mesh(GEO.cone, mat); tip.scale.set(0.2, 0.3, 0.2); tip.position.y = 1.35;
  g.add(shaft, tip); g.renderOrder = 5; shaft.renderOrder = 5; tip.renderOrder = 5;
  return g;
}
TYPES.wind = {
  label: 'Wind', icon: 'wind', cat: 'field',
  defaults: () => FIELD_T({ position: [0, 1.5, -2], rotation: [0, 0, 0], strength: 14 }),
  groups: () => [{ id: 'transform', title: 'Transform', fields: G_TRANSFORM.fields.slice(0, 2) }, { id: 'weapon', title: 'Wind', fields: [F('strength', 'Strength', 'num', { min: -500, max: 500, step: 0.5, unit: 'm/s²' }), ...FIELD_TIMING] }, G_VIS],
  build(view) { const a = arrowGroup('#7fd1ff'); a.rotation.x = Math.PI / 2; view.root.add(a); view.helper = a; view.pick = [a.children[0], a.children[1]]; },
  apply(view, P) { applyTransform(view, P, true); view.helper.visible = view.editor; },
  fields(P, ctx) {
    if (!fieldActive(P, ctx)) return [];
    const d = new THREE.Vector3(0, 0, 1).applyEuler(new THREE.Euler(P.rotation[0] * DEG, P.rotation[1] * DEG, P.rotation[2] * DEG));
    return [{ type: 'wind', dir: [d.x, d.y, d.z], strength: P.strength }];
  },
};
TYPES.vortex = {
  label: 'Vortex', icon: 'vortex', cat: 'field',
  defaults: () => FIELD_T({ position: [0, 0, 0], strength: 30, radius: 4, lift: 4 }),
  groups: () => [{ id: 'transform', title: 'Transform', fields: G_TRANSFORM.fields.slice(0, 2) }, { id: 'weapon', title: 'Vortex', fields: [
    F('strength', 'Swirl', 'num', { min: -500, max: 500, step: 0.5 }), F('radius', 'Radius', 'num', { min: 0.1, max: 50, step: 0.05, unit: 'm' }), F('lift', 'Lift', 'num', { min: -50, max: 50, step: 0.1 }), ...FIELD_TIMING] }, G_VIS],
  build(view) {
    view.ring = new THREE.Mesh(new THREE.TorusGeometry(1, 0.01, 8, 96), new THREE.MeshBasicMaterial({ color: '#b48cff', transparent: true, opacity: 0.7 }));
    view.ring.rotation.x = Math.PI / 2; view.root.add(view.ring); view.pick = [view.ring];
  },
  apply(view, P) { applyTransform(view, P, true); view.ring.scale.setScalar(P.radius); view.ring.visible = view.editor; },
  fields(P, ctx) {
    if (!fieldActive(P, ctx)) return [];
    const a = new THREE.Vector3(0, 1, 0).applyEuler(new THREE.Euler(P.rotation[0] * DEG, P.rotation[1] * DEG, P.rotation[2] * DEG));
    return [{ type: 'vortex', p: P.position.slice(), axis: [a.x, a.y, a.z], strength: P.strength, radius: P.radius, lift: P.lift }];
  },
};
TYPES.singularity = {
  label: 'Singularity', icon: 'blackhole', cat: 'field',
  defaults: () => FIELD_T({ position: [0, 2.5, 0], strength: 40, radius: 6, start: 30 }),
  groups: () => [{ id: 'transform', title: 'Transform', fields: G_TRANSFORM.fields.slice(0, 1) }, { id: 'weapon', title: 'Singularity', fields: [
    F('strength', 'Pull', 'num', { min: -1000, max: 1000, step: 0.5 }), F('radius', 'Reach', 'num', { min: 0.1, max: 50, step: 0.05, unit: 'm' }), ...FIELD_TIMING] }, G_VIS],
  build(view) {
    view.core = new THREE.Mesh(GEO.sphere, new THREE.MeshBasicMaterial({ color: '#08060f' })); view.core.scale.setScalar(0.3);
    view.halo = new THREE.Mesh(new THREE.TorusGeometry(0.35, 0.03, 8, 64), new THREE.MeshBasicMaterial({ color: '#b48cff' }));
    view.root.add(view.core, view.halo); view.pick = [view.core];
  },
  apply(view, P, ctx) { applyTransform(view, P, true); const on = fieldActive(P, ctx); view.halo.rotation.set(1.2, ctx.t * 2, 0); view.core.scale.setScalar(on ? 0.3 : 0.16); },
  fields(P, ctx) { return fieldActive(P, ctx) ? [{ type: 'attract', p: P.position.slice(), strength: P.strength, radius: P.radius }] : []; },
};

/* ---------- camera ---------- */
TYPES.camera = {
  label: 'Camera', icon: 'camera', cat: 'camera',
  defaults: () => ({ position: [5.2, 2.4, 6.4], target: [0, 1.1, 0], fov: 38, dof: false, focusObj: '', focusDist: 0, blur: 1, fstop: 2.8, shotStart: -1, followObj: '', followMode: 'look', followAim: [0, 0, 0], followKeepY: false, visible: true }),
  groups: (P) => [{ id: 'transform', title: 'Camera', fields: [
    F('lookBtn', 'View', 'button', { noanim: true, text: 'Look through this camera', action: (o) => lookThrough(o) }),
    F('position', 'Location', 'vec3', { step: 0.05, unit: 'm' }),
    F('target', 'Looks at', 'vec3', { step: 0.05, unit: 'm' }),
    F('fov', 'Field of view', 'num', { min: 5, max: 140, step: 0.5, unit: '°' }),
  ] }, { id: 'lens', title: 'Depth of field', fields: [
    F('dof', 'Depth of field', 'bool', { help: 'Blur what is nearer or further than the focus point when looking through this camera, in renders and videos. Can be keyframed to switch on and off.' }),
    F('focusObj', 'Focus on', 'select', { noanim: true, options: () => [['', 'Focus distance below'], ['@auto', 'Autofocus (whatever the centre of the view points at)'], ...allObjs().filter(x => x.type !== 'camera').map(x => [x.id, x.name])], help: 'Autofocus shoots a ray from the middle of the view and focuses on the first thing it hits, so moving the camera keeps the nearest object sharp. Or pick an object to keep it sharp wherever it goes, or "Focus distance below" to set the distance by hand.' }),
    F('focusDist', 'Focus distance', 'num', { min: 0, max: 200, step: 0.05, unit: 'm', help: 'How far from the camera things are sharpest. 0 focuses on the "Looks at" point. Keyframe it to pull focus.' }),
    F('blur', 'Blur amount', 'num', { min: 0, max: 6, step: 0.05, help: 'How strongly things out of focus are blurred. 0 is no blur, 1 is normal, higher is dreamier. Keyframe it to blur in or out.' }),
    F('fstop', 'Aperture (f-stop)', 'num', { min: 0.7, max: 22, step: 0.1, help: 'Photography style control of the same blur: lower numbers blur more.' }),
  ] }, { id: 'shot', title: 'Shots', fields: [
    F('shotStart', 'Shot starts at frame', 'int', { min: -1, max: 100000, step: 1, noanim: true, help: 'With several cameras, the view cuts to this camera at this frame and stays on it until the next camera’s shot starts. Renders and videos follow the cuts. -1 leaves this camera out of the shot list.' }),
    F('makeShot', 'Shot', 'button', { noanim: true, text: 'Cut to this camera here', action: (o) => { pushUndo(); setProp(o, 'shotStart', APP.frame); APP.scene.world.props.activeCam = ''; toast(`${o.name} takes over from frame ${APP.frame}`); } }),
  ] }, { id: 'follow', title: 'Follow an object', fields: [
    F('followObj', 'Follow', 'select', { noanim: true, options: () => followOptions(activeObj()), help: 'Anchor this camera to an object so it keeps the object in the shot while it moves, falls or flies apart.',
      beforeSet: (o) => camState(o, evalProps(o, APP.frame)), onSet: (o, v, pre) => rebaseFollow(o, pre) }),
    ...(P && P.followObj ? [
      F('followMode', 'How', 'select', { noanim: true, options: [['look', 'Stay put and turn to watch it'], ['move', 'Move with it, keep the same angle'], ['chase', 'Move with it and keep it centred']],
        help: 'Stay put: the camera keeps its place and only turns. Move with it: the camera travels along as if mounted to the object.', beforeSet: (o) => camState(o, evalProps(o, APP.frame)), onSet: (o, v, pre) => rebaseFollow(o, pre) }),
      ...(P.followMode !== 'move' ? [F('followAim', 'Aim offset', 'vec3', { step: 0.05, unit: 'm', help: 'Moves the aim point away from the object’s centre, for example 0.5 m up to frame the head.' })] : []),
      ...(P.followMode !== 'look' ? [F('followKeepY', 'Keep its height', 'bool', { noanim: true, help: 'Ignore up and down movement, so the camera does not drop when a body falls.' })] : []),
    ] : []),
  ] }, G_VIS],
  build(view) {
    const m = new THREE.LineBasicMaterial({ color: '#2a2a33', transparent: true, opacity: 0.85 });
    const geo = new THREE.BufferGeometry();
    const a = 0.32, b = 0.2, d = -0.55;
    const pts = [0, 0, 0, a, b, d, 0, 0, 0, -a, b, d, 0, 0, 0, a, -b, d, 0, 0, 0, -a, -b, d, a, b, d, -a, b, d, -a, b, d, -a, -b, d, -a, -b, d, a, -b, d, a, -b, d, a, b, d, -0.12, b + 0.04, d, 0.12, b + 0.04, d, 0.12, b + 0.04, d, 0, b + 0.16, d, 0, b + 0.16, d, -0.12, b + 0.04, d];
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    view.lines = new THREE.LineSegments(geo, m);
    view.box = new THREE.Mesh(GEO.box, new THREE.MeshBasicMaterial({ color: '#2a2a33' })); view.box.scale.set(0.22, 0.16, 0.26); view.box.position.z = 0.13;
    view.root.add(view.lines, view.box); view.pick = [view.box];
    // focus point marker: a small ring where the camera is focused, while depth of field is on
    view.focus = new THREE.Mesh(new THREE.RingGeometry(0.09, 0.11, 40), new THREE.MeshBasicMaterial({ color: '#3fb6a8', transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthTest: false }));
    view.focus.renderOrder = 6; view.root.add(view.focus);
  },
  apply(view, P) {
    view.root.position.set(P.position[0], P.position[1], P.position[2]);
    view.root.lookAt(P.target[0], P.target[1], P.target[2]);
    // lookAt aims an object's +Z at the target, but the camera model is drawn looking down -Z like a real camera
    view.root.rotateY(Math.PI);
    view.root.visible = view.editor && P.visible;
    const dofOn = (P.dof || FXS.dof) && view.obj;
    view.focus.visible = !!dofOn;
    if (dofOn) view.focus.position.set(0, 0, -camFocusDist(view.obj, P));
  },
};

/* ---------- world (scene settings, animatable like any object) ---------- */
const WORLD_GROUPS = [
  { id: 'time', title: 'Time', fields: [
    F('frameStart', 'Start frame', 'int', { min: 0, max: 100000, step: 1, noanim: true }),
    F('frameEnd', 'End frame', 'int', { min: 1, max: 100000, step: 1, noanim: true }),
    F('fps', 'Frame rate', 'select', { options: [['24', '24 fps'], ['30', '30 fps'], ['60', '60 fps'], ['120', '120 fps']] }),
    F('timeScale', 'Time scale', 'num', { min: 0.01, max: 4, step: 0.01, help: 'Below 1 is slow motion. Keyframe it for bullet-time.' }),
  ] },
  { id: 'physics', title: 'Physics', fields: [
    F('gravity', 'Gravity', 'num', { min: -50, max: 50, step: 0.05, unit: 'm/s²' }),
    F('substeps', 'Substeps', 'int', { min: 1, max: 24, step: 1, noanim: true, help: 'More substeps make stiffer, more accurate bodies but cost time.' }),
    F('floor', 'Floor', 'bool', { noanim: true }),
    F('floorFriction', 'Floor friction', 'num', { min: 0, max: 2, step: 0.05 }),
    F('airDrag', 'Air drag', 'num', { min: 0, max: 5, step: 0.01 }),
  ] },
  { id: 'look', title: 'Look', fields: [
    F('particleStyle', 'Molecules', 'select', { options: [['anatomical', 'Anatomical tissue colors'], ['molecular', 'Single molecule color']] }),
    F('moleculeColor', 'Prop molecule color', 'color', { help: 'Inside color of molecular props. Each body has its own Inside color.' }),
    F('background', 'Background', 'color'),
    F('floorColor', 'Floor', 'color'),
    F('sunIntensity', 'Sun strength', 'num', { min: 0, max: 10, step: 0.05 }),
    F('sunAngle', 'Sun direction', 'num', { min: -180, max: 180, step: 1, unit: '°' }),
    F('sunHeight', 'Sun height', 'num', { min: 5, max: 90, step: 1, unit: '°' }),
    F('exposure', 'Exposure', 'num', { min: 0.1, max: 4, step: 0.02 }),
    F('shadows', 'Shadows', 'bool', { noanim: true }),
    F('blobs', 'Merge torn molecules', 'bool', { help: 'Torn insides that touch melt together into gooey blobs instead of separate beads (Skin view).' }),
    F('particleSize', 'Molecule size', 'num', { min: 0.4, max: 2, step: 0.02 }),
    F('wetness', 'Wetness', 'num', { min: 0, max: 1, step: 0.02, help: 'How glossy and wet torn molecules and goo look. 0 is dry and matte.' }),
  ] },
];
const WORLD_DEFAULTS = () => ({ frameStart: 0, frameEnd: 300, fps: '60', timeScale: 1, gravity: -9.81, substeps: 6, floor: true, floorFriction: 0.7, airDrag: 0.03,
  particleStyle: 'molecular', moleculeColor: '#4b22c9', background: '#b3b5b9', floorColor: '#a3a5aa', sunIntensity: 2.1, sunAngle: 38, sunHeight: 64, exposure: 1.0, shadows: true, particleSize: 1.0, blobs: true, wetness: 0.6 });

/* laser-wire grid: thin glowing wires stretched across a frame that sweeps through whatever stands in it */
TYPES.wires = {
  label: 'Laser wires', icon: 'blade', cat: 'weapon',
  defaults: () => BASE_T({ position: [0, 0, -1.2], count: 7, bottom: 0.25, spacing: 0.24, width: 2.6, thickness: 0.012, travel: 2.6, speed: 1.4, start: 30, color: '#57f0ff', frameColor: '#3b3f47', friction: 0.1 }),
  groups: () => [G_TRANSFORM, { id: 'weapon', title: 'Laser wires', fields: [
    F('count', 'Wires', 'int', { min: 1, max: 12, step: 1 }),
    F('bottom', 'Lowest wire height', 'num', { min: 0, max: 5, step: 0.01, unit: 'm' }),
    F('spacing', 'Gap between wires', 'num', { min: 0.02, max: 2, step: 0.01, unit: 'm' }),
    F('width', 'Width', 'num', { min: 0.2, max: 10, step: 0.05, unit: 'm' }),
    F('thickness', 'Wire thickness', 'num', { min: 0.003, max: 0.1, step: 0.001, unit: 'm' }),
    F('travel', 'Travel distance', 'num', { min: -20, max: 20, step: 0.05, unit: 'm' }),
    F('speed', 'Travel speed', 'num', { min: 0.01, max: 40, step: 0.05, unit: 'm/s' }),
    F('start', 'Start at frame', 'int', { min: 0, max: 100000, step: 1 }),
  ] }, { id: 'material', title: 'Colors', fields: [F('color', 'Wires', 'color'), F('frameColor', 'Frame', 'color')] }, G_VIS],
  build(view) {
    view.mover = new THREE.Group(); view.root.add(view.mover);
    view.wMat = new THREE.MeshStandardMaterial({ color: '#57f0ff', emissive: '#57f0ff', emissiveIntensity: 1.6, roughness: 0.3 });
    view.fMat = stdMat('#3b3f47', 0.6, 0.3);
    view.wires = [];
    for (let i = 0; i < 12; i++) {
      const m = mkMesh(GEO.cylinder, view.wMat, false); m.rotation.z = Math.PI / 2;
      colliderOf(m, 'cylinder', 'wire' + i); view.mover.add(m); view.wires.push(m);
    }
    view.posts = [mkMesh(GEO.box, view.fMat), mkMesh(GEO.box, view.fMat)];
    view.posts.forEach(p => view.mover.add(p));
    view.pick = [view.posts[0], view.posts[1], ...view.wires];
  },
  apply(view, P, ctx) {
    applyTransform(view, P, true);
    view.wMat.color.set(P.color); view.wMat.emissive.set(P.color); view.fMat.color.set(P.frameColor);
    const t0 = ctx.timeOf(P.start);
    const off = ctx.t > t0 ? Math.sign(P.travel) * Math.min(Math.abs(P.travel), (ctx.t - t0) * P.speed) : 0;
    view.mover.position.set(0, 0, off);
    const n = Math.max(1, Math.min(12, P.count | 0)), top = P.bottom + (n - 1) * P.spacing;
    view.wires.forEach((m, i) => {
      const on = i < n;
      m.visible = on; m.userData.collider.off = !on; m.userData.collider.friction = P.friction;
      m.scale.set(P.thickness, P.width, P.thickness);
      m.position.set(0, P.bottom + i * P.spacing, 0);
    });
    const h = top + 0.25;
    view.posts.forEach((p, k) => { p.scale.set(0.08, h, 0.08); p.position.set((k ? -1 : 1) * (P.width / 2 + 0.04), h / 2, 0); });
  },
};

/* every weapon gets a 'shatter power': how easily its impacts blast molecules loose */
const WEAPON_POWER = { wires: 4.5, hammer: 1.7, wreckingball: 1.6, blade: 2.8, saw: 3.2, crusher: 1.3, pusher: 1.2, spinner: 1.5, guillotine: 3.4, spikes: 2.6, cannon: 2.2 };
for (const id in WEAPON_POWER) {
  const T = TYPES[id], d0 = T.defaults, g0 = T.groups;
  T.defaults = () => Object.assign(d0(), { power: WEAPON_POWER[id] });
  T.groups = (P) => g0(P).map(g => g.id !== 'weapon' ? g : Object.assign({}, g, { fields: [...g.fields, F('power', 'Shatter power', 'num', { min: 0.2, max: 8, step: 0.05, help: 'Higher values blast more molecules loose on impact. Sharp weapons cut, blunt ones smash.' })] }));
}
