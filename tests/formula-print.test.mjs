import test from 'node:test';
import assert from 'node:assert/strict';
import {formulaDisplayRows} from '../dist/formula-print.js';
test('같은 장비의 비목 투영은 한 제목 아래 실제 적용 단가와 작업량으로 출력한다',()=>{
 const part=k=>({name:'굴삭기',spec:'0.2㎥',code:'E1',source:'DB',sourceComponent:k,section:'1',qtyExpression:'1/Q1*0.8',[k]:100,amount:{labor:0,material:0,expense:0,other:0,[k]:4,total:4}});
 const calc={variables:[{name:'Q1',expression:'20',value:20}],rows:['labor','material','expense'].map(part)},before=structuredClone(calc),rows=formulaDisplayRows(calc);
 assert.equal(rows.filter(r=>r.text.includes('굴삭기')).length,1);assert.equal(rows[0].text,'  Q1 = 20');
 assert.equal(rows.filter(r=>r.text.includes('100 × (1 ÷ (20) × 0.8) = 4')).length,3);assert.deepEqual(calc,before);
 const different=formulaDisplayRows({...calc,rows:[part('labor'),{...part('material'),qtyExpression:'1/Q1*0.5'}]});assert.equal(different.filter(r=>r.text.includes('굴삭기')).length,2);
 const repeated=formulaDisplayRows({...calc,rows:[part('labor'),part('labor')]});assert.equal(repeated.filter(r=>r.text.includes('굴삭기')).length,2);
});
