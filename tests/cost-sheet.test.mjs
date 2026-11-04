import test from 'node:test';
import assert from 'node:assert/strict';
import {costSheet} from '../dist/cost-sheet.js';
import {quantityHierarchy,appendQuantitySection} from '../dist/levels.js';
import {hierarchyTotals} from '../dist/estimate-core.js';
import {exportEstimate,extractQuantities} from '../dist/workbook.js';
import {contractorSheets} from '../dist/contractor-export.js';
import {printPack} from '../dist/print-pack.js';
import {defaultCharges,totals} from '../dist/calc.js';
const line=(id,bucket,labor=0,material=0,expense=0)=>({id,group:bucket==='direct'?'1. 토공':bucket,name:id,spec:'',unit:'식',qty:1,factor:1,bucket,status:'confirmed',rate:{labor,material,expense,other:0,total:labor+material+expense}});
const fixture=()=>({schema:1,title:'상수도 공사',location:'시험',lines:[line('a','direct',600734,241335,289227),line('w','waste',0,0,53572),line('g','government',0,152000),line('f','fees',0,0,75000)],charges:defaultCharges().map(c=>({...c,rate:({indirect:16.5,industrial:3.56,employment:1.01,other:5.2,management:8,vat:10})[c.key]||0,...(c.key==='profit'?{base:'fixed',fixed:175636}:{})}))});
test('참고 공사의 원가 흐름: 직접비, 순원가, 폐기물 포함 부가세, 별도비를 구분한다',()=>{
 const p=fixture(),sheet=costSheet(p),row=id=>sheet.rows.find(r=>r.id===id);
 assert.equal(row('materialSum').amount,241335);assert.equal(row('laborSum').amount,699855);assert.equal(row('expenseSum').amount,370150);
 assert.equal(row('net').amount,1311340);assert.equal(row('beforeVat').amount,1591883);assert.equal(row('charge:vat').amount,164545);assert.equal(row('contract').amount,1810000);assert.equal(row('grand').amount,2037000);
 p.charges.find(c=>c.key==='indirect').rate=20;
 assert.equal(costSheet(p).rows.find(r=>r.id==='grand').amount,totals(p.lines,p.charges).grand);
});
test('출력 제외는 계산에 영향을 주지 않고 인쇄와 업체용 원가표에서만 숨긴다',()=>{
 const p=fixture();p.costVisibility={'charge:industrial':false};const s=costSheet(p);
 assert.equal(s.rows.find(r=>r.id==='grand').amount,2037000);
 assert.equal(contractorSheets(p)[0].rows.some(r=>r[1]==='산재보험료'),false);
 assert.doesNotMatch(printPack(p,[],{sections:['summary']}).html,/산재보험료/);
 p.charges.splice(0,1);assert.equal(costSheet(p).rows.find(r=>r.id==='charge:industrial').visible,false);
});
test('수량 자동 레벨은 L2 공사, L1 공종을 만들고 관급·폐기물·수수료를 상위 합계에서 제외한다',()=>{
 const p=fixture(),next=quantityHierarchy(p),h=hierarchyTotals(next.lines);
 assert.deepEqual(next.lines.map(l=>l.level||0),[2,1,0,1,0,1,0,1,0]);
 assert.deepEqual(next.lines.filter(l=>!l.level),p.lines);assert.equal(h.get(next.lines[0].id).total,1131296);
 assert.equal(quantityHierarchy(next).lines.length,next.lines.length);
 next.lines.find(l=>l.id==='a').qty=2;assert.equal(hierarchyTotals(next.lines).get(next.lines[0].id).total,2262592);
 const workbook=exportEstimate(next,{sheets:true});assert.match(workbook[0].rows[3][11].formula,/,"direct",/);assert.equal(workbook[0].rows[3][11].value,2262592);
 const contractor=contractorSheets(next);assert.equal(contractor[1].rows[3][5].value,2262592);assert.equal(contractor[2].rows[4][6].value,2262592);
});
test('업체용 원가표 소계 수식은 모든 원래 비목을 참조하며 출력 숨김과 독립적이다',()=>{
 const p=fixture(),s=contractorSheets(p)[0],grand=s.rows.find(r=>r[1]==='총공사비');
 assert.equal(grand[4].value,2037000);assert.match(grand[4].formula,/'산정원가'!D5/);assert.match(grand[4].formula,/'산정원가'!D26/);
 assert.equal(costSheet(p).rows.filter(r=>r.charge).length,p.charges.length);
});
test('긴급보수 공구별 같은 공종명이 총괄표와 인쇄에서 합쳐지지 않는다',()=>{
 const p={...fixture(),title:'1공구',lines:[line('a','direct',100)]},first=quantityHierarchy(p);
 const next=appendQuantitySection(first,{title:'2공구',location:'',rows:[line('b','direct',300)]},'2공구.xlsx');
 assert.equal(next.lines.filter(l=>l.level===2).length,2);
 const sheet=contractorSheets(next),groups=sheet[1].rows.filter(r=>r[1]==='1. 토공');
 assert.deepEqual(groups.map(r=>r[5].value),[100,300]);assert.equal(sheet[1].rows[3][5].value,400);
 const raw=exportEstimate(next,{sheets:true})[2].rows.filter(r=>r[0]==='L1 1. 토공');assert.deepEqual(raw.map(r=>r[5].value),[100,300]);
 const html=printPack(next,[],{sections:['groups']}).html;assert.equal((html.match(/L1 1. 토공/g)||[]).length,2);
});
test('긴급보수 수량표는 단위 머리글 생략 양식과 표 머리글 생략 양식을 구분해 읽는다',()=>{
 const row=(index,values)=>({index,cells:Object.fromEntries(Object.entries(values).map(([k,value])=>[k,{value,ref:k+index,cached:true,formula:''}]))});
 const q=extractQuantities({name:'수량',rows:[row(1,{A:'수량산출서(2공구)'}),row(3,{A:'□ 위 치:',C:'감압변 설치'}),row(4,{A:'구분',B:'공종',F:'규격',S:'수량'}),row(6,{A:'1.배관공',B:'감압변 설치',F:'D15',S:2,U:'개소'})]});
 assert.equal(q.title,'감압변 설치');assert.equal(q.rows.length,1);assert.equal(q.rows[0].unit,'개소');assert.equal(q.rows[0].qty,2);
 const h=extractQuantities({name:'수량',rows:[row(1,{A:'수량산출서(8공구)'}),row(2,{A:'□ 공사명:',E:'관매달기 보수'}),row(3,{A:'1.배관공',D:'관보온',M:'D50',AD:4,AG:'M'}),row(4,{A:'2.부대공',D:'굴삭기',AD:6,AG:'HR'})]});
 assert.equal(h.rows.length,2);assert.equal(h.rows[1].unit,'HR');assert.equal(h.rows[1].qty,6);
});
