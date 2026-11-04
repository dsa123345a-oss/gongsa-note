import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {inflateRawSync} from 'node:zlib';
import {importEst} from '../dist/est.js';
import {attachMachineBasis} from '../dist/est-edit.js';
import {createResourcePricer} from '../dist/resource-pricing.js';
import {estResourcePolicy} from '../dist/est-resource-policy.js';
import {calculateAssemblyDetailed} from '../dist/estimate-core.js';
import {collectPriceEvidence} from '../dist/price-evidence.js';

function fixture(){
 const ref={name:'시험 관',spec:'D100',unit:'본',code:'M1',table:'StuffcDat',category:'자재',source:'2026-10-main.estx',library:'m',labor:0,material:500,expense:0,other:0,total:500};
 const part={...ref,material:0,total:0,qty:2,qtyExpression:'2',originalRecord:10,rowBigo:'별산'};
 const row={_record:10,Code:'M1',Name:ref.name,Size:ref.spec,Unite:ref.unit,GN:2,NU:0,GU:0,JU:0,TC:0,LinkIndex:0,Bigo:'별산'};
 const rate={name:'설치',spec:'D100',unit:'본',code:'U1',table:'HeadTitleDat',category:'일위대가',source:'2026-10-main.estx',library:'m',components:[part],calculation:{componentDigits:1},labor:0,material:0,expense:0,other:0,total:0};
 const lib={id:'m',name:'2026-10-main.estx',priceUpdateReference:true,items:[ref,rate],details:[['HeadMainDat:U1',[row]]]};
 return {ref,part,row,rate,lib,libs:[lib]};
}

test('별산 0원 자재는 기준 DB에 가격이 있어도 산입하지 않고 출력 사용 자재에서도 제외한다',()=>{
 const {libs,rate}=fixture();rate.components[0].calculationMode='auto';const before=JSON.stringify({libs,rate}),result=createResourcePricer({},libs).reprice(rate);
 assert.equal(result.ready,true);assert.equal(result.rate.material,0);assert.equal(result.rate.components[0].qtyExpression,'2');assert.equal(result.rate.components[0].rowBigo,'별산');
 assert.ok(result.warnings.some(w=>w.kind==='separate-resource'&&w.retained));
 const project={lines:[{id:'l',name:rate.name,qty:1,status:'confirmed',rate:result.rate}]},evidence=collectPriceEvidence(project,libs);
 assert.equal(evidence.nodes.filter(n=>n.kind==='자재').length,0);assert.equal(JSON.stringify({libs,rate}),before);
});

test('이전 자동 갱신으로 별산 자재비를 더한 저장 단가는 확인된 적용 스냅샷일 때만 복원한다',()=>{
 const {libs,rate,part,ref}=fixture();Object.assign(part,{material:500,total:500,priceReference:structuredClone(ref)});Object.assign(rate,calculateAssemblyDetailed(rate.components,rate.calculation).result);
 const result=createResourcePricer({},libs).reprice(JSON.parse(JSON.stringify(rate)));
 assert.equal(result.ready,true);assert.equal(result.rate.total,0);assert.equal(result.rate.components[0].priceReference,undefined);assert.match(result.warnings[0].reason,/복원/);
 const again=createResourcePricer({},libs).reprice(result.rate);assert.equal(again.ready,true);assert.equal(again.rate.total,0);
});

test('별산 원본과 다른 직접 수정 금액은 임의로 지우지 않고 확인 대상으로 남긴다',()=>{
 for(const snapshot of [false,true]){
  const {libs,rate,part,ref}=fixture();Object.assign(part,{material:550,total:550,...(snapshot?{priceReference:structuredClone(ref)}:{})});Object.assign(rate,calculateAssemblyDetailed(rate.components,rate.calculation).result);
  const result=createResourcePricer({},libs).reprice(rate);
  assert.equal(result.ready,false);assert.equal(result.rate.material,1100);assert.equal(result.rate.components[0].material,550);assert.equal(result.warnings[0].retained,false);
 }
});

test('별도 문구가 있어도 원본에 유상 자재비가 있거나 원본행이 바뀌면 제외하지 않는다',()=>{
 for(const modify of [f=>f.row.GU=500,f=>f.row.LinkIndex=5,f=>f.part.originalRecord=99,f=>f.row.Code='M2']){
  const f=fixture();modify(f);assert.equal(estResourcePolicy(f.part,[f.row],f.rate),null);
 }
 const f=fixture();f.row.Bigo='';f.row.Size=f.part.spec='운반비별도';f.row.GU=f.part.material=500;assert.equal(estResourcePolicy(f.part,[f.row],f.rate),null);
 f.row.GU=f.part.material=0;assert.equal(estResourcePolicy(f.part,[f.row],f.rate),null);
});

test('코드 없는 원본 고정 설치비는 확인받은 클램프에만 적용한다',()=>{
 const {part,row,rate}=fixture();Object.assign(part,{code:'',name:'설치비',spec:'',unit:'개소',labor:10760,material:0,total:10760});Object.assign(row,{Code:'',Name:'설치비',Size:'',Unite:'개소',NU:10760,Bigo:'',TC:10760});rate.name='누수보수용 클램프 설치';
 assert.equal(estResourcePolicy(part,[row],rate).kind,'fixed-installation');
 assert.equal(estResourcePolicy(part,[row],{...rate,name:'다른 설치'}),null);
 part.labor=15000;assert.equal(estResourcePolicy(part,[row],rate),null);
});

test('실제 별산 자재·0원 품셈 주석·모르타르 별도계상과 클램프 4종을 원본대로 처리한다',async()=>{
 const libs=[];for(const [name,role] of [['2026-10-main.estx','resource'],['상수도공사메인(26년)소형감압변 수정.ebkx','assembly']]){
  const lib=attachMachineBasis(await importEst(await fs.readFile(new URL('../seed/'+name,import.meta.url)),name,inflateRawSync));lib.bundledDefault=role;if(role==='resource')lib.priceUpdateReference=true;libs.push(lib);
 }
 const pricer=createResourcePricer({},libs),pick=(lib,code)=>lib.items.find(r=>r.code===code&&r.table==='HeadTitleDat');
 const flume=pick(libs[0],'U0000001662'),result=pricer.reprice(flume);
 assert.equal(result.ready,true);assert.equal(result.rate.total,flume.total);assert.equal(result.rate.total,17937);
 assert.equal(result.rate.components.find(p=>p.rowBigo==='별산').material,0);
 const note=pricer.reprice(pick(libs[0],'U0000000593'));
 assert.equal(note.ready,true);assert.ok(!note.issues.some(i=>i.resource?.name?.startsWith('※')));
 const mortarRows=libs[0].details.filter(([key,rows])=>key.startsWith('HeadMainDat:')&&rows.some(r=>r.Code==='U0000004292'||r.Code==='U0000004551'));
 assert.equal(mortarRows.length,24);assert.equal(mortarRows.flatMap(([,rows])=>rows.filter(r=>r.Code==='U0000004292'||r.Code==='U0000004551')).length,30);
 for(const [key] of mortarRows){const rate=pick(libs[0],key.split(':')[1]),out=pricer.reprice(rate);assert.equal(out.ready,true,rate.name);assert.equal(out.rate.total,rate.total,rate.name);}
 for(const [code,price] of [['U0000000361',10760],['U0000000362',12920],['U0000000363',15070],['U0000000364',12920]]){
  const rate=pick(libs[1],code),out=pricer.reprice(rate);assert.equal(out.ready,true,code);assert.equal(out.rate.labor,price);assert.equal(out.rate.total,price);
  assert.ok(out.warnings.some(w=>w.kind==='fixed-installation'&&w.retained));assert.equal(out.changes.length,0);assert.equal(out.rate.components[0].priceReference,undefined);
 }
});
