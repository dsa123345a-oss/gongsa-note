import {printCss} from './print-pack.js';
import {printSettings} from './print-settings.js';
// Paginate measured content using the same widths, fonts and row styles as print.
export function paginatePrint(html,options={}){
 const s=printSettings(options),landscape=s.orientation==='landscape',width=landscape?297:210,height=landscape?210:297;
 const host=document.createElement('div');host.style.cssText='position:absolute;left:-20000px;top:0;visibility:hidden';
 host.innerHTML='<style>'+printCss+paginatedCss(options)+'</style>'+html;document.body.append(host);const pages=[],warnings=[];
 const px=96/25.4,available=(height-2*s.margin-10)*px;
 try{
  for(const source of [...host.querySelectorAll(':scope > section')]){
   let page,body,section,used=0;
   const start=()=>{page=document.createElement('article');page.className='sheet-page';page.style.cssText=`width:${width}mm;height:${height}mm;padding:${s.margin}mm;box-sizing:border-box;position:relative;overflow:hidden;background:white;break-after:page`;
    body=document.createElement('div');body.className='sheet-body';body.style.display='flow-root';section=source.cloneNode(false);section.style.padding='0';section.style.breakBefore='auto';section.style.pageBreakBefore='auto';body.append(section);page.append(body);host.append(page);pages.push(page);used=0;
   };
   start();
   const fits=()=>body.getBoundingClientRect().height<=available;
   function append(node){
    const wantsBreak=node.classList?.contains('print-break');node.classList?.remove('print-break');
    if(wantsBreak&&used)start();
    if(node.tagName==='TABLE'){
     let table=node.cloneNode(false),head=node.querySelector('thead'),tbody=document.createElement('tbody');
     const addTable=()=>{table=node.cloneNode(false);if(head)table.append(head.cloneNode(true));tbody=document.createElement('tbody');table.append(tbody);section.append(table);};addTable();
     for(const row of [...node.querySelectorAll('tbody > tr')]){
      const force=row.classList.contains('print-break');row.classList.remove('print-break');
      if(force&&used){start();addTable();}
      tbody.append(row);
      if(!fits()&&(tbody.children.length>1||used)){row.remove();if(!tbody.children.length)table.remove();start();addTable();tbody.append(row);}
      if(!fits())warnings.push('한 행이 한 페이지보다 깁니다. 글자 크기 또는 내용을 조정하세요.');used++;
     }
    }else if(node.tagName==='DIV'&&node.querySelector('table')){for(const child of [...node.children])append(child);}
    else {section.append(node);if(!fits()&&used){node.remove();start();section.append(node);}if(!fits())warnings.push('한 문단이 한 페이지보다 깁니다. 문단을 나누거나 글자를 조정하세요.');used++;}
   }
   for(const child of [...source.children])append(child.cloneNode(true));
  }
  pages.forEach((p,i)=>{const footer=document.createElement('footer');footer.className='sheet-footer';footer.style.cssText=`position:absolute;bottom:${s.margin}mm;left:${s.margin}mm;right:${s.margin}mm;text-align:center;font-size:9pt`;footer.textContent=`${s.startPage+i} / ${s.startPage+pages.length-1}`;p.append(footer);});
  if(warnings.length)throw Error([...new Set(warnings)].join(' '));
  return {html:pages.map(p=>p.outerHTML).join(''),pages:pages.length};
 }finally{host.remove();}
}
export function paginatedCss(options={}){const s=printSettings(options);return `@page{size:A4 ${s.orientation};margin:0}.sheet-page{margin:0 auto;page-break-after:always}.sheet-page:last-child{page-break-after:auto;break-after:auto}.sheet-page .print-page{page-break-before:auto;break-before:auto;margin:0;padding:0}.sheet-body{display:flow-root}.sheet-footer{color:#333}@media screen{.sheet-page{border:1px solid #bbb;margin:12px auto;box-shadow:0 1px 4px #ddd}}`;}
