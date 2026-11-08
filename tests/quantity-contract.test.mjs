import test from 'node:test';
import assert from 'node:assert/strict';
import {readQuantityContracts,attachQuantityContracts,referencedQuantityRate} from '../dist/quantity-contract.js';
import {planAutoLinks,applyAutoLinks} from '../dist/auto-link.js';
import {compatibleWork} from '../dist/match-similarity.js';
const target={source:'추가 DB',code:'U001',name:'PE관 접합및부설',spec:'Φ20mm',unit:'m',kind:'work'};
const line=()=>({id:'l',group:'배관공',...target,qty:5,source:'수량!D8 / AD8',status:'unmatched',bucket:'direct'});
const rate=(patch={})=>({...target,id:'r',table:'HeadTitleDat',category:'일위대가',labor:100,material:5,expense:0,other:0,total:105,...patch});
function sheets(patch={}){
 const record={sheet:'수량',refs:{name:'D8',spec:'H8',qty:'AD8',unit:'AG8'},expected:target,target,status:'linked',...patch};
 return [{name:'수량',rows:[{index:8,cells:{D:{value:target.name},H:{value:target.spec},AD:{value:5},AG:{value:target.unit}}}]},
 {name:'_공사노트연동',rows:[{index:1,cells:{A:{value:'gongsa.quantity.v1'}}},{index:2,cells:{A:{value:'{"schema":1,"catalogVersion":"test"}'}}},{index:4,cells:{A:{value:JSON.stringify(record)}}}]}];
}
test('연동정보는 별도 시트로 노출하지 않고 실제 품명 규격 단위와 대조한다',()=>{
 const tabs=readQuantityContracts(sheets());assert.equal(tabs.length,1);
 const rows=attachQuantityContracts(tabs[0],[line()]);assert.equal(rows[0].dbReference.state,'linked');assert.equal(rows[0].qty,5);
});
test('엑셀에서 수량만 바꾸면 유효하고 규격을 바꾸면 과거 DB 선택을 무효화한다',()=>{
 let tabs=sheets();tabs[0].rows[0].cells.AD.value=100;assert.equal(attachQuantityContracts(readQuantityContracts(tabs)[0],[line()])[0].dbReference.state,'linked');
 tabs=sheets();tabs[0].rows[0].cells.H.value='D50';const row=attachQuantityContracts(readQuantityContracts(tabs)[0],[line()])[0];assert.equal(row.dbReference.state,'changed');assert.equal(referencedQuantityRate(row,[{item:rate(),source:'추가 DB'}]).rate,undefined);
});
test('같은 코드의 다른 DB와 다른 규격을 사용하지 않는다',()=>{
 const row=attachQuantityContracts(readQuantityContracts(sheets())[0],[line()])[0];
 const libs=[{id:'main',name:'10월 메인',items:[rate({source:'10월 메인',id:'wrong'})]},{id:'extra',name:'추가 DB',items:[rate(),rate({id:'size',spec:'D50'})]}];
 const p={lines:[row],charges:[],mappings:{}};
 const plans=planAutoLinks(p,libs,'','main');assert.equal(plans[0].rate.id,'r');assert.deepEqual(plans[0].rate.resourcePricing.original,rate());
 assert.equal(plans[0].rate.resourcePricing.ready,false);assert.equal(plans[0].recommended,false);
 const linked=applyAutoLinks(p,plans,'test').lines[0];assert.equal(linked.qty,5);assert.equal(linked.unit,target.unit);assert.equal(linked.name,target.name);assert.equal(linked.spec,target.spec);assert.equal(linked.status,'proposed');
 assert.equal(planAutoLinks(p,libs.slice(0,1))[0].rate,undefined);
});
test('손상·중복 연결정보는 유사 검색으로 자동 확정하지 않는다',()=>{
 for(const patch of [{status:'invalid'},{status:'unresolved',target}]){
  const row=attachQuantityContracts(readQuantityContracts(sheets(patch))[0],[line()])[0];
  assert.equal(planAutoLinks({lines:[row]},[{id:'x',name:'추가 DB',items:[rate()]}])[0].rate,undefined);
 }
 const tabs=sheets();tabs[1].rows.push({...tabs[1].rows[2],index:5});const row=attachQuantityContracts(readQuantityContracts(tabs)[0],[line()])[0];assert.equal(row.dbReference.state,'duplicate');
});
test('같은 DB 식별정보에 서로 다른 가격이 있으면 확인 대상이다',()=>{
 const row=attachQuantityContracts(readQuantityContracts(sheets())[0],[line()])[0];
 const ref=referencedQuantityRate(row,[{item:rate(),source:'추가 DB'},{item:rate({total:205,labor:200}),source:'추가 DB'}]);assert.equal(ref.rate,undefined);
});
test('내역에서 품명을 수정하면 저장된 식별정보가 다른 품목을 강제하지 않는다',()=>{
 const row=attachQuantityContracts(readQuantityContracts(sheets())[0],[line()])[0];row.name='STS관 접합 및 부설';assert.equal(referencedQuantityRate(row,[{item:rate(),source:'추가 DB'}]).rate,undefined);
});
test('앵글밸브는 교체 일위의 작업비와 자재비를 함께 적용한다',()=>{
 const l={name:'앵글밸브(10kg/㎠)(자재포함)',spec:'D15',unit:'개',group:'배관공'};
 assert.equal(compatibleWork(l,rate({name:'앵글밸브 교체'})),true);
 assert.equal(compatibleWork(l,rate({name:'앵글밸브 교체',material:0})),false);
 assert.equal(compatibleWork(l,rate({name:'앵글밸브(10kg/㎠)',category:'자재',code:'M1',labor:0})),false);
});
test('연결정보가 null이거나 저장된 참조 대상이 없으면 가져오기·자동연결이 중단되지 않는다',()=>{
 const tabs=sheets();tabs[1].rows[2].cells.A.value='null';
 const rows=attachQuantityContracts(readQuantityContracts(tabs)[0],[line()]);assert.equal(rows[0].dbReference.state,'invalid');
 assert.equal(referencedQuantityRate({...line(),dbReference:{state:'linked',expected:target,target:null}},[]).rate,undefined);
});
test('병합 품명 옆 실제 규격 칸을 읽어 선택한 DB 규격과 연결한다',()=>{
 const tabs=sheets({refs:{name:'D8',spec:'M8',qty:'AD8',unit:'AG8'}});
 tabs[0].rows[0].cells.H.value='';tabs[0].rows[0].cells.M={value:target.spec};
 const rows=attachQuantityContracts(readQuantityContracts(tabs)[0],[{...line(),spec:''}]);assert.equal(rows[0].spec,target.spec);assert.equal(rows[0].dbReference.state,'linked');
 assert.equal(referencedQuantityRate(rows[0],[{item:rate(),source:'추가 DB'}]).rate.id,'r');
});

test('생성기에서 DB를 선택하지 않은 엑셀과 기존 저장본은 공사노트에서 검색한다',()=>{
 const libs=[{id:'x',name:'추가 DB',items:[rate()]}];
 for(const state of ['unresolved','quantity']){
  const row=attachQuantityContracts(readQuantityContracts(sheets({status:state,target:null}))[0],[line()])[0];
  assert.equal(referencedQuantityRate(row,[]),null);
  assert.ok(!row.note?.includes('미선택'));
  const saved=JSON.parse(JSON.stringify(row));
  const expected=planAutoLinks({lines:[line()],mappings:{}},libs)[0];
  const actual=planAutoLinks({lines:[saved],mappings:{}},libs)[0];
  assert.ok(actual.rate);
  assert.deepEqual(actual.rate,expected.rate);
  assert.equal(actual.recommended,expected.recommended);
  assert.equal(actual.reason,expected.reason);
 }
});

test('미선택이라도 손상되거나 중복된 엑셀과 조건형 가산은 일반 품 검색을 하지 않는다',()=>{
 for(const change of [
  t=>t[0].rows[0].cells.H.value='D50',
  t=>t[1].rows.push({...t[1].rows[2],index:5}),
  t=>t[1].rows[2].cells.A.value='{broken',
 ]){
  const tabs=sheets({status:'unresolved',target:null});change(tabs);
  const row=attachQuantityContracts(readQuantityContracts(tabs)[0],[line()])[0];
  assert.ok(referencedQuantityRate(row,[]));
 }
 assert.ok(referencedQuantityRate({...line(),dbReference:{state:'conditional',target:null,expected:target}},[]));
 const row={...line(),dbReference:{state:'unresolved',target:null,expected:target}};
 row.spec='D50';assert.ok(referencedQuantityRate(row,[]));
});

test('기존 저장본에서 연결이 성공하면 미선택 안내만 지우고 사용자 비고는 보존한다',()=>{
 const row=attachQuantityContracts(readQuantityContracts(sheets({status:'unresolved',target:null}))[0],[line()])[0];
 row.note='사용자 비고 / 수량산출서에서 DB 품목 미선택 · 직접 확인 후 연결';
 const libs=[{id:'x',name:'추가 DB',items:[rate()]}],p={lines:[row],mappings:{}};
 const plans=planAutoLinks(p,libs);
 const result=applyAutoLinks(p,plans,'test');
 assert.equal(result.lines[0].note,'사용자 비고');
 assert.equal(result.lines[0].qty,5);
 assert.ok(p.lines[0].note.includes('미선택'));
});
