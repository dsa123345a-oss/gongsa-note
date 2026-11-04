import {layoutNativeSheet,prepareNativeSheets} from './native-print-layout.js';
import {appendWorkbookStyles} from './est-excel-native.js';
import {makePrintDocuments,buildPrintPages,estPrintSettings,printDocuments} from './est-print.js';
import {writeTemplateWorkbook,columnName,sheetXml} from './template-workbook.js';

// Evidence sheets use the preview layout. The three estimate sheets below use
// the native EST workbook geometry, with the same calculated contents.
export function vectorPrintExcelSheets(project,libraries=[],options={}){
 const settings=estPrintSettings({...project.estPrintSettings,...options.printSettings,sections:options.sections||['summary','groups','estimate']});
 const selected=Object.keys(printDocuments).filter(k=>settings.sections.includes(k));
 if(!selected.length)throw Error('내보낼 시트를 하나 이상 선택하세요.');
 const bundle=makePrintDocuments(project,libraries);
 // Match preview/PDF: a checked evidence category with no used items must not
 // create a blank sheet/page or shift the page numbers of later documents.
 const keys=selected.filter(k=>bundle.documents.some(d=>d.key===k&&d.rows.length));
 if(!keys.length)throw Error('출력할 항목이 없습니다.');
 settings.sections=keys;
 const pages=buildPrintPages(bundle,settings,options.measure);
 const fonts=[{name:'Calibri',size:11}],borders=[{}],numberFormats=[],styles=[{}];
 const add=(list,value)=>{const key=JSON.stringify(value),found=list.findIndex(v=>JSON.stringify(v)===key);if(found>=0)return found;list.push(value);return list.length-1;};
 const style=(s={})=>add(styles,{font:add(fonts,{name:'굴림체',size:s.size||10.5,bold:!!s.bold}),border:add(borders,s.border||{}),format:s.formatCode?164+add(numberFormats,s.formatCode):0,align:s.align||'left',wrap:!!s.wrap,shrink:!!s.shrink,vertical:s.vertical||'center',rotation:s.rotation||0});
 const sheets=[];
 for(const key of keys){
  if(['summary','groups','estimate'].includes(key))continue;
  const doc=bundle.documents.find(d=>d.key===key),printed=pages.filter(p=>p.document===key);
  const first=printed[0],g=first.grid,n=g.cols.length,rows=[],merges=[],rowBreaks=[],shapes=[];
  let pageCursor=0;
  // Excel quantizes row heights to screen pixels. Round cumulative positions,
  // not each row, to prevent a full page losing several millimetres.
  const append=(height,values=[],ids=[])=>{const top=Math.round(pageCursor/.75)*.75;pageCursor+=Math.max(.1,height);const actual=Math.max(.75,Math.round(pageCursor/.75)*.75-top);rows.push({height:actual,values:Array.from({length:n},(_,i)=>values[i]??''),styles:Array.from({length:n},(_,i)=>ids[i]??0)});return rows.length;};
  const merge=(r1,c1,r2,c2)=>{if(r1!==r2||c1!==c2)merges.push(`${columnName(c1+1)}${r1}:${columnName(c2+1)}${r2}`);};
  for(const [pageIndex,page] of printed.entries()){
   if(pageIndex)rowBreaks.push(rows.length);pageCursor=0;
   const grid=page.grid,top=grid.top;
   // All y coordinates are the exact point coordinates used by the preview.
   if(grid.first){
    const title=page.ops.find(o=>o.type==='text'&&o.size===24),titleTop=title.y-27;
    const frame=page.ops.find(o=>o.type==='rect'&&o.fill===1&&o.y===titleTop);
    shapes.push({text:title.text,x:frame.x-grid.left,y:titleTop,width:frame.width,height:frame.height,size:24,spacing:title.spacing||0});
    append(titleTop);let r=append(frame.height);merge(r,0,r,n-1);
    append(top-titleTop-frame.height-14);
   }else append(top-14);
   let r=append(14,[grid.projectTitle],[style({size:grid.projectFontSize||10})]);merge(r,0,r,n-1);
   const positions=[];const occupied=new Set();
   const gridRows=[...grid.rows];const last=gridRows.at(-1),end=last?last.y+last.height:top;
   for(let y=end;y<grid.bottom-.01;){const height=Math.min(400,grid.bottom-y);gridRows.push({y,height,cells:Array.from({length:n},()=>({value:''})),filler:true});y+=height;}
   // Excel cannot represent a sub-pixel row. Keeping a tiny trailing filler
   // would force it to .75pt and can spill an otherwise finished page into a
   // blank border-only page after a wrapped remark. Extend the previous row
   // instead; its bottom border still lands on the shared table boundary.
   if(gridRows.length>1&&gridRows.at(-1).filler&&gridRows.at(-1).height<.75){const tail=gridRows.pop(),prior=gridRows.at(-1);gridRows[gridRows.length-1]={...prior,height:prior.height+tail.height};}
   for(const [ri,source] of gridRows.entries()){
    const out=rows.length+1;positions.push({y:source.y,end:source.y+source.height,row:out});
    const values=Array(n).fill(''),ids=Array(n).fill(0);let c=0;
    const horizontal=source.header||!grid.verticalOnly||source.subtotal||(source.itemStart&&key!=='formulas')||grid.cost&&!source.group;
    for(const cell of source.cells){
     const span=cell.span||1,start=c;c+=span;if(occupied.has(`${ri}:${start}`))continue;
     let value=cell.lines?.join('\n')??cell.value??'';
     const multiline=String(value).includes('\n');
     const numeric=cell.align==='right'&&/^-?\d[\d,]*(?:\.\d+)?$/.test(value),percent=cell.align==='right'&&/^-?\d+(?:\.\d+)?%$/.test(value);
     const decimals=(String(value).match(/\.(\d+)/)?.[1]||'').length,formatCode=numeric?'#,##0'+(decimals?'.'+'0'.repeat(decimals):''):percent?'0'+(decimals?'.'+'0'.repeat(decimals):'')+'%':null;
     if(numeric)value=Number(value.replaceAll(',',''));if(percent)value=Number(value.slice(0,-1))/100;
     values[start]=value;
     const rowspan=source.header&&grid.headerCount===2&&source.headerIndex===0&&span===1?2:1;
     merge(out,start,out+rowspan-1,start+span-1);
     if(rowspan===2)occupied.add(`${ri+1}:${start}`);
     // The preview already fits/wraps the cell and determines its row height.
     // Recalculating a multiline font here made the same header/body smaller
     // only in Excel (e.g. the two-line 노무비 header was 10.14 instead of 11.5).
     for(let k=start;k<start+span;k++)ids[k]=style({size:cell.fontSize||(source.header?grid.size+1:grid.size),bold:source.bold,align:source.header?'center':cell.distribute&&String(cell.value).length<=8?'distributed':cell.align,wrap:multiline&&!numeric&&!percent,shrink:false,numeric,percent,formatCode,border:{...(k===start?{left:start===0?'thin':'hair'}:{}),...(k===n-1?{right:'thin'}:{}),...(ri===0?{top:'thin'}:{}),...(horizontal&&rowspan===1?{bottom:source.subtotal?'thin':'hair'}:{}),...(ri===gridRows.length-1?{bottom:'thin'}:{})}});
     if(rowspan===2){
      // The next header row supplies the bottom edge of a vertically merged cell.
      // Its blank value is retained and no overlapping merge is generated.
     }
    }
    // Cells covered by the first header row still need the visible lower edge.
    for(let k=0;k<n;k++)if(occupied.has(`${ri}:${k}`))ids[k]=style({border:{left:k===0?'thin':'hair',bottom:'hair',...(k===n-1?{right:'thin'}:{})}});
    append(source.height,values,ids);
   }
   if(grid.cost&&grid.groupSpans.length){
    const mergeLabel=(label,x,y1,y2)=>{const area=positions.filter(p=>p.y>=y1-.01&&p.end<=y2+.01);if(!area.length)return;const a=area[0].row,b=area.at(-1).row;merge(a,x,b,x);
     for(let r=a;r<=b;r++){rows[r-1].values[x]=r===a?label:'';rows[r-1].styles[x]=style({size:grid.size,align:'center',rotation:255,border:{left:x===0?'thin':'hair',right:'hair',...(r===a?{top:'hair'}:{}),...(r===b?{bottom:'hair'}:{})}});}
    };
    mergeLabel('순공사원가',0,grid.bodyStart,grid.groupSpans.at(-1).end);
    for(const span of grid.groupSpans)mergeLabel(span.group,1,span.start,span.end);
   }
  }
  sheets.push({name:doc.title,rows,merges,rowBreaks,shapes,view:'pageBreakPreview',showGridLines:true,showZeros:true,defaultHeight:15,
   // Excel adds 5 pixels of cell padding to each column (Calibri 11 MDW=7).
   // Subtract that padding so printed columns keep the preview's point widths.
   columns:g.cols.map((pt,column)=>({column,width:Math.floor(pt/5.52*256)/256})),
   printArea:[0,0,0,rows.length,0,n],printTitles:null,
   print:{left:g.left/72,right:g.right/72,top:0,bottom:(first.height-g.bottom)/72,header:0,footer:(first.orientation==='portrait'?23:12)/25.4,paperSize:9,scale:100,flags:(first.orientation==='portrait'?2:0)|128,fitToPage:true,fitToWidth:1,fitToHeight:0,firstPageNumber:first.number||settings.startPage,horizontalDpi:600,verticalDpi:600,horizontalCentered:false,verticalCentered:false,footerText:'&C&"굴림체,Regular"&8- &P -'},pages:printed});
 }
 const fontXml=fonts.map(f=>`<font><sz val="${f.size}"/><name val="${sheetXml(f.name)}"/><charset val="129"/>${f.bold?'<b/>':''}</font>`).join('');
 const borderXml=borders.map(b=>`<border>${['left','right','top','bottom'].map(k=>b[k]?`<${k} style="${b[k]}"><color rgb="FF000000"/></${k}>`:`<${k}/>`).join('')}<diagonal/></border>`).join('');
 const xfs=styles.map((s,i)=>i===0?'<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>':`<xf numFmtId="${s.format}" fontId="${s.font}" fillId="0" borderId="${s.border}" xfId="0" applyNumberFormat="1" applyAlignment="1" applyBorder="1" applyFont="1"><alignment horizontal="${s.align}" vertical="${s.vertical}" wrapText="${s.wrap?1:0}" shrinkToFit="${s.shrink?1:0}" textRotation="${s.rotation}"/></xf>`).join('');
 const xml=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="${numberFormats.length}">${numberFormats.map((code,i)=>`<numFmt numFmtId="${164+i}" formatCode="${sheetXml(code)}"/>`).join('')}</numFmts><fonts count="${fonts.length}">${fontXml}</fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="${borders.length}">${borderXml}</borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="${styles.length}">${xfs}</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
 return {sheets,styles:xml,bundle,pages};
}
export function printExcelSheets(project,libraries=[],options={}){
 const vector=vectorPrintExcelSheets(project,libraries,options),native=prepareNativeSheets(vector.bundle.native,estPrintSettings({...project.estPrintSettings,...options.printSettings,sections:options.sections||['summary','groups','estimate']}));
 const combined=appendWorkbookStyles(native.styles,vector.styles),names=new Set(['원가계산서','내역서총괄표','내역서']);
 const settings=estPrintSettings({...project.estPrintSettings,...options.printSettings,sections:options.sections||['summary','groups','estimate']});
 const keys=Object.keys(printDocuments).filter(k=>settings.sections.includes(k)&&vector.bundle.documents.some(d=>d.key===k&&d.rows.length));
 const sheets=keys.map((key,index)=>{
  const doc=vector.bundle.documents.find(d=>d.key===key),pages=vector.pages.filter(p=>p.document===key);
  if(names.has(doc.title)){const n=native.sheets.find(n=>n.name===doc.title),layout=layoutNativeSheet(n,native.styles,doc,settings);return {...layout.sheet,print:{...layout.sheet.print,flags:(layout.sheet.print.flags&~128)|(index===0?128:0),firstPageNumber:settings.startPage},pages:pages.length?pages:layout.pages};}
  const s=vector.sheets.find(s=>s.name===doc.title);return {...s,print:{...s.print,flags:(s.print.flags&~128)|(index===0?128:0)},rows:s.rows.map(r=>({...r,height:r.height/.967,styles:r.styles.map(id=>id+combined.offset)}))};
 });
 return {...vector,sheets,styles:combined.styles};
}
export function exportPrintExcel(project,libraries,options){const {sheets,styles}=printExcelSheets(project,libraries,options);return writeTemplateWorkbook(sheets,styles);}
