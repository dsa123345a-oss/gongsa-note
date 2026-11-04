import test from 'node:test';
import assert from 'node:assert/strict';
import {startBlankSession,createCloseController} from '../dist/session-lifecycle.js';
import {applyEmergencySurcharges} from '../dist/emergency-surcharges.js';
import {buildQuantityProject} from '../dist/quantity-batch.js';
import {amount,synchronizeLinkedCosts} from '../dist/calc.js';
import {exportEvidenceEstimate} from '../dist/evidence-estimate.js';
import {unzip} from '../dist/est.js';

const empty=()=>({schema:1,title:'',location:'',quantityFile:'',lines:[],charges:[]});
const memory=()=>{const data=new Map();return {data,get:async k=>structuredClone(data.get(k)),put:async(k,v)=>data.set(k,structuredClone(v))};};
const item=(id,labor=1000)=>({id,name:id,spec:'',group:'토공',unit:'식',qty:1,status:'confirmed',factor:1,bucket:'direct',rate:{labor,material:100,expense:50,other:0,total:labor+150}});
const heading=(id,name,level)=>({...item(id),name,level,qty:null,rate:null});
const sample=()=>({...empty(),title:'긴급보수',lines:[1,2].flatMap(i=>[
 heading('s'+i,i+'공구',2),heading('t'+i,'1. 토공',1),item('earth'+i,1000*i),
 heading('p'+i,'2. 포장공',1),item('pave'+i,2000*i),
 heading('w'+i,'3. 배관공',1),item('pipe'+i,3000*i),
 heading('d'+i,'4. 폐기물처리',1),{...item('waste'+i),bucket:'waste'}])});

test('공구별 토공·포장공 50%, 배관공 30%만 추가하고 반복 적용은 동일하다',()=>{
 const original=sample(),r=applyEmergencySurcharges(original),p=synchronizeLinkedCosts(r.project);
 assert.equal(r.added,6);assert.equal(original.lines.length,18);
 assert.deepEqual(p.lines.filter(l=>l.surcharge).map(l=>[l.qty,amount(l).labor,amount(l).material]),[[50,500,0],[50,1000,0],[30,900,0],[50,1000,0],[50,2000,0],[30,1800,0]]);
 assert.equal(applyEmergencySurcharges(p).added,0);assert.equal(applyEmergencySurcharges(p).kept,6);
 p.lines.find(l=>l.id==='earth1').qty=2;p.lines.find(l=>l.id==='earth1').bidPercent=95;
 const changed=synchronizeLinkedCosts(p);assert.equal(amount(changed.lines.find(l=>l.surcharge)).labor,950);
});

test('기존 수동 할증과 누락 단가를 보존하고 다른 공구에 섞지 않는다',()=>{
 let p=applyEmergencySurcharges(sample()).project;p.lines.find(l=>l.surcharge).qty=20;
 p.lines.find(l=>l.id==='pipe2').rate=null;p.lines.find(l=>l.id==='pipe2').status='unmatched';
 p=synchronizeLinkedCosts(applyEmergencySurcharges(p).project);
 assert.equal(p.lines.find(l=>l.surcharge).qty,20);
 assert.equal(p.lines.filter(l=>l.surcharge).at(-1).status,'proposed');
 assert.equal(amount(p.lines.filter(l=>l.surcharge)[2]).labor,900);
});

test('긴급 수량산출서 여러 파일을 가져오면 각 L2 안에 기본 할증이 생긴다',()=>{
 const entries=[1,2].map(i=>({file:i+'.xlsx',quantity:{title:i+'현장',rows:[item('a'+i)]}}));
 const p=buildQuantityProject(empty(),entries,{numbered:true});
 assert.equal(p.lines.filter(l=>l.level===2).length,2);assert.equal(p.lines.filter(l=>l.surcharge).length,2);
 assert.equal(buildQuantityProject(empty(),entries,{numbered:false}).lines.filter(l=>l.surcharge).length,0);
});

test('새 실행은 빈 화면이며 이전 초안은 보관함에서 다시 열 수 있다',async()=>{
 const store=memory(),old=sample();await store.put('project',old);
 assert.deepEqual(await startBlankSession(store,empty(),p=>p),empty());
 assert.equal((await store.get('workbench')).projects[0].title,old.title);
 assert.deepEqual(await store.get('project'),empty());
 await startBlankSession(store,empty(),p=>p);assert.equal((await store.get('workbench')).projects.length,1);
});

test('보관함 쓰기 실패 시 기존 초안을 지우지 않는다',async()=>{
 const store=memory(),old=sample();await store.put('project',old);
 const put=store.put;store.put=async(k,v)=>{if(k==='workbench')throw Error('disk full');return put(k,v);};
 await assert.rejects(startBlankSession(store,empty(),p=>p),/disk full/);assert.deepEqual(await store.get('project'),old);
});

test('닫기 취소·저장·저장 안 함, 업데이트 중복 요청과 저장 실패',async()=>{
 let p=sample(),choice='cancel',asked=0,saved=0,cleared=0,errors=0;
 const close=createCloseController({getProject:()=>p,newState:empty,beforePrompt:async()=>{},ask:async()=>{asked++;return choice;},save:async()=>{saved++;},clearDraft:async()=>{cleared++;},onError:()=>errors++});
 assert.equal((await close()).cancelled,true);assert.equal(cleared,0);
 choice='discard';assert.equal((await close()).ok,true);assert.equal(saved,0);
 assert.equal((await close()).ok,true);assert.equal(asked,2);
 p.title='changed';choice='save';assert.equal((await close()).ok,true);assert.equal(saved,1);
 p.title='update';assert.equal((await close({save:true})).ok,true);assert.equal(saved,2);assert.equal(asked,3);
 const failed=createCloseController({getProject:()=>p,newState:empty,beforePrompt:async()=>{},ask:async()=>'save',save:async()=>{throw Error('disk full');},clearDraft:async()=>{throw Error('must not clear');},onError:()=>errors++});
 assert.equal((await failed()).ok,false);assert.equal(errors,1);
});

test('전체 엑셀 출력에서 비어 있는 mergeCells 요소를 만들지 않는다',async()=>{
 const p=synchronizeLinkedCosts(applyEmergencySurcharges(sample()).project),zip=await unzip(exportEvidenceEstimate(p,[]));
 for(let i=1;i<=10;i++){
  const xml=new TextDecoder().decode(await zip.read(`xl/worksheets/sheet${i}.xml`));
  assert.doesNotMatch(xml,/<mergeCells\s+count="0"/);
  if(i<=6)assert.doesNotMatch(xml,/<mergeCells/);
 }
});
