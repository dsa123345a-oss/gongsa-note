// Only pure text transformations are cached. Convert before lookup so an
// edited object is never mistaken for its previous text. Bound memory use
// during large DB imports and bypass unusually long free-form descriptions.
export function memoizeText(transform,limit=16384){
 const cache=new Map(),keys=[];let cursor=0;
 return value=>{
  const text=String(value??'');
  if(text.length>512)return transform(text);
  if(cache.has(text))return cache.get(text);
  const result=transform(text);
  if(cache.size>=limit){cache.delete(keys[cursor]);keys[cursor]=text;cursor=(cursor+1)%limit;}
  else keys.push(text);
  cache.set(text,result);return result;
 };
}
