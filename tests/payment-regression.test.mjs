import test from 'node:test';
import assert from 'node:assert/strict';
import {createResourcePricer,refreshProjectResources} from '../dist/resource-pricing.js';
import {editableAssembly} from '../dist/est-edit.js';
import {costFromPrintedFormulas} from '../dist/est-cost-formulas.js';
import {calculateAssemblyDetailed} from '../dist/estimate-core.js';
import {makePrintDocuments,buildPrintPages} from '../dist/est-print.js';
import {printExcelSheets} from '../dist/print-excel.js';
import {defaultCharges,totals} from '../dist/calc.js';
import {projectFromEst} from '../dist/est-project.js';
import {machineBasisRows} from '../dist/machine-basis-print.js';
const leaf=(name,price,category='노임',spec='')=>({name,spec,unit:category==='노임'?'인':'ℓ',code:category==='노임'?'L1':'M1',category,table:category==='노임'?'LaborcDat':'StuffcDat',source:'추가',library:'extra',labor:category==='노임'?price:0,material:category==='자재'?price:0,expense:0,other:0,total:price});
const assembly=(components)=>({name:'산출',spec:'',unit:'㎥',code:'D1',category:'단가산출',table:'CostTitleDat',source:'추가',library:'extra',components,calculation:{componentDigits:1},...calculateAssemblyDetailed(components,{componentDigits:1}).result});
const project=rate=>({schema:1,title:'검증 공사',lines:[{id:'l',name:'산출',spec:'',group:'토공',unit:'㎥',qty:1,bucket:'direct',status:'confirmed',rate}],charges:defaultCharges()});

test('분 단위로 인쇄된 인력 산식을 원본과 대조한 뒤 최신 보통인부로 재계산한다',()=>{
 const labor=leaf('보통인부',169804),raw=[{Code:'L1',SCheck:-1,LineData:'보통인부 : \x03169,804\x03 × 5인 × 12분 / 450 = \x1222,640.5\x12'}];
 const rate={...assembly([]),components:undefined,labor:22640,total:22640};
 const parsed=editableAssembly(rate,raw,[labor]);assert.equal(parsed.total,22640);
 const master={id:'main',name:'2026-10-main.estx',items:[{...labor,labor:172698,total:172698,source:'2026-10-main.estx',library:'main'}]},extra={id:'extra',name:'추가',items:[labor],details:[['CostMainDat:D1',raw]]};
 const priced=createResourcePricer(project(rate),[master,extra]).reprice(rate);
 assert.equal(priced.ready,true);assert.equal(priced.rate.total,23026);assert.equal(priced.rate.components[0].labor,172698);
});
test('색인 SUM 잡비는 해당 노무·재료·경비 합계를 쓰며 원본과 다른 식은 거부한다',()=>{
 const source=[leaf('노무',170920),{...leaf('연료',876,'자재'),code:'M2'},{...leaf('손료',0),code:'E1',category:'장비',labor:0,expense:84,total:84},{...leaf('펌프',0),code:'E2',category:'장비',labor:0,expense:85,total:85}];
 const text=(price,expression,result)=>`\x03${price}\x03 × ${expression} = \x12${result}\x12`;
 const raw=[{Code:'M2',SCheck:-2,SKind:1,LineData:text(876,'1',876)},{Code:'E1',SCheck:-3,SKind:1,LineData:text(84,'1',84)},{Code:'E2',SCheck:-3,SKind:1,LineData:text(85,'1',85)},{Code:'L1',SCheck:-1,SKind:1,LineData:text(170920,'0.16/8/3',1139.4)},{LinkIndex:62,SCheck:-2,SKind:1,LineData:'SUM(A) × 3% = \x1265.5\x12'}];
 const rate={...assembly([]),labor:1139,material:941,expense:169,total:2249};
 const out=costFromPrintedFormulas(rate,raw,source);assert.equal(out.components.at(-1).basis,'total');assert.equal(out.total,2249);
 assert.throws(()=>costFromPrintedFormulas({...rate,material:942,total:2250},raw,source),/원본/);
});
test('없는 자재만 유지하고 해석 실패를 최신 적용 완료로 표시하지 않는다',()=>{
 const rate={...assembly([]),components:undefined,labor:100,total:100},p=project(rate),master={id:'main',name:'2026-10-main.estx',priceUpdateReference:true,items:[leaf('배관공',200)]};
 const out=refreshProjectResources(p,[master]);assert.equal(out.rows[0].ready,false);assert.equal(out.project.lines[0].status,'proposed');assert.equal(totals(out.project.lines,out.project.charges).missing,1);
});
test('저장 후 편집한 중첩 구성 수량을 재적용 때 원래 DB 수량으로 되돌리지 않는다',()=>{
 const labor=leaf('배 관 공',100),original=assembly([{...labor,qtyExpression:'2'}]);original.code='U1';original.category='일위대가';original.table='HeadTitleDat';
 const edited={...original,components:[{...labor,qtyExpression:'3'}],labor:300,total:300,resourcePricing:{original}};
 const outer=assembly([{...edited,qtyExpression:'2'}]),master={id:'main',name:'2026-10-main.estx',items:[{...labor,name:'배관공',labor:120,total:120}]},extra={id:'extra',name:'추가',items:[labor,original]};
 const out=createResourcePricer(project(outer),[master,extra]).reprice(outer);assert.equal(out.ready,true);assert.equal(out.rate.total,720);assert.equal(out.rate.components[0].components[0].qtyExpression,'3');
});
test('KS 등급의 괄호 표기만 정규화하고 다른 숫자와 소수 규격은 보존한다',()=>{
 const source=leaf('신너',100,'자재','KSM-6060 2종'),master={id:'main',name:'2026-10-main.estx',items:[{...source,spec:'KSM-6060(2종)',material:200,total:200}]};
 const rate=assembly([{...source,qtyExpression:'1'}]);assert.equal(createResourcePricer(project(rate),[master]).reprice(rate).rate.total,200);
 master.items[0].spec='1.5';rate.components[0].spec='15';assert.equal(createResourcePricer(project(rate),[master]).reprice(rate).ready,false);
});
test('원가계산서는 모든 행과 총액을 한 쪽에 담고 엑셀도 같은 배율을 쓴다',()=>{
 const p=project(assembly([{...leaf('노임',600000),qtyExpression:'1'}]));
 const bundle=makePrintDocuments(p),pages=buildPrintPages(bundle,{sections:['summary']}),excel=printExcelSheets(p,[],{sections:['summary']});
 assert.equal(pages.length,1);assert.equal(excel.pages.length,1);assert.ok(pages[0].ops.some(o=>o.text===totals(p.lines,p.charges).grand.toLocaleString('ko-KR')));assert.equal(excel.sheets[0].rowBreaks.length,0);
});
test('기계 기준은 실제 사용한 계수·외화 환율만 읽을 수 있게 출력한다',()=>{
 const n={verified:true,rate:{name:'장비',spec:'1㎥',source:'추가',machineBasis:[{RecNo:9,Name:'쓰지 않은 환율',TC:999,Modifyed:true}]},calc:{variables:[{name:'OP2',expression:'1/8*16/12*25/20',value:5/24},{name:'OP9',expression:'999',value:999}],rows:[{name:'손료',amount:{expense:1},machineOwnership:{coefficient:3708},priceReference:{exchangeRate:1466,unit:'$',source:'10월'}},{name:'운전원',qtyExpression:'OP2',amount:{labor:1}}]}};
 const text=JSON.stringify(machineBasisRows([n,n]));assert.match(text,/운전원 보정/);assert.match(text,/1,466/);assert.doesNotMatch(text,/RecNo|Modifyed|999/);assert.equal(machineBasisRows([n,n]).length,3);
});
test('원본의 관급 표식은 전체 비목과 순공사비가 일치할 때만 직접 계상으로 복원한다',()=>{
 const lib={id:'est',name:'원본.estx',items:[],details:[],tables:[{name:'EstMainDat.dat',rows:[{_record:0,Name:'공사',Level:2},{_record:1,Name:'자재',Code:'M1',GN:1,TU:118000,GU:118000,GC:118000,TC:118000,Gangub:2},{_record:2,Name:'순 공 사 비',LinkIndex:54,TC:118000}]}]},cost={index:1,rows:[{Name:'직접노무비',Cost:0},{Name:'간접재료비',Cost:118000},{Name:'산출경비',Cost:0}]};
 const p=projectFromEst(lib,[cost]);assert.equal(totals(p.lines,[]).direct,118000);assert.equal(p.lines[1].estSource.governmentFlag,2);
 cost.rows[2].Cost=1;assert.equal(totals(projectFromEst(lib,[cost]).lines,[]).direct,0);
});

test('단가 갱신 화면 모듈도 실제 앱과 동일하게 불러온다',async()=>{
 const update=await import('../dist/price-update-ui.js'),pricing=await import('../dist/resource-pricing-ui.js');assert.equal(typeof update.setupPriceUpdate,'function');assert.equal(typeof pricing.setupResourcePricing,'function');
});
