import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {inflateRawSync} from 'node:zlib';
import {mergeLibrary,searchLibraries} from '../dist/library-search.js';
import {importEst} from '../dist/est.js';

test('추가·동일 파일 교체 후 기본 DB 유지, 같은 코드는 DB별 보존',()=>{
 const item={name:'PE 이형관 접합',spec:'D=20mm',code:'U001',category:'일위대가'};
 const main={id:'main',name:'10월.estx',isMain:true,items:[{...item,id:'main:1',total:100}]};
 let libs=mergeLibrary([main],{id:'add',name:'추가.ebkx',items:[{...item,id:'add:1',total:200},{...item,category:'내역단가',total:300}]});
 assert.equal(libs.find(l=>l.isMain).id,'main');
 let result=searchLibraries(libs,'pe이형관접합','일위대가');
 assert.deepEqual(result.map(g=>g.items.map(i=>i.total)),[[100],[200]]);
 assert.deepEqual(searchLibraries(libs,'없는 이름','일위대가').map(g=>g.items.length),[0,0]);
 libs=mergeLibrary(libs,{id:'replacement',name:'10월.estx',items:main.items});
 assert.equal(libs.length,2);assert.equal(libs.find(l=>l.isMain).id,'replacement');
 assert.equal(searchLibraries(libs,'20mm PE','일위대가','add')[0].items[0].total,200);
});

test('두 실제 메인의 PE이형관접합 일위대가를 각각 검색',{skip:!process.env.EST_MONTH_PATH||!process.env.EST_ADDED_PATH},async()=>{
 const libraries=[];
 for(const [name,path] of [['10월 메인',process.env.EST_MONTH_PATH],['추가 메인',process.env.EST_ADDED_PATH]])libraries.push(await importEst(await fs.readFile(path),name,inflateRawSync));
 libraries[0].isMain=true;
 const groups=searchLibraries(libraries,'pe이형관접합','일위대가');
 assert.equal(groups.length,2);assert.ok(groups.every(g=>g.items.length>0));
 assert.equal(groups[0].related,true);assert.equal(groups[1].related,false);
 assert.ok(groups[0].items.length>=34);assert.equal(groups[1].exactCount,9);assert.ok(groups[1].items.length>=9);
 assert.ok(groups[1].items.slice(0,9).every(i=>i.name.replace(/\s/g,'').toLowerCase().includes('pe이형관접합')));
 assert.ok(groups.every(g=>g.items.every(i=>i.category==='일위대가'&&i.library===g.library.id)));
 console.log(groups.map(g=>({db:g.library.name,count:g.items.length,sample:g.items[0].name,price:g.items[0].total})));
});
