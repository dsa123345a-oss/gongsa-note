// Normalize only the notation printed in an EST arithmetic expression. Unknown
// words, malformed numbers and unsupported operators remain for the caller to
// reject; a saved result is never used to infer a missing quantity or factor.
const number='(?:\\d+(?:\\.\\d*)?|\\.\\d+)';
const unit='(?:시간당|대당|인당|시간|ton|hr|kg|m\\^?[23]|ea|인|대|분|초|m|l|본|조|개|일|회)';
const unitSuffix=new RegExp('(\\d|\\))\\s*'+unit+'(?:\\s*/\\s*'+unit+')?(?=\\s*(?:[+\\-*/()%]|$))','gi');

export function normalizeEstNumericExpression(value){
 let text=String(value??'').normalize('NFKC').replace(/[\x00-\x1f]/g,'').replace(/[×·]/g,'*').replace(/÷/g,'/');
 text=text.replace(/(?<![\d.,])\d{1,3}(?:,\d{3})+(?:\.\d+)?(?![\d.,])/g,n=>n.replace(/,/g,''));
 text=text.replace(unitSuffix,'$1');
 text=text.replace(new RegExp('(?<![\\w.])('+number+')\\s*%(?!%)','g'),'($1/100)');
 // Keep a separator between two operands instead of turning "1 2" into 12.
 return text.replace(/\s+/g,(space,offset,source)=>/[A-Za-z0-9_.]/.test(source[offset-1]||'')&&/[A-Za-z0-9_.]/.test(source[offset+space.length]||'')?' ':'');
}

export function parseEstPercentFactor(value){
 const literal=String(value??'').normalize('NFKC').split('=')[0].replace(/[\x00-\x1f]/g,'');
 if(/[^\d,.\s%*×·()]/.test(literal))return null;
 const expression=normalizeEstNumericExpression(literal);
 const match=expression.match(new RegExp('^(?:'+number+'|\\('+number+'\\))\\*(?:('+number+')|\\(('+number+')/100\\))$'));
 if(!match)return null;
 const percent=match[2]===undefined?Number(match[1])*100:Number(match[2]);
 return Number.isFinite(percent)&&percent>=0?Number(percent.toPrecision(14)):null;
}
