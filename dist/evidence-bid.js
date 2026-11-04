import {calculateAssemblyDetailed,costKeys} from './estimate-core.js';
import {editableAssembly} from './est-edit.js';
import {collectEvidence,rateIdentity,resolveRateLibrary,validateProject} from './project-data.js';
import {manualCalculation} from './calculation-modes.js';
import {truncateProduct,amount} from './calc.js';
import {withBidLines} from './bid-core.js';

// Each estimate line owns its discounted snapshot. Shared library rows stay at 100%.
export function applyEvidenceBid(project,libraries,ids,percent,fixedKeys=[]){
 if(typeof percent!=='number'||!Number.isFinite(percent)||percent<0||percent>100)throw Error('낙찰률은 0~100%입니다.');
 const next=structuredClone(project),selected=new Set(ids),changes=[],skipped=[];
 const evidence=collectEvidence(project,libraries),restoredEvidence=[];
 for(const line of next.lines){
  if(!selected.has(line.id)||line.level||line.exclude)continue;
  if(line.generatedSupplyFee){skipped.push({name:line.name,reason:'신규급수 수수료는 낙찰 제외 · 종류별 1건 유지'});continue;}
  const original=line.rate?.evidenceBid?.original||line.rate;
  if(line.bucket==='government'||original?.government){skipped.push({name:line.name,reason:'관급자재 제외'});continue;}
  if(line.status!=='confirmed'||!original){skipped.push({name:line.name,reason:'단가 미확정'});continue;}
  if(manualCalculation(line)){skipped.push({name:line.name,reason:'직접 입력 금액 유지'});continue;}
  try{
   const previousBid=line.rate?.evidenceBid;
   let rate=structuredClone(percent===100?original:previousBid?.prepared||original);
   if(percent===100&&previousBid?.originalRows)restoredEvidence.push({rate,rows:structuredClone(previousBid.originalRows)});
   if(percent!==100){
    const lib=resolveRateLibrary(rate,libraries),saved=evidence.find(e=>rateIdentity(e.rate)===rateIdentity(rate));
    if(!rate.components&&['일위대가','단가산출'].includes(rate.category)){
     const prefix=rate.category==='일위대가'?'HeadMainDat:':'CostMainDat:';
     rate=editableAssembly(rate,saved?.rows?.length?saved.rows:lib?.details?.find(([k])=>k===prefix+rate.code)?.[1]||[],lib?.items||[]);
    }
    const audit={discounted:0,government:0,manual:0};
    function discount(value,depth=0){
     if(depth>30)throw Error('구성 단계가 너무 깊어 검토가 필요합니다.');
     const item=structuredClone(value.evidenceBid?.original||value);
     if(item.government||item.supply==='government'){audit.government++;return item;}
     if(manualCalculation(item)){audit.manual++;return item;}
     if(item.components){
      // Recalculate from children once; never multiply this subtotal a second time.
      item.components=item.components.map(p=>['percent','subtotal'].includes(p.kind)?structuredClone(p):discount(p,depth+1));
      Object.assign(item,calculateAssemblyDetailed(item.components,item.calculation||{}).result);
     }else{
      for(const k of costKeys)item[k]=truncateProduct(item[k]||0,percent,.01);
      item.total=costKeys.reduce((s,k)=>s+item[k],0);audit.discounted++;
     }
     return item;
    }
    const prepared=structuredClone(rate);
    rate=discount(rate);rate.evidenceBid={percent,method:'component-unit',original:structuredClone(original),prepared,originalRows:structuredClone(previousBid?.originalRows||saved?.rows||[]),...audit};
   }
   const before=amount(line)?.total;
   line.rate=rate;line.bidPercent=100;line.bidMethod='unit';
   changes.push({id:line.id,name:line.name,before,after:amount(line)?.total,percent,government:rate.evidenceBid?.government||0,manual:rate.evidenceBid?.manual||0});
  }catch(error){skipped.push({name:line.name,reason:error.message});}
 }
 const result=withBidLines(project,next.lines,fixedKeys);
 result.evidence=[...(result.evidence||[]),...restoredEvidence];
 result.evidence=collectEvidence(result,libraries);
 return {project:validateProject(result),changes,skipped};
}
