import test from 'node:test';
import assert from 'node:assert/strict';
import {collectPrintEvidence} from '../dist/print-evidence.js';
import {machineBasisRows} from '../dist/machine-basis-print.js';
import {machineryRate} from '../dist/work-core.js';

function fixture(overrides={}){
 const machineInputs={price:1000000,exchange:1,ownership:10000,ownershipScale:7,fuel:2,fuelPrice:1000,oilPercent:10,dailyWage:200000,workers:1,hours:8,misc:0,operatorFactor:1,...overrides};
 const rate={name:'직접 입력 장비',spec:'시험',unit:'hr',category:'장비',machineInputs,...machineryRate(machineInputs)};
 const project={title:'기계경비 적용기준 검증',lines:[{id:'m',name:rate.name,qty:1,status:'confirmed',bucket:'direct',rate}]};
 return {project,nodes:collectPrintEvidence(project).nodes};
}

test('직접 입력 장비도 검증된 실제 입력값을 적용기준에 한글로 출력한다',()=>{
 const {project,nodes}=fixture(),before=JSON.stringify(project),rows=machineBasisRows(nodes);
 assert.equal(nodes[0].verified,true);
 assert.equal(nodes[0].machine.total,28200);
 assert.deepEqual(rows.map(r=>r[0]),['기준가격','적용 환율','손료계수','주연료','잡유','운전원']);
 assert.deepEqual(rows.find(r=>r[0]==='손료계수').slice(2),['10,000 × 10^(-7)','0.001','직접 입력']);
 assert.equal(rows.find(r=>r[0]==='운전원')[2],'200,000 × 1 × 1 ÷ 8');
 assert.equal(rows.find(r=>r[0]==='주연료')[2],'2 × 1,000');
 assert.ok(rows.every(r=>!r.join(' ').includes('확인 필요')));
 assert.equal(JSON.stringify(project),before);
});

test('입력 장비의 손료 지수·운전원 보정·기타경비와 출처를 유지한다',()=>{
 const {nodes}=fixture({ownershipScale:6,exchange:1300,operatorFactor:1.25,misc:123.4});nodes[0].rate.source='사용자 장비 기준';
 const rows=machineBasisRows(nodes);
 assert.deepEqual(rows.find(r=>r[0]==='손료계수').slice(2),['10,000 × 10^(-6)','0.01','사용자 장비 기준']);
 assert.equal(rows.find(r=>r[0]==='운전원')[2],'200,000 × 1 × 1.25 ÷ 8');
 assert.equal(rows.find(r=>r[0]==='기타경비')[3],'123.4 원');
 assert.ok(rows.every(r=>r[4]==='사용자 장비 기준'));
});

test('현재 적용 단가와 장비 입력값이 다르면 확인 필요를 유지한다',()=>{
 const {project}=fixture();project.lines[0].rate.labor+=1;
 const nodes=collectPrintEvidence(project).nodes;
 assert.equal(nodes[0].verified,false);
 assert.deepEqual(machineBasisRows(nodes),[['확인 필요','직접 입력 장비 / 시험','산출 구성을 확인하지 못했습니다.','','']]);
});
