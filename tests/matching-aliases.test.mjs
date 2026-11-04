import test from 'node:test';
import assert from 'node:assert/strict';
import {planAutoLinks} from '../dist/auto-link.js';
import {searchLineLibraries,searchLibraries} from '../dist/library-search.js';
import {specNorm,compareSpecs,compatibleWork,wasteMatchIssue} from '../dist/match-similarity.js';
const row=(name,spec,unit='개')=>({id:name,name,spec,unit,group:'자재대',status:'unmatched',qty:1});
const item=(name,spec,unit='개',category='자재')=>({id:name+spec,code:name+spec,name,spec,unit,category,source:'추가',labor:100,material:20,expense:0,other:0,total:120});
test('명확한 품명·관경 일치는 연결 사례가 한 개여도 자동 선택한다',()=>{
 for(const [name,target,spec] of [['STS새들연결소켓','STS 새들연결소켓','20SU'],['XL밸브소켓','XL-밸브소켓','D20'],['XL삼방티','XL-삼방티','D20'],['PVC밸브소켓','PVC 밸브소켓','D20mm']]){
  const line=row(name,'S20SU'),rate=item(target,spec);
  const learning={rules:[{kind:'emergency',source:line,target:rate,support:1,total:1,projectCount:1}]};
  const result=planAutoLinks({title:'긴급보수',lines:[line]},[{id:'added',items:[rate]}],'','added',learning)[0];
  assert.deepEqual(result.rate.resourcePricing.original,rate);assert.equal(result.rate.resourcePricing.mode,'direct-material');assert.equal(result.rate.resourcePricing.ready,true);assert.equal(result.rate.total,rate.total);
  assert.equal(result.recommended,true);assert.equal(result.exact,true);assert.equal(line.spec,'S20SU');
 }
});
test('모래부설은 관로 모래 부설을 찾으며 다른 시공 방식은 제외한다',()=>{
 const line={...row('모래부설','','m³'),group:'토공'},rate=item('관로 모래 부설','인력','㎥','단가산출');
 const libs=[{id:'added',items:[rate]}];
 assert.equal(planAutoLinks({lines:[line]},libs)[0].recommended,true);
 assert.equal(searchLibraries(libs,'모래부설')[0].items[0],rate);
 assert.equal(compatibleWork({...line,spec:'백호'},rate),false);
});
test('SU 관경 별칭은 관경 숫자와 복합 관경 순서를 보존한다',()=>{
 for(const spec of ['D20','D20SU','S20SU','20SU','D20A','D20mm'])assert.equal(specNorm(spec),'d20');
 assert.equal(specNorm('S20SU×15A'),specNorm('D20x15'));
 assert.equal(compareSpecs('S20SU×15A','D15x20').mismatch,true);
 assert.notEqual(specNorm('S25SU'),specNorm('D20'));
});
test('읍·면 생략을 동일 지역으로 인식하되 다른 폐기물 지역은 제외한다',()=>{
 for(const [full,short] of [['평해읍','평해'],['후포면','후포'],['울진읍','울진'],['기성면','기성'],['온정면','온정'],['죽변면','죽변'],['근남면','근남'],['매화면','매화'],['북면','북면']]){
  const line=row('폐기물처리',`콘크리트(${full})`,'톤'),rate=item('폐기물처리',`콘크리트(${short}⇔울진)`,'TON');
  assert.equal(wasteMatchIssue(line),'');assert.equal(compatibleWork(line,rate),true);
  assert.equal(compatibleWork(line,{...rate,spec:'콘크리트(다른지역⇔울진)'}),false);
  assert.equal(searchLibraries([{id:'db',items:[rate]}],full)[0].items[0],rate);
 }
 assert.equal(compatibleWork(row('폐기물처리','콘크리트(평해읍⇔울진읍)','톤'),item('폐기물처리','콘크리트(평해⇔울진)','TON')),true);
});
test('전체 DB 창을 유지하면서 각 창의 같은 재질·관경 후보를 먼저 보여 준다',()=>{
 const exact=item('XL-밸브소켓','D20'),small=item('XL-밸브소켓','D15'),wrong=item('PVC 밸브소켓','D20');
 const libs=[{id:'main',isMain:true,items:[small,exact,wrong]},{id:'added',items:[small,exact]}];
 const result=searchLineLibraries(libs,row('XL밸브소켓','S20SU'));
 assert.deepEqual(result.map(g=>g.library.id),['main','added']);
 assert.ok(result.every(g=>g.items[0]===exact));assert.equal(compatibleWork(row('XL밸브소켓','D20'),wrong),false);
});
