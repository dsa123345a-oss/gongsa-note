// Keep arithmetic fractions until the monetary truncation. The ordinary formula
// evaluator's rounded display value must not become the input to a price product.
const MAX_DIGITS=4096,MAX_SAFE=BigInt(Number.MAX_SAFE_INTEGER);
const abs=n=>n<0n?-n:n;
function gcd(a,b){a=abs(a);b=abs(b);while(b){const r=a%b;a=b;b=r;}return a;}
function fraction(n,d=1n,exact=true){
 if(!d)throw Error('0으로 나눌 수 없습니다.');
 if(d<0n){n=-n;d=-d;}
 const g=gcd(n,d)||1n;n/=g;d/=g;
 if(abs(n).toString().length>MAX_DIGITS||d.toString().length>MAX_DIGITS)throw Error('계산식의 정밀도 범위를 벗어났습니다.');
 return {n,d,exact};
}
function decimal(value,exact=true){
 if(typeof value==='object'&&value!==null&&typeof value.n==='bigint'&&typeof value.d==='bigint')return value;
 const m=String(value).trim().match(/^([+-]?)(\d+(?:\.\d*)?|\.\d+)(?:[eE]([+-]?\d+))?$/);
 if(!m)throw Error('계산 가능한 숫자를 입력하세요.');
 const [whole,tail='']=m[2].split('.'),digits=(whole||'0')+tail;
 if(digits.length>MAX_DIGITS)throw Error('계산식의 정밀도 범위를 벗어났습니다.');
 let n=BigInt(digits);if(m[1]==='-')n=-n;if(!n)return fraction(0n,1n,exact);
 const scale=tail.length-Number(m[3]||0);
 if(!Number.isSafeInteger(scale)||Math.abs(scale)>MAX_DIGITS)throw Error('계산식의 지수 범위를 벗어났습니다.');
 return scale>=0?fraction(n,10n**BigInt(scale),exact):fraction(n*10n**BigInt(-scale),1n,exact);
}
function numeric(value){
 const n=Number(value.n),d=Number(value.d);if(Number.isFinite(n)&&Number.isFinite(d))return n/d;
 const a=abs(value.n).toString(),b=value.d.toString(),take=16;
 return (value.n<0n?-1:1)*(Number(a.slice(0,take))/10**(Math.min(take,a.length)-1))/(Number(b.slice(0,take))/10**(Math.min(take,b.length)-1))*10**(a.length-b.length);
}
const add=(a,b)=>fraction(a.n*b.d+b.n*a.d,a.d*b.d,a.exact&&b.exact);
const negate=a=>fraction(-a.n,a.d,a.exact);
const multiply=(a,b)=>fraction(a.n*b.n,a.d*b.d,a.exact&&b.exact);
const divide=(a,b)=>fraction(a.n*b.d,a.d*b.n,a.exact&&b.exact);
const compare=(a,b)=>a.n*b.d-b.n*a.d;
function approximate(value){if(!Number.isFinite(value))throw Error('계산값이 범위를 벗어났습니다.');return decimal(value,false);}
function power(a,b){
 if(b.d===1n&&abs(b.n)<=1024n){
  const p=abs(b.n);
  if(Number(p)*Math.max(abs(a.n).toString().length,a.d.toString().length)>MAX_DIGITS)return approximate(numeric(a)**numeric(b));
  const n=a.n**p,d=a.d**p;
  return b.n<0n?fraction(d,n,a.exact&&b.exact):fraction(n,d,a.exact&&b.exact);
 }
 return approximate(numeric(a)**numeric(b));
}
function integerSqrt(n){
 if(n<0n)throw Error('음수의 제곱근은 계산할 수 없습니다.');if(n<2n)return n;
 let x=1n<<BigInt(Math.ceil(n.toString(2).length/2)),next=(x+n/x)/2n;
 while(next<x){x=next;next=(x+n/x)/2n;}return x;
}
function squareRoot(a){
 if(a.n<0n)throw Error('음수의 제곱근은 계산할 수 없습니다.');
 const n=integerSqrt(a.n),d=integerSqrt(a.d);
 return n*n===a.n&&d*d===a.d?fraction(n,d,a.exact):approximate(Math.sqrt(numeric(a)));
}
function evaluate(input,variables){
 const source=String(input).trim().replace(/[×·]/g,'*').replace(/÷/g,'/').replace(/＝/g,'=').replace(/=$/,'');
 if(!source||source.length>1000)throw Error('계산식을 입력하세요. (최대 1,000자)');
 const tokens=[];let offset=0;
 while(offset<source.length){
  const m=/^(\s+|(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?|[A-Za-z_][A-Za-z_0-9]*|[+\-*/^(),%])/.exec(source.slice(offset));
  if(!m)throw Error(`사용할 수 없는 문자: ${source.slice(offset,offset+12)}`);offset+=m[0].length;if(m[0].trim())tokens.push(m[0]);
 }
 let at=0,depth=0;const peek=()=>tokens[at];
 function primary(){
  if(++depth>40)throw Error('괄호가 너무 깊습니다.');let value,token=tokens[at++];
  if(token==='('){value=expression();if(tokens[at++]!==')')throw Error('닫는 괄호가 필요합니다.');}
  else if(/^(?:\d|\.)/.test(token||''))value=decimal(token);
  else if(/^[A-Za-z_]/.test(token||'')){
   if(peek()==='('){
    at++;const args=[expression()];while(peek()===','){at++;args.push(expression());}if(tokens[at++]!==')')throw Error('함수의 닫는 괄호가 필요합니다.');
    if(['abs','sqrt'].includes(token)&&args.length!==1)throw Error(`${token} 함수는 인수가 1개여야 합니다.`);
    if(token==='min'||token==='max')value=args.reduce((a,b)=>(token==='min'?compare(a,b)<=0n:compare(a,b)>=0n)?a:b);
    else if(token==='abs')value=fraction(abs(args[0].n),args[0].d,args[0].exact);
    else if(token==='sqrt')value=squareRoot(args[0]);
    else throw Error(`지원하지 않는 함수: ${token}`);
   }else{if(!Object.hasOwn(variables,token))throw Error(`정의되지 않은 변수: ${token}`);value=variables[token];}
  }else throw Error('숫자 또는 변수가 필요합니다.');
  while(peek()==='%'){at++;value=divide(value,decimal(100));}depth--;return value;
 }
 function powered(){let value=primary();if(peek()==='^'){at++;value=power(value,unary());}return value;}
 function unary(){if(peek()==='+'){at++;return unary();}if(peek()==='-'){at++;return negate(unary());}return powered();}
 function term(){let value=unary();while(['*','/'].includes(peek())){const op=tokens[at++],right=unary();value=op==='*'?multiply(value,right):divide(value,right);}return value;}
 function expression(){let value=term();while(['+','-'].includes(peek())){const op=tokens[at++],right=term();value=add(value,op==='+'?right:negate(right));}return value;}
 const value=expression();if(at!==tokens.length)throw Error(`계산식 구분을 확인하세요: ${tokens[at]}`);
 if(!Number.isFinite(numeric(value))||compare(fraction(abs(value.n),value.d),decimal('1e14'))>0n)throw Error('계산값이 범위를 벗어났습니다.');
 return value;
}

export function createExactFormulaContext(variableText=''){
 const variables=Object.create(null),cache=new Map();
 for(const raw of String(variableText).split(/\r?\n/)){
  const line=raw.split('#')[0].trim();if(!line)continue;
  const m=line.match(/^([A-Za-z_][A-Za-z_0-9]*)\s*=\s*(.+)$/);if(!m)throw Error(`변수는 Q = 600/8 형태로 입력하세요: ${line}`);
  if(Object.hasOwn(variables,m[1]))throw Error(`중복 변수: ${m[1]}`);variables[m[1]]=evaluate(m[2],variables);
 }
 const resolve=expression=>{const key=String(expression);if(!cache.has(key))cache.set(key,evaluate(key,variables));return cache.get(key);};
 return {
  evaluate(expression){return numeric(resolve(expression));},
  truncateProduct(expression,unitPrice,digits=0){
   if(!Number.isInteger(digits)||digits<0||digits>6)throw Error('구성 금액 소수 자릿수는 0~6입니다.');
   const value=multiply(multiply(resolve(expression),decimal(unitPrice)),decimal(10**digits)),integer=value.n/value.d;
   if(integer>MAX_SAFE||integer<-MAX_SAFE)throw Error('금액이 안전한 계산 범위를 벗어났습니다.');
   return Number(integer)/10**digits;
  }
 };
}
