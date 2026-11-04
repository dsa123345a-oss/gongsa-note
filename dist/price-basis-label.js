// A display label for the applied source, not a claim about today's prices.
// Unknown months stay unknown; never infer a year/month from the print date.
export function priceBasisLabel(rate,kind='노임'){
 const source=String(rate.source||'').split(/[\\/]/).at(-1);
 if(rate.manual||/^User/.test(rate.table||'')||/나의 단가|직접 입력/.test(source))return `직접 입력 ${kind}`;
 const dated=source.match(/(?:^|[^\d])(20\d{2})\s*(?:[-_.]|년)\s*(0?[1-9]|1[0-2])(?=월|[-_.\s]|$)/);
 if(dated)return `${dated[1]}년 ${Number(dated[2])}월 기준 ${kind}`;
 if(/추가|상수도\s*공사\s*메인/.test(source))return kind==='노임'?'기준 노임 확인 필요':`추가 DB 기준 ${kind}`;
 return `${kind} 기준월 미확인`;
}
