import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {inflateRawSync} from 'node:zlib';
import {createResourcePricer} from '../dist/resource-pricing.js';
import {calculateAssemblyDetailed,costKeys} from '../dist/estimate-core.js';
import {importEst} from '../dist/est.js';
import {attachMachineBasis,editableAssembly} from '../dist/est-edit.js';
import {makePrintDocuments} from '../dist/est-print.js';

const amounts=(key,value)=>Object.fromEntries(costKeys.map(k=>[k,k===key?value:0]));
function leaf(category='자재',price=100){
 const labor=category==='노임';
 return {name:labor?'직종':'운반단가',spec:'',unit:labor?'인':'회',code:labor?'L1':'M1',table:labor?'LaborcDat':'StuffcDat',category,source:'추가',library:'extra',...amounts(labor?'labor':'material',price),total:price};
}
function fixture(category='자재',target='expense'){
 const source=leaf(category),part={...source,...amounts(target,100),sourceComponent:target,qtyExpression:'2'};
 const components=[part],calculation={componentDigits:1};
 const rate={name:'비목 배분 산출',spec:'',unit:'개',code:'D1',category:'단가산출',table:'CostTitleDat',source:'추가',library:'extra',components,calculation,...calculateAssemblyDetailed(components,calculation).result};
 const selected={...leaf(category,120),code:category==='노임'?'L99':'M99',source:'10월',library:'main'};
 const main={id:'main',name:'10월',isMain:true,items:[selected]},extra={id:'extra',name:'추가',items:[source,rate]};
 return {source,part,rate,selected,main,extra,libs:[main,extra]};
}

test('단일 노임·자재의 총단가를 원본 산식에서 지정한 비목에만 계상한다',()=>{
 for(const category of ['노임','자재'])for(const target of costKeys){
  const f=fixture(category,target),before=JSON.stringify(f.libs),r=createResourcePricer({},f.libs).reprice(f.rate),p=r.rate.components[0];
  assert.equal(r.ready,true,category+':'+target);assert.equal(p[target],120);assert.equal(p.total,120);assert.equal(r.rate[target],240);
  for(const k of costKeys)if(k!==target){assert.equal(p[k],0);assert.equal(r.rate[k],0);}
  assert.equal(p.qtyExpression,'2');assert.equal(p.sourceComponent,target);assert.equal(p.priceReference.total,120);
  assert.equal(p.priceReference[category==='노임'?'labor':'material'],120);assert.equal(JSON.stringify(f.libs),before);
  const again=createResourcePricer({},f.libs).reprice(JSON.parse(JSON.stringify(r.rate)));
  assert.equal(again.ready,true);assert.deepEqual(again.rate.components,r.rate.components);assert.equal(again.rate.total,240);
 }
});

test('비목 지정이 없는 자원은 원래 비목을 유지하고 직접 자재 단가 정책도 유지한다',()=>{
 const f=fixture();delete f.part.sourceComponent;Object.assign(f.part,amounts('material',100));
 const pricer=createResourcePricer({},f.libs),r=pricer.reprice(f.rate);
 assert.equal(r.ready,true);assert.equal(r.rate.material,240);assert.equal(r.rate.expense,0);
 const direct=pricer.reprice(f.source);assert.equal(direct.rate.total,100);assert.equal(direct.mode,'direct-material');
});

test('기준단가를 찾지 못하거나 후보가 중복되어도 선택 비목을 0으로 지우지 않는다',()=>{
 for(const duplicate of [false,true]){
  const f=fixture();f.main.items=duplicate?[f.selected,{...f.selected,code:'M98',material:140,total:140}]:[];
  const r=createResourcePricer({},f.libs,{keepMissing:false}).reprice(f.rate);
  assert.equal(r.ready,false);assert.equal(r.rate.components[0].expense,100);assert.equal(r.rate.total,200);
  assert.ok(r.issues.some(i=>i.kind==='missing-reference'));
 }
});

test('복합 일위대가를 비목별로 참조할 때는 총액 대신 선택 비목만 유지한다',()=>{
 const f=fixture(),labor=leaf('노임',100),material=leaf('자재',50);
 const components=[{...labor,qtyExpression:'2'},{...material,qtyExpression:'3'},{name:'고정경비',code:'',qtyExpression:'1',...amounts('expense',30),total:30}],calculation={componentDigits:1};
 const inner={name:'복합 구성',spec:'',unit:'개',code:'U1',category:'일위대가',table:'HeadTitleDat',source:'추가',library:'extra',components,calculation,...calculateAssemblyDetailed(components,calculation).result};
 f.extra.items.push(labor,material,inner);f.main.items=[{...leaf('노임',120),code:'L99',source:'10월',library:'main'},{...leaf('자재',70),code:'M99',source:'10월',library:'main'}];
 for(const [target,expected] of [['labor',240],['material',210],['expense',30]]){
  const rate={...f.rate,components:[{...inner,sourceComponent:target,qtyExpression:'1',...amounts(target,inner[target]),total:inner[target]}]};
  const r=createResourcePricer({},f.libs).reprice(rate),p=r.rate.components[0];
  assert.equal(r.ready,true);assert.equal(r.rate.total,expected);assert.equal(p.total,expected);
  assert.equal(calculateAssemblyDetailed(p.components,p.calculation).result.total,480);
 }
});

test('기계경비의 경비 비목 참조는 갱신한 손료만 계상한다',()=>{
 const f=fixture(),labor=leaf('노임',100);
 const machine={name:'장비',spec:'규격',unit:'hr',code:'E1',category:'장비',table:'MachTitleDat',source:'추가',library:'extra',labor:100,material:0,expense:1000,other:0,total:1100,calculation:{componentDigits:0,variables:'FX1 = 1'},components:[
  {name:'손료',spec:'',unit:'원',originalRecord:10,qtyExpression:'10000*FX1/10000000',...amounts('expense',1000000),sourceComponent:'expense',machineOwnership:{name:'손료',spec:'',coefficient:10000,currencyRatio:0,fxVariable:'FX1'}},
  {...labor,qtyExpression:'1'}
 ]};
 f.extra.items.push(machine,labor);f.extra.details=[['MachMainDat:E1',[{_record:10,Index:-3,Name:'손료',Unite:'원',GN:10000,TU:1000000,Ratio:0}]]];
 f.main.items=[{...machine,code:'E99',source:'10월',library:'main',components:undefined},{...leaf('노임',120),code:'L99',source:'10월',library:'main'}];
 f.main.details=[['MachMainDat:E99',[{_record:20,Index:-3,Name:'손료',Unite:'원',GN:99999,TU:2000000,Ratio:0}]]];
 const rate={...f.rate,components:[{...machine,sourceComponent:'expense',qtyExpression:'1',...amounts('expense',1000),total:1000}]};
 const r=createResourcePricer({},f.libs).reprice(rate),p=r.rate.components[0];
 assert.equal(r.ready,true);assert.equal(r.rate.total,2000);assert.equal(r.rate.expense,2000);assert.equal(r.rate.labor,0);
 assert.equal(calculateAssemblyDetailed(p.components,p.calculation).result.total,2120);
});

test('실제 보강토블록운반의 경비·노무비와 산출식·내역·자재근거 출력이 원본과 일치한다',async()=>{
 const name='2026-10-main.estx',lib=attachMachineBasis(await importEst(await fs.readFile(new URL('../seed/'+name,import.meta.url)),name,inflateRawSync));
 lib.isMain=true;lib.priceUpdateReference=true;
 const original=lib.items.find(r=>r.table==='CostTitleDat'&&r.code==='D0000001291'),raw=lib.details.find(([k])=>k==='CostMainDat:'+original.code)[1],before=JSON.stringify(original);
 const source=editableAssembly(original,raw,lib.items),result=createResourcePricer({},[lib]).reprice(original),rate=result.rate;
 assert.equal(source.conversionVerified,true);assert.equal(source.total,12983);assert.equal(result.ready,true);assert.equal(result.issues.length,0);
 assert.equal(rate.total,12983);assert.equal(rate.labor,1130);assert.equal(rate.expense,11853);assert.equal(rate.material,0);
 const freight=rate.components.find(p=>p.code==='M0000367443'),unloading=rate.components.find(p=>p.code==='M0001437042');
 assert.equal(freight.expense,189650);assert.equal(freight.priceReference.material,189650);assert.equal(freight.qtyExpression,'1/1.1/320*22');
 assert.equal(unloading.labor,2261.69);assert.equal(unloading.priceReference.material,2261.69);assert.equal(unloading.qtyExpression,'1/1.1*0.025*22');
 const calc=calculateAssemblyDetailed(rate.components,rate.calculation);
 assert.equal(calc.rows[0].amount.expense,11853.1);assert.equal(calc.rows[1].amount.labor,1130.8);assert.equal(JSON.stringify(original),before);
 const saved=JSON.parse(JSON.stringify(rate)),again=createResourcePricer({},[lib]).reprice(saved);
 assert.equal(again.rate.total,12983);assert.deepEqual(again.rate.components,rate.components);
 const project={schema:1,title:'비목 배분 검증',lines:[{id:'one',name:rate.name,spec:rate.spec,unit:rate.unit,qty:2,rate:saved,status:'confirmed',bucket:'direct'}],charges:[],mappings:{}};
 const bundle=makePrintDocuments(project,[lib]),doc=key=>bundle.documents.find(d=>d.key===key);
 assert.deepEqual(bundle.warnings,[]);assert.equal(bundle.totals.direct,25966);assert.equal(bundle.totals.labor,2260);assert.equal(bundle.totals.expense,23706);
 assert.deepEqual(doc('estimate').rows[0].cells.slice(5,13).map(c=>c.value),['12,983','25,966','1,130','2,260','','','11,853','23,706']);
 const formula=doc('formulas').rows,freightRow=formula.find(r=>r.originalRecord===55506),unloadingRow=formula.find(r=>r.originalRecord===55510);
 assert.match(freightRow.cells[0].value,/189,650.*11,853\.1/);assert.deepEqual(freightRow.cells.slice(1).map(c=>c.value),['11,853.1','','','11,853.1']);
 assert.match(unloadingRow.cells[0].value,/2,261\.69.*1,130\.8/);assert.deepEqual(unloadingRow.cells.slice(1).map(c=>c.value),['1,130.8','1,130.8','','']);
 const freightEvidence=doc('materials').rows.find(r=>r.cells[1].value==='구역화물'),unloadingEvidence=doc('materials').rows.find(r=>r.cells[1].value==='하차비');
 assert.equal(freightEvidence.cells[16].value,'189,650');assert.equal(freightEvidence.cells[11].value,'부189(06.1)');
 assert.equal(unloadingEvidence.cells[16].value,'2,261.69');assert.equal(unloadingEvidence.cells[9].value,'부215(06.1)');
 const offline=makePrintDocuments(project,[]);assert.equal(offline.totals.direct,25966);
 assert.equal(offline.documents.find(d=>d.key==='materials').rows.find(r=>r.cells[1].value==='구역화물').cells[16].value,'189,650');
});
