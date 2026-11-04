import test from 'node:test';
import assert from 'node:assert/strict';
import {createResourcePricer} from '../dist/resource-pricing.js';

function fixture(){
 const machine={code:'E-old',name:'굴삭기',spec:'0.2㎥',unit:'hr',category:'장비',table:'MachTitleDat',source:'추가',library:'extra',labor:100,material:0,expense:1000,other:0,total:1100,calculation:{variables:'FX1 = 1',componentDigits:0},components:[
  {name:'손 료',spec:'',unit:'원',originalRecord:10,qtyExpression:'10000*FX1/10000000',labor:0,material:0,expense:1000000,other:0,sourceComponent:'expense',machineOwnership:{name:'손 료',spec:'',coefficient:10000,currencyRatio:0,fxVariable:'FX1'}},
  {name:'운전사',spec:'',unit:'인',code:'L-old',qtyExpression:'1',labor:100,material:0,expense:0,other:0}
 ]};
 const main={id:'main',name:'10월',isMain:true,items:[{...machine,code:'E-new',source:'10월',library:'main',components:undefined,total:999999},{name:'운전사',spec:'',unit:'인',code:'L-new',category:'노임',table:'LaborcDat',labor:120,material:0,expense:0,other:0,total:120}],details:[['MachMainDat:E-new',[{_record:80,Index:-3,Name:'손료',Size:'',Unite:'원',GN:99999,TU:2000000,Ratio:0}]]],tables:[{name:'MachGijunDat.dat',rows:[]}]};
 const extra={id:'extra',name:'추가',items:[machine],details:[['MachMainDat:E-old',[{_record:10,Index:-3,Name:'손 료',Size:'',Unite:'원',GN:10000,TU:1000000,Ratio:0}]]]};
 return {machine,main,libs:[main,extra]};
}
test('장비 완성 단가나 계수 대신 새 기준가격으로 원래 산식을 다시 계산',()=>{
 const {machine,libs}=fixture(),before=JSON.stringify(libs),result=createResourcePricer({},libs).reprice(machine);
 assert.equal(result.ready,true);assert.equal(result.rate.total,2120);assert.equal(result.rate.expense,2000);assert.equal(result.rate.labor,120);
 assert.equal(result.rate.components[0].qtyExpression,'10000*FX1/10000000');assert.equal(result.rate.components[0].expense,2000000);
 assert.equal(result.rate.components[0].priceReference.code,'E-new');assert.equal(JSON.stringify(libs),before);
 const again=createResourcePricer({},libs).reprice(result.rate);assert.equal(again.rate.total,2120);
});
test('외화 장비는 기준 DB 환율을 적용하되 손료계수를 유지',()=>{
 const {machine,libs,main}=fixture(),row=main.details[0][1][0];Object.assign(row,{TU:3000,Ratio:36,Unite:'$'});main.tables[0].rows=[{Index:36,TC:1400}];
 const result=createResourcePricer({},libs).reprice(machine);assert.equal(result.ready,true);assert.equal(result.rate.expense,4200);assert.equal(result.rate.total,4320);
 assert.equal(result.rate.calculation.variables,'FX1 = 1400');assert.equal(result.rate.components[0].qtyExpression,machine.components[0].qtyExpression);
 delete main.tables[0].rows[0].TC;assert.equal(createResourcePricer({},libs).reprice(machine).ready,false);
});
test('장비가 없거나 규격이 다르면 오래된 장비 가격을 확정하지 않는다',()=>{
 const {machine,libs,main}=fixture();main.items[0].spec='0.4㎥';const result=createResourcePricer({},libs).reprice(machine);
 assert.equal(result.ready,false);assert.ok(result.issues.some(i=>i.resource?.category==='장비'));
});
test('과거 저장한 구성에도 원본 행 근거로 장비 기준가격을 갱신',()=>{
 const {machine,libs}=fixture();delete machine.components[0].machineOwnership;
 const result=createResourcePricer({},libs).reprice(machine);assert.equal(result.ready,true);assert.equal(result.rate.total,2120);
 libs[1].details=[];assert.equal(createResourcePricer({},libs).reprice(machine).ready,false);
});
test('복합 장비 손료는 원본 행 이름으로 각각 연결하고 대상 행 순서에 의존하지 않는다',()=>{
 const {machine,libs,main}=fixture(),extra=structuredClone(machine.components[0]);
 extra.name='브레이커 손료';extra.qtyExpression='20000*FX2/10000000';extra.expense=500000;extra.originalRecord=11;extra.machineOwnership={name:extra.name,spec:'',coefficient:20000,fxVariable:'FX2'};
 machine.components.push(extra);machine.calculation.variables+='\nFX2 = 1';
 main.details[0][1].unshift({_record:79,Index:-3,Name:extra.name,Size:'',Unite:'원',GN:80000,TU:800000,Ratio:0});
 const result=createResourcePricer({},libs).reprice(machine);assert.equal(result.ready,true);assert.equal(result.rate.expense,3600);assert.equal(result.rate.total,3720);
 main.details[0][1][0].Name='다른 손료';assert.equal(createResourcePricer({},libs).reprice(machine).ready,false);
});
