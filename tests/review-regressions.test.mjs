import test from 'node:test';
import assert from 'node:assert/strict';
import { applyAutoLinks, incompatibleAutoLinks, planAutoLinks, resetIncompatibleAutoLinks } from '../dist/auto-link.js';
import { buildQuantityProject, quantityDuplicates, quantityTitleConflict } from '../dist/quantity-batch.js';
import { buildPrintPages, makePrintDocuments } from '../dist/est-print.js';
import { exportPrintExcel } from '../dist/print-excel.js';
import { unzip } from '../dist/est.js';
import { budgetStatus } from '../dist/workflow-core.js';
import { totals } from '../dist/calc.js';

const project = (lines=[]) => ({schema:1,title:'긴급보수 검증',lines,charges:[],mappings:{}});
const line = (name,spec,extra={}) => ({id:'l',name,spec,unit:'개',qty:2,group:'자재대',bucket:'direct',status:'unmatched',factor:1,rate:null,...extra});
const rate = (name,spec,extra={}) => ({id:'r',code:'M1',name,spec,unit:'개',category:'자재',source:'DB',material:1000,labor:0,expense:0,other:0,total:1000,...extra});

test('다른 부속, 두 관경 불일치, 개와 m 차이는 과거 연결을 재사용하거나 강제로 일괄 적용해도 계산되지 않는다',()=>{
 for(const [source,target] of [
  [line('STS니플','D16'),rate('STS 직관','D13SU',{unit:'M'})],
  [line('STS부싱','D20×16'),rate('STS 정티','20SU')],
  [line('PE 이경티','D50×30'),rate('PE 이경티','65×50')],
  [line('PE 이경티','D50×30'),rate('PE 이경티','30×50')],
  [line('PE 융착 소켓','D20'),rate('PE 소켓','D20',{unit:'m'})],
 ]){
  const current=project([source]),[plan]=planAutoLinks(current,[{id:'db',name:'DB',items:[target]}]);
  assert.equal(plan.recommended,false,source.name);
  assert.equal(totals(applyAutoLinks(current,[{line:source,rate:target}],'batch').lines,[]).missing,1);
  const saved={...source,status:'confirmed',rate:target,autoMatch:{before:source,reviewed:false}};
  assert.equal(incompatibleAutoLinks(project([saved])).length,1);
  assert.equal(resetIncompatibleAutoLinks(project([saved])).lines[0].qty,2);
  assert.equal(incompatibleAutoLinks(project([{...saved,autoMatch:{before:source,reviewed:true}}])).length,0);
 }
});

test('수량산출서 중복은 기존 공구와 새 묶음에서 확인하고 명확히 승인한 경우에만 가져온다',()=>{
 const a={file:'수량산출서(공구)현장 A.xlsx',site:'현장 A',digest:'same-bytes',quantity:{title:'현장 A',rows:[line('자재','')]}};
 const old=buildQuantityProject(project(),[a],{numbered:true});
 const renamed={...a,file:'이름만 변경.xlsx',site:'다른 현장 이름'};
 const duplicate={...a,file:'수량산출서(공구)현장 A_1.xlsx',site:'현장 A_1',digest:'different'};
 assert.equal(quantityDuplicates(old,[renamed],{append:true}).length,1);
 assert.equal(quantityDuplicates(project(),[a,duplicate]).length,1);
 assert.throws(()=>buildQuantityProject(old,[renamed],{append:true,numbered:true,start:2}),/중복/);
 assert.equal(buildQuantityProject(old,[renamed],{append:true,numbered:true,start:2,allowDuplicates:true}).lines.filter(l=>l.level===2).length,2);
 assert.equal(old.lines.find(l=>l.level===2).sourceDigest,'same-bytes');
});

test('파일명과 시트 공사명이 다르면 선택 전 가져오지 않고 선택한 이름을 단일·공구 모드에 모두 적용한다',()=>{
 const file='수량산출서(공구)후포면 삼율1길 35 등 7개소 앵글밸브 교체.xlsx';
 const title='평해읍 월송길 164 등 6개소 앵글밸브 교체';
 const conflict=quantityTitleConflict(title,file);
 assert.match(conflict.fileSite,/후포면.*7개소/);
 assert.equal(conflict.sheetSite,title);
 assert.equal(quantityTitleConflict('현장 A','수량산출서(3공구)현장 A_1.xlsx'),null);
 const entry={file,quantity:{title,rows:[line('앵글밸브 교체','15A')]},titleConflict:conflict,site:''};
 assert.throws(()=>buildQuantityProject(project(),[entry]),/공사명/);
 for(const numbered of [false,true]){
  const next=buildQuantityProject(project(),[{...entry,site:conflict.fileSite}],{numbered});
  assert.match(next.title,/후포면.*7개소/);
  assert.match(next.lines.find(l=>l.level===2).name,/후포면.*7개소/);
 }
});

test('미확정 부분합 안내는 PDF 페이지와 실제 엑셀 제목·인쇄 머리글에 남는다',async()=>{
 const confirmed=line('확정 자재','',{status:'confirmed',rate:rate('확정 자재','')});
 const pending=line('미확정 자재','',{id:'pending'});
 const options={sections:['summary','groups','estimate']};
 const p=project([confirmed,pending]),bundle=makePrintDocuments(p),pages=buildPrintPages(bundle,options);
 assert.equal(bundle.totals.contract,2000);
 assert.equal(bundle.totals.missing,1);
 for(const page of pages) assert.ok(page.ops.some(o=>o.text?.includes('검토용 · 미확정 1건 제외 부분합')),page.title);
 const zip=await unzip(exportPrintExcel(p,[],options));
 const decode=new TextDecoder();
 for(let i=1;i<=3;i++){
  const xml=decode.decode(await zip.read('xl/worksheets/sheet'+i+'.xml'));
  assert.match(xml,/검토용 · 미확정 1건 제외 부분합/);
 }
 const completed=buildPrintPages(makePrintDocuments(project([confirmed])),options);
 assert.ok(completed.every(page=>!page.ops.some(op=>op.text?.includes('검토용'))));
});

test('새 긴급보수 기본 한도는 500만원 미만이고 직접 저장한 기존 한도는 유지한다',()=>{
 const p=project(),site={file:'현장.xlsx',quantity:{title:'급수관 보수',rows:[line('자재','')]}};
 const imported=buildQuantityProject(p,[site],{numbered:true});
 assert.equal(imported.contractLimit,5000000);
 assert.equal(budgetStatus(p,{contract:4999999,missing:0}).exceeded,false);
 assert.equal(budgetStatus(p,{contract:5000000,missing:0}).exceeded,true);
 assert.equal(budgetStatus({...p,contractLimit:8000000},{contract:5000000,missing:0}).limit,8000000);
});
