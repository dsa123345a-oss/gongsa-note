import test from 'node:test';
import assert from 'node:assert/strict';
import {totals,defaultCharges,synchronizeLinkedCosts} from '../dist/calc.js';
import {withBidLines} from '../dist/bid-core.js';
import {reverseContract} from '../dist/work-core.js';
import {prepareContractor} from '../dist/workflow-core.js';
import {costSheet,costSheetHtml} from '../dist/cost-sheet.js';
import {editCostCharge} from '../dist/cost-edit.js';
import {contractorTemplateSheets} from '../dist/contractor-template-export.js';
import {setupEstActions} from '../dist/est-actions.js';
const fixture=()=>({schema:1,title:'상수도',ratesReviewed:true,lines:[{id:'a',name:'터파기',spec:'',group:'토공',unit:'m',qty:10,bucket:'direct',status:'confirmed',rate:{labor:100000,material:20000,expense:3000,other:0,total:123000}}],charges:defaultCharges()});
test('낙찰률 칸에 95 입력 후 적용만 눌러도 행과 합계가 바뀐다',()=>{
 const saved=globalThis.document,nodes=new Map();let p=fixture();
 const el=id=>{if(!nodes.has(id))nodes.set(id,{value:'',checked:false,disabled:false,innerHTML:'',textContent:'',querySelectorAll:()=>[],insertAdjacentHTML(){},showModal(){},close(){}});return nodes.get(id);};
 globalThis.document={getElementById:el};
 try{setupEstActions({getProject:()=>p,getLibraries:()=>[],getGroup:()=>'',getSelected:()=>'',commit:()=>{p=synchronizeLinkedCosts(p);},toast:()=>{}});
  el('bidMethod').value='unit';el('bidBtn').onclick();const initial=totals(p.lines,p.charges).contract;
  el('bidRate').value='95';el('bidRate').oninput();assert.match(el('bidSummary').textContent,/→/);el('bidApply').onclick();assert.equal(p.lines[0].bidPercent,95);assert.ok(totals(p.lines,p.charges).contract<initial);
  el('bidBtn').onclick();assert.equal(Number(el('bidRate').value),95);el('bidRestore').onclick();el('bidApply').onclick();assert.equal(totals(p.lines,p.charges).contract,initial);
 }finally{globalThis.document=saved;}
});
test('목표액 자동 유지가 있던 공사도 새 역산 목표가 적용되고 반복 역산 한도가 줄지 않는다',()=>{
 const p=fixture(),original=totals(p.lines,p.charges).contract,firstTarget=Math.floor(original/10000)*10000;
 const first=reverseContract(p,firstTarget),profit=first.project.charges.find(c=>c.key==='profit');profit.link={type:'target',target:firstTarget,maximum:first.maximum};
 const second=reverseContract(first.project,firstTarget-10000);assert.ok(second.actual<=firstTarget-10000);assert.ok(second.difference<=1);assert.ok(!second.project.charges.find(c=>c.key==='profit').link);
 const restored=reverseContract(second.project,firstTarget);assert.equal(restored.actual,first.actual);assert.equal(totals(restored.project.lines,restored.project.charges).contract,restored.actual);
 assert.deepEqual(restored.project.lines,p.lines);
});
test('낙찰 변경은 이전 자리맞춤 목표를 해제하고 원래 이윤 요율로 재산정한다',()=>{
 const p=fixture(),goal=Math.floor(totals(p.lines,p.charges).contract/1000)*1000,r=reverseContract(p,goal);
 r.project.charges.find(c=>c.key==='profit').link={type:'target',target:goal,maximum:r.maximum};
 const lines=r.project.lines.map(l=>({...l,bidPercent:95})),discounted=withBidLines(r.project,lines);
 const expected=withBidLines(p,p.lines.map(l=>({...l,bidPercent:95})));
 assert.equal(totals(discounted.lines,discounted.charges).contract,totals(expected.lines,expected.charges).contract);assert.ok(totals(discounted.lines,discounted.charges).contract<goal);
 assert.equal(discounted.charges.find(c=>c.key==='profit').rate,15);assert.ok(!discounted.charges.find(c=>c.key==='profit').link);
});
test('원가 화면과 업체 엑셀은 직접·간접재료비 배치와 합계가 일치한다',()=>{
 const p=fixture(),screen=costSheet(p),excel=contractorTemplateSheets(p).sheets[0];
 assert.equal(screen.rows.find(r=>r.id==='directMaterial').amount,0);
 assert.equal(screen.rows.find(r=>r.id==='material').name,'간접재료비');assert.equal(screen.rows.find(r=>r.id==='material').amount,excel.rows.find(r=>r.code==='2').values[5].value);
 assert.equal(screen.rows.find(r=>r.id==='materialSum').amount,200000);
});
test('업체 직접 지정 95%는 구버전의 계상 구분 누락 행에도 적용된다',()=>{
 const p=fixture();delete p.lines[0].bucket;const out=prepareContractor(p,{mode:'custom',percent:95});assert.equal(out.project.lines[0].bidPercent,95);assert.ok(out.totals.contract<out.designContract);
});
test('4자리 역산 후 이윤은 낮아진 퍼센트로 표시되며 15% 재입력으로 원래 한도로 복원된다',()=>{
 const p=fixture(),before=totals(p.lines,p.charges).contract,target=Math.floor(before/10000)*10000,r=reverseContract(p,target);
 const row=costSheet(r.project).rows.find(x=>x.id==='charge:profit');assert.ok(row.profitRate>0&&row.profitRate<15);assert.match(row.rate,/%$/);
 const html=costSheetHtml(r.project,{esc:String,money:String}),profit=html.match(/<tr\b[^>]*data-cost-row="charge:profit"[^>]*>[\s\S]*?<\/tr>/)[0];
 assert.match(profit,/data-charge-field="profitRate"/);assert.match(profit,/aria-label="이윤 요율"/);assert.doesNotMatch(profit,/이윤 정액|<span>원<\/span>/);
 assert.equal(row.rate,row.profitRate.toFixed(2)+'%');
 assert.ok(profit.includes(`value="${row.profitRate.toFixed(2)}"`));
 assert.equal(costSheet(r.project).totals.contract,totals(r.project.lines,r.project.charges).contract);
 const i=r.project.charges.findIndex(c=>c.key==='profit');r.project.charges[i]=editCostCharge(r.project.charges[i],'profitRate',15);
 assert.equal(totals(r.project.lines,r.project.charges).contract,before);assert.ok(!r.project.charges[i].adjustment);
});
