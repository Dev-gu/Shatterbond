/* ===================== demo scenes and motion presets ===================== */
const K = (pairs, e = 'bezier') => pairs.map(([f, v, ee]) => ({ f, v, e: ee || e }));
const HUMAN = (pos, extra) => ({ type: 'humanoid', props: Object.assign({ position: pos || [0, 0, 0] }, extra || {}) });
const CAM = (pos, target, fov, anim) => ({ type: 'camera', name: 'Camera', props: { position: pos, target, fov: fov || 38 }, anim });

const DEMOS = [
  { id: 'hammer', name: 'Pendulum hammer', icon: 'hammer', desc: 'A blue ram swings into a standing figure. The chest bursts open and the body folds over limp.',
    world: { frameEnd: 240 },
    objects: [HUMAN(), { type: 'hammer', props: {} }, CAM([5.6, 2.1, 7.2], [1.6, 1.0, 0.3], 46)] },
  { id: 'split', name: 'Head-to-toe split', icon: 'guillotine', desc: 'A falling blade enters at the crown and splits the body into two halves that peel apart.',
    world: { moleculeColor: '#9e1420', frameEnd: 220 },
    objects: [HUMAN(null, { insideColor: '#9e1420' }), { type: 'guillotine', props: { rotation: [0, 90, 0], frameHeight: 3.3, width: 1.0, bladeHeight: 0.5, thickness: 0.03, drop: 30, speed: 1.3, color: '#3a3e46', frameColor: '#2c2f36' } },
      CAM([2.6, 1.5, 3.4], [0, 1.1, 0], 40)] },
  { id: 'wires', name: 'Laser wires', icon: 'blade', desc: 'A fence of glowing wires sweeps through a standing figure and slices it into layers.',
    world: { frameEnd: 240 },
    objects: [HUMAN(), { type: 'wires', props: { position: [0, 0, -1.1], count: 7, bottom: 0.3, spacing: 0.24, travel: 2.4, speed: 2.2, start: 30 } },
      CAM([3.6, 1.4, 2.6], [0, 1.0, 0], 40)] },
  { id: 'wallsaws', name: 'Wall blades', icon: 'saw', desc: 'Three spinning blades on arms slide out of the wall at shin, waist and neck height, then pull back.',
    world: { frameEnd: 240 },
    objects: [HUMAN(),
      ...[[0.42, 30], [1.0, 42], [1.47, 54]].flatMap(([y, f], k) => {
        const zk = (z0) => K([[0, z0, 'linear'], [f, z0, 'linear'], [f + 48, z0 + 1.2, 'linear'], [f + 58, z0 + 1.2, 'linear'], [f + 100, z0]]);
        return [{ type: 'saw', name: 'Wall blade ' + (k + 1), props: { position: [0, y, -0.95], rotation: [0, 0, 90], radius: 0.32, thickness: 0.025, rpm: 1600, mountWall: false, color: '#2f6fe0' }, anim: { 'position.2': zk(-0.95) } },
          { type: 'cube', name: 'Blade arm ' + (k + 1), props: { position: [0, y, -1.75], scale: [0.09, 0.022, 1.6], color: '#2f6fe0', roughness: 0.35, power: 3.2 }, anim: { 'position.2': zk(-1.75) } }];
      }),
      { type: 'cube', name: 'Wall', props: { position: [0, 1.3, -1.8], scale: [3.0, 2.6, 1.0], color: '#7d8189' } },
      CAM([3.2, 1.4, 2.4], [0, 0.95, -0.3], 40)] },
  { id: 'crush', name: 'Piston crush', icon: 'press', desc: 'A heavy blue block slams down on three people. Molecules spray out across the floor.',
    world: { frameEnd: 300 },
    objects: [HUMAN([-0.8, 0, 0], { resolution: 'low', seed: 11 }), HUMAN([0, 0, 0], { resolution: 'low', seed: 23 }), HUMAN([0.8, 0, 0], { resolution: 'low', seed: 41 }),
      { type: 'crusher', props: { position: [0, 4.3, 0], stroke: 3.16, start: 40, downTime: 0.45, hold: 2.0, upTime: 1.5, repeat: false, width: 2.8, depth: 1.2, plateThick: 0.6, color: '#2f6fe0' } },
      CAM([0.2, 1.4, 6.4], [0, 0.9, 0], 42)] },
  { id: 'cannon', name: 'Cannonball barrage', icon: 'cannon', desc: 'A stream of teal cannonballs pummels a figure; the balls punch in, drop and pile up at its feet.',
    world: { frameEnd: 260 },
    objects: [HUMAN([0, 0, 0], { rotation: [0, 180, 0] }), { type: 'cannon', props: { position: [0.05, 1.5, -6.5], count: 16, interval: 0.06, speed: 17, first: 30, ballRadius: 0.11, power: 1.8, ballDensity: 300, bounce: 0.35, impactDist: 5.42, ballColor: '#2bb8ae', color: '#2b2e35' } },
      CAM([5.4, 1.5, 1.2], [0, 0.8, 1.0], 46)] },
  { id: 'punch', name: 'Piston punch', icon: 'wall', desc: 'A boxing glove on a blue piston fires into the head at full speed.',
    world: { moleculeColor: '#9e1420', frameEnd: 200 },
    objects: [HUMAN(null, { insideColor: '#9e1420' }), { type: 'cylinder', name: 'Piston', props: { position: [0, 1.66, -2.1], rotation: [90, 0, 0], scale: [0.32, 2.4, 0.32], color: '#2f6fe0', roughness: 0.3, power: 3.6 },
        anim: { 'position.2': K([[0, -2.1, 'linear'], [40, -2.1, 'linear'], [45, -1.35, 'linear'], [90, -1.35], [130, -2.1]]) } },
      { type: 'sphere', name: 'Boxing glove', props: { position: [0, 1.66, -0.8], scale: [0.26, 0.24, 0.3], color: '#c9521e', roughness: 0.45, power: 2.4 },
        anim: { 'position.2': K([[0, -0.8, 'linear'], [40, -0.8, 'linear'], [45, -0.05, 'linear'], [90, -0.05], [130, -0.8]]) } },
      { type: 'cube', name: 'Piston housing', props: { position: [0, 1.66, -2.55], scale: [0.6, 0.6, 0.6], color: '#2b2e35' } },
      CAM([3.8, 1.6, 2.4], [0, 1.0, 0.4], 42)] },
  { id: 'twin', name: 'Crossfire hammers', icon: 'hammer', desc: 'Two hammers from two directions, a beat apart.',
    world: { frameEnd: 260 },
    objects: [HUMAN(), { type: 'hammer', name: 'Front hammer', props: { angle: 80 } },
      { type: 'hammer', name: 'Side hammer', props: { rotation: [0, 90, 0], angle: 82, release: 22, orient: 'log', color: '#d0461f', ropeColor: '#ffb08e', headLength: 0.9, headRadius: 0.28, position: [0, 4.1, 0], length: 3.0 } },
      CAM([5.6, 2.2, 5.6], [0, 1.1, 0], 40)] },
  { id: 'saw', name: 'Flying buzzsaw', icon: 'saw', desc: 'A spinning disc travels straight through a body and splits it front to back.',
    world: { frameEnd: 240 },
    objects: [HUMAN([0, 0, 0]), { type: 'saw', props: { position: [-2.3, 1.12, 0.0], rotation: [0, 90, 0], radius: 0.62, rpm: 1400, travel: 4.6, travelSpeed: 1.6, travelStart: 30, mountWall: false } },
      CAM([1.6, 1.6, 4.6], [0, 1.1, 0], 40)] },
  { id: 'press', name: 'Hydraulic press', icon: 'press', desc: 'A press plate crushes a figure into the floor and squeezes molecules out sideways.',
    world: { frameEnd: 300 },
    objects: [HUMAN([0, 0, 0], { pose: 'armsup' }), { type: 'crusher', props: { position: [0, 4.4, 0], stroke: 3.55, start: 40, downTime: 1.4, hold: 1.2, upTime: 1.6, repeat: false, width: 1.5, depth: 1.1 } },
      CAM([3.6, 1.4, 4.2], [0, 1.2, 0], 42)] },
  { id: 'wrecking', name: 'Wrecking ball line-up', icon: 'ball', desc: 'A steel ball sweeps through three people standing in a row.',
    world: { frameEnd: 300 },
    objects: [HUMAN([-1.1, 0, 0], { resolution: 'low', seed: 11 }), HUMAN([0, 0, 0], { resolution: 'low', seed: 23, height: 1.7, fat: 0.6 }), HUMAN([1.1, 0, 0], { resolution: 'low', seed: 41, height: 1.92, build: 0.8 }),
      { type: 'wreckingball', props: { position: [0, 5.3, 0], rotation: [0, 90, 0], length: 4.25, radius: 0.55, angle: 72 } },
      CAM([0.4, 1.8, 7.4], [0, 1.1, 0], 40)] },
  { id: 'bomb', name: 'Detonation', icon: 'bomb', desc: 'An explosive goes off at the feet. The shockwave tears the body apart from below.',
    world: { frameEnd: 240 },
    objects: [HUMAN(), { type: 'bomb', props: { position: [0.18, 0.2, 0.42], detonate: 40, strength: 12, radius: 1.7 } },
      CAM([4.2, 2.2, 5.6], [0, 1.0, 0], 42)] },
  { id: 'sweeper', name: 'Leg sweeper', icon: 'spinner', desc: 'A spinning bar at shin height takes two people off their feet.',
    world: { frameEnd: 300 },
    objects: [HUMAN([1.25, 0, 0], { resolution: 'low', seed: 5 }), HUMAN([-1.25, 0, 0.2], { resolution: 'low', seed: 9, rotation: [0, 180, 0] }),
      { type: 'spinner', props: { barHeight: 0.42, barLength: 4.4, rpm: 52, start: 20 } }, CAM([0.5, 2.6, 6.8], [0, 0.8, 0], 42)] },
  { id: 'guillotine', name: 'Guillotine', icon: 'guillotine', desc: 'A figure lies under a falling blade that cuts it clean in two.',
    world: { frameEnd: 200 },
    objects: [HUMAN([0, 0.13, 1.47], { rotation: [-90, 0, 0], stand: false, tone: 0.6, pose: 'stand' }), { type: 'guillotine', props: { drop: 40, frameHeight: 2.6 } },
      CAM([2.3, 1.2, 2.6], [0, 0.3, 0.3], 42)] },
  { id: 'spikes', name: 'Spike pit drop', icon: 'spikes', desc: 'A body falls flat onto a bed of spikes.',
    world: { frameEnd: 220 },
    objects: [HUMAN([0, 1.75, 0.9], { rotation: [-88, 0, 12], stand: false, sleep: false, tone: 0.35, pose: 'starfish' }), { type: 'spikes', props: { rows: 6, cols: 6, spacing: 0.32, spikeHeight: 0.6 } },
      CAM([3.4, 2.0, 3.6], [0, 0.6, 0], 42)] },
  { id: 'ram', name: 'Wall slam', icon: 'wall', desc: 'A wall ram pins someone against a concrete slab.',
    world: { frameEnd: 240 },
    objects: [HUMAN([0, 0, 0.1]), { type: 'pusher', props: { position: [0, 0, -2.3], distance: 3.15, speed: 7, start: 30, returnAfter: 1.2 } },
      { type: 'cube', name: 'Concrete slab', props: { position: [0, 1.4, 1.25], scale: [3.2, 2.8, 0.3], color: '#8b8d92', roughness: 0.9 } },
      CAM([4.6, 2.0, 0.4], [0, 1.1, 0.4], 44)] },
  { id: 'bullet', name: 'Bullet time', icon: 'clapper', desc: 'The hammer demo with time slowed to a crawl at the moment of impact.',
    world: { frameEnd: 360 },
    worldAnim: { timeScale: K([[0, 1], [38, 1], [50, 0.1], [200, 0.1], [235, 1]]) },
    objects: [HUMAN(), { type: 'hammer', props: {} },
      CAM([4.4, 1.7, 4.9], [0, 1.15, 0.3], 40, { 'position.0': K([[0, 4.4], [200, 1.4], [360, -3.2]]), 'position.2': K([[0, 4.9], [200, 3.2], [360, 3.6]]), 'position.1': K([[0, 1.7], [360, 2.1]]) })] },
  { id: 'singularity', name: 'Singularity', icon: 'blackhole', desc: 'A tiny black hole switches on and pulls two bodies apart, molecule by molecule.',
    world: { frameEnd: 300, gravity: -9.81 },
    objects: [HUMAN([-0.9, 0, 0], { resolution: 'low', sleep: false }), HUMAN([0.9, 0, 0], { resolution: 'low', sleep: false, seed: 19 }),
      { type: 'singularity', props: { position: [0, 2.6, 0], strength: 28, radius: 6, start: 30 } }, CAM([0, 2.2, 7.2], [0, 1.6, 0], 44)] },
  { id: 'vortex', name: 'Tornado', icon: 'vortex', desc: 'A tornado knocks people off their feet, lifts them with a clay block and spins them in the air.',
    world: { frameEnd: 320 },
    objects: [HUMAN([0.7, 0, 0], { resolution: 'low', sleep: false }), HUMAN([-0.8, 0, 0.4], { resolution: 'low', sleep: false, seed: 31 }),
      { type: 'cube', name: 'Clay block', props: { position: [0.2, 0.3, -1.1], scale: [0.6, 0.6, 0.6], physics: 'molecular', material: String(TI.clay), color: '#c98b5d', resolution: 'low' } },
      { type: 'vortex', props: { strength: 26, radius: 4.2, lift: 17, start: 25 } }, CAM([0, 3.2, 9.5], [0, 2.0, 0], 46)] },
  { id: 'props', name: 'Breakable props', icon: 'cube', desc: 'Glass, ice, stone, clay and jelly side by side, hit by one wrecking ball.',
    world: { frameEnd: 260 },
    objects: [
      { type: 'cube', name: 'Glass pane', props: { position: [-1.6, 0.7, 0], scale: [0.08, 1.4, 1.1], physics: 'molecular', material: String(TI.glass), color: '#9fd6e8', resolution: 'low' } },
      { type: 'cube', name: 'Ice block', props: { position: [-0.8, 0.35, 0], scale: [0.6, 0.7, 0.6], physics: 'molecular', material: String(TI.ice), color: '#cfeefc', resolution: 'low' } },
      { type: 'cylinder', name: 'Stone pillar', props: { position: [0, 0.9, 0], scale: [0.45, 1.8, 0.45], physics: 'molecular', material: String(TI.stone), color: '#9b9a94', resolution: 'low' } },
      { type: 'cube', name: 'Clay block', props: { position: [0.8, 0.35, 0], scale: [0.6, 0.7, 0.6], physics: 'molecular', material: String(TI.clay), color: '#c98b5d', resolution: 'low' } },
      { type: 'sphere', name: 'Jelly ball', props: { position: [1.65, 0.36, 0], scale: [0.72, 0.72, 0.72], physics: 'molecular', material: String(TI.jelly), color: '#56d38f', resolution: 'low' } },
      { type: 'wreckingball', props: { position: [0, 5.1, 0], rotation: [0, 90, 0], length: 4.5, radius: 0.5, angle: 70, release: 20 } },
      CAM([0.3, 1.9, 6.6], [0, 0.7, 0], 42)] },
  { id: 'walker', name: 'Walk into the ram', icon: 'hammer', desc: 'An animated figure walks across the studio, sees the swinging ram, flinches and is knocked flying. Two cameras cut from wide to close.',
    world: { frameEnd: 200 },
    objects: [HUMAN([0, 0, -1.6], { animation: 'walk' }), { type: 'hammer', props: { release: 0, angle: 70 } },
      { type: 'camera', name: 'Wide', props: { position: [6.2, 1.7, 0.6], target: [0, 1.0, -0.4], fov: 40, shotStart: 0 } },
      { type: 'camera', name: 'Close', props: { position: [2.7, 1.45, -2.2], target: [0, 1.2, -0.7], fov: 36, shotStart: 52 } },
      { type: 'camera', name: 'Follow', props: { position: [7.0, 2.4, -1.6], target: [0, 0.7, -4.2], fov: 46, shotStart: 76 } }] },
  { id: 'spar', name: 'Sparring', icon: 'wall', desc: 'A fighter throws punches and kicks into a figure standing still. Built-in animations; physics takes over the moment they connect.',
    world: { frameEnd: 220 },
    objects: [HUMAN([0, 0, -0.64], { animation: 'punch', resolution: 'low', react: false, seed: 19 }), HUMAN([0, 0, 0.0], { rotation: [0, 180, 0], resolution: 'low', sleep: false }),
      { type: 'camera', name: 'Camera', props: { position: [4.6, 1.5, -0.2], target: [0, 1.15, -0.35], fov: 38, shotStart: 0 } }],
    anims: { 0: { animation: [[0, 'punch'], [80, 'kick']] } } },
  { id: 'animals', name: 'Dog and horse', icon: 'scene', desc: 'A horse and a dog made of the same molecules as the people. The horse walks into a swinging ram.',
    world: { frameEnd: 220 },
    objects: [HUMAN([0, 0, -4.4], { bodyType: 'horse', height: 1.6, fat: 0.3, animation: 'walk' }), HUMAN([1.4, 0, -2.4], { bodyType: 'dog', height: 0.62, fat: 0.3, animation: 'walk' }),
      { type: 'hammer', props: { release: 30, angle: 70 } },
      { type: 'camera', name: 'Camera', props: { position: [7.5, 2.0, -0.8], target: [0, 1.0, -1.2], fov: 44 } }] },
  { id: 'empty', name: 'Empty studio', icon: 'scene', desc: 'One figure, one camera, nothing else. Build your own scene.',
    world: { frameEnd: 250 },
    objects: [HUMAN([0, 0, 0]), CAM([4.4, 1.9, 5.4], [0, 1.0, 0], 40)] },
];

function sceneFromDemo(d) {
  const sc = newScene(d.name);
  Object.assign(sc.world.props, d.world || {});
  if (d.worldAnim) sc.world.anim = deepClone(d.worldAnim);
  const prev = APP.scene; APP.scene = sc;
  try {
    for (const o of d.objects) {
      const ob = makeObj(o.type, deepClone(o.props || {}), o.name, true);
      if (o.anim) ob.anim = deepClone(o.anim);
      sc.objects.push(ob);
    }
    // keyed animation switches: { objectIndex: { prop: [[frame, value], ...] } }
    if (d.anims) for (const k in d.anims) { const ob = sc.objects[+k]; if (!ob) continue; for (const path in d.anims[k]) for (const [f, v] of d.anims[k][path]) insertKey(ob, path, f, v, 'constant'); }
  } finally { APP.scene = prev; }
  return sc;
}
function loadDemo(id) {
  const d = DEMOS.find(x => x.id === id); if (!d) return;
  activateScene(sceneFromDemo(d), { undoable: !!APP.scene, toCamera: true });
  APP.libId = null;
  toast(`${d.name}: press Space to play`);
}

/* ---------- motion presets: add keyframes starting at the current frame ---------- */
function keyVec(o, key, f, v, e) { for (let i = 0; i < 3; i++) insertKey(o, `${key}.${i}`, f, +(+v[i]).toFixed(4), e); }
const isMol = (o) => o && (o.type === 'humanoid' || (TYPES[o.type].cat === 'mesh' && o.props.physics === 'molecular'));
const MOTIONS = [
  { id: 'spin', name: 'Spin', icon: 'rotate', desc: 'One full turn around the vertical axis over two seconds.', ok: (o) => o && Array.isArray(o.props.rotation),
    apply(o, f, P) { const fps = fpsOf(); insertKey(o, 'rotation.1', f, P.rotation[1], 'linear'); insertKey(o, 'rotation.1', f + 2 * fps, P.rotation[1] + 360, 'linear'); } },
  { id: 'bounce', name: 'Bounce', icon: 'ball', desc: 'Two bounces with ease in and out.', ok: (o) => o && Array.isArray(o.props.position) && o.type !== 'camera',
    apply(o, f, P) { const y = P.position[1], s = Math.round(fpsOf() / 4); insertKey(o, 'position.1', f, y); insertKey(o, 'position.1', f + s, y + 1.2); insertKey(o, 'position.1', f + 2 * s, y); insertKey(o, 'position.1', f + 3 * s, y + 0.6); insertKey(o, 'position.1', f + 4 * s, y); } },
  { id: 'flyin', name: 'Fly in', icon: 'stepFwd', desc: 'Arrives from far away and lands where it is now.', ok: (o) => o && Array.isArray(o.props.position),
    apply(o, f, P) { const p = P.position, s = Math.round(fpsOf() * 0.8); keyVec(o, 'position', f, [p[0] - 6, p[1] + 2.5, p[2] - 4]); keyVec(o, 'position', f + s, p); } },
  { id: 'drop', name: 'Drop in', icon: 'download', desc: 'Falls from six metres up to its current spot.', ok: (o) => o && Array.isArray(o.props.position) && o.type !== 'camera',
    apply(o, f, P) { const y = P.position[1], s = Math.round(fpsOf() * 1.1); insertKey(o, 'position.1', f, y + 6, 'bezier'); insertKey(o, 'position.1', f + s, y, 'linear'); } },
  { id: 'pulse', name: 'Pulse', icon: 'scale', desc: 'Grows by 30% and back.', ok: (o) => o && Array.isArray(o.props.scale),
    apply(o, f, P) { const s = P.scale, d = Math.round(fpsOf() / 4); keyVec(o, 'scale', f, s); keyVec(o, 'scale', f + d, s.map(v => v * 1.3)); keyVec(o, 'scale', f + 2 * d, s); } },
  { id: 'shake', name: 'Shake', icon: 'blast', desc: 'Half a second of rattling.', ok: (o) => o && Array.isArray(o.props.position),
    apply(o, f, P) { const p = P.position; for (let i = 0; i <= 10; i++) { const a = i === 0 || i === 10 ? 0 : (i % 2 ? 1 : -1) * 0.06 * (1 - i / 11); insertKey(o, 'position.0', f + i * 3, p[0] + a, 'linear'); } } },
  { id: 'throw', name: 'Throw', icon: 'cannon', desc: 'Carries the body back, then lets physics take over with a forward throw.', ok: (o) => isMol(o),
    apply(o, f, P) {
      const W = APP.scene.world.props, yaw = (P.rotation ? P.rotation[1] : 0) * DEG;
      const fwd = [Math.sin(yaw), 0, Math.cos(yaw)], p = P.position;
      const wind = Math.round(fpsOf() * 0.35);
      if (f - wind > W.frameStart) {
        keyVec(o, 'position', f - wind, [p[0] - fwd[0] * 1.2, p[1] + 0.2, p[2] - fwd[2] * 1.2]);
        keyVec(o, 'position', f, [p[0], p[1] + 0.5, p[2]]);
        o.props.release = f;
      } else o.props.release = -1;
      o.props.velocity = [+(fwd[0] * 7).toFixed(2), 3.5, +(fwd[2] * 7).toFixed(2)];
      o.props.stand = false; o.props.sleep = false;
      if (o.type === 'humanoid') o.props.tone = Math.min(o.props.tone, 0.4);
    } },
  { id: 'launch', name: 'Launch upward', icon: 'upload', desc: 'Physics starts here with a strong upward kick.', ok: (o) => isMol(o),
    apply(o, f) { const W = APP.scene.world.props; o.props.release = f > W.frameStart ? f : -1; o.props.velocity = [0, 9, 0]; o.props.stand = false; o.props.sleep = false; } },
  { id: 'orbit', name: 'Orbit around target', icon: 'camera', desc: 'One full circle around what the camera looks at, over four seconds.', ok: (o) => o && o.type === 'camera',
    apply(o, f, P) {
      const t = P.target, p = P.position, r = Math.hypot(p[0] - t[0], p[2] - t[2]), a0 = Math.atan2(p[0] - t[0], p[2] - t[2]);
      const n = 8, span = Math.round(fpsOf() * 4);
      for (let i = 0; i <= n; i++) { const a = a0 + i / n * Math.PI * 2; keyVec(o, 'position', f + Math.round(i / n * span), [t[0] + Math.sin(a) * r, p[1], t[2] + Math.cos(a) * r], 'bezier'); }
    } },
  { id: 'push', name: 'Push in', icon: 'camera', desc: 'Moves the camera 40% closer to its target over two seconds.', ok: (o) => o && o.type === 'camera',
    apply(o, f, P) { const t = P.target, p = P.position; keyVec(o, 'position', f, p); keyVec(o, 'position', f + Math.round(fpsOf() * 2), p.map((v, i) => v + (t[i] - v) * 0.4)); } },
  { id: 'slowmo', name: 'Slow-motion ramp', icon: 'clapper', desc: 'Scene time slows to 15% here, then speeds back up two seconds later.', ok: () => true, world: true,
    apply(o, f) { const W = APP.scene.world; const fps = fpsOf(); insertKey(W, 'timeScale', Math.max(W.props.frameStart, f - Math.round(fps * 0.2)), 1); insertKey(W, 'timeScale', f, 0.15); insertKey(W, 'timeScale', f + fps * 2, 0.15); insertKey(W, 'timeScale', f + Math.round(fps * 2.4), 1); } },
  { id: 'gravity', name: 'Zero-gravity moment', icon: 'blackhole', desc: 'Gravity switches off for a second, then comes back.', ok: () => true, world: true,
    apply(o, f) { const W = APP.scene.world, g = W.props.gravity, fps = fpsOf(); insertKey(W, 'gravity', f, g, 'constant'); insertKey(W, 'gravity', f + 1, 0, 'constant'); insertKey(W, 'gravity', f + fps, g, 'constant'); } },
];
function applyMotion(id) {
  const m = MOTIONS.find(x => x.id === id); if (!m) return;
  const o = m.world ? APP.scene.world : activeObj();
  if (!m.ok(o)) return toast(m.world ? 'Cannot apply here' : 'Select an object this preset works on', true);
  pushUndo();
  const P = evalProps(o, APP.frame);
  m.apply(o, APP.frame, P);
  changed(o, o.type !== 'camera');
  UI.onPropChanged(o, 'position'); TL.rebuildLabels(); buildProps();
  toast(`${m.name} added at frame ${APP.frame}`);
}
