import test from 'node:test';
import assert from 'node:assert/strict';
import {updateControls} from '../dist/updates.js';

test('저장·백업·재시작 중 추가 설치와 새 버전 확인을 막는다',()=>{
 for(const phase of ['preparing','installing']) {
  const result=updateControls({phase});
  assert.ok(result.busy && result.restarting && result.checkDisabled);
  assert.equal(result.install,false);
 }
 assert.ok(updateControls({phase:'ready'},true).busy);
});
test('다운로드 중 작업 계속·취소 가능, 실패 후 재다운로드 가능',()=>{
 assert.equal(updateControls({phase:'downloading'}).cancel,true);
 assert.equal(updateControls({phase:'downloading'}).restarting,false);
 assert.equal(updateControls({phase:'error',canDownload:true}).download,true);
 assert.equal(updateControls({phase:'unconfigured'}).checkDisabled,true);
 assert.equal(updateControls({phase:'ready'}).install,true);
});
