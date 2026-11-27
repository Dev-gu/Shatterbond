const B = require('../src/builder.js');
const Engine = require('../src/engine.js');
function run(body, params, label, opts={}){
  const eng = new Engine();
  eng.build({boneTissue:B.T.bone, cartTissue:B.T.cartilage, bodies:[Object.assign({}, body, {pos:opts.pos||[0,0,0], quat:[0,0,0,1], params})]});
  let out=[];
  for (let f=0; f<(opts.frames||60); f++){
    const st = eng.step({dt:1/60, substeps:6, gravity:[0,opts.g!=null?opts.g:-9.81,0], floor:{enabled:true,y:0,friction:0.7}, colliders:[], bodies:[{}]});
    if (f%10===0){ let m=-1e9,mn=1e9; for(let i=0;i<eng.N;i++){ m=Math.max(m, eng.x[3*i+1]); mn=Math.min(mn,eng.x[3*i+1]);} out.push(`f${f}:b${st.broken}/${mn.toFixed(2)}-${m.toFixed(2)}`); }
  }
  console.log(label.padEnd(22), out.join(' '));
  return eng;
}
const cube = B.buildBody({type:'cube', size:[0.5,0.5,0.5], spacing:0.03, material:B.T.clay});
const base = {rigidity:1, tone:0, strength:1, shatter:50, friction:0.6, stiffness:1, stand:false, startAsleep:false, anchorStrength:1};
run(cube, base, 'cube rig1 drop', {pos:[0,1,0]});
run(cube, Object.assign({},base,{rigidity:0}), 'cube rig0 drop', {pos:[0,1,0]});
const hum = B.buildBody({type:'humanoid', spacing:0.024, pose:'stand', seed:3});
run(hum, Object.assign({},base,{rigidity:0.8,tone:0.9}), 'hum g0 rig tone', {g:0});
run(hum, Object.assign({},base,{rigidity:0.8,tone:0}), 'hum g0 rig', {g:0});
run(hum, Object.assign({},base,{rigidity:0,tone:0.9}), 'hum g0 tone', {g:0});
