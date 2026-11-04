import test from 'node:test';
import assert from 'node:assert/strict';
import {specNorm,compareSpecs,equivalentPipeDiameter} from '../dist/match-similarity.js';
import {planAutoLinks,applyAutoLinks} from '../dist/auto-link.js';
import {searchLibraries} from '../dist/library-search.js';
import {specIdentity} from '../dist/connection-learning.js';
const rate=(id,spec,name='STS 이형관 접합')=>({id,code:id,name,spec,unit:'개소',category:'일위대가',source:'추가 DB',labor:100,material:0,expense:0,other:0,total:100});
const project=spec=>({lines:[{id:'l',name:'STS이형관접합',spec,unit:'개소',qty:3,bidPercent:95,status:'unmatched',group:'배관공'}],charges:[],connectionLearningEnabled:false});
const library=items=>[{id:'extra',name:'추가 DB',items}];
test('동일 관경의 D·A·SU·mm 표기는 같은 크기로 비교하고 원본 표기는 보존한다',()=>{
 const aliases=['D25','25A','D25A','25SU','DN25','Φ25','25 mm','D 25 A'];
 for(const spec of aliases){assert.equal(specNorm(spec),'d25');assert.equal(specIdentity(spec),'d25');
  const p=project(spec),libs=library([rate('wrong','20A'),rate('match','25SU')]),before=structuredClone(libs);
  const chosen=planAutoLinks(p,libs)[0];assert.equal(chosen.rate.id,'match');assert.doesNotMatch(chosen.reason,/수치 다름/);
  assert.deepEqual(libs,before);assert.equal(p.lines[0].spec,spec);
 }
 assert.notEqual(specNorm('D25.4'),specNorm('D25'));assert.notEqual(specNorm('D250'),specNorm('25A'));assert.notEqual(specNorm('10K'),specNorm('10A'));
});
test('관경 13·15·16은 자동연결에서만 동등 후보로 삼고 정확한 크기를 우선한다',()=>{
 for(const from of [13,15,16])for(const to of [13,15,16].filter(n=>n!==from)){
  const p=project('D'+from),libs=library([rate('other','20A'),rate('alias',to+'SU')]);
  const m=planAutoLinks(p,libs)[0];assert.equal(m.rate.id,'alias');assert.match(m.reason,/13·15·16 동일 후보/);assert.doesNotMatch(m.reason,/수치 다름/);assert.equal(m.exact,false);
  const next=applyAutoLinks(p,[m],'b');assert.equal(next.lines[0].autoMatch.before.spec,'D'+from);assert.equal(next.lines[0].qty,3);assert.equal(next.lines[0].bidPercent,95);
  libs[0].items.push(rate('exact',from+'A'));assert.equal(planAutoLinks(p,libs)[0].rate.id,'exact');
 }
 assert.equal(compareSpecs('D13','15SU').mismatch,true);assert.notEqual(specIdentity('13SU'),specIdentity('15A'));
 assert.equal(equivalentPipeDiameter('D13xD25','15Ax25A'),true);assert.equal(equivalentPipeDiameter('D13xD25','25Ax15A'),false);
});
test('같은 후보군이어도 다른 재질·뚜껑은 자동연결하지 않고 기계 수치는 동등 취급하지 않는다',()=>{
 const p=project('D13'),libs=library([rate('material','15A','PE 이형관 접합'),rate('cover','15A','STS 이형관 접합 뚜껑')]);
 assert.equal(planAutoLinks(p,libs)[0].rate,undefined);
 p.lines[0].name='굴삭기';const m=planAutoLinks(p,library([rate('m','15','굴삭기')]))[0];assert.match(m.reason,/수치 다름/);assert.doesNotMatch(m.reason,/동일 후보/);
 assert.equal(compareSpecs('D25AxD15A','15SUx25SU').mismatch,true);
});
test('직접 검색은 같은 숫자의 관경 표기만 통합하고 13·15·16을 합치지 않는다',()=>{
 const libs=library([rate('same','25SU'),rate('alias','15A')]);
 assert.equal(searchLibraries(libs,'D25')[0].items[0].id,'same');assert.equal(searchLibraries(libs,'D13')[0].items.length,0);
});
