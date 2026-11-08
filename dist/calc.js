import {memoizeText} from './text-cache.js';
import {selectRateRule} from './rate-policy.js';
import {resolveLineAdjustments} from './line-adjustments.js';
import {restoreEmergencySurcharges} from './emergency-rules.js';
import {manualCalculation,manualAmounts,aggregateCalculation} from './calculation-modes.js';
import {evaluateCostFormula,costReferences} from './cost-formula.js';
import {resolveCostScopes,separateCostGroups,arrangeSeparateCosts} from './cost-scopes.js';
import {reserveWorkConnectionJoints} from './work-connection-joints.js';
export const cleanNumber = n => n==null || (typeof n==='string'&&!n.trim()) ? null : Number.isFinite(Number(n)) ? Number(Number(n).toPrecision(14)) : null;
export const norm=memoizeText(s=>s.normalize('NFKC').toLowerCase().replace(/[\s\u200b-\u200d\ufeff\u00ad]|[()\[\],._-]/g,'').replace(/×/g,'x'));
export const unitNorm=memoizeText(s=>norm(s).replace(/㎥|m³|m\^3/g,'m3').replace(/㎡|m²|m\^2/g,'m2').replace(/톤/g,'ton').replace(/ℓ/g,'l'));
function fraction(value){
  const n=cleanNumber(value);if(n===null || Math.abs(n)>1e14)throw Error('계산 가능한 숫자 범위를 벗어났습니다.');
  const [mantissa,exponent='0']=String(n).toLowerCase().split('e');
  const neg=mantissa.startsWith('-'),[a,b='']=mantissa.replace('-','').split('.');
  const scale=b.length-Number(exponent),numerator=(neg?-1n:1n)*BigInt(a+b);
  return scale>=0?[numerator,10n**BigInt(scale)]:[numerator*10n**BigInt(-scale),1n];
}
export function truncateQuotient(value,divisor){const[a,b]=fraction(value),[c,d]=fraction(divisor);if(c===0n)throw Error('0으로 나눌 수 없습니다.');const result=a*d/(b*c);if(result>BigInt(Number.MAX_SAFE_INTEGER)||result<BigInt(Number.MIN_SAFE_INTEGER))throw Error('금액이 안전한 계산 범위를 벗어났습니다.');return Number(result);}
export function truncateProduct(...values){let n=1n,d=1n;for(const v of values){const[a,b]=fraction(v);n*=a;d*=b;}const x=n/d;if(x>BigInt(Number.MAX_SAFE_INTEGER)||x<BigInt(Number.MIN_SAFE_INTEGER))throw Error('금액이 안전한 계산 범위를 벗어났습니다.');return Number(x);}
export function bidPercent(line){
  if(line.generatedSupplyFee)return 100;
  if(line.surcharge||line.deduction)return 100;
  if(line.rate?.evidenceBid)return 100;
  if(line.bucket==='government'||line.rate?.government)return 100;
  const p=cleanNumber(line.bidPercent??100);
  if(p===null||p<0||p>100)throw Error('낙찰률은 0~100%로 입력하세요.');
  return p;
}
export function appliedRate(line){
  if(!line.rate)return null;
  const p=bidPercent(line),r={...line.rate};
  if(!['unit','amount'].includes(line.bidMethod??'unit'))throw Error('낙찰 계산 방식을 확인하세요.');
  for(const k of ['labor','material','expense','other'])r[k]=p===100?r[k]||0:(line.bidMethod==='amount'?(r[k]||0)*p/100:truncateProduct(r[k]||0,p,0.01));
  r.total=r.labor+r.material+r.expense+r.other;return r;
}
export function amount(line){
  if(!line.rate || line.status!=='confirmed'||line.rate.resourcePricing?.ready===false)return null;
  if(manualCalculation(line))return manualAmounts(line);
  const qty=cleanNumber(line.qty),factor=cleanNumber(line.factor??1);
  if(qty===null||(qty<0&&!line.deduction?.reason)||factor===null||factor<=0)return null;
  const a={labor:0,material:0,expense:0,other:0,total:0};
  const rate=appliedRate(line),p=bidPercent(line);
  for(const k of ['labor','material','expense','other'])a[k]=line.bidMethod==='amount'?truncateProduct(qty,factor,line.rate[k]??0,p,0.01):truncateProduct(qty,factor,rate[k]);
  a.total=a.labor+a.material+a.expense+a.other;return a;
}
function totalsCore(lines,charges){
  reserveWorkConnectionJoints(lines.filter(l=>l.workConnectionJoints!==undefined).map(l=>({label:l.sourceFile||l.name||'기존 내역',joints:l.workConnectionJoints})));
  const t={labor:0,material:0,expense:0,other:0,direct:0,government:0,waste:0,fees:0,missing:0};
  for(const l of lines){if(!aggregateCalculation(l)||l.level)continue;const a=amount(l);if(!a){t.missing++;continue;}
    if(l.bucket==='government'){t.government+=a.total;continue;}
    if(l.bucket==='waste'){t.waste+=a.total;continue;}
    if(l.bucket==='fees'){t.fees+=a.total;continue;}
    for(const k of ['labor','material','expense','other'])t[k]+=a[k];t.direct+=a.total;
  }
  t.separateGroups=separateCostGroups(lines,amount,aggregateCalculation);
  const entries=[];let cumulative=0;
  for(const c of charges){const indirect=entries.find(x=>x.key==='indirect')?.amount||0;const bases={direct:t.direct,labor:t.labor,totalLabor:t.labor+indirect,laborMaterial:t.labor+t.material,totalLaborMaterial:t.labor+indirect+t.material,health:entries.find(x=>x.key==='health')?.amount||0,net:t.direct+cumulative,profitBase:t.labor+t.expense+t.other+cumulative,contractBeforeVat:t.direct+cumulative+t.waste,government:t.government,fixed:0};
    const value=c.formula?evaluateCostFormula(c.formula,costReferences(t,entries,charges,entries.length)):c.base==='fixed'?truncateProduct(c.fixed||0):truncateProduct(bases[c.base]??0,c.rate||0,0.01);
    entries.push({...c,baseValue:bases[c.base]??0,amount:value});cumulative+=value;
  }
  const scope=charges.find(c=>c.estTotalScope)?.estTotalScope;
  const selected=keys=>t.separateGroups.filter(g=>keys.includes(g.key)).reduce((n,g)=>n+g.amount,0);
  if(scope&&(!Array.isArray(scope.contractGroups)||!Array.isArray(scope.grandGroups)||[...scope.contractGroups,...scope.grandGroups].some(k=>typeof k!=='string')))throw Error('EST 원본 합산 범위를 확인하세요.');
  t.charges=entries;t.contract=t.direct+(scope?selected(scope.contractGroups):t.waste)+cumulative;t.grand=t.contract+(scope?selected(scope.grandGroups):t.government+t.fees);if(scope)t.totalScope=scope;return t;
}
export function suggest(line,items,limit=10){
  const name=norm(line.name),spec=norm(line.spec),unit=unitNorm(line.unit);
  const grams=s=>new Set(Array.from({length:Math.max(0,s.length-1)},(_,i)=>s.slice(i,i+2)));
  const a=grams(name);const scoreName=s=>{if(s===name)return 100;if(s.includes(name)||name.includes(s))return 70;const b=grams(s);let hit=0;for(const g of a)if(b.has(g))hit++;return 60*2*hit/(a.size+b.size||1);};
  const result=[];
  for(const item of items){if(!item.name || item.total<0)continue;let score=scoreName(norm(item.name));if(score<20)continue;
    if(spec&&norm(item.spec)===spec)score+=35;else if(spec&&norm(item.spec).includes(spec))score+=12;
    if(unit&&unitNorm(item.unit)===unit)score+=15;
    if(/자재/.test(line.group)&&item.category==='자재')score+=20;
    if(item.category==='내역단가')score+=8;
    result.push({item,score,exact:norm(item.name)===name&&norm(item.spec)===spec&&unitNorm(item.unit)===unit});
  }
  return result.sort((a,b)=>b.score-a.score).slice(0,limit);
}
export const defaultCharges=()=>[
  {key:'indirect',name:'간접노무비',base:'labor',rate:19.1},
  {key:'industrial',name:'산재보험료',base:'totalLabor',rate:3.56},
  {key:'employment',name:'고용보험료',base:'totalLabor',rate:1.01},
  {key:'health',name:'건강보험료',base:'labor',rate:0},
  {key:'pension',name:'연금보험료',base:'labor',rate:0},
  {key:'longTermCare',name:'노인장기요양보험료',base:'health',rate:0},
  {key:'retirement',name:'퇴직공제부금비',base:'labor',rate:0},
  {key:'equipmentGuarantee',name:'건설기계대여대금 지급보증서 발급금액',base:'direct',rate:0},
  {key:'safety',name:'산업안전보건관리비',base:'fixed',rate:0,fixed:0},
  {key:'environment',name:'환경보전비',base:'direct',rate:0},
  {key:'performanceGuarantee',name:'공사이행보증수수료',base:'direct',rate:0},
  {key:'subcontractGuarantee',name:'하도급대금지급보증수수료',base:'direct',rate:0},
  {key:'asbestos',name:'석면분담금',base:'totalLabor',rate:0.006},
  {key:'wageClaim',name:'임금채권부담금',base:'totalLabor',rate:0.09},
  {key:'other',name:'기타경비',base:'totalLaborMaterial',rate:5.5},
  {key:'management',name:'일반관리비',base:'net',rate:8},
  {key:'profit',name:'이윤',base:'profitBase',rate:15},
  {key:'vat',name:'부가가치세',base:'contractBeforeVat',rate:10}
];

export const chargeBaseLabels={labor:'직접노무비',totalLabor:'직접+간접 노무비',laborMaterial:'직접노무비+직접재료비',totalLaborMaterial:'전체 노무비+직접재료비',health:'앞선 건강보험료',direct:'직접공사비',net:'직접공사비+앞선 제경비',profitBase:'노무비+경비+앞선 제경비',contractBeforeVat:'직접공사비+앞선 제경비+폐기물',government:'관급자재대',fixed:'정액 입력'};

// Recompute explicitly linked costs from current quantities. Manual fixed values stay fixed.
export function resolveLinkedCosts(lines,charges){
 const adjustments=resolveLineAdjustments(arrangeSeparateCosts(resolveCostScopes(lines))),linkedLines=adjustments.lines,linkedCharges=charges.map(c=>({...c})),warnings=[...adjustments.warnings];
 const generated=linkedLines.filter(l=>l.generatedProcurement?.auto===true);
 const base=totalsCore(linkedLines.filter(l=>!l.generatedProcurement),[]);
 for(const c of linkedCharges){if(c.formula||!c.ruleSet||c.bidOriginal||c.originalCharge||c.link||c.base==='fixed')continue;const selected=selectRateRule(c.ruleSet,base.direct);if(selected.warning){warnings.push(c.name+' · '+selected.warning);delete c.ruleApplied;}else {c.rate=selected.rule.rate;c.base=selected.rule.base;c.ruleApplied={source:selected.rule.source,from:selected.rule.from,to:selected.rule.to};}}
 for(const l of generated){
  const v=l.generatedProcurement,rate=cleanNumber(v.rate),digits=Number(v.digits);
  if(rate===null||rate<0||rate>100||!Number.isInteger(digits)||digits<0||digits>6)throw Error('조달수수료 자동 연동 설정을 확인하세요.');
  const pure=truncateProduct(base.government,rate,.01),unit=10**digits,value=Math.ceil((base.government+pure)/unit)*unit-base.government;
  l.rate={...l.rate,labor:0,material:0,expense:value,other:0,total:value};l.qty=1;l.factor=1;l.bidPercent=100;l.bidMethod='unit';
  l.spec=`관급 ${base.government.toLocaleString('ko-KR')} × ${rate}% · 합계 ${unit}원 절상 · 자동 연동`;
 }
 for(let i=0;i<linkedCharges.length;i++){
  const c=linkedCharges[i];if(c.link?.type!=='safety')continue;
  const v=c.link,prior=totalsCore(linkedLines,linkedCharges.slice(0,i)),indirect=prior.charges.find(x=>x.key==='indirect')?.amount||0;
  if(!['laborMaterial','totalLaborMaterial'].includes(v.basis))throw Error('안전관리비 연동 기준을 확인하세요.');
  for(const k of ['rate','addition','surcharge','governmentPercent'])if(cleanNumber(v[k])===null||v[k]<0||v[k]>1e14)throw Error('안전관리비 연동 입력값을 확인하세요.');
  if(v.governmentPercent>100)throw Error('관급 포함률은 100% 이하여야 합니다.');
  const b=base.labor+base.material+(v.basis==='totalLaborMaterial'?indirect:0),g=truncateProduct(base.government,v.governmentPercent,.01);
  const a=truncateProduct(b+g,v.rate,.01)+v.addition,z=truncateProduct(truncateProduct(b,v.rate,.01)+v.addition,1+v.surcharge/100);
  Object.assign(c,{base:'fixed',fixed:Math.min(a,z),comparison:{withGovernment:a,withSurcharge:z,selected:Math.min(a,z)},comparisonInputs:{base:b,government:g,rate:v.rate,addition:v.addition,surcharge:v.surcharge}});
 }
 for(let i=0;i<linkedCharges.length;i++){
  const c=linkedCharges[i];if(c.link?.type!=='target')continue;
  const v=c.link,target=cleanNumber(v.target);if(target===null||target<0||!v.maximum||v.maximum.link)throw Error('목표 도급액 연동 설정을 확인하세요.');
  if(linkedCharges.slice(i+1).some(x=>x.key!=='vat'||x.base!=='contractBeforeVat'))throw Error('목표 도급액 자동 연동은 이윤 뒤에 부가가치세만 있는 원가 양식을 지원합니다.');
  const capCharges=linkedCharges.map((x,j)=>j===i?{...v.maximum,key:c.key}:x),cap=totalsCore(linkedLines,capCharges).charges[i].amount;
  const value=x=>totalsCore(linkedLines,linkedCharges.map((a,j)=>j===i?{...a,formula:undefined,base:'fixed',fixed:x}:a)).contract;
  let lo=0,hi=Math.max(0,cap);if(target<value(0)||target>value(hi))warnings.push('목표 도급액에 맞출 수 없습니다. 현재 원가와 이윤 조정 범위를 확인하세요.');
  while(lo<hi){const mid=Math.ceil((lo+hi)/2);if(value(mid)<=target)lo=mid;else hi=mid-1;}
  c.base='fixed';delete c.formula;c.fixed=lo;c.adjustment={...c.adjustment,target,actual:value(lo),difference:target-value(lo)};
 }
 return {lines:linkedLines,charges:linkedCharges,warnings};
}
export function totals(lines,charges){const r=resolveLinkedCosts(lines,charges),t=totalsCore(r.lines,r.charges);if(r.warnings.length)t.warnings=r.warnings;return t;}
export function synchronizeLinkedCosts(project){project=restoreEmergencySurcharges(project);const r=resolveLinkedCosts(project.lines,project.charges);return {...project,lines:r.lines,charges:r.charges,costWarnings:r.warnings};}
