import test from 'node:test';
import assert from 'node:assert/strict';
import {readQuantityContracts,attachQuantityContracts} from '../dist/quantity-contract.js';
import {resolveLineAdjustments} from '../dist/line-adjustments.js';
import {amount,defaultCharges} from '../dist/calc.js';
import {buildQuantityProject} from '../dist/quantity-batch.js';
import {contractorTemplateSheets} from '../dist/contractor-template-export.js';
import {exportEstimate} from '../dist/workbook.js';
const identity={name:'KP 메커니컬 접합 및 부설(인력)',spec:'D=80mm',unit:'본'};
function fixture(){
 const target={...identity,source:'추가 DB',code:'U406',kind:'work'};
 const allowance={targetName:'KP메커니컬 접합 및 부설',targetSpec:'D80',targetUnit:'본',targetQuantity:2,targetTotalQuantity:4,percent:12.5,basis:'all-components',reason:'현장 접합조건',targetKeys:['수량!D8 / AD8'],targetIdentities:[identity]};
 const records=[{sheet:'수량',refs:{name:'D8',spec:'M8',qty:'AD8',unit:'AG8'},expected:identity,target,status:'linked'},
 {sheet:'수량',refs:{name:'D9',spec:'M9',qty:'AD9',unit:'AG9'},expected:{name:'이탈방지압륜 가산',spec:'KP D80 · 대상 2본',unit:'%'},target:null,status:'conditional',allowance}];
 const rows=records.map((r,i)=>({id:'row'+i,...r.expected,qty:i?12.5:4,factor:1,group:'배관공',bucket:'direct',source:`수량!D${8+i} / AD${8+i}`,status:'unmatched',rate:null}));
 const sheet={name:'수량',rows:records.map((r,i)=>({index:8+i,cells:{D:{value:r.expected.name},M:{value:r.expected.spec},AD:{value:rows[i].qty},AG:{value:r.expected.unit}}}))};
 const meta={name:'_공사노트연동',rows:[{index:1,cells:{A:{value:'gongsa.quantity.v1'}}},{index:2,cells:{A:{value:'{"schema":1,"catalogVersion":"test"}'}}},...records.map((r,i)=>({index:4+i,cells:{A:{value:JSON.stringify(r)}}}))]};
 return {rows,sheet,meta,records};
}
function imported(){const f=fixture();return attachQuantityContracts(readQuantityContracts([f.sheet,f.meta])[0],f.rows);}
function priced(){const rows=imported();rows[0].status='confirmed';rows[0].bidPercent=95;rows[0].rate={...identity,labor:101,material:7,expense:5,other:0,total:113,source:'추가 DB',code:'U406'};return rows;}
test('KP 가산 숨은 연결정보는 검증된 같은 품에만 연결',()=>{const rows=imported();assert.equal(rows[1].surcharge.target,'components');assert.deepEqual(rows[1].surcharge.sourceIds,['row0']);assert.equal(rows[1].qty,12.5);});
test('비목별 가산은 실제 KP 대상 2본에만 적용하며 낙찰도 한 번 반영',()=>{const rows=resolveLineAdjustments(priced());assert.deepEqual(rows.warnings,[]);assert.deepEqual(amount(rows.lines[1]),{labor:23,material:1,expense:1,other:0,total:25});assert.equal(rows.lines[0].qty,4);assert.equal(rows.lines[1].bidPercent,100);});
test('대상 수량 부족·관경 변경·미확정은 가산 확정하지 않음',()=>{for(const patch of [{qty:1},{spec:'D100'},{status:'unmatched'}]){const rows=priced();Object.assign(rows[0],patch);const r=resolveLineAdjustments(rows);assert.equal(r.lines[1].rate,null);assert.equal(r.warnings.length,1);}});
test('손상·30초과·보이는요율변경은 숨은 가산으로 자동확정 안함',()=>{for(const change of [f=>{const r=JSON.parse(f.meta.rows[3].cells.A.value);r.allowance.percent=31;f.meta.rows[3].cells.A.value=JSON.stringify(r);},f=>f.sheet.rows[1].cells.AD.value=20,f=>f.sheet.rows[0].cells.M.value='D100']){const f=fixture();change(f);const rows=attachQuantityContracts(readQuantityContracts([f.sheet,f.meta])[0],f.rows);assert.equal(rows[1].surcharge,undefined);}});
test('여러 공구로 가져와도 가산대상 ID는 각 공구에 연결',()=>{const q={title:'검증',location:'',rows:priced()},p=buildQuantityProject({lines:[],charges:[]},[{file:'1.xlsx',quantity:q},{file:'2.xlsx',quantity:q}]);const added=p.lines.filter(x=>x.surcharge?.kpAllowance);assert.equal(added.length,2);assert.notEqual(added[0].surcharge.sourceIds[0],added[1].surcharge.sourceIds[0]);assert.deepEqual(resolveLineAdjustments(p.lines).warnings,[]);});
test('업체 양식과 일반 엑셀 모두 가산 비목 수식·캐시 금액 유지',()=>{const project={title:'신규급수 검증',location:'',lines:priced(),charges:defaultCharges()};const output=contractorTemplateSheets(project);const detail=output.sheets[2];const row=detail.rows.find(r=>r.values?.[2]==='이탈방지압륜 가산');assert.equal(row.values[8].value,190);assert.equal(row.values[10].value,12);assert.equal(row.values[12].value,8);assert.ok(row.values[8].formula.includes('2*I'));assert.ok(exportEstimate(project).byteLength>0);});
test('이미 압륜 포함 품이나 직접 금액 품에 추가 가산하지 않음',()=>{for(const edit of [r=>r.rate.spec='D80(이탈방지압륜사용)',r=>r.rate.name='PE 이형관 접합',r=>{r.calculationMode='horizontal';r.manualAmounts={labor:100,material:10,expense:2,other:0};}]){const rows=priced();edit(rows[0]);const r=resolveLineAdjustments(rows);assert.equal(r.lines[1].rate,null);assert.equal(r.warnings.length,1);}});
test('조건형 가산은 비목별·30% 상한을 다른 계상 비목으로 우회할 수 없음',()=>{const rows=priced();rows[1].surcharge.target='labor';rows[1].qty=31;assert.throws(()=>resolveLineAdjustments(rows),/30%/);});
test('같은 KP 자재 가산 복사 차단·서로 다른 자재 합산은 대상 본수 범위 내 허용',()=>{
 const rows=priced();rows[1].surcharge.kpAllowance.targetMaterialId='kp-a';const copy=structuredClone(rows[1]);copy.id='copy';rows.push(copy);
 assert.equal(resolveLineAdjustments(rows).warnings.length,2);
 copy.surcharge.kpAllowance.targetMaterialId='kp-b';assert.equal(resolveLineAdjustments(rows).warnings.length,0);
 copy.surcharge.kpAllowance.quantity=3;assert.equal(resolveLineAdjustments(rows).warnings.length,2);
});
test('조건형 가산은 대상 KP 환산계수와 금액 낙찰 방식도 엑셀 수식에 유지',()=>{
 const rows=priced();rows[0].factor=2;rows[0].bidMethod='amount';rows[0].rate.other=3;rows[0].rate.total=116;
 const p={title:'조건 검증',lines:rows,charges:defaultCharges()},resolved=resolveLineAdjustments(rows),a=amount(resolved.lines[1]);
 assert.deepEqual(a,{labor:47,material:3,expense:2,other:1,total:53});
 const d=contractorTemplateSheets(p).sheets[2],r=d.rows.find(x=>x.values?.[2]==='이탈방지압륜 가산');
 assert.equal(r.values[8].value,383);assert.ok(r.values[8].formula.includes('4*I'));assert.equal(r.values[13].value,3);assert.ok(exportEstimate(p).byteLength>0);
});
test('중복 숨은 계약 메타데이터는 가산을 자동 확정하지 않음',()=>{const f=fixture();f.meta.rows.push({...f.meta.rows[3],index:6});const rows=attachQuantityContracts(readQuantityContracts([f.sheet,f.meta])[0],f.rows);assert.equal(rows[1].surcharge,undefined);assert.equal(rows[1].dbReference.state,'duplicate');});
test('가산 조건 유지한 채 원본 대상 수량만 변경하면 재검토',()=>{const f=fixture();f.rows[0].qty=8;const rows=attachQuantityContracts(readQuantityContracts([f.sheet,f.meta])[0],f.rows);assert.equal(rows[1].surcharge,undefined);const active=priced();active[0].qty=8;assert.equal(resolveLineAdjustments(active).warnings.length,1);});
