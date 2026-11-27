const B = require('../src/builder.js');
const Engine = require('../src/engine.js');
const body = B.buildBody({type:'humanoid', spacing:0.024, pose:'stand', seed:3});
const eng = new Engine();
const params = {rigidity:0.8, tone:0, strength:1, shatter:500, friction:0.6, stiffness:1, stand:true, startAsleep:false, anchorStrength:1};
eng.build({boneTissue:B.T.bone, cartTissue:B.T.cartilage, bodies:[Object.assign({}, body, {pos:[0,0,0], quat:[0,0,0,1], params})]});
const hist = {};
for (let f=0; f<60; f++){
  const prevCl = eng.cl.slice(); const prevNbb = eng.nbb.slice();
  eng.step({dt:1/60, substeps:6, gravity:[0,-9.81,0], floor:{enabled:true,y:0,friction:0.7}, colliders:[], bodies:[{}], ppEvery:1000});
  let cnt=0, ex=-1;
  for(let i=0;i<eng.N;i++){ const s=Math.hypot(eng.v[3*i],eng.v[3*i+1],eng.v[3*i+2]); if(s>10){cnt++; if(ex<0) ex=i;} }
  if (cnt){
    const i=ex; const c=prevCl[i]; const cls=eng.bodies[0].clusters;
    console.log('frame',f,'fast',cnt,'ex',i,'tis',B.TISSUES[eng.tis[i]].id,'nbb before',prevNbb[i],'after',eng.nbb[i],'/',eng.nb0[i],'prev cluster',c, 'v',eng.v.slice(3*i,3*i+3).map(v=>v.toFixed(1)).join(','), 'y', eng.x[3*i+1].toFixed(2));
    // which clusters were the fast particles in
    const cc={}; for(let j=0;j<eng.N;j++){ const s=Math.hypot(eng.v[3*j],eng.v[3*j+1],eng.v[3*j+2]); if(s>10){ cc[prevCl[j]]=(cc[prevCl[j]]||0)+1; } }
    console.log(' clusters of fast:', JSON.stringify(cc));
    if (++hist.n > 3) break; hist.n = hist.n||1;
  }
}
