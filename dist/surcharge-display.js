export function surchargeBidLabel(line){
 const rates=line.surcharge?.bidPercents||[];
 return rates.length===1?`${rates[0]}% 연동`:rates.length>1?'혼합 연동':'기준 연동';
}
export function surchargeBidHint(line){
 return `기준 ${line.surcharge?.basis==='labor'?'노무비':'금액'}의 낙찰률을 따라 할증 금액도 함께 재계산합니다. 할증에 낙찰률을 두 번 곱하지 않습니다.`;
}
