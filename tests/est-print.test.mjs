import test from 'node:test';import assert from 'node:assert/strict';
import {makePrintDocuments,buildPrintPages,estPrintSettings,printPageSvg,printDocuments} from '../dist/est-print.js';
import {defaultCharges,totals,amount} from '../dist/calc.js';
const rate=(extra={})=>({code:'D1',name:'터파기',spec:'D25',unit:'m',category:'단가산출',source:'추가',labor:100,material:20,expense:5,other:0,total:125,...extra});
const line=(id,extra={})=>({id,name:'터파기',spec:'D25',unit:'m',group:'토공',bucket:'direct',qty:3,bidPercent:95,status:'confirmed',rate:rate(),...extra});
const project=()=>({schema:1,title:'시험 공사',lines:[line('l')],charges:defaultCharges()});
test('인쇄값은 현재 수량·낙찰률·원가와 일치하며 원본을 수정하지 않는다',()=>{
 const p=project(),before=structuredClone(p),b=makePrintDocuments(p),r=b.documents.find(d=>d.key==='estimate').rows[0];
 assert.equal(r.cells[6].value,amount(p.lines[0]).total.toLocaleString('ko-KR'));
 const grand=b.documents.find(d=>d.key==='summary').rows.find(r=>r.costId==='grand');assert.equal(grand.cells.find(c=>c.align==='right').value,totals(p.lines,p.charges).grand.toLocaleString('ko-KR'));assert.deepEqual(p,before);
 for(const d of b.documents)for(const r of d.rows)assert.equal(r.cells.reduce((n,c)=>n+(c.span||1),0),d.widths.length,d.key);
});
test('동일 적용 단가는 한 번만 출력하며 금액이 다른 적용 단가는 보존한다',()=>{
 const p=project();p.lines.push(line('b',{rate:rate({id:'different-db-row'})}));let b=makePrintDocuments(p);assert.equal(b.documents.find(d=>d.key==='formulas').rows.filter(r=>r.itemStart).length,1);
 p.lines.push(line('c',{rate:rate({labor:200,total:225})}));b=makePrintDocuments(p);assert.equal(b.documents.find(d=>d.key==='formulas').rows.filter(r=>r.itemStart).length,2);
});
test('원본 산식의 기계 참조는 같은 DB에서만 해결해 기계경비에 포함한다',()=>{
 const p=project(),machine=rate({code:'E1',name:'굴삭기',category:'장비',table:'MachTitleDat'}),lib={id:'a',name:'추가',items:[machine],details:[['CostMainDat:D1',[{TitleCode:'D1'},{Code:'E1',LineData:'굴삭기 작업'}]]]};
 const b=makePrintDocuments(p,[lib,{id:'b',name:'다른 DB',items:[{...machine,total:999,source:'다른 DB'}]}]);
 const rows=b.documents.find(d=>d.key==='machines').rows;assert.equal(rows.filter(r=>r.itemStart).length,1);assert.equal(rows[0].cells[3].value,'125');
});
test('문서 방향·연속 번호·강제 페이지 나누기를 보존한다',()=>{
 const p=project();p.lines=Array.from({length:50},(_,i)=>line('l'+i));const b=makePrintDocuments(p);
 const opts={sections:['summary','estimate'],startPage:15,documents:{estimate:{breakRows:'3,10'}}},pages=buildPrintPages(b,opts);assert.equal(pages[0].orientation,'portrait');assert.ok(pages.filter(p=>p.document==='estimate').every(p=>p.orientation==='landscape'));assert.deepEqual(pages.map(p=>p.number),pages.map((_,i)=>i+15));
 for(const p of pages)for(const o of p.ops){assert.ok(Number.isFinite(o.x)&&Number.isFinite(o.y));assert.ok(o.y>=0&&o.y<=p.height);if(o.type==='rect')assert.ok(o.y+o.height<=p.height);}
 assert.ok(pages.length>=5);assert.throws(()=>estPrintSettings({startPage:1.2}));assert.throws(()=>estPrintSettings({documents:{estimate:{breakRows:'a'}}}));
});
test('현재 인쇄항목만 출력하고 수식의 HTML은 실행되지 않는다',()=>{
 const p=project();p.title='<script>alert(1)</script>';const b=makePrintDocuments(p),pages=buildPrintPages(b,{sections:['summary']});assert.ok(pages.every(p=>p.document==='summary'));const svg=printPageSvg(pages[0]);assert.doesNotMatch(svg,/<script>/);assert.match(svg,/&lt;script&gt;/);assert.deepEqual(b.documents.map(d=>d.key),Object.keys(printDocuments));
});

test('노무비만 있는 일위·단산은 노임 단가표로 잘못 분류하지 않는다',()=>{const p=project();p.lines=[line('u',{rate:rate({code:'U1',category:'내역단가',labor:100,material:0,expense:0,total:100})}),line('d',{rate:rate({code:'D1',category:'내역단가',labor:100,material:0,expense:0,total:100})})];const b=makePrintDocuments(p);assert.equal(b.documents.find(d=>d.key==='labor').rows.length,0);assert.equal(b.documents.find(d=>d.key==='units').rows.filter(r=>r.itemStart).length,1);assert.equal(b.documents.find(d=>d.key==='formulas').rows.filter(r=>r.itemStart).length,1);});
