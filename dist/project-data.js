import {amount,totals,defaultCharges,bidPercent,norm,unitNorm} from './calc.js';
import {validateCalculationMode,aggregateCalculation,manualCalculation} from './calculation-modes.js';
import {editableAssembly} from './est-edit.js';
import {calculateAssemblyDetailed,costKeys} from './estimate-core.js';
import {validateAdjustment} from './line-adjustments.js';
import {normalizeSectionTitles} from './project-labels.js';
import {reserveWorkConnectionJoints} from './work-connection-joints.js';
import {validateSupplyFees} from './supply-fees.js';
import {withEstMetadata,copyMissingEstMetadata} from './est-metadata.js';

export function validateProject(data){
 if(!data||data.schema!==1||!Array.isArray(data.lines)||!Array.isArray(data.charges)||data.lines.length>10000||data.charges.length>300)throw Error('지원하는 공사노트 작업 파일이 아닙니다.');
 const project=structuredClone(data),bases=new Set(['labor','totalLabor','laborMaterial','totalLaborMaterial','health','direct','net','profitBase','contractBeforeVat','government','fixed']);
 validateSupplyFees(project);
 reserveWorkConnectionJoints(project.lines.filter(l=>l?.workConnectionJoints!==undefined).map(l=>({label:l.sourceFile||l.name||'기존 내역',joints:l.workConnectionJoints})));
 const numeric=(n,label,{min=0,positive=false}={})=>{if(typeof n!=='number'||!Number.isFinite(n)||n<min||Math.abs(n)>1e14||(positive&&n===0))throw Error(label+'이 올바르지 않습니다.');};
 const ids=new Set(),chargeKeys=new Set();
 if(project.contractLimit!=null)numeric(project.contractLimit,'도급 한도');
 for(const l of project.lines){
  if(!l||typeof l!=='object')throw Error('내역 행을 확인하세요.');
  validateCalculationMode(l);
  validateAdjustment(l);
  if(l.costScope!==undefined&&!['direct','government','waste','fees'].includes(l.costScope))throw Error('공종의 원가 연결 구분을 확인하세요.');
  if(!l||!['direct','government','waste','fees'].includes(l.bucket))throw Error('계상 구분이 올바르지 않습니다.');
  for(const key of ['name','spec','unit','group'])if(typeof l[key]!=='string')throw Error('품명·규격·단위·공종을 확인하세요.');
  if(l.level!=null&&(!Number.isInteger(l.level)||l.level<0||l.level>9))throw Error('공종 레벨은 0부터 9까지입니다.');
  if(l.qty!=null)numeric(l.qty,'수량',{min:l.deduction?-1e14:0});
  if(l.bidPercent!=null){numeric(l.bidPercent,'낙찰률');if(l.bidPercent>100)throw Error('낙찰률은 100% 이하여야 합니다.');}
  if(l.bidMethod!=null&&!['unit','amount'].includes(l.bidMethod))throw Error('낙찰 계산 방식을 확인하세요.');
  numeric(l.factor??1,'환산계수',{positive:true});
  if(!['unmatched','proposed','confirmed'].includes(l.status))throw Error('단가 연결 상태가 올바르지 않습니다.');
  if(l.status==='confirmed'&&!l.rate)throw Error('확정한 단가가 없습니다.');
  if(l.rate?.evidenceBid){const b=l.rate.evidenceBid;numeric(b.percent,'근거 낙찰률');if(b.percent>100||!b.original)throw Error('근거 낙찰 원단가를 확인하세요.');for(const k of ['labor','material','expense','other','total'])numeric(b.original[k],'근거 낙찰 원단가',{min:k==='other'?-1e14:0});}
  if(l.rate){for(const key of ['labor','material','expense','other','total'])numeric(l.rate[key],'단가',{min:key==='other'?-1e14:0});}
  if(typeof l.id!=='string'||!/^[\w:.-]+$/.test(l.id)||ids.has(l.id))l.id=crypto.randomUUID();
  ids.add(l.id);if(!l.level)amount(l);
 }
 for(const c of project.charges){
  if(!c||!bases.has(c.base)||typeof c.name!=='string'||typeof c.key!=='string'||chargeKeys.has(c.key))throw Error('제경비 적용 기준이나 항목을 확인하세요.');
  if(c.formula!==undefined&&(typeof c.formula!=='string'||c.formula.length>1000))throw Error('산출근거 수식을 확인하세요.');
  const signedSource=c.base==='fixed'&&c.estSource?.signedAdjustment===true&&c.fixed===c.estSource.amount&&c.fixed<0;
  numeric(c.rate??0,'제경비 요율');numeric(c.fixed??0,'제경비 정액',{min:signedSource?-1e14:0});chargeKeys.add(c.key);
 }
 project.title=String(project.title||'');project.location=String(project.location||'');
 project.mappings=project.mappings&&typeof project.mappings==='object'&&!Array.isArray(project.mappings)?project.mappings:{};
 totals(project.lines,project.charges);return normalizeSectionTitles(project);
}

// A snapshot identity includes values: manual rates and past DB revisions must not collapse.
export function rateIdentity(rate){const identity=[rate.source,rate.code,rate.id,rate.name,rate.spec,rate.unit,rate.labor,rate.material,rate.expense,rate.other,rate.total,rate.components,rate.calculation];if(rate.evidenceBid)identity.push(rate.evidenceBid.percent,['labor','material','expense','other','total'].map(k=>rate.evidenceBid.original?.[k]));return JSON.stringify(identity);}
export function resolveRateLibrary(rate,libraries){
 const original=libraries.find(l=>l.id===rate.library);if(original)return original;
 // Browser-to-desktop migration creates new DB IDs. Match the file and full rate
 // snapshot before attaching its evidence; a matching code alone is insufficient.
 const keys=['code','name','spec','unit','category','table','record','labor','material','expense','other','total'];
 return libraries.find(l=>l.name===rate.source&&l.items?.some(i=>keys.every(k=>i[k]===rate[k])));
}
export function collectEvidence(project,libraries){
 const seen=new Set(),evidence=[],metadataIndexes=new WeakMap();
 const identities=new WeakMap(),identity=rate=>{if(!identities.has(rate))identities.set(rate,rateIdentity(rate));return identities.get(rate);};
 const savedByKey=new Map();for(const entry of project.evidence||[]){const key=identity(entry.rate);if(!savedByKey.has(key))savedByKey.set(key,entry);}
 const detailIndexes=new Map();
 const detail=(lib,key)=>{if(!lib)return [];if(!detailIndexes.has(lib)){const index=new Map();for(const [k,rows] of lib.details||[])if(!index.has(k))index.set(k,rows);detailIndexes.set(lib,index);}return detailIndexes.get(lib).get(key)||[];};
 const itemIndexes=new Map(),visited=new Set();
 const candidates=(lib,code)=>{if(!lib)return [];if(!itemIndexes.has(lib)){const index=new Map();for(const r of lib.items||[]){if(r.table==='EstMainDat')continue;const values=index.get(r.code)||[];values.push(r);index.set(r.code,values);}itemIndexes.set(lib,index);}return itemIndexes.get(lib).get(code)||[];};
 const same=(a,b)=>norm(a.name)===norm(b.name)&&norm(a.spec)===norm(b.spec)&&unitNorm(a.unit)===unitNorm(b.unit);
 const prefixOf=rate=>rate.machineInputs||rate.table==='MachTitleDat'?'MachMainDat':({일위대가:'HeadMainDat',단가산출:'CostMainDat',장비:'MachMainDat'}[rate.category]||({U:'HeadMainDat',D:'CostMainDat',E:'MachMainDat'}[rate.code?.[0]]));
 function visit(rate,parentLib=null,depth=0,top=false){
  if(depth>=30)return;
  const savedRate=savedByKey.get(identity(rate))?.rate;
  rate=copyMissingEstMetadata(withEstMetadata(rate,libraries,metadataIndexes),savedRate);
  for(const k of ['category','table'])if(rate[k]==null&&savedRate?.[k]!=null)rate={...rate,[k]:savedRate[k]};
  const key=identity(rate),walkKey=JSON.stringify([key,rate.library,rate.sourceComponent]);if(visited.has(walkKey))return;visited.add(walkKey);
  if(visited.size>10000)throw Error('단가 근거가 너무 많습니다. 공사를 나누어 저장하세요.');
  const lib=resolveRateLibrary(rate,libraries)||(rate.resourcePricing?.original?resolveRateLibrary(rate.resourcePricing.original,libraries):null)||parentLib,saved=savedByKey.get(key),prefix=prefixOf(rate),rows=saved?.rows?.length?saved.rows:detail(lib,prefix+':'+rate.code);
  if(!seen.has(key)&&(top||rows.length||['bigo','remark','quotePages'].some(k=>Object.hasOwn(rate,k)))){seen.add(key);evidence.push({rate,rows});}
  // Save only dependencies actually used by this assembly. Resource price
  // snapshots already live in components; copying the entire DB would bloat
  // every save and could replace a historical source with a new monthly DB.
  let editable=rate;if(!rate.components&&prefix&&rows.length){try{editable=editableAssembly(rate,rows,lib?.items||[]);}catch{return;}}
  if(!editable.components?.length)return;
  let calc;try{calc=calculateAssemblyDetailed(editable.components,editable.calculation||{});}catch{/* Keep explicit used parts even when a custom formula needs review. */}
  for(const [i,part] of editable.components.entries()){
   if(part.kind||part.machineOwnership||!aggregateCalculation(part))continue;
   if(!manualCalculation(part)&&Number(calc?.rows[i]?.qty??part.qty)===0)continue;
   if(rate.sourceComponent&&calc?.rows[i]?.amount&&!calc.rows[i].amount[rate.sourceComponent])continue;
   const matches=candidates(lib,part.code),original=matches.find(r=>same(r,part))||(matches.length===1&&norm(part.name)==='주연료'?matches[0]:null);
   const child={...(original?{category:original.category,table:original.table}:{}),...part,source:part.priceReference?.source||part.source||rate.source,library:part.library||rate.library,total:costKeys.reduce((n,k)=>n+Number(part[k]||0),0)};
   if(!child.components&&!prefixOf(child)&&!['자재','노임'].includes(child.category)&&!/^L|^M/.test(child.code||''))continue;
   visit(child,lib,depth+1);
  }
 }
 for(const line of project.lines){
  const rate=line.rate;if(!rate||line.exclude||line.level||line.status!=='confirmed')continue;
  visit(rate,null,0,true);
 }return evidence;
}
