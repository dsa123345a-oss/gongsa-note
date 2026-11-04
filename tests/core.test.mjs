import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {inflateRawSync} from 'node:zlib';
import {unzip,zipStore,readTable,importEst} from '../dist/est.js';
import {amount,truncateProduct,totals,defaultCharges,suggest} from '../dist/calc.js';
import {extractQuantities,exportEstimate} from '../dist/workbook.js';
import {calculateAssembly} from '../dist/assembly.js';
test('사용자 일위대가는 구성 수량과 비목별 절사로 재계산한다',()=>{
 assert.deepEqual(calculateAssembly([{qty:4.6,labor:7003,material:428,expense:594,other:0},{qty:0.5,labor:100,material:20,expense:10,other:0}]),{labor:32263,material:1978,expense:2737,other:0,total:36978});
 assert.throws(()=>calculateAssembly([{qty:null,labor:0,material:0,expense:0,other:0}]),/수량/);
});
test('비목별 절사: EST 실무 사례 4.6 × 8,025는 비목 합산 36,913원',()=>{
 const l={qty:4.6,factor:1,status:'confirmed',rate:{labor:7003,material:428,expense:594,other:0}};
 assert.deepEqual(amount(l),{labor:32213,material:1968,expense:2732,other:0,total:36913});
 assert.equal(truncateProduct(2.8,81),226);assert.equal(truncateProduct(0.33,128000),42240);
});
test('미연결은 0원이 아니며 관급/별도비를 구분한다',()=>{
 const line={qty:1,status:'confirmed',factor:1,rate:{labor:100,material:200,expense:300,other:0}};
 const t=totals([{...line,bucket:'direct'},{...line,bucket:'government'},{...line,bucket:'waste'},{...line,status:'unmatched',bucket:'direct'}],[{key:'vat',name:'부가세',base:'contractBeforeVat',rate:10}]);
 assert.equal(t.missing,1);assert.equal(t.direct,600);assert.equal(t.waste,600);assert.equal(t.government,600);assert.equal(t.contract,1320);assert.equal(t.grand,1920);
 assert.equal(amount({...line,qty:null}),null);
});
test('일치 후보와 단위 차이를 구분한다',()=>{
 const l={name:'PE 직관',spec:'D15',unit:'m',group:'자재대'};const items=[{name:'PE 직관',spec:'D16',unit:'m',total:10,category:'자재'},{name:'PE 직관',spec:'D15',unit:'M',total:20,category:'자재'}];
 const result=suggest(l,items);assert.equal(result[0].item.total,20);assert.equal(result[0].exact,true);assert.equal(result[1].exact,false);
});

test('간접노무비와 건강보험료를 후속 요율의 기준에 포함한다',()=>{
 const t=totals([{qty:1,status:'confirmed',bucket:'direct',rate:{labor:100000,material:20000,expense:5000}}],[{key:'indirect',base:'labor',rate:10},{key:'health',base:'labor',rate:3},{key:'care',base:'health',rate:12},{key:'other',base:'totalLaborMaterial',rate:5}]);
 assert.deepEqual(t.charges.map(c=>c.amount),[10000,3000,360,6500]);
});
test('ZIP CRC 무결성 검사와 손상 검출',async()=>{
 const b=zipStore({'test.txt':'검증'}),z=await unzip(b);assert.equal(new TextDecoder().decode(await z.read('test.txt')),'검증');b[38]^=1;await assert.rejects(async()=>await(await unzip(b)).read('test.txt'),/무결성/);
});
test('수량표 좌우와 0수량, 계산값 누락을 처리한다',()=>{
 const cell=(value,ref,formula='')=>({value,ref,formula,cached:!formula||value!==''});
 const sheet={name:'수량',rows:[{index:4,cells:{AI:cell('구분','AI4'),AO:cell('품목','AO4'),AW:cell('규격','AW4'),BL:cell('수량','BL4'),BO:cell('단위','BO4')}},{index:5,cells:{AI:cell('4.자재대','AI5'),AO:cell('PE직관','AO5'),AW:cell('D15','AW5'),BL:cell(7,'BL5'),BO:cell('M','BO5')}},{index:8,cells:{A:cell('구분','A8'),D:cell('공 종','D8'),H:cell('규격','H8'),AD:cell('수량','AD8'),AG:cell('단위','AG8')}},{index:10,cells:{A:cell('1.토공','A10'),D:cell('터파기','D10'),H:cell('백호','H10'),AD:cell(0,'AD10'),AG:cell('㎥','AG10')}},{index:11,cells:{D:cell('계산 누락','D11'),AD:cell('','AD11','SUM(A1:A2)'),AG:cell('㎥','AG11')}}]};
 const q=extractQuantities(sheet);assert.equal(q.rows.length,3);assert.equal(q.rows.find(l=>l.name==='PE직관').qty,7);assert.equal(q.rows.find(l=>l.name==='터파기').exclude,true);assert.equal(q.rows.find(l=>l.name==='계산 누락').qty,null);
});
test('엑셀 내보내기에는 수량·비목 계산식과 미연결 표시가 있다',async()=>{
 const p={title:'테스트',lines:[{name:'터파기',qty:4.6,unit:'㎥',group:'1.토공',status:'confirmed',bucket:'direct',rate:{labor:7003,material:428,expense:594,other:0,source:'원본',code:'D1'}},{name:'누락',qty:1,status:'unmatched',bucket:'direct'}],charges:defaultCharges()};
 const z=await unzip(exportEstimate(p));const sheet=new TextDecoder().decode(await z.read('xl/worksheets/sheet1.xml'));assert.match(sheet,/TRUNC\(ROUND\(F4\*K4\*IF\(/);assert.match(sheet,/<v>36913<\/v>/);assert.match(sheet,/미연결/);assert.match(sheet,/낙찰률 미적용/);
 const summary=new TextDecoder().decode(await z.read('xl/worksheets/sheet2.xml'));assert.match(summary,/SUMIFS/);assert.match(summary,/SUMIF/);assert.match(summary,/TRUNC\(ROUND\(\(D8\+SUM\(D9:D25\)\+D27\)\*C26\*0.01,8\),0\)/);
 const workbook=new TextDecoder().decode(await z.read('xl/workbook.xml'));assert.match(workbook,/공종별 집계표/);assert.match(workbook,/단가 산출근거/);
});
test('실제 EST 월별 파일의 구조와 표본 가격 검증',{skip:!process.env.EST_MONTH_PATH},async()=>{
 const lib=await importEst(await fs.readFile(process.env.EST_MONTH_PATH),'monthly.estx',inflateRawSync);
 assert.equal(lib.version,'7.0');assert.equal(lib.stats.find(t=>t.category==='자재').count,23941);assert.equal(lib.stats.find(t=>t.category==='노임').count,392);
 assert.equal(lib.items.find(i=>i.code==='M0003039885'&&i.category==='자재').total,1689);
 assert.equal(lib.items.find(i=>i.code==='L0000001239'&&i.category==='노임').name,'보통인부');
 assert.equal(lib.items.find(i=>i.code==='L0000001239'&&i.category==='노임').total,172698);
 assert.equal(lib.items.length,32050);
 assert.equal(lib.tables.reduce((n,t)=>n+t.rows.length,0),124131);
 assert.equal(lib.tables.find(t=>t.name==='CostMainDat.dat').rows.length,75963);
 assert.equal(lib.tables.find(t=>t.name==='SilJukDat.dat').rows.length,3690);
 assert.equal(lib.tables.find(t=>t.name==='MachGijunDat.dat').rows.length,19);
 assert.equal(Buffer.compare(lib.originalBytes,await fs.readFile(process.env.EST_MONTH_PATH)),0);
 console.log('실제 파일 단가 항목:',lib.items.length,'근거 그룹:',lib.details.length);
});
test('실제 완성 설계의 저장 금액과 비목별 계산 대조',{skip:!process.env.EST_PROJECT_PATH},async()=>{
 const z=await unzip(await fs.readFile(process.env.EST_PROJECT_PATH),inflateRawSync);const t=readTable(await z.read('EstMainDat.dat'));
 let compared=0;for(const r of t.rows){if(!r.Code||!r.TU||!r.GN||(r.Level||0)!==0)continue;const a=amount({qty:r.GN,factor:1,status:'confirmed',rate:{labor:r.NU||0,material:r.GU||0,expense:r.JU||0,other:(r.TU||0)-(r.NU||0)-(r.GU||0)-(r.JU||0)}});assert.equal(a.total,r.TC,`${r.Name} ${r.Code}`);compared++;}assert.ok(compared>=30);console.log('완성 설계 대조:',compared,'항목 일치');
});
