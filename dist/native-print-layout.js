// One cell model for the preview, PDF and editable EST-style Excel sheets.
import {measurePrintText,fitPrintFontSize,wrapPrintText} from './print-typography.js';
const mm=72/25.4;
const attr=(xml,key,def='')=>xml?.match(new RegExp('\\b'+key+'="([^"]*)"'))?.[1]??def;
const body=(xml,tag)=>xml.match(new RegExp('<'+tag+'\\b[^>]*>([\\s\\S]*?)</'+tag+'>'))?.[1]||'';
const coord=s=>{const m=s.match(/([A-Z]+)(\d+)/);return {c:[...m[1]].reduce((v,c)=>v*26+c.charCodeAt(0)-64,0)-1,r:Number(m[2])-1};};
export function nativeCellStyles(xml){
 const fonts=(body(xml,'fonts').match(/<font>.*?<\/font>/g)||[]).map(f=>({size:Number(attr(f.match(/<sz[^>]*>/)?.[0],'val',9)),bold:/<b\b/.test(f)}));
 const borders=(body(xml,'borders').match(/<border\b[^>]*>[\s\S]*?<\/border>/g)||[]).map(b=>Object.fromEntries(['left','right','top','bottom'].map(k=>[k,attr(b.match(new RegExp('<'+k+'\\b[^>]*>'))?.[0],'style')])));
 const formats=new Map([...body(xml,'numFmts').matchAll(/<numFmt\b[^>]*\/>/g)].map(m=>[Number(attr(m[0],'numFmtId')),attr(m[0],'formatCode')]));
 return (body(xml,'cellXfs').match(/<xf\b[^>]*?(?:\/>|>[\s\S]*?<\/xf>)/g)||[]).map(x=>({...fonts[Number(attr(x,'fontId',0))],border:borders[Number(attr(x,'borderId',0))]||{},align:attr(x,'horizontal','general'),shrink:attr(x,'shrinkToFit')==='1',format:formats.get(Number(attr(x,'numFmtId')))||({3:'#,##0',9:'0%',10:'0.00%'})[attr(x,'numFmtId')]||''}));
}
const displayFormats=new Map();
function shown(value,format){
 if(typeof value!=='number')return String(value??'');
 if(!value&&format.includes(';;'))return '';
 let display=displayFormats.get(format);
 if(!display){const percent=format.includes('%'),decimal=format.match(/\.([0#]+)/)?.[1]||'';
  display={percent,formatter:new Intl.NumberFormat('ko-KR',{useGrouping:format.includes(','),minimumFractionDigits:(decimal.match(/0/g)||[]).length,maximumFractionDigits:decimal.length||0})};
  if(displayFormats.size>=64)displayFormats.delete(displayFormats.keys().next().value);displayFormats.set(format,display);
 }
 return display.formatter.format(value*(display.percent?100:1))+(display.percent?'%':'');
}
export function layoutNativeSheet(input,styles,doc,options={}){
 const sheet=structuredClone(input),d=options.documents?.[doc.key]||{},p=sheet.print;
 if(d.orientation)p.flags=d.orientation==='portrait'?p.flags|2:p.flags&~2;
 if(d.marginLeft!=null)p.left=d.marginLeft/25.4;if(d.marginRight!=null)p.right=d.marginRight/25.4;
 const landscape=!(p.flags&2),width=(landscape?297:210)*mm,height=(landscape?210:297)*mm;
 const firstColumn=sheet.printArea[4],lastColumn=sheet.printArea[5],rawCols=sheet.columns.slice(firstColumn,lastColumn).map(c=>c.width*5.52);
 // Arial 10 Normal-style column units and EST row heights, measured against
 // the native Excel print engine (points, before the worksheet scale).
 // Use the same explicit scale in Excel. Reduce only when necessary to keep
 // a user-selected portrait page from splitting the table horizontally.
 p.scale=Math.min(p.scale,Math.floor((width-(p.left+p.right)*72)/rawCols.reduce((a,b)=>a+b,0)*100));
 const headerCount=sheet.header.length,formats=nativeCellStyles(styles),merges=sheet.merges.map(m=>{const[a,b]=m.split(':').map(coord);return {a,b};});
 if(d.rowHeight!=null)for(let r=headerCount;r<sheet.rows.length;r++)sheet.rows[r].height=String(sheet.rows[r].values[2]||'').includes('\n')?Math.max(sheet.rows[r].height,d.rowHeight*mm):d.rowHeight*mm;
 // Cost statements stay together. The same scale is written to Excel; reserve
 // a small physical margin for printer rounding without dropping any row.
 if(doc.key==='summary')p.scale=Math.min(p.scale,Math.floor((height-(p.top+p.bottom)*72-6)/(sheet.rows.reduce((s,r)=>s+r.height,0)*.967)*100));
 if(p.scale<10)throw Error('원가계산서가 한 쪽에 들어갈 수 없습니다. 행 수나 용지 설정을 확인하세요.');
 p.fitToPage=false;const scale=p.scale/100,cols=rawCols.map(w=>w*scale),left=p.left*72,top=p.top*72,bottom=height-p.bottom*72;
 const pages=[],breaks=[];let page,y;
 const rule=(x,y,x2,y2,kind)=>{if(kind)page.ops.push({type:'line',x,y,x2,y2,weight:(kind==='hair'?.25:.6)*scale});};
 function draw(index){
  const r=sheet.rows[index],h=r.height*.967*scale;let x=left;const cells=[];
  for(let c=firstColumn;c<lastColumn;c++){
   const w=cols[c-firstColumn],style=formats[r.styles[c]]||formats[0],merge=merges.find(m=>index>=m.a.r&&index<=m.b.r&&c>=m.a.c&&c<=m.b.c);
   const own=!merge||(merge.a.r===index&&merge.a.c===c),span=merge?merge.b.c-merge.a.c+1:1;
   // A covered cell contributes only the outside edge of a merged range.
   for(const side of ['left','right','top','bottom']){
    if(merge&&((side==='left'&&c!==merge.a.c)||(side==='right'&&c!==merge.b.c)||(side==='top'&&index!==merge.a.r)||(side==='bottom'&&index!==merge.b.r)))continue;
    rule(side==='right'?x+w:x,side==='bottom'?y+h:y,side==='left'?x:x+w,side==='top'?y:y+h,style.border[side]);
   }
   if(own){
    const cw=merge?cols.slice(c-firstColumn,c-firstColumn+span).reduce((a,b)=>a+b,0):w;
    const ch=merge?sheet.rows.slice(index,merge.b.r+1).reduce((a,b)=>a+b.height*.967*scale,0):h;
    const value=shown(r.values[c],style.format),baseSize=style.size;
    const parts=value.split('\n'),fontSize=(style.shrink?fitPrintFontSize(parts,baseSize,cw/scale-4):baseSize)*scale,padding=2*scale;
    const align=style.align==='right'||(style.align==='general'&&typeof r.values[c]==='number')?'right':style.align==='center'?'center':'left';
    if(value)parts.forEach((text,i)=>page.ops.push({type:'text',text,x:align==='right'?x+cw-padding:align==='center'?x+cw/2:x+padding,y:y+(ch-parts.length*fontSize*1.15)/2+fontSize*.98+i*fontSize*1.15,size:fontSize,scale:1,width:measurePrintText(text,fontSize),bold:style.bold,align}));
    cells.push({value,span,align,lines:parts,fontSize,readable:c===2&&span>=2,keepFont:c===firstColumn&&index>=headerCount&&/공구$/.test(value),fit:style.shrink,nativeColumn:c});
   }
   x+=w;
  }
  page.grid.rows.push({cells,y,height:h,header:index<headerCount,headerIndex:index,sheetRow:index,bold:false});y+=h;
 }
 function start(){
  page={width,height,orientation:landscape?'landscape':'portrait',document:doc.key,title:doc.title,ops:[],native:true,footerY:height-p.footer*72,footerSize:9*scale,grid:{left,right:p.right*72,cols,size:d.size??9,bottom,top,first:pages.length===0,rows:[],headerCount,cost:doc.key==='summary',native:true,projectTitle:doc.projectTitle}};pages.push(page);y=top;
  if(doc.projectTitle){const headerSize=Math.max(1,Math.floor(fitPrintFontSize(doc.projectTitle,9,(width-left-p.right*72)/scale))),fontSize=headerSize*scale;p.headerText='&L&'+headerSize+'&"굴림체,Regular"'+String(doc.projectTitle).replaceAll('&','&&');page.ops.push({type:'text',text:doc.projectTitle,x:left,y:p.header*72+fontSize,size:fontSize,scale:1,width:measurePrintText(doc.projectTitle,fontSize),align:'left'});}
  for(let i=0;i<headerCount;i++)draw(i);
 }
 start();
 for(let i=headerCount;i<sheet.rows.length;i++){
  const logical=sheet.rows[i],force=doc.key!=='summary'&&((d.breakRows||[]).includes(logical?.lineIndex||i-headerCount+1)||(d.groupNewPage&&logical?.sectionStart));
  if((force&&page.grid.rows.length>headerCount)||y+sheet.rows[i].height*.967*scale>bottom+.01){breaks.push(i);start();}
  if(y+sheet.rows[i].height*.967*scale>bottom+.01)throw Error(doc.title+'의 행 높이를 줄여주세요.');
  draw(i);
 }
 sheet.rowBreaks=breaks;
 return {pages,sheet};
}
export function prepareNativeSheets(native,options={}){
 const result=structuredClone(native),xml=result.styles;
 const fonts=body(xml,'fonts').match(/<font>[\s\S]*?<\/font>/g)||[],xfs=body(xml,'cellXfs').match(/<xf\b[^>]*?(?:\/>|>[\s\S]*?<\/xf>)/g)||[],ids=new Map();
 for(const sheet of result.sheets){
  const key=({원가계산서:'summary',내역서총괄표:'groups',내역서:'estimate'})[sheet.name],size=options.documents?.[key]?.size;if(size==null||size===9)continue;
  for(const r of sheet.rows.slice(sheet.header.length))r.styles=r.styles.map(id=>{
   const sig=id+':'+size;if(ids.has(sig))return ids.get(sig);
   const old=xfs[id],fontId=Number(attr(old,'fontId',0)),font=fonts[fontId],oldSize=Number(attr(font.match(/<sz\b[^>]*>/)?.[0],'val',9)),newFont=font.replace(/<sz val="[^"]*"\/>/,`<sz val="${oldSize*size/9}"/>`);
   let fi=fonts.indexOf(newFont);if(fi<0){fi=fonts.length;fonts.push(newFont);}const xf=old.replace(/fontId="\d+"/,`fontId="${fi}"`);let xi=xfs.indexOf(xf);if(xi<0){xi=xfs.length;xfs.push(xf);}ids.set(sig,xi);return xi;
  });
 }
 for(const sheet of result.sheets){
  const key=({원가계산서:'summary',내역서총괄표:'groups',내역서:'estimate'})[sheet.name];
  for(let i=sheet.header.length;i<sheet.rows.length;i++){
   const r=sheet.rows[i],merge=sheet.merges.find(m=>m.startsWith(`C${i+1}:`));if(!merge)continue;
   const end=coord(merge.split(':')[1]).c;
   const size=options.documents?.[key]?.size??9,max=sheet.columns.slice(2,end+1).reduce((s,c)=>s+c.width,0)*5.52-4,lines=[];let line='';
   for(const ch of String(r.values[2]||'')){if(line&&measurePrintText(line+ch,size)>max){lines.push(line);line='';}line+=ch;}lines.push(line);
   if(lines.length<2)continue;
   r.values[2]=lines.join('\n');r.height=Math.max(r.height,(lines.length*size*1.15+5)/.967);
   const xf=xfs[r.styles[2]].replace(/<alignment\b([^>]*?)\/>/,(_,a)=>`<alignment${a.replace(/ (shrinkToFit|wrapText)="[^"]*"/g,'')} wrapText="1"/>`);
   let id=xfs.indexOf(xf);if(id<0){id=xfs.length;xfs.push(xf);}r.styles[2]=id;
  }
 }
 // Resolve each shrink-to-fit cell after captions and custom font sizes have
 // been prepared. Keep the typed values and number formats, only specialize
 // the font style. Excel must not perform a second, renderer-specific shrink.
 const current=xml.replace(/<fonts\b[^>]*>[\s\S]*?<\/fonts>/,`<fonts count="${fonts.length}">${fonts.join('')}</fonts>`).replace(/<cellXfs\b[^>]*>[\s\S]*?<\/cellXfs>/,`<cellXfs count="${xfs.length}">${xfs.join('')}</cellXfs>`),formats=nativeCellStyles(current),fitted=new Map();
 for(const sheet of result.sheets){
  const merges=sheet.merges.map(m=>{const[a,b]=m.split(':').map(coord);return {a,b};});
  for(const [ri,r] of sheet.rows.entries())for(let c=0;c<r.values.length;c++){
   const oldId=r.styles[c],style=formats[oldId];if(!style?.shrink)continue;
   const merge=merges.find(m=>ri>=m.a.r&&ri<=m.b.r&&c>=m.a.c&&c<=m.b.c);if(merge&&(merge.a.r!==ri||merge.a.c!==c))continue;
   const span=merge?merge.b.c-merge.a.c+1:1,width=sheet.columns.slice(c,c+span).reduce((sum,col)=>sum+col.width*5.52,0)-4;
   let size=fitPrintFontSize(shown(r.values[c],style.format).split('\n'),style.size,width);const wrap=size<6&&sheet.name!=='원가계산서'&&ri>=sheet.header.length&&c===sheet.columns.length-1;
   if(wrap){size=Math.min(6,style.size);const lines=wrapPrintText(r.values[c],size,width);r.values[c]=lines.join('\n');r.height=Math.max(r.height,(lines.length*size*1.15+4)/.967);}
   const sig=oldId+':'+size+':'+wrap;
   if(!fitted.has(sig)){
    const old=xfs[oldId],font=fonts[Number(attr(old,'fontId',0))].replace(/<sz val="[^"]*"\/>/,`<sz val="${size}"/>`);let fi=fonts.indexOf(font);if(fi<0){fi=fonts.length;fonts.push(font);}
    let xf=old.replace(/fontId="\d+"/,`fontId="${fi}"`).replace(/shrinkToFit="[^"]*"/g,'shrinkToFit="0"');if(wrap)xf=xf.replace(/<alignment\b([^>]*?)\/>/,(_,a)=>`<alignment${a.replace(/ wrapText="[^"]*"/g,'')} wrapText="1"/>`);let id=xfs.indexOf(xf);if(id<0){id=xfs.length;xfs.push(xf);}fitted.set(sig,id);
   }
   r.styles[c]=fitted.get(sig);
  }
 }
 result.styles=xml.replace(/<fonts\b[^>]*>[\s\S]*?<\/fonts>/,`<fonts count="${fonts.length}">${fonts.join('')}</fonts>`).replace(/<cellXfs\b[^>]*>[\s\S]*?<\/cellXfs>/,`<cellXfs count="${xfs.length}">${xfs.join('')}</cellXfs>`);
 return result;
}
