/* Catalogue identities for input UIs. Work-rule aliases and prices stay separate. */
(function(root){
'use strict';
const compact=v=>String(v??'').normalize('NFKC').toLowerCase().replace(/[\s\u200b-\u200d\ufeff,._\-()[\]]/g,'');
function nameKey(value){
 let n=compact(value).replace(/소프트(?:실)?(?:제수|지수)(?:밸브|변)/g,'소프트제수밸브').replace(/보도(?:용)?블[럭록]/g,'보도블록').replaceAll('계량기보호함','계량기보호통').replaceAll('xl정티','xl삼방티').replaceAll('관로모래부설','모래부설');
 n=n.replace(/^앵글밸브(?:10kg\/cm2)?(?:자재포함)?$/,'앵글밸브교체');
 return ({'pe접합및부설':'pe관접합및부설','sts접합및부설':'sts관접합및부설','sts관부설및접합':'sts관접합및부설','되메우기':'되메우기및다짐','이탈방지압륜kp부속':'이탈방지압륜','아스팔트소운반':'아스콘소운반','소형감압밸브설치':'소형감압변설치','frp보호통':'frp제수밸브보호통','새들붙이분수전pe관용':'새들붙이분수전pe용','sts엘보':'sts엘보나사식'})[n]||n;
}
function specKey(value){
 let s=String(value??'').normalize('NFKC').toLowerCase().replace(/\s+/g,'').replace(/[×*]/g,'x').replaceAll('ton','톤').replace(/(금강송|후포|온정|평해|울진|죽변|기성|근남|매화|북)(?:읍|면)/g,'$1').replace(/(dn|d|[φø∅])=/g,'$1');
 s=s.replace(/(^|[=(/,x·;\-])(?:dn|d|s(?=\d+(?:\.\d+)?su)|[φø∅])?(\d+(?:\.\d+)?)(?:su|a|mm)?(?=$|[)/,x·;\-])/g,(_,p,n)=>p+'d'+Number(n));
 return s.includes('백호')?s.replace(/기계(?=\d+%)/g,''):s;
}
const unitKey=v=>{const u=compact(v).replaceAll('당','').replaceAll('^','');return ({'톤':'ton','t':'ton','리터':'l','미터':'m','제곱미터':'m2','세제곱미터':'m3'})[u]||u;};
const pipeKey=v=>specKey(v).replace(/d(?:13|15|16)(?=$|[)/,x·;\-])/g,'d15');
const diameters=v=>{const s=pipeKey(v).replace(/(?:dn|d|[φø∅])=?(\d+(?:\.\d+)?)(?:su|a|mm)?/g,(_,n)=>'d'+([13,15,16].includes(Number(n))?15:Number(n)));const m=s.match(/(?:^|[(:/])d(\d+(?:\.\d+)?)(?:xd?(\d+(?:\.\d+)?))?/);return m?[m[1],m[2]].filter(Boolean).map(Number):[];};
const safeUnit=(a,b)=>unitKey(a)===unitKey(b)||[unitKey(a),unitKey(b)].every(v=>['개','개소','ea'].includes(v));
function saddlePair(value){
 const s=String(value??'').normalize('NFKC').toLowerCase().replace(/\s/g,'').replace(/[×*]/g,'x').replace(/[〜∼–—]/g,'~').replace(/(dn|d|[φø∅])=/g,'$1');
 const n='(?:dn|d|[φø∅])?(\\d+(?:\\.\\d+)?)(?:su|a|mm)?';
 const m=s.match(new RegExp('^'+n+'x\\(?'+n+'(?:[~\\-]'+n+')?\\)?$'));
 if(!m)return null;
 const [main,low,high]=[Number(m[1]),Number(m[2]),Number(m[3]||m[2])];
 return main>0&&low>0&&low<=high&&high<=main?{main,low,high}:null;
}
const saddleContains=(source,target)=>{const a=saddlePair(source),b=saddlePair(target);return !!a&&!!b&&a.main===b.main&&a.low>=b.low&&a.high<=b.high;};
const saddleWork=x=>x.kind==='work'&&nameKey(x.name)==='부단수새들분수전분기';
const searchRecord=item=>({item,name:nameKey(item.name),code:compact(item.code),spec:pipeKey(item.spec),textSpec:compact(item.spec),unit:unitKey(item.unit)});
function searchPredicate(query){
 const raw=String(query??'').normalize('NFKC').toLowerCase().replace(/\s+/g,'').replace(/(dn|d|[φø∅])=/g,'$1'),q=nameKey(query);
 if(!raw)return ()=>true;
 const text=compact(query),code=/^[a-z]\d{5,}$/.test(text),queryUnit=unitKey(query);
 const sameUnit=(a,b)=>a===b||['개','개소','ea'].includes(a)&&['개','개소','ea'].includes(b);
 // Split only a trailing nominal diameter, optionally followed by a unit.
 // Keeping its name separately permits "PE 소켓 D20SU EA" without treating
 // D20 as a substring of D200 or stripping a material/connection-method name.
 const parts=raw.match(/^(.*?)((?:dn|d|[φø∅]|s(?=\d+(?:\.\d+)?su))?\d+(?:\.\d+)?(?:su|a|mm)?(?:[x×*](?:dn|d|[φø∅])?\d+(?:\.\d+)?(?:su|a|mm)?)*)((?:개소|개|ea\.?|본|조|대|기|m|㎥|㎡|m[23]|kg|ton|톤|t|l|ℓ)?)$/);
 const prefix=parts?nameKey(parts[1]):'',wanted=parts?pipeKey(parts[2]):'',unit=parts?unitKey(parts[3]):'';
 return record=>{
 if(record.name.includes(q)||code&&record.code.includes(text))return true;
 if(parts){
  const actual=record.spec;
  const sameSize=actual===wanted||['(', '/', ';', '·'].some(mark=>actual.startsWith(wanted+mark))||saddleWork(record.item)&&saddleContains(parts[2],record.item.spec);
  return record.name.includes(prefix)&&sameSize&&(!unit||sameUnit(unit,record.unit));
 }
 return record.textSpec.includes(text)||sameUnit(queryUnit,record.unit);
 };
}
const matchesQuery=(item,query)=>searchPredicate(query)(searchRecord(item));
const countUnit=v=>['개','개소','ea','조','기','대','본','매','set'].includes(unitKey(v));
const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
const original=row=>({name:String(row?.name??''),spec:String(row?.spec??row?.std??''),unit:String(row?.unit??'')});
const sameOriginal=(a,b)=>['name','spec','unit'].every(k=>String(a?.[k]??'').trim()===String(b?.[k]??'').trim());
const copy=row=>JSON.parse(JSON.stringify(row));
const finiteQuantity=q=>typeof q!=='boolean'&&q!==null&&q!==''&&Number.isFinite(Number(q))&&Number(q)>=0;
const loads=new Map();
function create(catalog){
 if(!catalog||catalog.schema!==1||!Array.isArray(catalog.items))throw Error('단가 DB 품목 기준 파일을 확인하세요.');
 const items=catalog.items.map(x=>Object.freeze({...x})),byId=new Map(),index=new Map(),familyCache=new Map(),searchCache=new Map();
 for(const item of items){
  if(!item||typeof item.id!=='string'||byId.has(item.id)||!['material','work'].includes(item.kind)||!['name','spec','unit','source','code'].every(k=>typeof item[k]==='string'))throw Error('단가 DB 품목 기준이 중복되었거나 손상되었습니다.');
  byId.set(item.id,item);const k=nameKey(item.name);if(!index.has(k))index.set(k,[]);index.get(k).push(item);
 }
 const preferred=xs=>xs.filter(x=>x.role==='assembly').length?xs.filter(x=>x.role==='assembly'):xs;
 // Source priority belongs to each material family, not to the entire search.
 // Keep all records in byId/family so an existing saved selection stays intact.
 const additionalMaterials=new Set(items.filter(x=>x.kind==='material'&&x.role==='assembly').map(x=>nameKey(x.name)));
 const visible=xs=>xs.filter(x=>x.kind!=='material'||x.role==='assembly'||!additionalMaterials.has(nameKey(x.name)));
 const searchItems=visible(items).map(searchRecord);
 function family(name,kind){
  const key=nameKey(name),cacheKey=kind+'|'+key;if(familyCache.has(cacheKey))return familyCache.get(cacheKey);
  let result=(index.get(key)||[]).filter(x=>!kind||x.kind===kind);
  if(!result.length)for(const [candidate,rows] of index)if(candidate.startsWith(key)&&key.length>=4)result.push(...rows.filter(x=>(!kind||x.kind===kind)&&x.name.split('(')[0].replaceAll(' ','')===String(name).replaceAll(' ','')));
  if(kind==='work'&&key==='kp메커니컬접합및부설')for(const [candidate,rows] of index)if(candidate.startsWith(key))result.push(...rows.filter(x=>x.kind===kind));
  result=[...new Map(result.map(x=>[x.id,x])).values()];familyCache.set(cacheKey,result);return result;
 }
 function ordered(xs,spec){return [...xs].sort((a,b)=>Number(a.role!=='assembly')-Number(b.role!=='assembly')||Number(specKey(a.spec)!==specKey(spec))-Number(specKey(b.spec)!==specKey(spec))||a.spec.localeCompare(b.spec,'ko')||a.code.localeCompare(b.code));}
 function chooseAutomatic(row,kind){
  const r=original(row),xs=visible(family(r.name,kind)),base=visible((index.get(nameKey(r.name))||[]).filter(x=>!kind||x.kind===kind));let exact=base.filter(x=>specKey(x.spec)===specKey(r.spec));
  const equivalent=kind==='work'&&['나사식접합','계량기설치','계량기보호통설치','소형감압변설치'].includes(nameKey(r.name));
  if(!exact.length&&(equivalent||/관|밸브|소켓|파이프|티|엘보|플랜지/.test(nameKey(r.name))))exact=base.filter(x=>pipeKey(x.spec)===pipeKey(r.spec));
  if(saddleWork({name:r.name,kind}))exact=base.filter(x=>saddleContains(r.spec,x.spec));
  exact=preferred(exact);const canonical=exact.filter(x=>compact(x.name)===nameKey(r.name));if(canonical.length)exact=canonical;
  return {match:exact.length===1&&r.unit&&safeUnit(r.unit,exact[0].unit)?exact[0]:null,candidates:ordered(xs,r.spec),exact};
 }
 function selected(row,kind){
  const saved=row?.quantityDb;if(!saved)return null;
  const item=byId.get(saved.id),r=original(row);
  if(!item||item.kind!==kind||!sameOriginal(saved.original,r)||!['source','code','name','spec','unit','kind'].every(k=>saved[k]===item[k]))return {error:'입력 품명·규격·단위가 바뀌었습니다. DB 품목을 다시 선택하세요.'};
  if(saved.unitConfirmed&&!safeUnit(r.unit,item.unit)&&(!finiteQuantity(saved.quantity)||Number(saved.quantity)!==Number(row.qty)))return {error:'확인한 DB 단위의 수량이 바뀌었습니다. 다시 확인하세요.'};
  if(!family(r.name,kind).some(x=>x.id===item.id))return {error:'선택한 DB 품목과 내부 작업 종류가 다릅니다.'};
  if(!nominalSafe(row,item))return {error:'선택한 DB 품목의 관경이 다릅니다. 입력 규격을 확인하고 다시 선택하세요.'};
  if(!safeUnit(r.unit,item.unit))return {error:'DB 단위와 입력 단위를 확인하세요.'};
  return {item};
 }
 function identify(row,kind){
  const found=chooseAutomatic(row,kind),saved=selected(row,kind);
  if(saved?.error)return {match:null,candidates:found.candidates,status:'stale',reason:saved.error};
  if(saved)return {match:saved.item,candidates:found.candidates,status:'selected',reason:''};
  return {...found,status:found.match?'matched':'review',reason:found.match?'':!found.candidates.length?'DB에 같은 작업 종류가 없습니다.':found.exact.length===1&&!safeUnit(original(row).unit,found.exact[0].unit)?'DB 단위와 입력 단위를 확인하세요.':'DB 규격·작업 방법을 선택하세요.'};
 }
 function nominalSafe(row,item){
  if(saddleWork(item)&&nameKey(row.name)===nameKey(item.name))return saddleContains(original(row).spec,item.spec);
  if(!/관|밸브|소켓|파이프|티|엘보|플랜지|나사식|제수|천공|할정자|kp/.test(nameKey(row.name)))return true;
  const a=diameters(original(row).spec),b=diameters(item.spec);
  // KP catalogue bands are applicable diameters, not a different nominal pipe.
  // This is used only after deliberate selection, never automatic matching.
  if(item.kind==='work'&&nameKey(row.name).startsWith('kp메커니컬접합및부설')&&a.length===1){
   const bound=String(item.spec).normalize('NFKC').replace(/\s/g,'').match(/^(?:DN|D|[ΦφØø∅])=?(\d+(?:\.\d+)?)(?:mm)?(이하|미만|이상|초과)(?:\(이탈방지압륜사용\))?$/i);
   if(bound){const n=Number(bound[1]);return {'이하':a[0]<=n,'미만':a[0]<n,'이상':a[0]>=n,'초과':a[0]>n}[bound[2]];}
  }
  // This catalogue records only the PE pipe side. Keep the explicit thread
  // diameter in the rule input; selecting its material must not erase it.
  if(item.kind==='material'&&nameKey(row.name)==='pe청동밸브소켓'&&a.length===2&&b.length===1)return a[0]===b[0];
  return !a.length||!b.length||a.length===b.length&&a.every((v,i)=>v===b[i]);
 }
 function select(row,id,{kind,confirmUnit=false,quantity}={}){
  const item=byId.get(id),r=original(row);kind=kind||item?.kind;
  if(!item||item.kind!==kind||!family(r.name,kind).some(x=>x.id===id))throw Error('같은 자재·작업 종류의 DB 품목을 선택하세요.');
  if(!nominalSafe(row,item))throw Error('선택한 DB 품목의 관경이 다릅니다. 입력 규격을 먼저 수정하세요.');
  const next=copy(row);let converted=false;
  if(!safeUnit(r.unit,item.unit)){
   if(!countUnit(r.unit)||!countUnit(item.unit)||unitKey(r.unit)==='본'||unitKey(item.unit)==='본')throw Error('단위 기준이 다릅니다. 실제 수량과 입력 단위를 먼저 수정한 뒤 DB 품목을 선택하세요.');
   if(!confirmUnit||!finiteQuantity(quantity))throw Error('DB 단위 기준의 실제 수량을 입력하고 확인하세요.');
   next.originalQuantity??={qty:row.qty,unit:r.unit};next.qty=Number(quantity);next.unit=item.unit;converted=true;
  }
  next.quantityDb={...Object.fromEntries(['id','source','code','name','spec','unit','kind'].map(k=>[k,item[k]])),original:original(next),unitConfirmed:converted,...(converted?{quantity:next.qty}:{})};
  return next;
 }
 function familyView(name,kind){
  const candidates=ordered(visible(family(name,kind)),'');const xs=preferred(candidates),names=[...new Set(xs.map(x=>x.name))],units=[...new Set(xs.map(x=>x.unit))];
  return {name:names.length===1?names[0]:String(name??''),unit:units.length===1?units[0]:'',candidates,needsSelection:names.length!==1||units.length!==1};
 }
 function view(row,kind){
  const state=identify(row,kind),x=state.match;
  if(x){const r=original(row),keepPair=x.kind==='material'&&nameKey(r.name)==='pe청동밸브소켓'&&diameters(r.spec).length===2&&diameters(x.spec).length===1;return {name:x.name,spec:keepPair?r.spec:x.spec,unit:x.unit,status:state.status,identity:x,needsSelection:false,reason:''};}
  const f=familyView(original(row).name,kind);
  const r=original(row);
  return {name:f.name,spec:r.spec,unit:f.unit&&safeUnit(r.unit,f.unit)?f.unit:r.unit,status:state.status,identity:null,needsSelection:true,reason:state.reason};
 }
 function contract(row,kind){
  const state=identify(row,kind);if(state.status==='stale')throw Error(state.reason);if(!state.match)return null;
  const saved=row.quantityDb||select(row,state.match.id,{kind:state.match.kind}).quantityDb;
  return {...original(row),qty:row.qty,quantityDb:copy(saved),original:original(row),id:state.match.id,kind:state.match.kind,confirmUnit:!!saved.unitConfirmed,...(saved.unitConfirmed?{quantity:saved.quantity}:{})};
 }
 function clear(row){const next=copy(row);delete next.quantityDb;return next;}
 function search(query,kind,{limit=100}={}){
  const key=kind+'|'+String(query??'').normalize('NFKC').toLowerCase().replace(/\s+/g,'');let found=searchCache.get(key);
  if(!found){const matches=searchPredicate(query);found=ordered(searchItems.filter(x=>(!kind||x.item.kind===kind)&&matches(x)).map(x=>x.item),'');if(searchCache.size>=100)searchCache.delete(searchCache.keys().next().value);searchCache.set(key,found);}
  return found.slice(0,Math.max(1,Math.min(1000,Number(limit)||100)));
 }
 return Object.freeze({identify,select,view,contract,clear,familyView,search,get:id=>byId.get(id)||null,version:catalog.version,size:items.length});
}
async function load(url){if(!loads.has(url))loads.set(url,fetch(url).then(r=>{if(!r.ok)throw Error('단가 DB 품목 기준을 불러오지 못했습니다.');return r.json();}).then(create).catch(e=>{loads.delete(url);throw e;}));return loads.get(url);}
root.QuantityDbIdentity=Object.freeze({create,load,nameKey,specKey,unitKey,safeUnit,diameters,pipeKey,matchesQuery,saddleContains});
})(typeof globalThis!=='undefined'?globalThis:window);
