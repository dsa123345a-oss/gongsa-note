import test from 'node:test';
import assert from 'node:assert/strict';
import {repeatableContractTarget} from '../dist/cost-edit.js';
import {reverseContract} from '../dist/work-core.js';
import {totals,defaultCharges} from '../dist/calc.js';
test('4자리 절사 역산은 1원 차액이 있어도 반복 적용 시 목표액을 한 단위 더 낮추지 않는다',()=>{
 const p={schema:1,title:'시험 공사',charges:defaultCharges(),lines:[{id:'l',name:'터파기',spec:'',unit:'식',group:'토공',bucket:'direct',qty:100,status:'confirmed',bidPercent:95,rate:{labor:5431,material:1442,expense:0,other:0,total:6873}}]};
 const before=totals(p.lines,p.charges).contract,target=repeatableContractTarget(before),r=reverseContract(p,target),adjustment=r.project.charges.find(c=>c.key==='profit').adjustment;
 assert.equal(target,Math.floor(before/10000)*10000);assert.equal(r.difference,1);
 assert.equal(repeatableContractTarget(r.actual,10000,'floor',adjustment),target);
 assert.equal(reverseContract(r.project,repeatableContractTarget(r.actual,10000,'floor',adjustment)).actual,r.actual);
 assert.equal(repeatableContractTarget(r.actual+20000,10000,'floor',adjustment),Math.floor((r.actual+20000)/10000)*10000);
 assert.equal(repeatableContractTarget(r.actual,1,'floor',adjustment),r.actual);
});
