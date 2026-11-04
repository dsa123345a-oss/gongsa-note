import test from 'node:test';import assert from 'node:assert/strict';
import {applyEvidenceBid} from '../dist/evidence-bid.js';
import {calculateAssemblyDetailed} from '../dist/estimate-core.js';
import {amount,totals} from '../dist/calc.js';
import {mappedImport} from '../dist/mapped-import.js';
import {exportEstimate} from '../dist/workbook.js';import {unzip} from '../dist/est.js';
import fs from 'node:fs/promises';import {inflateRawSync} from 'node:zlib';import {importEst} from '../dist/est.js';import {editableAssembly} from '../dist/est-edit.js';import {collectEvidence} from '../dist/project-data.js';
const resource=(name,value,extra={})=>({name,spec:'',unit:'개',source:'시험 DB',code:name,category:'자재',labor:0,material:value,expense:0,other:0,total:value,qty:1,...extra});
const assembly=(name,components)=>({...resource(name,0,{category:'일위대가'}),components,calculation:{},...calculateAssemblyDetailed(components).result});
const line=(id,rate,extra={})=>({id,name:id,spec:'',unit:'개',group:'토공',qty:1,status:'confirmed',bucket:'direct',rate,...extra});
const project=lines=>({schema:1,title:'검증',location:'',lines,charges:[],mappings:{},evidence:[]});
test('같은 근거가 상하위에 중복 사용되어도 한 번 낙찰하고 관급 구성은 보존한다',()=>{
 const child=assembly('하위',[resource('일반',100),resource('관급',200,{government:true})]);
 const parent=assembly('상위',[{...child,qty:2},{kind:'percent',basis:'material',target:'expense',percent:10}]);
 const p=project([line('a',child),line('b',parent)]),copy=structuredClone(p);
 const r=applyEvidenceBid(p,[],['a','b'],80);
 assert.equal(r.changes.length,2);assert.equal(r.project.lines[0].rate.total,280);assert.equal(r.project.lines[1].rate.total,616);
 assert.equal(amount({...r.project.lines[0],bidPercent:80}).total,280); // no double discount, including old/imported line settings
 assert.deepEqual(p,copy);
 const again=applyEvidenceBid(r.project,[],['a','b'],70);assert.equal(again.project.lines[0].rate.total,270);assert.equal(again.project.lines[1].rate.total,594);
 const restored=applyEvidenceBid(again.project,[],['a','b'],100);assert.deepEqual(restored.project.lines.map(l=>l.rate),p.lines.map(l=>l.rate));
});
test('잡비·표시소계와 직접 금액은 근거 낙찰에서 중복 계산하지 않는다',()=>{
 const a=assembly('작업',[resource('자재',100),resource('직접',500,{calculationMode:'horizontal',manualAmounts:{labor:0,material:50,expense:0,other:0}}),{kind:'subtotal',basis:'material',target:'material',startRow:1},{kind:'percent',basis:'material',target:'expense',percent:10}]);
 const result=applyEvidenceBid(project([line('a',a)]),[],['a'],80);assert.equal(result.project.lines[0].rate.total,143);assert.equal(result.changes[0].manual,1);
});
test('미지원 근거는 변경 없이 보류하고 보험료 원금액과 복원을 유지한다',()=>{
 const p=project([line('a',resource('노임',0,{category:'노임',labor:100,total:100})),line('b',resource('복합',200,{category:'단가산출'}))]);
 p.charges=[{key:'health',name:'건강',base:'labor',rate:10}];
 const r=applyEvidenceBid(p,[],['a','b'],80,['health']);assert.equal(r.skipped.length,1);assert.equal(r.project.lines[1].rate.total,200);assert.equal(totals(r.project.lines,r.project.charges).charges[0].amount,10);
 const restored=applyEvidenceBid(r.project,[],['a'],100,['health']);assert.deepEqual(restored.project.charges,p.charges);
});
test('근거 낙찰 표시는 작업 저장 및 엑셀에 남는다',async()=>{
 const p=applyEvidenceBid(project([line('a',resource('단가',100))]),[],['a'],85).project;
 assert.equal(JSON.parse(JSON.stringify(p)).lines[0].rate.evidenceBid.original.total,100);
 const zip=await unzip(exportEstimate(p));const xml=new TextDecoder().decode(await zip.read('xl/worksheets/sheet1.xml'));
 assert.match(xml,/근거 낙찰 85%/);assert.match(xml,/<v>85<\/v>/);
});
const cell=(value,ref,extra={})=>({value,ref,formula:'',cached:true,...extra});
test('열 지정 가져오기는 행 범위·문자 숫자·원본 수식 위치를 보존한다',()=>{
 const sheet={name:'내역',rows:[{index:3,cells:{B:cell('PE관','B3'),D:cell('17','D3'),F:cell('1,234','F3'),G:cell(20978,'G3',{formula:'D3*F3'})}},{index:4,cells:{B:cell('다음','B4'),D:cell(2,'D4'),F:cell(30,'F4')}}]};
 const r=mappedImport(sheet,{name:'B',qty:'D',total:'F',amount:'G'},{mode:'estimate',start:3,end:3,target:'material',file:'내역.xlsx'});
 assert.equal(r.rows.length,1);assert.equal(r.rows[0].qty,17);assert.equal(amount(r.rows[0]).total,20978);assert.equal(r.rows[0].sourceCells.amount.formula,'D3*F3');assert.equal(r.issues.length,0);
});
test('저장 계산값 누락과 금액 불일치는 확정 단가로 숨기지 않는다',()=>{
 const sheet={name:'내역',rows:[{index:1,cells:{A:cell('미계산','A1'),B:cell('','B1',{formula:'1+1',cached:false}),C:cell(100,'C1')}},{index:2,cells:{A:cell('금액차이','A2'),B:cell(2,'B2'),C:cell(100,'C2'),D:cell(999,'D2')}}]};
 const r=mappedImport(sheet,{name:'A',qty:'B',total:'C',amount:'D'},{mode:'estimate'});
 assert.equal(r.rows[0].qty,null);assert.equal(r.rows[0].status,'proposed');assert.equal(r.rows[1].status,'proposed');assert.equal(r.issues.length,2);assert.equal(totals(r.rows,[]).direct,0);
});
test('단가 DB 가져오기는 비목 불일치를 보류하며 중복 열을 거부한다',()=>{
 const sheet={name:'단가',rows:[{index:1,cells:{A:cell('정상','A1'),B:cell(100,'B1'),C:cell(100,'C1')}},{index:2,cells:{A:cell('불일치','A2'),B:cell(100,'B2'),C:cell(300,'C2')}}]};
 const r=mappedImport(sheet,{name:'A',material:'B',total:'C'},{mode:'rate'});assert.equal(r.rates.length,1);assert.equal(r.issues.length,1);
 assert.throws(()=>mappedImport(sheet,{name:'A',qty:'A'}),/중복/);
});
test('실제 아스팔트 절단: 노임 비목 표식 없는 숫자식과 EA 단위를 금액 대조 후 변환',{skip:!process.env.EST_MONTH_PATH},async()=>{
 const lib=await importEst(await fs.readFile(process.env.EST_MONTH_PATH),'10월 메인',inflateRawSync),rate=lib.items.find(r=>r.code==='D0000002300'&&r.category==='단가산출'),rows=lib.details.find(([k])=>k==='CostMainDat:'+rate.code)[1];
 const converted=editableAssembly(rate,rows,lib.items);assert.equal(converted.total,2343);assert.equal(converted.components.length,13);
 const p=project([line('a',rate,{qty:9.4})]);p.evidence=[{rate,rows}];const a=applyEvidenceBid(p,[lib],['a'],80);assert.equal(a.skipped.length,0);assert.equal(amount(a.project.lines[0]).total,17604);
 const b=applyEvidenceBid(a.project,[],['a'],70);assert.equal(b.skipped.length,0);const restored=applyEvidenceBid(b.project,[],['a'],100);assert.equal(amount(restored.project.lines[0]).total,22024);assert.equal(collectEvidence(restored.project,[])[0].rows.length,rows.length);
});
