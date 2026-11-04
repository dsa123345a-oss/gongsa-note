import test from 'node:test';
import assert from 'node:assert/strict';
import {priceBasisLabel} from '../dist/price-basis-label.js';
import {makePrintDocuments,buildPrintPages} from '../dist/est-print.js';
import {printExcelSheets} from '../dist/print-excel.js';
import {defaultCharges} from '../dist/calc.js';

test('실제 적용 DB의 기준월로 표시하고 기준월을 모르면 10월로 추정하지 않는다',()=>{
 assert.equal(priceBasisLabel({source:'2026-10-main.estx'}),'2026년 10월 기준 노임');
 assert.equal(priceBasisLabel({source:'2027-01-main.estx'}),'2027년 1월 기준 노임');
 assert.equal(priceBasisLabel({source:'2026년 9월 노임'}),'2026년 9월 기준 노임');
 assert.equal(priceBasisLabel({source:'상수도공사메인(26년)소형감압변 수정.ebkx'}),'추가 DB 기준 노임');
 assert.equal(priceBasisLabel({source:'2026-13-main.estx'}),'노임 기준월 미확인');
 assert.equal(priceBasisLabel({source:'기존공사.estx'}),'노임 기준월 미확인');
 assert.equal(priceBasisLabel({source:'나의 단가',table:'UserQuote'}),'직접 입력 노임');
 assert.equal(priceBasisLabel({source:'2026-10-main.estx',manual:true}),'직접 입력 노임');
});

test('노임단가 미리보기와 엑셀의 적용기준에서 파일명을 빼고 원본 출처는 보존한다',()=>{
 const rate={name:'보통인부',unit:'인',code:'L1',category:'노임',source:'2026-10-main.estx',labor:172698,material:0,expense:0,other:0,total:172698};
 const p={schema:1,title:'기준월 출력 검증',lines:[{id:'l',name:rate.name,qty:1,status:'confirmed',rate}],charges:defaultCharges()},before=JSON.stringify(p);
 const b=makePrintDocuments(p),pages=buildPrintPages(b,{sections:['labor']}),out=printExcelSheets(p,[],{sections:['labor']});
 assert.ok(pages[0].ops.some(o=>o.text==='2026년 10월 기준 노임'));
 assert.ok(!pages[0].ops.some(o=>o.text?.includes('.estx')));
 assert.ok(out.sheets[0].rows.some(r=>r.values.includes('2026년 10월 기준 노임')));
 assert.equal(JSON.stringify(p),before);
});
