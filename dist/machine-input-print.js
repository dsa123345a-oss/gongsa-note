import {truncateProduct,truncateQuotient} from './calc.js';

const format=new Intl.NumberFormat('ko-KR',{maximumFractionDigits:8});
const number=value=>format.format(Number(value));
// Display the same per-component truncation as machineryRate. This does not
// update the saved rate or replace a DB assembly with a manual calculation.
export function machineInputPrintRows(node){
 if(!node.verified||!node.machine)return [];
 const m=node.rate.machineInputs,rows=[];
 const add=(name,formula,value,component)=>{
  if(node.printComponents&&!node.printComponents.includes(component))return;
  rows.push({name,formula,amount:{total:value,labor:0,material:0,expense:0,other:0,[component]:value}});
 };
 const scale=Number(m.ownershipScale??6),factor=Number(m.operatorFactor??1);
 const fuel=truncateProduct(m.fuel,m.fuelPrice);
 add('손료',`${number(m.price)} × ${number(m.exchange)} × ${number(m.ownership)} × 10^(-${scale})`,truncateProduct(m.price,m.exchange,m.ownership,10**(-scale)),'expense');
 add('주연료',`${number(m.fuel)} × ${number(m.fuelPrice)}`,fuel,'material');
 add('잡유',`${number(fuel)} × ${number(m.oilPercent)}%`,truncateProduct(fuel,m.oilPercent,.01),'material');
 add('운전원',`${number(m.dailyWage)} × ${number(m.workers)} × ${number(factor)} ÷ ${number(m.hours)}`,truncateQuotient(m.dailyWage*m.workers*factor,m.hours),'labor');
 if(Number(m.misc))add('기타 경비',number(m.misc),truncateProduct(m.misc),'expense');
 return rows;
}
