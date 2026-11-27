const B = require('../src/builder.js');
const Engine = require('../src/engine.js');
const body = B.buildBody({type:'humanoid', spacing:0.024, pose:'stand', seed:3});
function run(params, label, opts={}){
  const eng = new Engine();
  eng.build({boneTissue:B.T.bone, cartTissue:B.T.cartilage, bodies:[Object.assign({}, body, {pos:[0,0,0], quat:[0,0,0,1], params})]});
  let out=[];
  for (let f=0; f<60; f++){
    const st = eng.step({dt:1/60, substeps:opts.sub||6, gravity:[0,opts.g!=null?opts.g:-9.81,0], floor:{enabled:opts.floor!==false,y:0,friction:0.7}, colliders:[], bodies:[{}]});
    if (f%10===0||f==1||f==2){ let m=-1e9; for(let i=0;i<eng.N;i++) m=Math.max(m, eng.x[3*i+1]); out.push(`f${f}:b${st.broken}/h${m.toFixed(2)}`); }
  }
  console.log(label.padEnd(28), out.join(' '));
  return eng;
}
const base = {rigidity:0, tone:0, strength:1, shatter:50, friction:0.6, stiffness:1, stand:false, startAsleep:false, anchorStrength:1};
run(base, 'g0 nofloor', {g:0, floor:false});
run(base, 'g-9.8 nofloor', {floor:false});
run(base, 'g0 floor', {g:0});
const e = run(Object.assign({},base,{stiffness:1}), 'g-9.8 floor sub20', {sub:20});
// which tissues break first
const eng = new Engine();
eng.build({boneTissue:B.T.bone, cartTissue:B.T.cartilage, bodies:[Object.assign({}, body, {pos:[0,0,0], quat:[0,0,0,1], params:base})]});
for (let f=0; f<12; f++) eng.step({dt:1/60, substeps:6, gravity:[0,-9.81,0], floor:{enabled:true,y:0,friction:0.7}, colliders:[], bodies:[{}]});
const c={}; for(let q=0;q<eng.B;q++) if(eng.bx[q]){ const k=B.TISSUES[eng.tis[eng.bi[q]]].id+'-'+B.TISSUES[eng.tis[eng.bj[q]]].id; c[k]=(c[k]||0)+1;} console.log(c);
// y of broken bonds
let ys=[]; for(let q=0;q<eng.B;q++) if(eng.bx[q]) ys.push(eng.r[3*eng.bi[q]+1]); ys.sort((a,b)=>a-b); console.log('rest y of broken', ys.length, ys[0], ys[ys.length>>1], ys[ys.length-1]);
