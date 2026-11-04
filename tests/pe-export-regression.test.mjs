import test from 'node:test';
import assert from 'node:assert/strict';
import {planAutoLinks} from '../dist/auto-link.js';
import {compatibleWork,compatibleUnits,compareSpecs} from '../dist/match-similarity.js';
import {printExcelSheets,exportPrintExcel} from '../dist/print-excel.js';
import {unzip} from '../dist/est.js';
import {makePrintDocuments,buildPrintPages} from '../dist/est-print.js';
import {defaultCharges} from '../dist/calc.js';
const rate=(name,spec,unit='개',category='자재')=>({name,spec,unit,category,code:name+spec,source:'추가',labor:100,material:20,expense:3,other:0,total:123});
const line=(name,spec,unit='개')=>({id:name+spec,name,spec,unit,group:/부설/.test(name)?'배관공':'자재대',qty:3,status:'unmatched'});
test('PE 부설·소켓플랜지·범위형 이경소켓·압륜의 추가 DB 연결',()=>{
 const cases=[['PE접합및부설','D=25','m','PE관 접합및부설','Φ25mm','m당','일위대가'],['이탈방지압륜','D80','개','이탈방지압륜(KP부속)','D80mm','조','자재'],['PE소켓플랜지','D50','개','PE 소켓플랜지','D50mm (조임식)','개','자재'],['PE이경소켓','D40×20','개','PE 이경소켓','40×(16~32)','개','자재']];
 for(const [name,spec,unit,to,toSpec,toUnit,category] of cases){const src=line(name,spec,unit),target=rate(to,toSpec,toUnit,category);
  const profile={rules:[{kind:'emergency',source:src,target,support:1,total:1,projectCount:1}]};
  const result=planAutoLinks({title:'긴급보수',lines:[src]},[{id:'added',items:[target]}],'','added',profile)[0];
  assert.equal(result.rate,target,name);assert.equal(result.recommended,true,name);assert.equal(src.unit,unit);
 }
 assert.equal(compatibleUnits(line('PE소켓','D20'),rate('PE소켓','D20','조')),false);
 assert.equal(compatibleWork(line('PE소켓플랜지','D50'),rate('STS소켓플랜지','D50')),false);
});
test('범위형 이경 관경은 포트 순서를 구분하고 범위 밖을 일치로 처리하지 않는다',()=>{
 assert.equal(compareSpecs('D40×20','40×(16~32)',{diameterAliases:true}).rangeMatch,true);
 assert.equal(compareSpecs('D40×13SU','40×(16~32)',{diameterAliases:true}).rangeMatch,true);
 for(const from of ['20×40','40×50','50×20'])assert.notEqual(compareSpecs(from,'40×(16~32)',{diameterAliases:true}).rangeMatch,true);
});
const project=()=>({schema:1,title:'출력 검증',lines:[{...line('PE관 접합및부설','D25','m'),status:'confirmed',rate:rate('PE관 접합및부설','D25','m','일위대가'),bidPercent:95},...['government','fees','waste'].map((bucket,i)=>({...line('별도비'+i,'','식'),id:bucket,bucket,status:'confirmed',rate:rate('별도비'+i,'','식')}))],charges:defaultCharges()});
test('엑셀 내용과 금액은 미리보기와 같으며 용도에 따른 제외·추가 낙찰이 없다',()=>{
 const p=project(),before=structuredClone(p),sections=['summary','groups','estimate'];
 const result=printExcelSheets(p,[],{sections}),preview=makePrintDocuments(p);
 assert.deepEqual(result.bundle,preview);assert.deepEqual(p,before);
 assert.deepEqual(result.sheets.map(s=>s.name),preview.documents.filter(d=>sections.includes(d.key)).map(d=>d.title));
 for(const sheet of result.sheets){assert.equal(sheet.print.paperSize,9);assert.ok(sheet.rows.every(r=>r.height>0&&r.height<=409));
  assert.deepEqual(sheet.pages.map(p=>p.ops),buildPrintPages(preview,{sections}).filter(p=>p.title===sheet.name).map(p=>p.ops));
 }
 const amounts=result.sheets[0].rows.flatMap(r=>r.values).filter(v=>typeof v==='number');
 assert.ok(amounts.includes(preview.totals.grand));assert.ok(amounts.includes(preview.totals.fees));
});
test('기본 세 시트는 EST 엑셀 양식을 쓰고 미리보기 옵션과 병합을 보존한다',()=>{
 const p=project();p.lines=Array.from({length:35},(_,i)=>({...p.lines[0],id:String(i)}));
 const settings={sections:['summary','estimate'],startPage:7,documents:{estimate:{orientation:'portrait',marginLeft:20,marginRight:20,rowHeight:8,breakRows:'3,17'}}};
 const result=printExcelSheets(p,[],{sections:settings.sections,printSettings:settings});
 assert.equal(result.sheets[1].print.flags&2,2);assert.ok(result.sheets[1].print.scale<=85);assert.ok(result.sheets[1].rowBreaks.length>=2);assert.equal(result.sheets[0].print.firstPageNumber,7);assert.equal(result.pages.find(p=>p.key==='estimate')?.orientation||result.sheets[1].pages[0].orientation,'portrait');
 const coordinate=s=>{const m=s.match(/^([A-Z]+)(\d+)$/);return [Number(m[2]),[...m[1]].reduce((n,c)=>n*26+c.charCodeAt(0)-64,0)];};
 for(const sheet of result.sheets){const used=new Set();for(const merge of sheet.merges){const [a,b]=merge.split(':').map(coordinate);for(let r=a[0];r<=b[0];r++)for(let c=a[1];c<=b[1];c++){const id=r+':'+c;assert.ok(!used.has(id),sheet.name+' '+merge);used.add(id);}}}
});
test('긴 품명·규격은 한 줄 축소하고 엑셀은 페이지 나누기 보기로 저장한다',async()=>{
 const p=project();p.lines=[{...p.lines[0],name:'긴 품명 '.repeat(12),spec:'D20 / 조임식 '.repeat(8)}];
 const result=printExcelSheets(p,[],{sections:['estimate']});
 for(const page of result.pages)for(const row of page.grid.rows)for(const cell of row.cells)assert.equal(cell.lines.length,1);
 assert.ok(result.sheets[0].rows.flatMap(r=>r.values).includes(p.lines[0].name));
 assert.equal(result.sheets[0].view,'pageBreakPreview');
 const zip=await unzip(exportPrintExcel(p,[],{sections:['estimate']})),xml=new TextDecoder().decode(await zip.read('xl/worksheets/sheet1.xml'));
 assert.match(xml,/view="pageBreakPreview"/);assert.match(xml,/showGridLines="1"/);
 const styles=new TextDecoder().decode(await zip.read('xl/styles.xml'));assert.doesNotMatch(styles,/wrapText="1"/);assert.match(styles,/shrinkToFit="1"/);
});
