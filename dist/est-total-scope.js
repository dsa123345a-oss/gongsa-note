const compact=s=>String(s||'').replace(/\s/g,'');
// Restore only additive total formulas whose source rows and amounts reconcile.
export function estTotalScope(rows,groups){
 const byName=name=>rows.find(r=>compact(r.Name)===name),contract=byName('도급예정액'),grand=byName('총공사비'),gross=byName('총원가'),vat=byName('부가가치세');
 if(!contract||!grand||!gross||!vat)return null;
 const byCode=new Map();for(const r of rows){const key=String(r.Gubun);if(byCode.has(key)&&/^[A-Z]$/.test(key))return null;byCode.set(key,r);}
 const terms=r=>{const s=String(r.VSusic||'').replace(/[()\s]/g,'');if(!/^[A-Z](?:\+[A-Z])*$/.test(s))return null;const codes=s.split('+');if(new Set(codes).size!==codes.length)return null;const parts=codes.map(c=>byCode.get(c));return parts.every(Boolean)&&parts.reduce((n,p)=>n+(p.Cost||0),0)===r.Cost?parts:null;};
 const c=terms(contract),g=terms(grand);if(!c||!g||!c.includes(gross)||!c.includes(vat)||!g.includes(contract))return null;
 // The source's reconciled formulas establish WHERE a cost belongs even
 // when its cost-sheet amount disagrees with the detailed work. Preserve
 // the detailed amount and surface that disagreement separately.
 const names=parts=>{const selected=[];for(const r of parts){const found=groups.filter(g=>compact(g.name)===compact(r.Name));if(found.length!==1){if(!r.Cost&&!found.length)continue;return null;}selected.push(found[0].key);}return selected;};
 // Older forms place waste before gross cost: (D + E + F + G), then
 // contract = gross + VAT. Keep that separate cost exactly once, provided
 // each saved additive subtotal reconciles and the core rows are identified.
 let grossExtras=[];
 const grossParts=terms(gross);
 if(String(gross.VSusic||'').trim()&&!grossParts)return null;
 if(grossParts){const core=new Set(['순공사원가','일반관리비','이윤']);grossExtras=grossParts.filter(r=>!core.has(compact(r.Name)));
  if(grossExtras.length&&(!grossParts.some(r=>compact(r.Name)==='순공사원가')||!grossParts.some(r=>compact(r.Name)==='이윤')))return null;
 }
 const contractParts=[...c.filter(r=>r!==gross&&r!==vat),...grossExtras];
 if(new Set(contractParts).size!==contractParts.length)return null;
 const contractGroups=names(contractParts),grandGroups=names(g.filter(r=>r!==contract));
 return contractGroups&&grandGroups?{contractGroups,grandGroups,sourceContractFormula:contract.VSusic,sourceGrandFormula:grand.VSusic}:null;
}
