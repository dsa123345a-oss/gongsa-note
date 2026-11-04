import test from 'node:test';import assert from 'node:assert/strict';
import {collectPrintEvidence} from '../dist/print-evidence.js';
import {collectPriceEvidence} from '../dist/price-evidence.js';
import {makePrintDocuments} from '../dist/est-print.js';
import {calculateAssemblyDetailed} from '../dist/estimate-core.js';
import {defaultCharges,totals} from '../dist/calc.js';
import {printExcelSheets} from '../dist/print-excel.js';
import {estExcelTemplate} from '../dist/est-excel-template.js';
const base={spec:'',unit:'인',source:'추가 DB',library:'old',labor:0,material:0,expense:0,other:0};
const labor=(name='보통인부',price=172698,code='L1')=>({...base,name,code,category:'노임',labor:price,total:price});
const assembly=(name,code,components)=>({...base,name,code,unit:'식',category:code.startsWith('E')?'장비':'단가산출',components,...calculateAssemblyDetailed(components).result});
const line=(rate,id='a')=>({id,name:rate.name,qty:1,status:'confirmed',rate,bucket:'direct',bidPercent:95});
const project=lines=>({title:'검증 공사',lines,charges:defaultCharges()});

test('실제 적용된 자원만 수집하고 원본 DB의 이전 가격을 다시 따라가지 않는다',()=>{
 const rate=assembly('터파기','D1',[{...labor(),qty:1}]);
 const old=labor('보통인부',169804),libs=[{id:'old',name:'추가 DB',items:[old,rate],details:[['CostMainDat:D1',[{Code:'L1',Name:'보통인부',GN:1,NU:169804,NC:169804}]]]}];
 const p=project([line(rate)]),before=JSON.stringify(p),g=collectPrintEvidence(p,libs);
 assert.deepEqual(g.nodes.filter(n=>n.kind==='노임').map(n=>n.rate.total),[172698]);assert.equal(JSON.stringify(p),before);
});

test('공백·DB 코드만 다른 동일 노임은 한 번, 실제 서로 다른 적용 단가는 사용처와 함께 보존한다',()=>{
 const p=project([line(labor(),'a'),line({...labor('보 통 인 부',172698,'L2'),source:'10월 DB'},'b'),line(labor('보통인부',169804,'L3'),'c')]);
 const g=collectPrintEvidence(p);assert.equal(g.nodes.length,2);assert.ok(g.nodes.every(n=>n.printUsage));
 const rows=makePrintDocuments(p).documents.find(d=>d.key==='labor').rows;assert.equal(rows.length,2);assert.ok(rows.every(r=>r.cells[5].value.includes('사용:')));
});

test('제외·수량 0·세로 집계 제외 행은 기초단가표에 포함하지 않으며 직접 입력 금액은 보존한다',()=>{
 const p=project([line(labor(),'a'),{...line(labor('제외',100,'L2'),'b'),exclude:true},{...line(labor('영',100,'L3'),'c'),qty:0},{...line(labor('세로제외',100,'L4'),'d'),calculationMode:'vertical'}, {...line(labor('직접금액',100,'L5'),'e'),qty:0,calculationMode:'horizontal',manualAmounts:{labor:100,material:0,expense:0,other:0}}]);
 assert.deepEqual(collectPrintEvidence(p).nodes.map(n=>n.rate.name),['보통인부','직접금액']);
 const r=assembly('구성 제외','D2',[{...labor(),qty:1},{...labor('영',100,'L3'),qtyExpression:'0'},{...labor('제외',100,'L2'),qty:1,exclude:true}]);
 assert.deepEqual(collectPriceEvidence(project([line(r)])).nodes.filter(n=>n.kind==='노임').map(n=>n.rate.name),['보통인부']);
});

test('비목별 장비는 한 대로 출력하되 사용한 비목과 자원만 포함한다',()=>{
 const machine=assembly('램 머','E1',[{...labor('운전사',80000),qty:.125},{...base,name:'연료',code:'M1',category:'자재',material:1000,qty:2},{...base,name:'기타',code:'M2',category:'자재',other:500,qty:1}]);
 const component=k=>({...machine,sourceComponent:k,...Object.fromEntries(['labor','material','expense','other'].map(c=>[c,c===k?machine[c]:0])),total:machine[k]});
 const p=project([line(component('labor'),'a'),line(component('other'),'b')]),before=totals(p.lines,p.charges).grand;
 const g=collectPrintEvidence(p),m=g.nodes.filter(n=>n.kind==='장비');assert.equal(m.length,1);assert.equal(m[0].rate.total,10500);assert.equal(m[0].rate.material,0);
 assert.equal(g.nodes.some(n=>n.rate.name==='연료'),false);
 const docs=makePrintDocuments(p).documents,rows=docs.find(d=>d.key==='machines').rows;
 assert.equal(rows.filter(r=>r.itemStart).length,1);assert.ok(rows.some(r=>r.cells[0].value==='기타'&&r.cells[6].value==='500'));
 assert.equal(rows.some(r=>r.cells[0].value==='연료'),false);assert.equal(totals(p.lines,p.charges).grand,before);
});

test('EST 엑셀의 글꼴·행높이·열너비·제목·숫자 서식을 보존한다',()=>{
 const p=project([line(labor())]),b=printExcelSheets(p,[],{sections:['summary','groups','estimate','labor']});
 for(const [i,s]of b.sheets.slice(0,3).entries()){
  assert.deepEqual(s.columns,estExcelTemplate.sheets[i].columns);assert.deepEqual(s.rows.slice(0,s.header.length),s.header);assert.equal(s.shapes.length,0);
  assert.ok(s.rows.every(r=>r.styles.every(id=>Number.isInteger(id))));
 }
 const count=Number(b.styles.match(/<cellXfs count="(\d+)"/)[1]),inner=b.styles.match(/<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/)[1];
 assert.equal((inner.match(/<xf\b/g)||[]).length,count);
 for(const s of b.sheets)for(const r of s.rows)for(const id of r.styles)assert.ok(id<count);
 assert.ok(b.styles.includes('굴림체'));assert.ok(b.styles.includes('0.00%'));
});

test('주연료 별칭은 실제 적용 참조와 가격·단위가 같을 때만 통합하고 소수 규격은 구별한다',()=>{
 const fuel={...base,name:'경 유',spec:'',code:'M-new',category:'자재',unit:'ℓ',material:1676,total:1676,source:'10월 DB',prices:[1676,0,0,0,0,0]};
 const part={...fuel,name:'주연료',spec:'경유',code:'M-old',library:'old',source:'추가 DB',priceReference:{...fuel,library:'new'}};
 const p=project([line(fuel,'a'),line(part,'b')]),g=collectPrintEvidence(p);assert.equal(g.nodes.length,1);
 const libs=[{id:'old',name:'추가 DB',tables:[{name:'StuffcDat.dat',rows:[{Code:'M-old',Cost1:1200}]}]},{id:'new',name:'10월 DB',tables:[{name:'StuffcDat.dat',rows:[{Code:'M-new',Cost1:1676}]}]}];
 const rows=makePrintDocuments(project([line(part)]),libs).documents.find(d=>d.key==='materials').rows;
 assert.equal(rows[0].cells[4].value,'1,676');assert.equal(rows[0].cells[16].value,'1,676');
 assert.equal(collectPrintEvidence(project([line(fuel,'a'),line({...part,material:1600,total:1600},'b')])).nodes.length,2);
 assert.equal(collectPrintEvidence(project([line({...fuel,spec:'1.5'},'a'),line({...fuel,spec:'15'},'b')])).nodes.length,2);
});

test('미리보기와 엑셀은 같은 셀 모델·글자 크기·행 배치·페이지 나눔을 사용한다',()=>{
 const p=project(Array.from({length:80},(_,i)=>line({...labor(),name:'사용 항목 '+i},String(i))));
 const options={sections:['summary','estimate'],printSettings:{documents:{estimate:{size:11,rowHeight:8,marginLeft:20,marginRight:10,breakRows:'3,17'}}}};
 const b=printExcelSheets(p,[],options),sheet=b.sheets[1],pages=b.pages.filter(p=>p.document==='estimate');
 assert.deepEqual(sheet.rowBreaks,pages.slice(1).map(p=>p.grid.rows.find(r=>!r.header).sheetRow));
 for(const page of pages)for(const row of page.grid.rows){
  assert.ok(Math.abs(row.height-sheet.rows[row.sheetRow].height*.967*sheet.print.scale/100)<.000001);
  for(const c of row.cells)if(!row.header&&c.value)assert.ok(Math.abs(c.fontSize-11*sheet.print.scale/100)<.000001);
 }
 assert.ok(pages.length>2);assert.equal(b.bundle.totals.grand,totals(p.lines,p.charges).grand);
});
