import test from 'node:test';
import assert from 'node:assert/strict';
import {upgradeRegisteredLibraryMetadata} from '../dist/library-metadata-upgrade.js';

test('등록 자료 순서와 사용자 가격을 유지하며 원본 비고만 보완한다',async()=>{
 const libraries=[{id:'one',name:'원본',items:[{total:123}]},{id:'two',name:'직접 입력',items:[{total:456}]}],before=structuredClone(libraries);
 const out=await upgradeRegisteredLibraryMetadata(libraries,async lib=>lib.id==='one'?{library:{...lib,items:lib.items.map(r=>({...r,bigo:'p.837'}))},changed:true,status:'upgraded'}:{library:lib,changed:false,status:'missing-original'});
 assert.deepEqual(libraries,before);assert.deepEqual(out.libraries.map(l=>l.id),['one','two']);assert.deepEqual(out.libraries.map(l=>l.items[0].total),[123,456]);assert.equal(out.libraries[0].items[0].bigo,'p.837');assert.deepEqual(out.warnings,[]);
});
test('손상된 한 자료가 있어도 나머지 등록 DB와 작업 열기를 막지 않는다',async()=>{
 const libraries=[{id:'broken',name:'손상'},{id:'valid',name:'정상'}];
 const out=await upgradeRegisteredLibraryMetadata(libraries,async lib=>{if(lib.id==='broken')throw Error('메모 블록 불일치');return {library:{...lib,estMetadataVersion:1},changed:true,status:'upgraded'};});
 assert.equal(out.libraries[0],libraries[0]);assert.equal(out.libraries[1].estMetadataVersion,1);assert.equal(out.warnings[0].reason,'메모 블록 불일치');
});
test('이미 보완된 자료는 다시 저장하거나 복사하지 않는다',async()=>{
 const libraries=[{name:'정상',estMetadataVersion:1}];const out=await upgradeRegisteredLibraryMetadata(libraries);
 assert.equal(out.libraries,libraries);assert.equal(out.changed,false);assert.deepEqual(out.warnings,[]);
});
