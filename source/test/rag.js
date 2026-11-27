const B = require('../src/builder.js');
const Engine = require('../src/engine.js');
const body = B.buildBody({type:'humanoid', spacing:0.024, pose:'stand', seed:3});
function run(params, label, inp={}){
  const eng = new Engine();
  eng.build({boneTissue:B.T.bone, cartTissue:B.T.cartilage, bodies:[Object.assign({}, body, {pos:[0,0,0], quat:[0,0,0,1], params})]});
  let out=[];
  for (let f=0; f<100; f++){
    const st = eng.step(Object.assign({dt:1/60, substeps:6, gravity:[0,-9.81,0], floor:{enabled:true,y:0,friction:0.7}, colliders:[], bodies:[{}]}, inp));
    let mv=0, arg=-1; for(let i=0;i<eng.N;i++){ const s=Math.hypot(eng.v[3*i],eng.v[3*i+1],eng.v[3*i+2]); if(s>mv){mv=s;arg=i;} }
    if (f%10===0) out.push(`f${f}:b${st.broken} v${mv.toFixed(1)}(${B.TISSUES[eng.tis[arg]].id[0]}${eng.nbb[arg]}/${eng.nb0[arg]})`);
  }
  console.log(label.padEnd(16), out.join(' '));
}
const base = {rigidity:0.8, tone:0, strength:1, shatter:5, friction:0.6, stiffness:1, stand:true, startAsleep:false, anchorStrength:1};
run(base, 'rag');
run(base, 'rag nopp', {ppEvery:1000});
run(Object.assign({},base,{rigidity:0}), 'rag rig0');
run(Object.assign({},base,{strength:10}), 'rag strong');
run(Object.assign({},base,{shatter:500}), 'rag noshatter');
