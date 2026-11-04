import {estExcelTemplate} from './est-excel-template.js';
import {costSheet} from './cost-sheet.js';
import {columnName,sheetXml} from './template-workbook.js';

const norm=s=>String(s??'').replace(/\s/g,'');
const xfList=xml=>xml.match(/<xf\b[^>]*?(?:\/>|>[\s\S]*?<\/xf>)/g)||[];
function part(xml,tag){return xml.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`))?.[1]||'';}
function replacePart(xml,tag,body,count){
 const value=`<${tag} count="${count}">${body}</${tag}>`,re=new RegExp(`<${tag}\\b[^>]*(?:\\/>|>[\\s\\S]*?<\\/${tag}>)`);
 return re.test(xml)?xml.replace(re,value):xml.replace(/(<styleSheet\b[^>]*>)/,'$1'+value);
}
// Preserve the reference's Normal font and column metrics. Additional evidence
// sheets retain their own cell formats after the style IDs have been remapped.
export function appendWorkbookStyles(base,extra){
 const offsets={};
 for(const [tag,item] of [['fonts','font'],['fills','fill'],['borders','border']]){
  const a=part(base,tag),b=part(extra,tag),re=new RegExp(`<${item}\\b`,'g');
  offsets[tag]=(a.match(re)||[]).length;
  base=replacePart(base,tag,a+b,offsets[tag]+(b.match(re)||[]).length);
 }
 let formats=part(base,'numFmts'),next=Math.max(163,...[...base.matchAll(/numFmtId="(\d+)"/g)].map(m=>Number(m[1])))+1;
 const remap=new Map();for(const m of part(extra,'numFmts').matchAll(/<numFmt\b[^>]*\/>/g)){
  const id=Number(m[0].match(/numFmtId="(\d+)"/)[1]);remap.set(id,next++);formats+=m[0].replace(/numFmtId="\d+"/,`numFmtId="${remap.get(id)}"`);
 }
 base=replacePart(base,'numFmts',formats,(formats.match(/<numFmt\b/g)||[]).length);
 const first=xfList(part(base,'cellXfs')),added=xfList(part(extra,'cellXfs')).map(x=>x.replace(/(fontId|fillId|borderId|numFmtId)="(\d+)"/g,(_,key,n)=>`${key}="${key==='numFmtId'?(remap.get(Number(n))??Number(n)):Number(n)+offsets[{fontId:'fonts',fillId:'fills',borderId:'borders'}[key]]}"`));
 return {styles:replacePart(base,'cellXfs',first.join('')+added.join(''),first.length+added.length),offset:first.length};
}

export function nativeEstimateSheets(project,bundle){
 let styles=estExcelTemplate.styles;
 const xfs=xfList(part(styles,'cellXfs')),formats=new Map();
 let nextFormat=Math.max(163,...[...styles.matchAll(/numFmtId="(\d+)"/g)].map(m=>Number(m[1])))+1;
 function format(id,code,{shrink=false}={}){
  if(!formats.has(code))formats.set(code,nextFormat++);
  let xml=xfs[id].replace(/numFmtId="\d+"/,`numFmtId="${formats.get(code)}"`);
  if(shrink){
   if(/<alignment\b/.test(xml))xml=xml.replace(/<alignment\b([^>]*?)\/>/,(_,a)=>`<alignment${a.replace(/ shrinkToFit="[^"]*"/g,'')} shrinkToFit="1"/>`);
   else xml=xml.replace(/\/>$/,'><alignment shrinkToFit="1"/></xf>');
  }
  let index=xfs.indexOf(xml);if(index<0){index=xfs.length;xfs.push(xml);}return index;
 }
 const cellValue=c=>{
  const value=c?.value??'';
  if(c?.align==='right'&&/^-?\d[\d,]*(?:\.\d+)?$/.test(value))return Number(value.replaceAll(',',''));
  return value;
 };
 const byKey=Object.fromEntries(bundle.documents.map(d=>[d.key,d]));
 const sheets=structuredClone(estExcelTemplate.sheets);
 for(const s of sheets){s.rows=structuredClone(s.header);s.view='pageBreakPreview';s.shapes=[];s.rowBreaks=[];
  s.print.headerText='&L&"굴림체,Regular"&9'+String(project.title||'공사명').replaceAll('&','&&');
  s.print.footerText='&C&"굴림체,Regular"&9- &P -';
 }
 const [cost,summary,detail]=sheets;
 const cs=costSheet(project).rows.filter(r=>r.visible);
 const costDoc=byKey.summary;
 for(const r of cs){
  const source=(r.id==='grand'?cost.body.find(b=>String(b.values[4])==='K'):null)||((r.code==='K'||r.code.startsWith('K-')||r.code==='L'||r.code.startsWith('L-'))?cost.body.find(b=>String(b.values[4])==='H'):null)||cost.body.find(b=>String(b.values[4])===r.code)||cost.body.find(b=>norm(b.values[3])===norm(r.name))||cost.body.find(b=>String(b.values[4])===(r.id==='grand'?'K':r.charge?'20':'H'));
  const out=structuredClone(source),printed=costDoc.rows.find(x=>x.costId===r.id),last=printed.cells;
  out.values=['',source.values[1],source.values[2],norm(source.values[3])===norm(r.name)?source.values[3]:r.name,r.code,r.amount||'', '',last.at(-1).value];
  if(r.id==='grand'){out.values[4]=cs.some(x=>/^L/.test(x.code))?'M':cs.some(x=>/^K/.test(x.code))?'L':'K';if(out.values[4]==='K')out.values[7]='(J)';}
  const rate=last.at(-2).value;
  if(rate&&/%$/.test(rate)){out.values[6]=Number(rate.slice(0,-1))/100;const decimals=rate.slice(0,-1).split('.')[1]?.length||0;out.styles[6]=format(out.styles[6],r.charge?.key==='profit'?'0.00%':'0'+(decimals?'.'+'0'.repeat(decimals):'')+'%',{shrink:true});}
  out.styles[5]=format(out.styles[5],'#,##0;-#,##0;;@');out.styles[3]=format(out.styles[3],'General',{shrink:true});
  // Custom rows cannot inherit fragments of the vertical group labels.
  if(!cost.body.some(b=>String(b.values[4])===r.code)){out.values[1]='';out.values[2]='';}
  cost.rows.push(out);
 }
 function add(sheet,r,kind='detail'){
  const label=norm(r.cells[1]?.value),base=sheet.footer[label]||sheet[kind]||sheet.detail;
  const out={...structuredClone(base),sectionStart:r.sectionStart,lineIndex:r.lineIndex,values:Array(sheet.columns.length).fill('')};let column=1;
  const cells=structuredClone(r.cells);
  // L2 project titles use the blank specification, quantity and unit cells.
  // Keep the work-section number and every monetary column separate.
  if(kind==='root'&&cells[1]?.span===2&&cells[2]?.value===''&&cells[3]?.value===''){cells[1].span=4;cells.splice(2,2);}
  for(const c of cells){const span=c.span||1;out.values[column]=cellValue(c);
   if(typeof out.values[column]==='number')out.styles[column]=format(out.styles[column],Number.isInteger(out.values[column])?'#,##0;-#,##0;;@':'#,##0.0########;-#,##0.0########;;@');
   if(c.keepFont||c.readable||column===2||column===3||column===sheet.columns.length-1)out.styles[column]=format(out.styles[column],'General',{shrink:!c.keepFont});
   if(span>1)sheet.merges.push(`${columnName(column+1)}${sheet.rows.length+1}:${columnName(column+span)}${sheet.rows.length+1}`);
   column+=span;
  }
  sheet.rows.push(out);
 }
 // Expand source cells without losing the merged section caption.
 const flat=r=>{const a=[];for(const c of r.cells){a.push(c);for(let i=1;i<(c.span||1);i++)a.push({value:''});}return a;};
 const detailRows=byKey.estimate.rows;
 const directIndex=detailRows.findIndex(r=>norm(r.cells[1]?.value)==='순공사비');
 const footer=cs.filter(r=>(r.charge&&r.amount)||['net','beforeVat','contract','grand'].includes(r.id)).map(r=>{
  const rate=r.rate&&r.rate!=='정액'&&r.rate.endsWith('%')?r.rate.slice(0,-1):'';
  return {cells:[{value:''},{value:r.name},{value:''},{value:rate,align:'right'},{value:rate?'%':''},{value:''},{value:String(r.amount),align:'right'},...Array.from({length:7},()=>({value:''}))]};
 });
 for(const [i,r] of detailRows.entries()){
  const kind=r.sectionStart?(r.cells[0]?.value?'root':'heading'):i===directIndex?'total':'detail';
  add(detail,r,kind);
  if(i===directIndex)for(const f of footer)add(detail,f);
 }
 // EST's summary lists both work sections and their constituent L1 trades.
 for(const r of detailRows.slice(0,directIndex).filter(r=>r.sectionStart)){
  const a=flat(r),cells=[...r.cells.slice(0,r.cells[1]?.span===2?4:5),...([6,8,10,12].map(i=>a[i])),{value:''}];
  add(summary,{cells,sectionStart:r.sectionStart,lineIndex:r.lineIndex},r.cells[0]?.value?'root':'heading');
 }
 const tail=byKey.groups.rows.findIndex(r=>norm(r.cells[1]?.value)==='순공사비');
 for(const [i,r] of byKey.groups.rows.slice(tail).entries())add(summary,r,i===0?'total':'detail');
 styles=replacePart(styles,'cellXfs',xfs.join(''),xfs.length);
 const extra=[...formats].map(([code,id])=>`<numFmt numFmtId="${id}" formatCode="${sheetXml(code)}"/>`).join('');
 const existing=part(styles,'numFmts');styles=replacePart(styles,'numFmts',existing+extra,(existing.match(/<numFmt\b/g)||[]).length+formats.size);
 return {sheets,styles};
}
