import test from 'node:test';import assert from 'node:assert/strict';
import {addSurcharge,setSurchargesEnabled} from '../dist/line-adjustments.js';
import {defaultCharges,synchronizeLinkedCosts,totals,amount} from '../dist/calc.js';
import {validateProject} from '../dist/project-data.js';
import {makePrintDocuments} from '../dist/est-print.js';
import {printExcelSheets} from '../dist/print-excel.js';
import {applyEmergencySurcharges} from '../dist/emergency-surcharges.js';
const item=(id,level=0)=>({id,name:level===2?'1공구 검증':level===1?'토공':id,group:'토공',spec:'',unit:'식',qty:level?null:2,level,bucket:'direct',status:level?'unmatched':'confirmed',bidPercent:95,rate:level?null:{code:'D1',name:id,source:'검증',unit:'식',labor:10000,material:1000,expense:0,other:0,total:11000}});
const fixture=()=>{
 let p={schema:1,title:'상수도긴급보수공사',lines:[item('site',2),item('group',1),item('work'),{...item('excluded'),exclude:true}],charges:defaultCharges()};
 p=addSurcharge(p,'work',{name:'기타할증',scope:'group',basis:'labor',target:'labor',percent:50,includeSurcharges:false});
 p=addSurcharge(p,'work',{name:'별도할증',scope:'selected',sourceIds:['work'],basis:'labor',target:'labor',percent:30,includeSurcharges:false});
 return synchronizeLinkedCosts(p);
};
test('전체·개별 할증 전환은 요율·기준행을 보존하고 일반 제외 행에 영향을 주지 않는다',()=>{
 const p=fixture(),original=structuredClone(p),surcharges=p.lines.filter(l=>l.surcharge),on=totals(p.lines,p.charges);
 const off=synchronizeLinkedCosts(setSurchargesEnabled(p,false));assert.equal(totals(off.lines,off.charges).direct,20900);
 for(const l of off.lines.filter(l=>l.surcharge)){assert.equal(l.exclude,true);assert.deepEqual(l.surcharge,surcharges.find(s=>s.id===l.id).surcharge);}
 assert.equal(off.lines.find(l=>l.id==='excluded').exclude,true);assert.deepEqual(p,original);
 const partial=synchronizeLinkedCosts(setSurchargesEnabled(off,true,surcharges[0].id));assert.equal(partial.lines.filter(l=>l.surcharge&&!l.exclude).length,1);
 const restored=synchronizeLinkedCosts(setSurchargesEnabled(off,true));assert.deepEqual(totals(restored.lines,restored.charges),on);
 assert.throws(()=>setSurchargesEnabled(p,true,'work'),/할증 행/);
});
test('끄기 상태를 저장·다시 열어도 유지하고 재적용 시 바뀐 수량·낙찰률로 한 번만 계산한다',()=>{
 const p=setSurchargesEnabled(fixture(),false),reopened=validateProject(JSON.parse(JSON.stringify(p)));
 const work=reopened.lines.find(l=>l.id==='work');work.qty=3;work.bidPercent=90;
 const off=synchronizeLinkedCosts(reopened);assert.ok(off.lines.filter(l=>l.surcharge).every(l=>l.exclude));
 const on=synchronizeLinkedCosts(setSurchargesEnabled(off,true));
 const rows=on.lines.filter(l=>l.surcharge);assert.deepEqual(rows.map(l=>amount(l).labor).sort((a,b)=>a-b),[8100,13500]);
 assert.equal(totals(on.lines,on.charges).direct,51300);
 const kept=applyEmergencySurcharges(off).project;assert.ok(kept.lines.filter(l=>l.surcharge).every(l=>l.exclude));
});
test('꺼진 할증은 미리보기·PDF 공통 문서와 엑셀 내역에서 빠지고 원가 합계도 함께 바뀐다',()=>{
 const on=fixture(),off=synchronizeLinkedCosts(setSurchargesEnabled(on,false)),names=on.lines.filter(l=>l.surcharge).map(l=>l.name);
 for(const p of [on,off]){
  const b=makePrintDocuments(p),e=printExcelSheets(p,[],{sections:['summary','groups','estimate']});
  assert.equal(b.totals.grand,totals(p.lines,p.charges).grand);
  const doc=b.documents.find(d=>d.key==='estimate'),sheet=e.sheets.find(s=>s.name==='내역서');
  for(const name of names){assert.equal(doc.rows.some(r=>r.cells.some(c=>c.value===name)),p===on);assert.equal(sheet.rows.some(r=>r.values.includes(name)),p===on);}
 }
 assert.ok(totals(off.lines,off.charges).grand<totals(on.lines,on.charges).grand);
});
