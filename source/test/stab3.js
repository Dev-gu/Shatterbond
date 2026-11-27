const B = require('../src/builder.js');
const Engine = require('../src/engine.js');
const sp=+(process.argv[2]||0.024);
const body = B.buildBody({type:'humanoid', spacing:sp, pose:process.argv[3]||'stand', seed:3});
console.log('n', body.count, 'build', body.ms);
function run(params, label, opts={}){
  const eng = new Engine();
  eng.build({boneTissue:B.T.bone, cartTissue:B.T.cartilage, bodies:[Object.assign({}, body, {pos:[0,0,0], quat:[0,0,0,1], params})]});
  let out=[]; let tot=0;
  for (let f=0; f<(opts.frames||120); f++){
    const st = eng.step({dt:1/60, substeps:opts.sub||6, gravity:[0,-9.81,0], floor:{enabled:true,y:0,friction:0.7}, colliders:[], bodies:[{}]});
    tot+=st.ms;
    if (f%20===0){ let m=-1e9; for(let i=0;i<eng.N;i++) m=Math.max(m, eng.x[3*i+1]); out.push(`f${f}:b${st.broken}/h${m.toFixed(2)}/${st.awake}`); }
  }
  console.log(label.padEnd(22), out.join(' '), 'pose', eng.bodies[0].poseClusters.map(c=>c.m.length).join(','), 'ms', (tot/(opts.frames||120)).toFixed(1));
  return eng;
}
const base = {rigidity:0.8, tone:0.9, strength:1, shatter:5, friction:0.6, stiffness:1, stand:true, startAsleep:false, anchorStrength:1};
run(base, 'rig.8 tone.9 stand');
run(Object.assign({},base,{stand:false}), 'rig.8 tone.9 free');
run(Object.assign({},base,{tone:0}), 'ragdoll (tone0)');
run(Object.assign({},base,{tone:0.6}), 'tone .6');
