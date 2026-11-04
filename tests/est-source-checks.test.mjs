import test from 'node:test';import assert from 'node:assert/strict';
import {projectFromEst} from '../dist/est-project.js';
import {inspectEstSource,emptyEstMessage} from '../dist/est-source-checks.js';
import {totals} from '../dist/calc.js';
const lib=rows=>({id:'test',name:'test.estx',items:[],tables:[{name:'EstMainDat.dat',rows:rows.map((r,i)=>({...r,_record:i}))}]});
const item=(Name,n)=>({Name,Code:'U1',GN:1,Unite:'식',TU:n,GU:n,TC:n,GC:n});

test('source checks locate stale section totals without treating subtotal rows as extra work',()=>{
 const rows=[{Name:'공사',Level:2,TC:150,GC:150},{Name:'자재',Level:1,TC:150,GC:150},item('소켓',100),{Name:'순 공 사 비',LinkIndex:54,TC:150,GC:150}].map((r,i)=>({...r,_record:i}));
 const issues=inspectEstSource(rows);assert.equal(issues.length,3);assert.equal(issues.find(i=>i.level===1).calculated.TC,100);
 const p=projectFromEst(lib(rows));assert.equal(totals(p.lines,[]).direct,100);assert.equal(p.lines.filter(l=>!l.level).length,1);assert.match(p.estImport.warnings[0],/저장 합계 150원.*100원/);
});
test('an empty cost template never becomes a verified cost sheet for missing direct work',()=>{
 const p=projectFromEst(lib([{Name:'순공사비',LinkIndex:54,TC:1000},{Name:'도급예정액',LinkIndex:58,TC:1300},{Name:'총공사비',LinkIndex:58,TC:1300},{Name:'폐기물처리비',Level:1},item('폐기물',100)]),[{index:125,rows:[{Name:'직접노무비',Cost:0},{Name:'간접재료비',Cost:0},{Name:'총공사비',Cost:0,Gubun:'M'}]}]);
 assert.equal(p.estImport.costTable,undefined);assert.equal(p.charges.length,0);assert.equal(p.estImport.comparisons.find(c=>c.name==='총공사비').original,1300);
});
test('all direct cost components disambiguate cost tables and split direct/indirect material totals',()=>{
 const base=[{Name:'직접노무비',Cost:0},{Name:'직접재료비',Cost:40},{Name:'간접재료비',Cost:60}];
 const p=projectFromEst(lib([item('자재',100)]),[{index:1,rows:[...base,{Name:'산출경비',Cost:20}]},{index:2,rows:[...base,{Name:'산출경비',Cost:0}]}]);
 assert.equal(p.estImport.costTable,2);
});
test('inspection stays outside contract when its detailed amount differs from source cost sheet',()=>{
 const rows=[{Name:'직접노무비',Cost:0},{Name:'간접재료비',Cost:1000},{Name:'총원가',Gubun:'G',Cost:1000},{Name:'폐기물처리비',Gubun:'H',Cost:100},{Name:'부가가치세',Gubun:'I',Cost:115,Youl:'10%',VSusic:'(G+H+K)*0.1'},{Name:'도급예정액',Gubun:'J',Cost:1215,VSusic:'G+H+I'},{Name:'현장점검비',Gubun:'K',Cost:50},{Name:'총공사비',Gubun:'L',Cost:1265,VSusic:'J+K'}];
 const p=projectFromEst(lib([item('자재',1000),{Name:'순공사비',LinkIndex:54,TC:1000}, {Name:'현장점검비',Level:1},item('현장점검비',53),{Name:'폐기물처리비',Level:1},item('폐기물',100)]),[{index:7,rows}]);
 const t=totals(p.lines,p.charges);assert.equal(t.contract,1215);assert.equal(t.grand,1268);assert.equal(p.estImport.comparisons.find(c=>c.name==='현장점검비').difference,3);
 p.lines[2].qty=2;assert.equal(totals(p.lines,p.charges).contract,1220);assert.equal(totals(p.lines,p.charges).grand,1326);
});
test('partial uncoded rows and genuinely empty projects have distinct actionable errors',()=>{
 assert.match(emptyEstMessage([item('터파기',100)]),/품목 1행.*전체 공사/);
 assert.match(emptyEstMessage(Array.from({length:12},()=>({Name:null,TC:null}))),/12행이 비어/);
});
