import test from 'node:test';
import assert from 'node:assert/strict';
import {collectPrintEvidence} from '../dist/print-evidence.js';
import {calculateAssemblyDetailed} from '../dist/estimate-core.js';
import {machineBasisRows} from '../dist/machine-basis-print.js';

function machine(source='추가 DB',code='E1',name='굴삭기(무한궤도)'){
 const calculation={outputQuantity:1,componentDigits:1,variables:'FX1 = 1\nOP2 = 1/8',expenseOnly:false};
 const components=[
  {name:'손 료',spec:'',unit:'원',source,library:source,originalRecord:1,code:'',qtyExpression:'10000*FX1/10000000',labor:0,material:0,expense:1000000,other:0,machineOwnership:{name:'손 료',spec:'',coefficient:10000,currencyRatio:0,fxVariable:'FX1'},priceReference:{name:name+' · 손 료',source,code,record:1,unit:'원',expense:1000000,exchangeRate:1}},
  {name:'운전사',code:'L1',source,library:source,originalRecord:2,unit:'인',spec:'',qtyExpression:'1*OP2',labor:80000,material:0,expense:0,other:0}
 ];
 return {name,source,code,library:source,spec:'0.2㎥',unit:'hr',category:'장비',table:'MachTitleDat',components,calculation,...calculateAssemblyDetailed(components,calculation).result};
}
const project=rates=>({lines:rates.map((rate,i)=>({id:'line'+i,name:rate.name,qty:1,status:'confirmed',rate}))});
const machines=g=>g.nodes.filter(n=>n.kind==='장비');

test('장비의 모든 계산 내용이 같으면 DB 출처·코드·확인된 이름 별칭만 다른 출력은 통합한다',()=>{
 const first=machine(),second=machine('10월 DB','E2','굴착기(무한궤도)');second.components[0].originalRecord=40;second.components[1].originalRecord=41;second.components[1].code='L-new';
 const p=project([first,second]),before=JSON.stringify(p),nodes=machines(collectPrintEvidence(p));
 assert.equal(nodes.length,1);assert.equal(nodes[0].rate.total,11000);assert.equal(nodes[0].uses.size,2);
 assert.deepEqual(nodes[0].printSources,['추가 DB','10월 DB']);
 assert.deepEqual(nodes[0].printReferences.map(r=>[r.source,r.code,r.name]),[['추가 DB','E1','굴삭기(무한궤도)'],['10월 DB','E2','굴착기(무한궤도)']]);
 assert.ok(machineBasisRows(nodes).every(r=>r[4]==='추가 DB / 10월 DB'));
 assert.equal(JSON.stringify(p),before);
});

test('단가 합계가 같아도 손료계수·기준가격·계산식·변수 정의가 다르면 통합하지 않는다',()=>{
 const a=machine(),b=machine('10월 DB','E2');
 b.components[0].qtyExpression='5000*FX1/10000000';b.components[0].machineOwnership.coefficient=5000;b.components[0].expense=2000000;b.components[0].priceReference.expense=2000000;
 Object.assign(b,calculateAssemblyDetailed(b.components,b.calculation).result);
 assert.equal(a.total,b.total);assert.equal(machines(collectPrintEvidence(project([a,b]))).length,2);
 const c=machine('10월 DB','E3');c.calculation.variables='FX1 = 1\nOP2 = 0.125';
 assert.equal(machines(collectPrintEvidence(project([a,c]))).length,2);
 const d=machine('10월 DB','E4');d.components[1].qtyExpression='OP2';
 assert.equal(machines(collectPrintEvidence(project([a,d]))).length,2);
});

test('규격·이름·계산 검증 상태가 다른 장비는 동일 단가여도 통합하지 않는다',()=>{
 const a=machine(),b=machine('10월 DB','E2');b.spec='0.4㎥';
 const c=machine('10월 DB','E3','굴착기기타'),d=machine('10월 DB','E4');delete d.components;
 assert.equal(machines(collectPrintEvidence(project([a,b,c,d]))).length,4);
});

test('동등 장비의 비목별 참조는 필요한 비목을 한 번씩 모으고 원본 단가를 바꾸지 않는다',()=>{
 const a=machine(),b=machine('10월 DB','E2','굴착기(무한궤도)');
 a.sourceComponent='labor';a.expense=0;a.total=a.labor;b.sourceComponent='expense';b.labor=0;b.total=b.expense;
 const p=project([a,b]),before=JSON.stringify(p),nodes=machines(collectPrintEvidence(p));
 assert.equal(nodes.length,1);assert.deepEqual(nodes[0].printComponents,['labor','expense']);assert.equal(nodes[0].rate.total,11000);
 assert.equal(JSON.stringify(p),before);
});

test('같은 장비 계산의 서로 다른 원본 비고는 출력 통합 후에도 모두 보존한다',()=>{
 const a=machine(),b=machine('10월 DB','E2','굴착기(무한궤도)');
 a.bigo='기존 메모';b.bigo='개정 메모';a.components[0].rowBigo='25年 개정';b.components[0].rowBigo='26年 개정';
 a.components[1].quotePages=['p.1'];b.components[1].quotePages=['p.2'];a.components[1].bigo='기존 노임';b.components[1].bigo='현재 노임';
 const p=project([a,b]),before=JSON.stringify(p),nodes=machines(collectPrintEvidence(p));
 assert.equal(nodes.length,1);assert.equal(nodes[0].rate.bigo,'기존 메모\n개정 메모');assert.equal(nodes[0].calc.rows[0].rowBigo,'25年 개정\n26年 개정');
 assert.deepEqual(nodes[0].printReferences.map(r=>r.bigo),['기존 메모','개정 메모']);assert.equal(JSON.stringify(p),before);
 b.components[0].qtyExpression='5000*FX1/10000000';b.components[0].machineOwnership.coefficient=5000;b.components[0].expense=2000000;b.components[0].priceReference.expense=2000000;Object.assign(b,calculateAssemblyDetailed(b.components,b.calculation).result);
 assert.equal(machines(collectPrintEvidence(project([a,b]))).length,2);
});
