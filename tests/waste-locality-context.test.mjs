import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {inflateRawSync} from 'node:zlib';
import {importEst} from '../dist/est.js';
import {attachMachineBasis} from '../dist/est-edit.js';
import {transportRoute,specNorm,compatibleWork,wasteMatchIssue} from '../dist/match-similarity.js';
import {planAutoLinks,applyAutoLinks,incompatibleAutoLinks,resetIncompatibleAutoLinks,lineSignature} from '../dist/auto-link.js';

const places=[['북면','북면'],['죽변면','죽변'],['울진읍','울진'],['근남면','근남'],['매화면','매화'],['기성면','기성'],['평해읍','평해'],['온정면','온정'],['후포면','후포']];
const line=(id='line',extra={})=>({id,name:'폐기물처리',spec:'콘크리트',unit:'톤',group:'폐기물처리비',qty:2.5,status:'unmatched',bucket:'waste',...extra});
const rate=(place,material='콘크리트')=>({name:'폐기물처리',spec:`${material}(${place}⇔울진)`,unit:'TON',code:material+place,category:'자재',table:'StuffcDat',source:'추가',library:'extra',labor:0,material:42000,expense:0,other:0,total:42000});
const generic={...rate('후포'),code:'generic',name:'폐기물처리비',spec:'폐콘크리트'};
const libs=()=>[{id:'extra',name:'추가',items:[generic,...places.flatMap(([,place])=>[rate(place),rate(place,'아스콘')])]}];
const plan=(project,libraries=libs())=>planAutoLinks(project,libraries,'','extra',{rules:[]});

test('지정한 읍·면 별칭은 양방향으로 일치하고 북 단독은 북면으로 바꾸지 않는다',()=>{
 for(const [full,short] of places)for(const material of ['콘크리트','아스콘']){
  assert.equal(specNorm(`${material}(${full}⇔울진읍)`),specNorm(`${material}(${short}⇔울진)`));
  assert.deepEqual(transportRoute(`${full} ↔ 울진읍`),[short,'울진']);
  for(const [a,b] of [[full,short],[short,full]])assert.equal(compatibleWork(line('x',{spec:`${material}(${a}⇔울진)`}),rate(b,material)),true);
  for(const [,other] of places)if(other!==short)assert.equal(compatibleWork(line('x',{spec:`${material}(${full}⇔울진)`}),rate(other,material)),false);
 }
 assert.notEqual(specNorm('북'),specNorm('북면'));assert.deepEqual(transportRoute('북면⇔울진'),['북면','울진']);
 for(const spec of ['콘크리트(북)','콘크리트(북⇔울진)'])assert.equal(plan({lines:[line('x',{spec})]})[0].rate,undefined);
 for(const sourceFile of ['북쪽 신규급수.xlsx','북 공구.xlsx','울진군 통합.xlsx'])assert.equal(plan({lines:[line('x',{sourceFile})]})[0].rate,undefined);
});

test('품명·규격·행 주소·파일명에서 각 지역의 축약명과 전체 이름을 확인한다',()=>{
 for(const [full,short] of places)for(const alias of new Set([full,short])){
  const variants=[{name:alias+' 폐기물처리'},{spec:`콘크리트(${alias})`},{location:`${alias} 검증길 1`},{sourceFile:`수량산출서(1공구)${alias} 신규급수.xlsx`},{group:alias+' 폐기물처리비'}];
  for(const fields of variants){const result=plan({lines:[line('x',fields)]})[0];assert.equal(result.rate?.code,'콘크리트'+short,JSON.stringify(fields));assert.equal(result.recommended,true);}
 }
 assert.equal(plan({lines:[line('x',{location:'경상북도 울진군 죽변면 검증길'})]})[0].rate.code,'콘크리트죽변');
 assert.equal(plan({lines:[line('x',{sourceFile:'C:/후포면/수량산출서 북면.xlsx'})]})[0].rate.code,'콘크리트북면');
});

test('같은 규격과 파일명을 쓰는 다공구도 각 공구명으로 선택하고 캐시가 섞이지 않는다',()=>{
 const p={title:'상수도긴급보수공사(후포면 첫 현장 등)',location:'후포면',lines:[
  {id:'h1',level:2,name:'1공구 후포면 첫 현장',sourceFile:'통합.xlsx'},line('a',{sourceFile:'통합.xlsx'}),
  {id:'h2',level:2,name:'상수도긴급보수공사(후포면 첫 현장 등)(2공구 북면 둘째 현장)',sourceFile:'통합.xlsx'},line('b',{sourceFile:'통합.xlsx'}),
  {id:'h3',level:2,name:'3공구 현장 미입력',sourceFile:'통합.xlsx'},line('c',{sourceFile:'통합.xlsx'})
 ]},before=JSON.stringify(p),rows=plan(p);
 assert.deepEqual(rows.map(r=>r.rate?.code),['콘크리트후포','콘크리트북면',undefined]);assert.equal(rows[2].recommended,false);assert.match(rows[2].reason,/지역 미확정/);
 const applied=applyAutoLinks(p,rows,'batch');assert.deepEqual(applied.lines.filter(l=>!l.level).map(l=>l.rate?.code),['콘크리트후포','콘크리트북면',undefined]);
 assert.equal(applied.lines[1].qty,2.5);assert.equal(applied.lines[1].autoMatch.before.wasteContext,undefined);assert.equal(JSON.stringify(p),before);
});

test('단일 공사 제목·주소는 사용할 수 있지만 여러 파일의 첫 공사 주소를 공유하지 않는다',()=>{
 for(const fields of [{title:'죽변면 신규급수공사'},{location:'죽변 검증길'}])assert.equal(plan({...fields,lines:[line()]})[0].rate.code,'콘크리트죽변');
 const multi={title:'후포면 신규급수',location:'후포면',quantityFile:'후포면.xlsx · 북면.xlsx',lines:[line('a',{sourceFile:'후포면.xlsx'}),line('b',{sourceFile:'지역 미입력.xlsx'})]};
 assert.deepEqual(plan(multi).map(r=>r.rate?.code),['콘크리트후포',undefined]);
 const separate={title:'후포면 첫 공사',lines:[{id:'h1',level:2,name:'1공구 후포면'},line('a'),{id:'h2',level:2,name:'2공구',spec:'평해읍 둘째 현장'},line('b')]};
 assert.deepEqual(plan(separate).map(r=>r.rate?.code),['콘크리트후포','콘크리트평해']);
});

test('명시 운반구간은 우선하고 지역이 충돌하거나 후보에 없으면 임의 선택하지 않는다',()=>{
 assert.equal(plan({title:'후포면',lines:[line('x',{spec:'콘크리트(근남면⇔울진읍)',sourceFile:'후포면.xlsx'})]})[0].rate.code,'콘크리트근남');
 for(const fields of [{spec:'콘크리트(후포면, 북면)'},{sourceFile:'후포면 북면.xlsx'},{location:'후포면',sourceFile:'북면.xlsx'}]){
  const r=plan({lines:[line('x',fields)]})[0];assert.equal(r.rate,undefined);assert.match(r.reason,/여러 곳/);
 }
 const absent=[{id:'extra',name:'추가',items:[generic,rate('북면')]}];
 assert.equal(plan({lines:[line('x',{location:'온정면'})]},absent)[0].rate,undefined);
 assert.equal(plan({lines:[line('x',{location:'미등록 지역'})]})[0].rate,undefined);
 assert.equal(compatibleWork(line('x',{location:'후포면'}),generic),false);
});

test('학습·저장 연결·지정 DB 정보도 다른 지역이나 지역 없는 처리비로 우회하지 않는다',()=>{
 const l=line('x'),wrong=rate('북면'),p={title:'후포면 신규급수',lines:[l],mappings:{[lineSignature(l)]:wrong}},profile={rules:[{kind:'new',source:l,target:wrong,support:10,total:10,projectCount:10}]};
 assert.equal(planAutoLinks(p,libs(),'','extra',profile)[0].rate.code,'콘크리트후포');
 assert.equal(applyAutoLinks(p,[{line:l,rate:wrong}],'stale').lines[0].rate,undefined);
 const target={source:generic.source,code:generic.code,name:generic.name,spec:generic.spec,unit:generic.unit},referenced=line('ref',{name:generic.name,spec:generic.spec,unit:generic.unit,dbReference:{state:'linked',expected:target,target}});
 const result=plan({title:'후포면 신규급수',lines:[referenced]})[0];assert.equal(result.rate,undefined);assert.match(result.reason,/운반 구간 확인/);
});

test('과거 북면 오연결은 공구 문맥으로 찾고 올바른 연결과 수량은 유지한다',()=>{
 const before=line('bad'),wrong=rate('북면'),good=rate('후포'),p={title:'긴급보수',lines:[{id:'h',level:2,name:'1공구 후포면'},
  {...before,name:wrong.name,spec:wrong.spec,rate:wrong,status:'confirmed',autoMatch:{before,reviewed:false}},
  {...line('good'),name:good.name,spec:good.spec,rate:good,status:'confirmed',autoMatch:{before:line('good'),reviewed:false}}
 ]};
 assert.deepEqual(incompatibleAutoLinks(p).map(l=>l.id),['bad']);const fixed=resetIncompatibleAutoLinks(p);
 assert.equal(fixed.lines[1].rate,null);assert.equal(fixed.lines[1].qty,2.5);assert.equal(fixed.lines[1].spec,'콘크리트');assert.match(fixed.lines[1].autoRepair.reason,/지역이 다름/);
 assert.deepEqual(fixed.lines[2],p.lines[2]);
});

test('실제 기본 DB의 9개 지역 아스콘·콘크리트는 별칭별로 같은 지역 품목에 연결한다',async()=>{
 const actual=[];
 for(const [name,role] of [['2026-10-main.estx','resource'],['상수도공사메인(26년)소형감압변 수정.ebkx','assembly']]){
  const lib=attachMachineBasis(await importEst(await fs.readFile(new URL('../seed/'+name,import.meta.url)),name,inflateRawSync));
  lib.bundledDefault=role;if(role==='resource')lib.priceUpdateReference=true;actual.push(lib);
 }
 const codes={북면:[272,282],죽변:[274,284],울진:[273,283],근남:[278,288],매화:[279,289],기성:[277,287],평해:[275,285],온정:[256,281],후포:[276,286]},rows=[],expected=[];
 for(const [full,short] of places)for(const alias of new Set([full,short]))for(const [i,material] of ['아스콘','콘크리트'].entries()){
  rows.push(line('row'+rows.length,{spec:material,sourceFile:`수량산출서 ${alias} 급수공사.xlsx`}));expected.push('U'+String(codes[short][i]).padStart(10,'0'));
 }
 const planned=planAutoLinks({title:'통합 공사',lines:rows},actual,actual[1].id,actual[1].id,{rules:[]});
 assert.deepEqual(planned.map(p=>p.rate?.code),expected);assert.ok(planned.every(p=>p.recommended));
 for(const p of planned){assert.equal(wasteMatchIssue(p.line),'');assert.equal(compatibleWork(p.line,p.rate),true);assert.ok(p.rate.total>0);}
});
