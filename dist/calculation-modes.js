export const calculationModes = {auto:'자동 계산',horizontal:'가로 계산 제외',vertical:'세로 집계 제외',both:'가로·세로 계산 제외'};
export const manualCalculation = row => ['horizontal','both'].includes(row.calculationMode);
export const aggregateCalculation = row => !row.exclude && !['vertical','both'].includes(row.calculationMode);
export function manualAmounts(row){
 const result={labor:0,material:0,expense:0,other:0,total:0};
 for(const k of ['labor','material','expense','other']){
  const v=row.manualAmounts?.[k];
  if(typeof v!=='number'||!Number.isSafeInteger(v)||(k!=='other'&&v<0))throw Error('직접 입력 금액은 원 단위 정수로 입력하세요.');
  result[k]=v;result.total+=v;
 }
 if(!Number.isSafeInteger(result.total))throw Error('직접 입력 금액이 계산 가능한 범위를 벗어났습니다.');
 return result;
}
export function validateCalculationMode(row){
 if(row.calculationMode!=null&&!Object.hasOwn(calculationModes,row.calculationMode))throw Error('계산 방식을 확인하세요.');
 if(manualCalculation(row))manualAmounts(row);
}
