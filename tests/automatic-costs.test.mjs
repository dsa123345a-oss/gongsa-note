import test from 'node:test';
import assert from 'node:assert/strict';
import {totals,synchronizeLinkedCosts} from '../dist/calc.js';
import {selectRateRule,addRateBand} from '../dist/rate-policy.js';
import {resourceReport} from '../dist/work-core.js';
import {contractorSheets,exportContractor} from '../dist/contractor-export.js';
import {unzip} from '../dist/est.js';
const line=(qty=1,bucket='direct')=>({id:crypto.randomUUID(),group:'토공',name:'작업',spec:'',unit:'개',status:'confirmed',bucket,qty,rate:{source:'시험',code:'M1',name:'작업',category:'자재',labor:1000,material:2000,expense:100,other:0,total:3100}});
const project=(lines,charges=[])=>({schema:1,title:'연동 시험',location:'',lines,charges,mappings:{}});
test('관급 수량이 바뀌면 자동 조달수수료만 다시 계산한다',()=>{
 const gov=line(10,'government'),fee={...line(1,'fees'),generatedProcurement:{auto:true,rate:1,digits:3}},manual=line(1,'fees');
 const p=project([gov,fee,manual]);let a=synchronizeLinkedCosts(p);assert.equal(a.lines[1].rate.total,1000);
 p.lines[0].qty=20;a=synchronizeLinkedCosts(p);assert.equal(a.lines[1].rate.total,1000);assert.equal(a.lines[2].rate.total,3100);
 p.lines[0].qty=21;a=synchronizeLinkedCosts(p);assert.equal(a.lines[1].rate.total,900);assert.equal(totals(a.lines,[]).fees,4000);
 assert.equal(fee.rate.total,3100);
});
test('안전비 비교는 간접노무와 지정 관급 포함률을 현재 수량으로 반영한다',()=>{
 const c={key:'safety',name:'안전비',base:'fixed',link:{type:'safety',basis:'totalLaborMaterial',rate:2,addition:10,surcharge:20,governmentPercent:50}};
 const p=project([line(10),line(10,'government')],[{key:'indirect',name:'간접',base:'labor',rate:10},c]);
 const a=synchronizeLinkedCosts(p);assert.equal(a.charges[1].comparisonInputs.base,31000);assert.equal(a.charges[1].comparisonInputs.government,15500);assert.equal(a.charges[1].fixed,756);
 p.lines[0].qty=20;const b=synchronizeLinkedCosts(p);assert.equal(b.charges[1].fixed,1500);
});
test('목표 도급액은 이윤 한도 내에서 목표를 넘지 않는 최대 정수로 산정한다',()=>{
 const maximum={key:'profit',name:'이윤',base:'profitBase',rate:20};
 for(const target of [3410,3500,3600]){const p=project([line()],[{...maximum,base:'fixed',fixed:0,link:{type:'target',maximum,target}},{key:'vat',name:'부가세',base:'contractBeforeVat',rate:10}]);const r=synchronizeLinkedCosts(p),t=totals(r.lines,r.charges);assert.ok(t.contract<=target);assert.ok(target-t.contract<=1);assert.equal(r.costWarnings.length,0);}
 const p=project([line()],[{...maximum,base:'fixed',link:{type:'target',maximum,target:1}}]);assert.equal(synchronizeLinkedCosts(p).costWarnings.length,1);assert.throws(()=>exportContractor(p),/목표/);
});
test('조건 요율은 경계 금액을 중복 적용하지 않고 잘못된 날짜를 거부한다',()=>{
 const context={kind:'토목',date:'2026-10-31',days:30},band={kind:'토목',source:'사용자 확인 기준표',from:'2026-01-01',to:'2026-12-31',minDays:1,maxDays:365,minAmount:0,maxAmount:6200};
 let p=addRateBand(project([line()],[{key:'indirect',name:'간접',base:'labor',rate:10}]),band,context);p.charges[0].rate=20;p=addRateBand(p,{...band,minAmount:6200,maxAmount:null},context);
 assert.equal(totals(p.lines,p.charges).charges[0].amount,100);p.lines[0].qty=2;assert.equal(totals(p.lines,p.charges).charges[0].amount,400);
 assert.throws(()=>selectRateRule({context:{...context,date:'2026-02-30'},rules:[]},0),/공고일/);
 assert.match(selectRateRule({context,rules:[]},0).warning,/없습니다/);
 assert.match(selectRateRule({context,rules:[{...band,rate:10},{...band,rate:20}]},0).warning,/중복/);
});
test('원본 단위환산 집계는 동원 물량도 동일 비율로 바꾼다',()=>{
 const r={...line().rate,category:'일위대가',components:[{...line().rate,qty:100},{kind:'percent',scope:'all',basis:'total',target:'components',percent:1,replaceRunning:true}]};
 const p=project([{...line(3),rate:r}]),before=structuredClone(p),result=resourceReport(p,[]);
 assert.equal(result.rows[0].qty,3);assert.equal(result.warnings.length,0);assert.deepEqual(p,before);
});
test('기존 계산표 호환 모델을 보존하고 실제 출력에는 착공 인쇄 설정을 적용한다',async()=>{
 const p=project([{...line(),status:'proposed'}]),sheets=contractorSheets(p);
 assert.deepEqual(sheets.map(s=>s.name),['원가계산서','내역서총괄표','내역서','산정내역','산정원가']);
 const r=sheets[2].rows[5];assert.equal(r[5].value,0);assert.equal(r[7].value,0);assert.equal(r[6],'미확정');
 const z=await unzip(exportContractor(project([line()]))),xml=new TextDecoder().decode(await z.read('xl/worksheets/sheet3.xml'));
 assert.match(xml,/fitToPage="0"/);assert.match(xml,/scale="85"/);assert.match(xml,/mergeCell ref="G3:H3"/);assert.doesNotMatch(xml,/산정내역/);
});
