import test from 'node:test';
import assert from 'node:assert/strict';
import {layoutPrintDocument,makePrintDocuments,buildPrintPages,printPageSvg} from '../dist/est-print.js';
import {evidenceContent} from '../dist/evidence-workspace.js';
import {vectorPrintExcelSheets} from '../dist/print-excel.js';
import {defaultCharges} from '../dist/calc.js';
const cell=value=>({value,align:'left'});
const line=(text,extra={})=>({cells:[{...cell(text),preserveSpace:true},...Array.from({length:4},()=>cell(''))],...extra});
const fraction=()=>[
 line('        3,600 × q × K × f × E           3,600 × 0.2 × 0.9 × 0.81 × 0.6',{formulaBlock:'q'}),
 line(' Q = ──────────────────────── = ─────────────────────────────────── = 21 ㎥/hr',{formulaBlock:'q'}),
 line('                 Cm                                  15',{formulaBlock:'q'})
];
const doc=rows=>({key:'formulas',title:'단가산출',projectTitle:'시험 공사',widths:[67,9,8,8,8],orientation:'portrait',headers:[['산출근거','합계','노무비','재료비','경비'].map(cell)],verticalOnly:true,rows});

test('EST 분수의 세 줄은 같은 글자 크기로 맞추며 페이지 경계에서 함께 이동한다',()=>{
 const original=doc([...Array.from({length:49},(_,i)=>line('설명 '+i)),...fraction(),line('이후 설명')]),before=structuredClone(original);
 const pages=layoutPrintDocument(original),groups=pages.filter(p=>p.grid.rows.some(r=>r.formulaBlock==='q'));
 assert.equal(groups.length,1);const rows=groups[0].grid.rows.filter(r=>r.formulaBlock==='q');assert.equal(rows.length,3);
 const sizes=rows.map(r=>r.cells[0].fontSize);assert.ok(sizes.every(s=>s===sizes[0]));assert.ok(sizes[0]<10.5);
 for(const r of rows){assert.equal(r.cells[0].lines.length,1);assert.equal(r.cells[0].keepFont,true);}
 const texts=groups[0].ops.filter(o=>o.type==='text'&&rows.some(r=>r.cells[0].value===o.text));
 assert.ok(texts.every(o=>o.x+o.width<=groups[0].grid.left+groups[0].grid.cols[0]));
 assert.deepEqual(original,before);
});

test('분수 내부의 지정 페이지 나누기는 분수 전체 앞으로 옮긴다',()=>{
 const pages=layoutPrintDocument(doc([line('앞 설명'),...fraction(),line('뒷 설명')]),{documents:{formulas:{breakRows:[3]}}});
 assert.equal(pages.length,2);assert.equal(pages[0].grid.rows.filter(r=>r.formulaBlock).length,0);assert.equal(pages[1].grid.rows.filter(r=>r.formulaBlock).length,3);
});

const fixture=()=>{
 const rate={name:'터파기 <시험>',spec:'백호0.2㎥',unit:'㎥',code:'D1',category:'단가산출',source:'추가 DB',labor:100,material:20,expense:5,other:0,total:125};
 const raw=[{TitleCode:'D1',NC:100,GC:20,JC:5,TC:125},...['1. 기 계 (90%)','q = 0.2㎥  f = 1/1.24 = 0.81  K = 0.9',...fraction().map(r=>r.cells[0].value),'작업조건 <설명>'].map((LineData,i)=>({LineData,_record:i+1}))];
 return {project:{schema:1,title:'원문 표기 시험',lines:[{id:'l',name:rate.name,group:'토공',spec:rate.spec,unit:rate.unit,qty:1,bucket:'direct',status:'confirmed',rate}],charges:defaultCharges(),evidence:[{rate,rows:raw}]},rate,raw};
};

test('화면·미리보기·엑셀은 원문 작업조건과 동일 분수 행을 보존한다',()=>{
 const {project,rate,raw}=fixture(),before=structuredClone(project);
 const html=evidenceContent({rate,kind:'일위대가',raw,issues:[],verified:false});
 assert.match(html,/basis-est-formula/);assert.match(html,/q = 0.2㎥/);assert.match(html,/&lt;설명&gt;/);assert.doesNotMatch(html,/<설명>/);
 const bundle=makePrintDocuments(project),formulas=bundle.documents.find(d=>d.key==='formulas');
 assert.ok(formulas.rows.some(r=>r.cells[0].value.includes('f = 1/1.24')));
 const pages=buildPrintPages(bundle,{sections:['formulas']}),svg=printPageSvg(pages[0]);assert.match(svg,/xml:space="preserve"/);
 const excel=vectorPrintExcelSheets(project,[],{sections:['formulas']});
 const rows=excel.sheets[0].rows.filter(r=>typeof r.values[0]==='string'&&fraction().some(f=>f.cells[0].value===r.values[0]));assert.equal(rows.length,3);
 assert.equal(new Set(rows.map(r=>r.styles[0])).size,1);
 assert.deepEqual(project,before);
});
