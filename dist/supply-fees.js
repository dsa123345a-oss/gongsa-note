import {resolveCostScopes} from './cost-scopes.js';
// User-confirmed local operating rule. This is not a statement that the
// ordinance itself defines a maximum-diameter or per-application rule.
export const supplyFeePolicyVersion='uljin-single-application-2026-11-03';
export const supplyFeeScope='single-application';
export const supplyFeeDiameterBasis='government-meter';
export const supplyFeeDefinitions=Object.freeze([
 {key:'design',name:'설계수수료'},
 {key:'materialInspection',name:'시공자재검사수수료'},
 {key:'completionInspection',name:'준공검사수수료'},
]);
const compact=value=>String(value??'').normalize('NFKC').toLowerCase().replace(/[\s\u200b-\u200d\ufeff]/g,'');
const keys=new Set(supplyFeeDefinitions.map(row=>row.key));
const validDiameter=value=>typeof value==='number'&&Number.isFinite(value)&&value>0&&value<=10000;
const supplied=value=>value!==null&&value!==undefined&&value!=='';
const isOwned=line=>line.generatedSupplyFee?.policyVersion===supplyFeePolicyVersion&&keys.has(line.generatedSupplyFee?.key);

export function supplyFeeSchedule(diameter){
 const d=Number(diameter);
 if(!supplied(diameter)||!validDiameter(d))throw Error('0보다 큰 관급 계량기 구경을 입력하세요.');
 const prices=d<=25?[6000,5000,6000]:d<=32?[7000,6000,7000]:d>=40?[8000,7000,8000]:null;
 if(!prices)throw Error('32mm 초과·40mm 미만 구경은 조례의 정액 구간에 없습니다. 적용 구경을 확인하세요.');
 return supplyFeeDefinitions.map((row,i)=>({...row,amount:prices[i],qty:1,unit:'건'}));
}

function kindOfFee(line){
 const name=compact(line.name);
 if(/원인자|분담금|부담금|조달|보증|계량기시험|정수/.test(name))return null;
 if(/설계수수료/.test(name))return 'design';
 if(/(?:시공)?자재검사수수료/.test(name))return 'materialInspection';
 if(/준공검사수수료/.test(name))return 'completionInspection';
 return name==='수수료'||name==='급수공사수수료'?'combined':null;
}

function simpleDiameter(spec){
 const text=compact(spec).replace(/[φø∅]/g,'d');
 // Composite fittings, ranges and protective-box heights are not pipe sizes.
 if(/\d(?:\.\d+)?(?:mm|su|a)?[×x*\/~∼～-](?:d|s)?\d/.test(text))return null;
 // Diameter notation takes precedence over unrelated grade or length numbers
 // such as "D40mm (2종)" and "D40 (6m)". Multiple marked sizes stay ambiguous.
 const matches=[...text.matchAll(/(?:^|[^a-z\d.])(?:(?:d|s)(\d+(?:\.\d+)?)(?:mm|su|a)?|(\d+(?:\.\d+)?)(?:mm|su|a))(?=$|[^a-z\d.])/g)];
 if(!matches.length&&/^\d+(?:\.\d+)?$/.test(text)){const value=Number(text);return validDiameter(value)?value:null;}
 if(matches.length!==1)return null;
 const value=Number(matches[0][1]??matches[0][2]);return validDiameter(value)?value:null;
}

function diameterCandidates(project){
 const candidates=[],unresolved=[];
 // Resolve L1/L2 inherited scopes exactly as the cost calculation does. A meter
 // installation in direct costs must not become a government-material meter.
 for(const line of resolveCostScopes(project.lines||[])){
  if(line.level||line.exclude||line.deduction||line.bucket!=='government')continue;
  const quantityUnknown=line.qty===null||line.qty===undefined||line.qty===''||!Number.isFinite(Number(line.qty));
  if(!quantityUnknown&&!(Number(line.qty)>0))continue;
  const name=compact(line.name);
  if(!/(?:수도미터|수도계량기|계량기)/.test(name)||/보호|뚜껑|함|검사|시험|소켓|니플|유니온|해체|폐기|밸브|접합|패킹|부속|부품|철물|받침|커버/.test(name))continue;
  const diameter=simpleDiameter(line.spec);
  const candidate={id:line.id,name:line.name,spec:line.spec,kind:'meter',source:line.sourceFile||line.source||''};
  if(quantityUnknown){unresolved.push({...candidate,reason:'계량기 수량 미계산'});continue;}
  if(diameter===null){unresolved.push(candidate);continue;}
  candidates.push({...candidate,diameter});
 }
 return {candidates,unresolved};
}

export function previewSupplyFees(project,options={}){
 const {candidates,unresolved}=diameterCandidates(project);
 const suggestedDiameter=candidates.length?Math.max(...candidates.map(row=>row.diameter)):null;
 const config=project.supplyFees;
 const legacyBasis=!!((config?.enabled&&config.diameterBasis!==supplyFeeDiameterBasis)||(project.lines||[]).some(line=>isOwned(line)&&line.generatedSupplyFee.diameterBasis!==supplyFeeDiameterBasis));
 const explicit=supplied(options.diameter),saved=!!(!options.infer&&!explicit&&config?.enabled&&config.diameterBasis===supplyFeeDiameterBasis&&supplied(config.diameter));
 const diameter=explicit?Number(options.diameter):saved?Number(config.diameter):suggestedDiameter;
 const diameterSource=explicit?'manual':saved?'saved':candidates.length?'meter':'missing';
 const basis=String(options.basis??(saved?config.basis:null)??(diameterSource==='meter'?'관급자재 계량기 중 최대 구경':'사용자 확인 관급 계량기 구경'));
 const existing=(project.lines||[]).filter(row=>!row.level&&(isOwned(row)||kindOfFee(row))).map(row=>({id:row.id,name:row.name,key:isOwned(row)?row.generatedSupplyFee.key:kindOfFee(row),generated:isOwned(row),source:'line'}));
 const chargeConflicts=(project.charges||[]).filter(row=>kindOfFee(row)).map(row=>({id:row.key,name:row.name,key:kindOfFee(row),generated:false,source:'charge'}));
 const conflicts=[...existing.filter(row=>!row.generated),...chargeConflicts];
 const warnings=[];let rows=[];
 if(!validDiameter(diameter))warnings.push('수수료를 적용할 관급 계량기 구경을 확인하세요. 급수관 구경으로 대신 계산하지 않습니다.');
 else try{rows=supplyFeeSchedule(diameter);}catch(error){warnings.push(error.message);}
 if(legacyBasis)warnings.push('기존 수수료는 급수관 기준으로 저장된 설정입니다. 관급 계량기 구경을 확인하여 다시 적용하세요. 적용 전까지 기존 금액은 유지됩니다.');
 const uncertainMaximum=unresolved.length>0&&!explicit&&!saved;
 if(uncertainMaximum)warnings.push('구경 또는 수량을 확인하지 못한 관급 계량기가 있어 최대 구경을 자동 확정하지 않습니다: '+unresolved.map(row=>`${row.name} (${row.spec||'규격 없음'}${row.reason?' · '+row.reason:''})`).join(', '));
 const sections=(project.lines||[]).filter(row=>row.level>=2&&!row.separateTail),sameApplication=sections.length<=1||explicit||saved;
 if(!sameApplication)warnings.push('여러 공구가 있습니다. 동일 신청·설계·검사 건인지 확인하고 적용 계량기 구경을 입력하세요.');
 if(conflicts.length)warnings.push('기존 수수료가 있어 자동 추가하지 않습니다. 기존 내역을 확인하세요.');
 const scoped=(project.charges||[]).some(charge=>charge.estTotalScope);
 if(scoped)warnings.push('EST 원본 합산 범위가 지정되어 있습니다. 원본 수수료와 합산 범위를 확인한 뒤 수정하세요.');
 const emergency=project.workType==='emergency'||/긴급\s*보수/.test(project.title||'');
 if(emergency)warnings.push('신규급수 수수료는 긴급보수 공사에 자동 적용하지 않습니다.');
 const diameterConfirmed=!!rows.length&&!uncertainMaximum&&!!sameApplication;
 const canApply=diameterConfirmed&&!scoped&&!emergency&&!chargeConflicts.length&&(!conflicts.length||options.replaceExisting===true);
 return {diameter,suggestedDiameter,diameterSource,diameterConfirmed,diameterBasis:supplyFeeDiameterBasis,legacyBasis,basis,candidates,unresolved,rows,total:rows.reduce((sum,row)=>sum+row.amount,0),existing,conflicts,warnings,canApply,blocked:!canApply,scope:supplyFeeScope,policyVersion:supplyFeePolicyVersion};
}

export function applySupplyFees(project,options={}){
 const report=previewSupplyFees(project,options);
 if(!report.canApply)return {project,report};
 const next=structuredClone(project),oldOwned=next.lines.filter(isOwned),remove=new Set(report.existing.filter(row=>row.generated||options.replaceExisting===true).map(row=>row.id));
 next.lines=next.lines.filter(line=>!remove.has(line.id));
 let heading=next.lines.find(line=>line.level===1&&compact(line.name)==='수수료'&&line.bucket==='fees'&&(line.costScope??'fees')==='fees'&&!line.separateSection&&line.separateTail);
 if(!heading){heading={id:crypto.randomUUID(),level:1,name:'수수료',group:'수수료',spec:'',unit:'',qty:0,factor:1,bucket:'fees',costScope:'fees',separateTail:true,status:'unmatched',rate:null,generatedSupplyFeeGroup:true};next.lines.push(heading);}
 heading.collapsed=false;
 let insertAt=next.lines.indexOf(heading)+1;while(insertAt<next.lines.length&&!next.lines[insertAt].level)insertAt++;
 const generated=report.rows.map(item=>{
  const previous=oldOwned.find(row=>row.generatedSupplyFee.key===item.key),spec=`관급 계량기 ${report.diameter}mm · 동일 신청·설계·검사 1건`;
  return {id:previous?.id||crypto.randomUUID(),name:item.name,group:'수수료',spec,unit:'건',qty:1,factor:1,bucket:'fees',status:'confirmed',bidPercent:100,bidMethod:'unit',source:'신규급수 수수료 · 사용자 확정 기준',
   generatedSupplyFee:{key:item.key,policyVersion:supplyFeePolicyVersion,scope:supplyFeeScope,diameter:report.diameter,diameterBasis:supplyFeeDiameterBasis},
   rate:{id:previous?.rate?.id||crypto.randomUUID(),manual:true,name:item.name,spec,unit:'건',code:'SUPPLY-FEE-'+item.key,source:'울진군 수도급수조례 제37조 · 부과 건수는 사용자 확정 기준',category:'내역단가',labor:0,material:0,expense:item.amount,other:0,total:item.amount}};
 });
 next.lines.splice(insertAt,0,...generated);
 next.supplyFees={enabled:true,diameter:report.diameter,scope:supplyFeeScope,basis:report.basis,policyVersion:supplyFeePolicyVersion,diameterBasis:supplyFeeDiameterBasis};
 return {project:next,report:{...report,blocked:false,applied:true,lineIds:generated.map(line=>line.id)}};
}

export function validateSupplyFees(project){
 const config=project.supplyFees,generated=(project.lines||[]).filter(line=>line.generatedSupplyFee);
 if(config!==undefined){
  if(!config||typeof config!=='object'||Array.isArray(config)||typeof config.enabled!=='boolean'||config.scope!==supplyFeeScope||config.policyVersion!==supplyFeePolicyVersion||typeof config.basis!=='string'||(config.enabled&&!validDiameter(config.diameter)))throw Error('신규급수 수수료 설정을 확인하세요.');
  if(config.diameterBasis!==undefined&&config.diameterBasis!==supplyFeeDiameterBasis)throw Error('신규급수 수수료는 관급 계량기 구경을 기준으로 설정하세요.');
  if(config.enabled)supplyFeeSchedule(config.diameter);
 }
 const seen=new Set();
 for(const line of generated){
  const meta=line.generatedSupplyFee;
  if(meta.diameterBasis!==undefined&&meta.diameterBasis!==supplyFeeDiameterBasis)throw Error('자동 수수료의 관급 계량기 기준을 확인하세요.');
  if(!isOwned(line)||meta.scope!==supplyFeeScope||!validDiameter(meta.diameter)||seen.has(meta.key)||line.level||line.qty!==1||line.factor!==1||line.bucket!=='fees'||line.unit!=='건')throw Error('자동 수수료는 종류별 1건이어야 합니다. 수수료 설정을 확인하세요.');
  seen.add(meta.key);
 }
 return project;
}
