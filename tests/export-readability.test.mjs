import test from 'node:test';
import assert from 'node:assert/strict';
import {fullPdfDownloadSettings,allPreviewSettings} from '../dist/est-print-preview.js';
import {makePrintDocuments,buildPrintPages} from '../dist/est-print.js';
import {printExcelSheets} from '../dist/print-excel.js';
import {nativeCellStyles} from '../dist/native-print-layout.js';
import {defaultCharges,totals} from '../dist/calc.js';
const project=()=>({schema:1,title:'긴 공사명 후포면 급수관 긴급보수 및 교체',charges:defaultCharges(),lines:[
 {id:'root',level:2,name:'1공구 상세 현장 주소 '.repeat(8),bucket:'direct'},
 {id:'heading',level:1,name:'토공 및 포장 철거 복구 공종 '.repeat(8),bucket:'direct'},
 {id:'item',name:'긴 자재 이름 '.repeat(15),spec:'현장 특수 규격 '.repeat(12),qty:12345678.123456,unit:'m',bucket:'direct',bidPercent:95,status:'confirmed',rate:{code:'M1',category:'자재',name:'검증',spec:'',unit:'m',labor:100,material:20,expense:5,other:0,total:125}}
]});
test('전체 PDF는 체크 여부와 관계없이 미리보기의 모든 페이지를 출력하고 기존 선택 설정을 보존한다',()=>{
 const p=project(),settings={sections:['labor','materials'],startPage:25,documents:{estimate:{size:9}}},before=structuredClone(settings);
 const bundle=makePrintDocuments(p),pages=buildPrintPages(bundle,fullPdfDownloadSettings(settings,bundle));
 assert.deepEqual(pages,buildPrintPages(bundle,allPreviewSettings(settings,bundle)));
 assert.deepEqual([...new Set(pages.map(p=>p.document))],bundle.documents.filter(d=>d.rows.length).map(d=>d.key));
 assert.ok(pages.some(p=>p.document==='groups'));
 assert.ok(pages.some(p=>p.document==='materials'));
 assert.deepEqual(pages.map(p=>p.number),pages.map((_,i)=>i+25));
 assert.deepEqual(settings,before);
 assert.equal(pages.filter(p=>p.document==='summary').length,1);
});
test('전체 PDF에 일위·단가산출·장비·노임 근거를 포함하며 출력 옵션은 유지한다',()=>{
 const p=project();
 for(const [category,code] of [['일위대가','U1'],['단가산출','D1'],['장비','E1'],['노임','L1']])p.lines.push({...p.lines[2],id:code,qty:1,rate:{...p.lines[2].rate,category,code,name:category}});
 const bundle=makePrintDocuments(p),settings={sections:['summary'],documents:{estimate:{breakRows:'3,5'}}},before=structuredClone(settings);
 const pages=buildPrintPages(bundle,fullPdfDownloadSettings(settings,bundle));
 for(const key of ['summary','groups','estimate','units','formulas','machines','materials','labor'])assert.ok(pages.some(p=>p.document===key),key);
 assert.deepEqual(pages,buildPrintPages(bundle,allPreviewSettings(settings,bundle)));
 assert.deepEqual(settings,before);
});
test('긴 이름은 읽을 수 있게 병합·높이 확장하고 긴 수량과 요율은 값 손실 없이 표시한다',()=>{
 const p=project(),before=structuredClone(p),total=totals(p.lines,p.charges),out=printExcelSheets(p,[],{sections:['summary','groups','estimate']}),styles=nativeCellStyles(out.styles);
 const detail=out.sheets.find(s=>s.name==='내역서'),heading=detail.rows.findIndex(r=>String(r.values[2]).startsWith('토공'));
 assert.ok(detail.merges.includes(`C${heading+1}:F${heading+1}`));
 assert.ok(detail.rows[heading].height>25);
 const row=detail.rows.find(r=>r.values[4]===p.lines[2].qty);assert.ok(row);
 for(const c of [2,3]){assert.ok(styles[row.styles[c]].size>=7.5);assert.ok(String(row.values[c]).includes('\n'));}
 assert.ok(detail.columns[4].width>10);assert.equal(styles[row.styles[4]].shrink,true);
 const cost=out.sheets.find(s=>s.name==='원가계산서');assert.ok(cost.columns[6].width>=7.5);
 assert.deepEqual(totals(p.lines,p.charges),total);assert.deepEqual(p,before);
});
