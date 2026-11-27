const B = require('../src/builder.js');
const Engine = require('../src/engine.js');
const body = B.buildBody({type:'humanoid', spacing:0.024, pose:'stand', seed:3});
function run(params, label, frames=90, sub=6){
  const eng = new Engine();
  eng.build({boneTissue:B.T.bone, cartTissue:B.T.cartilage, bodies:[Object.assign({}, body, {pos:[0,0,0], quat:[0,0,0,1], params})]});
  let out=[];
  for (let f=0; f<frames; f++){
    const st = eng.step({dt:1/60, substeps:sub, gravity:[0,-9.81,0], floor:{enabled:true,y:0,friction:0.7}, colliders:[], bodies:[{}]});
    if (f%15===0){ let m=-1e9; for(let i=0;i<eng.N;i++) m=Math.max(m, eng.x[3*i+1]); out.push(`f${f}:b${st.broken}/h${m.toFixed(2)}`); }
  }
  console.log(label.padEnd(28), out.join(' '));
}
const base = {rigidity:0, tone:0, strength:1, shatter:5, friction:0.6, stiffness:1, stand:true, startAsleep:false, anchorStrength:1};
run(Object.assign({},base,{}), 'bonds only stand');
run(Object.assign({},base,{stand:false}), 'bonds only nostand');
run(Object.assign({},base,{rigidity:0.8}), 'rig .8');
run(Object.assign({},base,{tone:0.9}), 'tone .9');
run(Object.assign({},base,{rigidity:0.8,tone:0.9}), 'rig+tone');
run(Object.assign({},base,{rigidity:0.8,tone:0.9, strength:100}), 'rig+tone unbreakable');
