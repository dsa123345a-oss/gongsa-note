import test from 'node:test';
import assert from 'node:assert/strict';
import {extractQuantities} from '../dist/workbook.js';
import {supplementGovernmentQuantities} from '../dist/quantity-government.js';
import {buildQuantityProject} from '../dist/quantity-batch.js';
import {previewSupplyFees} from '../dist/supply-fees.js';

const row=(index,values)=>({index,cells:Object.fromEntries(Object.entries(values).map(([col,value])=>[col,{ref:col+index,formula:'',cached:true,value,...(value&&typeof value==='object'?value:{})}]))});
const sheet=(name,items)=>({name,rows:[row(1,{A:'공사명',C:'상수도 신규급수공사(시험)'}),row(4,{A:'구분',B:'품명',C:'규격',D:'수량',E:'단위'}),...items.map((item,i)=>row(i+5,{A:item.group||'6.관급자재대',B:item.name||'수도미터',C:item.spec||'D20',D:item.qty===undefined?1:item.qty,E:item.unit||'개'}))]});
const empty=()=>sheet('수량',[{group:'1.토공',name:'터파기',spec:'보통토사',qty:3,unit:'㎥'}]);
const government=(name='관로도',spec='D20',qty=1)=>sheet(name,[{name:'계량기보호함',spec:'D20',qty:1},{name:'수도미터',spec,qty}]);

test('선택한 수량에 없는 관급자재를 세 번째 관로도 시트에서만 보충한다',()=>{
 const sheets=[empty(),sheet('토공',[{group:'1.토공',name:'되메우기',qty:9}]),government()];
 const selected=extractQuantities(sheets[0]);selected.location='시험 위치';selected.custom={keep:true};const original=structuredClone(selected),source=structuredClone(sheets);
 const result=supplementGovernmentQuantities(sheets,0,selected);
 assert.equal(result.rows.length,3);assert.deepEqual(result.rows[0],selected.rows[0]);assert.equal(result.location,'시험 위치');assert.deepEqual(result.custom,{keep:true});assert.equal(result.title,selected.title);
 assert.deepEqual(result.governmentSupplement,{added:2,corrected:0,sourceSheets:['관로도'],warnings:[]});
 assert.equal(result.rows[2].source,'관로도!B6 / D6');assert.equal(result.rows[2].bucket,'government');assert.deepEqual(selected,original);assert.deepEqual(sheets,source);
 const p=buildQuantityProject({title:'',lines:[],charges:[]},[{file:'신규급수.xlsx',quantity:result}]);
 assert.equal(previewSupplyFees(p).diameter,20);assert.equal(previewSupplyFees(p).canApply,true);
});

test('기존 수량 시트의 관급자재가 있으면 다른 시트보다 우선하고 재실행도 중복되지 않는다',()=>{
 const sheets=[government('수량','D15',2),government('관로도','D50',8)],selected=extractQuantities(sheets[0]);
 const result=supplementGovernmentQuantities(sheets,0,selected);
 assert.deepEqual(result.rows,selected.rows);assert.equal(result.governmentSupplement.added,0);assert.deepEqual(result.governmentSupplement.sourceSheets,[]);
 const missing=[empty(),government()],once=supplementGovernmentQuantities(missing,0),twice=supplementGovernmentQuantities(missing,0,once);
 assert.deepEqual(twice,once);
});

test('여러 시트에 같은 관급목록이 반복되면 한 번만 보충한다',()=>{
 const sheets=[empty(),government('관로도','D20',2),government('관로도 사본','D20mm',2)];
 const result=supplementGovernmentQuantities(sheets,0);
 assert.equal(result.governmentSupplement.added,2);assert.deepEqual(result.governmentSupplement.sourceSheets,['관로도','관로도 사본']);assert.equal(result.rows.filter(r=>r.name==='수도미터').length,1);assert.equal(result.rows.at(-1).qty,2);
});

test('서로 다른 관급 품목은 합치되 수량·단위·같은 행 개수 충돌은 자동 선택하지 않는다',()=>{
 const distinct=supplementGovernmentQuantities([empty(),sheet('계량기',[{}]),sheet('보호함',[{name:'계량기보호함'}])],0);
 assert.equal(distinct.governmentSupplement.added,2);
 for(const changed of [[{qty:2}],[{unit:'조'}],[{},{}]]){
  const sheets=[empty(),sheet('관로도',[{}]),sheet('관급목록',changed)],selected=extractQuantities(sheets[0]),result=supplementGovernmentQuantities(sheets,0,selected);
  assert.deepEqual(result.rows,selected.rows);assert.equal(result.governmentSupplement.added,0);assert.equal(result.governmentSupplement.corrected,0);assert.equal(result.governmentSupplement.warnings.length,1);
 }
});

test('한 시트에 실제 같은 관급자재가 두 행이면 임의 합산·삭제하지 않는다',()=>{
 const result=supplementGovernmentQuantities([empty(),sheet('관로도',[{},{}])],0);
 assert.equal(result.governmentSupplement.added,2);assert.equal(result.rows.filter(r=>r.name==='수도미터').length,2);
});

test('폐기물로 오분류된 동일 계량기 자재만 관급으로 고치고 수량·수식·출처를 유지한다',()=>{
 const source=sheet('수량',[{group:'5.폐기물처리비',name:'수도미터',spec:'D20',qty:1,unit:'개'}]);
 const selected=extractQuantities(source);selected.rows[0].formula='SUM(B1:B2)';selected.rows[0].custom='그대로';const original=structuredClone(selected);
 const result=supplementGovernmentQuantities([source,government()],0,selected),corrected=result.rows[0];
 assert.equal(result.governmentSupplement.corrected,1);assert.equal(result.governmentSupplement.added,1);assert.equal(corrected.bucket,'government');assert.equal(corrected.group,'6.관급자재대');assert.equal(corrected.id,selected.rows[0].id);assert.equal(corrected.source,selected.rows[0].source);assert.equal(corrected.formula,'SUM(B1:B2)');assert.equal(corrected.custom,'그대로');assert.equal(corrected.governmentSupplement.previousBucket,'waste');assert.equal(corrected.governmentSupplement.source,'관로도!B6 / D6');assert.deepEqual(selected,original);
});

test('계량기 설치 작업비는 동일 명칭·규격·수량이어도 관급자재로 이동하지 않는다',()=>{
 const source=sheet('수량',[{group:'2.배관공',name:'계량기 설치',spec:'D20',qty:1,unit:'개'}]);
 const selected=extractQuantities(source),result=supplementGovernmentQuantities([source,sheet('관로도',[{name:'계량기 설치'}])],0,selected);
 assert.deepEqual(result.rows[0],selected.rows[0]);assert.equal(result.governmentSupplement.corrected,0);assert.equal(result.governmentSupplement.added,1);assert.equal(result.rows[1].bucket,'government');
});

test('보호함과 수도미터가 모두 폐기물로 오분류됐으면 두 행 모두 재분류하여 중복하지 않는다',()=>{
 const source=sheet('수량',[{group:'5.폐기물처리비',name:'계량기보호함',spec:'D20'},{group:'5.폐기물처리비',name:'수도미터',spec:'D20'}]),selected=extractQuantities(source);
 const result=supplementGovernmentQuantities([source,sheet('토공',[]),government()],0,selected);
 assert.equal(result.governmentSupplement.corrected,2);assert.equal(result.governmentSupplement.added,0);assert.equal(result.rows.length,2);assert.ok(result.rows.every(r=>r.bucket==='government'));assert.deepEqual(result.rows.map(r=>r.id),selected.rows.map(r=>r.id));
});

test('같은 자재의 다른 수량·단위는 기존 행으로 오인하여 변경하지 않는다',()=>{
 for(const changed of [{qty:2},{unit:'조'},{spec:'D15'}]){
  const source=sheet('수량',[{group:'4.자재대',...changed}]),selected=extractQuantities(source),result=supplementGovernmentQuantities([source,sheet('관로도',[{}])],0,selected);
  assert.deepEqual(result.rows[0],selected.rows[0]);assert.equal(result.governmentSupplement.corrected,0);assert.equal(result.governmentSupplement.added,1);
 }
});

test('관급 수량 수식 미계산 행도 보존하고 확인 경고를 표시한다',()=>{
 const source=sheet('관로도',[{qty:{value:'',formula:'UNSUPPORTED()',cached:false,calculationError:'계산 불가'}}]),result=supplementGovernmentQuantities([empty(),source],0);
 assert.equal(result.governmentSupplement.added,1);const added=result.rows.at(-1);assert.equal(added.qty,null);assert.equal(added.formula,'UNSUPPORTED()');assert.equal(added.cached,false);assert.equal(added.quantityError,'계산 불가');assert.equal(added.source,'관로도!B5 / D5');assert.match(result.governmentSupplement.warnings.join(' '),/미계산/);
});
