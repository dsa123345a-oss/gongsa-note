import test from 'node:test';
import assert from 'node:assert/strict';
import {createRowSelection} from '../dist/row-selection.js';
import {editBlock} from '../dist/work-core.js';
import {createProjectHistory} from '../dist/project-history.js';
const selection=()=>{const s=createRowSelection();s.reconcile(['a','b','c','d','e']);return s;};
test('Shift selects a contiguous range in either direction and can shrink it',()=>{const s=selection();s.select('b');s.select('e',{shift:true});assert.deepEqual(s.ids,['b','c','d','e']);s.select('c',{shift:true});assert.deepEqual(s.ids,['b','c']);s.select('a',{shift:true});assert.deepEqual(s.ids,['a','b']);assert.equal(s.anchor,'b');});
test('Ctrl toggles disjoint rows without changing their source order',()=>{const s=selection();s.select('d');s.select('b',{ctrl:true});assert.deepEqual(s.ids,['b','d']);s.select('d',{ctrl:true});assert.deepEqual(s.ids,['b']);s.select('b',{ctrl:true});assert.deepEqual(s.ids,[]);assert.equal(s.active,null);});
test('Ctrl+Shift adds a range to existing selections',()=>{const s=selection();s.select('a');s.select('c',{ctrl:true});s.select('e',{ctrl:true,shift:true});assert.deepEqual(s.ids,['a','c','d','e']);s.select('b');assert.deepEqual(s.ids,['b']);});
test('Hidden rows are not selected by range or select all',()=>{const s=selection();s.reconcile(['a','c','e']);s.select('a');s.select('e',{shift:true});assert.deepEqual(s.ids,['a','c','e']);s.all();assert.deepEqual(s.ids,['a','c','e']);s.reconcile(['a','e'],s.active);assert.deepEqual(s.ids,['a','e']);});
test('Rendering keeps selection by ID while a new project resets it',()=>{const s=selection();s.select('a');s.select('c',{ctrl:true});s.reconcile(['c','b','a'],s.active);assert.deepEqual(s.ids,['c','a']);s.reconcile(['x','y'],null);assert.deepEqual(s.ids,[]);s.select('missing',{shift:true});assert.deepEqual(s.ids,[]);});
test('Select all, copy selection replacement and Escape clear preserve anchors',()=>{const s=selection();s.all();assert.equal(s.ids.length,5);s.replace(['b','d']);assert.deepEqual(s.ids,['b','d']);assert.equal(s.anchor,'b');assert.equal(s.active,'d');s.clear();assert.deepEqual(s.ids,[]);s.select('e',{shift:true});assert.deepEqual(s.ids,['e']);});
test('Batch copy/delete operate on chosen IDs and one undo restores the entire edit',()=>{
 const line=id=>({id,name:id,spec:'',unit:'m',group:'토공',level:0,qty:1,bucket:'direct',status:'confirmed',rate:{labor:100,material:0,expense:0,other:0,total:100}});
 const p={schema:1,title:'선택 검증',lines:['a','b','c','d','e'].map(line),charges:[]},s=selection();s.select('b');s.select('d',{ctrl:true});
 const copy=editBlock(p,s.ids,'copy');assert.deepEqual(copy.lines.map(l=>l.name),['a','b','c','d','b','d','e']);assert.equal(new Set(copy.lines.map(l=>l.id)).size,7);
 const history=createProjectHistory(p),removed=editBlock(p,s.ids,'delete');history.record(removed);assert.deepEqual(removed.lines.map(l=>l.id),['a','c','e']);assert.deepEqual(history.undo(),p);assert.equal(p.lines.length,5);
});
