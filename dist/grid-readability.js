// Size only display controls; quantities, rates and project text stay untouched.
export function setupGridReadability(table){
 const canvas=document.createElement('canvas'),context=canvas.getContext('2d');let frame=0;
 const fitQuantity=el=>{
  const style=getComputedStyle(el);context.font=`${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
  el.style.width=Math.max(73,Math.ceil(context.measureText(el.value).width)+18)+'px';
  el.title=el.value;
 };
 const fitText=elements=>{
  const visible=elements.filter(el=>el.getClientRects().length);
  for(const el of visible)el.style.height='0px';
  const heights=visible.map(el=>Math.max(el.matches('.grid-group,.heading-name')?30:25,el.scrollHeight+2));
  visible.forEach((el,i)=>{el.style.height=heights[i]+'px';el.title=el.value;});
 };
 const fit=()=>{frame=0;fitText([...table.querySelectorAll('textarea.cell-input')]);table.querySelectorAll('[data-field="qty"]').forEach(fitQuantity);};
 const schedule=()=>{if(!frame)frame=requestAnimationFrame(fit);};
 new ResizeObserver(schedule).observe(table);
 new MutationObserver(schedule).observe(table,{childList:true,subtree:true});
 table.addEventListener('input',e=>{
  if(e.target.matches('textarea.cell-input'))fitText([e.target]);
  else if(e.target.matches('[data-field="qty"]'))fitQuantity(e.target);
 });
 schedule();
}
