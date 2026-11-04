const compact=value=>String(value||'').replace(/\s+/g,'');
export function emergencySurchargeRule(name){
 const text=compact(name).replace(/^[\d.\-()]+/,'');
 if(/^토공|^포장/.test(text))return {name:'기타할증',percent:50};
 if(/^배관공/.test(text))return {name:'긴급보수할증',percent:30};
 return null;
}
// Older quantity imports can contain a plain, unlinked percent row. Recover its
// calculation within its own L1; never replace an established manual unit price.
export function restoreEmergencySurcharges(project,{force=false}={}){
 if(!force&&project.workType!=='emergency'&&!/긴급.*보수/.test(project.title||'')&&!project.lines.some(l=>l.level===2&&/긴급.*보수/.test(l.name)))return project;
 let rule=null,changed=false;
 const lines=project.lines.map(line=>{
  if(line.level){rule=line.level===1?emergencySurchargeRule(line.name):null;return line;}
  if(!rule||line.surcharge||line.deduction||line.rate||line.exclude||compact(line.name)!==rule.name||(line.bucket||'direct')!=='direct')return line;
  if(line.unit&&!['%','％'].includes(line.unit.trim()))return line;
  const percent=line.qty==null?rule.percent:line.qty;
  if(!Number.isFinite(percent)||percent<0||percent>1000)return line;
  changed=true;return {...line,unit:'%',qty:percent,factor:.01,bidPercent:100,status:'proposed',rate:null,surcharge:{scope:'group',basis:'labor',target:'labor',sourceIds:[],includeSurcharges:false}};
 });
 return changed?{...project,lines}:project;
}
