const B = require('../src/builder.js');
const Engine = require('../src/engine.js');
const body = B.buildBody({type:'humanoid', spacing:+(process.argv[2]||0.024), pose:'stand', seed:3});
const eng = new Engine();
eng.build({boneTissue:B.T.bone, cartTissue:B.T.cartilage, bodies:[Object.assign({}, body, {pos:[0,0,0], quat:[0,0,0,1], params:{rigidity:0.8,tone:0.9,strength:1,shatter:5,stand:true}})]});
const b=eng.bodies[0];
console.log('pose clusters', b.poseClusters.map(c=>{ let a=0, segs={}; for(const i of c.m){ if(eng.anc[i]) a++; segs[eng.seg[i]]=(segs[eng.seg[i]]||0)+1;} return c.m.length+' anc'+a+' segs'+JSON.stringify(segs); }));
// skeleton components: union over bone/cart bonds
const N=eng.N, uf=new Int32Array(N).map((_,i)=>i); const f=i=>{while(uf[i]!==i){uf[i]=uf[uf[i]];i=uf[i];}return i;};
const isSk=i=>eng.tis[i]===B.T.bone||eng.tis[i]===B.T.cartilage;
for(let q=0;q<eng.B;q++){const i=eng.bi[q],j=eng.bj[q]; if(isSk(i)&&isSk(j)){const a=f(i),c=f(j); if(a!==c) uf[a]=c;}}
const comp={}; for(let i=0;i<N;i++) if(isSk(i)){const r=f(i); (comp[r]=comp[r]||{n:0,segs:new Set()}); comp[r].n++; comp[r].segs.add(eng.seg[i]);}
console.log('skeleton comps', Object.values(comp).map(c=>c.n+':'+[...c.segs].join('/')));
let anc=0; for(let i=0;i<N;i++) if(eng.anc[i]) anc++; console.log('anchored', anc);
// boneRef missing
let miss=0; for(let i=0;i<N;i++) if(eng.boneRef[i]<0) miss++; console.log('no boneRef', miss);
