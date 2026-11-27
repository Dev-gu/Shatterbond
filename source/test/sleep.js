const B = require('../src/builder.js');
const Engine = require('../src/engine.js');
const body = B.buildBody({type:'humanoid', spacing:0.024, pose:'stand', seed:3});
const eng = new Engine();
eng.build({boneTissue:B.T.bone, cartTissue:B.T.cartilage, bodies:[Object.assign({}, body, {pos:[0,0,0], quat:[0,0,0,1], params:{rigidity:0.8,tone:0.85,strength:1,shatter:5,stand:true,startAsleep:false}})]});
let o=[];
for (let f=0; f<120; f++){ const st=eng.step({dt:1/60, substeps:6, gravity:[0,-9.81,0], floor:{enabled:true,y:0,friction:0.7}, colliders:[], bodies:[{}]}); o.push(eng.bodies[0].maxSpeed.toFixed(3)+"|"+eng.bodies[0].sleepCnt+(eng.bodies[0].asleep?"Z":"")); }
console.log(o.join(' '));
