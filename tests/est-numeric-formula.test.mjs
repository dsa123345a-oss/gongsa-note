import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {inflateRawSync} from 'node:zlib';
import {normalizeEstNumericExpression as normalize,parseEstPercentFactor} from '../dist/est-numeric-formula.js';
import {evaluateFormula} from '../dist/formula.js';
import {editableAssembly,attachMachineBasis} from '../dist/est-edit.js';
import {importEst} from '../dist/est.js';
import {createResourcePricer} from '../dist/resource-pricing.js';
import {calculateAssemblyDetailed} from '../dist/estimate-core.js';
import {makePrintDocuments} from '../dist/est-print.js';
import {buildPriceEvidence} from '../dist/price-evidence-workbook.js';

test('숫자 단위와 백분율은 원문 연산 순서를 유지하여 정규화한다',()=>{
 for(const [input,value] of [['1,500 × 1m × 6%',90],['1 × 0.01인/m',0.01],['1 × 2인 ÷ 8 ÷ 5.4',2/8/5.4],['2인/개 × 3',6],['3㎥/시간 ÷ 2',1.5],['2㎡ × 3',6],['2ℓ × 3',6],['1시간당 × 2',2],['1 × .5％',0.005]]){
  assert.ok(Math.abs(evaluateFormula(normalize(input))-value)<1e-12,input);
 }
 assert.equal(normalize('Q1인/m × 2'),'Q1*2');assert.equal(evaluateFormula(normalize('Q1인/m × 2'),{Q1:3}),6);
 assert.equal(normalize('1 × 6%'),'1*(6/100)');assert.equal(normalize('min(1,2)'),'min(1,2)');
});

test('잡비율은 명시한 두 인자 곱에서만 읽으며 결과나 금액 비율로 역산하지 않는다',()=>{
 for(const expression of ['\f7,861.2\f × 0.02 = \x12157.2\x12','7,861.2 × 2% = 157.2','7,861.2 × .02','7,861.2 × 2％ ＝ 157.2'])assert.equal(parseEstPercentFactor(expression),2,expression);
 assert.equal(parseEstPercentFactor('1,500 × 6%'),6);assert.equal(parseEstPercentFactor('100 × 0'),0);
 for(const expression of ['7861.2 = 157.2','7861.2 × 비율 = 157.2','7861.2 × 0.02 + 10 = 167.2','7861.2 / 50 = 157.2','7861.2 × 2인','7861.2 × 2%%','7861.2 × -0.02','7,86.12 × 2%','7861.2 × (1+1)%'])assert.equal(parseEstPercentFactor(expression),null,expression);
});

test('단위를 지운다는 이유로 미지원 변수·잘못된 숫자·복합 연산을 숫자식으로 만들지 않는다',()=>{
 for(const expression of ['1 2','12,34','1m20','1 × unknown','1 × admin','1 × 2일당금액','1 × 6%%','1 × 2**3']){
  const normalized=normalize(expression);
  if(/^[\d.+*/()\-]+$/.test(normalized))assert.throws(()=>evaluateFormula(normalized),expression);
  else assert.ok(!/^[\d.+*/()\-]+$/.test(normalized),expression);
 }
 assert.throws(()=>evaluateFormula(normalize('1 ÷ 0')));
});

let seedPromise;
async function seeds(){
 if(!seedPromise)seedPromise=(async()=>{
  const libs=[];
  for(const [name,role] of [['2026-10-main.estx','resource'],['상수도공사메인(26년)소형감압변 수정.ebkx','assembly']]){
   const lib=attachMachineBasis(await importEst(await fs.readFile(new URL('../seed/'+name,import.meta.url)),name,inflateRawSync));
   lib.bundledDefault=role;if(role==='resource')lib.priceUpdateReference=true;libs.push(lib);
  }
  return libs;
 })();
 return seedPromise;
}
const pick=(lib,code)=>lib.items.find(r=>r.table==='CostTitleDat'&&r.code===code);
const details=(lib,code)=>lib.details.find(([k])=>k==='CostMainDat:'+code)[1];

test('실제 윙카등은 1m와 6% 원식을 보존하고 원본 품·월별 상승분을 재계산한다',async()=>{
 const libs=await seeds(),item=pick(libs[1],'D0000000040'),before=JSON.stringify(item),source=editableAssembly(item,details(libs[1],item.code),libs[1].items);
 assert.equal(source.conversionVerified,true);assert.equal(source.total,2305);assert.equal(source.labor,2215);assert.equal(source.material,90);
 assert.equal(source.components[0].qtyExpression,'1*1*(6/100)');assert.equal(source.components[1].qtyExpression,'1*0.01');
 const priced=createResourcePricer({},libs).reprice(item);
 assert.equal(priced.ready,true);assert.equal(priced.rate.total,2377);assert.equal(priced.rate.labor,2287);assert.equal(priced.rate.material,90);
 assert.equal(priced.rate.components[0].priceReference.code,'M0005323691');assert.equal(priced.rate.components[1].labor,228717);
 const adjusted=structuredClone(libs),wing=adjusted[0].items.find(r=>r.code==='M0005323691'&&r.table==='StuffcDat');wing.material=2000;wing.total=2000;
 const higher=createResourcePricer({},adjusted).reprice(pick(adjusted[1],item.code));
 assert.equal(higher.ready,true);assert.equal(higher.rate.material,120);assert.equal(higher.rate.total,2407);assert.equal(higher.rate.components[0].qtyExpression,'1*1*(6/100)');
 assert.equal(JSON.stringify(item),before);
});

test('실제 용수운반은 노무행의 0.02 기구손료를 월별 노임에 연동하고 출력한다',async()=>{
 const libs=await seeds(),item=pick(libs[1],'D0000000043'),before=JSON.stringify(item),source=editableAssembly(item,details(libs[1],item.code),libs[1].items);
 assert.equal(source.conversionVerified,true);assert.equal(source.total,8018);assert.equal(source.labor,7861);assert.equal(source.material,157);
 const fee=source.components.find(p=>p.originalRecord===1696);assert.equal(fee.kind,'percent');assert.equal(fee.percent,2);assert.equal(fee.basis,'labor');assert.equal(fee.target,'material');
 const priced=createResourcePricer({},libs).reprice(item),rate=priced.rate,calc=calculateAssemblyDetailed(rate.components,rate.calculation);
 assert.equal(priced.ready,true);assert.equal(rate.total,8154);assert.equal(rate.labor,7995);assert.equal(rate.material,159);
 assert.equal(calc.rows.find(p=>p.originalRecord===1692).amount.labor,7995.2);assert.equal(calc.rows.find(p=>p.originalRecord===1696).amount.material,159.9);
 const adjusted=structuredClone(libs),labor=adjusted[0].items.find(r=>r.code===rate.components.find(p=>p.originalRecord===1692).priceReference.code&&r.table==='LaborcDat');labor.labor=220000;labor.total=220000;
 const higher=createResourcePricer({},adjusted).reprice(pick(adjusted[1],item.code));
 assert.equal(higher.ready,true);assert.equal(higher.rate.labor,10185);assert.equal(higher.rate.material,203);assert.equal(higher.rate.total,10388);
 labor.labor=216000;labor.total=216000;
 const boundary=createResourcePricer({},adjusted).reprice(pick(adjusted[1],item.code));
 assert.equal(boundary.ready,true);assert.equal(boundary.rate.labor,10000);assert.equal(boundary.rate.material,200);assert.equal(boundary.rate.total,10200);
 const boundaryProject={schema:1,title:'정수 경계 검증',lines:[{id:'boundary',name:item.name,spec:item.spec,unit:item.unit,qty:1,rate:boundary.rate,status:'confirmed',bucket:'direct'}],charges:[],mappings:{}};
 assert.equal(makePrintDocuments(boundaryProject,adjusted).totals.direct,10200);
 const boundarySheets=buildPriceEvidence(boundaryProject,adjusted).sheets,boundaryRow=boundarySheets.flatMap(s=>s.rows).find(r=>r.values[3]==='1*2/8/5.4');
 assert.equal(boundaryRow.values[5].formula,'1*2/8/5.4');assert.equal(boundaryRow.values[10].value,10000);
 const saved=JSON.parse(JSON.stringify(rate)),again=createResourcePricer({},libs).reprice(saved);assert.equal(again.ready,true);assert.equal(again.rate.total,8154);
 const project={schema:1,title:'용수운반 검증',lines:[{id:'one',name:item.name,spec:item.spec,unit:item.unit,qty:1,rate:saved,status:'confirmed',bucket:'direct'}],charges:[],mappings:{}};
 const bundle=makePrintDocuments(project,libs),formulas=bundle.documents.find(d=>d.key==='formulas'),printedFee=formulas.rows.find(r=>r.originalRecord===1696);
 assert.equal(bundle.totals.direct,8154);assert.ok(printedFee);assert.match(printedFee.cells[0].value,/159\.9/);assert.equal(JSON.stringify(item),before);
});

test('실제 산식의 비율·단위·저장 금액을 설명할 수 없으면 수량을 역산하지 않고 보류한다',async()=>{
 const libs=await seeds();
 for(const [code,record,alter] of [
  ['D0000000040',595,r=>r.LineData=r.LineData.replace('6%','6%%')],
  ['D0000000040',595,r=>r.LineData=r.LineData.replace('1m','1미지원단위')],
  ['D0000000040',595,r=>r.LineData=r.LineData.replace('\x1290\x12','\x1291\x12')],
  ['D0000000043',1696,r=>r.LineData=r.LineData.replace('× 0.02','+ 157.2')],
  ['D0000000043',1696,r=>r.LineData=r.LineData.replace('× 0.02','× 미정')],
 ]){
  const raw=structuredClone(details(libs[1],code));alter(raw.find(r=>r._record===record));
  assert.throws(()=>editableAssembly(pick(libs[1],code),raw,libs[1].items),code+' '+alter.toString());
 }
});
