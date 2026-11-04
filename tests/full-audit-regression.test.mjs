import test from 'node:test';import assert from 'node:assert/strict';
import {createCloseController,createSavedProjectState} from '../dist/session-lifecycle.js';
import {copyProjectLines} from '../dist/work-core.js';
import {editCostCharge,insertCostCharge,deleteCostCharge} from '../dist/cost-edit.js';
import {defaultChargeFormula} from '../dist/cost-formula.js';
import {withBidLines} from '../dist/bid-core.js';
import {totals,defaultCharges} from '../dist/calc.js';
const line=(id,price=100)=>({id,name:id,spec:'',unit:'식',group:'토공',qty:1,factor:1,bucket:'direct',status:'confirmed',rate:{labor:price,material:0,expense:0,other:0,total:price}});
const project=lines=>({schema:1,title:'검증',location:'',lines,charges:[]});
test('inserting/removing cost rows keeps the health insurance basis reference correct',()=>{
 const p=project([line('a',100000)]);p.charges=defaultCharges();p.charges.find(c=>c.key==='health').rate=3.595;
 let changed=insertCostCharge(p,'health').project;const care=changed.charges.find(c=>c.base==='health');care.rate=13.14;
 assert.equal(defaultChargeFormula(care,changed.charges),'[10] * R');
 const before=totals(changed.lines,changed.charges).grand;care.formula=defaultChargeFormula(care,changed.charges);
 assert.equal(totals(changed.lines,changed.charges).grand,before);
 changed=deleteCostCharge(changed,'health');delete changed.charges.find(c=>c.base==='health').formula;
 assert.equal(defaultChargeFormula(changed.charges.find(c=>c.base==='health'),changed.charges),'0 * R');
});
test('saved/opened contents close without a prompt; a modification does prompt',async()=>{
 const p=project([line('a')]),saved=createSavedProjectState(p);let asked=0,cleared=0;
 const close=createCloseController({getProject:()=>p,isDirty:()=>saved.isDirty(p),beforePrompt:async()=>{},ask:async()=>{asked++;return 'cancel';},clearDraft:async()=>{cleared++;},onError:e=>{throw e;}});
 assert.equal((await close()).ok,true);assert.equal(asked,0);assert.equal(cleared,1);
 p.lines[0].qty=2;assert.equal((await close()).cancelled,true);assert.equal(asked,1);assert.equal(cleared,1);
 saved.markSaved(p);assert.equal((await close({save:true})).ok,true);assert.equal(asked,1);
});
test('undoing to the saved state is clean, save metadata is ignored, evidence edits are not',()=>{
 const p=project([line('a')]),saved=createSavedProjectState(p);p.lines[0].qty=2;assert.equal(saved.isDirty(p),true);
 p.lines[0].qty=1;p.savedAt='2026-11-02';assert.equal(saved.isDirty(p),false);
 p.evidence=[{rows:[{value:2}]}];assert.equal(saved.isDirty(p),true);
 saved.markSaved(p);p.evidence[0].rows[0].value=3;assert.equal(saved.isDirty(p),true);
});
test('cancelled/failed saves leave edited contents dirty and keep the draft',async()=>{
 const p=project([line('a')]),saved=createSavedProjectState(p);p.title='edited';let cleared=0;
 for(const result of [{cancelled:true},{error:'disk full'}]){
  const close=createCloseController({getProject:()=>p,isDirty:()=>saved.isDirty(p),beforePrompt:async()=>{},ask:async()=>'save',save:async()=>result,clearDraft:async()=>{cleared++;},onError:()=>{}});
  assert.equal((await close()).ok,false);assert.equal(saved.isDirty(p),true);
 }
 assert.equal(cleared,0);
});
test('editing while file save is pending prevents closing and preserves the draft',async()=>{
 let p=project([line('a')]),cleared=0,error='';
 const close=createCloseController({getProject:()=>p,newState:()=>project([]),beforePrompt:async()=>{},ask:async()=>'save',save:async()=>{p.lines[0].qty=2;return {saved:true};},clearDraft:async()=>{cleared++;},onError:e=>error=e.message});
 assert.equal((await close()).ok,false);assert.equal(cleared,0);assert.match(error,/변경/);assert.equal(p.lines[0].qty,2);
});
test('editing while clearing draft restores current work and aborts closing',async()=>{
 const p=project([line('a')]);let stored,prepares=0;
 const close=createCloseController({getProject:()=>p,newState:()=>project([]),beforePrompt:async()=>{stored=structuredClone(p);prepares++;},ask:async()=>'discard',clearDraft:async()=>{stored=null;p.title='new edit';},onError:()=>{}});
 assert.equal((await close()).ok,false);assert.equal(prepares,2);assert.equal(stored.title,'new edit');
});
test('cross-project surcharge copy cannot bind to an unrelated same-ID target row',()=>{
 const s={...line('s'),qty:50,unit:'%',surcharge:{scope:'selected',basis:'labor',target:'labor',sourceIds:['est:1']}};
 const source=project([line('est:1'),s]),target=project([line('est:1',10000)]),snapshot=structuredClone(target);
 assert.throws(()=>copyProjectLines(target,source,['s']),/기준 행/);assert.deepEqual(target,snapshot);
 const copied=copyProjectLines(target,source,['est:1','s']);assert.equal(copied.lines[2].surcharge.sourceIds[0],copied.lines[1].id);assert.equal(totals(copied.lines,[]).direct,10150);
});
test('explicit fixed-charge edits survive restoring bid percent to 100',()=>{
 const original={key:'health',name:'건강보험료',base:'labor',rate:3};
 const p=project([{...line('a',1000),bidPercent:95}]);p.charges=[{...original,base:'fixed',fixed:30,bidOriginal:original}];
 p.charges[0]=editCostCharge(p.charges[0],'fixed',42);
 const restored=withBidLines(p,p.lines.map(l=>({...l,bidPercent:100})),[]);
 assert.equal(restored.charges[0].fixed,42);assert.equal(totals(restored.lines,restored.charges).charges[0].amount,42);
});
