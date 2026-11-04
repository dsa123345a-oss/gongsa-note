import {resolveCostScopes,separateBucket} from './cost-scopes.js';
import {importEst} from './est.js';
import {readEstCostTables} from './est-project-data.js';
import {amount,totals,defaultCharges,appliedRate} from './calc.js';
import {validateProject,collectEvidence} from './project-data.js';
import {resolveLineAdjustments} from './line-adjustments.js';
import {estTotalScope} from './est-total-scope.js';
import {inspectEstSource} from './est-source-checks.js';

const keys=['labor','material','expense','other'];
const compact=s=>String(s||'').replace(/\s/g,'');
const same=(a,b)=>keys.every(k=>a?.[k]===b?.[k])&&a?.total===b?.total;
const sourceAmount=r=>{const a={labor:r.NC||0,material:r.GC||0,expense:r.JC||0};a.other=(r.TC||0)-a.labor-a.material-a.expense;a.total=r.TC||0;return a;};
const bucketFor=name=>separateBucket(name)||'direct';
const nameOf=r=>compact(r.Name);

export function projectFromEst(library,costTables=[]){
 const table=library.tables.find(t=>/^EstMainDat\.dat$/i.test(t.name));
 if(!table||table.error||!table.rows.some(r=>r.Level>0)&&!table.rows.some(r=>r.Code&&r.GN>0))throw Error('공사 내역이 없는 파일입니다. 단가 메인 파일은 DB 추가에서 열어주세요.');
 const report={file:library.name,version:library.version,warnings:[],fixedRows:[],fixedCharges:[],verifiedAdjustments:[],skipped:[],comparisons:[]};
 report.sourceIssues=inspectEstSource(table.rows);
 for(const issue of report.sourceIssues)report.warnings.push(`원본 ${issue.record+1}행 ${issue.name}: 저장 합계 ${issue.stored.TC.toLocaleString('ko-KR')}원과 하위 품목 합계 ${issue.calculated.TC.toLocaleString('ko-KR')}원이 다릅니다. 누락 금액을 임의로 추가하지 않았습니다.`);
 const project={schema:1,title:library.name.replace(/\.(estx|ebkx)$/i,''),location:'',quantityFile:library.name,lines:[],charges:[],ratesReviewed:false,mappings:{},estImport:report};
 let group='',bucket='direct',afterDirect=false;const records=new Map();
 for(const r of table.rows){
  if([54,58].includes(r.LinkIndex)){if(r.LinkIndex===54&&/순공사비/.test(compact(r.Name)))afterDirect=true;report.skipped.push({record:r._record,reason:'원가·합계 행: 품목 중복 합산 제외',name:r.Name});continue;}
  if(!r.Name?.trim()&&!r.Code&&!r.TC){report.skipped.push({record:r._record,reason:'빈 행'});continue;}
  if(r.Level>0){group=r.Name||'';bucket=bucketFor(compact(group));if(r.Level>=2&&!afterDirect)bucket='direct';}
  const l={id:'est:'+r._record,name:r.Name?.trim()||r.Code||'이름 없는 항목',spec:(r.Size||'').trim(),unit:(r.Unite||'').trim(),group,bucket:r.Gangub===2?'government':bucket,level:r.Level>0?r.Level:0,qty:r.GN??0,factor:1,status:'unmatched',rate:null,source:library.name+' · '+(r._record+1)+'행',estSource:{record:r._record,link:r.LinkIndex,amount:sourceAmount(r),bidPercent:r.NachalRatio}};
  if(r.Pr?.trim())l.sectionLabel=r.Pr.trim();
  if(l.level>1&&afterDirect&&bucket!=='direct'){l.costScope=bucket;l.separateTail=true;}
  if(l.level===1&&l.bucket!=='direct'&&afterDirect)l.separateTail=true;
  if(l.level){if(l.level>=2&&l.bucket==='direct')l.headingScope='direct';project.lines.push(l);continue;}
  if(!Number.isFinite(r.GN)||!Number.isFinite(r.TC)){
   l.qty=r.GN??null;report.warnings.push(`${r._record+1}행 ${l.name}: 수량 또는 금액이 없어 미확정으로 가져왔습니다.`);project.lines.push(l);continue;
  }
  if(l.qty<0)l.deduction={reason:'EST 원본 감액 수량'};
  const saved=library.items.find(i=>i.table==='EstMainDat'&&i.record===r._record);
  const rate=saved?structuredClone(saved):{id:library.id+':EstMainDat:'+r._record,library:library.id,table:'EstMainDat',record:r._record,source:library.name,code:r.Code||'',name:l.name,spec:l.spec,unit:l.unit,category:'내역단가',labor:r.NU||0,material:r.GU||0,expense:r.JU||0,other:(r.TU||0)-(r.NU||0)-(r.GU||0)-(r.JU||0),total:r.TU||0};
  l.rate=rate;l.status='confirmed';
  if(l.qty>=0&&rate.total<0&&keys.every(k=>rate[k]<=0)){
   l.qty=-l.qty;l.deduction={reason:'EST 원본 고재·감액 단가를 감액 수량으로 복원'};
   l.rate={...rate,...Object.fromEntries([...keys,'total'].map(k=>[k,-rate[k]]))};
   l.estSource.negativeUnitPrice={quantity:r.GN,unitPrice:rate.total};
   report.warnings.push(`${r._record+1}행 ${l.name}: 원본 음수 단가는 감액 수량 × 양수 단가로 복원했습니다.`);
  }
  if(r.LinkIndex===67&&l.unit==='%')l.factor=.01;
  if(!l.estSource.negativeUnitPrice&&r.LinkIndex!==67&&r.ApplyNacChal&&r.NachalRatio>0&&r.NachalRatio<100&&l.bucket!=='government'){
   const original={...rate,labor:r.ONU||0,material:r.OGU||0,expense:r.OJU||0,other:r.OSU||0,total:r.OTU||0};
   const candidate={...l,rate:original,bidPercent:r.NachalRatio,bidMethod:'unit'};
   if(same(appliedRate(candidate),rate))Object.assign(l,candidate);
   else report.warnings.push(`${r._record+1}행 ${l.name}: 낙찰 원단가를 검증할 수 없어 이미 적용된 단가를 유지합니다.`);
  }
  const expected=sourceAmount(r);
  if(r.LinkIndex===67&&[1,2,3].includes(r.OCheck)&&[1,2,3].includes(r.SCheck)){
   const target={1:'material',2:'labor',3:'expense'};
   const test={...l,surcharge:{scope:'group',basis:target[r.OCheck],target:target[r.SCheck]},factor:.01};
   const resolved=resolveLineAdjustments([...project.lines,test]).lines.at(-1);
   if(same(amount(resolved),expected))Object.assign(l,resolved);
   else {const inclusive=resolveLineAdjustments([...project.lines,{...test,surcharge:{...test.surcharge,includeSurcharges:true}}]).lines.at(-1);
    if(same(amount(inclusive),expected)){Object.assign(l,inclusive);report.warnings.push(`${r._record+1}행 ${l.name}: 원본처럼 앞선 할증을 포함한 기준금액에 다시 할증합니다.`);}
    else if(same(amount(l),expected))report.warnings.push(`${r._record+1}행 ${l.name}: 원본의 고정 기준금액 × 요율로 계산합니다. 연결할 선행 내역의 범위를 확정하지 못했습니다.`);
   }
  }
  if(!same(amount(l),expected)){
   // Keep a visible fixed amount when the original arithmetic is not proven.
   delete l.surcharge;l.calculationMode='horizontal';l.manualAmounts=expected;
   report.fixedRows.push({record:r._record,name:l.name,amount:expected.total});
  }
  project.lines.push(l);records.set(r._record,l);
 }
 if(!records.size)throw Error('열 수 있는 공사 품목이 없습니다. DB 추가에서 파일을 확인하세요.');
 project.lines=resolveCostScopes(project.lines);
 let preliminary=totals(project.lines,[]);
 // Some EST files retain a material's Gangub flag even though the saved
 // estimate and cost sheet both include it in direct costs. Only reconcile
 // that flag when every saved cost component AND the direct subtotal prove it.
 const directSource=table.rows.find(r=>r.LinkIndex===54&&/순공사비/.test(compact(r.Name)));
 const matchesComponents=(t,a)=>[['직접노무비','labor'],['산출경비','expense']].every(([n,k])=>t.rows.some(r=>nameOf(r)===n&&r.Cost===a[k]))&&t.rows.filter(r=>/^(간접|직접)재료비$/.test(nameOf(r))).reduce((s,r)=>s+(r.Cost||0),0)===a.material;
 if(directSource&&preliminary.direct!==directSource.TC&&!costTables.some(t=>matchesComponents(t,preliminary))){
  const implicit=project.lines.filter(l=>!l.level&&l.bucket==='government'&&!l.costScopeSource);
  const ids=new Set(implicit.map(l=>l.id));
  const alternative=project.lines.map(l=>ids.has(l.id)?{...l,bucket:'direct',rate:{...l.rate,government:false},estSource:{...l.estSource,governmentFlag:2,accounting:'saved-direct'}}:l);
  const checked=totals(alternative,[]);
  if(implicit.length&&checked.direct===directSource.TC&&costTables.filter(t=>matchesComponents(t,checked)).length===1){
   project.lines=alternative;preliminary=checked;
   report.warnings.push(`자재 관급 표식과 원본 계상이 다른 ${implicit.length}행은 원본 순공사비·원가계산서의 노무비·재료비·경비를 대조하여 직접공사비로 가져왔습니다.`);
  }
 }
 const candidates=costTables.filter(t=>!(preliminary.direct===0&&directSource?.TC)&&t.rows.some(r=>nameOf(r)==='직접노무비'&&r.Cost===preliminary.labor)&&t.rows.some(r=>/^(간접|직접)재료비$/.test(nameOf(r)))&&t.rows.filter(r=>/^(간접|직접)재료비$/.test(nameOf(r))).reduce((n,r)=>n+(r.Cost||0),0)===preliminary.material);
 const complete=candidates.filter(t=>!t.rows.some(r=>nameOf(r)==='산출경비')||t.rows.some(r=>nameOf(r)==='산출경비'&&r.Cost===preliminary.expense));
 let cost=complete.length===1?complete[0]:candidates.length===1?candidates[0]:null;
 if(cost&&!complete.includes(cost))report.warnings.push('원본 원가계산서의 산출경비와 내역 경비 합계가 다릅니다. 원본 제경비 금액을 보존하되 별도 비용의 중복 포함 여부를 확인해야 합니다.');
 if(!cost){report.warnings.push('현재 내역과 일치하는 원가계산서를 특정하지 못했습니다. 제경비는 0원이며 원가계산서를 확인해야 합니다.');}
 else{
  report.costTable=cost.index;report.originalCostRows=cost.rows;
  const defaults=defaultCharges(),aliases={건설기계대여금지급보증서발급액:'equipmentGuarantee',임금채권부다금:'wageClaim'};
  const chargeRows=cost.rows.filter(r=>Number(r.Gubun)>=5&&Number(r.Gubun)!==6||['일반관리비','이윤','부가가치세'].includes(nameOf(r)));
  for(const r of chargeRows){
   const template=defaults.find(c=>compact(c.name)===nameOf(r)||c.key===aliases[nameOf(r)]);
   const c={...(template||{key:'estCost'+r.Gubun,base:'fixed'}),name:nameOf(r),rate:Number.parseFloat(String(r.Youl||'').replace(/,/g,''))||0,estSource:{amount:r.Cost||0,formula:r.VSusic||'',code:r.Gubun}};
   if(c.rate<0||(r.Cost||0)<0){
    c.estSource.signedAdjustment=true;c.estSource.rate=c.rate;c.rate=0;c.base='fixed';c.fixed=r.Cost||0;
    report.fixedCharges.push({name:c.name,calculated:null,original:c.fixed,rate:c.estSource.rate,formula:r.VSusic||'',reason:'음수 원본 금액 · 원본 오류 여부 확인 필요'});
    report.warnings.push(`${c.name}: 원본의 음수 요율·금액을 고정값으로 보존했습니다. 정상 요율로 검증된 항목이 아니므로 원본을 확인하세요.`);
    project.charges.push(c);continue;
   }
   if(!r.VSusic?.trim()||!template){c.base='fixed';c.fixed=r.Cost||0;if(c.fixed)report.fixedCharges.push({name:c.name,calculated:null,original:c.fixed,rate:c.rate,formula:r.VSusic||'',reason:!template?'해석되지 않은 원가 항목':'원본 산식 없음'});}
   project.charges.push(c);
   const calculated=totals(project.lines,project.charges).charges.at(-1).amount;
   if(calculated!==(r.Cost||0)){
    c.base='fixed';c.fixed=r.Cost||0;
    report.fixedCharges.push({name:c.name,calculated,original:c.fixed,rate:c.rate,formula:r.VSusic||''});
   }
  }
  const beforeScope=totals(project.lines,project.charges),scope=estTotalScope(cost.rows,beforeScope.separateGroups);
  if(scope&&project.charges.length){const defaults={contractGroups:beforeScope.separateGroups.filter(g=>g.bucket==='waste').map(g=>g.key),grandGroups:beforeScope.separateGroups.filter(g=>g.bucket!=='waste').map(g=>g.key)};
   if(['contractGroups','grandGroups'].some(k=>JSON.stringify([...scope[k]].sort())!==JSON.stringify([...defaults[k]].sort()))){project.charges.at(-1).estTotalScope=scope;report.warnings.push('원본 원가계산서의 도급액·총공사비 합산 범위를 복원했습니다. 별도 공종의 금액이 존재해도 원본 합계에서 제외된 항목은 합산하지 않습니다.');}
  }
  const t=totals(project.lines,project.charges);
  const profitIndex=project.charges.findIndex(c=>c.key==='profit'),profitRow=cost.rows.find(r=>nameOf(r)==='이윤'),targetRow=cost.rows.find(r=>nameOf(r)==='도급예정액');
  if(profitIndex>=0&&profitRow&&targetRow?.Diget>0){
   const c=project.charges[profitIndex],limitRate=Number.parseFloat(String(profitRow.Biul||'').replace(/,/g,''));
   if(Number.isFinite(limitRate)&&limitRate>=0){
    const limit={...c,base:'profitBase',rate:limitRate};delete limit.fixed;delete limit.formula;delete limit.adjustment;
    const trial=project.charges.map((x,i)=>i===profitIndex?limit:x.key==='vat'?{...x,base:'contractBeforeVat',fixed:undefined}:x);
    const cap=totals(project.lines,trial).charges[profitIndex].amount;
    if((profitRow.Cost||0)<=cap){
     // Preserve the original limit for a later bid change; do not compound the
     // rounded display rate from the source's previous reverse calculation.
     c.base='fixed';c.fixed=profitRow.Cost||0;c.adjustment={original:limit,target:targetRow.Cost,actual:t.contract,difference:targetRow.Cost-t.contract};
     const value=x=>totals(project.lines,trial.map((a,i)=>i===profitIndex?{...a,base:'fixed',fixed:x}:a));
     let lo=0,hi=cap;while(lo<hi){const mid=Math.ceil((lo+hi)/2);if(value(mid).contract<=targetRow.Cost)lo=mid;else hi=mid-1;}
     const checked=value(lo),vat=project.charges.find(x=>x.key==='vat');
     if(!t.missing&&lo===c.fixed&&checked.contract===targetRow.Cost&&(!vat||checked.charges.find(x=>x.key==='vat')?.amount===vat.estSource.amount)){
      report.verifiedAdjustments.push({name:'이윤',target:targetRow.Cost,amount:lo,limitRate,digits:targetRow.Diget});
      report.fixedCharges=report.fixedCharges.filter(x=>x.name!==c.name);
     }
    }else report.warnings.push(`원본 이윤 ${profitRow.Cost.toLocaleString('ko-KR')}원이 원본 기본요율 ${limitRate}%의 계산 한도를 넘습니다. 원본 작업 상태를 확인하세요.`);
   }
  }
  for(const [name,key]of [['도급예정액','contract'],['총공사비','grand'],['관급자재대','government'],['폐기물처리비','waste'],['현장점검비','waste']]){
   const r=cost.rows.find(r=>nameOf(r)===name);if(r&&Number.isFinite(r.Cost)){const imported=key==='waste'?t.separateGroups.filter(g=>compact(g.name)===name).reduce((n,g)=>n+g.amount,0):t[key];report.comparisons.push({name,original:r.Cost,imported,difference:imported-r.Cost});}
  }
  for(const c of report.comparisons)if(c.difference)report.warnings.push(`${c.name}: 원본과 ${c.difference.toLocaleString('ko-KR')}원 차이. 원가 항목을 확인하세요.`);
 }
 if(!cost){
  const current=totals(project.lines,project.charges);
  for(const [name,key]of [['도급예정액','contract'],['총공사비','grand']]){
   const r=table.rows.find(r=>r.LinkIndex===58&&nameOf(r)===name);
   if(r&&Number.isFinite(r.TC)){report.comparisons.push({name,original:r.TC,imported:current[key],difference:current[key]-r.TC,source:'내역서 저장 합계'});if(current[key]!==r.TC)report.warnings.push(`${name}: 원가계산서를 확인하지 못해 원본 저장 합계 ${r.TC.toLocaleString('ko-KR')}원을 재현하지 못했습니다.`);}
  }
 }
 if(report.verifiedAdjustments.length)report.warnings.push('원본 도급액을 목표로 이윤 역산 결과를 재현했습니다. 가져온 시점의 자리맞춤 금액이며, 수량을 수정하면 자리맞춤을 다시 적용하세요. 낙찰률 변경 시 원본 기본 이윤율을 복원합니다.');
 if(report.fixedRows.length)report.warnings.push(`원본 계산 방식 확인이 필요한 ${report.fixedRows.length}개 품목은 저장된 금액을 고정해서 가져왔습니다. 수량 변경 시 직접 금액을 확인하세요.`);
 if(report.fixedCharges.length)report.warnings.push(`역산·절사 등으로 재계산값이 다른 ${report.fixedCharges.length}개 제경비는 원본 금액을 유지합니다. 요율을 적용하려면 원가계산서에서 변경하세요.`);
 const sourceTotal=table.rows.find(r=>r.LinkIndex===54&&/순공사비/.test(compact(r.Name)));
 if(sourceTotal){report.comparisons.unshift({name:'직접공사비',original:sourceTotal.TC,imported:preliminary.direct,difference:preliminary.direct-sourceTotal.TC});if(preliminary.direct!==sourceTotal.TC)report.warnings.push('직접공사비가 원본 합계와 다릅니다. 가져오기 결과를 확인하세요.');}
 report.itemCount=project.lines.filter(l=>!l.level).length;report.levelCount=project.lines.filter(l=>l.level).length;
 project.evidence=collectEvidence(project,[library]);
 return validateProject(project);
}

export async function importEstProject(input,filename,inflate){
 const library=await importEst(input,filename,inflate);let tables=[],costError='';
 try{tables=await readEstCostTables(input,inflate);}catch(e){costError=e.message;}
 const project=projectFromEst(library,tables);
 if(costError)project.estImport.warnings.unshift('원가계산서 읽기: '+costError);
 return {project,library};
}
