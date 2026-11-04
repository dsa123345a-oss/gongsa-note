import test from 'node:test';
import assert from 'node:assert/strict';
import {printExcelSheets,vectorPrintExcelSheets,exportPrintExcel} from '../dist/print-excel.js';
import {defaultCharges} from '../dist/calc.js';
import {nativeCellStyles} from '../dist/native-print-layout.js';
import {measurePrintText} from '../dist/print-typography.js';

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

test('긴 한글 품명·규격·공사명과 금액은 동일 pt로 맞추고 엑셀 재축소 없이 페이지를 보존한다',()=>{
 const title='2026년 상수도 긴급 보수공사 및 급수관 교체 구간 '.repeat(6),name='수도용 내충격성 경질 폴리염화비닐 급수관 연결 부속',spec='D=25㎜, 45° 엘보 × 2개, 압력 1.0MPa, 현장 설치 포함',remark='원본 비고: 운반비 포함, 접합부 상세도 및 설치 근거 참조';
 const project={schema:1,title,charges:defaultCharges(),lines:[{id:'section',level:2,name:'구간별 공사명 '.repeat(12),sectionLabel:'1공구',bucket:'direct'},...Array.from({length:46},(_,i)=>({id:'material-'+i,name:name+' '+i,spec,unit:'개',qty:2.5,bucket:'direct',status:'confirmed',rate:{code:'M'+i,category:'자재',source:'검증 DB',name:name+' '+i,spec,unit:'개',remark,labor:0,material:123456789.25,expense:0,other:0,total:123456789.25,prices:[123456789.25],quotePages:['p.123']}}))]};
 const before=JSON.stringify(project),out=printExcelSheets(project,[],{sections:['estimate','materials'],printSettings:{startPage:11}}),formats=nativeCellStyles(out.styles);
 assert.ok(out.pages.filter(p=>p.document==='materials').length>1);
 assert.ok(out.pages.filter(p=>p.document==='estimate').length>1);
 let shrunk=0,typed=0;
 for(const sheet of out.sheets){
  assert.equal(sheet.rowBreaks.length,sheet.pages.length-1);
  if(sheet.print.headerText)assert.match(sheet.print.headerText,/&\d+&"굴림체,Regular"2026/,'숫자로 시작하는 공사명도 글자 크기 지시자로 오해하지 않는다');
  for(const page of sheet.pages){
   for(const source of page.grid.rows){
    const row=page.native?sheet.rows[source.sheetRow]:sheet.rows.find(r=>r.values[0]===Number(source.cells[0].value)&&r.values[1]===source.cells[1]?.lines?.join('\n'));
    if(!row||source.header)continue;
    if(page.document==='materials'){
     assert.equal(source.cells[1].lines.length,1,'긴 품명은 사용자가 요청한 한 줄 유지');
     assert.equal(source.cells[2].lines.length,1,'긴 규격은 한 줄 유지');
     const note=source.cells.at(-1);assert.equal(note.fontSize,6);assert.ok(note.lines.length>1);assert.equal(note.lines.join(''),remark);
     assert.ok(source.height>=note.lines.length*6*1.15+4,'비고 줄수에 맞게 공통 행 높이 확장');
    }
    let col=0;
    for(const c of source.cells){
     const index=page.native?c.nativeColumn:col,style=formats[row.styles[index]],scale=page.native?sheet.print.scale/100:1;
     assert.ok(Math.abs(style.size*scale-c.fontSize)<1e-8,'확정된 실제 pt 공유');
     assert.equal(style.shrink,false,'엑셀 엔진 재축소 차단');
     if(c.value&&c.fontSize<(page.native?9*scale:10.5))shrunk++;
     if(typeof row.values[index]==='number')typed++;
     col+=c.span||1;
    }
   }
   for(const op of page.ops.filter(o=>o.type==='text'&&(o.text.includes('폴리염화비닐')||o.text.includes('45°')))){
    assert.equal(op.scale,1,'가로만 압축하지 않는다');
    assert.ok(Math.abs(op.width-measurePrintText(op.text,op.size))<1e-8);
   }
   const header=page.ops.find(o=>o.text===title);assert.ok(header.size<10);assert.equal(header.scale,1);
  }
 }
 assert.ok(shrunk>20);assert.ok(typed>90);
 assert.deepEqual(out.pages.map(p=>p.number),out.pages.map((_,i)=>i+11));
 assert.equal(JSON.stringify(project),before,'계산값과 사용자 공사 자료 보존');
});

test('한글 표 머리글의 띄어쓰기와 크기를 미리보기·편집 가능한 셀에 동일하게 쓴다',()=>{
 const out=printExcelSheets(fixture(),[],{sections:['formulaSummary','formulas']});
 for(const sheet of out.sheets)for(const page of sheet.pages)for(const row of page.grid.rows.filter(r=>r.header))for(const c of row.cells){
  for(const text of c.lines.filter(Boolean)){
   const op=page.ops.find(o=>o.type==='text'&&o.text===text&&o.y>=row.y&&o.y<=row.y+row.height*2);
   assert.ok(op,text);assert.equal(op.size,c.fontSize);assert.equal(op.spacing,0);assert.equal(op.scale,1);
  }
 }
});

test('표 끝의 0.2pt 잔여 공간 때문에 엑셀에 빈 테두리 페이지를 만들지 않는다',()=>{
 const rate={code:'M1',category:'자재',source:'검증',name:'시험 자재',spec:'D25',unit:'개',labor:0,material:100,expense:0,other:0,total:100};
 const project={schema:1,title:'잔여 행 인쇄 경계',charges:defaultCharges(),lines:[{id:'m',name:rate.name,spec:rate.spec,unit:'개',qty:1,bucket:'direct',status:'confirmed',rate}]};
 const rowHeight=(194.5-30-11.2-.2*25.4/72)/20,out=vectorPrintExcelSheets(project,[],{sections:['materials'],printSettings:{documents:{materials:{rowHeight}}}}),sheet=out.sheets[0],page=out.pages[0],last=page.grid.rows.at(-1);
 assert.ok(Math.abs(page.grid.bottom-last.y-last.height-.2)<.001,'실제 인쇄 경계의 1픽셀 미만 잔여 공간');
 assert.equal(sheet.rowBreaks.length,0);
 assert.ok(sheet.rows.reduce((sum,r)=>sum+r.height,0)<=Math.round(page.grid.bottom/.75)*.75+.001,'잔여 공간을 최소 높이 행으로 늘리지 않는다');
 const styles=nativeCellStyles(out.styles);assert.equal(styles[sheet.rows.at(-1).styles[0]].border.bottom,'thin','마지막 테두리는 보존');
});
