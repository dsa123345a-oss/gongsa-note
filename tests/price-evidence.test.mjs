import test from 'node:test';
import assert from 'node:assert/strict';
import {collectPriceEvidence,evidenceSheetNames} from '../dist/price-evidence.js';
import {buildPriceEvidence} from '../dist/price-evidence-workbook.js';
import {contractorTemplateSheets} from '../dist/contractor-template-export.js';
import {evidenceEstimateSheets} from '../dist/evidence-estimate.js';
import {calculateAssemblyDetailed} from '../dist/estimate-core.js';
import {defaultCharges} from '../dist/calc.js';
export function fixture(){
 const labor={name:'보통인부',code:'L1',unit:'인',category:'노임',labor:172698,material:0,expense:0,other:0,total:172698,source:'10월 메인'},fuel={name:'경유',code:'M1',unit:'L',category:'자재',labor:0,material:1456,expense:0,other:0,total:1456,source:'10월 메인'};
 const make=(name,code,components,calculation={})=>({name,code,unit:'식',spec:'',category:code[0]==='E'?'장비':'단가산출',source:'추가 DB',components,calculation,...calculateAssemblyDetailed(components,calculation).result});
 const machine=make('굴삭기','E1',[{...labor,qtyExpression:'1/8'},{...fuel,qtyExpression:'5.3'},{kind:'percent',name:'잡유',basis:'material',target:'material',percent:10}],{componentDigits:1});
 const rate=make('터파기','D1',[{...machine,qtyExpression:'1/Q'},{...labor,qtyExpression:'0.01'},{kind:'subtotal',name:'ADD',basis:'total',scope:'all',startRow:1},{kind:'percent',name:'잡비',basis:'total',scope:'nearest',target:'components',percent:2}],{variables:'A = 2\nQ = A*3',outputQuantity:1,componentDigits:1});
 return {schema:1,title:'산출근거 연결 검증',lines:[{id:'l1',name:rate.name,spec:'',unit:'식',group:'토공',bucket:'direct',qty:3.4,status:'confirmed',bidPercent:95,rate}],charges:defaultCharges()};
}
test('중첩 기계경비·노임·연료와 변수·ADD·잡비를 네 근거표로 연결',()=>{
 const p=fixture(),graph=collectPriceEvidence(p),b=buildPriceEvidence(p);
 assert.equal(graph.nodes.length,4);assert.ok(graph.nodes.filter(n=>n.sheet<2).every(n=>n.verified));
 assert.deepEqual(b.sheets.map(s=>s.name),evidenceSheetNames);assert.deepEqual(b.counts.map(c=>c.count),[1,1,1,1]);
 assert.equal(b.warnings.length,0);assert.match(b.sheets[0].rows.find(r=>r.values[2]==='굴삭기').values[6].formula,/'기계경비단가산출표'/);
 assert.match(b.sheets[1].rows.find(r=>r.values[2]==='경유').values[7].formula,/'자재단가표'/);
 const output=evidenceEstimateSheets(p);assert.match(output.sheets[0].rows[3].values[6].formula,/일위단가표/);
 assert.equal(contractorTemplateSheets(p).sheets.length,3);
});
test('원본 산식 미확인 항목은 추정하지 않고 적용 단가 직접 입력으로 표시',()=>{
 const p=fixture();delete p.lines[0].rate.components;delete p.lines[0].rate.calculation;
 const b=buildPriceEvidence(p);assert.match(b.warnings.join(' '),/구성 근거 없음/);
 assert.ok(b.sheets[0].rows.some(r=>r.values[2]==='적용 단가 직접 입력'));assert.equal(b.lineRefs.get('l1').verified,false);
});
test('같은 코드의 DB·값·비목별 근거를 합치지 않고 원본도 변경하지 않는다',()=>{
 const p=fixture(),l=structuredClone(p.lines[0]);l.id='l2';l.rate.source='다른 DB';p.lines.push(l);const before=JSON.stringify(p);
 const b=buildPriceEvidence(p);assert.equal(b.counts[0].count,2);assert.notDeepEqual(b.lineRefs.get('l1').refs,b.lineRefs.get('l2').refs);assert.equal(JSON.stringify(p),before);
});
test('편집창에서 문자열로 저장된 구성 단가는 엑셀 숫자로 출력한다',()=>{
 const p=fixture();p.lines[0].rate.components[1].labor='172698';const b=buildPriceEvidence(p);
 for(const row of b.sheets[3].rows.filter(r=>r.values[2]==='적용 기초단가'))assert.equal(typeof row.values[6],'number');
});
