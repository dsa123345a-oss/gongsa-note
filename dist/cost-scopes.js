const compact=s=>String(s||'').replace(/\s/g,'').replace(/^\d+[.、)]/,'');
export const separateBucket=name=>/관급/.test(compact(name))?'government':/폐기물|현장점검비/.test(compact(name))?'waste':/수수료|원인자부담금|분담금/.test(compact(name))?'fees':null;
export const costScopeLabels={direct:'직접공사비',waste:'별도 · 부가세만',government:'관급자재대',fees:'수수료·부담금'};
export function resolveCostScopes(lines){
 const stack=[];
 return lines.map(source=>{
  const l={...source};
  if(l.level){
   if(l.separateTail)stack.length=0;
   while(stack.length&&stack.at(-1).level<=l.level)stack.pop();
   const own=l.costScope??(l.level===1?separateBucket(l.name):null),parent=stack.at(-1)?.scope;
   const scope=own==='direct'?null:own?{id:l.id,name:l.name,bucket:own}:parent;
   stack.push({level:l.level,scope});l.bucket=scope?.bucket||'direct';
   if(scope)l.costScopeSource={...scope};else delete l.costScopeSource;
   return l;
  }
  const scope=stack.at(-1)?.scope;
  if(scope){l.bucket=scope.bucket;l.costScopeSource={...scope,priorBucket:source.costScopeSource?.priorBucket??source.bucket??'direct'};}
  else if(l.costScopeSource){l.bucket=l.costScopeSource.priorBucket||'direct';delete l.costScopeSource;}
  return l;
 });
}
// Preserve the owning section before moving separate-cost blocks out of L2.
// Stable IDs and stored section labels make this safe to repeat on load/edit.
export function arrangeSeparateCosts(lines){
 if(!lines.some(l=>l.level>=2))return lines;
 const direct=[],blocks=[],types=new Map();let section=null,number=0;
 for(let i=0;i<lines.length;){
  const source=lines[i];
  if(source.level>=2){number++;section={id:source.id,number:source.sectionNumber||Number(source.sectionLabel?.match(/\d+/)?.[0])||Number(String(source.name||'').match(/(\d+)\s*공구/)?.[1])||number};}
  if(source.level===1&&source.bucket!=='direct'){
   const owner=source.separateSection||(source.separateTail?null:section),block=[];let end=i+1;
   while(end<lines.length&&!(lines[end].level>=source.level))end++;
   for(let j=i;j<end;j++)block.push({...lines[j],...(j===i?{separateTail:true}:{}),...(owner&&!lines[j].sectionLabel?{separateSection:{...owner}}:{})});
   const type=source.bucket+':'+compact(source.name);if(!types.has(type))types.set(type,types.size);
   blocks.push({type,order:blocks.length,number:owner?.number||0,lines:block});i=end;continue;
  }
  direct.push(source);i++;
 }
 blocks.sort((a,b)=>types.get(a.type)-types.get(b.type)||a.number-b.number||a.order-b.order);
 return [...direct,...blocks.flatMap(b=>b.lines)];
}
export const separateSectionLabel=line=>line.sectionLabel||(line.separateSection?.number?line.separateSection.number+'공구':'');
export function separateCostGroups(lines,amount,include){
 const groups=new Map();
 for(const l of lines){if(l.level||!include(l)||!['waste','government','fees'].includes(l.bucket))continue;
  const defaultName=l.bucket==='government'?'관급자재대':l.bucket==='waste'?(/현장점검/.test(compact(l.name+l.group))?'현장점검비':'폐기물처리비'):/원인자부담금|분담금/.test(compact(l.group+l.name))?'원인자부담금':/수수료/.test(compact(l.group+l.name))?'수수료':'수수료·부담금';
  const feeName=l.bucket==='fees'?(/원인자.*부담|분담금/.test(compact(l.name))?'원인자부담금':/수수료/.test(compact(l.name))?'수수료':null):null;
  const name=feeName||l.costScopeSource?.name||defaultName,key=l.bucket+':'+compact(name);
  if(!groups.has(key))groups.set(key,{key,name:name.replace(/^\s*\d+[.、)]\s*/,''),bucket:l.bucket,amount:0,missing:0,lineIds:[]});
  const group=groups.get(key),a=amount(l);group.lineIds.push(l.id);if(a)group.amount+=a.total;else group.missing++;
 }
 return [...groups.values()];
}
