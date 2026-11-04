import test from 'node:test';
import assert from 'node:assert/strict';
import {readQuantityContracts} from '../dist/quantity-contract.js';
import {extractQuantities,exportEstimate} from '../dist/workbook.js';
import {buildQuantityProject} from '../dist/quantity-batch.js';
import {appendQuantitySection} from '../dist/levels.js';
import {validateProject} from '../dist/project-data.js';
import {totals} from '../dist/calc.js';
import {workConnectionJoints} from '../dist/work-connection-joints.js';
const joint=(id='1공구-밸브1',diameter=80)=>({id,diameter});
const line=()=>({id:'a',group:'배관공',name:'플랜지조인트접합',spec:'D80',unit:'개소',qty:1,factor:1,bucket:'direct',status:'confirmed',rate:{name:'플랜지조인트접합',spec:'D80',unit:'개소',source:'추가 DB',code:'U1',labor:100,material:0,expense:0,other:0,total:100}});
const base=()=>({schema:1,title:'검증',location:'',lines:[],charges:[]});
const entry=(file,id='1공구-밸브1')=>({file,quantity:{title:file,location:'',rows:[line()],workConnectionJoints:[joint(id)]}});
function workbook(value){return [{name:'수량',rows:[{index:1,cells:{B:{value:'품명'},C:{value:'규격'},D:{value:'수량'},E:{value:'단위'}}},{index:2,cells:{A:{value:'배관공'},B:{value:'플랜지조인트접합'},C:{value:'D80'},D:{value:1,ref:'D2'},E:{value:'개소'}}}]},{name:'_공사노트연동',rows:[{index:1,cells:{A:{value:'gongsa.quantity.v1'}}},{index:2,cells:{A:{value:JSON.stringify({schema:1,catalogVersion:'test',...(value===undefined?{}:{workConnectionJoints:value})})}}}]}];}
test('접합부 정보가 시트·수량·공구·저장 복원을 통과해 보존',()=>{
 const sheet=readQuantityContracts(workbook([joint()]))[0],quantity=extractQuantities(sheet);
 assert.deepEqual(quantity.workConnectionJoints,[joint()]);
 const p=buildQuantityProject(base(),[{file:'1공구.xlsx',quantity}]);
 const restored=validateProject(JSON.parse(JSON.stringify(p)));
 assert.deepEqual(restored.lines.find(l=>l.level===2).workConnectionJoints,[joint()]);
});
test('두 파일에서 동일 접합부를 중복하면 파일명과 번호를 안내',()=>{
 assert.throws(()=>buildQuantityProject(base(),[entry('첫째.xlsx'),entry('둘째.xlsx')]),e=>/첫째.xlsx/.test(e.message)&&/둘째.xlsx/.test(e.message)&&/1공구-밸브1/.test(e.message));
});
test('기존 공구에 추가할 때에도 저장된 동일 접합부를 중복하지 않음',()=>{
 const first=buildQuantityProject(base(),[entry('첫째.xlsx')]);
 assert.throws(()=>buildQuantityProject(first,[entry('추가.xlsx')],{append:true}),/접합부.*중복/);
 assert.throws(()=>appendQuantitySection(first,entry('추가.xlsx').quantity,'추가.xlsx'),/접합부.*중복/);
});
test('서로 다른 실제 접합부와 기존 메타데이터 없는 자료는 가져오기 유지',()=>{
 const entries=[entry('첫째.xlsx','현장A-J1'),entry('둘째.xlsx','현장B-J1')],p=buildQuantityProject(base(),entries,{numbered:true});
 assert.equal(p.lines.filter(l=>l.level===2).length,2);assert.equal(totals(p.lines,[]).direct,260);
 const legacy=entry('기존.xlsx');delete legacy.quantity.workConnectionJoints;
 assert.doesNotThrow(()=>buildQuantityProject(p,[legacy],{append:true}));
 assert.deepEqual(extractQuantities(readQuantityContracts(workbook())[0]).workConnectionJoints,[]);
});
test('접합부 목록 손상·중복·관경 오류를 빈 목록으로 무시하지 않음',()=>{
 for(const value of [null,{},['J1'],[{id:'',diameter:80}],[{id:'J1',diameter:'80'}],[joint(),joint()],[joint('J1',0)]]){
  assert.throws(()=>readQuantityContracts(workbook(value)),/접합부/);
  assert.throws(()=>workConnectionJoints(value),/접합부/);
 }
});
test('동일 접합부 ID는 다른 관경으로 적어도 파일 간 중복',()=>{
 const a=entry('첫째.xlsx'),b=entry('둘째.xlsx');b.quantity.workConnectionJoints[0].diameter=100;
 assert.throws(()=>buildQuantityProject(base(),[a,b]),/접합부.*중복/);
});
test('같은 접합부가 있는 공구를 복사한 저장자료와 출력도 차단',()=>{
 const p=buildQuantityProject(base(),[entry('원본.xlsx')]);const copies=structuredClone(p.lines);copies.forEach(l=>l.id+='copy');p.lines.push(...copies);
 assert.throws(()=>validateProject(p),/접합부.*중복/);assert.throws(()=>exportEstimate(p),/접합부.*중복/);
});
test('내역 전체 교체는 이전 공사의 접합부 기록을 새 공사에 섞지 않음',()=>{
 const p=buildQuantityProject(base(),[entry('기존.xlsx')]);
 assert.doesNotThrow(()=>buildQuantityProject(p,[entry('교체.xlsx')],{append:false}));
});
