import {totals} from './calc.js';
import {originalProfitCharge} from './profit-adjustment.js';
export const bidFixedCharges={health:'건강보험료',pension:'연금보험료',longTermCare:'노인장기요양보험료',retirement:'퇴직공제부금비',safety:'산업안전보건관리비'};
// Preserve the first undiscounted charge snapshot when changing a bid repeatedly.
export function withBidLines(project,lines,fixedKeys=[]){
 const next=structuredClone(project),before=totals(project.lines.map(l=>({...l,rate:l.rate?.evidenceBid?.original||l.rate,bidPercent:100})),project.charges.map(c=>c.bidOriginal||c));
 next.lines=structuredClone(lines);
 const discounted=lines.some(l=>!l.level&&!l.exclude&&l.bucket!=='government'&&!l.rate?.government&&((l.bidPercent??100)!==100||(l.rate?.evidenceBid?.percent??100)!==100));
 const keys=new Set(fixedKeys);
 const bidChanged=lines.some(l=>{const old=project.lines.find(x=>x.id===l.id);return old&&((l.bidPercent??100)!==(old.bidPercent??100)||(l.bidMethod??'unit')!==(old.bidMethod??'unit')||JSON.stringify(l.rate?.evidenceBid)!==JSON.stringify(old.rate?.evidenceBid));});
 next.charges=next.charges.map(c=>{
  if(bidChanged&&c.key==='profit'&&(c.adjustment||c.link?.type==='target'))return originalProfitCharge(c);
  if(discounted&&keys.has(c.key)){
   if(c.bidOriginal)return c;
   return {...c,link:undefined,formula:undefined,base:'fixed',fixed:before.charges.find(x=>x.key===c.key).amount,bidOriginal:structuredClone(c)};
  }
  return c.bidOriginal?structuredClone(c.bidOriginal):c;
 });
 next.ratesReviewed=false;return next;
}
