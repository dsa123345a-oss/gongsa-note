import test from 'node:test';
import assert from 'node:assert/strict';
import {searchLibraries,searchLineLibraries} from '../dist/library-search.js';
const source=(extra={})=>({id:'source',code:'D42',name:'콘크리트포장(인력포설)',spec:'B-Type, t=20cm',unit:'㎥',category:'단가산출',table:'CostTitleDat',labor:28231,material:846,expense:0,other:0,total:29077,...extra});
const copy=(extra={})=>source({id:'copy',table:'EstMainDat',category:'내역단가',...extra});
const search=(lib,q='콘크리트',category='')=>searchLibraries([lib],q,category)[0];
test('전체 검색은 같은 DB의 동일 산출·내역 복사본만 산출 단가로 표시한다',()=>{
 const a=source(),b=copy(),lib={items:[b,a]},line={name:a.name,spec:a.spec};
 for(const q of ['','콘크리트','콘크리트 포장']){
  assert.deepEqual(search(lib,q).items,[a]);assert.deepEqual(searchLineLibraries([lib],line,q)[0].items,[a]);
 }
 assert.equal(search(lib).exactCount,1);assert.deepEqual(search(lib,'콘크리트','내역단가').items,[b]);assert.deepEqual(lib.items,[b,a]);
 assert.equal(searchLibraries([lib,{items:[copy()]}],'콘크리트')[1].items.length,1);
});
test('동일 합계여도 비목·규격·단위·코드·관급 구분·수정 근거가 다르면 유지한다',()=>{
 for(const extra of [{labor:28230,material:847},{total:30000},{spec:'B-Type, t=10cm'},{unit:'개'},{code:'D43'},{government:true},{components:[]},{calculation:{}},{manual:true}]){
  assert.equal(search({items:[source(),copy(extra)]}).items.length,2,JSON.stringify(extra));
 }
 assert.equal(search({items:[copy(),copy({id:'copy2'})]}).items.length,2);
});
test('띄어쓰기·단위 표기 차이는 정리하고 DB를 제자리 수정하면 즉시 다시 표시한다',()=>{
 const a=source(),b=copy({name:'콘크리트 포장(인력포설)',unit:'m³'}),lib={items:[a,b]};
 assert.equal(search(lib).items.length,1);
 b.total=29078;assert.equal(search(lib).items.length,2);b.total=29077;
 b.other=1;assert.equal(search(lib).items.length,2);b.other=0;
 b.unit='개';assert.equal(search(lib).items.length,2);b.unit='㎥';
 b.table='CostTitleDat';assert.equal(search(lib).items.length,2);b.table='EstMainDat';
 b.components=[];assert.equal(search(lib).items.length,2);delete b.components;
 assert.equal(search(lib).items.length,1);
});
