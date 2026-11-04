import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateFormula,evaluateVariables} from '../dist/formula.js';
import {calculateAssemblyDetailed,hierarchyTotals} from '../dist/estimate-core.js';
import {totals} from '../dist/calc.js';
import {exportEstimate} from '../dist/workbook.js';
import {unzip} from '../dist/est.js';
const part=(labor,extra={})=>({name:'노임',qty:1,labor,material:0,expense:0,other:0,...extra});
test('운반 변수, 대소문자, 연산 순서 및 오류 검출',()=>{
 const {values}=evaluateVariables('L1=2\nV1=10\nV2=20\nt=60*(L1/V1+L1/V2)\nq=3\nQ=q*60/t');
 assert.equal(values.t,18);assert.equal(values.Q,10);assert.equal(values.q,3);
 assert.equal(evaluateFormula('2^3^2'),512);assert.equal(evaluateFormula('-2^2'),-4);assert.equal(evaluateFormula('200 × 2%'),4);
 for(const value of ['1/0','x+1','globalThis.process','constructor(1)','2;alert(1)'])assert.throws(()=>evaluateFormula(value));
 assert.throws(()=>evaluateVariables('Q=2\nQ=3'),/중복/);
});
test('일위 잡비, 단산 최근 비목 및 ADD 중복 방지',()=>{
 const basic=[part(300),part(100)];
 const percent={kind:'percent',basis:'labor',target:'material',percent:2};
 assert.equal(calculateAssemblyDetailed([...basic,{...percent,scope:'all'}]).result.material,8);
 assert.equal(calculateAssemblyDetailed([...basic,{...percent,scope:'nearest'}]).result.material,2);
 const add={kind:'subtotal',basis:'labor',target:'labor',scope:'section',startRow:1};
 const result=calculateAssemblyDetailed([...basic,add,{...percent,scope:'nearest'}]);
 assert.deepEqual(result.result,{labor:400,material:8,expense:0,other:0,total:408});
 assert.throws(()=>calculateAssemblyDetailed([...basic,{...add,startRow:10}]),/시작 행/);
});
test('SUM 색인, 합산 제외 기준금액, 단위환산과 경비성 단가',()=>{
 const r=calculateAssemblyDetailed([part(100,{sumTag:'A'}),part(300,{sumTag:'B'}),part(200,{sumTag:'A',exclude:true}),{kind:'percent',basis:'labor',target:'expense',percent:10,scope:'tag',sumTag:'A'}],{outputQuantity:2});
 assert.equal(r.result.labor,200);assert.equal(r.result.expense,15);
 const expense=calculateAssemblyDetailed([part(100,{qtyExpression:'8/Q'})],{variables:'Q=4',expenseOnly:true});
 assert.equal(expense.rows[0].amount.labor,200);assert.equal(expense.result.labor,0);assert.equal(expense.result.expense,200);
 assert.throws(()=>calculateAssemblyDetailed([part(100)],{outputQuantity:-1}),/기준 수량/);
});
test('중첩 공종 집계는 소계를 다시 합산하지 않고 관급도 구분한다',async()=>{
 const leaf=(id,bucket='direct')=>({id,name:id,qty:1,status:'confirmed',rate:part(100),bucket});
 const lines=[{id:'parent',name:'공사',level:3},{id:'child',name:'토공',level:1},leaf('a'),leaf('b','government'),{id:'next',name:'관공',level:1},leaf('c'),{id:'other',name:'다른 공사',level:3},leaf('d')];
 const h=hierarchyTotals(lines);assert.equal(h.get('parent').total,300);assert.equal(h.get('child').total,200);assert.equal(h.get('next').total,100);
 const total=totals(lines,[]);assert.equal(total.direct,300);assert.equal(total.government,100);assert.equal(total.missing,0);
 const zip=await unzip(exportEstimate({lines,charges:[]}));const xml=new TextDecoder().decode(await zip.read('xl/worksheets/sheet1.xml'));
 assert.match(xml,/SUMIFS\(L5:L9,N5:N9,&quot;&lt;&gt;heading&quot;,V5:V9,1\)/);assert.match(xml,/공종 집계/);
});
