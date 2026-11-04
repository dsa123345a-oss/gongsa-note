import test from 'node:test';
import assert from 'node:assert/strict';
import {createResourcePricer,refreshProjectResources,resourceIdentity,resourceLibrary} from '../dist/resource-pricing.js';
import {calculateAssemblyDetailed} from '../dist/estimate-core.js';
import {planAutoLinks,applyAutoLinks} from '../dist/auto-link.js';
import {amount} from '../dist/calc.js';
import fs from 'node:fs/promises';
import {inflateRawSync} from 'node:zlib';
import {importEst} from '../dist/est.js';
import {attachMachineBasis,editableAssembly} from '../dist/est-edit.js';
const leaf=(name,code,price,category='노임',spec='')=>({name,code,spec,unit:category==='노임'?'인':'개',category,labor:category==='노임'?price:0,material:category==='자재'?price:0,expense:0,other:0,total:price,source:'추가',library:'extra',table:category==='노임'?'LaborcDat':'StuffcDat'});
const part=(r,qty)=>({...r,qtyExpression:String(qty)});
function fixture(){
 const labor=leaf('배 관 공','L1',100),material=leaf('부속','M1',50,'자재','D15');
 const components=[part(labor,2),part(material,3),{kind:'percent',name:'잡비',basis:'labor',target:'material',percent:2}],calculation={componentDigits:1};
 const rate={name:'접합',code:'U1',spec:'D15',unit:'개',category:'일위대가',source:'추가',library:'extra',table:'HeadTitleDat',components,calculation,...calculateAssemblyDetailed(components,calculation).result};
 const master={id:'main',name:'10월',isMain:true,items:[{...leaf('배 관 공','L900',120),source:'10월',library:'main'},{...leaf('부속','M900',70,'자재','D15'),source:'10월',library:'main'}]};
 const libs=[master,{id:'extra',name:'추가',items:[rate,labor,material]}];
 const project={schema:1,title:'검증',lines:[{id:'l1',name:'접합',spec:'D15',unit:'개',group:'배관공',bucket:'direct',qty:2,bidPercent:90,status:'confirmed',rate}],charges:[],mappings:{}};
 return {rate,libs,project};
}
test('산출 DB 구성·수량·잡비를 유지하면서 서로 다른 코드의 기준 노임·자재를 적용',()=>{
 const {rate,libs,project}=fixture(),before=JSON.stringify(libs),r=createResourcePricer(project,libs).reprice(rate);
 assert.equal(r.ready,true);assert.equal(r.rate.labor,240);assert.equal(r.rate.material,214);assert.equal(r.rate.total,454);assert.equal(r.rate.components[0].qtyExpression,'2');assert.equal(r.rate.source,'추가');assert.equal(r.changes[0].source,'10월');assert.equal(JSON.stringify(libs),before);
});
test('산출 안 자재는 규격의 소수점이 다르면 동일 코드여도 교체하지 않는다',()=>{
 const {libs,project,rate}=fixture(),r=leaf('부속','M1',10,'자재','1.5');libs[0].items.push({...r,spec:'15',material:99,total:99});
 const assembly={...rate,components:[part(r,1)]};Object.assign(assembly,calculateAssemblyDetailed(assembly.components,{}).result);
 assert.equal(createResourcePricer(project,libs).reprice(assembly).ready,false);
});
test('부족한 자재는 미확정으로 제외하고 명시적인 대응 관계를 저장하면 계산',()=>{
 const {libs,project}=fixture();libs[0].items[1].name='다른 표기 부속';
 let r=refreshProjectResources(project,libs);assert.equal(r.project.lines[0].status,'proposed');assert.equal(amount(r.project.lines[0]),null);
 assert.doesNotThrow(()=>JSON.stringify(r.project));
 const source=libs[1].items[2],target=libs[0].items[1];project.resourceMappings={[resourceIdentity(source)]:{master:'10월',...Object.fromEntries(['code','name','spec','unit'].map(k=>[k,target[k]]))}};
 r=refreshProjectResources(project,libs);assert.equal(r.rows[0].ready,true);assert.equal(r.project.lines[0].qty,2);assert.equal(r.project.lines[0].bidPercent,90);assert.equal(amount(r.project.lines[0]).total,816);
});
test('직접 자재는 월별 DB에 없어도 선택 DB 단가를 유지하고 저장된다',()=>{
 const {libs,project}=fixture();project.lines[0].rate=leaf('없는 자재','M404',200,'자재');
 const r=refreshProjectResources(project,libs),saved=JSON.parse(JSON.stringify(r.project));
 assert.equal(saved.lines[0].status,'confirmed');assert.equal(saved.lines[0].rate.total,200);assert.equal(saved.lines[0].rate.resourcePricing.mode,'direct-material');
});
test('같은 자재라도 직접 내역은 추가 DB 단가, 산출 구성은 월별 단가를 쓴다',()=>{
 const {libs,project,rate}=fixture(),pricer=createResourcePricer(project,libs);
 const direct=pricer.reprice(libs[1].items[2]),assembly=pricer.reprice(rate);
 assert.equal(direct.rate.total,50);assert.equal(direct.ready,true);assert.equal(assembly.rate.components[1].material,70);
});
test('기준 재적용은 누적하지 않으며 원래 산출과 저장한 결과를 함께 보존',()=>{
 const {libs,project}=fixture(),one=refreshProjectResources(project,libs),two=refreshProjectResources(one.project,libs);
 assert.equal(one.project.lines[0].rate.total,two.project.lines[0].rate.total);assert.equal(two.project.lines[0].rate.resourcePricing.original.total,354);
});
test('별도 경비로 계상한 EST 내역도 구성 재계산 후 경비 계상을 유지',()=>{
 const {libs,project,rate}=fixture(),saved={...rate,components:undefined,table:'EstMainDat',category:'내역단가',unit:'개당',labor:0,material:0,expense:354};
 const r=createResourcePricer(project,libs).reprice(saved);assert.equal(r.ready,true);assert.equal(r.rate.labor,0);assert.equal(r.rate.material,0);assert.equal(r.rate.expense,454);
});
test('자동 연결은 산출 구성 우선 DB와 노임·자재 DB를 분리한다',()=>{
 const {libs,project}=fixture();project.lines[0].status='unmatched';project.lines[0].rate=null;
 const plans=planAutoLinks(project,libs,'','extra'),p=applyAutoLinks(project,plans,'b');
 assert.equal(p.lines[0].rate.source,'추가');assert.equal(p.lines[0].rate.total,454);assert.equal(p.lines[0].rate.resourcePricing.master,'10월');
});
test('중첩 일위대가 구성도 새 노임으로 계산하며 원본과 순환 참조를 보호',()=>{
 const {libs,project,rate}=fixture();const outer={...rate,code:'U2',name:'외부',components:[part(rate,3)]};Object.assign(outer,calculateAssemblyDetailed(outer.components,{}).result);
 const r=createResourcePricer(project,libs).reprice(outer);assert.equal(r.ready,true);assert.equal(r.rate.total,1362);
});
test('행마다 다른 절사 자릿수를 보존한다',()=>{
 const parts=[{name:'A',qty:1,labor:1.29,componentDigits:0},{name:'B',qty:1,labor:1.29,componentDigits:1}];
 const r=calculateAssemblyDetailed(parts,{componentDigits:2});assert.equal(r.rows[0].amount.labor,1);assert.equal(r.rows[1].amount.labor,1.2);assert.equal(r.result.labor,2);
});
test('삭제된 기준 DB는 옛 단가를 최신 적용 완료로 확정하지 않는다',()=>{
 const {libs,project,rate}=fixture();project.resourcePriceLibrary={id:'gone',name:'다른 월'};
 const r=createResourcePricer(project,libs).reprice(rate);assert.equal(r.rate.resourcePricing.ready,false);assert.equal(amount({...project.lines[0],rate:r.rate}),null);
});
test('추가 DB를 메인으로 표시해도 월별 노임·자재 기준은 별도로 선택',()=>{
 const {libs}=fixture();libs[0].name='2026-10-main.estx';libs[0].isMain=false;libs[1].isMain=true;
 assert.equal(resourceLibrary({},libs).id,'main');assert.equal(resourceLibrary({resourcePriceLibrary:{id:'extra',name:'추가'}},libs).id,'extra');
});
test('실제 추가 DB 산출과 10월 메인으로 배관 노임·잡비·장비를 다시 계산',{skip:!process.env.EST_MONTH_PATH||!process.env.EST_ADDED_PATH},async()=>{
 const libs=[];for(const [path,name] of [[process.env.EST_MONTH_PATH,'10월 메인'],[process.env.EST_ADDED_PATH,'추가']])libs.push(attachMachineBasis(await importEst(await fs.readFile(path),name,inflateRawSync)));
 libs[0].isMain=true;const pricer=createResourcePricer({},libs),pick=code=>libs[1].items.find(i=>i.code===code&&i.table!=='EstMainDat');
 const pipe=pricer.reprice(pick('U0000000008'));assert.equal(pipe.ready,true);assert.equal(pipe.rate.total,6250);assert.equal(pipe.rate.components[0].labor,249073);assert.equal(pipe.rate.components[1].labor,172698);
 assert.equal(pipe.rate.components[0].qtyExpression,'0.014');assert.equal(pipe.rate.components[1].qtyExpression,'0.016');
 const meter=pricer.reprice(pick('U0000000105'));assert.equal(meter.rate.labor,39646);assert.equal(meter.rate.material,396);assert.equal(meter.rate.total,40042);
 const dig=pricer.reprice(pick('D0000000000'));assert.equal(dig.ready,true);assert.equal(dig.rate.total,8047);assert.ok(dig.changes.some(c=>c.name==='건설기계운전사'&&c.after===283323));assert.ok(dig.changes.some(c=>c.category==='장비'&&c.after===66538000));
 for(const [code,expected] of [['D0000000011',7662],['D0000000042',29763],['D0000000069',1372],['D0000000014',16],['D0000000267',2703]]){
  const r=pick(code),rows=libs[1].details.find(([k])=>k==='CostMainDat:'+code)[1],original=editableAssembly(r,rows,libs[1].items);
  assert.equal(calculateAssemblyDetailed(original.components,original.calculation).result.total,r.total);
  const priced=pricer.reprice(r);assert.equal(priced.ready,true,code);assert.equal(priced.rate.total,expected,code);
 }
});
