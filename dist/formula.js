// Arithmetic only: no JavaScript evaluation, property access, or executable input.
export function evaluateFormula(input, variables={}) {
 const source=String(input).trim().replace(/[×·]/g,'*').replace(/÷/g,'/').replace(/＝/g,'=').replace(/=$/,'');
 if(!source||source.length>1000)throw Error('계산식을 입력하세요. (최대 1,000자)');
 const tokens=[];let offset=0;
 while(offset<source.length){const m=/^(\s+|(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?|[A-Za-z_][A-Za-z_0-9]*|[+\-*/^(),%])/.exec(source.slice(offset));if(!m)throw Error(`사용할 수 없는 문자: ${source.slice(offset,offset+12)}`);offset+=m[0].length;if(m[0].trim())tokens.push(m[0]);}
 let at=0,depth=0;const peek=()=>tokens[at];
 function primary(){if(++depth>40)throw Error('괄호가 너무 깊습니다.');let n,t=tokens[at++];
  if(t==='('){n=expression();if(tokens[at++]!==')')throw Error('닫는 괄호가 필요합니다.');}
  else if(/^(?:\d|\.)/.test(t||''))n=Number(t);
  else if(/^[A-Za-z_]/.test(t||'')){
   if(peek()==='('){at++;const args=[expression()];while(peek()===','){at++;args.push(expression());}if(tokens[at++]!==')')throw Error('함수의 닫는 괄호가 필요합니다.');const functions={min:Math.min,max:Math.max,abs:Math.abs,sqrt:Math.sqrt};const fn=Object.hasOwn(functions,t)?functions[t]:null;if(!fn)throw Error(`지원하지 않는 함수: ${t}`);if(['abs','sqrt'].includes(t)&&args.length!==1)throw Error(`${t} 함수는 인수가 1개여야 합니다.`);n=fn(...args);}
   else {if(!Object.hasOwn(variables,t))throw Error(`정의되지 않은 변수: ${t}`);n=Number(variables[t]);}
  }else throw Error('숫자 또는 변수가 필요합니다.');
  while(peek()==='%'){at++;n/=100;}depth--;return n;
 }
 function power(){let n=primary();if(peek()==='^'){at++;n=n**unary();}return n;}
 function unary(){if(peek()==='+'){at++;return unary();}if(peek()==='-'){at++;return -unary();}return power();}
 function term(){let n=unary();while(['*','/'].includes(peek())){const op=tokens[at++],b=unary();if(op==='/'&&b===0)throw Error('0으로 나눌 수 없습니다.');n=op==='*'?n*b:n/b;}return n;}
 function expression(){let n=term();while(['+','-'].includes(peek())){const op=tokens[at++],b=term();n=op==='+'?n+b:n-b;}return n;}
 const result=expression();if(at!==tokens.length)throw Error(`계산식 구분을 확인하세요: ${tokens[at]}`);if(!Number.isFinite(result)||Math.abs(result)>1e14)throw Error('계산값이 범위를 벗어났습니다.');return Number(result.toPrecision(14));
}
export function evaluateVariables(text='') {
 const values=Object.create(null),rows=[];
 for(const raw of text.split(/\r?\n/)){const line=raw.split('#')[0].trim();if(!line)continue;const m=/^([A-Za-z_][A-Za-z_0-9]*)\s*=\s*(.+)$/.exec(line);if(!m)throw Error(`변수는 Q = 600/8 형태로 입력하세요: ${line}`);if(Object.hasOwn(values,m[1]))throw Error(`중복 변수: ${m[1]}`);const value=evaluateFormula(m[2],values);values[m[1]]=value;rows.push({name:m[1],expression:m[2],value});}
 return {values,rows};
}
