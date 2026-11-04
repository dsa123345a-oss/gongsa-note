import test from 'node:test';
import assert from 'node:assert/strict';
import {searchLibraries,searchLineLibraries} from '../dist/library-search.js';
import {collectEvidence} from '../dist/project-data.js';
import {createDeferredTask} from '../dist/deferred-task.js';
import {createProjectHistory} from '../dist/project-history.js';
const rate=(name,spec='D20')=>({name,spec,unit:'개',code:'M1',category:'자재',labor:0,material:100,expense:0,total:100});
test('검색 캐시는 품명·규격·분류·비목 수정과 같은 길이 DB 교체를 즉시 반영한다',()=>{
 const item=rate('STS소켓'),lib={items:[item]},line={name:item.name,spec:'D20',group:'자재대'};
 assert.equal(searchLineLibraries([lib],line)[0].items[0],item);
 searchLibraries([lib],'STS소켓')[0].items.length=0;
 assert.equal(searchLibraries([lib],'STS소켓')[0].items.length,1);
 item.name='모래부설';assert.equal(searchLibraries([lib],'STS소켓')[0].items.length,0);
 item.name='STS소켓';item.spec='D50';assert.equal(searchLineLibraries([lib],line)[0].items[0].spec,'D50');
 item.category='일위대가';assert.equal(searchLibraries([lib],'','자재')[0].items.length,0);
 item.labor=NaN;assert.equal(searchLibraries([lib],'')[0].items[0],item);
 const next=rate('아스콘소운반');lib.items[0]=next;assert.equal(searchLibraries([lib],'')[0].items[0],next);
 lib.items.push(rate('레미콘소운반'));assert.equal(searchLibraries([lib],'')[0].items.length,2);
 lib.items.pop();assert.equal(searchLibraries([lib],'')[0].items.length,1);
});
test('근거 색인은 첫 원본 근거와 수정된 산식·비목을 보존하고 호출 사이 편집을 반영한다',()=>{
 const r={...rate('관'),source:'DB',library:'db',components:[{name:'작업',qty:1}]},saved={rate:structuredClone(r),rows:[{Name:'첫 근거'}]},p={lines:[{rate:r,status:'confirmed'}],evidence:[saved,{...saved,rows:[{Name:'다른 근거'}]}]},libs=[{id:'db',details:[['HeadMainDat:M1',[{Name:'DB 근거'}]]]}];
 assert.equal(collectEvidence(p,libs)[0].rows,saved.rows);
 r.components[0].qty=2;assert.deepEqual(collectEvidence(p,libs)[0].rows,[]);
 p.lines[0].exclude=true;assert.deepEqual(collectEvidence(p,libs),[]);
});
test('빠른 입력은 즉시 모델에 보존하고 조합 중 무거운 처리를 미루며 저장 전 마지막 입력을 반영한다',async()=>{
 const model={title:''},history=createProjectHistory(model);let calls=0;
 const task=createDeferredTask(()=>{calls++;history.record(model,'title');},5);
 task.pause();for(const text of ['ㄱ','공','공사']){model.title=text;task.schedule();}
 await new Promise(r=>setTimeout(r,15));assert.equal(calls,0);assert.equal(model.title,'공사');
 task.resume();task.flush();assert.equal(calls,1);assert.equal(history.undo().title,'');assert.equal(history.redo().title,'공사');
 await new Promise(r=>setTimeout(r,15));assert.equal(calls,1);
 model.title='최종';task.schedule();task.schedule();await new Promise(r=>setTimeout(r,15));assert.equal(calls,2);assert.equal(task.pending,false);
});
