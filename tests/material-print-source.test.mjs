import test from 'node:test';
import assert from 'node:assert/strict';
import {makePrintDocuments} from '../dist/est-print.js';
import {defaultCharges} from '../dist/calc.js';
const rate={name:'경유',spec:'',unit:'ℓ',code:'M1',library:'applied-db',source:'2026-10-main.estx',category:'자재',table:'StuffcDat',labor:0,material:1676,expense:0,other:0,total:1676};
const project=r=>({schema:1,title:'조사근거 검증',lines:[{id:'m',name:r.name,qty:1,status:'confirmed',rate:r}],charges:defaultCharges()});
const library=(id='applied-db',TC=1676)=>({id,name:rate.source,items:[],tables:[{name:'StuffcDat.dat',rows:[{Code:'M1',Name:'경유',Size:'',Unite:'ℓ',TC,Cost1:TC,Page1:'2026.10',Remark:'조사 원문'}]}]});
const printed=(r,libs=[])=>makePrintDocuments(project(r),libs).documents.find(d=>d.key==='materials').rows[0];
test('DB 없이 다시 연 자재도 저장된 조사 페이지와 비고를 출력한다',()=>{
 const r={...rate,prices:[1676,null,null,null,null,null],quotePages:['2026.10','','','','',''],remark:'조달청'},before=structuredClone(r),p=printed(r);
 assert.equal(p.cells[4].value,'1,676');assert.equal(p.cells[5].value,'2026.10');assert.equal(p.cells[17].value,'조달청');assert.deepEqual(r,before);
});
test('누락된 구형 메타데이터는 같은 라이브러리의 동일 적용 자재에서만 보충한다',()=>{
 assert.equal(printed(rate,[library()]).cells[5].value,'2026.10');
 for(const libs of [[library('new-db')],[library('applied-db',1800)]]){
  const row=printed(rate,libs);assert.equal(row.cells[5].value,'');assert.equal(row.cells[17].value,'');
 }
 const manual=printed({...rate,manual:true},[library()]);assert.equal(manual.cells[5].value,'');
});
test('저장된 빈 비고·페이지는 다른 DB 값으로 덮어쓰지 않는다',()=>{
 const row=printed({...rate,quotePages:['','','','','',''],remark:''},[library()]);
 assert.equal(row.cells[5].value,'');assert.equal(row.cells[17].value,'');
});
