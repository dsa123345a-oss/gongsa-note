import {evaluateFormula} from './formula.js';

export function chargeCodes(charges){let expense=7;return charges.map(c=>({indirect:'5',management:'E',profit:'F',vat:'I'})[c.key]||String(expense++));}
export function defaultChargeFormula(c,charges){
 if(c.formula)return c.formula;
 if(c.base==='fixed')return String(c.fixed||0);
 if(c.base==='health'&&charges){const index=charges.findIndex(item=>item.key==='health');return `${index<0?'0':'['+chargeCodes(charges)[index]+']'} * R`;}
 const base={labor:'[4]',totalLabor:'B',laborMaterial:'(A + [4])',totalLaborMaterial:'(A + B)',health:'[9]',direct:'(A + [4] + [6])',net:'D',profitBase:'(B + C + E)',contractBeforeVat:'(G + H)',government:'K'}[c.base];
 return `${base||'0'} * R`;
}
// Row numbers are enclosed in brackets, so 15% and other numeric constants
// cannot accidentally become references. Letter codes follow the visible form.
export function translateCostFormula(input,reference){
 const s=String(input).normalize('NFKC').trim().replace(/^=/,'').replace(/[×·]/g,'*').replace(/÷/g,'/');
 if(!s||s.length>1000)throw Error('산출근거 수식은 1~1,000자로 입력하세요.');
 let out='',pos=0;
 while(pos<s.length){const m=/^(\s+|\[(?:\d+|[A-MR])\]|[A-MR]\b|(?:\d+(?:\.\d*)?|\.\d+)|[+\-*/()%])/.exec(s.slice(pos));if(!m)throw Error('산출근거는 [4], A~M, R(요율), 숫자와 사칙연산을 사용하세요.');
  const token=m[0];pos+=token.length;
  if(/^\[|^[A-MR]$/.test(token)){const code=token.replace(/[\[\]]/g,'');const value=reference(code);if(value===undefined)throw Error(`${code}: 앞선 비목만 참조할 수 있습니다. 순환·없는 참조를 확인하세요.`);out+=`(${value})`;}
  else out+=token;
 }
 return out;
}
export function evaluateCostFormula(input,refs){const value=evaluateFormula(translateCostFormula(input,k=>refs[k]));if(value<0)throw Error('비목 금액은 0 이상이어야 합니다.');return Math.trunc(value);}
export function costReferences(t,entries,charges,index){
 const sum=keys=>entries.filter(c=>keys.includes(c.key)).reduce((n,c)=>n+c.amount,0),expense=entries.filter(c=>!['indirect','management','profit','vat'].includes(c.key)).reduce((n,c)=>n+c.amount,0);
 const refs={'1':0,'2':t.material,'3':0,A:t.material,'4':t.labor,'6':t.expense+t.other,H:t.waste,K:t.government,L:t.fees,R:(charges[index]?.rate||0)/100},codes=chargeCodes(charges);
 entries.forEach((c,i)=>refs[codes[i]]=c.amount);
 const before=keys=>charges.every((c,i)=>!keys.includes(c.key)||i<index);
 if(before(['indirect']))refs.B=t.labor+sum(['indirect']);
 if(charges.every((c,i)=>['indirect','management','profit','vat'].includes(c.key)||i<index)){refs.C=t.expense+t.other+expense;if(refs.B!==undefined)refs.D=refs.A+refs.B+refs.C;}
 if(refs.D!==undefined&&before(['management','profit']))refs.G=refs.D+sum(['management','profit']);
 const scope=charges.find(c=>c.estTotalScope)?.estTotalScope;
 const selected=keys=>t.separateGroups.filter(g=>keys.includes(g.key)).reduce((n,g)=>n+g.amount,0);
 if(refs.G!==undefined&&before(['vat']))refs.J=refs.G+(scope?selected(scope.contractGroups):t.waste)+sum(['vat']);
 if(refs.J!==undefined)refs.M=refs.J+(scope?selected(scope.grandGroups):t.government+t.fees);
 for(const code of ['K','L']){const value=charges[index]?.contractorFormulaRefs?.[code];if(value!==undefined){if(!Number.isFinite(value)||value<0||value>1e14)throw Error('업체용 산출근거 기준액을 확인하세요.');refs[code]=value;}}
 return refs;
}
