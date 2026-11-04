export function createProjectFiles(api){
 let handle=null;
 const request=async(action,payload={})=>{const response=await fetch('./api/files/'+action,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});const result=await response.json();if(!response.ok)throw Error(result.error||'파일 작업을 완료하지 못했습니다.');return result;};
 const decode=selected=>{const bytes=Uint8Array.from(atob(selected.data),c=>c.charCodeAt(0));return {file:new File([bytes],selected.name),token:selected.token};};
 return {
  async exportDocument(data,name,format){
   const bytes=new Uint8Array(await new Blob([data]).arrayBuffer());
   let binary='';for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));
   return request('export',{name,format,data:btoa(binary)});
  },
  async save(project,saveAs=false){
   const name=(project.title||'새 내역서')+'.gongsa';
   if(api.desktop)return request('save',{project,name,saveAs});
   if(!globalThis.showSaveFilePicker){api.download(JSON.stringify(project,null,2),name,'application/json');return {saved:true,name};}
   try{const target=saveAs||!handle?await showSaveFilePicker({suggestedName:name,types:[{description:'공사노트',accept:{'application/json':['.gongsa']}}]}):handle;const writer=await target.createWritable();await writer.write(JSON.stringify(project,null,2));await writer.close();handle=target;return {saved:true,name:handle.name};}catch(e){if(e.name==='AbortError')return {cancelled:true};throw e;}
  },
  async open(){
   if(!api.desktop)return null;
   const selected=await request('open');if(selected.cancelled)return selected;
   return decode(selected);
  },
  async next(){if(!api.desktop)return null;const selected=await request('next');return selected.empty?null:decode(selected);},
  async activate(token){if(api.desktop&&token)await request('activate',{token});else await this.reset();},
  async reset(){handle=null;if(api.desktop)await request('reset');}
 };
}
