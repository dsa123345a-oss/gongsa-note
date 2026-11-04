import {evaluateFormula} from './formula.js';
import {formulaDisplayRows} from './formula-print.js';

const keys=['labor','material','expense','other'];
const fields={labor:'NC',material:'GC',expense:'JC',other:'SC'};
const labels={labor:'노무비',material:'재료비',expense:'경  비',other:'기타',total:'계'};
const targetOf=r=>({[-1]:'labor',[-2]:'material',[-3]:'expense',[-4]:'other',[-5]:'total'})[r.SCheck||r.OCheck];
const number=new Intl.NumberFormat('ko-KR',{maximumFractionDigits:6});
const num=v=>number.format(Number(v)||0);
const close=(a,b)=>Math.abs(Number(a||0)-Number(b||0))<0.000001;
const value=s=>Number(String(s??'').replace(/,/g,'').trim());
const paired=(s,c)=>[...String(s).matchAll(new RegExp(c+'([^'+c+']*)'+c,'g'))].map(m=>m[1]);
const replacePair=(s,c,fn)=>s.replace(new RegExp(c+'([^'+c+']*)'+c,'g'),(_,v)=>c+fn(v)+c);
const amount=a=>{const out=Object.fromEntries(keys.map(k=>[k,Number(a?.[k]||0)]));out.total=keys.reduce((s,k)=>s+out[k],0);return out;};
const rawAmount=r=>amount(Object.fromEntries(keys.map(k=>[k,r[fields[k]]])));
const clean=s=>String(s??'').replace(/\x06[^\x06]*\x06|\x07[^\x07]*\x07/g,'').replace(/[\x00-\x08\x0b-\x1f]/g,'').replace(/\r/g,'');
const expression=(s,variables)=>String(s??'').replace(/\b[A-Za-z_][A-Za-z_0-9]*\b/g,k=>Object.hasOwn(variables,k)?'('+num(variables[k])+')':k).replace(/\*/g,' × ').replace(/\//g,' ÷ ');
const plainArithmetic=s=>clean(s).replace(/,/g,'').replace(/\s/g,'').replace(/[×·]/g,'*').replace(/÷/g,'/').replace(/(?:인|대|대일|시간|hr|㎥|㎡|㎞|kg|ton|m3|m2|m|M)/g,'');

function originalQuantity(raw){
 const text=String(raw.LineData||''),price=paired(text,'\x03')[0];
 if(price==null)return null;
 const begin=text.indexOf('\x03');
 const sections=text.slice(begin).split('=');
 for(const section of sections){
  let part=section.replace(/\x03[^\x03]*\x03/,'1');
  if(part===section){const match=/^\s*([\d,.]+)\s*([×*÷/])/.exec(clean(part));if(!match||!close(value(match[1]),value(price)))continue;part=clean(part).replace(match[1],'1');}
  try{return evaluateFormula(plainArithmetic(part));}catch{}
 }
 return null;
}

function currentPartText(part,variables){
 if(part.kind==='percent')return `    ${num(part.basisValue)} × ${num(part.percent)}% = ${num(part.amount?.total)}`;
 const active=keys.filter(k=>part[k]||part.amount?.[k]);
 if(['horizontal','both'].includes(part.calculationMode))return active.map(k=>`    ${labels[k]} : 직접 입력 ${num(part.amount?.[k])}`).join('\n');
 return active.map(k=>`    ${part.sourceComponent?labels[k]:part.name||labels[k]} : ${num(part[k])} × (${expression(part.qtyExpression??part.qty,variables)}) = ${num(part.amount?.[k])}`).join('\n');
}

/** Display-only translation. It never changes rates, quantities, or calculation state. */
export function estFormulaDisplay(node={}){
 const raw=(node.raw||[]).filter(r=>!r.TitleCode),calc=node.calc,rate=node.rate||{},warnings=[];
 const valid=!!(node.verified&&calc),variables=Object.fromEntries((calc?.variables||[]).map(v=>[v.name,v.value]));
 const finish=rows=>{
  // EST stores a fraction in three successive text records. Keep the same block
  // and preserve its spaces so a page break or proportional font cannot split it.
  for(let i=0;i<rows.length;i++)if(/[─━]{2}|[-]{5}/.test(rows[i].text)){
   const id='fraction-'+i;
   for(let j=Math.max(0,i-1);j<=Math.min(rows.length-1,i+1);j++)if(rows[j].kind!=='note')rows[j].blockId=id;
  }
  const projection=keys.includes(rate.sourceComponent)?` · ${labels[rate.sourceComponent]}만 적용`:'';
  const bid=rate.evidenceBid?` · 근거 낙찰 ${num(rate.evidenceBid.percent)}% 적용`:'';
  rows.push({text:`  산출 단가 / 기준 수량 ${num(calc?.divisor||1)}${projection}${bid}`,amount:amount(rate),bold:true,kind:'total',preserveSpace:true});
  return {rows,warnings:[...new Set(warnings)],source:raw.length?'est':'calculation'};
 };
 if(!raw.length)return finish(calc?formulaDisplayRows(calc).map(r=>({...r,kind:'formula',preserveSpace:true})):[{text:'구성 근거 없음 · 현재 적용 단가',kind:'note',preserveSpace:true}]);

 const parts=new Map();
 for(const p of valid?calc.rows:[]){if(p.originalRecord==null)continue;const id=String(p.originalRecord);if(parts.has(id))parts.set(id,null);else parts.set(id,p);}
 const entries=[];
 for(let i=0;i<raw.length;i++){
  const r=raw[i],p=parts.get(String(r._record));
  const deleted=valid&&!p&&r.Code&&paired(r.LineData,'\x03').length>0;
  if(!p&&!deleted)continue;
  const base=rawAmount(r),result=paired(r.LineData,'\x12').at(-1),target=p?.sourceComponent||p?.target||targetOf(r);
  if(result!=null&&keys.includes(target)){for(const k of keys)base[k]=k===target?value(result):0;base.total=value(result);}
  entries.push({raw:r,part:p,index:i,old:base,now:amount(p?.exclude||['vertical','both'].includes(p?.calculationMode)?null:p?.amount),deleted});
 }
 const changed=entries.some(e=>keys.some(k=>!close(e.old[k],e.now[k]))||e.deleted||(!e.part.kind&&paired(e.raw.LineData,'\x03').some(v=>!close(value(v),e.part[e.part.sourceComponent||targetOf(e.raw)]))));
 const seen=[],used=new Set(),rows=[];
 const replacements=new Map();
 const remember=(before,after)=>{if(!Number.isFinite(before)||!Number.isFinite(after))return;const k=String(before),set=replacements.get(k)||new Set();set.add(Number(after.toFixed(6)));replacements.set(k,set);};
 const resolve=before=>{const set=replacements.get(String(before));return set?.size===1?[...set][0]:undefined;};
 const sum=items=>amount(Object.fromEntries(keys.map(k=>[k,items.reduce((s,e)=>s+e.now[k],0)])));
 const matches=(items,wanted)=>keys.every(k=>close(items.reduce((s,e)=>s+e.old[k],0),wanted[k]));
 const aggregateMembers=r=>{
  const expected=rawAmount(r),candidates=r.Code?seen.filter(e=>e.raw.Code===r.Code):seen;
  if(!expected.total&&!Object.values(expected).some(Boolean))return null;
  for(let start=candidates.length-1;start>=0;start--){const selected=candidates.slice(start);if(matches(selected,expected))return selected;}
  return null;
 };
 const replaceKnownExpression=text=>{
  let uncertain=false;
  const next=text.replace(/(?<![A-Za-z_\d.])\d[\d,]*(?:\.\d+)?(?![A-Za-z_\d.])/g,t=>{const n=value(t),v=resolve(n);if(v==null){uncertain=true;return t;}return num(v);});
  return {text:next,uncertain};
 };
 const firstOriginal=(node.raw||[]).find(r=>r.TitleCode)||{};
 const finalCandidates=raw.map((r,i)=>({r,i})).filter(({r})=>Number(r.Level)<0);
 const lastPartIndex=entries.at(-1)?.index??-1;
 let finalStart=raw.findLastIndex(r=>Number(r.Level)>0&&/(?:합\s*계|총\s*계)/.test(clean(r.LineData)));
 if(finalStart<lastPartIndex)finalStart=finalCandidates.find(({i})=>i>lastPartIndex)?.i??raw.length;
 const quantityChanged=entries.filter(e=>e.part&&!e.part.kind).some(e=>{const old=originalQuantity(e.raw);return old!=null&&!close(old,e.part.qty);});
 if(quantityChanged){warnings.push('작업량 또는 수량식이 수정되었습니다. 원문 작업조건과 현재 적용 수량식을 구분해 표시합니다.');rows.push({text:'작업조건·작업량 설명은 원문 기준이며, 비용 산식에는 현재 수정 수량을 적용합니다.',kind:'note',preserveSpace:true});}
 if(valid&&(entries.some(e=>e.deleted)||entries.filter(e=>!e.deleted).length!==(calc.rows||[]).length))warnings.push('원문에 대응하지 않는 추가·변경 구성은 현재 산식으로 표시하고 삭제된 구성은 산출에서 제외합니다.');
 const rawTotal=rawAmount(firstOriginal);
 if(!valid&&rawTotal.total&&keys.some(k=>!close(rawTotal[k],rate[k])))warnings.push('원문 산출근거와 현재 적용 단가가 다릅니다. 아래 원문은 저장된 DB 근거이며 현재 단가의 재계산 검증이 필요합니다.');

 for(let i=0;i<raw.length;i++){
  const r=raw[i],original=String(r.LineData??r.Name??''),p=parts.get(String(r._record)),entry=entries.find(e=>e.index===i);
  let text=original,money=rawAmount(r),kind=!clean(text).trim()?'blank':Number(r.Level)>0?'heading':'formula',bold=kind==='heading';
  if(entry?.deleted){
   text=(clean(original).split(':')[0]||'원문 구성')+' : 삭제된 구성 (현재 산출에 미포함)';money=undefined;kind='note';
   for(const k of [...keys,'total'])remember(entry.old[k],0);seen.push(entry);
  }else if(entry){
   used.add(p);const target=p.sourceComponent||p.target||targetOf(r),oldPrice=paired(text,'\x03')[0];
   if(p.name!=null)text=replacePair(text,'\x0e',()=>p.name);
   if(p.spec!=null)text=replacePair(text,'\x13',()=>p.spec);
   const qty=originalQuantity(r),sameQty=qty!=null&&close(qty,p.qty);
   if(p.kind==='percent'){
    if(changed){let uncertain=false;text=replacePair(text,'\x1a',s=>{const next=replaceKnownExpression(s);uncertain||=next.uncertain;return next.text;});
     text=replacePair(text,'\x0c',()=>num(p.basisValue));
     const count=paired(text,'\x12').length;let at=0;text=replacePair(text,'\x12',()=>num(++at===count?p.amount.total:p.basisValue));
     text=text.replace(/([×*]\s*)[\d,.]+\s*%/g,(_,op)=>op+num(p.percent)+'%');
     if(uncertain||!count)text=currentPartText(p,variables);
    }
    money=Object.values(rawAmount(r)).some(Boolean)?amount(p.amount):undefined;kind='formula';
   }else if(!sameQty||['horizontal','both'].includes(p.calculationMode)||!keys.includes(target)||paired(text,'\x03').length!==1){
    text=currentPartText(p,variables);money=amount(p.amount);
   }else{
    text=replacePair(text,'\x03',()=>num(p[target]));
    // Expanded equations repeat the price after '=' without a marker. Replace
    // only that leading operand, never an equal-valued quantity elsewhere.
    text=text.replace(/(=\s*)([\d,]+(?:\.\d+)?)(\s*[×*÷/])/g,(whole,a,b,c)=>close(value(b),value(oldPrice))?a+num(p[target])+c:whole);
    let count=0;const resultCount=paired(text,'\x12').length;
    text=replacePair(text,'\x12',v=>++count===resultCount?num(p.amount[target]):v);
    money=Object.values(rawAmount(r)).some(Boolean)?amount(p.amount):undefined;
   }
   if(p.exclude||['vertical','both'].includes(p.calculationMode))text+=' (세로 집계 제외)';
   for(const k of [...keys,'total'])remember(entry.old[k],entry.now[k]);
   seen.push(entry);
  }else if(valid&&changed){
   const target=targetOf(r),members=aggregateMembers(r),isFinal=i>=finalStart&&Number(r.Level)<0;
   let current=members?sum(members):null;
   if(isFinal)current=amount(calc.result);
   if(current){
    money=Object.values(rawAmount(r)).some(Boolean)||isFinal&&target==='total'?current:undefined;
    const selected=target&&target!=='total'?current[target]:current.total;
    if(text.includes('\x1a')){
     let uncertain=false;
     const next=replacePair(text,'\x1a',s=>{const known=replaceKnownExpression(s);uncertain||=known.uncertain;return known.text;});
     const label=clean(text).split(':')[0]||labels[target]||'소  계';
     // Reconstruct monetary sums only from explicit component values. If the
     // original sum cannot be mapped without ambiguity, show the subtotal value.
     const single=paired(text,'\x1a').every(s=>!/[+×*÷/=]/.test(s));
     text=uncertain||isFinal&&single?`${label} : ${num(selected)}`:replacePair(next,'\x12',()=>num(selected));
    }else if(text.includes('\x12'))text=replacePair(text,'\x12',()=>num(selected));
    else if(text.includes('\x0c'))text=replacePair(text,'\x0c',()=>num(selected));
    for(const k of [...keys,'total'])remember(rawAmount(r)[k],current[k]);
    kind=isFinal?'total':'subtotal';bold=true;
   }else if(r.LinkIndex===61&&/\x0c\s*(?:kg|ton|m[²³23]?|㎥|㎡|개|본|조|식|대|인|회)(?:\b|\s|$)/i.test(text)){
    // EST uses the same marker for quantity subtotals (kg, m) as for money.
    // Resource price changes must not rewrite these original work quantities.
    money=undefined;kind='subtotal';
   }else if(text.includes('\x1a')||text.includes('\x0c')){
    let uncertain=false;
    let derived;
    text=replacePair(text,'\x1a',s=>{const out=replaceKnownExpression(s);uncertain||=out.uncertain;
     if(!out.uncertain){try{derived=evaluateFormula(plainArithmetic(out.text.split(':').at(-1).replace(/=\s*$/,'')));}catch{}}
     return out.text;});
    text=replacePair(text,'\x0c',s=>{const next=resolve(value(s));if(next==null){uncertain=true;return s;}return num(next);});
    // Every intermediate result is a money value in aggregate rows. Resolve it
    // from explicit previously mapped amounts instead of arbitrary substitution.
    text=replacePair(text,'\x12',s=>{let next=resolve(value(s));if(next==null&&derived!=null){const digits=(s.split('.')[1]||'').length,scale=10**digits;next=Math.trunc((derived+1e-9)*scale)/scale;}if(next==null){uncertain=true;return s;}remember(value(s),next);return num(next);});
    if(uncertain){text=(clean(original).split(':')[0]||'소  계')+' : 현재 구성 금액은 아래 산출 단가 참조';money=undefined;kind='note';warnings.push('일부 원문 중간 소계의 범위를 확정할 수 없어 현재 산출 단가를 참조하도록 표시했습니다.');}
   }
  }
  if(kind==='formula'&&Number(r.Level)<0){kind='subtotal';bold=true;}
  const base={amount:money?.total||money&&keys.some(k=>money[k])?money:undefined,bold,kind,breakBefore:!!r.PageSkip,originalRecord:r._record,preserveSpace:true};
  const lines=clean(text).split('\n');for(let j=0;j<lines.length;j++)rows.push({...base,amount:j===lines.length-1?base.amount:undefined,text:lines[j]});
 }
 if(valid){const extra=calc.rows.filter(p=>!used.has(p));if(extra.length){rows.push({text:'현재 추가 구성',kind:'heading',bold:true,preserveSpace:true});for(const p of extra){rows.push({text:`  ${p.name||'구성 항목'}${p.spec?' ('+p.spec+')':''}`,kind:'heading',preserveSpace:true});const lines=currentPartText(p,variables).split('\n');for(let j=0;j<lines.length;j++)rows.push({text:lines[j],amount:j===lines.length-1?amount(p.amount):undefined,kind:'formula',preserveSpace:true});}}}
 return finish(rows);
}
