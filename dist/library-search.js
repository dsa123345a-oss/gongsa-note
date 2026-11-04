import {norm} from './calc.js';
import {nameNorm,textSimilarity,compareSpecs,specNorm,locationTextNorm,transportRoute,compatibleWork,compatibleUnits,pipeWork} from './match-similarity.js';

// Cache text processing, not prices or calculations. Check all inputs used by
// search on every call, including in-place edits and same-length DB replacement.
const indexes=new WeakMap(),fields=['name','spec','code','category','labor','material','expense'];
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
 if(changed){index.search.clear();index.rank.clear();}return index;
}
function remember(map,key,value){if(map.size>=16)map.delete(map.keys().next().value);map.set(key,value);return value;}

export function mergeLibrary(libraries, incoming) {
 const previous=libraries.find(l=>l.name===incoming.name);
 const remaining=libraries.filter(l=>l.name!==incoming.name);
 const isMain=!!previous?.isMain || !remaining.some(l=>l.isMain);
 return [...remaining,{...incoming,isMain}];
}

// Keep each database independent, including identical codes and zero-result databases.
export function searchLibraries(libraries, query='', category='', libraryId='') {
 const terms=String(query).trim().split(/[\s&]+/).map(q=>nameNorm(locationTextNorm(q))).filter(Boolean);
 if(!terms.length){const q=norm(query);return [...libraries].sort((a,b)=>Number(!!b.isMain)-Number(!!a.isMain)).filter(l=>!libraryId||l.id===libraryId).map(library=>({library,items:library.items.filter(item=>!category||item.category===category).map(item=>({item,exact:norm(item.name)===q})).sort((a,b)=>Number(b.exact)-Number(a.exact)).map(e=>e.item),related:false}));}
 const queryPlain=norm(query),korean=queryPlain.replace(/[^가-힣]/g,''),queryName=prepared(nameNorm(query).replace(/\d+(?:\.\d+)?(?:mm|cm|m)?/gi,'').replace(/[=ΦφØø]/g,'')),termSpecs=terms.map(specNorm),termPlaces=terms.map(t=>t.replace(/(?:읍|면)$/, ''));
 return [...libraries].sort((a,b)=>Number(!!b.isMain)-Number(!!a.isMain))
  .filter(l=>!libraryId||l.id===libraryId)
  .map(library=>{const index=libraryIndex(library),key=JSON.stringify([query,category]);let result=index.search.get(key);
   if(!result){
    const source=index.entries.filter(e=>!category||e.category===category);
    const exact=source.filter(e=>terms.every((term,i)=>e.text.includes(term)||e.specKey===termSpecs[i]||e.route.includes(termPlaces[i]))).sort((a,b)=>Number(b.plain===queryPlain)-Number(a.plain===queryPlain));
    if(!terms.length)result={items:exact.map(e=>e.item),related:false};
    else {
     const related=korean.length>=4?source.filter(e=>e.plain.includes(korean)):[],seen=new Set([...exact,...related]);
     const fuzzy=queryName.text.length>=3?source.filter(e=>!seen.has(e)).map(e=>({entry:e,score:similarity(queryName,e.name)})).filter(e=>e.score>=.48).map(e=>({...e,spec:compareSpecs(query,e.entry.spec).score})).sort((a,b)=>b.score-a.score||b.spec-a.spec).map(e=>e.entry):[];
     const matched=new Set(exact),items=[...exact,...related.filter(e=>!matched.has(e)),...fuzzy].map(e=>e.item);
     result={items,related:!exact.length&&items.length>0,exactCount:exact.length};
    }
    remember(index.search,key,result);
   }
   return {library,...result,items:result.items.slice()};
 });
}

// Preserve separate DB windows and all discovery results; put the selected
// row's matching material, work type and diameter at the top of each window.
export function searchLineLibraries(libraries,line,query=line.name,category='',libraryId=''){
 const key=JSON.stringify([query,category,...['name','spec','group','bucket','location','sourceFile','specError'].map(k=>line[k])]),name=prepared(nameNorm(line.name)),pipe=pipeWork(line);
 return searchLibraries(libraries,query,category,libraryId).map(group=>{
  const index=libraryIndex(group.library);let items=index.rank.get(key);
  if(!items){const entries=new Map(index.entries.map(e=>[e.item,e]));
   items=group.items.map((item,i)=>{const e=entries.get(item);return {item,index:i,compatible:compatibleWork(line,item),nameExact:name.text===e.name.text,spec:compareSpecs(line.spec,item.spec,{diameterAliases:pipe&&e.pipe}).score,nameScore:similarity(name,e.name)};}).sort((a,b)=>Number(b.compatible)-Number(a.compatible)||Number(b.nameExact)-Number(a.nameExact)||b.spec-a.spec||b.nameScore-a.nameScore||a.index-b.index).map(r=>r.item);
   remember(index.rank,key,items);
  }return {...group,items:items.slice()};
 });
}
