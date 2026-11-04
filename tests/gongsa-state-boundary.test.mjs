import test from 'node:test';
import assert from 'node:assert/strict';
import {copyProjectLines,editBlock} from '../dist/work-core.js';
import {amount,synchronizeLinkedCosts} from '../dist/calc.js';
const line=(id,price=100)=>({id,name:id,group:'토공',spec:'',unit:'식',qty:1,bucket:'direct',status:'confirmed',rate:{labor:price,material:0,expense:0,other:0,total:price}});
const heading=(id,level)=>({...line(id,0),level,qty:null,status:'unmatched',rate:null});
const project=lines=>({schema:1,title:'복사 검증',location:'',charges:[],lines});
const surcharge=scope=>({...line('s',0),qty:50,unit:'%',surcharge:{scope,basis:'labor',target:'labor',sourceIds:scope==='selected'?['a']:[]}});

test('cross-project group and section surcharges require their original heading boundary',()=>{
 for(const [scope,level] of [['group',1],['section',2]]){
  const source=synchronizeLinkedCosts(project([heading('source-heading',level),line('a'),surcharge(scope)]));
  const target=project([heading('target-heading',level),line('b',10000)]),before=structuredClone(target);
  assert.equal(amount(source.lines.at(-1)).total,50);
  assert.throws(()=>copyProjectLines(target,source,['a','s']),/공종·공구 제목/);
  assert.throws(()=>copyProjectLines(target,source,['s']),/공종·공구 제목/);
  assert.deepEqual(target,before);
  const copied=synchronizeLinkedCosts(copyProjectLines(target,source,['source-heading','a','s']));
  assert.equal(amount(copied.lines.at(-1)).total,50);
  assert.deepEqual(copied.lines.at(-1).surcharge.resolvedSourceIds,[copied.lines.at(-2).id]);
  assert.notEqual(copied.lines.at(-2).id,'a');
 }
});

test('cross-project selected surcharge references follow copied IDs and survive quantity clearing',()=>{
 const source=synchronizeLinkedCosts(project([line('a'),surcharge('selected')])),target=project([line('a',10000)]);
 const copied=synchronizeLinkedCosts(copyProjectLines(target,source,['a','s']));
 assert.equal(amount(copied.lines.at(-1)).total,50);assert.deepEqual(copied.lines.at(-1).surcharge.sourceIds,[copied.lines.at(-2).id]);
 const cleared=synchronizeLinkedCosts(copyProjectLines(target,source,['a','s'],true));
 assert.equal(cleared.lines.at(-2).qty,null);assert.equal(cleared.lines.at(-1).qty,50);assert.equal(cleared.lines.at(-1).status,'proposed');
});

test('copying a selected surcharge within the same project keeps its original source',()=>{
 const p=synchronizeLinkedCosts(project([line('a'),surcharge('selected')]));
 const copied=synchronizeLinkedCosts(editBlock(p,['s'],'copy'));
 assert.equal(amount(copied.lines.at(-1)).total,50);assert.deepEqual(copied.lines.at(-1).surcharge.sourceIds,['a']);
 assert.equal(p.lines.length,2);
});
