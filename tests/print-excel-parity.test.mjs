import test from 'node:test';
import assert from 'node:assert/strict';
import {printExcelSheets,vectorPrintExcelSheets,exportPrintExcel} from '../dist/print-excel.js';
import {defaultCharges} from '../dist/calc.js';

const fixture=()=>{
 const rate={name:'단가산출 머리글과 줄바꿈 글자 크기 확인용 긴 공종명 '.repeat(3),spec:'시험',unit:'㎥',code:'D1',category:'단가산출',source:'시험 DB',labor:100,material:20,expense:5,other:0,total:125};
 return {schema:1,title:'미리보기 엑셀 일치 검증',lines:[{id:'l',name:rate.name,qty:1,bucket:'direct',status:'confirmed',rate}],charges:defaultCharges(),evidence:[{rate,rows:[{TitleCode:'D1',NC:100,GC:20,JC:5,TC:125},{LineData:'1. 시공 조건',_record:1}]}]};
};
const styleFont=(xml,id)=>{
 const xfs=xml.match(/<cellXfs[^>]*>(.*?)<\/cellXfs>/s)[1].match(/<xf\b[^>]*?(?:\/>|>[\s\S]*?<\/xf>)/g);
 const fonts=xml.match(/<fonts[^>]*>(.*?)<\/fonts>/s)[1].match(/<font>.*?<\/font>/gs);
 return Number(fonts[Number(xfs[id].match(/fontId="(\d+)"/)[1])].match(/<sz val="([^"]+)"/)[1]);
};

for(const size of [10.5,14])test(`단가산출의 줄바꿈 머리글과 본문은 미리보기 글자 크기 ${size}pt를 엑셀에도 보존한다`,()=>{
 const project=fixture(),before=JSON.stringify(project),out=printExcelSheets(project,[],{sections:['formulas'],printSettings:{documents:{formulas:{size}}}});
 const sheet=out.sheets[0],page=out.pages[0];
 for(const source of page.grid.rows.filter(r=>r.header||r.itemStart)){
  const row=sheet.rows.find(r=>r.values[0]===source.cells[0].lines.join('\n'));
  assert.ok(row,'미리보기와 같은 내용의 엑셀 행');
  let column=0;
  for(const c of source.cells){
   assert.equal(styleFont(out.styles,row.styles[column]),c.fontSize||(source.header?size+1:size));
   column+=c.span||1;
  }
 }
 assert.ok(page.grid.rows.find(r=>r.header).cells.some(c=>c.lines.length>1),'두 줄 머리글 사례');
 assert.ok(page.grid.rows.find(r=>r.itemStart).cells[0].lines.length>1,'여러 줄 공종명 사례');
 assert.equal(JSON.stringify(project),before);
});

test('사용한 항목이 없는 증빙 양식은 미리보기처럼 엑셀에서도 생략하고 쪽 번호를 이어간다',()=>{
 const out=printExcelSheets(fixture(),[],{sections:['unitSummary','units','formulaSummary','formulas','labor'],printSettings:{startPage:7}});
 assert.deepEqual(out.sheets.map(s=>s.name),['단가산출총괄표','단가산출']);
 assert.equal(out.sheets.reduce((n,s)=>n+s.pages.length,0),out.pages.length);
 assert.equal(out.sheets[0].print.firstPageNumber,7);
 assert.equal(out.sheets[0].print.flags&128,128);
 assert.equal(out.sheets[1].print.flags&128,0);
 assert.equal(out.sheets[1].pages[0].number,out.sheets[0].pages.at(-1).number+1);
});

test('선택한 증빙이 모두 비어 있으면 빈 엑셀을 생성하지 않고 명확한 오류를 반환한다',()=>{
 for(const build of [vectorPrintExcelSheets,printExcelSheets,exportPrintExcel]){
  assert.throws(()=>build(fixture(),[],{sections:['unitSummary','units','labor']}),/출력할 항목이 없습니다/);
  assert.throws(()=>build(fixture(),[],{sections:[]}),/하나 이상 선택/);
 }
});
