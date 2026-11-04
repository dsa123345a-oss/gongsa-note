import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {defaultCharges,totals} from '../dist/calc.js';
import {costSheet} from '../dist/cost-sheet.js';
import {editCostCharge} from '../dist/cost-edit.js';
import {evaluateCostFormula,defaultChargeFormula} from '../dist/cost-formula.js';
import {withBidLines} from '../dist/bid-core.js';
import {prepareContractor} from '../dist/workflow-core.js';
import {reverseContract} from '../dist/work-core.js';
import {contractorTemplateSheets} from '../dist/contractor-template-export.js';
import {planAutoLinks} from '../dist/auto-link.js';
import {searchLibraries} from '../dist/library-search.js';
const project=()=>({schema:1,title:'공사',lines:[{id:'a',name:'작업',group:'공종',spec:'',unit:'m',bucket:'direct',qty:10,status:'confirmed',rate:{labor:123456,material:23456,expense:3456,other:0,total:150368}}],charges:defaultCharges()});
test('산출근거 기본 수식을 직접 편집으로 저장해도 모든 비목 금액이 동일하다',()=>{
 const p=project(),before=totals(p.lines,p.charges);p.charges=p.charges.map(c=>editCostCharge(c,'formula',defaultChargeFormula(c)));
 assert.deepEqual(totals(p.lines,p.charges).charges.map(c=>c.amount),before.charges.map(c=>c.amount));
 assert.equal(totals(p.lines,p.charges).contract,before.contract);
});
test('수식은 앞선 비목과 R 요율을 재계산하고 잘못된 참조를 거절한다',()=>{
 const p=project();p.charges[0]=editCostCharge(p.charges[0],'formula','([4] + A) * R');
 assert.equal(totals(p.lines,p.charges).charges[0].amount,280601);
 p.charges[0]=editCostCharge(p.charges[0],'rate',10);assert.equal(totals(p.lines,p.charges).charges[0].amount,146912);
 for(const bad of ['F * R','[99]','[5] * R','document.cookie','1/0','-1']){p.charges[0].formula=bad;assert.throws(()=>totals(p.lines,p.charges));}
 assert.equal(evaluateCostFormula('(B + C + E) * 15%',{B:10000,C:2000,E:500}),1875);
});
test('95% 낙찰·역산·업체 전달이 같은 원가를 사용하며 수식도 출력한다',()=>{
 let p=project();p.charges[0].formula='[4] * R';p=withBidLines(p,p.lines.map(l=>({...l,bidPercent:95})));
 const target=Math.floor(totals(p.lines,p.charges).contract/10000)*10000;p=reverseContract(p,target).project;
 const screen=costSheet(p).totals.contract,prepared=prepareContractor(p),book=contractorTemplateSheets(prepared.project);
 assert.equal(screen,target);assert.equal(prepared.totals.contract,screen);assert.equal(book.sheets[0].rows.find(r=>r.code==='J').values[5].value,screen);
 assert.match(book.sheets[0].rows.find(r=>r.code==='5').values[5].formula,/F8.*G9/);
});
test('내역서 공종과 순공사비만 굵게, 보험료·이윤 등은 원본처럼 보통 글씨',()=>{
 for(const kind of ['new','emergency']){const book=contractorTemplateSheets({...project(),contractorTemplate:kind});
  const fonts=[...book.styles.matchAll(/<font>([\s\S]*?)<\/font>/g)].map(m=>m[1]);const xfs=[...book.styles.match(/<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/)[1].matchAll(/<xf\b[^>]*>[\s\S]*?<\/xf>/g)].map(m=>m[0]);
  const bold=row=>fonts[Number(xfs[row.styles[2]].match(/fontId="(\d+)"/)[1])].includes('<b/>');
  const d=book.sheets[2].rows;assert.equal(bold(d.find(r=>r.values[2]==='순 공 사 비')),true);
  for(const name of ['간접노무비','산재보험료','이윤','총공사비'])assert.equal(bold(d.find(r=>r.values[2]===name)),false,name);
 }
});
test('STS 띄어쓰기·숨은 공백과 개소당 표현은 연결하며 PE는 제외한다',()=>{
 const rates=['STS 이형관 접합','PE 이형관 접합'].map((name,i)=>({id:'r'+i,code:'U'+i,name,spec:'Φ13mm/HI-DR조인트',unit:'개소당',category:'일위대가',source:'추가',labor:100,material:0,expense:0,other:0,total:100})),lib={id:'lib',name:'추가',items:rates};
 for(const name of ['STS이형관접합','STS 이형관 접합','STS\u200b이형관\u200b접합']){
  const line={...project().lines[0],name,unit:'개소',spec:'D13',status:'unmatched',rate:null};const plan=planAutoLinks({lines:[line],charges:[],mappings:{}},[lib],'','lib',{rules:[]});
  assert.equal(plan[0].rate.name,'STS 이형관 접합');assert.equal(plan[0].recommended,true);assert.equal(searchLibraries([lib],name,'일위대가')[0].items[0].name,'STS 이형관 접합');
 }
});
