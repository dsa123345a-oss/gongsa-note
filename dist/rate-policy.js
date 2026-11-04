const validDate=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;
export function selectRateRule(ruleSet,direct){
 const {context={},rules=[]}=ruleSet||{};
 if(!validDate(context.date)||!Number.isInteger(context.days)||context.days<1||!context.kind)throw Error('요율 자동 선택의 공고일·기간·공종을 확인하세요.');
 const amount=r=>(r.amountBasis||'direct')==='direct'?direct:context.amounts?.[r.amountBasis];
 const relevant=rules.filter(r=>r.kind===context.kind&&context.date>=r.from&&context.date<=r.to&&context.days>=r.minDays&&context.days<=r.maxDays);
 if(relevant.some(r=>!Number.isFinite(amount(r))||amount(r)<0))return {warning:'구간 판정에 필요한 추정가격·도급액을 공사 조건에서 입력하세요.'};
 const candidates=relevant.filter(r=>amount(r)>=r.minAmount&&(r.maxAmount==null||amount(r)<r.maxAmount));
 if(candidates.length!==1)return {warning:candidates.length?'요율 조건이 중복됩니다. 구간을 분리하세요.':'현재 공사에 맞는 요율 구간이 없습니다. 기준표를 확인하세요.'};
 const r=candidates[0];if(!r.source?.trim()||!Number.isFinite(r.rate)||r.rate<0||r.rate>100)throw Error('요율의 출처와 값을 확인하세요.');
 return {rule:r};
}
export function addRateBand(project,band,context){
 const p=structuredClone(project);
 if(!band.source?.trim()||!band.kind?.trim()||!validDate(band.from)||!validDate(band.to)||band.from>band.to||!Number.isFinite(band.minAmount)||band.minAmount<0||!(band.maxAmount==null||(Number.isFinite(band.maxAmount)&&band.maxAmount>band.minAmount))||!Number.isInteger(band.minDays)||!Number.isInteger(band.maxDays)||band.minDays<1||band.maxDays<band.minDays)throw Error('기준표 출처·적용일·금액·기간 구간을 확인하세요.');
 let count=0;
 if(band.amountBasis&&!['direct','estimatedPrice','contractAmount'].includes(band.amountBasis))throw Error('금액 구간 판정 기준을 확인하세요.');
 for(const c of p.charges){if((band.chargeKey&&c.key!==band.chargeKey)||c.base==='fixed'||c.bidOriginal||c.originalCharge||c.link)continue;
  c.ruleSet={context:structuredClone(context),rules:[...(c.ruleSet?.rules||[]),{...band,rate:c.rate,base:c.base,id:crypto.randomUUID()}]};count++;
 }
 if(!count)throw Error('등록할 요율 항목이 없습니다. 정액·고정·낙찰 유지 항목은 구간 등록에서 제외됩니다.');
 p.ratesReviewed=false;return p;
}
