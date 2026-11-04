import test from 'node:test';
import assert from 'node:assert/strict';
import {makePrintDocuments,buildPrintPages} from '../dist/est-print.js';
import {machineryRate} from '../dist/work-core.js';
import {defaultCharges} from '../dist/calc.js';

const inputs={price:1000000,exchange:1,ownership:10000,ownershipScale:7,fuel:2,fuelPrice:1000,oilPercent:10,dailyWage:200000,workers:1,hours:8,misc:0,operatorFactor:1};
function project(m=inputs){const rate={name:'직접 작성 장비',spec:'시험 규격',unit:'시간',source:'나의 단가',category:'장비',code:'MACHINE-1',machineInputs:m,...machineryRate(m)};return {schema:1,title:'장비 근거 검증',lines:[{id:'machine',name:rate.name,qty:2,status:'confirmed',bucket:'direct',rate}],charges:defaultCharges()};}

test('직접 작성 장비는 내부 키 대신 실제 손료·연료·잡유·운전원 산식을 출력한다',()=>{
 const p=project(),before=structuredClone(p),bundle=makePrintDocuments(p),doc=bundle.documents.find(d=>d.key==='machines');
 assert.equal(doc.rows[0].cells[3].value,'28,200');
 const parts=doc.rows.filter(r=>['손료','주연료','잡유','운전원'].includes(r.cells[0].value));
 assert.deepEqual(parts.map(r=>[r.cells[0].value,r.cells[2].value,r.cells[3].value]),[
  ['손료','1,000,000 × 1 × 10,000 × 10^(-7)','1,000'],
  ['주연료','2 × 1,000','2,000'],['잡유','2,000 × 10%','200'],['운전원','200,000 × 1 × 1 ÷ 8','25,000']
 ]);
 assert.equal(parts.reduce((n,r)=>n+Number(r.cells[3].value.replaceAll(',','')),0),28200);
 assert.doesNotMatch(JSON.stringify(doc.rows),/fuelPrice|ownershipScale|dailyWage/);
 assert.deepEqual(p,before);
 assert.ok(buildPrintPages(bundle,{sections:['machines']}).length);
});

test('직접 작성 장비의 소수 입력과 기타 경비도 적용 단가와 같은 절사 기준을 따른다',()=>{
 const p=project({...inputs,price:1000123.45,exchange:1.2,fuel:2.345,fuelPrice:1000.1,oilPercent:7.5,dailyWage:200001.5,operatorFactor:1.2,hours:7,misc:13.8});
 const doc=makePrintDocuments(p).documents.find(d=>d.key==='machines');
 const parts=doc.rows.filter(r=>['손료','주연료','잡유','운전원','기타 경비'].includes(r.cells[0].value));
 for(const [offset,key] of [[4,'labor'],[5,'material'],[6,'expense']])assert.equal(parts.reduce((n,r)=>n+Number(r.cells[offset].value.replaceAll(',','')),0),p.lines[0].rate[key]);
});

test('입력 산식과 저장 단가가 다른 장비를 검증된 근거처럼 출력하지 않는다',()=>{
 const p=project();p.lines[0].rate.labor=1;p.lines[0].rate.total=3201;
 const b=makePrintDocuments(p),doc=b.documents.find(d=>d.key==='machines');
 assert.match(JSON.stringify(doc.rows),/입력 산식과 현재 단가가 다릅니다/);
 assert.ok(b.warnings.some(s=>s.includes('장비 입력값과 현재 단가가 다름')));
 assert.ok(!doc.rows.some(r=>r.cells[0].value==='운전원'));
});

test('일위대가 첫 열은 EST 원본처럼 호표이고 내역서 공종 제목은 유지한다',()=>{
 const b=makePrintDocuments(project());
 assert.equal(b.documents.find(d=>d.key==='units').headers[0][0].value,'호 표');
 assert.equal(b.documents.find(d=>d.key==='estimate').headers[0][0].value,'공종');
});
