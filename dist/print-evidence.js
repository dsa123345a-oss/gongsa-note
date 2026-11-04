import {collectPriceEvidence} from './price-evidence.js';
import {unitNorm} from './calc.js';
const keys=['labor','material','expense','other'];
const textKey=s=>String(s??'').normalize('NFKC').toLowerCase().replace(/[\s\u200b-\u200d\ufeff]/g,'');
const category=n=>n.kind==='일위대가'&&/^D/.test(n.rate.code||'')?'단가산출':n.kind;
// Output-only canonicalization. Never change the rates used by the estimate.
export function collectPrintEvidence(project,libraries=[]){
 const graph=collectPriceEvidence(project,libraries),queue=[...graph.nodes],visited=new Map();
 for(let at=0;at<queue.length;at++){
  const node=queue[at];
  // Resolved components are the applied snapshot. Following raw DB codes again
  // would add the obsolete DB prices alongside updated labor/fuel snapshots.
  if(node.parts?.length||node.machine)continue;
  const lib=libraries.find(l=>l.id===node.rate.library)||libraries.find(l=>l.name===node.rate.source);if(!lib)continue;
  for(const row of node.raw){
   if(!row.Code||row.TitleCode)continue;
   const key=lib.id+':'+row.Code;
   if(visited.has(key)){for(const child of visited.get(key))child.uses.add(node.rate.name);continue;}
   const matches=lib.items.filter(i=>i.code===row.Code&&i.table!=='EstMainDat');if(matches.length!==1)continue;
   const sub=collectPriceEvidence({lines:[{id:'print-reference',name:node.rate.name,status:'confirmed',rate:matches[0]}],evidence:project.evidence},libraries);
   visited.set(key,sub.nodes);
   for(const child of sub.nodes)child.uses.add(node.rate.name);
   queue.push(...sub.nodes);
  }
 }
 const distinct=new Map();
 for(const node of queue){
  const kind=category(node),resource=['노임','자재'].includes(kind),machine=kind==='장비'&&node.calc&&node.verified;
  let r=node.rate;const ref=r.priceReference;
  // Fuel often appears as "주연료 / 경유" in a recipe. The applied reference
  // identifies the same resource as "경유" in the material table. Only use it
  // when the units and all applied prices agree; never replace a manual price.
  if(resource&&ref&&unitNorm(r.unit)===unitNorm(ref.unit)&&keys.every(k=>Number(r[k]||0)===Number(ref[k]||0)))r={...r,...Object.fromEntries(['name','spec','unit','code','source','library','prices','quotePages'].map(k=>[k,ref[k]]))};
  if(kind==='노임')r={...r,name:String(r.name||'').replace(/[\s\u200b-\u200d\ufeff]/g,'')};
  const identity=[kind,textKey(r.name),textKey(r.spec),unitNorm(r.unit)];
  if(resource)identity.push(...keys.map(k=>r[k]||0));
  else if(machine)identity.push(r.source,r.code,node.calc.result,node.parts,node.calculation);
  else identity.push(r.source,r.code,...keys.map(k=>r[k]||0),r.components,r.calculation,r.sourceComponent);
  const key=JSON.stringify(identity);let existing=distinct.get(key);
  if(!existing){
   existing={...node,rate:{...r},uses:new Set(node.uses),issues:[...node.issues],printComponents:machine?[]:null};distinct.set(key,existing);
  }else for(const usage of node.uses)existing.uses.add(usage);
  if(machine){
   const used=r.sourceComponent?[r.sourceComponent]:keys;
   existing.printComponents=[...new Set([...existing.printComponents,...used])];
   for(const k of keys)existing.rate[k]=existing.printComponents.includes(k)?node.calc.result[k]:0;
   existing.rate.total=keys.reduce((sum,k)=>sum+existing.rate[k],0);
   delete existing.rate.sourceComponent;
  }
 }
 const nodes=[...distinct.values()],variants=new Map();
 for(const n of nodes){const k=JSON.stringify([category(n),textKey(n.rate.name),textKey(n.rate.spec),unitNorm(n.rate.unit)]);if(!variants.has(k))variants.set(k,[]);variants.get(k).push(n);}
 for(const group of variants.values())if(group.length>1)for(const n of group){const uses=[...new Set([...n.uses].map(u=>u.replace(/^P\d+\s+|^\s*\/\s*/g,'').replace(/\s*\[[^\]]*\]$/,'')))];n.printUsage=uses.slice(0,2).join(', ')+(uses.length>2?' 외 '+(uses.length-2)+'곳':'');}
 return {...graph,nodes};
}
