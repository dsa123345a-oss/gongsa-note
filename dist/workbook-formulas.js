// Limited Excel interpreter for imports with absent cached results. Never runs JS,
// macros, external workbooks or network functions. Existing cached values win.
const error=message=>{throw Error(message);};
const num=v=>{if(v==null||v==='')return 0;if(typeof v==='boolean')return Number(v);const n=Number(v);return Number.isFinite(n)?n:error('숫자가 아닌 참조값');};
const str=v=>v==null?'':typeof v==='boolean'?v?'TRUE':'FALSE':String(v);
const truth=v=>typeof v==='string'&&/^(true|false)$/i.test(v)?/^true$/i.test(v):!!num(v);
const column=s=>[...s].reduce((n,c)=>n*26+c.charCodeAt(0)-64,0);
const columnName=n=>{let s='';while(n){n--;s=String.fromCharCode(65+n%26)+s;n=Math.floor(n/26);}return s;};
function address(s){const m=/^\$?([A-Z]{1,3})\$?([1-9]\d*)$/i.exec(s);if(!m||column(m[1].toUpperCase())>16384||Number(m[2])>1048576)error('셀 주소 범위 오류');return {col:column(m[1].toUpperCase()),row:Number(m[2])};}
export function shiftSharedFormula(formula,from,to){
 const a=address(from),b=address(to);
 return formula.replace(/"(?:[^"]|"")*"|'(?:[^']|'')*'|\$?[A-Za-z]{1,3}\$?[1-9]\d*/g,(token,offset,source)=>{
  if(/^["']/.test(token)||/[A-Za-z_0-9.]/.test(source[offset-1]||'')||/[A-Za-z_0-9.(]/.test(source[offset+token.length]||'')||source[offset+token.length]==='!')return token;
  const m=/^(\$?)([A-Za-z]+)(\$?)(\d+)$/.exec(token),c=column(m[2].toUpperCase())+(m[1]?0:b.col-a.col),r=Number(m[4])+(m[3]?0:b.row-a.row);
  if(c<1||c>16384||r<1||r>1048576)error('공유 수식 주소 범위 오류');return m[1]+columnName(c)+m[3]+r;
 });
}
function parseFormula(source){
 source=String(source).trim().replace(/^=/,'');if(!source||source.length>8192)error('수식 길이 초과');
 const tokens=[];let pos=0;
 while(pos<source.length){const m=/^(\s+|"(?:[^"]|"")*"|'(?:[^']|'')*'|(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?|\$?[A-Za-z_가-힣][A-Za-z_0-9.$가-힣]*|<>|<=|>=|[+\-*/^%&=<>(),:!])/.exec(source.slice(pos));if(!m)error('지원하지 않는 수식 문자');pos+=m[0].length;if(m[0].trim())tokens.push(m[0]);if(tokens.length>3000)error('수식 길이 초과');}
 let at=0,depth=0;const peek=()=>tokens[at],take=()=>tokens[at++],expect=t=>{if(take()!==t)error('수식 구분 오류');};
 function primary(){
  if(++depth>100)error('수식 중첩 초과');let t=take(),node;
  if(t==='('){node=expression();expect(')');}
  else if(t?.startsWith('"'))node={type:'value',value:t.slice(1,-1).replaceAll('""','"')};
  else if(/^(?:\d|\.)/.test(t||''))node={type:'value',value:Number(t)};
  else if(t){
   if(peek()==='('){take();const args=[];if(peek()!==')'){args.push(expression());while(peek()===','){take();args.push(expression());}}expect(')');node={type:'call',name:t.toUpperCase().replace(/^_XLFN\./,''),args};}
   else if(/^(TRUE|FALSE)$/i.test(t))node={type:'value',value:/^TRUE$/i.test(t)};
   else {let sheet=null;if(peek()==='!'){take();sheet=t.startsWith("'")?t.slice(1,-1).replaceAll("''","'"):t;t=take();}address(t);node={type:'ref',sheet,ref:t.replaceAll('$','').toUpperCase()};if(peek()===':'){take();const end=take();address(end);node={type:'range',sheet,start:node.ref,end:end.replaceAll('$','').toUpperCase()};}}
  }else error('수식 값 누락');
  while(peek()==='%'){take();node={type:'unary',op:'%',arg:node};}depth--;return node;
 }
 function unary(){if(['+','-'].includes(peek()))return {type:'unary',op:take(),arg:unary()};return primary();}
 function power(){let n=unary();while(peek()==='^')n={type:'binary',op:take(),left:n,right:unary()};return n;}
 const layer=(lower,ops)=>()=>{let n=lower();while(ops.includes(peek()))n={type:'binary',op:take(),left:n,right:lower()};return n;};
 const product=layer(power,['*','/']),sum=layer(product,['+','-']),concat=layer(sum,['&']),expression=layer(concat,['=','<>','<','>','<=','>=']);
 const result=expression();if(at!==tokens.length)error('지원하지 않는 수식 구문');return result;
}
function rounded(value,digits,mode){
 const n=num(value),d=num(digits);if(!Number.isInteger(d)||Math.abs(d)>15)error('반올림 자리수 범위 오류');
 const scale=10**d,x=Number((Math.abs(n)*scale).toPrecision(15));
 return Math.sign(n)*(mode==='ROUND'?Math.round(x):mode==='ROUNDUP'?Math.ceil(x):Math.trunc(x))/scale;
}
export function recalculateMissingWorkbook(sheets,{fileName=''}={}){
 const maps=new Map(sheets.map(s=>[s.name.toLowerCase(),new Map(s.rows.flatMap(r=>Object.values(r.cells).map(c=>[c.ref.toUpperCase(),c])))])),done=new Map(),visiting=new Set();let steps=0;
 const filename=String(fileName).split(/[\\/]/).at(-1);
 function run(node,sheet,depth=0){
  if(++steps>500000||depth>150)error('수식 계산 한도 초과');
  const go=n=>run(n,sheet,depth+1),value=n=>num(go(n));
  if(node.type==='value')return node.value;
  if(node.type==='ref')return cell(node.sheet||sheet,node.ref,depth+1);
  if(node.type==='range'){
   const a=address(node.start),b=address(node.end);if(a.row>b.row||a.col>b.col||(b.row-a.row+1)*(b.col-a.col+1)>10000)error('참조 범위 초과');const result=[];
   for(let r=a.row;r<=b.row;r++)for(let c=a.col;c<=b.col;c++)result.push(cell(node.sheet||sheet,columnName(c)+r,depth+1));return result;
  }
  if(node.type==='unary')return node.op==='-'?-value(node.arg):node.op==='%'?value(node.arg)/100:value(node.arg);
  if(node.type==='binary'){
   const a=go(node.left),b=go(node.right),op=node.op;
   if(op==='&')return str(a)+str(b);
   if(['=','<>','<','>','<=','>='].includes(op)){const x=typeof a==='string'?a.toLowerCase():a,y=typeof b==='string'?b.toLowerCase():b;return op==='='?x===y:op==='<>'?x!==y:op==='<'?x<y:op==='>'?x>y:op==='<='?x<=y:x>=y;}
   const x=num(a),y=num(b);if(op==='/'&&y===0)error('0으로 나누는 수식');return op==='+'?x+y:op==='-'?x-y:op==='*'?x*y:op==='/'?x/y:x**y;
  }
  const name=node.name,args=node.args,arity=(min,max=min)=>{if(args.length<min||args.length>max)error(name+' 함수 인수 오류');};
  if(name==='IF'){arity(2,3);return truth(go(args[0]))?go(args[1]):args[2]?go(args[2]):false;}
  if(name==='IFERROR'){arity(2);try{return go(args[0]);}catch{return go(args[1]);}}
  // Generator templates use ISNUMBER to choose entered dimensions or defaults.
  // Excel does not coerce numeric text/booleans here and treats errors as false.
  if(name==='ISNUMBER'){arity(1);try{const v=go(args[0]);return typeof v==='number'&&Number.isFinite(v);}catch{return false;}}
  if(name==='CELL'){arity(1,2);if(str(go(args[0])).toLowerCase()!=='filename'||!filename)error('파일명이 필요한 수식');return `C:\\[${filename}]${sheet}`;}
  const values=args.map(go),flat=values.flat(Infinity);
  if(['SUM','MIN','MAX','AVERAGE','COUNT'].includes(name)){arity(1,255);const numbers=flat.filter(v=>typeof v==='number');if(name==='COUNT')return numbers.length;if(name==='MIN')return numbers.length?Math.min(...numbers):0;if(name==='MAX')return numbers.length?Math.max(...numbers):0;const total=numbers.reduce((a,b)=>a+b,0);if(name==='AVERAGE'&&!numbers.length)error('평균 대상 없음');return name==='AVERAGE'?total/numbers.length:total;}
  if(name==='AND'||name==='OR'){arity(1,255);return name==='AND'?flat.every(truth):flat.some(truth);}
  if(name==='NOT'){arity(1);return !truth(values[0]);}
  if(['ROUND','ROUNDDOWN','ROUNDUP','TRUNC'].includes(name)){arity(name==='TRUNC'?1:2,2);return rounded(values[0],values[1]??0,name);}
  if(name==='ABS'||name==='INT'||name==='SQRT'){arity(1);return {ABS:Math.abs,INT:Math.floor,SQRT:Math.sqrt}[name](num(values[0]));}
  if(name==='LEFT'||name==='RIGHT'){arity(1,2);const n=num(values[1]??1);if(n<0)error('문자 길이 오류');const s=str(values[0]);return name==='LEFT'?s.slice(0,n):n?s.slice(-Math.trunc(n)):'';}
  if(name==='MID'){arity(3);const start=num(values[1]),n=num(values[2]);if(start<1||n<0)error('문자 위치 오류');return str(values[0]).slice(Math.trunc(start)-1,Math.trunc(start)-1+Math.trunc(n));}
  if(name==='FIND'){arity(2,3);const start=num(values[2]??1);if(start<1)error('문자 위치 오류');const i=str(values[1]).indexOf(str(values[0]),Math.trunc(start)-1);if(i<0)error('찾는 문자 없음');return i+1;}
  if(name==='TRIM'){arity(1);return str(values[0]).replace(/^ +| +$/g,'').replace(/ +/g,' ');}
  if(name==='LEN'){arity(1);return str(values[0]).length;}
  if(name==='REPT'){arity(2);const count=num(values[1]);if(count<0||str(values[0]).length*count>32767)error('문자 반복 범위 초과');return str(values[0]).repeat(Math.trunc(count));}
  if(name==='SUBSTITUTE'){arity(3,4);const [s,from,to]=values.map(str);if(!from)return s;if(values.length===3)return s.split(from).join(to);let n=0;const instance=num(values[3]);if(instance<1)error('치환 위치 오류');return s.split(from).reduce((acc,part,i)=>i?acc+(++n===instance?to:from)+part:part,'');}
  if(name==='CONCATENATE'||name==='CONCAT'){arity(1,255);return flat.map(str).join('');}
  error('지원하지 않는 함수: '+name);
 }
 function cell(sheet,ref,depth=0){
  if(depth>150)error('셀 참조 중첩 초과');const cells=maps.get(sheet.toLowerCase());if(!cells)error('참조 시트 없음: '+sheet);
  const c=cells.get(ref),key=sheet.toLowerCase()+'!'+ref;if(!c)return 0;
  if(c.type==='e')error('엑셀 오류값: '+c.value);
  if(!c.formula||c.cached)return c.value;
  if(done.has(key)){const result=done.get(key);if(result.error)error(result.error);return result.value;}
  if(visiting.has(key))error('순환 참조');visiting.add(key);
  try{const v=run(parseFormula(c.formula),sheet,depth+1);if(Array.isArray(v)||typeof v==='number'&&(!Number.isFinite(v)||Math.abs(v)>1e14)||typeof v==='string'&&v.length>32767)error('계산 결과 범위 오류');const value=typeof v==='number'?Number(v.toPrecision(15)):v;done.set(key,{value});c.value=value;c.calculated=true;delete c.calculationError;return value;}
  catch(e){done.set(key,{error:e.message});c.calculationError=e.message;throw e;}
  finally{visiting.delete(key);}
 }
 for(const s of sheets)for(const r of s.rows)for(const c of Object.values(r.cells))if(c.formula&&!c.cached){try{cell(s.name,c.ref);}catch{/* Keep unresolved values visibly unresolved, never zero. */}}
 return sheets;
}
