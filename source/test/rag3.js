const B = require('../src/builder.js');
const Engine = require('../src/engine.js');
const body = B.buildBody({type:'humanoid', spacing:0.024, pose:'stand', seed:3});
const eng = new Engine();
const params = {rigidity:0.8, tone:0, strength:1, shatter:500, friction:0.6, stiffness:1, stand:true, startAsleep:false, anchorStrength:1};
eng.build({boneTissue:B.T.bone, cartTissue:B.T.cartilage, bodies:[Object.assign({}, body, {pos:[0,0,0], quat:[0,0,0,1], params})]});
let snap={};
for (let f=0; f<100; f++){
  eng.step({dt:1/60, substeps:6, gravity:[0,-9.81,0], floor:{enabled:true,y:0,friction:0.7}, colliders:[], bodies:[{}]});
  if (f===25||f===99){
    const c={}; let cross=0, stretch=0, comp=0;
    for(let q=0;q<eng.B;q++) if(eng.bx[q]){ const i=eng.bi[q], j=eng.bj[q]; const k=[B.TISSUES[eng.tis[i]].id,B.TISSUES[eng.tis[j]].id].sort().join('-'); c[k]=(c[k]||0)+1; if(eng.seg[i]!==eng.seg[j]) cross++; }
    console.log('frame', f, 'cross-seg', cross, Object.entries(c).sort((a,b)=>b[1]-a[1]).slice(0,10));
    const sg={}; for(let q=0;q<eng.B;q++) if(eng.bx[q]){ const s=eng.seg[eng.bi[q]]; sg[s]=(sg[s]||0)+1;} console.log(' by seg', JSON.stringify(sg));
  }
}
