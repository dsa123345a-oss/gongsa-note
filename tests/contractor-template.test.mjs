import test from 'node:test';
import assert from 'node:assert/strict';
import {contractorTemplateSheets,contractorTemplateKind} from '../dist/contractor-template-export.js';
import {contractorTemplates} from '../dist/contractor-templates.js';
import {exportContractor} from '../dist/contractor-export.js';
import {unzip} from '../dist/est.js';
import {defaultCharges,totals} from '../dist/calc.js';
import {addSurcharge} from '../dist/line-adjustments.js';
const item=(id,bucket='direct')=>({id,name:id,spec:'D20',unit:'m',group:'토공',bucket,qty:2.5,status:'confirmed',rate:{labor:1001,material:202,expense:17,other:3,total:1223}});
const project=()=>({schema:1,title:'상수도 신규급수공사',ratesReviewed:true,lines:[item('터파기'),item('폐기물','waste'),item('관급','government'),item('수수료','fees')],charges:defaultCharges()});
test('업체 실제 출력은 착공 양식의 3개 시트만 포함한다',async()=>{
 const p=project(),before=structuredClone(p),z=await unzip(exportContractor(p)),dec=new TextDecoder(),xml=dec.decode(await z.read('xl/workbook.xml'));
 assert.equal((xml.match(/<sheet name=/g)||[]).length,3);assert.match(xml,/원가계산서.*내역서총괄표.*내역서/);assert.doesNotMatch(xml,/일위단가표|기계경비단가산출표|자재단가표|노임단가표/);
 assert.doesNotMatch(xml,/산정원가|계산근거/);assert.deepEqual(p,before);
 const detail=dec.decode(await z.read('xl/worksheets/sheet3.xml'));assert.doesNotMatch(detail,/>관급<|>수수료</);assert.match(detail,/>폐기물</);
 assert.match(detail,/orientation="landscape"/);assert.match(detail,/scale="85"/);assert.match(xml,/&apos;내역서&apos;!\$B\$2:/);
});
test('신규·긴급 요율 열은 넓히고 전체 폭·글꼴·행 높이·병합·인쇄 설정은 유지한다',()=>{
 for(const kind of ['new','emergency']){const p={...project(),contractorTemplate:kind},o=contractorTemplateSheets(p),t=contractorTemplates[kind];
  for(let i=0;i<3;i++){const expected=structuredClone(t.sheets[i].columns);if(i===0){const extra=13-expected[6].width;expected[6].width=13;expected[7].width-=extra;}assert.deepEqual(o.sheets[i].columns,expected);assert.deepEqual(o.sheets[i].merges,t.sheets[i].merges);assert.deepEqual(o.sheets[i].print,t.sheets[i].print);assert.deepEqual(o.sheets[i].rows.slice(0,i===2?4:3),t.sheets[i].header);}
  assert.match(o.styles,/<name val="굴림체"/);assert.match(o.styles,/<sz val="9(?:\.0)?"/);assert.match(o.styles,/formatCode="#,##0\.0########"/);
 }
 assert.equal(contractorTemplateKind({title:'상수도 긴급보수'}),'emergency');assert.equal(contractorTemplateKind({title:'신규',contractorTemplate:'emergency'}),'emergency');
});
test('할증·폐기물·공구 합계는 숨은 보조 시트 없이 서로 연결된다',()=>{
 let p=project();p=addSurcharge(p,'터파기',{scope:'selected',sourceIds:['터파기'],basis:'expense',target:'material',percent:50});
 const o=contractorTemplateSheets(p),d=o.sheets[2],cost=o.sheets[0],line=d.rows.find(r=>r.values[2]==='터파기');
 assert.equal(line.values[13].value,49);assert.match(line.values[13].formula,/TRUNC.*TRUNC/);
 const extra=d.rows.find(r=>r.values[2]==='기타할증');assert.match(extra.values[10].formula,/N\d+.*E\d+/);
 const final=cost.rows.find(r=>r.code==='K').values[5];assert.equal(final.value,totals(p.lines,p.charges).contract);
 assert.match(cost.rows.find(r=>r.code==='H').values[5].formula,/'내역서'!H\d+/);
 assert.ok(d.rows.some(r=>r.values[2]==='폐기물처리비'));
});
test('빈 공종을 제외하며 다공구 요약은 원본 형식의 공구 번호를 표시한다',()=>{
 const p={...project(),title:'긴급보수',lines:[{id:'s1',name:'현장1',level:2},{id:'g1',name:'토공',level:1},item('a'),{id:'s2',name:'현장2',level:2},{id:'g2',name:'포장공',level:1},item('b'),{id:'empty',name:'빈공종',level:1}]};
 const s=contractorTemplateSheets(p).sheets[1];assert.deepEqual(s.rows.slice(3).filter(r=>r.values[1]).map(r=>r.values[1]),['1공구','2공구']);assert.ok(!s.rows.some(r=>r.values[2]==='빈공종'));
});
test('배포 양식에 고객 이름·과거 공사명·PC 경로가 포함되지 않는다',()=>{
 const text=JSON.stringify(contractorTemplates);assert.doesNotMatch(text,/[A-Z]:[\\/]/);
});

test('EST의 글꼴 굵기 700을 제목·표 머리·공종명에 보존한다',()=>{
 for(const kind of ['new','emergency']){
  const t=contractorTemplates[kind],fonts=[...t.styles.matchAll(/<font>([\s\S]*?)<\/font>/g)].map(x=>x[1]);
  assert.match(fonts[5],/<b\/>/);assert.match(fonts[6],/<b\/>/);assert.doesNotMatch(fonts[7],/<b\/>/);
  const xfs=[...t.styles.match(/<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/)[1].matchAll(/<xf\b[^>]*>[\s\S]*?<\/xf>/g)].map(x=>x[0]);
  assert.match(xfs[t.sheets[2].root.styles[2]],/fontId="6"/);assert.match(xfs[t.sheets[2].detail.styles[2]],/fontId="7"/);
 }
});
