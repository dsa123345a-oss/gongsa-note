import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {inflateRawSync} from 'node:zlib';
import {createResourcePricer,resourcePricingMessage} from '../dist/resource-pricing.js';
import {calculateAssemblyDetailed} from '../dist/estimate-core.js';
import {importEst} from '../dist/est.js';
import {attachMachineBasis} from '../dist/est-edit.js';
import {makePrintDocuments} from '../dist/est-print.js';

function fixture(){
 const source={name:'보통인부',code:'L1',spec:'',unit:'인',category:'노임',table:'LaborcDat',source:'추가',library:'extra',labor:100,material:0,expense:0,other:0,total:100};
 const part={...source,name:'보 통 인 부',spec:'설치및철거',qty:0.04,qtyExpression:'0.04',originalRecord:12};
 const components=[part],calculation={componentDigits:1};
 const rate={name:'철판 설치',code:'U1',spec:'1.2×2.4',unit:'개소',category:'일위대가',table:'HeadTitleDat',source:'추가',library:'extra',components,calculation,...calculateAssemblyDetailed(components,calculation).result};
 const row={_record:12,Code:'L1',Name:'보 통 인 부',Size:'설치및철거',Unite:'인',GN:0.04,NU:100,LinkIndex:6};
 const month={id:'month',name:'2026-10-main.estx',priceUpdateReference:true,items:[{...source,code:'L999',source:'2026-10-main.estx',library:'month',labor:120,total:120}]};
 const extra={id:'extra',name:'추가',bundledDefault:'assembly',items:[source,rate],details:[['HeadMainDat:U1',[row]]]};
 return {source,part,rate,row,month,extra,libs:[month,extra]};
}

test('확인 안내는 유지 가능한 자재가 아닌 실제 계산 차단 원인을 먼저 표시한다',()=>{
 const rate={resourcePricing:{ready:false,warnings:[{resource:{name:'철판'},reason:'기존 자재 유지',retained:true},{resource:{name:'보통인부'},reason:'직종 미확정',retained:false}]}};
 const message=resourcePricingMessage(rate);assert.match(message,/보통인부.*직종 미확정/);assert.doesNotMatch(message,/철판/);
 const formula=resourcePricingMessage({resourcePricing:{ready:false,issues:[{kind:'calculation',reason:'산식 검증 불가'}]}});assert.match(formula,/산식 검증 불가/);
});

test('원본 코드가 검증된 노임 작업 설명은 보존하고 다른 코드의 월별 직종으로 연결한다',()=>{
 const {libs,rate}=fixture(),before=JSON.stringify({libs,rate});
 const result=createResourcePricer({},libs).reprice(rate),p=result.rate.components[0];
 assert.equal(result.ready,true);assert.equal(result.issues.length,0);assert.equal(p.labor,120);
 assert.equal(p.name,'보 통 인 부');assert.equal(p.spec,'설치및철거');assert.equal(p.qtyExpression,'0.04');
 assert.equal(p.priceReference.code,'L999');assert.equal(p.priceReference.spec,'');assert.equal(p.priceReference.source,'2026-10-main.estx');
 assert.equal(JSON.stringify({libs,rate}),before);
 const again=createResourcePricer({},libs).reprice(result.rate);
 assert.equal(again.ready,true);assert.deepEqual(again.rate.components,result.rate.components);assert.equal(again.rate.total,result.rate.total);
});

test('작업 설명이 같아도 원본 구성행을 검증할 수 없으면 임의로 노임 규격을 무시하지 않는다',()=>{
 for(const alter of [
  f=>delete f.part.originalRecord,
  f=>f.part.originalRecord=99,
  f=>f.part.spec='다른 직종 규격',
  f=>f.row.Code='L2',
  f=>f.row.Name='다른 직종',
  f=>f.row.Unite='hr',
  f=>f.row.TitleCode='U1',
  f=>f.extra.details[0][1].push({...f.row}),
  f=>f.extra.items.push({...f.source}),
  f=>f.source.spec='별도 등급',
  f=>f.source.name='특별인부',
  f=>f.source.unit='hr',
 ]){
  const f=fixture();alter(f);
  const result=createResourcePricer({},f.libs,{keepMissing:true}).reprice(f.rate);
  assert.equal(result.ready,false,alter.toString());assert.ok(result.warnings.some(w=>w.resource?.category==='노임'&&!w.retained));
 }
});

test('작업 설명 복원 후에도 월별 노임 후보가 둘이면 추가 DB로 우회하지 않는다',()=>{
 const {libs,month,rate}=fixture();month.items.push({...month.items[0],code:'L998',labor:130,total:130});
 const result=createResourcePricer({},libs).reprice(rate);
 assert.equal(result.ready,false);assert.ok(result.issues.every(i=>i.kind!=='fallback-reference'));
});

test('검증된 작업 설명의 직종이 월별에 실제 없을 때만 추가 DB 노임을 적용한다',()=>{
 const {libs,month,rate}=fixture();month.items=[];
 const result=createResourcePricer({},libs).reprice(rate);
 assert.equal(result.ready,true);assert.equal(result.rate.components[0].labor,100);
 assert.equal(result.rate.components[0].spec,'설치및철거');assert.equal(result.rate.components[0].priceReference.source,'추가');
 assert.equal(result.warnings.find(i=>i.kind==='fallback-reference').retained,true);
});

test('동일 코드 자재의 다른 규격은 작업 설명으로 취급하지 않는다',()=>{
 const {libs,rate,source,part,month}=fixture();
 for(const r of [source,part,month.items[0]])Object.assign(r,{category:'자재',table:'StuffcDat',labor:0,material:r.total});
 const result=createResourcePricer({},libs,{keepMissing:false}).reprice(rate);
 assert.equal(result.ready,false);assert.equal(result.rate.components[0].material,100);
});

test('실제 임시통행철판은 10월 보통인부와 기존 철판을 적용하고 노임표에도 적용한 노임만 출력한다',async()=>{
 const libs=[];
 for(const [name,role] of [['2026-10-main.estx','resource'],['상수도공사메인(26년)소형감압변 수정.ebkx','assembly']]){
  const lib=attachMachineBasis(await importEst(await fs.readFile(new URL('../seed/'+name,import.meta.url)),name,inflateRawSync));
  lib.bundledDefault=role;if(role==='resource')lib.priceUpdateReference=true;libs.push(lib);
 }
 const original=libs[1].items.find(r=>r.code==='U0000000354'&&r.table==='HeadTitleDat'),before=JSON.stringify(original);
 const pricer=createResourcePricer({},libs),result=pricer.reprice(original),p=result.rate.components.find(p=>p.code==='L0000000001');
 assert.equal(result.ready,true);assert.equal(result.rate.total,57703);assert.equal(result.rate.labor,6907);assert.equal(result.rate.material,50796);
 assert.equal(p.labor,172698);assert.equal(p.spec,'설치및철거');assert.equal(p.qty,0.04);assert.equal(p.priceReference.spec,'');
 assert.equal(result.warnings.length,1);assert.equal(result.warnings[0].resource.name.replace(/\s/g,''),'철판');assert.equal(result.warnings[0].resource.material,1704);assert.equal(result.warnings[0].retained,true);
 assert.equal(JSON.stringify(original),before);assert.equal(original.total,57588);
 const saved=JSON.parse(JSON.stringify(result.rate)),again=pricer.reprice(saved);
 assert.equal(again.ready,true);assert.equal(again.rate.total,57703);assert.equal(again.rate.components.find(p=>p.code==='L0000000001').priceReference.code,'L0000001239');
 const project={schema:1,title:'철판 설치 검증',lines:[{id:'line',name:original.name,spec:original.spec,unit:original.unit,qty:1,level:0,group:'부대공',bucket:'direct',status:'confirmed',rate:saved}],charges:[],mappings:{}};
 const bundle=makePrintDocuments(project,libs),labor=bundle.documents.find(d=>d.key==='labor');
 assert.equal(labor.rows.length,1);assert.equal(labor.rows[0].cells[1].value,'보통인부');assert.equal(labor.rows[0].cells[4].value,'172,698');
 assert.match(labor.rows[0].cells[5].value,/2026년 10월 기준 노임/);
});
