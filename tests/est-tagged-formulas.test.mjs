import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {inflateRawSync} from 'node:zlib';
import {importEst} from '../dist/est.js';
import {editableAssembly,attachMachineBasis} from '../dist/est-edit.js';
import {createResourcePricer} from '../dist/resource-pricing.js';
import {calculateAssemblyDetailed} from '../dist/estimate-core.js';
import {buildPriceEvidence} from '../dist/price-evidence-workbook.js';

let data;
const seeds=()=>data??=(async()=>{
 const libs=[];
 for(const [name,role] of [['2026-10-main.estx','resource'],['상수도공사메인(26년)소형감압변 수정.ebkx','assembly']]){
  const lib=attachMachineBasis(await importEst(await fs.readFile(new URL('../seed/'+name,import.meta.url)),name,inflateRawSync));
  lib.bundledDefault=role;if(role==='resource')lib.priceUpdateReference=true;libs.push(lib);
 }
 return libs;
})();
const code=n=>'D'+String(n).padStart(10,'0'),pick=(lib,c)=>lib.items.find(r=>r.code===c&&['CostTitleDat','HeadTitleDat'].includes(r.table));
const raw=(lib,c)=>lib.details.find(([k])=>k===(c[0]==='D'?'CostMainDat:':'HeadMainDat:')+c)[1];
const money=r=>['labor','material','expense','other','total'].map(k=>r[k]||0);
const monthly=[
 [27,14517,1191,1203,0,16911],[28,18105,1489,1502,0,21096],[29,22629,1861,1877,0,26367],
 [30,28110,2311,2332,0,32753],[31,34446,2830,2857,0,40133],[32,40793,3351,3383,0,47527],
 [33,9637,0,504,0,10141],[34,12004,0,628,0,12632],[35,15004,0,785,0,15789],
 [36,18640,0,976,0,19616],[37,22853,0,1196,0,24049],[38,27066,0,1417,0,28483],
 [40,2287,90,0,0,2377],[43,7995,159,0,0,8154],[62,20750,0,0,0,20750],
 [65,8250,0,0,0,8250],[70,9348,260,97,0,9705],[25,8104,0,10755,0,18859],
 ['U0000000390',8104,0,10755,0,18859]
];

test('추가 DB 19개 원문을 비목별로 복원하고 명시계수의 독립 월별 기대값과 일치한다',async()=>{
 const libs=await seeds(),pricer=createResourcePricer({},libs);
 for(const [id,...expected] of monthly){
  const c=typeof id==='number'?code(id):id,item=pick(libs[1],c),before=JSON.stringify(item),edit=editableAssembly(item,raw(libs[1],c),libs[1].items);
  assert.equal(edit.conversionVerified,true,c);assert.deepEqual(money(calculateAssemblyDetailed(edit.components,edit.calculation).result),money(item),c+' source');
  const priced=pricer.reprice(item);assert.equal(priced.ready,true,c);assert.deepEqual(money(priced.rate),expected,c+' monthly');
  const saved=JSON.parse(JSON.stringify(priced.rate)),again=pricer.reprice(saved);assert.equal(again.ready,true,c+' saved');assert.deepEqual(money(again.rate),expected,c+' saved');
  assert.equal(JSON.stringify(item),before,c+' immutable');
 }
});

test('명시 SUM 소계는 한 번만 합산하며 노동비 변경이 A와 잡비로 전파된다',async()=>{
 const libs=await seeds(),item=pick(libs[1],code(27)),rate=editableAssembly(item,raw(libs[1],item.code),libs[1].items);
 const labor=rate.components.find(p=>p.originalRecord===13);labor.labor=180000;
 const calc=calculateAssemblyDetailed(rate.components,rate.calculation),a=calc.rows.find(p=>p.kind==='subtotal'&&p.sumTag==='A'),fee=calc.rows.find(p=>p.basisTag==='A'),fixed=calc.rows.find(p=>p.fixedPrice);
 assert.equal(calc.rows.find(p=>p.originalRecord===13).amount.labor,3006);assert.ok(Math.abs(a.amount.labor-14305.9)<1e-8);assert.equal(fee.amount.expense,715.2);
 assert.equal(fixed.expense,171);assert.equal(fixed.amount.expense,22.7);assert.equal(calc.result.labor,14305);assert.equal(calc.result.expense,1182);
});

test('별산 재료의 단가만 참조하고 A→B→50%와 상하차료 소계를 동적으로 계산한다',async()=>{
 const libs=await seeds();
 for(const [id,price,expected] of [[62,500000,25000],[65,200000,15000]]){
  const item=pick(libs[1],code(id)),rate=editableAssembly(item,raw(libs[1],item.code),libs[1].items),material=rate.components.find(p=>p.sumTag==='A');material.material=price;
  const calc=calculateAssemblyDetailed(rate.components,rate.calculation);assert.equal(calc.result.labor,expected);assert.equal(calc.result.material,0);
  if(id===65){assert.equal(calc.rows.find(p=>p.sumTag==='B').amount.labor,10000);assert.equal(calc.rows.find(p=>p.basisTag==='B').amount.labor,5000);}
 }
 const item=pick(libs[1],code(25)),rate=editableAssembly(item,raw(libs[1],item.code),libs[1].items);
 for(const [record,price] of [[2371,3000],[2373,4000],[2379,80000]]){const p=rate.components.find(p=>p.originalRecord===record);p[p.sourceComponent]=price;}
 const calc=calculateAssemblyDetailed(rate.components,rate.calculation);assert.equal(calc.result.expense,13500);assert.equal(calc.result.material,0);
});

test('장비 SCheck 0 참고 노무는 출력용으로 보존하고 합계에서 제외한다',async()=>{
 const libs=await seeds(),item=pick(libs[1],code(70)),rate=editableAssembly(item,raw(libs[1],item.code),libs[1].items),reference=rate.components.find(p=>p.originalRecord===2278);
 assert.equal(reference.calculationMode,'vertical');reference.labor=1000000;
 const calc=calculateAssemblyDetailed(rate.components,rate.calculation);assert.ok(calc.rows.find(p=>p.originalRecord===2278).amount.labor>100000);assert.deepEqual(money(calc.result),money(item));
});

test('명시 소비 색인은 소계와 연결하고 기존 SUM 그룹 및 빈 소비 색인은 그대로 합산한다',()=>{
 const p=[{name:'labor',qty:1,labor:100,sumTag:'group'},{name:'labor2',qty:1,labor:200,sumTag:'group'},
  {name:'subtotal',kind:'subtotal',basis:'labor',target:'labor',sumTag:'A'},
  {name:'fee',kind:'percent',scope:'tag',basisTag:'A',basis:'total',target:'expense',percent:5,sumTag:'B'},
  {name:'chain',kind:'percent',scope:'tag',basisTag:'B',basis:'total',target:'expense',percent:50}];
 const calc=calculateAssemblyDetailed(p,{componentDigits:1});assert.equal(calc.result.labor,300);assert.equal(calc.result.expense,22);
 const legacy=calculateAssemblyDetailed([...p.slice(0,2),{kind:'percent',scope:'tag',sumTag:'group',basisTag:'',basis:'total',target:'expense',percent:10}]);assert.equal(legacy.result.expense,30);
 assert.throws(()=>calculateAssemblyDetailed([...p,{kind:'percent',scope:'tag',basisTag:'missing',basis:'total',target:'expense',percent:1}]),/색인/);
 assert.throws(()=>calculateAssemblyDetailed([...p.slice(0,2),{kind:'percent',scope:'tag',basisTag:'group',basis:'total',target:'expense',percent:1}]),/하나/);
 const rate={name:'tags',code:'DTEST',category:'단가산출',components:p,calculation:{componentDigits:1},...calc.result};
 const book=buildPriceEvidence({schema:1,title:'태그',lines:[{id:'one',name:'tags',qty:1,rate,status:'confirmed'}],charges:[]});
 const sheet=book.sheets[0],sub=sheet.rows.findIndex(r=>r.values[2]==='subtotal')+1,fee=sheet.rows.findIndex(r=>r.values[2]==='fee')+1;
 assert.equal(sheet.rows[fee-1].values[8].formula,`SUM(O${sub})`);
 assert.equal(sheet.rows.find(r=>r.values[2]==='chain').values[8].formula,`SUM(O${fee})`);
 const total=sheet.rows.find(r=>r.values[2]==='산출 단가 / 기준 수량');assert.ok(!total.values[10].formula.includes('K'+sub+','));
});

test('원문 색인·소계·단가만 있는 근거가 모순되면 수량을 추측하지 않고 보류한다',async()=>{
 const libs=await seeds();
 for(const [id,record,alter] of [
  [27,39,r=>r.LineData=r.LineData.replace('2,835.7','2,835.8')],
  [27,46,r=>r.LineData=r.LineData.replace('\x07A\x07','\x07Z\x07')],
  [27,21,r=>r.LineData=r.LineData.replace('0.1333','미정')],
  [65,2143,r=>r.LineData=r.LineData.replace('\x06B\x06','\x06A\x06')],
  [62,2086,r=>r.GC=415000],
  [25,2375,r=>r.LineData=r.LineData.replace('2,377.5','2,378.5')]
 ]){
  const item=pick(libs[1],code(id)),rows=structuredClone(raw(libs[1],item.code));alter(rows.find(r=>r._record===record));
  assert.throws(()=>editableAssembly(item,rows,libs[1].items),item.code+' '+record);
 }
});
