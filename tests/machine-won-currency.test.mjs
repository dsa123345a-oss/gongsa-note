import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {inflateRawSync} from 'node:zlib';
import {machineExchangeRate} from '../dist/machine-pricing.js';
import {createResourcePricer} from '../dist/resource-pricing.js';
import {editableAssembly,attachMachineBasis} from '../dist/est-edit.js';
import {importEst} from '../dist/est.js';

function fixture(){
 const machine={name:'화물자동차',spec:'1Ton',unit:'hr',code:'E-old',category:'장비',table:'MachTitleDat',source:'추가',library:'extra',labor:0,material:0,expense:1000,other:0,total:1000,machineBasis:[]};
 const row={_record:10,Index:-3,Name:'손료',Unite:'원',GN:10000,TU:1000000,TC:1000,NC:0,GC:0,JC:1000};
 const selected={...row,_record:20,TU:2000000,TC:2000,JC:2000};
 const main={id:'main',name:'10월',isMain:true,items:[{...machine,code:'E-new',source:'10월',library:'main',expense:2000,total:2000}],details:[['MachMainDat:E-new',[selected]]],tables:[{name:'MachGijunDat.dat',rows:[]}]};
 const extra={id:'extra',name:'추가',items:[machine],details:[['MachMainDat:E-old',[row]]]};
 return {machine,row,selected,main,extra,libs:[main,extra]};
}

test('환율번호가 생략된 명시 원화 단위만 환율 1로 해석한다',()=>{
 for(const Unite of ['\\','₩','￦','원','KRW'])assert.equal(machineExchangeRate({Unite},[{TC:999}]),1,Unite);
 for(const Unite of ['$','￥','€','','kg'])assert.equal(machineExchangeRate({Unite},[{TC:1}]),undefined,Unite);
 for(const Ratio of [null,'',999])assert.equal(machineExchangeRate({Unite:'원',Ratio},[{TC:1}]),undefined,String(Ratio));
 assert.equal(machineExchangeRate({Unite:'$',Ratio:36},[{Index:36,TC:1400}]),1400);
 assert.equal(machineExchangeRate({Unite:'원',Ratio:0},[]),1);
});

test('원화 손료 환율번호가 없어도 검증한 원래 계수로 월별 가격을 적용한다',()=>{
 const f=fixture(),before=JSON.stringify(f.libs),r=createResourcePricer({},f.libs).reprice(f.machine),p=r.rate.components[0];
 assert.equal(r.ready,true);assert.equal(r.rate.conversionVerified,true);assert.equal(r.rate.expense,2000);
 assert.equal(p.qtyExpression,'10000*FX1/10000000');assert.equal(p.machineOwnership.coefficient,10000);
 assert.equal(p.priceReference.exchangeRate,1);assert.equal(p.priceReference.code,'E-new');
 assert.equal(r.rate.calculation.variables,'FX1 = 1');assert.equal(JSON.stringify(f.libs),before);
 const again=createResourcePricer({},f.libs).reprice(JSON.parse(JSON.stringify(r.rate)));
 assert.equal(again.ready,true);assert.equal(again.rate.total,r.rate.total);assert.deepEqual(again.rate.components,r.rate.components);
});

test('명시 원화여도 원본 손료나 장비 합계가 재계산과 다르면 변환을 보류한다',()=>{
 for(const alter of [f=>f.row.JC++,f=>f.machine.expense++,f=>f.row.GN+=20]){
  const f=fixture();alter(f);const r=createResourcePricer({},f.libs).reprice(f.machine);
  assert.equal(r.ready,false,alter.toString());assert.equal(r.retainedWhole,true);
  assert.match(r.issues[0].reason,/재계산 결과가 원본과 달라/);
 }
});

test('원본 외화의 환율번호가 없으면 미지정 기초표 행으로 우회하지 않는다',()=>{
 for(const Unite of ['$','￥','€','']){
  const f=fixture();f.row.Unite=Unite;f.machine.machineBasis=[{TC:1}];
  const r=createResourcePricer({},f.libs).reprice(f.machine);
  assert.equal(r.ready,false,Unite);assert.equal(r.retainedWhole,true);assert.match(r.issues[0].reason,/환율 기준이 없습니다/);
 }
});

test('월별 외화·미상 환율과 명시했지만 찾지 못한 원화 환율번호는 계속 차단한다',()=>{
 for(const alter of [f=>f.selected.Unite='$',f=>f.selected.Unite='',f=>f.selected.Ratio=null,f=>f.selected.Ratio=999]){
  const f=fixture();alter(f);f.main.tables[0].rows=[{TC:1}];
  const r=createResourcePricer({},f.libs).reprice(f.machine);
  assert.equal(r.ready,false,alter.toString());assert.equal(r.rate.components[0].expense,1000000);
  assert.ok(r.issues.some(i=>/기준가격 또는 환율이 없습니다/.test(i.reason)));
 }
});

test('정상 외화 환율은 원래 계수에 계속 적용하고 환율 누락은 차단한다',()=>{
 const f=fixture();Object.assign(f.selected,{Unite:'$',Ratio:36,TU:3000});f.main.tables[0].rows=[{Index:36,TC:1400}];
 const r=createResourcePricer({},f.libs).reprice(f.machine);
 assert.equal(r.ready,true);assert.equal(r.rate.expense,4200);assert.equal(r.rate.calculation.variables,'FX1 = 1400');
 delete f.main.tables[0].rows[0].TC;
 assert.equal(createResourcePricer({},f.libs).reprice(f.machine).ready,false);
});

let seeds;
async function actualLibraries(){
 if(!seeds)seeds=(async()=>{
  const libs=[];
  for(const [name,role] of [['2026-10-main.estx','resource'],['상수도공사메인(26년)소형감압변 수정.ebkx','assembly']]){
   const lib=attachMachineBasis(await importEst(await fs.readFile(new URL('../seed/'+name,import.meta.url)),name,inflateRawSync));
   lib.bundledDefault=role;if(role==='resource')lib.priceUpdateReference=true;libs.push(lib);
  }
  return libs;
 })();
 return seeds;
}

test('실제 월별·추가 화물자동차 1Ton의 원화 손료를 원본 대조 후 갱신한다',async()=>{
 const libs=await actualLibraries();
 for(const [index,code,oldTotal] of [[0,'E0000000950',61618],[1,'E0000000027',60116]]){
  const lib=libs[index],m=lib.items.find(i=>i.table==='MachTitleDat'&&i.code===code),rows=lib.details.find(([k])=>k==='MachMainDat:'+code)[1],before=JSON.stringify(m);
  const source=editableAssembly(m,rows,lib.items);
  assert.equal(source.conversionVerified,true);assert.equal(source.total,oldTotal);assert.equal(source.expense,1665);
  const r=createResourcePricer({},libs).reprice(m),p=r.rate.components.find(p=>p.machineOwnership);
  assert.equal(r.ready,true);assert.equal(r.issues.length,0);assert.equal(r.rate.total,61618);
  assert.equal(r.rate.expense,1665);assert.equal(r.rate.labor,50008);assert.equal(r.rate.material,9945);
  assert.equal(p.expense,10763000);assert.equal(p.qtyExpression,'1547*FX1/10000000');assert.equal(p.priceReference.exchangeRate,1);
  assert.equal(p.priceReference.code,'E0000000950');assert.equal(JSON.stringify(m),before);
 }
});

test('실제 현장점검비에 포함된 화물자동차도 같은 손료와 원래 수량으로 재계산한다',async()=>{
 const libs=await actualLibraries(),m=libs[1].items.find(i=>i.table==='HeadTitleDat'&&i.code==='U0000000391'),before=JSON.stringify(m);
 const r=createResourcePricer({},libs).reprice(m),truck=r.rate.components.find(p=>p.code==='E0000000027'),ownership=truck.components.find(p=>p.machineOwnership);
 assert.equal(r.ready,true);assert.equal(r.issues.length,0);assert.equal(r.rate.total,55715);
 assert.equal(r.rate.labor,49911);assert.equal(r.rate.material,4972);assert.equal(r.rate.expense,832);
 assert.equal(truck.qtyExpression,'0.5');assert.equal(truck.total,61618);assert.equal(ownership.priceReference.exchangeRate,1);
 assert.equal(m.total,53872);assert.equal(JSON.stringify(m),before);
});
