import test from 'node:test';
import assert from 'node:assert/strict';
import {createProjectFiles} from '../dist/project-files.js';
test('엑셀·PDF 저장은 이름과 바이트를 보존하며 취소·저장 실패를 호출자에게 전달한다',async t=>{
 const data=Uint8Array.from({length:90000},(_,i)=>i%256),calls=[];
 t.mock.method(globalThis,'fetch',async(url,init)=>{
  const payload=JSON.parse(init.body);calls.push({url,payload});
  assert.deepEqual(Buffer.from(payload.data,'base64'),Buffer.from(data));
  return {ok:true,json:async()=>({cancelled:true})};
 });
 const files=createProjectFiles({desktop:true});
 for(const format of ['xlsx','pdf']){
  assert.deepEqual(await files.exportDocument(data,'시험 공사(내역서).'+format,format),{cancelled:true});
  assert.equal(calls.at(-1).payload.format,format);assert.equal(calls.at(-1).url,'./api/files/export');assert.equal(calls.at(-1).payload.name,'시험 공사(내역서).'+format);
 }
 globalThis.fetch=async()=>({ok:false,json:async()=>({error:'저장 공간이 부족합니다.'})});
 await assert.rejects(files.exportDocument(data,'공사.xlsx','xlsx'),/저장 공간/);
});
