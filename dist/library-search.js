import {norm,unitNorm} from './calc.js';
import {nameNorm,compareSpecs,specNorm,locationTextNorm,transportRoute,compatibleWork,pipeWork} from './match-similarity.js';

// Cache text processing, not prices or calculations. Check all inputs used by
// search on every call, including in-place edits and same-length DB replacement.
const indexes=new WeakMap(),fields=['name','spec','unit','code','category','table','labor','material','expense','other','total','government','manual','components','calculation','resourcePricing','evidenceBid','sourceComponent'];
const prepared=text=>({text,grams:new Set(Array.from({length:Math.max(0,text.length-1)},(_,i)=>text.slice(i,i+2)))});
function similarity(a,b){if(!a.text||!b.text)return 0;if(a.text===b.text)return 1;let hit=0;for(const g of a.grams)if(b.grams.has(g))hit++;return Math.max(2*hit/(a.grams.size+b.grams.size||1),a.text.includes(b.text)||b.text.includes(a.text)?0.76:0);}
function libraryIndex(library){
 let index=indexes.get(library);if(!index){index={entries:[],search:new Map(),rank:new Map()};indexes.set(library,index);}
 let changed=index.entries.length!==library.items.length;
 for(let i=0;i<library.items.length;i++){
  const item=library.items[i],old=index.entries[i];
  if(!old||old.item!==item||fields.some((k,j)=>!Object.is(old.values[j],item[k]))){
   index.entries[i]={item,values:fields.map(k=>item[k]),category:item.category,spec:item.spec,plain:norm(item.name),name:prepared(nameNorm(item.name)),text:nameNorm(locationTextNorm([item.name,item.spec,item.code].join(' '))),specKey:specNorm(item.spec),route:transportRoute(item.spec)||[],pipe:pipeWork(item)};changed=true;
  }
 }
 index.entries.length=library.items.length;
 if(changed){index.search.clear();index.rank.clear();index.byItem=new Map(index.entries.map(e=>[e.item,e]));}return index;
}
function remember(map,key,value){if(map.size>=16)map.delete(map.keys().next().value);map.set(key,value);return value;}

// EST keeps both a source rate and the estimate rows which use that rate.
// Collapse only identical imported snapshots in the all-category search of
// ONE library. Explicit estimate-category searches still expose the originals.
function collapseEstimateCopies(items,category){
 if(category)return items;
 const codes=new Set(items.filter(i=>i.table==='EstMainDat').map(i=>i.code));
 if(!codes.size)return items;
 const plain=s=>String(s??'').normalize('NFKC').replace(/\s+/g,'').toLowerCase();
 const key=i=>{
  if(!i.code||['manual','components','calculation','resourcePricing','evidenceBid','sourceComponent'].some(k=>i[k]!=null&&i[k]!==false))return null;
  if(!['labor','material','expense','other','total'].every(k=>Number.isFinite(i[k])))return null;
  return JSON.stringify([i.code,plain(i.name),specNorm(i.spec),unitNorm(i.unit),i.labor,i.material,i.expense,i.other,i.total,!!i.government]);
 };
 const sourceTables=new Set(['CostTitleDat','HeadTitleDat','MachTitleDat','StuffcDat','LaborcDat','SilJukDat']);
 const sources=new Set(items.filter(i=>sourceTables.has(i.table)&&codes.has(i.code)).map(key).filter(Boolean));
 return items.filter(i=>i.table!=='EstMainDat'||!sources.has(key(i)));
}

export function mergeLibrary(libraries, incoming) {
 const previous=libraries.find(l=>l.name===incoming.name);
 const remaining=libraries.filter(l=>l.name!==incoming.name);
 const isMain=!!previous?.isMain || !remaining.some(l=>l.isMain);
 return [...remaining,{...incoming,isMain}];
}

// Keep each database independent, including identical codes and zero-result databases.
export function searchLibraries(libraries, query='', category='', libraryId='') {
 return searchGroups(libraries,query,category,libraryId);
}
function searchGroups(libraries,query,category,libraryId,requestIndexes=new Map()){
 const terms=String(query).trim().split(/[\s&]+/).map(q=>nameNorm(locationTextNorm(q))).filter(Boolean);
 if(!terms.length){const q=norm(query);return [...libraries].sort((a,b)=>Number(!!b.isMain)-Number(!!a.isMain)).filter(l=>!libraryId||l.id===libraryId).map(library=>({library,items:collapseEstimateCopies(library.items.filter(item=>!category||item.category===category),category).map(item=>({item,exact:norm(item.name)===q})).sort((a,b)=>Number(b.exact)-Number(a.exact)).map(e=>e.item),related:false}));}
 const queryPlain=norm(query),korean=queryPlain.replace(/[^가-힣]/g,''),queryName=prepared(nameNorm(query).replace(/\d+(?:\.\d+)?(?:mm|cm|m)?/gi,'').replace(/[=ΦφØø]/g,'')),termSpecs=terms.map(specNorm),termPlaces=terms.map(t=>t.replace(/(?:읍|면)$/, ''));
 return [...libraries].sort((a,b)=>Number(!!b.isMain)-Number(!!a.isMain))
  .filter(l=>!libraryId||l.id===libraryId)
  .map(library=>{const index=libraryIndex(library),key=JSON.stringify([query,category]);requestIndexes.set(library,index);let result=index.search.get(key);
   if(!result){
    const source=index.entries.filter(e=>!category||e.category===category);
    const exact=source.filter(e=>terms.every((term,i)=>e.text.includes(term)||e.specKey===termSpecs[i]||e.route.includes(termPlaces[i]))).sort((a,b)=>Number(b.plain===queryPlain)-Number(a.plain===queryPlain));
     const related=korean.length>=4?source.filter(e=>e.plain.includes(korean)):[],seen=new Set([...exact,...related]);
     const fuzzy=queryName.text.length>=3?source.filter(e=>!seen.has(e)).map(e=>({entry:e,score:similarity(queryName,e.name)})).filter(e=>e.score>=.48).map(e=>({...e,spec:compareSpecs(query,e.entry.spec).score})).sort((a,b)=>b.score-a.score||b.spec-a.spec).map(e=>e.entry):[];
     const matched=new Set(exact),items=collapseEstimateCopies([...exact,...related.filter(e=>!matched.has(e)),...fuzzy].map(e=>e.item),category),visible=new Set(items);
     const exactCount=exact.filter(e=>visible.has(e.item)).length;
     result={items,related:!exactCount&&items.length>0,exactCount};
    remember(index.search,key,result);
   }
   return {library,...result,items:result.items.slice()};
 });
}

// Preserve separate DB windows and all discovery results; put the selected
// row's matching material, work type and diameter at the top of each window.
export function searchLineLibraries(libraries,line,query=line.name,category='',libraryId=''){
 const key=JSON.stringify([query,category,...['name','spec','group','bucket','location','sourceFile','specError'].map(k=>line[k])]),name=prepared(nameNorm(line.name)),pipe=pipeWork(line);
 const requestIndexes=new Map();
 return searchGroups(libraries,query,category,libraryId,requestIndexes).map(group=>{
  const index=requestIndexes.get(group.library)||libraryIndex(group.library);let items=index.rank.get(key);
  if(!items){const entries=index.byItem||new Map();
   items=group.items.map((item,i)=>{const e=entries.get(item);return {item,index:i,compatible:compatibleWork(line,item),nameExact:name.text===e.name.text,spec:compareSpecs(line.spec,item.spec,{diameterAliases:pipe&&e.pipe}).score,nameScore:similarity(name,e.name)};}).sort((a,b)=>Number(b.compatible)-Number(a.compatible)||Number(b.nameExact)-Number(a.nameExact)||b.spec-a.spec||b.nameScore-a.nameScore||a.index-b.index).map(r=>r.item);
   remember(index.rank,key,items);
  }return {...group,items:items.slice()};
 });
}
