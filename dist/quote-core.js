import {cleanNumber} from './calc.js';
import {chooseQuote} from './estimate-core.js';
export function quoteInputs(rate){
 const prices=Array.from({length:6},(_,i)=>{const value=rate.prices?.[i]??null;return !rate.quoteMethod&&value===0?null:value;});
 return {prices,method:rate.quoteMethod||(prices.some(v=>v!==null)?'min':'manual')};
}
export function quotePrice(quotes,{method='min',selected=0,manual=null,vat='none',vatRate=10,rounding='floor',digits=0}={}){
 if(quotes.some(v=>v!=null&&(typeof v!=='number'||!Number.isFinite(v)||v<0)))throw Error('조사단가는 0 이상의 숫자로 입력하세요.');
 const base=chooseQuote(quotes,method,selected,manual),pct=cleanNumber(vatRate);
 if(pct===null||pct<0||pct>100||!['none','include','exclude'].includes(vat))throw Error('부가세 설정을 확인하세요.');
 if(!['none','floor','ceil','round'].includes(rounding)||!Number.isInteger(digits)||digits< -6||digits>6)throw Error('단가 자릿수 설정을 확인하세요.');
 const converted=vat==='include'?base*(1+pct/100):vat==='exclude'?base/(1+pct/100):base;
 const scaled=cleanNumber(converted*10**digits);
 const result=rounding==='none'?cleanNumber(converted):Math[rounding](scaled)/10**digits;
 if(!Number.isFinite(result)||result<0||result>1e14)throw Error('단가가 계산 가능한 범위를 벗어났습니다.');
 return result;
}
