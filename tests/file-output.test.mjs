import test from 'node:test';
import assert from 'node:assert/strict';
import {exportSelectedExcel,selectedWorkbookSheets} from '../dist/excel-selection.js';
import {createOutputPreferences} from '../dist/output-preferences.js';
import {createCloseController} from '../dist/session-lifecycle.js';
import {unzip} from '../dist/est.js';
import {defaultCharges} from '../dist/calc.js';
const project={schema:1,title:'검증 공사',lines:[{id:'a',name:'터파기',group:'토공',spec:'',unit:'m3',qty:2,factor:1,bucket:'direct',status:'confirmed',rate:{labor:1000,material:200,expense:30,other:0,total:1230}}],charges:defaultCharges()};
test('선택한 엑셀 시트만 출력하고 제외한 시트 참조는 계산값으로 보존한다',async()=>{
 for(const mode of ['design','contractor'])for(const sections of [['summary'],['estimate'],['summary','groups','estimate'],['units','machines','materials','labor']]){
  const zip=await unzip(exportSelectedExcel(project,[],{mode,sections}));const dec=new TextDecoder(),book=dec.decode(await zip.read('xl/workbook.xml'));
  assert.equal((book.match(/<sheet name=/g)||[]).length,sections.length);
  const names=[...book.matchAll(/<sheet name="([^"]+)"/g)].map(m=>m[1]);
  for(let i=1;i<=sections.length;i++){
   const xml=dec.decode(await zip.read(`xl/worksheets/sheet${i}.xml`));
   assert.doesNotMatch(xml,/#REF!|<mergeCells count="0"/);
   for(const m of xml.matchAll(/&apos;([^<]*?)&apos;!/g))assert.ok(names.includes(m[1]),m[1]);
  }
 }
 assert.throws(()=>exportSelectedExcel(project,[],{sections:[]}),/하나 이상/);
});
test('시트 제외는 원본을 바꾸지 않고 남아 있는 시트 간 수식은 유지한다',()=>{
 const a={name:'A',rows:[{values:[{formula:"'B'!A1+2",value:7},{formula:"'C'!A1",value:9}],styles:[0,0]}]},b={name:'B',rows:[]},c={name:'C',rows:[]};
 const result=selectedWorkbookSheets([a,b,c],[a,b]);assert.equal(result[0].rows[0].values[0].formula,"'B'!A1+2");assert.equal(result[0].rows[0].values[1],9);assert.equal(a.rows[0].values[1].formula,"'C'!A1");
});
test('출력 선택은 공사와 독립적으로 저장되며 연속 변경과 재실행을 보존한다',async()=>{
 const data=new Map(),storage={get:async k=>structuredClone(data.get(k)),put:async(k,v)=>data.set(k,structuredClone(v))};
 const prefs=createOutputPreferences(storage);await Promise.all([prefs.set('excel',{sections:['summary']}),prefs.set('print',{sections:['estimate']}),prefs.set('excel',{sections:['groups','estimate']})]);
 const reload=createOutputPreferences(storage);assert.deepEqual(await reload.get('excel'),{sections:['groups','estimate']});assert.deepEqual(await reload.get('print'),{sections:['estimate']});
});
test('저장 파일 선택을 취소하면 종료와 초안 삭제를 중단한다',async()=>{
 let cleared=false;const close=createCloseController({beforePrompt:async()=>{},getProject:()=>project,newState:()=>({lines:[],charges:[]}),ask:async()=>'save',save:async()=>({cancelled:true}),clearDraft:async()=>cleared=true,onError:()=>{}});
 assert.equal((await close()).cancelled,true);assert.equal(cleared,false);
});

 test('전체 미리보기는 마지막 인쇄 선택을 바꾸지 않는다',async()=>{
 const {allPreviewSettings}=await import('../dist/est-print-preview.js');
 const saved={sections:['summary'],startPage:3,documents:{}};
 const all=allPreviewSettings(saved,{documents:[{key:'summary',rows:[1]},{key:'estimate',rows:[1]},{key:'units',rows:[]}]});
 assert.deepEqual(all.sections,['summary','estimate']);assert.deepEqual(saved.sections,['summary']);assert.equal(all.startPage,3);
 });
