// Display labels never alter the saved original EST/quantity-sheet headings.
export function sectionCaption(line){
 const original=String(line.name||'').trim();
 // Old imports appended (N공구 현장명) to the complete bundle title.
 const section=original.match(/[（(]\s*(?:제\s*)?\d+\s*공구\s+([\s\S]*)[)）]\s*$/);
 const wrapper=/^상수도\s*(?:긴급\s*보수|신규\s*급수|급수)?\s*공사\s*[（(]\s*/;
 let name=section?section[1]:wrapper.test(original)?original.replace(/^상수도\s*(?:긴급\s*보수|신규\s*급수|급수)?\s*공사\s*[（(]\s*/,'').replace(/[)）]\s*$/,''):original;
 name=name.replace(/^\s*(?:제\s*)?\d+\s*공구\s*(?:공사\s*)?[-:.)·]?\s*/,'').trim();
 if(!name)name=original;
 const spec=String(line.spec||'').trim();
 return [name,...(spec&&!name.endsWith(spec)?[spec]:[])].join(' ');
}
export const sectionTitle=(number,site)=>`${number}공구${String(site||'').trim()?' '+String(site).trim():''}`;
export function normalizeSectionTitles(project){
 for(const l of project.lines)if(l.level===2&&l.autoHeading==='section'&&l.sectionNumber){
  const old=l.name,caption=sectionCaption({...l,spec:''});l.name=sectionTitle(l.sectionNumber,caption);
  if(old!==l.name&&!l.originalHeading)l.originalHeading=old;
 }
 return project;
}
export function emergencyBundleTitle(base,site){
 const title=String(base||'상수도긴급보수공사').trim();
 return /^상수도\s*긴급\s*보수\s*공사$/.test(title)&&site?`${title}(${site} 등)`:title;
}
export function workbookFileName(title){
 const safe=String(title||'설계내역서').trim().replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').replace(/[. ]+$/,'').slice(0,150)||'설계내역서';
 return safe+'(내역서).xlsx';
}
export const pdfFileName=title=>workbookFileName(title).replace(/\.xlsx$/,'.pdf');
export function renameProject(project,title){
 const next=structuredClone(project);next.title=String(title).trim();
 for(const line of next.lines)if(line.autoHeading==='project')line.name=next.title||'공사명';
 return normalizeSectionTitles(next);
}
