import test from 'node:test';
import assert from 'node:assert/strict';
import {boundaryDirection,insertBoundaryLine} from '../dist/grid-keyboard.js';
test('첫 행 위·마지막 행 아래에서만 방향키 행 삽입을 허용한다',()=>{
 assert.equal(boundaryDirection({key:'ArrowUp'},0,3),-1);
 assert.equal(boundaryDirection({key:'ArrowDown'},2,3),1);
 for(const key of ['ArrowUp','ArrowDown'])assert.equal(boundaryDirection({key},1,3),0);
 for(const modifier of ['shiftKey','ctrlKey','metaKey','altKey','repeat','isComposing'])assert.equal(boundaryDirection({key:'ArrowDown',[modifier]:true},2,3),0);
 for(const key of ['Enter','Tab','ArrowLeft','ArrowRight'])assert.equal(boundaryDirection({key},2,3),0);
});
test('필터 끝을 실제 내역 끝으로 오인하지 않으며 원본과 기존 행을 보존한다',()=>{
 const lines=[{id:'a',group:'토공',bucket:'direct'},{id:'b',group:'폐기물처리비',bucket:'waste'}],before=structuredClone(lines);
 assert.equal(insertBoundaryLine(lines,'a',1),null);assert.equal(insertBoundaryLine(lines,'b',-1),null);
 const up=insertBoundaryLine(lines,'a',-1),down=insertBoundaryLine(lines,'b',1);
 assert.equal(up.lines[0].id,up.line.id);assert.equal(down.lines.at(-1).id,down.line.id);
 assert.equal(up.line.bucket,'direct');assert.equal(down.line.bucket,'waste');assert.equal(down.line.level,undefined);
 assert.deepEqual(lines,before);assert.equal(down.line.rate,null);assert.equal(down.line.name,'');
});
