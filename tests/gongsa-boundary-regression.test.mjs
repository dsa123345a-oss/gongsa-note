import test from 'node:test';
import assert from 'node:assert/strict';
import {calculateAssemblyDetailed,chooseQuote} from '../dist/estimate-core.js';
import {quotePrice} from '../dist/quote-core.js';
import {resourceReport,validateSchedule} from '../dist/work-core.js';
import {formulaDisplayRows} from '../dist/formula-print.js';
import {makePrintDocuments} from '../dist/est-print.js';

const resource={name:'보통인부',code:'L1',source:'검증',spec:'',unit:'인',category:'노임',qty:4,labor:100,material:0,expense:0,other:0,total:100};
const conversion={kind:'percent',name:'단위환산',scope:'all',basis:'total',target:'components',percent:25,replaceRunning:true};
const project=rate=>({schema:1,title:'경계 검증',location:'',charges:[],lines:[{id:'a',name:'검증 작업',group:'토공',spec:'',unit:'식',qty:2,factor:1,bucket:'direct',status:'confirmed',rate}]});
const assembly=(parts,calculation={})=>({name:'시험 단산',spec:'',unit:'식',category:'단가산출',code:'D1',source:'검증',components:parts,calculation,...calculateAssemblyDetailed(parts,calculation).result});

test('excluded or vertically disabled conversion rows cannot erase included assembly amounts',()=>{
 for(const disabled of [{exclude:true},{calculationMode:'vertical'},{calculationMode:'both',manualAmounts:{labor:100,material:0,expense:0,other:0}}]){
  const parts=[resource,{...conversion,...disabled}],before=structuredClone(parts),rate=assembly(parts);
  assert.equal(rate.labor,400);assert.equal(rate.total,400);assert.deepEqual(parts,before);
  const report=resourceReport(project(rate),[]);assert.equal(report.rows[0].qty,8);assert.deepEqual(report.warnings,[]);
 }
 assert.equal(assembly([resource,conversion]).labor,100);
});

test('a percentage expression uses its evaluated value in resource quantities and printed evidence',()=>{
 const parts=[resource,{...conversion,percent:'P/2'}],calculation={variables:'P=50'},rate=assembly(parts,calculation),calc=calculateAssemblyDetailed(parts,calculation);
 assert.equal(rate.total,100);assert.equal(calc.rows[1].percent,25);assert.equal(parts[1].percent,'P/2');
 const report=resourceReport(project(rate),[]);assert.equal(report.rows[0].qty,2);assert.deepEqual(report.warnings,[]);
 const text=formulaDisplayRows(calc).map(r=>r.text).join('\n');assert.match(text,/400 × 25%/);assert.doesNotMatch(text,/NaN/);
 const printed=makePrintDocuments(project(rate),[]).documents.find(d=>d.key==='formulas');
 assert.match(JSON.stringify(printed.rows),/400 × 25%/);assert.doesNotMatch(JSON.stringify(printed.rows),/NaN/);
});

test('negative directly entered or selected quote prices produce the intended validation message',()=>{
 assert.throws(()=>quotePrice([100],{method:'manual',manual:-1}),/^Error: 입력 단가를 확인하세요\.$/);
 assert.throws(()=>chooseQuote([-1],'selected',0),/^Error: 선택한 조사단가가 없습니다\.$/);
 assert.equal(quotePrice([100],{method:'manual',manual:0}),0);
 assert.equal(chooseQuote([0],'selected',0),0);
});

test('schedule dates must be real ISO calendar dates for both start and finish',()=>{
 for(const [start,end] of [['2026-02-30','2026-03-03'],['2026-02-01','2026-02-30'],['2026-02-01','March 3, 2026'],['2026-2-1','2026-02-02'],['2026-02-01','']]){
  assert.throws(()=>validateSchedule([{group:'토공',start,end,progress:0}]),/시작일·종료일/);
 }
 const rows=[{group:'토공',start:'2028-02-29',end:'2028-03-01',progress:0},{group:'포장공',start:'',end:'',progress:100}];
 assert.equal(validateSchedule(rows),rows);
});
