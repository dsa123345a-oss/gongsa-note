import {addSurcharge} from './line-adjustments.js';
import {emergencySurchargeRule,restoreEmergencySurcharges} from './emergency-rules.js';
export {emergencySurchargeRule} from './emergency-rules.js';

const compact=value=>String(value||'').replace(/\s+/g,'');
// L1 headings delimit each basis. Existing adjustments, including deliberately
// edited percentages, are retained rather than duplicated or reset.
export function applyEmergencySurcharges(project){
 let next=structuredClone(restoreEmergencySurcharges(project,{force:true})),added=0,kept=0;
 const groups=[];let section=null;
 for(const line of next.lines){if(line.level>=2)section=line.level===2?line:null;if(section&&line.level===1&&emergencySurchargeRule(line.name))groups.push(line.id);}
 for(const id of groups){
  const start=next.lines.findIndex(l=>l.id===id),rule=emergencySurchargeRule(next.lines[start].name);
  let end=start+1;while(end<next.lines.length&&!next.lines[end].level)end++;
  const rows=next.lines.slice(start+1,end);
  if(rows.some(l=>compact(l.name)===rule.name||l.surcharge?.basis==='labor'&&l.surcharge?.scope==='group'&&l.surcharge?.target==='labor')){kept++;continue;}
  if(!rows.some(l=>!l.surcharge&&!l.exclude&&(l.bucket||'direct')==='direct'))continue;
  next=addSurcharge(next,id,{...rule,scope:'group',basis:'labor',target:'labor',includeSurcharges:false});added++;
 }
 return {project:next,added,kept};
}
