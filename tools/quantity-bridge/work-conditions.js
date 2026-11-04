/* Physical connection rules shared by both quantity generators. No prices here. */
(function(root){
'use strict';
const compact=v=>String(v??'').normalize('NFKC').replace(/\s/g,'').toLowerCase();
const clone=x=>JSON.parse(JSON.stringify(x));
function diameters(value){
 const text=String(value??'').normalize('NFKC').replace(/\s/g,'').replace(/^(?:본관|관측)[:：]?/,'');
 const m=text.match(/^(?:(?:DN|D|S|[ΦφØø∅])=?)*([0-9]+(?:\.[0-9]+)?)(?:mm|SU|A)?(?:[xX×*](?:(?:DN|D|S|[ΦφØø∅])=?)*([0-9]+(?:\.[0-9]+)?)(?:mm|SU|A)?)?(?=$|[(/,;·])/i);
 return m?[m[1],m[2]].filter(Boolean).map(Number):[];
}
function diameter(v){const a=diameters(v);return a.length===1&&a[0]>0?a[0]:null;}
function category(m){
 const n=compact(m.name);
 if(n.includes('부단수할정자관'))return 'saddle';
 if(/^소프트(?:실)?(?:제수|지수)(밸브|변)/.test(n)||n==='제수밸브'||n==='제수변')return 'valve';
 if(n==='pe청동밸브소켓'||n==='sts밸브소켓')return 'socket';
 if(n.includes('이탈방지압륜'))return 'restraint';
 if(n.includes('pe소켓플랜지')||n==='합플랜지'||n==='플랜지관')return 'flange';
 if(n.includes('kp'))return 'kp';
 if(n==='sts소켓')return 'sts-socket';
 return '';
}
function resolve(input,options={}){
 const materials=clone(input||[]),works=[],issues=[],allowances=[],handledIds=[],handledIndexes=[];
 const ids=new Map(),infos=[],ledger=new Map(),restraints=[];
 const problem=(m,message)=>issues.push({materialId:String(m.id),message:`${m.name}: ${message}`});
 materials.forEach((m,i)=>{m.id=String(m.id??m._id??`material-${i}`);if(ids.has(m.id))problem(m,'자재 식별번호가 중복되었습니다.');ids.set(m.id,m);});
 const add=(m,name,spec,qty,unit,extra={})=>{if(qty>0)works.push({name,spec,qty,unit,sourceId:m.id,conditionKey:JSON.stringify([m.id,name,spec,unit,extra.jointId||'']),auto:true,...extra});};
 const dspec=d=>'D'+d;
 function number(m,v,label,positive=false){const n=typeof v==='boolean'||v===null||v===''?NaN:Number(v);if(!Number.isFinite(n)||n<0||(positive&&n<=0)){problem(m,`${label}을 ${positive?'0보다 큰':'0 이상의'} 숫자로 입력하세요.`);return null;}return n;}
 function count(m,w){
  const originalUnit=compact(m.unit),q=number(m,m.qty,'수량');if(q===null)return null;
  if(['개','개소','개당','개소당','기','기당','ea','조'].includes(originalUnit))return category(m)==='saddle'&&w.installationCount!==undefined&&w.installationCount!==''?number(m,w.installationCount,'실제 설치 개소',true):q;
  const c=number(m,w.materialCount,'실제 자재 개수',true),s=number(m,w.installationCount,'실제 설치 개소',true);
  if(c===null||s===null)return null;
  m.originalQuantity??={qty:m.qty,unit:m.unit};m.qty=c;m.unit='개';return s;
 }
 function joints(m,w,defaultDia,provider='',capacity=null){
  if(!Array.isArray(w.flangeJoints)||!w.flangeJoints.length){problem(m,'실제 플랜지 접합부 번호를 입력하세요.');return;}
  if(capacity!==null&&w.flangeJoints.length>capacity){problem(m,'실제 개소보다 플랜지 접합부 번호가 많습니다. 개수와 번호를 확인하세요.');return;}
  const own=new Set();
  for(const raw of w.flangeJoints){
   const j=typeof raw==='string'?{id:raw}:raw||{},id=String(j.id??'').trim(),d=diameter(j.diameter||defaultDia);
   if(!id||own.has(id)||!d){problem(m,'접합부 번호 중복 또는 관경을 확인하세요.');continue;}own.add(id);
   if(d!==diameter(defaultDia)){problem(m,'플랜지 접합부 관경이 해당 자재·밸브·지관 관경과 다릅니다.');continue;}
   const mode=j.mode||'separate';if(!['separate','included'].includes(mode)){problem(m,'접합부 계상 방식을 선택하세요.');continue;}
   const item={m,id,d,mode,coveredBy:String(j.coveredBy||''),provider};
   if(!ledger.has(id))ledger.set(id,[]);ledger.get(id).push(item);
  }
 }
 for(const [i,m] of materials.entries()){
  const type=category(m);if(!type)continue;handledIds.push(m.id);handledIndexes.push(i);
  const w=m.workConditions||{},spec=String(m.spec??m.std??''),ds=diameters(spec),n=compact(m.name);
  if(type==='saddle'){
   if(typeof w!=='object'||Array.isArray(w)){problem(m,'작업 조건을 다시 입력하세요.');continue;}
   // This water-service workflow always drills a saddle. Normalize legacy false
   // values as well; missing sizes/counts still require explicit review below.
   w.drilling=true;m.workConditions=w;
  }
  let q=number(m,m.qty,'수량');if(q===null||q===0)continue;
  const info={m,type,w,spec,ds,q};infos.push(info);
  if(type==='restraint'){restraints.push(info);continue;}
  if(type==='saddle'){
   q=count(m,w);if(q===null)continue;
   const main=diameter(w.mainDiameter||ds[0]),branch=diameter(w.branchDiameter||ds[1]);
   if(ds.length&&(main!==ds[0]||(ds.length>1&&branch!==ds[1]))){problem(m,'본관·지관 조건과 자재 규격이 다릅니다. 자재 규격을 함께 수정하세요.');continue;}
   if(!main){problem(m,'본관 관경을 지정하세요.');continue;}
   if(!branch||branch>main){problem(m,'본관 이하의 지관 관경을 지정하세요.');continue;}
   info.main=main;info.branch=branch;info.q=q;
   add(m,'부단수할정자관부설및접합',dspec(main),q,'개소');
   add(m,'부단수 천공 분기점 분기',dspec(branch),q,'개소');joints(m,w,branch,'drilling',q);
  }else if(type==='valve'){
   q=count(m,w);if(q===null)continue;info.q=q;
   const explicitThread=/\(나사식\)$/.test(n),connection=w.connectionType||(explicitThread?'threaded':'');
   const form=w.valveType||(/^소프트/.test(n)?'soft-seal-gate':'');
   if(!['threaded','flanged'].includes(connection)||!['soft-seal-gate','cast-iron-gate'].includes(form)){problem(m,'접합방식과 밸브 형식을 선택하세요.');continue;}
   if(explicitThread&&connection!=='threaded'){problem(m,'나사식 자재에는 플랜지식 품을 적용할 수 없습니다.');continue;}
   if(connection==='threaded'&&form!=='soft-seal-gate'){problem(m,'이 밸브 형식의 나사식 설치품을 확인하세요.');continue;}
   const d=diameter(ds[0]);if(!d){problem(m,'밸브 관경을 지정하세요.');continue;}
   info.d=d;info.connection=connection;
   if(!w.valveCoveredBy)add(m,connection==='threaded'?'소프트실제수밸브설치':'제수변부설및접합',dspec(d),q,'개소');
   if(connection==='flanged')joints(m,w,d,w.valveCoveredBy?'':'valve',q*2);
  }else if(type==='socket'){
   q=count(m,w);if(q===null)continue;
   const p=diameter(w.pipeDiameter||ds[0]),t=diameter(w.threadDiameter||ds[1]||ds[0]);
   if(ds.length&&(p!==ds[0]||t!==(ds[1]||ds[0]))){problem(m,'관측·나사측 조건과 자재 규격이 다릅니다. 자재 규격을 함께 수정하세요.');continue;}
   if(!p||!t){problem(m,'관측·나사측 관경을 각각 확인하세요.');continue;}
   add(m,n.startsWith('pe')?'PE이형관접합':'STS이형관접합',dspec(p),q,'개소');add(m,'나사식접합',dspec(t),q,'개소');
  }else if(type==='flange'){
   q=count(m,w);if(q===null)continue;const d=diameter(ds[0]);if(!d){problem(m,'플랜지 관경을 지정하세요.');continue;}
   if(n.includes('pe소켓플랜지'))add(m,'PE이형관접합',dspec(d),q,'개소');
   joints(m,w,d,'',q);
  }else if(type==='kp'){
   const d=diameter(ds[0]);if(!d){problem(m,'KP 관경을 지정하세요.');continue;}
   const straight=n.includes('직관'),u=compact(m.unit);
   if(straight&&!['m','미터','본'].includes(u)){problem(m,'직관은 길이(M) 또는 6m 기준 본수로 입력하세요.');continue;}
   if(!straight){q=count(m,w);if(q===null)continue;}
   else if(u!=='본')q=Math.ceil(q/6);
   info.q=q;info.d=d;
   const included=w.kpVariant==='restraint-included';
   if(d===300&&included&&!w.kpSourceReviewed)problem(m,'D300 압륜포함 원본 DB는 일반품과 인력계수도 다릅니다. 산출근거를 확인하세요.');
   add(m,'KP메커니컬 접합 및 부설',dspec(d)+(included?'(이탈방지압륜사용)':''),q,'본');
   if(n.includes('플랜지'))joints(m,w,d,'',q);
  }else if(type==='sts-socket'){
   const role=m.autoSock?'basic':w.stsSocketRole;
   if(!['basic','extra'].includes(role)){problem(m,'6m 정척관 기본 연결인지 중간 추가 소켓인지 선택하세요.');continue;}
   if(role==='extra')add(m,'STS이형관접합',spec,q,'개소');
  }
 }
 // A declared source must actually supply the same physical flange junction.
 for(const [id,entries] of ledger){
  if(new Set(entries.map(x=>x.d)).size!==1){for(const e of entries)problem(e.m,`접합부 ${id}의 관경이 서로 다릅니다.`);continue;}
  const providers=entries.filter(x=>x.provider),providerIds=new Set(providers.map(x=>x.m.id));
  if(providerIds.size>1){for(const e of providers)problem(e.m,`접합부 ${id}가 둘 이상의 포함품에 계상되었습니다.`);continue;}
  let invalid=false;
  for(const e of entries)if(e.mode==='included'&&!entries.some(p=>p.m.id===e.coveredBy&&(p.provider||p.mode==='separate'))){problem(e.m,`접합부 ${id}를 계상한 대상 품을 연결하세요.`);invalid=true;}
  if(!invalid&&!providers.length){const owner=entries.find(x=>x.mode==='separate');if(!owner){for(const e of entries)problem(e.m,`접합부 ${id}를 실제로 계상하는 품이 없습니다.`);}else add(owner.m,'플랜지조인트접합',dspec(owner.d),1,'개소',{jointId:id});}
 }
 const claimedValves=new Map();
 for(const info of infos.filter(x=>x.type==='valve'&&x.w.valveCoveredBy)){
  const src=infos.find(x=>x.m.id===String(info.w.valveCoveredBy)&&x.type==='saddle'&&x.w.drilling===true);
  const valveIds=new Set((info.w.flangeJoints||[]).map(x=>String(x.id||x))),sourceIds=new Set((src?.w.flangeJoints||[]).map(x=>String(x.id||x)));
  if(!src||info.connection!=='flanged'||src.branch!==info.d||src.q!==info.q||![...valveIds].some(id=>sourceIds.has(id)))problem(info.m,'천공품에 이미 포함된 동일 밸브인지 지관 관경·개소·접합부 번호를 확인하세요.');
  else{const claimed=(claimedValves.get(src.m.id)||0)+info.q;claimedValves.set(src.m.id,claimed);if(claimed>src.q)problem(info.m,'같은 천공품에 밸브 접합이 중복 연결되었습니다.');}
 }
 const usedTargets=new Set();
 for(const info of restraints){
  const {m,w}=info,a=w.kpAllowance||{},target=infos.find(x=>x.m.id===String(a.targetMaterialId)&&x.type==='kp');
  if(a.state==='none'){if(!String(a.reason||'').trim())problem(m,'가산하지 않는 사유를 입력하세요.');continue;}
  if(!target){problem(m,'압륜을 적용할 KP 자재·품을 선택하세요.');continue;}
  const key=target.m.id;
  if(usedTargets.has(key)){problem(m,'같은 KP 품에 압륜 가산이 중복 지정되었습니다.');continue;}usedTargets.add(key);
  if(a.state==='included'){
   if(target.w.kpVariant!=='restraint-included')problem(m,'대상 KP 품은 압륜 가산 포함품이 아닙니다. 적용품을 확인하세요.');
   continue;
  }
  if(a.state!=='add'){problem(m,'압륜 가산의 포함 여부를 선택하세요.');continue;}
  if(target.w.kpVariant==='restraint-included'){problem(m,'압륜 가산이 포함된 KP 품에 다시 가산할 수 없습니다.');continue;}
  const p=number(m,a.percent,'가산율');if(p===null)continue;
  if(p>30){problem(m,'압륜 가산율은 30% 범위 안에서 지정하세요.');continue;}
  if(!String(a.reason||'').trim()){problem(m,'압륜 가산 적용 근거를 입력하세요.');continue;}
  const base=works.find(x=>x.sourceId===target.m.id&&x.name==='KP메커니컬 접합 및 부설');
  if(!base){problem(m,'대상 KP 품의 수량을 확인하세요.');continue;}
  if(p>0){const allowance={targetMaterialId:target.m.id,targetName:base.name,targetSpec:base.spec,targetUnit:base.unit,targetQuantity:base.qty,percent:p,basis:'all-components',reason:String(a.reason).trim()};
   allowances.push(allowance);add(m,'이탈방지압륜 가산',`KP ${base.spec} · 대상 ${base.qty}본`,p,'%',{allowance});}
 }
 return {materials,handledIds,handledIndexes,works,issues,allowances,workConnectionJoints:[...ledger].map(([id,entries])=>({id,diameter:entries[0].d}))};
}
root.WorkConditions={version:2,category,diameters,resolve};
if(typeof module!=='undefined'&&module.exports)module.exports=root.WorkConditions;
})(typeof globalThis!=='undefined'?globalThis:this);
