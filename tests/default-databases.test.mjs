import test from 'node:test';
import assert from 'node:assert/strict';
import {loadDefaultDatabases} from '../dist/default-databases.js';
import {preferredLibrary} from '../dist/auto-link.js';
import {resourceLibrary} from '../dist/resource-pricing.js';
const bytes=new TextEncoder().encode('fixture database');
const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),n=>n.toString(16).padStart(2,'0')).join('');
const manifest=[{name:'2026-10-main.estx',role:'resource',bytes:bytes.length,sha256:digest},{name:'추가.ebkx',role:'assembly',bytes:bytes.length,sha256:digest}];
const runtime={seedNeeded:true,seedManifest:manifest};
const fetcher=async()=>({ok:true,arrayBuffer:async()=>bytes.buffer});
const importer=async(data,name)=>({id:name,name,items:[]});
test('신규 설치에 두 DB를 등록하고 산출과 가격 우선순위를 분리한다',async()=>{
 const libs=await loadDefaultDatabases([],runtime,importer,fetcher);assert.equal(libs.length,2);assert.equal(preferredLibrary({},libs),'추가.ebkx');assert.equal(resourceLibrary({},libs).name,'2026-10-main.estx');assert.equal(libs[0].priceUpdateReference,true);
});
test('기존 사용자 DB와 명시적으로 비운 DB는 기본 자료로 덮어쓰지 않는다',async()=>{
 const current=[{id:'user',name:'수정한 DB',items:[{price:123}]}],fail=()=>{throw Error('must not load')};
 assert.equal(await loadDefaultDatabases(current,runtime,fail,fail),current);assert.deepEqual(await loadDefaultDatabases([],{...runtime,seedNeeded:false},fail,fail),[]);
});
test('두 번째 파일 손상·누락 시 기존 배열을 바꾸거나 부분 성공하지 않는다',async()=>{
 const current=[];let calls=0;
 await assert.rejects(loadDefaultDatabases(current,runtime,importer,async()=>++calls===2?{ok:false}:fetcher()),/기본 DB/);assert.deepEqual(current,[]);
 await assert.rejects(loadDefaultDatabases([],{...runtime,seedManifest:[{...manifest[0],sha256:'0'.repeat(64)}]},importer,fetcher),/검증/);
});
