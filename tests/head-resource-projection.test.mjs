import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {inflateRawSync} from 'node:zlib';
import {editableAssembly,attachMachineBasis} from '../dist/est-edit.js';
import {createResourcePricer} from '../dist/resource-pricing.js';
import {calculateAssemblyDetailed,costKeys} from '../dist/estimate-core.js';
import {importEst} from '../dist/est.js';
import {makePrintDocuments} from '../dist/est-print.js';

const amounts=(key,value)=>Object.fromEntries(costKeys.map(k=>[k,k===key?value:0]));
function fixture(category='자재',target='expense'){
 const labor=category==='노임',source={name:labor?'직종':'운반비',spec:'규격 1.5',unit:labor?'인':'회',code:labor?'L1':'M1',category,table:labor?'LaborcDat':'StuffcDat',source:'원본',library:'source',...amounts(labor?'labor':'material',100),total:100};
 const rate={name:'원본 비목 지정',code:'U1',spec:'',unit:'개',category:'일위대가',table:'HeadTitleDat',source:'원본',library:'source',...amounts(target,200),total:200};
 const row={_record:12,Code:source.code,Name:source.name,Size:source.spec,Unite:source.unit,GN:2,TU:100,TC:200,NU:0,NC:0,GU:0,GC:0,JU:0,JC:0,LinkIndex:labor?6:5,SCheck:{material:1,labor:2,expense:3}[target]};
 row[{material:'GU',labor:'NU',expense:'JU'}[target]]=100;row[{material:'GC',labor:'NC',expense:'JC'}[target]]=200;
 const details=[{_record:11,TitleCode:'U1',Name:rate.name},row],extra={id:'source',name:'원본',items:[source,rate],details:[['HeadMainDat:U1',details]]};
 const selected={...source,code:labor?'L99':'M99',source:'월별',library:'main',...amounts(labor?'labor':'material',120),total:120},main={id:'main',name:'월별',isMain:true,items:[selected]};
 return {source,rate,row,details,extra,selected,libs:[main,extra],target};
}

test('일위대가의 명시 SCheck는 단일 노임·자재 총단가를 원본 비목에 배분한다',()=>{
 for(const category of ['노임','자재'])for(const target of ['material','labor','expense']){
  const f=fixture(category,target),before=JSON.stringify(f),editable=editableAssembly(f.rate,f.details,f.extra.items);
  assert.equal(editable.conversionVerified,true);assert.equal(editable.components[0].sourceComponent,target);assert.equal(editable[target],200);
  const result=createResourcePricer({},f.libs).reprice(f.rate),part=result.rate.components[0];
  assert.equal(result.ready,true);assert.equal(result.rate[target],240);assert.equal(part[target],120);assert.equal(part.qtyExpression,'2');
  for(const k of costKeys)if(k!==target)assert.equal(part[k],0);
  assert.equal(part.priceReference.total,120);assert.equal(JSON.stringify(f),before);
 }
});

test('저장된 원본·이전 자동 적용 스냅샷은 비목 표지만 복원하고 읽기 중 금액은 바꾸지 않는다',()=>{
 const f=fixture(),original=editableAssembly(f.rate,f.details,f.extra.items);delete original.components[0].sourceComponent;
 const originalAgain=editableAssembly(JSON.parse(JSON.stringify(original)),f.details,f.extra.items);
 assert.equal(originalAgain.components[0].sourceComponent,'expense');assert.equal(originalAgain.components[0].expense,100);
 const saved=structuredClone(original);Object.assign(saved.components[0],amounts('material',120),{priceReference:structuredClone(f.selected),total:120});Object.assign(saved,calculateAssemblyDetailed(saved.components,saved.calculation).result);
 const before=JSON.stringify(saved),read=editableAssembly(saved,f.details,f.extra.items);
 assert.equal(read.components[0].sourceComponent,'expense');assert.equal(read.components[0].material,120);assert.equal(read.components[0].expense,0);assert.equal(read.material,240);assert.equal(read.expense,0);assert.equal(JSON.stringify(saved),before);
 const repriced=createResourcePricer({},f.libs).reprice(saved);
 assert.equal(repriced.ready,true);assert.equal(repriced.rate.material,0);assert.equal(repriced.rate.expense,240);assert.equal(repriced.rate.total,240);
 const repeated=createResourcePricer({},f.libs).reprice(JSON.parse(JSON.stringify(repriced.rate)));
 assert.deepEqual(repeated.rate.components,repriced.rate.components);
});

test('원본 행·단일 자원·가격 이력이 확인되지 않거나 수동 비목이면 배분을 만들거나 변경하지 않는다',()=>{
 for(const alter of [
  f=>delete f.row.SCheck,
  f=>f.row.SCheck=1,
  f=>f.source.spec='규격 15',
  f=>f.source.name='다른 운반비',
  f=>f.extra.items.push({...f.source}),
  f=>f.source.table='MachTitleDat',
  f=>Object.assign(f.row,{GU:10,JU:90,GC:20,JC:180}),
  f=>f.part.originalRecord=99,
  f=>delete f.part.originalRecord,
  f=>f.part.spec='다른 규격',
  f=>f.part.calculationMode='horizontal',
  f=>Object.assign(f.part,amounts('material',77)),
  f=>{Object.assign(f.part,amounts('material',77));f.part.priceReference=f.selected;},
 ]){
  const f=fixture(),saved=editableAssembly(f.rate,f.details,f.extra.items);f.part=saved.components[0];delete f.part.sourceComponent;alter(f);
  const before=JSON.stringify(saved),result=editableAssembly(saved,f.details,f.extra.items);
  assert.equal(result.components[0].sourceComponent,undefined,alter.toString());assert.equal(JSON.stringify(saved),before);assert.deepEqual(result.components[0],saved.components[0]);
 }
 const f=fixture(),saved=editableAssembly(f.rate,f.details,f.extra.items);saved.components[0].sourceComponent='material';
 assert.equal(editableAssembly(saved,f.details,f.extra.items).components[0].sourceComponent,'material');
});

test('실제 QMR 9개는 폐기물 운반비 경비와 총액·저장·인쇄 비목을 유지한다',async()=>{
 const name='2026-10-main.estx',lib=attachMachineBasis(await importEst(await fs.readFile(new URL('../seed/'+name,import.meta.url)),name,inflateRawSync));lib.isMain=true;lib.priceUpdateReference=true;
 const rates=lib.items.filter(r=>r.table==='HeadTitleDat'&&[2037,2039,2040,2041,2042,2043,2044,2045,2046].some(n=>r.code==='U'+String(n).padStart(10,'0'))),pricer=createResourcePricer({},[lib]);
 assert.equal(rates.length,9);
 for(const original of rates){
  const before=JSON.stringify(original),result=pricer.reprice(original),rate=result.rate,part=rate.components.find(p=>p.code==='M0005340130');
  assert.equal(result.ready,true,original.code);for(const k of [...costKeys,'total'])assert.equal(rate[k],original[k],original.code+':'+k);
  assert.equal(part.sourceComponent,'expense');assert.equal(part.expense,23590);assert.equal(part.material,0);assert.equal(part.priceReference.material,23590);assert.equal(JSON.stringify(original),before);
  const saved=JSON.parse(JSON.stringify(rate)),again=createResourcePricer({},[lib]).reprice(saved);assert.deepEqual(again.rate.components,rate.components);
  const legacy=structuredClone(saved),legacyPart=legacy.components.find(p=>p.code==='M0005340130');delete legacyPart.sourceComponent;Object.assign(legacyPart,amounts('material',23590));Object.assign(legacy,calculateAssemblyDetailed(legacy.components,legacy.calculation).result);
  const legacyBefore=JSON.stringify(legacy),raw=lib.details.find(([k])=>k==='HeadMainDat:'+original.code)[1],read=editableAssembly(legacy,raw,lib.items);
  for(const k of [...costKeys,'total'])assert.equal(read[k],legacy[k]);assert.equal(read.components.find(p=>p.code==='M0005340130').material,23590);assert.equal(JSON.stringify(legacy),legacyBefore);
  const repaired=createResourcePricer({},[lib]).reprice(legacy);for(const k of [...costKeys,'total'])assert.equal(repaired.rate[k],original[k]);
 }
 const original=rates.find(r=>r.code==='U0000002039'),rate=pricer.reprice(original).rate,project={schema:1,title:'QMR 경비 비목 검증',lines:[{id:'qmr',name:rate.name,spec:rate.spec,unit:rate.unit,qty:1,rate,status:'confirmed',bucket:'direct'}],charges:[],mappings:{}};
 const before=JSON.stringify(project),bundle=makePrintDocuments(project,[lib]),estimate=bundle.documents.find(d=>d.key==='estimate');
 assert.deepEqual(bundle.warnings,[]);assert.equal(bundle.totals.direct,771469);assert.equal(bundle.totals.material,121616);assert.equal(bundle.totals.expense,30246);
 assert.deepEqual(estimate.rows[0].cells.slice(5,13).map(c=>c.value),['771,469','771,469','619,607','619,607','121,616','121,616','30,246','30,246']);
 const units=bundle.documents.find(d=>d.key==='units'),transport=units.rows.find(r=>r.cells[1]?.value==='폐기물운반비(상차포함)');
 assert.ok(transport);assert.equal(transport.cells[9].value,'');assert.equal(transport.cells[10].value,'');assert.equal(transport.cells[11].value,'23,590');assert.equal(transport.cells[12].value,'2,121.4');
 assert.equal(JSON.stringify(project),before);
 const evidence=bundle.documents.find(d=>d.key==='materials').rows.find(r=>r.cells[1].value==='폐기물운반비(상차포함)');assert.equal(evidence.cells[16].value,'23,590');
 const legacyProject=structuredClone(project),legacyRate=legacyProject.lines[0].rate,legacyPart=legacyRate.components.find(p=>p.code==='M0005340130');delete legacyPart.sourceComponent;Object.assign(legacyPart,amounts('material',23590));Object.assign(legacyRate,calculateAssemblyDetailed(legacyRate.components,legacyRate.calculation).result);
 const legacyBefore=JSON.stringify(legacyProject),legacyPrint=makePrintDocuments(legacyProject,[lib]);
 assert.equal(legacyPrint.totals.direct,legacyRate.total);assert.equal(legacyPrint.totals.material,legacyRate.material);assert.equal(legacyPrint.totals.expense,legacyRate.expense);assert.equal(JSON.stringify(legacyProject),legacyBefore);
});
