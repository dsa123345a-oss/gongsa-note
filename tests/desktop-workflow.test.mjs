import test from 'node:test';
import assert from 'node:assert/strict';
import {createProjectHistory} from '../dist/project-history.js';
import {buildQuantityProject,nextSectionNumber,quantitySupplyFeeAvailability} from '../dist/quantity-batch.js';
import {previewSupplyFees,applySupplyFees} from '../dist/supply-fees.js';
import {resetCostSheet,insertCostCharge,deleteCostCharge,roundedContractTarget} from '../dist/cost-edit.js';
import {hierarchyTotals} from '../dist/estimate-core.js';
import {totals,defaultCharges,synchronizeLinkedCosts} from '../dist/calc.js';
import {reverseContract} from '../dist/work-core.js';
const line=(id,qty,bucket='direct')=>({id,name:'터파기',spec:'',unit:'㎥',group:'1.토공',qty,bucket,level:0,status:'confirmed',factor:1,exclude:false,rate:{labor:100000,material:20000,expense:30000,other:0,total:150000}});
const base=()=>({schema:1,title:'기존 공사',lines:[],charges:defaultCharges(),mappings:{},ratesReviewed:false});
const entry=(site,rows)=>({file:site+'.xlsx',site,quantity:{title:site,location:'',rows}});
test('공구별 L2·L1을 파일 순서대로 생성하고 직접공사비만 집계한다',()=>{
 const p=base(),items=[entry('덕인리',[line('a',2),line('gov',1,'government')]),entry('사동리',[line('b',3)])];
 const out=buildQuantityProject(p,items,{numbered:true});out.lines=synchronizeLinkedCosts(out).lines;const roots=out.lines.filter(l=>l.level===2),sums=hierarchyTotals(out.lines);
 assert.deepEqual(roots.map(l=>l.name),['1공구 덕인리','2공구 사동리']);assert.equal(out.title,'상수도긴급보수공사(덕인리 등)');
 assert.equal(out.lines.filter(l=>l.level===1).length,2);assert.deepEqual(roots.map(l=>sums.get(l.id).total),[400000,600000]);
 assert.equal(totals(out.lines,out.charges).direct,1000000);assert.equal(p.lines.length,0);assert.equal(nextSectionNumber(out),3);
 const reversed=buildQuantityProject(p,[...items].reverse(),{numbered:true});assert.match(reversed.lines[0].name,/1공구 사동리/);
});
test('추가 업로드는 공구 번호를 이어가며 기존 내역과 단가를 보존한다',()=>{
 const first=buildQuantityProject(base(),[entry('덕인리',[line('a',2)])],{numbered:true});
 const next=buildQuantityProject(first,[entry('사동리',[line('b',3)])],{numbered:true,append:true,start:nextSectionNumber(first)});
 assert.deepEqual(next.lines.slice(0,first.lines.length),first.lines);assert.equal(next.lines.filter(l=>l.level===2)[1].sectionNumber,2);
 assert.throws(()=>buildQuantityProject(first,[entry('중복',[line('c',1)])],{numbered:true,append:true,start:1}),/겹칩니다/);
 assert.throws(()=>buildQuantityProject(first,[entry('빈 파일',[])],{}),/모든 파일/);
});
test('되살리기는 파일 여러 개 가져오기 전체와 삭제를 복구하고 다시 실행한다',()=>{
 const p=base(),h=createProjectHistory(p),added=buildQuantityProject(p,[entry('현장',[line('a',1)])],{numbered:true});
 h.record(added);const deleted={...added,lines:[]};h.record(deleted);assert.deepEqual(h.undo(),added);assert.deepEqual(h.undo(),p);assert.equal(h.canUndo,false);
 assert.deepEqual(h.redo(),added);h.record({...added,title:'수정'});assert.equal(h.canRedo,false);
});
test('같은 셀 연속 입력을 한 번에 복구하며 서로 다른 셀은 분리한다',()=>{
 const h=createProjectHistory({value:0},2);h.record({value:1},'qty:1',100);h.record({value:12},'qty:1',200);h.record({value:13},'qty:2',300);
 assert.deepEqual(h.undo(),{value:12});assert.deepEqual(h.undo(),{value:0});
});
test('원가 삽입·삭제·초기화는 수량 단가를 유지하고 되살리기로 복구한다',()=>{
 const p=base();p.lines=[line('a',2)];p.charges.find(c=>c.key==='profit').rate=15;
 const result=insertCostCharge(p,'employment'),added=result.project;assert.equal(added.charges.findIndex(c=>c.key===result.key)+1,added.charges.findIndex(c=>c.key==='employment'));
 assert.deepEqual(deleteCostCharge(added,result.key),p);const reset=resetCostSheet(p);assert.deepEqual(reset.lines,p.lines);assert.deepEqual(reset.charges,defaultCharges());
 const h=createProjectHistory(p);h.record(reset);assert.deepEqual(h.undo(),p);assert.throws(()=>deleteCostCharge(p,'grand'),/합계 행/);
});
test('자리수 목표로 역산한 금액은 목표 이하이며 원단가·수량을 보존한다',()=>{
 const p=base();p.lines=[line('a',2.37)];p.charges.find(c=>c.key==='profit').rate=15;
 const before=totals(p.lines,p.charges),target=roundedContractTarget(before.contract,1000),r=reverseContract(p,target);
 assert.ok(r.actual<=target);assert.ok(target-r.actual<=1);assert.deepEqual(r.project.lines,p.lines);
 assert.equal(roundedContractTarget(123450,1000,'round'),123000);assert.equal(roundedContractTarget(123450,1000,'ceil'),124000);
 assert.throws(()=>reverseContract(p,before.contract+1000));assert.throws(()=>roundedContractTarget(123,3));
});
test('사용자 원가계산서 표본: 기본 요율과 자리수 역산으로 도급액 9,390,000원을 재현한다',()=>{
 const p=base();p.lines=[{...line('sample',1),rate:{labor:3020861,material:1004586,expense:1879323,other:0,total:5904770}},{...line('waste',1,'waste'),rate:{labor:0,material:0,expense:116295,other:0,total:116295}}];
 const t=totals(p.lines,p.charges),c=key=>t.charges.find(c=>c.key===key).amount;
 assert.equal(c('indirect'),576984);assert.equal(c('industrial'),128083);assert.equal(c('employment'),36338);
 assert.equal(c('asbestos'),215);assert.equal(c('wageClaim'),3238);assert.equal(c('other'),253133);assert.equal(c('management'),552220);assert.equal(c('profit'),967559);
 const adjusted=reverseContract(p,9390000),final=totals(adjusted.project.lines,adjusted.project.charges);
 assert.equal(adjusted.profit,965088);assert.equal(final.charges.find(c=>c.key==='vat').amount,853636);assert.equal(final.contract,9390000);assert.equal(final.grand,9390000);
});

test('단일 신규급수만 수수료를 기본 선택하고 추가·복수 신청·긴급보수는 자동 묶지 않는다',()=>{
 const p=base(),one=[entry('상수도 신규 급수공사',[line('a',1)])];
 assert.equal(quantitySupplyFeeAvailability(p,one).defaultEnabled,true);
 assert.deepEqual(quantitySupplyFeeAvailability(p,one,{append:true}).defaultEnabled,false);
 const unknown=quantitySupplyFeeAvailability(p,[entry('수량산출서',[line('b',1)])]);
 assert.equal(unknown.allowed,true);assert.equal(unknown.defaultEnabled,false);
 assert.equal(quantitySupplyFeeAvailability(p,[...one,...one]).allowed,false);
 assert.equal(quantitySupplyFeeAvailability(p,one,{numbered:true}).allowed,false);
 assert.equal(quantitySupplyFeeAvailability(p,[entry('상수도긴급보수공사',[line('c',1)])]).allowed,false);
 assert.equal(quantitySupplyFeeAvailability({...p,workType:'emergency'},one,{append:true}).allowed,false);
});

test('신규 수량으로 교체하면 이전 공사의 수수료·긴급 구분은 초기화하고 추가 가져오기는 보존한다',()=>{
 const p={...base(),workType:'emergency',contractLimit:10000000,supplyFees:{enabled:true,diameter:50},lines:[line('old',1)]},snapshot=structuredClone(p);
 const incoming=[entry('상수도 신규 급수공사',[line('new',1)])],next=buildQuantityProject(p,incoming);
 assert.equal(next.workType,'new');assert.equal(next.supplyFees,undefined);assert.equal(next.contractLimit,undefined);assert.deepEqual(p,snapshot);
 const current={...base(),workType:'new',contractLimit:2000000,supplyFees:{enabled:true,diameter:20},lines:[line('a',1)]};
 const append=buildQuantityProject(current,incoming,{append:true});
 assert.deepEqual(append.supplyFees,current.supplyFees);assert.equal(append.workType,'new');assert.equal(append.contractLimit,2000000);
 const unknown=buildQuantityProject(p,[entry('수량자료',[line('b',1)])]);assert.equal(unknown.workType,undefined);
});

test('신규 가져오기 수수료는 최대 관급 계량기로 3행만 만들고 재가져오기·저장·되살리기에 보존된다',()=>{
 const pipe=(id,spec)=>({...line(id,6),name:'PE 직관',group:'자재대',spec,unit:'M'}),meter={...line('meter',2,'government'),name:'수도미터',spec:'D32',unit:'개'};
 const incoming=[entry('상수도 신규급수공사',[pipe('p20','D20SU'),pipe('p50','D50'),{...meter,id:'meter20',spec:'D20'},meter])];
 const imported=buildQuantityProject(base(),incoming),report=previewSupplyFees(imported,{infer:true});
 assert.equal(report.canApply,true);assert.equal(report.diameter,32);assert.equal(report.total,20000);
 const result=applySupplyFees(imported,{diameter:report.diameter,basis:report.basis}).project;
 assert.equal(result.lines.filter(l=>l.generatedSupplyFee).length,3);assert.equal(totals(result.lines,result.charges).fees,20000);
 assert.deepEqual(JSON.parse(JSON.stringify(result)).supplyFees,result.supplyFees);
 const replaced=buildQuantityProject(result,incoming),reapplied=applySupplyFees(replaced,{diameter:32,basis:'동일 신청'}).project;
 assert.equal(reapplied.lines.filter(l=>l.generatedSupplyFee).length,3);
 const history=createProjectHistory(imported);history.record(result);assert.deepEqual(history.undo(),imported);assert.deepEqual(history.redo(),result);
 const existing={...imported,lines:[...imported.lines,{...line('manual',1,'fees'),name:'설계수수료',group:'수수료'}]};
 const blocked=applySupplyFees(existing,{diameter:32});assert.equal(blocked.report.blocked,true);assert.deepEqual(blocked.project,existing);
 const meterOnly=buildQuantityProject(base(),[entry('상수도 신규급수공사',[meter])]);
 assert.equal(previewSupplyFees(meterOnly,{infer:true}).canApply,true);assert.equal(previewSupplyFees(meterOnly,{infer:true}).diameter,32);
 const pipeOnly=buildQuantityProject(base(),[entry('상수도 신규급수공사',[pipe('p50','D50')])]);
 assert.equal(previewSupplyFees(pipeOnly,{infer:true}).canApply,false);assert.equal(previewSupplyFees(pipeOnly,{infer:true}).diameter,null);
});
