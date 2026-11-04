import {norm,unitNorm} from './calc.js';
export const nameNorm=value=>norm(value).replace(/소프트(?:실)?(?:제수|지수)(?:밸브|변)/g,'소프트제수밸브').replace(/계량기보호함/g,'계량기보호통')
 .replace(/보도(?:용)?블[럭록]/g,'보도블록').replace(/xl정티/g,'xl삼방티').replace(/관로모래부설/g,'모래부설')
 .replace(/pe(?:관)?접합(?:및)?부설/g,'pe관접합및부설').replace(/이탈방지압륜kp부속/g,'이탈방지압륜')
 .replace(/^앵글밸브(?:10kg\/cm2)?자재포함$/,'앵글밸브교체').replace(/아스팔트(?=소운반)/g,'아스콘');
// Locality suffixes are labels, not different haul destinations. Keep this
// separate from arbitrary Korean words such as 표면 or 단면.
const localAliases={금강송면:'금강송',후포면:'후포',온정면:'온정',평해읍:'평해',울진읍:'울진',죽변면:'죽변',기성면:'기성',근남면:'근남',매화면:'매화',북면:'북면'};
const fullLocalNames=Object.keys(localAliases).join('|'),shortLocalNames=[...new Set(Object.values(localAliases))].join('|');
export const locationTextNorm=value=>String(value??'').normalize('NFKC').replace(new RegExp(fullLocalNames,'g'),v=>localAliases[v]);
// Normalize notation, not the stored specification or the material identity.
export const specNorm=value=>locationTextNorm(value).toLowerCase().replace(/\s+/g,'').replace(/[×*]/g,'x').replace(/ton/g,'톤').replace(/(dn|d|[φø∅])=/g,'$1')
 .replace(/(^|[=(/,x·;\-])(?:dn|d|s(?=\d+(?:\.\d+)?su)|[φø∅])?(\d+(?:\.\d+)?)(?:su|a|mm)?(?=$|[)/,x·;\-])/g,(_,prefix,size)=>prefix+'d'+Number(size));
export const pipeWork=row=>/관|파이프|밸브|제수변|수도미터|계량기|소켓|엘보|티이|티관|삼방티|레듀샤|레듀서|니플|플랜지|압륜/.test(nameNorm(row.name));
export function equivalentPipeDiameter(a,b){
 const x=specNorm(a),y=specNorm(b),alias=s=>s.replace(/d(?:13|15|16)(?=$|[)/,x·;\-])/g,'d15');
 return x!==y&&/d(?:13|15|16)(?=$|[)/,x·;\-])/.test(x)&&alias(x)===alias(y);
}
export function textSimilarity(a,b){
 if(!a||!b)return 0;if(a===b)return 1;
 if(/^[가-힣]$/.test(a)||/^[가-힣]$/.test(b))return 0;
 const grams=s=>new Set(Array.from({length:Math.max(0,s.length-1)},(_,i)=>s.slice(i,i+2)));
 const x=grams(a),y=grams(b);let hit=0;for(const g of x)if(y.has(g))hit++;
 return Math.max(2*hit/(x.size+y.size||1),a.includes(b)||b.includes(a)?0.76:0);
}
export function specNumbers(value){return (String(value??'').normalize('NFKC').replace(/m\^?[23]/gi,' ').match(/\d+(?:\.\d+)?/g)||[]).map(Number).sort((a,b)=>a-b);}
export function compareSpecs(a,b,{diameterAliases=false}={}){
 // Reducers in the added DB may cover a range, e.g. 40×(16~32).
 // Match each port in order; a range is not a third port or a reversible pair.
 const ports=s=>{
  const t=String(s??'').normalize('NFKC').toLowerCase().replace(/\s+/g,'').replace(/[×*]/g,'x').replace(/su|mm|a/g,'').replace(/(?:dn|d|s|[φø∅])=?/g,'');
  if(!/^\d+(?:\.\d+)?(?:x\(?\d+(?:\.\d+)?(?:[~～〜-]\d+(?:\.\d+)?)?\)?)+$/.test(t))return null;
  return t.split('x').map(p=>(p.match(/\d+(?:\.\d+)?/g)||[]).map(Number));
 };
 const ap=ports(a),bp=ports(b),ranged=diameterAliases&&ap&&bp&&ap.length===bp.length&&[...ap,...bp].some(p=>p.length===2);
 const rangeMatch=!!ranged&&ap.every((p,i)=>{const q=bp[i],alias=n=>[13,15,16].includes(n)?16:n;
  if(p.length===1&&q.length===1)return alias(p[0])===alias(q[0]);
  if(p.length===1)return alias(p[0])>=alias(q[0])&&alias(p[0])<=alias(q[1]);
  if(q.length===1)return alias(q[0])>=alias(p[0])&&alias(q[0])<=alias(p[1]);
  return p[0]===q[0]&&p[1]===q[1];});
 if(rangeMatch)return {text:1,numeric:1,mismatch:false,rangeMatch:true,equivalentDiameter:false,missingNumbers:false,score:63};
 const ordered=s=>(String(s??'').normalize('NFKC').replace(/m\^?[23]/gi,' ').match(/\d+(?:\.\d+)?/g)||[]).map(Number);
 // Reducers and tee ports are ordered dimensions, unlike an unordered list of numbers.
 const dimensions=[a,b].every(s=>/\d[^\d]*x(?:d)?\d/i.test(specNorm(s)));
 const x=dimensions?ordered(a):specNumbers(a),y=dimensions?ordered(b):specNumbers(b),equivalent=diameterAliases&&equivalentPipeDiameter(a,b),text=equivalent?1:textSimilarity(specNorm(a),specNorm(b));
 const mismatch=!!(x.length&&y.length&&JSON.stringify(x)!==JSON.stringify(y));
 let numeric=0;
 if(x.length&&y.length){const a=dimensions?x:[...new Set(x)],b=dimensions?y:[...new Set(y)],n=Math.max(a.length,b.length);numeric=a.reduce((sum,v,i)=>sum+(i<b.length?1-Math.abs(v-b[i])/Math.max(Math.abs(v),Math.abs(b[i]),1):0),0)/n;}
 return {text,numeric,mismatch:equivalent?false:mismatch,equivalentDiameter:equivalent,missingNumbers:!!x.length&&!y.length,score:equivalent?62:20*text+35*numeric+(x.length&&y.length&&!mismatch?15:0)-(x.length&&!y.length?12:0)};
}
export function compatibleUnits(line,item){
 const a=unitNorm(line.unit).replace(/당$/,''),b=unitNorm(item.unit).replace(/당$/,'');if(!a||!b||a===b)return true;
 const counts=new Set(['개','개당','ea','개소','개소당']);
 if(counts.has(a)&&counts.has(b))return true;
 // Meter sets in the supplied DB are sold as 조; do not generalize this to other sets.
 return [/수도미터/,/계량기보호통/,/이탈방지압륜/].some(re=>re.test(nameNorm(line.name))&&re.test(nameNorm(item.name)))&&[a,b].every(v=>counts.has(v)||v==='조');
}
function materials(row){
 const s=(String(row.name||'')+' '+String(row.spec||'')).normalize('NFKC').toLowerCase().replace(/([a-z])\s*[.]\s*(?=[a-z])/g,'$1'),found=new Set();
 for(const m of s.matchAll(/(?:^|[^a-z])(cpvc|pvc|sts|sus|pfp|hdpe|ldpe|pe|xl|pb|pp)(?=$|[^a-z])/g))found.add(({sus:'sts',hdpe:'pe',ldpe:'pe'})[m[1]]||m[1]);
 if(/스테인리스|스테인레스|스텐/.test(s))found.add('sts');
 if(/폴리에틸렌/.test(s))found.add('pe');
 if(/염화비닐/.test(s))found.add('pvc');
 if(/주철|덕타일/.test(s))found.add('주철');
 if(/강관/.test(s)&&!found.has('sts'))found.add('강관');
 if(/아스팔트|아스콘/.test(s))found.add('아스팔트');
 if(/콘크리트/.test(s))found.add('콘크리트');
 if(/보조기층/.test(s))found.add('보조기층');
 return found;
}
export function transportRoute(value){
 const s=String(value||'').normalize('NFKC').replace(/\s+/g,'').replace(/<[-=]>|[-=]>/g,'↔');
 return s.match(/([가-힣]+)[↔⇔→⇒]([가-힣]+)/)?.slice(1).map(locationTextNorm)||null;
}
const wasteWork=row=>/폐기물.*(?:처리|운반)/.test(nameNorm(row.name));
export function wasteMatchIssue(line){
 if(!wasteWork(line))return '';
 if(line.specError)return '폐기물 규격 수식 미계산';
 if(!materials(line).size)return '폐기물 재질 미확정';
 const place=wasteLocation(line);
 if(place.ambiguous)return '폐기물 운반 지역이 여러 곳으로 표시됨';
 if(!place.origin)return '폐기물 운반 지역 미확정';
 return '';
}
function wasteLocation(line){
 const routes=[transportRoute(line.spec),transportRoute(line.name)].filter(Boolean),uniqueRoutes=new Set(routes.map(r=>r.join('|')));
 if(uniqueRoutes.size>1)return {origin:'',ambiguous:true};
 if(routes.length)return {origin:routes[0][0]==='북'?'':routes[0][0],ambiguous:false};
 // Resolve each evidence level as a whole: two places in one section must not
 // silently select the first. A project title is supplied only for a single site.
 for(const texts of [[line.spec,line.name],[line.location,line.group,String(line.sourceFile||'').split(/[\\/]/).at(-1),...(line.wasteContext?.section||[])],line.wasteContext?.project||[]]){
  const places=new Set();
  for(const value of texts){
   const text=String(value||'').normalize('NFKC'),remaining=text.replace(new RegExp(fullLocalNames,'g'),v=>{places.add(localAliases[v]);return ' ';});
   for(const m of remaining.matchAll(new RegExp('(?:^|[^가-힣])('+shortLocalNames+')(?=$|[^가-힣])','g')))places.add(m[1]);
  }
  if(places.size)return {origin:places.size===1?[...places][0]:'',ambiguous:places.size>1};
 }
 return {origin:'',ambiguous:false};
}
const wasteOrigin=line=>wasteLocation(line).origin;
// A common "소운반" suffix must never make different loads interchangeable.
// Units on quantity sheets are not authoritative; identify load and method instead.
function shortHaul(row){
 const name=nameNorm(row.name),text=name+' '+nameNorm(row.spec);
 if(!name.includes('소운반'))return null;
 const subjects=['보조기층','레미콘','아스콘','모래','시멘트','자갈','깬잡석','뒷채움석','철근','용접철망','보도블록','전석','수로관','콘크리트'];
 const subject=subjects.filter(s=>text.includes(s)).join('|');
 const method=/덤프|트럭/.test(text)?'덤프':/굴삭|굴착|백호/.test(text)?'굴삭기':/경운기/.test(text)?'경운기':/인력|리어카|지게|손수레/.test(text)?'인력':'';
 const carrier=/리어카|손수레/.test(text)?'리어카':/지게/.test(text)?'지게':'';
 return {subject,method,carrier,waste:/폐기물/.test(text),name};
}
export function incompatibleWorkReason(line,item){
 const a=nameNorm(line.name),b=nameNorm(item.name),am=materials(line),bm=materials(item);
 if(wasteWork(line)!==wasteWork(item))return '폐기물 처리·운반과 다른 품목은 별도';
 const angleWork=/^앵글밸브(?:10kg\/cm2)?(?:교체|자재포함)?$/.test(a)&&(!/자재|재료/.test(line.group||'')||/교체|자재포함/.test(a));
 if(angleWork&&!(b==='앵글밸브교체'&&(item.category==='일위대가'||String(item.code||'').startsWith('U'))&&item.labor>0&&item.material>0))return '앵글밸브는 작업비·자재비를 포함한 교체 일위 적용';
 const ah=shortHaul(line),bh=shortHaul(item);
 if(!!ah!==!!bh)return '소운반과 다른 작업은 별도 품목';
 if(ah&&bh){
  if(ah.waste!==bh.waste||ah.subject!==bh.subject||!ah.subject&&ah.name!==bh.name)return '소운반 대상 자재가 다름';
  if(ah.method&&bh.method&&ah.method!==bh.method||ah.carrier&&bh.carrier&&ah.carrier!==bh.carrier)return '소운반 방식이 다름';
 }
 if(am.size&&bm.size&&(am.size!==bm.size||[...am].some(m=>!bm.has(m))))return '재질이 다름';
 const cover=s=>/뚜껑|덮개|커버/.test(s);
 // Waterworks workflow: the user confirmed that an abbreviated backfill
 // quantity always includes compaction. Do not learn a backfill-only target.
 if(a.startsWith('되메우기')&&!a.includes('다짐')&&b.startsWith('되메우기')&&!b.includes('다짐'))return '되메우기는 다짐 포함 항목으로 적용';
 const flange=s=>/마개플랜지|블라인드플랜지/.test(s)?'마개':/합플랜지/.test(s)?'합':/소켓플랜지/.test(s)?'소켓':/플랜지관/.test(s)?'관':'';
 if(flange(a)&&flange(b)&&flange(a)!==flange(b))return '플랜지의 용도가 다름';
 if(/편락관|레듀샤|레듀서/.test(a)&&/곡관/.test(b)||/곡관/.test(a)&&/편락관|레듀샤|레듀서/.test(b))return '이경관과 곡관은 별도 부속';
 const compactor=s=>/콤팩터|콤펙터|컴팩터|컴펙터/.test(s);
 if(compactor(a+' '+nameNorm(line.spec))&&!compactor(b+' '+nameNorm(item.spec)))return '지정된 다짐 장비가 다름';
 if(/교통안전시설/.test(a)&&/교통안전시설/.test(b)){
  const facility=s=>/휀스|펜스|방호울타리/.test(s)?'휀스':/칼라콘|컬러콘|라바콘/.test(s)?'콘':'';
  const x=facility(nameNorm(line.spec)),y=facility(nameNorm(item.spec));if(x&&x!==y)return '안전시설의 종류가 다름';
 }
 if(cover(a)!==cover(b))return '본체와 뚜껑·덮개는 별도 품목';
 if(a.includes('소켓')!==b.includes('소켓'))return '소켓과 다른 부속은 별도 품목';
 if(a.includes('소켓')&&b.includes('소켓')){for(const part of ['밸브','새들'])if(a.includes(part)!==b.includes(part))return '소켓의 연결 용도가 다름';}
 if(a.includes('밸브')&&b.includes('밸브')&&((/볼밸브/.test(a)&&/제수밸브/.test(b))||(/제수밸브/.test(a)&&/볼밸브/.test(b))))return '밸브 종류가 다름';
 if(/보도블록/.test(a)&&/보도블록/.test(b)&&/재설치/.test(a)!==/재설치/.test(b))return '신설과 재설치는 별도 작업';
 if(/xl삼방티/.test(a)&&/xl암티/.test(b)||/xl암티/.test(a)&&/xl삼방티/.test(b))return '티의 연결 용도가 다름';
 const machine=s=>/백호|굴삭|굴착기/.test(s||''),manual=s=>/인력/.test(s||'')&&!machine(s);
 if(machine(line.spec)&&manual(item.spec)||manual(line.spec)&&machine(item.spec))return '인력과 기계 시공 방식이 다름';
 const ar=transportRoute(line.spec)||(wasteWork(line)?transportRoute(line.name):null),br=transportRoute(item.spec)||(wasteWork(item)?transportRoute(item.name):null);if(ar&&br&&ar.join('|')!==br.join('|'))return '운반 구간이 다름';
 if(wasteWork(line)&&wasteWork(item)){
  if(wasteLocation(line).ambiguous||wasteLocation(item).ambiguous)return '폐기물 운반 지역이 여러 곳으로 표시됨';
  const origin=wasteOrigin(line),destinationOrigin=wasteOrigin(item);if(origin&&destinationOrigin&&origin!==destinationOrigin)return '폐기물 운반 지역이 다름';
  if(origin&&!destinationOrigin||ar&&!br)return '폐기물 운반 구간 확인 필요';
 }
 for(const action of ['깨기','철거','절단'])if(a.includes(action)!==b.includes(action))return '작업 종류가 다름';
 const materialOnly=item.category==='자재'||item.category==='내역단가'&&item.material>0&&!item.labor&&!item.expense&&!/설치|접합|부설|포설|교체/.test(b);
 if(materialOnly&&(/설치|접합|부설|포설|교체|철거|깨기|절단/.test(a)||/(?:보수|청소)(?:비)?$/.test(a)))return '시공과 자재는 별도 품목';
 const materialRow=/자재|재료/.test(line.group||'')||line.bucket==='government';
 if(materialRow&&!/설치|접합|부설|포설/.test(a)&&/설치|접합|부설|포설|교체/.test(b))return '자재와 시공은 별도 품목';
 return '';
}
export function compatibleWork(line,item){
 return !incompatibleWorkReason(line,item);
}
