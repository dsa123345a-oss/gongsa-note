import test from 'node:test';
import assert from 'node:assert/strict';
import {planPriceUpdate,validatePriceReference} from '../dist/price-update.js';
import {createResourcePricer,resourceLibrary} from '../dist/resource-pricing.js';
import {amount} from '../dist/calc.js';
const material=(code,name,price)=>({id:code,code,name,spec:'D15',unit:'개',category:'자재',table:'StuffcDat',source:'추가',library:'extra',labor:0,material:price,expense:0,other:0,total:price});
function fixture(){
 const a=material('M1','관',10),b=material('M2','특수소켓',50);
 const assembly={id:'U1',code:'U1',name:'설치',spec:'D15',unit:'개',category:'일위대가',table:'HeadTitleDat',source:'추가',library:'extra',components:[{...a,qtyExpression:'2'},{...b,qtyExpression:'1'}],calculation:{componentDigits:0},labor:0,material:70,expense:0,other:0,total:70};
 const extra={id:'extra',name:'추가',items:[a,b,assembly],tables:[],details:[]};
 const reference={id:'main',name:'2026-10-main.estx',items:[{...a,id:'M9',code:'M9',source:'2026-10-main.estx',library:'main',material:20,total:20}],tables:[],details:[]};
 const project={schema:1,title:'검증',lines:[{id:'l1',name:'설치',spec:'D15',unit:'개',group:'배관',bucket:'direct',qty:3,bidPercent:90,factor:1,status:'confirmed',rate:assembly}],charges:[],mappings:{}};
 return {project,extra,reference};
}
test('못 찾은 구성은 기존 단가로 남기고 나머지 구성만 갱신하며 미리보기는 원본을 바꾸지 않는다',()=>{
 const {project,extra,reference}=fixture(),before=JSON.stringify({project,extra,reference});
 const result=planPriceUpdate(project,[extra],reference,['extra']);
 assert.equal(result.project.lines[0].rate.total,90);assert.equal(result.project.lines[0].status,'confirmed');assert.equal(amount(result.project.lines[0]).total,243);
 assert.equal(result.libraries[0].items[0].total,20);assert.equal(result.libraries[0].items[1].total,50);assert.equal(result.libraries[0].items[2].total,90);
 assert.equal(result.project.lines[0].qty,3);assert.equal(result.project.lines[0].bidPercent,90);assert.ok(result.warnings.some(w=>w.resource?.name==='특수소켓'));
 assert.equal(JSON.stringify({project,extra,reference}),before);assert.doesNotThrow(()=>JSON.stringify(result));
});
test('다음 월에 품목이 없어지면 최초 단가가 아니라 직전 업데이트 값을 유지',()=>{
 const {project,extra,reference}=fixture(),first=planPriceUpdate(project,[extra],reference,['extra']);
 const later={...reference,id:'later',name:'최신 배포 DB.estx',items:[{...material('M-unrelated','다른 품목',99),library:'later'}]};
 const second=planPriceUpdate(first.project,first.libraries,later,['extra']);
 assert.equal(second.libraries.find(l=>l.id==='extra').items[0].total,20);assert.equal(second.project.lines[0].rate.total,90);
 assert.equal(resourceLibrary({},second.libraries).id,'later');
 const linked=createResourcePricer(second.project,second.libraries).reprice(second.libraries.find(l=>l.id==='extra').items[2]);
 assert.equal(linked.ready,true);assert.equal(linked.rate.total,90);
 assert.equal(createResourcePricer({},second.libraries).reprice(second.libraries.find(l=>l.id==='extra').items[2]).rate.total,90);
});
test('단가와 무관한 빈 수량 표는 허용하고 손상된 단가 표는 차단한다',()=>{
 const {reference}=fixture();reference.tables=[{name:'ExcelMullangList.Dat',error:'empty'}];assert.doesNotThrow(()=>validatePriceReference(reference));
 reference.tables.push({name:'StuffcDat.dat',error:'invalid'});assert.throws(()=>validatePriceReference(reference));
});
test('서로 다른 규격의 자재는 임의로 바꾸지 않고 유지 사유를 남긴다',()=>{
 const {project,extra,reference}=fixture();reference.items[0].spec='D150';
 const result=planPriceUpdate(project,[extra],reference,['extra']);assert.equal(result.project.lines[0].rate.total,70);assert.equal(result.after.missing,0);assert.ok(result.warnings.length);
});
test('계산 구성을 해석하지 못하면 해당 완성 단가를 보존하고 실패 사유를 표시',()=>{
 const {project,extra,reference}=fixture();delete extra.items[2].components;
 const result=planPriceUpdate(project,[extra],reference,['extra']);assert.equal(result.project.lines[0].rate.total,70);assert.equal(result.after.missing,1);assert.equal(result.project.lines[0].status,'proposed');assert.equal(amount(result.project.lines[0]),null);assert.ok(result.summary.unverified>0);assert.ok(result.rows.some(r=>r.warnings.some(w=>w.reason.includes('산식 검증 불가')&&w.retained===false)));
});
test('선택하지 않은 DB와 현재 내역의 수량·원가 요율은 변경하지 않는다',()=>{
 const {project,extra,reference}=fixture();const result=planPriceUpdate(project,[extra],reference,[]);
 assert.deepEqual(result.libraries[0].items,extra.items);assert.deepEqual(result.project.charges,project.charges);assert.equal(result.project.lines[0].rate.total,90);
});
test('단가 업데이트로 검토 중인 연결까지 자동 확정하지 않는다',()=>{
 const {project,extra,reference}=fixture();project.lines[0].status='proposed';
 assert.equal(planPriceUpdate(project,[extra],reference,['extra']).project.lines[0].status,'proposed');
 project.lines[0].rate.resourcePricing={ready:false};
 assert.equal(planPriceUpdate(project,[extra],reference,['extra']).project.lines[0].status,'confirmed');
});
