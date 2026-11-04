import test from 'node:test';
import assert from 'node:assert/strict';
import {previewSupplyFees,applySupplyFees,supplyFeeSchedule,validateSupplyFees,supplyFeePolicyVersion,supplyFeeDiameterBasis} from '../dist/supply-fees.js';
import {totals,synchronizeLinkedCosts} from '../dist/calc.js';
import {validateProject} from '../dist/project-data.js';
import {costSheet} from '../dist/cost-sheet.js';
import {applyEvidenceBid} from '../dist/evidence-bid.js';

const item=(name,spec,qty=1,extra={})=>({id:crypto.randomUUID(),name,spec,qty,unit:'개',group:'자재대',bucket:'direct',factor:1,status:'confirmed',rate:{labor:100,material:200,expense:0,other:0,total:300},...extra});
const meter=(spec,qty=1,extra={})=>item('수도미터',spec,qty,{bucket:'government',group:'관급자재대',...extra});
const project=(lines=[])=>({schema:1,title:'상수도 신규 급수공사',location:'',lines,charges:[{key:'management',name:'일반관리비',base:'direct',rate:8},{key:'vat',name:'부가가치세',base:'contractBeforeVat',rate:10}]});
const feeLines=p=>p.lines.filter(line=>line.generatedSupplyFee);

test('수수료 세 종류를 구경별로 각각 1건 산정한다',()=>{
 for(const [diameter,values] of [[13,[6000,5000,6000]],[15,[6000,5000,6000]],[25,[6000,5000,6000]],[26,[7000,6000,7000]],[32,[7000,6000,7000]],[40,[8000,7000,8000]],[200,[8000,7000,8000]]]){
  const rows=supplyFeeSchedule(diameter);assert.deepEqual(rows.map(row=>row.amount),values);assert.ok(rows.every(row=>row.qty===1&&row.unit==='건'));
 }
 for(const diameter of [null,'',0,-1,NaN,Infinity,10001,35])assert.throws(()=>supplyFeeSchedule(diameter));
});

test('계량기 두 개 또는 여섯 개여도 최대 관급 계량기 구경만으로 3종 각 1건 적용',()=>{
 for(const qty of [2,6]){
  const p=project([item('PE 직관','D20mm',8),item('PE관 접합 및 부설','D80',2),item('수도미터','D15',qty,{bucket:'government'}),item('수도미터','D32',1,{bucket:'government'})]);
  const before=structuredClone(p),result=applySupplyFees(p),rows=feeLines(result.project);
  assert.equal(result.report.diameter,32);assert.equal(result.report.total,20000);assert.equal(rows.length,3);assert.ok(rows.every(row=>row.qty===1));assert.deepEqual(p,before);
 }
});

test('관급 계량기 표기의 D·SU·A·mm 공백 차이를 인식한다',()=>{
 for(const spec of ['D20','D20mm','D20SU','20SU','S20SU','20A','D20A','Φ 20 ㎜']){
  const report=previewSupplyFees(project([meter(spec,6)]));assert.equal(report.diameter,20,spec);assert.equal(report.canApply,true,spec);assert.equal(report.diameterSource,'meter');
 }
});

test('관급 계량기의 기타 숫자는 구경과 구분하고 미해석 계량기로 최대 구경을 낮추지 않는다',()=>{
 for(const spec of ['D40mm(2종)','D40(6m)','40mm (2종)']){
  const report=previewSupplyFees(project([meter('D20',10),meter(spec,6)]));
  assert.equal(report.diameter,40,spec);assert.equal(report.total,23000,spec);assert.equal(report.canApply,true,spec);
 }
 for(const spec of ['', '규격 확인 중', 'D32~50', 'D40, D50']){
  const p=project([meter('D20',10),meter(spec,6)]),report=previewSupplyFees(p);
  assert.equal(report.canApply,false,spec);assert.equal(report.diameterConfirmed,false,spec);assert.equal(report.unresolved.length,1,spec);
  assert.equal(applySupplyFees(p).project,p);
  assert.equal(applySupplyFees(p,{diameter:50,basis:'승인 관급 계량기 최대 구경 확인'}).report.blocked,false);
 }
});

test('큰 급수관·새들 본관·보호통·밸브는 관급 계량기 최대 구경에 섞지 않는다',()=>{
 const p=project([meter('D20',2),item('PE 직관','D100mm',10),item('새들분수전','D200×20'),item('부단수할정자관','D300×50'),item('PE청동밸브소켓','D20×15'),item('계량기보호통','D15×H800',1,{bucket:'government'}),item('제수밸브','D100'),item('배수관','D500'),item('PE 직관','D400',4,{group:'본관 공사'}),item('PE 직관','본관 D300',3),item('수도미터함','D100',1,{bucket:'government'}),item('계량기 검사','D100',1,{bucket:'government'})]);
 const report=previewSupplyFees(p);assert.equal(report.diameter,20);assert.equal(report.candidates.length,1);assert.equal(report.total,17000);
 for(const rows of [[item('PE 직관','D40')],[item('수도미터','D40')],[item('수도미터','D40',1,{bucket:'waste'})],[meter('D20×15')]]){
  const composite=previewSupplyFees(project(rows));assert.equal(composite.diameter,null);assert.equal(composite.canApply,false);assert.equal(composite.diameterConfirmed,false);
 }
});

test('제외·0수량·폐기물 행은 후보에서 빠지고 관급 계량기만 있으면 자동 적용한다',()=>{
 const p=project([meter('D100',1,{exclude:true}),meter('D80',0),meter('D65',1,{bucket:'waste'}),meter('D20',2,{name:'수도미터(건식)'})]);
 const preview=previewSupplyFees(p);assert.equal(preview.suggestedDiameter,20);assert.equal(preview.diameterSource,'meter');assert.equal(preview.canApply,true);
 const applied=applySupplyFees(p);assert.equal(applied.report.blocked,false);assert.equal(applied.report.total,17000);
});

test('관급 L1 범위를 상속하고 계량기 설치 재료행은 단위 개·조와 무관하게 읽는다',()=>{
 for(const unit of ['개','조']){
  const rows=[{id:'gov',level:1,name:'6. 관급자재대',costScope:'government'},item('계량기 설치','D32mm',2,{unit}),{id:'direct',level:1,name:'배관공',costScope:'direct'},item('수도미터','D80',1,{unit:'개소'})];
  const result=previewSupplyFees(project(rows));assert.equal(result.diameter,32);assert.equal(result.candidates.length,1);assert.equal(result.canApply,true);
 }
});

test('수수료 재적용은 행과 ID를 유지하고 구경 변경 시 세 단가만 갱신한다',()=>{
 const p=project([item('PE 직관','D20',10),meter('D20')]),first=applySupplyFees(p).project,second=applySupplyFees(first).project;
 assert.deepEqual(second,first);
 const changed=applySupplyFees(second,{diameter:40,basis:'승인 구경 변경'}).project;
 assert.deepEqual(feeLines(changed).map(row=>row.id),feeLines(first).map(row=>row.id));assert.equal(changed.lines.filter(row=>row.level===1).length,1);
 assert.deepEqual(feeLines(changed).map(row=>row.rate.total),[8000,7000,8000]);assert.equal(changed.supplyFees.diameter,40);
});

test('저장한 적용 구경은 유지하고 새 수량 검토에서는 infer로 다시 추론한다',()=>{
 const p=applySupplyFees(project([item('PE 직관','D20',10),meter('D20')]),{diameter:32,basis:'승인 도면 확인'}).project;
 assert.equal(previewSupplyFees(p).diameter,32);assert.equal(previewSupplyFees(p,{infer:true}).diameter,20);
});

test('직접공사비·제경비·부가세·원인자부담금은 그대로이며 수수료만 총공사비에 합산한다',()=>{
 const burden=item('원인자부담금','D20',2,{bucket:'fees',group:'원인자부담금',rate:{labor:0,material:0,expense:164000,other:0,total:164000}}),p=project([item('PE 직관','D20',10),meter('D20'),burden]);
 const before=totals(p.lines,p.charges),next=synchronizeLinkedCosts(applySupplyFees(p).project),after=totals(next.lines,next.charges);
 for(const key of ['direct','labor','material','expense','contract'])assert.equal(after[key],before[key],key);
 assert.deepEqual(after.charges,before.charges);assert.equal(after.fees-before.fees,17000);assert.equal(after.grand-before.grand,17000);assert.deepEqual(next.lines.find(row=>row.id===burden.id),burden);
 const rows=costSheet(next).rows;assert.equal(rows.find(row=>row.name==='수수료').amount,17000);assert.equal(rows.find(row=>row.name==='원인자부담금').amount,328000);
});

test('이름이 수수료여도 다른 계상 범위인 기존 제목은 재사용하거나 변경하지 않는다',()=>{
 const heading={id:'old-heading',name:'수수료',group:'수수료',spec:'',unit:'',level:1,qty:0,bucket:'waste',costScope:'waste',separateTail:true,status:'unmatched',rate:null};
 const old=item('현장점검비','',1,{bucket:'waste',group:'수수료',rate:{labor:0,material:0,expense:1000,other:0,total:1000}});
 const p=project([heading,old]),before=structuredClone(p),next=applySupplyFees(p,{diameter:20}).project,t=totals(next.lines,next.charges);
 assert.equal(next.lines.filter(row=>row.level===1).length,2);assert.deepEqual(next.lines.find(row=>row.id===heading.id),heading);assert.deepEqual(p,before);
 assert.equal(t.fees,17000);assert.equal(t.waste,1000);assert.equal(t.charges.find(row=>row.key==='vat').amount,100);assert.equal(t.grand,18100);
});

test('기존 수동·EST 수수료는 자동으로 변경하거나 중복 생성하지 않는다',()=>{
 const p=project([meter('D20'),item('설 계 수 수 료','Φ25mm까지',2,{bucket:'fees',group:'수수료',estSource:{record:1}}),item('시공자재 검사수수료','Φ25mm까지',2,{bucket:'fees',group:'수수료'}),item('준공검사 수수료','Φ25mm까지',2,{bucket:'fees',group:'수수료'})]);
 const before=structuredClone(p),report=previewSupplyFees(p),result=applySupplyFees(p);
 assert.equal(report.conflicts.length,3);assert.equal(report.canApply,false);assert.equal(result.report.blocked,true);assert.equal(result.project,p);assert.deepEqual(p,before);
 const replaced=applySupplyFees(p,{diameter:20,replaceExisting:true}).project;assert.equal(replaced.lines.filter(row=>!row.level&&/수\s*수\s*료/.test(row.name)).length,3);assert.ok(feeLines(replaced).every(row=>row.qty===1));assert.equal(p.lines.length,4);
});

test('한 줄 수수료 합계도 충돌로 잡되 조달·원인자부담금은 교체하지 않는다',()=>{
 const p=project([meter('D20'),item('수수료','',1,{bucket:'fees'}),item('조달수수료','',1,{bucket:'fees'}),item('원인자부담금','',1,{bucket:'fees'})]);
 assert.equal(previewSupplyFees(p).conflicts.length,1);
 const next=applySupplyFees(p,{diameter:20,replaceExisting:true}).project;
 assert.ok(next.lines.some(row=>row.id===p.lines[2].id));assert.ok(next.lines.some(row=>row.id===p.lines[3].id));assert.equal(feeLines(next).length,3);
});

test('EST 지정 합산 범위나 원가계산서 기존 수수료가 있으면 일괄 교체하지 않는다',()=>{
 for(const charge of [{key:'grand',name:'총공사비',base:'fixed',fixed:0,estTotalScope:{contractGroups:[],grandGroups:[]}},{key:'design',name:'설계수수료',base:'fixed',fixed:6000}]){
  const p=project([item('PE 직관','D20',10),meter('D20')]);p.charges.push(charge);
  const result=applySupplyFees(p,{diameter:20,replaceExisting:true});assert.equal(result.report.blocked,true);assert.equal(result.project,p);
 }
});

test('긴급보수에는 적용하지 않고 복수 공구는 같은 신청인지 명시 확인이 필요하다',()=>{
 for(const extra of [{workType:'emergency'},{title:'상수도 긴급 보수공사'}])assert.equal(applySupplyFees({...project([item('PE 직관','D20',10),meter('D20')]),...extra},{diameter:20}).report.blocked,true);
 const p=project([{...item('1공구','',0),level:2},{...item('2공구','',0),level:2},meter('D20')]);
 assert.equal(previewSupplyFees(p).canApply,false);assert.equal(applySupplyFees(p,{diameter:20,basis:'동일 신청·설계·검사 확인'}).report.blocked,false);
});

test('수수료 설정과 생성 근거는 저장·열기 검증 후 보존된다',()=>{
 const p=applySupplyFees(project([item('PE 직관','D20',10),meter('D20')])).project;
 const saved=JSON.parse(JSON.stringify(p)),loaded=validateProject(saved);validateSupplyFees(loaded);
 assert.deepEqual(loaded.supplyFees,p.supplyFees);assert.deepEqual(feeLines(loaded),feeLines(p));assert.equal(loaded.supplyFees.policyVersion,supplyFeePolicyVersion);assert.equal(loaded.supplyFees.diameterBasis,supplyFeeDiameterBasis);assert.ok(feeLines(loaded).every(row=>row.generatedSupplyFee.diameterBasis===supplyFeeDiameterBasis));
 for(const edit of [q=>q.supplyFees.diameter=0,q=>q.supplyFees.scope='per-meter',q=>q.lines.find(line=>line.generatedSupplyFee).qty=2,q=>q.lines.push({...feeLines(q)[0],id:crypto.randomUUID()})]){
  const bad=structuredClone(p);edit(bad);assert.throws(()=>validateSupplyFees(bad));
 }
});

test('근거자료 낙찰로 원단가를 바꾸어도 자동 수수료 3종은 100%로 유지한다',()=>{
 const p=applySupplyFees(project([item('PE 직관','D20',10),meter('D20')])).project;
 const ids=p.lines.filter(line=>!line.level).map(line=>line.id),result=applyEvidenceBid(p,[],ids,95);
 assert.equal(totals(result.project.lines,result.project.charges).fees,17000);
 assert.deepEqual(feeLines(result.project),feeLines(p));
 assert.equal(result.changes.length,1);assert.equal(result.skipped.length,4);
 assert.equal(result.project.lines.find(line=>line.id===p.lines[0].id).rate.total,285);
});


test('급수관 기준 구버전 파일은 읽되 저장 구경은 무시하고 재적용 전 금액을 보존한다',()=>{
 const p=applySupplyFees(project([item('PE 직관','D80',10),meter('D20')]),{diameter:80}).project;
 delete p.supplyFees.diameterBasis;
 for(const row of feeLines(p)){delete row.generatedSupplyFee.diameterBasis;row.spec='급수관 80mm · 동일 신청·설계·검사 1건';}
 const original=structuredClone(p),loaded=validateProject(JSON.parse(JSON.stringify(p))),preview=previewSupplyFees(loaded);
 assert.equal(preview.legacyBasis,true);assert.equal(preview.diameter,20);assert.equal(preview.diameterSource,'meter');assert.equal(preview.canApply,true);
 assert.equal(totals(loaded.lines,loaded.charges).fees,23000);assert.equal(totals(p.lines,p.charges).fees,23000);assert.deepEqual(p,original);
 const updated=applySupplyFees(loaded).project;
 assert.equal(totals(updated.lines,updated.charges).fees,17000);assert.equal(feeLines(updated).length,3);assert.deepEqual(feeLines(updated).map(row=>row.id),feeLines(p).map(row=>row.id));assert.equal(previewSupplyFees(updated).legacyBasis,false);
 const noConfig=structuredClone(p);delete noConfig.supplyFees;
 assert.equal(previewSupplyFees(noConfig).legacyBasis,true);
 const noMeter=structuredClone(p);noMeter.lines=noMeter.lines.filter(row=>row.bucket!=='government');
 assert.equal(previewSupplyFees(noMeter).diameter,null);assert.equal(previewSupplyFees(noMeter).canApply,false);assert.equal(applySupplyFees(noMeter).project,noMeter);
});

test('기존 수수료 충돌은 계량기 최대구경 확인 여부와 별도로 알린다',()=>{
 const p=project([meter('D32'),item('설계수수료','',1,{bucket:'fees'})]),report=previewSupplyFees(p);
 assert.equal(report.diameter,32);assert.equal(report.diameterConfirmed,true);assert.equal(report.canApply,false);
});

test('큰 계량기 수량이 미계산이면 작은 계량기만으로 최대구경을 자동 확정하지 않는다',()=>{
 for(const qty of [null,undefined,NaN,'']){
  const uncertain=meter('D50');uncertain.qty=qty;
  const p=project([meter('D20'),uncertain]),report=previewSupplyFees(p);
  assert.equal(report.canApply,false);assert.equal(report.diameterConfirmed,false);assert.equal(report.unresolved.length,1);assert.equal(report.unresolved[0].reason,'계량기 수량 미계산');assert.equal(applySupplyFees(p).project,p);
 }
});
