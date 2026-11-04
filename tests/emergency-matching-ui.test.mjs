import test from 'node:test';
import assert from 'node:assert/strict';
import {planAutoLinks} from '../dist/auto-link.js';
import {searchLibraries} from '../dist/library-search.js';
import {compatibleWork} from '../dist/match-similarity.js';
import {applyEmergencySurcharges} from '../dist/emergency-surcharges.js';
import {synchronizeLinkedCosts,amount,truncateProduct} from '../dist/calc.js';
import {surchargeBidLabel} from '../dist/surcharge-display.js';

const rate=(name,spec,unit,category='자재')=>({name,spec,unit,category,id:name+spec,code:name+spec,source:'추가 DB',labor:10000,material:500,expense:100,other:0,total:10600});
const line=(name,spec,unit,group='자재대')=>({id:name,name,spec,unit,group,qty:2,status:'unmatched',factor:1,bucket:'direct',rate:null});
const p=lines=>({title:'상수도긴급보수공사',lines,charges:[],connectionLearningEnabled:false});
const candidates=[rate('보도용 블록 인력철거','B-Type','㎡','단가산출'),rate('보도용 블록 설치(인력)','B-Type, t=8cm이하','㎡','단가산출'),rate('STS 직관','D13SU','M'),rate('XL-삼방티','D15','개'),rate('XL-파이프','D15','M')];

test('보도블럭·STS직관·XL정티·XL파이프를 추가 DB 품목으로 연결하고 검색한다',()=>{
 const lines=[line('보도블럭철거','B-Type','m²','포장공'),line('보도블럭설치','B-Type, t=8cm이하','㎡','포장공'),line('STS직관','D13A','m'),line('XL정티','D15','개'),line('XL파이프','D15','m')];
 const lib={id:'added',name:'추가 DB',items:candidates};
 const results=planAutoLinks(p(lines),[lib],'','added');
 assert.deepEqual(results.map(r=>r.rate?.name),candidates.map(r=>r.name));assert.ok(results.every(r=>r.recommended));
 for(let i=0;i<lines.length;i++)assert.ok(searchLibraries([lib],lines[i].name)[0].items.includes(candidates[i]));
 assert.ok(!compatibleWork(lines[0],candidates[1]));
 assert.ok(!compatibleWork(lines[1],{...candidates[1],name:'보도용 블록 재설치'}));
 assert.ok(!compatibleWork(lines[2],{...candidates[2],name:'PE 직관'}));
 assert.ok(!compatibleWork(lines[3],{...candidates[3],name:'XL-암티'}));
});

test('XL 관경 13·15·16 동등 검색에서도 원본 규격은 보존한다',()=>{
 const original=p([line('XL정티','D13A','개'),line('XL파이프','16SU','m')]);
 const results=planAutoLinks(original,[{id:'added',items:candidates}]);
 assert.ok(results.every(r=>r.recommended&&/동일 후보/.test(r.reason)));
 assert.equal(original.lines[0].spec,'D13A');assert.equal(original.lines[1].spec,'16SU');
});

const heading=(id,name,level)=>({id,name,level});
const base=id=>({...line(id,'','m','토공'),status:'confirmed',rate:rate(id,'','m'),qty:3});
test('엑셀에서 가져온 미연결 기타할증을 자기 공종 노무비로 복구하고 중복하지 않는다',()=>{
 const original=p([heading('s','1공구',2),heading('h','1. 토 공',1),base('a'),{...line('기타할증','','%','토공'),qty:50},heading('s2','2공구',2),heading('h2','2. 배관공',1),base('b'),{...line('긴급보수할증','','%','배관공'),qty:20}]);
 const next=synchronizeLinkedCosts(original);
 assert.equal(original.lines[3].surcharge,undefined);
 assert.equal(amount(next.lines[3]).labor,15000);assert.equal(amount(next.lines[7]).labor,6000);
 assert.equal(applyEmergencySurcharges(next).added,0);assert.equal(next.lines[7].qty,20);
 next.lines[2].rate=null;next.lines[2].status='unmatched';
 const missing=synchronizeLinkedCosts(next);assert.equal(amount(missing.lines[3]),null);assert.equal(amount(missing.lines[7]).labor,6000);
 const manual=structuredClone(original);manual.lines[3].rate=rate('수동할증','','%');manual.lines[3].status='confirmed';
 assert.equal(synchronizeLinkedCosts(manual).lines[3].surcharge,undefined);
 assert.equal(synchronizeLinkedCosts({...original,title:'신규급수'}).lines[3].surcharge,undefined);
});

test('전체 95% 낙찰은 50%·30% 할증에 한 번 반영되고 100%로 복원된다',()=>{
 const original=applyEmergencySurcharges(p([heading('s','1공구',2),heading('h','토공',1),base('a'),heading('h2','배관공',1),base('b')])).project;
 for(const method of ['unit','amount']){
  const reduced=synchronizeLinkedCosts({...original,lines:original.lines.map(l=>({...l,bidPercent:95,bidMethod:method}))});
  const rows=reduced.lines.filter(l=>l.surcharge);
  assert.deepEqual(rows.map(l=>amount(l).labor),[14250,8550]);
  assert.deepEqual(rows.map(surchargeBidLabel),['95% 연동','95% 연동']);
  const restored=synchronizeLinkedCosts({...reduced,lines:reduced.lines.map(l=>({...l,bidPercent:100}))});
  assert.deepEqual(restored.lines.filter(l=>l.surcharge).map(l=>amount(l).labor),[15000,9000]);
 }
});

test('선택 행만 낙찰하면 할증은 혼합된 기준 노무비를 그대로 따른다',()=>{
 const project=applyEmergencySurcharges(p([heading('s','1공구',2),heading('h','토공',1),{...base('a'),bidPercent:95},base('b')])).project;
 const next=synchronizeLinkedCosts(project),row=next.lines.at(-1);
 assert.equal(amount(row).labor,29250);assert.equal(surchargeBidLabel(row),'혼합 연동');
 assert.equal(amount(row).labor,truncateProduct(amount(next.lines[2]).labor+amount(next.lines[3]).labor,.5));
});
