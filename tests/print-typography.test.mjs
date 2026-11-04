import test from 'node:test';import assert from 'node:assert/strict';
import {layoutPrintDocument,printPageSvg,estPrintSettings} from '../dist/est-print.js';
import {measurePrintText} from '../dist/print-typography.js';
const doc={key:'estimate',title:'내역서',projectTitle:'시험',orientation:'landscape',widths:[100],headers:[[{value:'항목'}]],rows:[{cells:[{value:'터파기 25㎥',align:'right'}]}]};
test('미리보기와 엑셀 공통 글꼴로 이전 가로 압축·자간 설정을 정규화한다',()=>{
 const opts=estPrintSettings({documents:{estimate:{fontWidth:60,letterSpacing:.4}}});
 const page=layoutPrintDocument(doc,opts)[0],op=page.ops.find(o=>o.text==='터파기 25㎥');
 assert.equal(op.size,9);assert.equal(op.scale,1);assert.equal(op.spacing,0);assert.equal(op.width,measurePrintText(op.text,9));
 assert.match(printPageSvg(page),/textLength="/);assert.match(printPageSvg(page),/letter-spacing="0"/);
 assert.equal(opts.documents.estimate.fontWidth,100);assert.equal(opts.documents.estimate.letterSpacing,0);
});

test('굴림체 전각 기호를 반각 숫자와 구별하고 긴 항목을 셀 안에 맞춘다',()=>{
 assert.equal(measurePrintText('×²',10),20);assert.equal(measurePrintText('12',10),10);
 const narrow={...doc,widths:[5,95],singleLine:true,rows:[{cells:[{value:'아주 긴 단가 품명 12345',fit:true},{value:''}]}]};
 const page=layoutPrintDocument(narrow)[0],op=page.ops.find(o=>o.text==='아주 긴 단가 품명 12345');assert.ok(op.width<=page.grid.cols[0]-5+.001);
});
