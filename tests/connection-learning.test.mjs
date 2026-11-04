import test from 'node:test';
import assert from 'node:assert/strict';
import {planAutoLinks,applyAutoLinks,resetPendingAutoLinks,applyReplannedLinks,lineSignature} from '../dist/auto-link.js';
import {connectionKind,validateLearning,sourceIdentity,targetIdentity,learningIndex,learnedChoices} from '../dist/connection-learning.js';
import {bundledConnections} from '../dist/waterworks-connections.js';
import {compareSpecs,compatibleWork} from '../dist/match-similarity.js';
const source={id:'x',name:'콘크리트포장',spec:'',unit:'㎥',group:'포장공',qty:2,status:'unmatched'};
const target={name:'콘크리트포장(인력)',spec:'소규모',unit:'㎥',category:'단가산출'};
const rate=(d={})=>({...target,id:'a',code:'D001',source:'추가',labor:100,material:10,expense:5,other:0,total:115,...d});
const rule=(d={})=>({kind:'new',source,target,support:8,total:8,projectCount:8,...d});
const profile=(rules=[rule()])=>({schema:1,type:'gongsa-connections',rules});
const project=(d={})=>({title:'상수도 신규급수공사',lines:[{...source}],...d});
const libs=(items)=>[{id:'added',name:'추가',items}];
test('동일 업무의 반복 연결을 우선하며 실제 금액과 코드는 현재 DB에서 가져온다',()=>{
 const all=libs([rate({id:'text',name:source.name,spec:'무근',labor:1,total:16}),rate({code:'D999',labor:900,total:915})]);
 const p=planAutoLinks(project(),all,'','added',profile())[0];assert.equal(p.rate.code,'D999');assert.equal(p.rate.labor,900);assert.equal(p.learning.strong,true);assert.match(p.reason,/8개 공사/);
 assert.equal(planAutoLinks(project({connectionLearningEnabled:false}),all,'','added',profile())[0].rate.id,'text');
});
test('학습 대상이 1순위 DB에 있으면 우선하며 없는 경우 다른 DB에서 같은 대상을 찾는다',()=>{
 const all=[...libs([rate()]),{id:'month',items:[rate({id:'monthly',source:'월별',labor:999,total:1014})]}];
 assert.equal(planAutoLinks(project(),all,'','added',profile())[0].rate.id,'a');all[0].items=[rate({name:source.name,spec:'다른 시공'})];
 assert.equal(planAutoLinks(project(),all,'','added',profile())[0].rate.id,'monthly');
});
test('같은 DB에서 직접 확인한 매핑은 기본 학습보다 우선한다',()=>{
 const manual=rate({id:'manual',code:'D003',spec:'별도 시공'}),p=project();p.mappings={[lineSignature(source)]:manual};
 assert.equal(planAutoLinks(p,libs([rate(),manual]),'','added',profile())[0].rate.id,'manual');
});
test('규격이 없는 관경과 서로 다른 학습 결과는 자동 선택하지 않는다',()=>{
 const s={...source,name:'나사식접합',unit:'개소',group:'배관공'},t={...target,name:s.name,spec:'D15',unit:s.unit};
 const learning=profile([rule({source:s,target:t,support:6,total:10,projectCount:6}),rule({source:s,target:{...t,spec:'D20'},support:4,total:10,projectCount:4})]);
 const p=planAutoLinks(project({lines:[s]}),libs([rate(t),rate({...t,id:'b',spec:'D20'})]),'','added',learning)[0];assert.equal(p.recommended,false);assert.match(p.reason,/관경 누락/);
});
test('새 관경은 가까운 과거 규격보다 현재 DB의 정확한 관경을 우선한다',()=>{
 const s={...source,name:'STS소켓',spec:'D25',unit:'개',group:'자재대'},t={name:s.name,spec:'D20',unit:'개',category:'자재'};
 const p=planAutoLinks(project({lines:[s]}),libs([rate(t),rate({...t,id:'exact',spec:'D25'})]),'','added',profile([rule({source:{...s,spec:'D20'},target:t})]))[0];assert.equal(p.rate.id,'exact');
});
test('학습이 있어도 재질·뚜껑·시공/자재·소켓 용도 차이를 허용하지 않는다',()=>{
 for(const [a,b] of [['STS소켓','XL소켓'],['계량기보호통','계량기보호통뚜껑'],['STS소켓','STS밸브소켓'],['STS소켓','STS새들연결소켓']]){
  const s={...source,name:a,spec:'D20',unit:'개',group:'자재대'},t={...target,name:b,spec:'D20',unit:'개',category:'자재'};
  assert.equal(planAutoLinks(project({lines:[s]}),libs([rate(t)]),'','added',profile([rule({source:s,target:t})]))[0].rate,undefined);
 }
 assert.equal(compatibleWork({name:'소프트실제수밸브'},{name:'STS 볼밸브'}),false);
});
test('자동 결과를 다시 학습하지 않고 선택한 미검토 연결만 재적용한다',()=>{
 const p=project(),knowledge=profile(),before=structuredClone(knowledge),rows=planAutoLinks(p,libs([rate()]),'','added',knowledge),linked=applyAutoLinks(p,rows,'old');
 linked.lines[0].qty=9;linked.lines[0].bidPercent=95;linked.lines.push({...structuredClone(linked.lines[0]),id:'keep',status:'confirmed',autoMatch:{...linked.lines[0].autoMatch,reviewed:true}});
 const reset=resetPendingAutoLinks(linked);assert.equal(reset.lines[0].name,source.name);assert.equal(reset.lines[0].qty,9);assert.deepEqual(reset.lines[1],linked.lines[1]);
 assert.deepEqual(applyReplannedLinks(linked,[],'empty'),linked);
 const chosen=planAutoLinks(reset,libs([rate({total:220,labor:205})]),'','added',knowledge);const result=applyReplannedLinks(linked,chosen,'new');
 assert.equal(result.lines[0].qty,9);assert.equal(result.lines[0].bidPercent,95);assert.equal(result.lines[0].rate.total,220);assert.deepEqual(result.lines[1],linked.lines[1]);assert.deepEqual(knowledge,before);assert.equal(result.mappings,undefined);
});
test('업무 구분과 연결 식별에서 차원을 뒤집거나 소수점을 지우지 않는다',()=>{
 assert.equal(connectionKind({title:'상수도 긴급보수공사'}),'emergency');assert.equal(connectionKind({title:'신규급수공사',connectionLearningKind:'emergency'}),'emergency');
 assert.notEqual(sourceIdentity({...source,spec:'D25x20'}),sourceIdentity({...source,spec:'D20x25'}));
 assert.notEqual(targetIdentity({...target,spec:'0.2'}),targetIdentity({...target,spec:'02'}));
 assert.equal(compareSpecs('D25x20','D20x25').mismatch,true);assert.ok(compareSpecs('D25x20','25×20').score>compareSpecs('D25x20','20×25').score);
});
test('배포 기준에는 원본 공사 식별자·경로·단가·산식이 들어가지 않는다',()=>{
 const p=validateLearning(bundledConnections);assert.ok(p.rules.length>100);
 for(const r of p.rules){assert.deepEqual(Object.keys(r).sort(),['kind','source','target','support','total','projectCount'].sort());assert.deepEqual(Object.keys(r.source).sort(),['name','spec','unit','group'].sort());assert.deepEqual(Object.keys(r.target).sort(),['name','spec','unit','category'].sort());}
 assert.doesNotMatch(JSON.stringify(p),/\.estx|\.ebkx|\.xls|[A-Z]:[\\/]|비공개신청인|비공개공사명|projectId|labor|material|expense|formula/);
 assert.throws(()=>validateLearning({...p,rules:[rule({support:20,total:1})]}));
});
