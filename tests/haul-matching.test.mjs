import test from 'node:test';
import assert from 'node:assert/strict';
import {compatibleWork} from '../dist/match-similarity.js';
import {planAutoLinks,applyAutoLinks,incompatibleAutoLinks,resetIncompatibleAutoLinks,lineSignature} from '../dist/auto-link.js';
import {searchLineLibraries} from '../dist/library-search.js';
const rate=(name,spec,unit='㎥')=>({name,spec,unit,code:name+spec,source:'추가',category:'단가산출',labor:100,material:20,expense:30,other:0,total:150});
const line=(name,spec='',unit='㎥')=>({id:'l',name,spec,unit,qty:2.5,group:'부대공',status:'unmatched',bucket:'direct'});
const names=['아스콘','레미콘','모래','보조기층'];
test('소운반은 단위·학습·저장 매핑이 같아도 다른 운반 자재로 연결하지 않는다',()=>{
 for(const a of names)for(const b of names){
  const l=line(a+' 소운반','덤프2.5톤'),r=rate(b+'소운반','덤프2.5톤');
  assert.equal(compatibleWork(l,r),a===b,a+' / '+b);
  if(a===b)continue;
  const p={title:'긴급보수',lines:[l],mappings:{[lineSignature(l)]:r}},profile={rules:[{kind:'emergency',source:l,target:r,support:10,total:10,projectCount:10}]};
  assert.equal(planAutoLinks(p,[{id:'a',items:[r]}],'','a',profile)[0].rate,undefined);
  assert.equal(applyAutoLinks(p,[{line:l,rate:r}],'stale').lines[0].rate,undefined);
 }
 assert.equal(compatibleWork(line('아스팔트 소운반'),rate('아스콘소운반','덤프2.5톤','Ton')),true);
 assert.equal(compatibleWork(line('아스콘소운반'),rate('폐기물소운반(아스콘)','덤프2.5톤')),false);
 assert.equal(compatibleWork(line('모래소운반'),rate('모래부설','인력')),false);
});
test('소운반 인력·덤프·굴삭·경운기 및 지게·리어카를 서로 대체하지 않는다',()=>{
 for(const a of ['인력,리어카','덤프2.5톤','굴삭기0.2㎥','경운기'])for(const b of ['인력,리어카','덤프2.5톤','굴삭기0.2㎥','경운기'])assert.equal(compatibleWork(line('모래소운반',a),rate('모래소운반',b)),a===b);
 assert.equal(compatibleWork(line('모래소운반(인력)'),rate('모래소운반','덤프2.5톤')),false);
 assert.equal(compatibleWork(line('모래소운반','인력,지게'),rate('모래소운반','인력,리어카')),false);
 const l=line('아스콘소운반','인력'),main=rate('아스콘소운반','인력,리어카','Ton');
 assert.equal(planAutoLinks({lines:[l]},[{id:'added',items:[rate(l.name,'덤프2.5톤','Ton')]},{id:'main',items:[main]}],'','added')[0].rate,main);
});
test('수량산출서 단위와 무관하게 같은 DB 후보를 선택하고 DB 단위·원본 수량을 적용한다',()=>{
 for(const [name,spec,dbUnit] of [['아스콘소운반','덤프2.5톤','Ton'],['PE소켓','D20','조'],['모래소운반','덤프2.5톤','㎥']]){
  const r=rate(name,spec,dbUnit),lib={id:'a',items:[r]},base=line(name,spec,dbUnit),profile={rules:[{kind:'any',source:base,target:r,support:5,total:5,projectCount:5}]};
  for(const unit of ['','㎥','Ton','개','m']){
   const l={...base,unit},p={lines:[l]},plan=planAutoLinks(p,[lib],'','a',profile)[0];
   assert.equal(plan.rate,r);assert.equal(plan.recommended,true);assert.equal(plan.learning.strong,true);
   const linked=applyAutoLinks(p,[plan],'batch');assert.equal(linked.lines[0].unit,dbUnit);assert.equal(linked.lines[0].qty,2.5);assert.equal(linked.lines[0].factor,1);assert.equal(linked.lines[0].autoMatch.before.unit,unit);
   assert.equal(incompatibleAutoLinks(linked).length,0);
  }
 }
});
test('단위 오표기로 인한 올바른 연결은 유지하고 소운반 오연결만 원래 품명으로 복구한다',()=>{
 const before=line('아스콘소운반','덤프2.5톤'),good=rate(before.name,before.spec,'Ton'),bad=rate('레미콘소운반','인력,리어카');
 const p={lines:[{...before,id:'bad',name:bad.name,rate:bad,status:'confirmed',qty:7,autoMatch:{before,reviewed:false}},{...before,id:'good',rate:good,status:'confirmed',unit:'Ton',autoMatch:{before,reviewed:false}}]};
 assert.deepEqual(incompatibleAutoLinks(p).map(l=>l.id),['bad']);
 const fixed=resetIncompatibleAutoLinks(p);assert.equal(fixed.lines[0].qty,7);assert.equal(fixed.lines[0].name,before.name);assert.deepEqual(fixed.lines[1],p.lines[1]);
 const results=searchLineLibraries([{items:[bad,good]}],before,'소운반')[0].items;assert.equal(results[0],good);
});
