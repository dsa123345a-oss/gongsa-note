import test from 'node:test';
import assert from 'node:assert/strict';
import {createResourcePricer,refreshProjectResources} from '../dist/resource-pricing.js';
import {calculateAssemblyDetailed} from '../dist/estimate-core.js';
import {amount} from '../dist/calc.js';
import {planPriceUpdate,validatePriceReference} from '../dist/price-update.js';
const leaf=(name,code,value,kind='노임')=>({name,code,spec:'',unit:kind==='노임'?'인':'개',category:kind,table:kind==='노임'?'LaborcDat':'StuffcDat',source:'추가 DB',library:'extra',labor:kind==='노임'?value:0,material:kind==='자재'?value:0,expense:0,other:0,total:value});
const assembly=(name,code,parts)=>({name,code,spec:'',unit:'개',category:code.startsWith('E')?'장비':'일위대가',table:code.startsWith('E')?'MachTitleDat':'HeadTitleDat',source:'추가 DB',library:'extra',components:parts,calculation:{componentDigits:1},...calculateAssemblyDetailed(parts,{componentDigits:1}).result});
function fixture(){
 const labor=leaf('배 관 공','L-old',100),material=leaf('부속','M-old',50,'자재');
 const rate=assembly('접합','U1',[{...labor,qty:2},{...material,qty:1}]);
 const latest=[{...leaf('배관공','L-new',120),source:'2026-10-main.estx',library:'month'},{...leaf('부속','M-new',70,'자재'),source:'2026-10-main.estx',library:'month'}];
 const master={id:'month',name:'2026-10-main.estx',isMain:true,priceUpdateReference:true,items:latest};
 const libs=[master,{id:'extra',name:'추가 DB',items:[labor,material,rate]}];
 const project={schema:1,title:'노임 기준 검증',resourceMissingPolicy:'keep',lines:[{id:'l',name:rate.name,spec:'',unit:'개',group:'배관공',bucket:'direct',qty:1,status:'confirmed',rate}],charges:[],mappings:{}};
 return {labor,material,rate,libs,master,project};
}

test('기존 단가 유지 설정에서도 없는 노임은 확정하지 않고 상위 일위를 합계에서 제외한다',()=>{
 const {libs,project}=fixture();libs[0].items=libs[0].items.filter(r=>r.category!=='노임');const before=JSON.stringify(project);
 const result=refreshProjectResources(project,libs),line=result.project.lines[0],warning=line.rate.resourcePricing.warnings.find(i=>i.resource?.category==='노임');
 assert.equal(result.rows[0].ready,false);assert.equal(line.status,'proposed');assert.equal(amount(line),null);assert.equal(warning.retained,false);assert.match(warning.reason,/계산 보류/);
 assert.equal(JSON.stringify(project),before);
});

test('기준 노임 후보가 여러 개이고 하나로 정해지지 않으면 추가 DB 노임으로 확정하지 않는다',()=>{
 const {libs,project,rate}=fixture();libs[0].items.push({...libs[0].items[0],code:'L-other',labor:130,total:130});
 const r=createResourcePricer(project,libs,{keepMissing:true}).reprice(rate);
 assert.equal(r.ready,false);assert.equal(r.warnings.find(i=>i.resource.category==='노임').retained,false);
});

test('노임 이름 공백 차이는 동일 직종으로 찾아 10월 단가를 적용한다',()=>{
 const {libs,project,rate}=fixture(),r=createResourcePricer(project,libs,{keepMissing:true}).reprice(rate);
 assert.equal(r.ready,true);assert.equal(r.rate.labor,240);assert.equal(r.rate.components[0].labor,120);assert.equal(r.rate.components[0].priceReference.source,'2026-10-main.estx');
});

test('없는 자재는 추가 DB 가격을 유지하되 노임은 10월 값을 쓴다',()=>{
 const {libs,project,rate}=fixture();libs[0].items=libs[0].items.filter(r=>r.category!=='자재');
 const r=createResourcePricer(project,libs,{keepMissing:true}).reprice(rate);
 assert.equal(r.ready,true);assert.equal(r.rate.labor,240);assert.equal(r.rate.material,50);assert.equal(r.warnings[0].retained,true);
});

test('삭제되거나 없는 기준 DB는 노임 확정으로 바꾸지 않는다',()=>{
 const {libs,project,rate}=fixture();project.resourcePriceLibrary={id:'missing',name:'2026-10-main.estx 삭제본'};
 const r=createResourcePricer(project,libs,{keepMissing:true}).reprice(rate);assert.equal(r.ready,false);assert.equal(amount({...project.lines[0],rate:r.rate}),null);
});

test('장비 내부의 미확인 노임도 상위 일위까지 미확정으로 전파한다',()=>{
 const {libs,project,labor}=fixture();const machine=assembly('시험 장비','E1',[{...labor,qty:.125}]);
 libs[1].items.push(machine);libs[0].items=libs[0].items.filter(r=>r.category!=='노임');
 const rate=assembly('장비 작업','U2',[{...machine,qty:2}]),r=createResourcePricer(project,libs,{keepMissing:true}).reprice(rate);
 assert.equal(r.ready,false);assert.equal(r.warnings.find(i=>i.resource.category==='노임').retained,false);assert.equal(r.warnings.find(i=>i.resource.category==='장비').retained,true);
});

test('단가 업데이트도 미확인 노임은 미확정으로 적용하고 기존 저장 공사는 수정하지 않는다',()=>{
 const {libs,project,master}=fixture();master.items=master.items.filter(r=>r.category!=='노임');const before=JSON.stringify({libs,project});
 const plan=planPriceUpdate(project,libs,master,['extra']);
 assert.equal(plan.project.lines[0].status,'proposed');assert.equal(amount(plan.project.lines[0]),null);assert.ok(plan.summary.unverified>0);
 assert.ok(plan.warnings.some(w=>w.resource?.category==='노임'&&w.retained===false));assert.equal(JSON.stringify({libs,project}),before);
});

test('기본 추가 DB를 명시적으로 기준 선택해도 오래된 노임을 기준 노임으로 확정하지 않는다',()=>{
 for(const marker of [{bundledDefault:'assembly'},{name:'상수도공사메인(26년)소형감압변 수정.ebkx'}]){
  const {libs,project,rate,material}=fixture();Object.assign(libs[1],marker,{priceUpdateReference:true});project.resourcePriceLibrary={id:libs[1].id,name:libs[1].name};
  const pricer=createResourcePricer(project,libs,{keepMissing:true}),r=pricer.reprice(rate);
  assert.throws(()=>validatePriceReference(libs[1]),/산출 구성용/);
  assert.equal(r.ready,false);assert.match(r.issues[0].reason,/산출 구성용/);assert.equal(r.warnings[0].retained,false);
  const direct=pricer.reprice(material);assert.equal(direct.ready,true);assert.equal(direct.rate.total,50);
 }
});

test('새 월별 또는 업로드된 자원 기준 DB는 사용하며 10월 이름으로 영구 고정하지 않는다',()=>{
 for(const name of ['2026-11-main.estx','새 노임 기준.estx']){
  const {libs,project,rate}=fixture();libs[0].name=name;libs[0].items[0].source=name;libs[0].items[0].labor=140;libs[0].items[0].total=140;project.resourcePriceLibrary={id:libs[0].id,name};
  const r=createResourcePricer(project,libs,{keepMissing:true}).reprice(rate);assert.equal(r.ready,true);assert.equal(r.rate.labor,280);assert.equal(r.rate.components[0].priceReference.source,name);
 }
});
