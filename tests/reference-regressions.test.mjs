import test from 'node:test';
import assert from 'node:assert/strict';
import {amount,totals} from '../dist/calc.js';
import {calculateAssemblyDetailed,hierarchyTotals} from '../dist/estimate-core.js';
import {validateProject} from '../dist/project-data.js';
import {withBidLines} from '../dist/bid-core.js';
import {exportEstimate} from '../dist/workbook.js';
import {unzip} from '../dist/est.js';
import {printPack} from '../dist/print-pack.js';
import {quotePrice} from '../dist/quote-core.js';
const rate={name:'자재',spec:'',unit:'개',code:'M1',category:'자재',source:'검증',labor:100,material:200,expense:30,other:0,total:330};
const line=(id,extra={})=>({id,name:id,spec:'',unit:'개',group:'구조물',bucket:'direct',status:'confirmed',qty:2,rate:{...rate},...extra});
const project=(lines,charges=[])=>({schema:1,title:'참고자료 회귀검증',location:'',lines,charges,mappings:{},evidence:[]});
test('설명서 81~86: 조사단가 비교·부가세·자릿수 처리와 빈 값 구분',()=>{
 assert.equal(quotePrice([null,1100,2200],{vat:'exclude'}),1000);
 assert.equal(quotePrice([null,1000,2000],{method:'average',vat:'include',rounding:'none'}),1650);
 assert.equal(quotePrice([1001],{digits:-2,rounding:'ceil'}),1100);
 assert.equal(quotePrice([1001],{digits:-2,rounding:'floor'}),1000);
 assert.equal(quotePrice([1.005],{digits:2,rounding:'round'}),1.01);
 assert.equal(quotePrice([0,100]),0);
 assert.throws(()=>quotePrice([null,100],{method:'selected',selected:0}),/없습니다/);
 assert.throws(()=>quotePrice([NaN]),/조사단가/);
});
test('설명서 87: 행 금액 표시를 유지하며 상위 집계와 원가에서만 제외한다',()=>{
 const p=project([line('head',{level:2}),line('normal'),line('reference',{calculationMode:'vertical'}),line('missing',{calculationMode:'vertical',status:'unmatched',rate:null})]);
 assert.equal(amount(p.lines[2]).total,660);
 assert.equal(hierarchyTotals(p.lines).get('head').total,660);
 assert.equal(totals(p.lines,[]).direct,660);assert.equal(totals(p.lines,[]).missing,0);
 const html=printPack(p,[],{sections:['estimate','groups']}).html;
 assert.match(html,/세로 집계 제외/);assert.match(html,/reference/);
});
test('설명서 87: 직접 금액은 수량·단가·낙찰률 변경에도 고정하고 자동 복원 가능',()=>{
 const l=line('fixed',{calculationMode:'horizontal',manualAmounts:{labor:123,material:456,expense:78,other:0}});
 assert.equal(amount(l).total,657);l.qty=99;l.rate.labor=10000;l.bidPercent=80;
 assert.equal(amount(l).total,657);assert.equal(totals([l],[]).direct,657);
 l.calculationMode='both';assert.equal(amount(l).total,657);assert.equal(totals([l],[]).direct,0);
 l.calculationMode='auto';assert.equal(amount(l).labor,792000);
 assert.throws(()=>validateProject(project([{...l,calculationMode:'horizontal',manualAmounts:{labor:1.5,material:0,expense:0,other:0}}])),/정수/);
});
test('강의 05 10:38: 사급 자재는 설치비의 기준으로 쓰되 자재비 중복 합산 방지',()=>{
 const parts=[{...rate,labor:0,material:200000,expense:0,qty:1,calculationMode:'vertical'},
 {kind:'percent',name:'설치비',scope:'all',basis:'material',target:'labor',percent:5}];
 const result=calculateAssemblyDetailed(parts);
 assert.equal(result.rows[0].amount.total,200000);
 assert.deepEqual(result.result,{labor:10000,material:0,expense:0,other:0,total:10000});
 parts[0].calculationMode='both';parts[0].manualAmounts={labor:0,material:100000,expense:0,other:0};
 assert.equal(calculateAssemblyDetailed(parts).result.labor,5000);
});
test('낙찰 강의 22: 지정 보험료는 원금액 유지·낙찰률 재변경·100% 복원',()=>{
 const p=project([line('bid')],[{key:'health',name:'건강보험료',base:'labor',rate:10},{key:'longTermCare',name:'요양',base:'health',rate:10},{key:'vat',name:'부가세',base:'contractBeforeVat',rate:10}]);
 const bid=percent=>p.lines.map(l=>({...l,bidPercent:percent}));
 const a=withBidLines(p,bid(80),['health','longTermCare']);
 assert.equal(totals(a.lines,a.charges).charges[0].amount,20);
 assert.equal(totals(a.lines,a.charges).charges[1].amount,2);
 const b=withBidLines(a,bid(70),['health','longTermCare']);assert.equal(b.charges[0].fixed,20);
 const restored=withBidLines(b,bid(100),['health','longTermCare']);assert.deepEqual(restored.charges,p.charges);
 const released=withBidLines(a,bid(80),[]);assert.equal(totals(released.lines,released.charges).charges[0].amount,16);
 assert.deepEqual(p.charges[0],{key:'health',name:'건강보험료',base:'labor',rate:10});
});
test('엑셀에서 수동 금액은 숫자로 보존하고 모든 집계 수식이 제외 표식을 따른다',async()=>{
 const p=project([line('heading',{level:2}),line('fixed',{calculationMode:'horizontal',manualAmounts:{labor:123,material:456,expense:78,other:0}}),line('omit',{calculationMode:'vertical'})]);
 const zip=await unzip(exportEstimate(p));
 const xml=await zip.read('xl/worksheets/sheet1.xml'),text=new TextDecoder().decode(xml);
 assert.match(text,/<c r="P5"[^>]*><v>123<\/v>/);
 assert.match(text,/<c r="V6"[^>]*><v>0<\/v>/);
 assert.match(text,/SUMIFS\(L5:L6,N5:N6,&quot;&lt;&gt;heading&quot;,V5:V6,1\)/);
 for(const file of ['sheet2.xml','sheet3.xml']){
  const data=new TextDecoder().decode(await zip.read('xl/worksheets/'+file));
  assert.match(data,file==='sheet2.xml'?/V4:V6/:/V5:V6/);assert.match(data,/<v>657<\/v>/);
 }
});
import {removeAssemblyPart} from '../dist/assembly-structure.js';
import {machineryRate,safetyComparison} from '../dist/work-core.js';
test('ADD 시작행은 앞 행 삭제 시 따라가고 시작행 자체 삭제 시 재지정을 요구한다',()=>{
 const parts=[{...rate,qty:1},{...rate,qty:2},{kind:'subtotal',name:'ADD',basis:'labor',target:'labor',startRow:2}];
 const shifted=removeAssemblyPart(parts,0);assert.equal(shifted[1].startRow,1);assert.equal(calculateAssemblyDetailed(shifted).rows[1].amount.labor,200);
 const invalid=removeAssemblyPart(parts,1);assert.throws(()=>calculateAssemblyDetailed(invalid),/시작 행이 삭제/);
 assert.equal(parts[2].startRow,2);assert.equal(parts.length,3);
});
test('장비 손료 천만분율과 운전원 보정계수를 분리하여 적용한다',()=>{
 const inputs={price:100000000,exchange:1,ownership:100,ownershipScale:7,operatorFactor:1.2,fuel:10,fuelPrice:1000,oilPercent:10,dailyWage:200000,workers:1,hours:8,misc:500};
 assert.deepEqual(machineryRate(inputs),{labor:30000,material:11000,expense:1500,other:0,total:42500});
 assert.throws(()=>machineryRate({...inputs,ownershipScale:8}),/분모 지수/);
});
test('조사 출처와 안전비교 근거는 인쇄·엑셀에 보존하고 비교액은 중복 합산하지 않는다',async()=>{
 const q={...rate,id:'quoted',quoteMethod:'selected',quoteSelection:1,quoteSources:['물가자료','견적 <업체>'],quotePages:['123쪽','견적서 A'],quoteDate:'2026-10-31',prices:[100,200],quoteRounding:{mode:'floor',digits:0},vatConversion:{mode:'none',rate:10}};
 const comparison=safetyComparison(1000,2000,2,0,20),p=project([line('head',{level:2}),line('quoted',{rate:q})],[{key:'safety',name:'산업안전보건관리비',base:'fixed',fixed:comparison.selected,comparison}]);
 const html=printPack(p,[],{sections:['summary','estimate','quotes']}).html;
 assert.match(html,/\[L2\] head/);assert.match(html,/견적 &lt;업체&gt;/);assert.match(html,/2026-10-31/);assert.match(html,/별도로 합산하지 않습니다/);assert.equal(totals(p.lines,p.charges).contract,684);
 const zip=await unzip(exportEstimate(p)),sheet=new TextDecoder().decode(await zip.read('xl/worksheets/sheet6.xml'));
 assert.match(sheet,/견적 &lt;업체&gt;/);assert.match(sheet,/견적서 A/);assert.match(sheet,/2026-10-31/);
});
import {quoteInputs} from '../dist/quote-core.js';
test('실제 EST 빈 조사단가 열의 0은 최저가에서 제외하고 사용자 입력 0은 보존한다',()=>{
 const original={prices:[1676,0,0,0,0,0],total:1676};const initial=quoteInputs(original);
 assert.equal(quotePrice(initial.prices,{method:initial.method}),1676);assert.equal(original.prices[1],0);
 assert.deepEqual(quoteInputs({prices:[0,0],total:700}),{prices:Array(6).fill(null),method:'manual'});
 const saved=quoteInputs({prices:[0,100],quoteMethod:'min'});assert.equal(quotePrice(saved.prices),0);
});
import {printSettings,printedLines} from '../dist/print-settings.js';
test('출력 레벨은 하위 금액을 유지하며 문서별 서식과 근거별 페이지 구분을 적용한다',()=>{
 const p=project([line('큰공종',{level:2}),line('작은공종',{level:1}),line('세부항목')]);
 p.evidence=[{rate:{...rate,name:'근거A',spec:'',components:[]}}, {rate:{...rate,name:'근거B',spec:'',components:[]}}];
 const html=printPack(p,[],{sections:['estimate','evidence'],level:2,evidenceNewPage:true,documents:{estimate:{size:12,rowPadding:3}}}).html;
 assert.match(html,/\[L2\] 큰공종/);assert.doesNotMatch(html,/작은공종|세부항목/);assert.match(html,/>660<\/td>/);
 assert.match(html,/font-size:12pt;--row-padding:3px/);assert.match(html,/<div class="print-break"><h2>근거B/);
 assert.equal(printedLines(p.lines,0).length,3);assert.equal(p.lines.length,3);
 assert.throws(()=>printSettings({level:1.5}),/정수/);assert.throws(()=>printSettings({documents:{estimate:{size:'12;display:none'}}}),/문서별/);
});
