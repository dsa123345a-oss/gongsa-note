import test from 'node:test';
import assert from 'node:assert/strict';
import {planAutoLinks,applyAutoLinks,pendingAuto,lineSignature,preferredLibrary} from '../dist/auto-link.js';
import {amount} from '../dist/calc.js';
const line=(extra={})=>({id:'line1',name:'PE이형관접합',spec:'D50',unit:'개',qty:2.5,group:'배관공',bucket:'direct',status:'unmatched',factor:1,rate:null,...extra});
const rate=(extra={})=>({id:'rate1',code:'U001',name:'PE이형관접합',spec:'D50',unit:'개',source:'10월 메인',labor:100,material:0,expense:0,other:0,total:100,...extra});
const lib=(items,id='main')=>({id,name:items[0]?.source||id,items});
const project=lines=>({schema:1,lines,charges:[],mappings:{}});
test('같은 품명의 다른 관경보다 일치 규격을 우선하며 다른 DB 코드를 구별한다',()=>{
 const p=project([line()]);const rows=planAutoLinks(p,[lib([rate({id:'wrong',spec:'D100'})]),lib([rate({id:'right',source:'추가 DB'})],'extra')]);
 assert.equal(rows[0].rate.id,'right');assert.equal(rows[0].rate.source,'추가 DB');assert.equal(rows[0].exact,true);
 assert.equal(planAutoLinks(p,[lib([rate({spec:'D100'})]),lib([rate({source:'추가 DB'})],'extra')],'main')[0].rate.source,'10월 메인');
});
test('단위 오표기는 DB 기준으로 고치고 무관한 품명은 자동 연결하지 않는다',()=>{
 const rows=planAutoLinks(project([line()]),[lib([rate({unit:'m'}),rate({name:'모래부설'})])]);assert.equal(rows[0].rate.unit,'m');
 assert.equal(planAutoLinks(project([line()]),[lib([rate({name:'모래부설'})])])[0].rate,undefined);
});
test('자동 연결은 원본을 보관하고 수량·낙찰률을 유지하며 이름·규격을 복사한다',()=>{
 const labor={code:'L1',name:'배관공',spec:'',unit:'인',category:'노임',labor:100,material:0,expense:0,other:0,total:100,source:'2026-10-main.estx'};
 const assembly=rate({components:[{...labor,qty:1}],calculation:{}});
 const p=project([line({name:'PE 이형관 접합',spec:'D 50',bidPercent:90})]);const next=applyAutoLinks(p,planAutoLinks(p,[lib([assembly]),{id:'reference',name:'2026-10-main.estx',items:[labor]}]),'batch1');
 const l=next.lines[0];assert.equal(l.name,'PE이형관접합');assert.equal(l.spec,'D50');assert.equal(l.qty,2.5);assert.equal(l.bidPercent,90);assert.equal(amount(l).total,225);assert.equal(pendingAuto(l),true);assert.deepEqual(l.autoMatch.before,p.lines[0]);assert.equal(p.lines[0].rate,null);
});

test('기준 DB가 없으면 자동 연결 후보를 찾더라도 노임 포함 일위를 확정하지 않는다',()=>{
 const p=project([line()]),before=structuredClone(p),rows=planAutoLinks(p,[lib([rate()])]),next=applyAutoLinks(p,rows,'missing-reference');
 assert.equal(next.lines[0].rate.name,'PE이형관접합');assert.equal(next.lines[0].status,'proposed');
 assert.equal(next.lines[0].rate.resourcePricing.ready,false);assert.equal(amount(next.lines[0]),null);assert.deepEqual(p,before);
});
test('기존 연결·제외·공종 제목은 건드리지 않는다',()=>{
 const p=project([line({status:'confirmed',rate:rate()}),line({id:'excluded',exclude:true}),line({id:'heading',level:1})]);assert.deepEqual(planAutoLinks(p,[lib([rate()])]),[]);
 const next=applyAutoLinks(p,[{line:p.lines[0],rate:rate({total:900,labor:900})}],'batch');assert.deepEqual(next,p);
});
test('비슷한 가격 후보 및 규격 수치 차이를 검토 대상으로 표시한다',()=>{
 const p=project([line()]);assert.match(planAutoLinks(p,[lib([rate(),rate({id:'rate2',code:'U002',labor:300,total:300})])])[0].reason,/여러 개/);
 assert.match(planAutoLinks(p,[lib([rate({spec:'D100'})])])[0].reason,/수치 다름/);
});
test('백호 용량과 인력 비율 사이 괄호·공백이 달라도 같은 규격을 우선한다',()=>{
 const p=project([line({name:'되메우기 및 다짐',spec:'백호(0.2㎥) 기계90%+인력10%',unit:'㎥'})]);
 const rows=planAutoLinks(p,[lib([rate({name:'되메우기및다짐',spec:'인력',unit:'㎥'}),rate({id:'machine',code:'D002',name:'되메우기및다짐',spec:'백호(0.2㎥)90%+인력10%',unit:'㎥'})])]);
 assert.equal(rows[0].rate.id,'machine');assert.doesNotMatch(rows[0].reason,/수치 다름/);
});
test('직접 검토해 저장한 연결은 재사용하되 자동 결과는 매핑에 저장하지 않는다',()=>{
 const p=project([line()]);p.mappings[lineSignature(p.lines[0])]={source:'추가 DB',code:'U001',name:'PE이형관접합',spec:'D50'};
 const rows=planAutoLinks(p,[lib([rate()]),lib([rate({source:'추가 DB',id:'saved',labor:200,total:200})],'extra')]);assert.equal(rows[0].rate.id,'saved');assert.match(rows[0].reason,/이전에/);
 assert.deepEqual(applyAutoLinks(p,rows,'batch').mappings,p.mappings);
});

test('1순위 DB에 다른 관경만 있으면 요청 관경이 있는 메인을 사용한다',()=>{
 const p=project([line()]);p.mappings[lineSignature(p.lines[0])]={source:'10월 메인',code:'U001',name:'PE이형관접합',spec:'D50'};
 const libs=[lib([rate()]),lib([rate({id:'added',source:'추가 DB',spec:'D100'})],'extra')];
 const chosen=planAutoLinks(p,libs,'','extra')[0];
 assert.equal(chosen.rate.id,'rate1');assert.match(chosen.reason,/다른 DB에서 찾음/);assert.doesNotMatch(chosen.reason,/규격 수치 다름/);
 assert.equal(planAutoLinks(p,libs,'','main')[0].rate.id,'rate1');
 assert.equal(planAutoLinks(p,libs)[0].rate.id,'rate1');
});

test('1순위 DB의 후보가 없거나 금액이 잘못되면 다른 DB를 사용하되 단위 차이는 허용한다',()=>{
 for(const item of [rate({name:'모래부설'}),rate({total:NaN})]){
  const row=planAutoLinks(project([line()]),[lib([item]),lib([rate({id:'fallback',source:'추가 DB'})],'extra')],'','main')[0];
  assert.equal(row.rate.id,'fallback');assert.match(row.reason,/다른 DB에서 찾음/);
 }
 assert.equal(planAutoLinks(project([line()]),[lib([])],'','main')[0].rate,undefined);
 assert.equal(planAutoLinks(project([line()]),[lib([rate({unit:'m'})]),lib([rate({id:'fallback'})],'extra')],'','main')[0].rate.id,'rate1');
});

test('동일 코드·동일 이름 DB라도 DB 식별자로 우선순위를 구분한다',()=>{
 const libs=[lib([rate()]),lib([rate({id:'preferred',labor:300,total:300})],'extra')];
 assert.equal(planAutoLinks(project([line()]),libs,'','extra')[0].rate.id,'preferred');
});

test('저장된 우선순위 복원, DB 교체, 삭제와 우선순위 없음 설정을 처리한다',()=>{
 const libs=[{...lib([rate()]),isMain:true},lib([rate({source:'추가 DB'})],'new-extra')];
 assert.equal(preferredLibrary({},libs),'new-extra');
 assert.equal(preferredLibrary({autoLinkPriority:{id:'old-extra',name:'추가 DB'}},libs),'new-extra');
 assert.equal(preferredLibrary({autoLinkPriority:{id:'deleted',name:'삭제한 DB'}},libs),'new-extra');
 assert.equal(preferredLibrary({autoLinkPriority:{id:'',name:''}},libs),'');
 assert.equal(preferredLibrary({},[]),'');
});
