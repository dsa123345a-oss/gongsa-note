import test from 'node:test';
import assert from 'node:assert/strict';
import {makePrintDocuments,buildPrintPages} from '../dist/est-print.js';
import {printExcelSheets} from '../dist/print-excel.js';
import {defaultCharges} from '../dist/calc.js';

const rate=(code,name,category,amounts={})=>({code,name,category,source:'2026-10-main.estx',library:'same',spec:'',unit:'개',labor:0,material:0,expense:0,other:0,...amounts,total:Object.values(amounts).reduce((a,b)=>a+b,0)});
function fixture(){
 const labor={...rate('L1','배관공','노임',{labor:100}),unit:'인',bigo:'2026년(하)'};
 const material={...rate('M1','경유','자재',{material:20}),unit:'ℓ',remark:'유류 조사',bigo:'한국석유공사',quotePages:['2026.10']};
 const machine={...rate('E1','장비','장비',{expense:30}),bigo:'참고용',components:[{...rate('M2','손료','자재',{expense:30}),qty:1,rowBigo:"'26年 개정"}]};
 const unit={...rate('U1','일위 비고 검증','일위대가',{labor:100,material:20,expense:30}),bigo:'소규모',components:[{...labor,qty:1,rowBigo:'p.837'},{...material,qty:1},{...machine,qty:1}]};
 const formula={...rate('D1','산식 비고 보존','단가산출',{labor:100}),bigo:'경비성단가',components:[{...labor,qty:1,rowBigo:'N'}]};
 return {schema:1,title:'비고 출력 검증',lines:[unit,formula].map((r,i)=>({id:'line'+i,name:r.name,spec:r.spec,unit:r.unit,qty:1,bucket:'direct',status:'confirmed',rate:r})),charges:defaultCharges()};
}

test('EST 제목·구성 비고가 일위·기계·자재의 비고 칸에 보존된다',()=>{
 const p=fixture(),before=JSON.stringify(p),out=makePrintDocuments(p),rows=key=>out.documents.find(d=>d.key===key).rows;
 assert.equal(rows('unitSummary')[0].cells.at(-1).value,'소규모');
 assert.equal(rows('units')[0].cells.at(-1).value,'소규모');
 assert.ok(rows('units').some(r=>r.cells.at(-1).value.includes('p.837')));
 assert.ok(rows('machines').some(r=>r.cells.at(-1).value.includes("'26年 개정")));
 assert.ok(rows('materials').some(r=>r.cells.at(-1).value==='유류 조사\n한국석유공사'));
 assert.ok(rows('labor').some(r=>r.cells.at(-1).value==='2026년 10월 기준 노임\n2026년(하)'));
 assert.equal(JSON.stringify(p),before);
});

test('별도 비고 칸이 없는 단가산출 본문에 내부 메모 N을 삽입하지 않는다',()=>{
 const doc=makePrintDocuments(fixture()).documents.find(d=>d.key==='formulas');
 assert.ok(doc.rows.length);assert.ok(!doc.rows.some(r=>r.cells.some(c=>c.value==='N')));
});

test('같은 비고가 미리보기와 편집 가능한 엑셀 모두에 출력된다',()=>{
 const p=fixture(),sections=['units','machines','materials','labor'];
 const pages=buildPrintPages(makePrintDocuments(p),{sections}),out=printExcelSheets(p,[],{sections});
 const preview=pages.flatMap(p=>p.ops.filter(o=>o.type==='text').map(o=>o.text)).join('\n');
 const excel=out.sheets.flatMap(s=>s.rows.flatMap(r=>r.values)).join('\n');
 for(const note of ['p.837',"'26年 개정",'한국석유공사','2026년(하)']){assert.ok(preview.includes(note),note+' preview');assert.ok(excel.includes(note),note+' Excel');}
 assert.equal(out.sheets.reduce((n,s)=>n+s.pages.length,0),pages.length);
});
