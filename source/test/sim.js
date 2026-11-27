const B = require('../src/builder.js');
const Engine = require('../src/engine.js');
const sp = +(process.argv[2]||0.019);
const pose = process.argv[3]||'stand';
let t=Date.now();
const body = B.buildBody({type:'humanoid', spacing:sp, pose, seed:3});
console.log('build ms', Date.now()-t, 'particles', body.count, 'bonds', body.bondRest.length, 'skin verts', body.skin.pos.length/3, 'tris', body.skin.index.length/3, 'bindfails', body.skin.fails);
const cnt = {}; for (const ti of body.tissue) { const n=B.TISSUES[ti].id; cnt[n]=(cnt[n]||0)+1; } console.log(cnt);
let ymin=1e9,ymax=-1e9; for(let i=0;i<body.count;i++){ymin=Math.min(ymin,body.rest[3*i+1]);ymax=Math.max(ymax,body.rest[3*i+1]);} console.log('y range',ymin.toFixed(3),ymax.toFixed(3));
const eng = new Engine();
const params = {rigidity:0.8, tone:0.9, strength:1, shatter:5, friction:0.6, stiffness:1, stand:true, startAsleep:false, anchorStrength:1};
eng.build({boneTissue:B.T.bone, cartTissue:B.T.cartilage, bodies:[Object.assign({}, body, {pos:[0,0,0], quat:[0,0,0,1], params})]});
function headY(){ let m=-1e9; for(let i=0;i<eng.N;i++) m=Math.max(m, eng.x[3*i+1]); return m; }
function boneBroken(){ let c=0; for(let q=0;q<eng.B;q++) if(eng.bx[q] && eng.tis[eng.bi[q]]===B.T.bone && eng.tis[eng.bj[q]]===B.T.bone) c++; return c; }
const fps=60, L=3, th0=80*Math.PI/180, om=Math.sqrt(9.81/L);
function hammer(tt){ // pendulum from +z side swinging toward -z, pivot above at y=4.2
  const th = tt<0? th0 : th0*Math.cos(om*tt);
  const pz = L*Math.sin(th), py = 4.2 - L*Math.cos(th);
  return {p:[0,py,pz], q:[0,0.7071068,0,0.7071068]}; // cylinder axis y rotated... keep axis along x? quat rotating y->z: about x 90deg
}
const qx90=[Math.sin(Math.PI/4),0,0,Math.cos(Math.PI/4)];
let prev=null, tot=0, mx=0;
for (let f=0; f<240; f++){
  const tt = (f-60)/fps; // released at frame 60
  const h = hammer(tt); h.q=qx90;
  const cur = {shape:'cylinder', dims:[0.32,0.55,0.32], bound:0.7, friction:0.4, a: prev||h, b: h};
  prev = h;
  const st = eng.step({dt:1/fps, substeps:+(process.argv[4]||6), gravity:[0,-9.81,0], floor:{enabled:true,y:0,friction:0.7}, colliders:[cur], bodies:[{}]});
  tot+=st.ms; mx=Math.max(mx,st.ms);
  if (f%20===0||f===59) console.log('f',f,'ms',st.ms.toFixed(1),'awake',st.awake,'broken',st.broken,'boneBroken',boneBroken(),'headY',headY().toFixed(3),'hammerZ',h.p[2].toFixed(2), 'clusters', eng.bodies[0].clusters.length, 'pose', eng.bodies[0].poseClusters.length);
}
console.log('avg ms', (tot/240).toFixed(2), 'max', mx.toFixed(1));
let st2={0:0,1:0,2:0}; for (const v of eng.state) st2[v]++; console.log('states', st2);
