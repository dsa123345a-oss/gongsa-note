import test from 'node:test';
import assert from 'node:assert/strict';
import {projectFromEst} from '../dist/est-project.js';
import {readValueTable} from '../dist/est-project-data.js';
import {totals,amount} from '../dist/calc.js';
import {validateProject} from '../dist/project-data.js';
import {hierarchyTotals} from '../dist/estimate-core.js';
import {estTotalScope} from '../dist/est-total-scope.js';
import {costSheet} from '../dist/cost-sheet.js';
import {withBidLines} from '../dist/bid-core.js';
import {costReferences} from '../dist/cost-formula.js';
const head=(name,level=1)=>({Name:name,Level:level});
const row=(name,qty=2)=>({Name:name,Code:'M1',GN:qty,Unite:'개',TU:100,GU:100,TC:qty*100,GC:qty*100,Level:0});
const lib=rows=>({id:'source',name:'test.estx',version:'7.0',items:[],details:[],tables:[{name:'EstMainDat.dat',rows:rows.map((r,i)=>({...r,_record:i}))}]});
test('levels, no-code items and separate buckets survive without duplicate summary amounts',()=>{
 const p=projectFromEst(lib([head('공사',2),head('토공'),row('자재'),{...row('직접 입력'),Code:undefined},head('관급자재대'),row('관급'),head('폐기물처리비'),row('폐기물'),head('원인자부담금'),row('부담금'),{Name:'총공사비',LinkIndex:58,TC:100000}]));
 assert.equal(p.lines.length,10);assert.equal(totals(p.lines,[]).direct,400);assert.equal(totals(p.lines,[]).government,200);assert.equal(totals(p.lines,[]).waste,200);assert.equal(totals(p.lines,[]).fees,200);assert.equal(p.charges.length,0);
 assert.equal(p.estImport.skipped.length,1);assert.ok(p.estImport.warnings.length);assert.equal(hierarchyTotals(p.lines).get(p.lines[0].id).total,400);
});
test('proven bid original is restored and not applied twice',()=>{
 const p=projectFromEst(lib([head('공사',2),{...row('밸브'),TU:95,GU:95,TC:190,GC:190,ApplyNacChal:true,NachalRatio:95,OTU:100,OGU:100}]));
 const l=p.lines[1];assert.equal(l.rate.total,100);assert.equal(l.bidPercent,95);assert.equal(amount(l).total,190);assert.equal(amount({...l,bidPercent:100}).total,200);
});
test('unproven arithmetic is explicit and preserves the original amount',()=>{
 const p=projectFromEst(lib([head('공사',2),{...row('특수 계산'),TC:199,GC:199}]));
 assert.equal(amount(p.lines[1]).total,199);assert.equal(p.lines[1].calculationMode,'horizontal');assert.equal(p.estImport.fixedRows.length,1);
 assert.deepEqual(totals(validateProject(JSON.parse(JSON.stringify(p))).lines,[]),totals(p.lines,[]));
});
test('matching cost sheet supplies rates; unknown or adjusted costs stay fixed',()=>{
 const rows=[{Name:'직접노무비',Cost:0},{Name:'간접재료비',Cost:200},{Name:'일반관리비',Gubun:'E',Cost:16,Youl:'8%',VSusic:'D × 0.08'},{Name:'이윤',Gubun:'F',Cost:1,Youl:'15%',VSusic:'(B+C+E) × 0.15'},{Name:'부가가치세',Gubun:'I',Cost:21,Youl:'10%',VSusic:'G × 0.1'},{Name:'총공사비',Cost:238}];
 const p=projectFromEst(lib([head('공사',2),row('자재')]),[{index:7,rows}]);
 assert.equal(totals(p.lines,p.charges).grand,238);assert.equal(p.charges[0].rate,8);assert.equal(p.charges[1].fixed,1);assert.equal(p.estImport.fixedCharges.length,1);
});
test('ambiguous cost templates are not silently selected',()=>{
 const rows=[{Name:'직접노무비',Cost:0},{Name:'간접재료비',Cost:200}];const p=projectFromEst(lib([head('공사',2),row('자재')]),[{index:7,rows},{index:22,rows}]);assert.equal(p.charges.length,0);assert.ok(p.estImport.warnings.some(x=>x.includes('특정하지')));
});
test('validated surcharge remains linked to previous group rows',()=>{
 const p=projectFromEst(lib([head('공사',2),head('토공'),{...row('인력'),GU:0,GC:0,NU:100,NC:200},{Name:'할증',Unite:'%',GN:50,LinkIndex:67,OCheck:2,SCheck:2,TC:100,NC:100}]));
 assert.equal(p.lines[3].surcharge.basis,'labor');assert.equal(totals(p.lines,[]).direct,300);p.lines[2].qty=3;assert.equal(totals(p.lines,[]).direct,450);
});
test('unsupported, truncated and empty value streams fail closed',()=>{
 for(const b of [new Uint8Array(),new TextEncoder().encode('TPF0'),new Uint8Array([84,80,70,48,20,200,0,0,0]),new Uint8Array([84,80,70,48,99])])assert.throws(()=>readValueTable(b));
});
test('database-only file cannot replace a project',()=>assert.throws(()=>projectFromEst(lib([{Code:'M1',Name:'메인 자재',TU:100}]))));

test('nested EST surcharge uses previous surcharge only when every saved component matches',()=>{
 const p=projectFromEst(lib([head('공사',2),head('토공'),{...row('인력'),GU:0,GC:0,NU:100,NC:200},{Name:'할증',Unite:'%',GN:50,LinkIndex:67,OCheck:2,SCheck:2,TC:100,NC:100},{Name:'할증',Unite:'%',GN:50,LinkIndex:67,OCheck:2,SCheck:2,TC:150,NC:150}]));
 assert.equal(p.estImport.fixedRows.length,0);assert.equal(p.lines[4].surcharge.includeSurcharges,true);assert.equal(totals(p.lines,[]).direct,450);
 p.lines[2].qty=4;assert.equal(totals(p.lines,[]).direct,900);assert.ok(p.estImport.warnings.some(w=>w.includes('앞선 할증')));
});

test('unresolved surcharge uses percent factor and reports unproven source range',()=>{
 const p=projectFromEst(lib([head('공사',2),head('토공'),row('자재'),{Name:'할증',Unite:'%',GN:30,NU:100,TU:100,LinkIndex:67,OCheck:2,SCheck:2,TC:30,NC:30}]));
 assert.equal(p.estImport.fixedRows.length,0);assert.equal(amount(p.lines[3]).total,30);assert.equal(p.lines[3].surcharge,undefined);assert.ok(p.estImport.warnings.some(w=>w.includes('범위를 확정하지')));
});

test('source sum scope reconciles source formulas and remains dynamic across edits and cost sheet',()=>{
 const rows=[{Name:'직접노무비',Cost:0},{Name:'간접재료비',Cost:200},{Name:'총원가',Gubun:'G',Cost:200},{Name:'부가가치세',Gubun:'I',Cost:20,Youl:'10%',VSusic:'G*0.1'},{Name:'도급예정액',Gubun:'J',Cost:220,VSusic:'(G+I)'},{Name:'관급자재대',Gubun:'K',Cost:100},{Name:'수수료',Gubun:'L',Cost:100},{Name:'총공사비',Gubun:'M',Cost:220,VSusic:'(J)'}];
 const p=projectFromEst(lib([head('공사',2),row('자재'),head('관급자재대'),row('관급',1),head('수수료'),row('수수료',1)]),[{index:1,rows}]);
 assert.ok(p.estImport.comparisons.every(x=>x.difference===0));assert.equal(totals(p.lines,p.charges).grand,220);
 p.lines[1].qty=3;const t=totals(p.lines,p.charges);assert.equal(t.grand,330);assert.equal(t.government,100);assert.equal(t.fees,100);
 const sheet=costSheet(p);assert.equal(sheet.rows.find(r=>r.id==='grand').amount,330);assert.ok(sheet.rows.find(r=>r.id==='government').basis.includes('합산 제외'));
 const refs=costReferences(t,t.charges,p.charges,p.charges.length);assert.equal(refs.J,330);assert.equal(refs.M,330);
 const groups=[{name:'관급자재대',key:'government:관급자재대',amount:100},{name:'수수료',key:'fees:수수료',amount:100}];
 assert.equal(estTotalScope(rows.map(r=>r.Name==='총공사비'?{...r,Cost:221}:r),groups),null);
 assert.equal(estTotalScope([...rows,{Name:'중복',Gubun:'J',Cost:220}],groups),null);
});

test('source reverse profit is verified and bid changes restore original profit limit',()=>{
 const rows=[{Name:'직접노무비',Cost:1000},{Name:'간접재료비',Cost:0},{Name:'이윤',Gubun:'F',Cost:100,Youl:'10%',Biul:'15%',VSusic:'(B+C+E)*0.1'},{Name:'총원가',Gubun:'G',Cost:1100},{Name:'부가가치세',Gubun:'I',Cost:110,Youl:'10%',VSusic:'G*0.1'},{Name:'도급예정액',Gubun:'J',Cost:1210,VSusic:'(G+I)',Diget:1},{Name:'총공사비',Gubun:'M',Cost:1210,VSusic:'(J)'}];
 const p=projectFromEst(lib([head('공사',2),{...row('인력',10),GU:0,GC:0,NU:100,NC:1000}]),[{index:1,rows}]);
 assert.equal(p.estImport.verifiedAdjustments.length,1);assert.equal(totals(p.lines,p.charges).contract,1210);
 const discounted=withBidLines(p,p.lines.map(l=>l.level?l:{...l,bidPercent:95}));assert.equal(discounted.charges[0].base,'profitBase');assert.equal(discounted.charges[0].rate,15);assert.equal(totals(discounted.lines,discounted.charges).contract,1201);
});

test('thousand separator in source percentage is not interpreted as one percent',()=>{
 const rows=[{Name:'직접노무비',Cost:100},{Name:'간접재료비',Cost:0},{Name:'이윤',Gubun:'F',Cost:1264,Youl:'1,264.26%',VSusic:'B*12.6426'}];
 const p=projectFromEst(lib([head('공사',2),{...row('인력',1),GU:0,GC:0,NU:100,NC:100}]),[{index:1,rows}]);assert.equal(p.charges[0].rate,1264.26);assert.equal(p.charges[0].base,'profitBase');assert.equal(p.estImport.fixedCharges.length,0);
});


test('historical wage claim typo still calculates from total labor',()=>{
 const rows=[{Name:'직접노무비',Cost:10000},{Name:'간접재료비',Cost:0},{Name:'임금채권부다금',Gubun:'19',Cost:9,Youl:'0.09%',VSusic:'B*0.0009'}];
 const p=projectFromEst(lib([head('공사',2),{...row('인력',100),GU:0,GC:0,NU:100,NC:10000}]),[{index:1,rows}]);assert.equal(p.charges[0].key,'wageClaim');assert.equal(p.charges[0].base,'totalLabor');p.lines[1].qty=200;assert.equal(totals(p.lines,p.charges).charges[0].amount,18);
});
