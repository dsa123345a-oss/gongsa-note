import {norm,unitNorm} from './calc.js';

const keys=['labor','material','expense','other'];
const spec=s=>String(s||'').normalize('NFKC').replace(/\s/g,'').toLowerCase();
const unit=s=>unitNorm(String(s||'').replace(/당$/,''));
const same=(a,b)=>norm(a.name)===norm(b.name)&&spec(a.spec)===spec(b.spec)&&unit(a.unit)===unit(b.unit);
const zero=p=>keys.every(k=>Number(p[k]||0)===0);
const rawZero=r=>['TU','NU','GU','JU','SU','TC','NC','GC','JC','SC'].every(k=>Number(r[k]||0)===0);

export function verifiedEstComponentRow(part,details){
 if(!Number.isInteger(part.originalRecord))return null;
 const rows=(details||[]).filter(r=>r._record===part.originalRecord&&!r.TitleCode);
 if(rows.length!==1)return null;
 const row=rows[0];
 return String(row.Code||'')===String(part.code||'')&&same({name:row.Name,spec:row.Size,unit:row.Unite},part)?row:null;
}

export function isFixedPrintedComponent(part,details){
 if(!part.fixedPrice||part.code||part.kind||!Number.isInteger(part.originalRecord)||!part.formulaSource)return false;
 const rows=(details||[]).filter(r=>r._record===part.originalRecord&&!r.TitleCode);
 return rows.length===1&&!rows[0].Code&&String(rows[0].LineData||'').replace(/[\x00-\x1f]/g,'')===part.formulaSource;
}

export function estResourcePolicy(part,details,parent){
 const row=verifiedEstComponentRow(part,details);
 if(!row||Number(row.LinkIndex||0)!==0||part.kind||part.calculationMode&&part.calculationMode!=='auto')return null;
 const separateLabel=s=>/^(?:별산|별도(?:계상|계산)?)$/.test(norm(s));
 const mortar=norm(row.Name)==='모르타르비빔품제외'&&/^배합비1:[13],시멘트,모래별도$/.test(spec(row.Size));
 const separate=rawZero(row)&&(separateLabel(row.Bigo)||separateLabel(row.Size)||mortar);
 if(separate){
  // Repair prices added by older automatic updates only when every current
  // amount is still exactly the applied reference snapshot. A manual change
  // conflicting with the source's separate-accounting note needs review.
  const ref=part.priceReference;
  const applied=ref&&same(ref,part)&&keys.every(k=>Number(part[k]||0)===Number(part.sourceComponent?(part.sourceComponent===k?ref.total:0):(ref[k]||0)));
  return zero(part)||applied?{kind:'separate',restored:!zero(part)}:{kind:'conflict',reason:'원본은 별도 계상 0원인데 현재 구성 단가가 수정되어 있습니다. 별도 계상 여부와 직접 입력 금액을 확인하세요.'};
 }
 if(rawZero(row)&&zero(part)&&/^※/.test(String(row.Name||''))&&!unit(row.Unite)&&Number(row.GN||0)===0&&Number(part.qtyExpression??part.qty??0)===0)return {kind:'note'};
 // These four installation rates were explicitly confirmed as fixed prices,
 // not occupational wage rates. Keep their validated original labor amounts.
 if(norm(parent?.name)==='누수보수용클램프설치'&&!row.Code&&!part.code&&norm(row.Name)==='설치비'&&unit(row.Unite)==='개소'){
  const values={labor:row.NU||0,material:row.GU||0,expense:row.JU||0,other:0};
  if(keys.every(k=>Number(part[k]||0)===Number(values[k]))&&values.labor>0)return {kind:'fixed-installation'};
 }
 return null;
}
