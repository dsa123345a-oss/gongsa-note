// EST originals keep the lower integer profit and assign the missing won to VAT
// when the 10% inverse total lies in the integer truncation gap (17 source files).
export function standardInverseVat(charges){
 const vat=charges.at(-1);
 return charges.filter(c=>c.key==='vat').length===1&&vat?.key==='vat'&&vat.base==='contractBeforeVat'&&vat.rate===10&&!vat.formula&&!vat.link;
}
export function makeEstVatRounding(charges,t,profit,target){
 const vat=t.charges.at(-1);
 if(standardInverseVat(charges)&&target-t.contract===1&&vat.baseValue+vat.amount===t.contract)return {base:vat.baseValue,profit,vat:vat.amount+1};
}
export function estVatRoundingDelta(charges,charge,base,ordinary){
 const profit=charges.find(c=>c.key==='profit'),a=profit?.adjustment,r=a?.vatRounding;
 return !!r&&charge===charges.at(-1)&&standardInverseVat(charges)&&profit.base==='fixed'&&!profit.formula&&r.profit===profit.fixed&&r.base===base&&r.vat===ordinary+1&&a.target===base+r.vat?1:0;
}
