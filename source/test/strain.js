const B = require('../src/builder.js');
const Engine = require('../src/engine.js');
const body = B.buildBody({type:'humanoid', spacing:0.024, pose:'stand', seed:3});
const eng = new Engine();
const tone=+(process.argv[2]||0);
const params = {rigidity:0.8, tone, strength:1000, shatter:500, friction:0.6, stiffness:1, stand:true, startAsleep:false, anchorStrength:1};
eng.build({boneTissue:B.T.bone, cartTissue:B.T.cartilage, bodies:[Object.assign({}, body, {pos:[0,0,0], quat:[0,0,0,1], params})]});
const mx = new Float32Array(eng.B), mn=new Float32Array(eng.B);
for (let f=0; f<100; f++){
  eng.step({dt:1/60, substeps:6, gravity:[0,-9.81,0], floor:{enabled:true,y:0,friction:0.7}, colliders:[], bodies:[{}]});
  for(let q=0;q<eng.B;q++){ const i=eng.bi[q], j=eng.bj[q]; const d=Math.hypot(eng.x[3*j]-eng.x[3*i],eng.x[3*j+1]-eng.x[3*i+1],eng.x[3*j+2]-eng.x[3*i+2])/eng.br[q]-1; if(d>mx[q]) mx[q]=d; if(d<mn[q]) mn[q]=d; }
}
const groups={};
for(let q=0;q<eng.B;q++){ const i=eng.bi[q], j=eng.bj[q]; let k=[B.TISSUES[eng.tis[i]].id,B.TISSUES[eng.tis[j]].id].sort().join('-'); if(eng.seg[i]!==eng.seg[j]) k='JOINT '+k; (groups[k]=groups[k]||[]).push([mx[q],mn[q]]); }
const pct=(a,p)=>a[Math.min(a.length-1,Math.floor(a.length*p))];
for (const [k,a] of Object.entries(groups).sort((a,b)=>b[1].length-a[1].length).slice(0,24)){
  const s=a.map(v=>v[0]).sort((x,y)=>x-y), c=a.map(v=>-v[1]).sort((x,y)=>x-y);
  console.log(k.padEnd(28), String(a.length).padStart(6), 'stretch p50', pct(s,.5).toFixed(3),'p95',pct(s,.95).toFixed(3),'p99',pct(s,.99).toFixed(3), '| comp p95', pct(c,.95).toFixed(3),'p99',pct(c,.99).toFixed(3));
}
