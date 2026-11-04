// Measurements from the scanned reference are print points, independent of zoom.
// Keep the section label/caption exceptions in est-print: they must remain readable.
export function printTypography(key){
 const estimate=['summary','groups','estimate'].includes(key);
 return {size:estimate?9:10.5,fontWidth:100,letterSpacing:0,rowHeight:key==='formulas'?3.4:key==='summary'?6.7:key==='estimate'?7.28:7};
}
// GulimChe uses half-em printable ASCII and full-em Korean/symbol characters.
// In particular, × and ² are full-em, although their codepoints are below 256.
export const measurePrintText=(value,size)=>Array.from(String(value)).reduce((sum,c)=>sum+size*(c.codePointAt(0)>=32&&c.codePointAt(0)<=126?.5:1),0);
export const spacedTextWidth=(value,size,spacing=0,measure=measurePrintText)=>Math.max(0,measure(String(value),size)+Math.max(0,Array.from(String(value)).length-1)*spacing);
// Excel's automatic shrink changes both height and width. Resolve it once in
// points so editable cells, SVG and PDF use the same actual font size. Excel
// retains twentieth-point steps; never enlarge a short value.
export function fitPrintFontSize(lines,size,width,measure=measurePrintText){
 const widest=Math.max(0,...(Array.isArray(lines)?lines:[lines]).map(s=>measure(String(s??''),size)));
 return widest<=width||!widest?size:Math.max(1,Math.floor(Math.max(0,width)/widest*size*20)/20);
}
export function wrapPrintText(value,size,width,measure=measurePrintText){
 const lines=[];for(const paragraph of String(value??'').split('\n')){let line='';for(const ch of paragraph){if(line&&measure(line+ch,size)>width){lines.push(line);line='';}line+=ch;}lines.push(line);}return lines;
}
export const printHeaderWidths={'품명':30,'규격':26,'합계':35,'노무비':29,'재료비':29,'경비':35,'단가':26,'금액':26,'비목':65,'산출근거':73};
export const printRowHeight=doc=>doc.cost?Math.max(printTypography(doc.key).rowHeight,Math.min(7.65,(270-37-12)/Math.max(1,doc.rows.length))):printTypography(doc.key).rowHeight;
