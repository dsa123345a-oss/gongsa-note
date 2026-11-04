import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {inflateRawSync} from 'node:zlib';
import {decodeCp949} from '../dist/cp949.js';
import {originalEstimate,originalEstimateHtml} from '../dist/original-est.js';
import {importEst} from '../dist/est.js';

test('CP949 확장 한글과 혼합 ASCII를 운영체제에 관계없이 읽는다',()=>{
 assert.equal(decodeCp949(Uint8Array.from([0x41,0x97,0xa5,0x42])),'A뿥B');
 assert.equal(decodeCp949(Uint8Array.from([0x81,0x20,0x41])),'� A');
 assert.equal(decodeCp949(Uint8Array.from([0x81])),'�');
});
test('원본 문서 보기에서는 공종·원가·빈행·수량 미입력·음수를 보존한다',()=>{
 const rows=[{_record:0,Name:'  공종  ',Level:1,TC:100},{_record:1,Code:'A',Name:'항목',GN:2,NU:50,TU:50,NC:100,TC:100},{_record:2,Code:'B',Name:'미입력',TU:100,TC:0},{_record:3,Code:'C',Name:'감액',GN:-1,JU:100,TU:100,JC:-100,TC:-100},{_record:4,Name:'도급예정액',LinkIndex:58,TC:110},{_record:5}];
 const lib={tables:[{name:'EstMainDat.dat',rows}]},before=structuredClone(lib),result=originalEstimate(lib);
 assert.equal(result.rows.length,6);assert.equal(result.checked,2);assert.equal(result.unset,1);assert.equal(result.differences.length,0);
 assert.equal(result.rows[3].check,'match');const wrong=structuredClone(lib);wrong.tables[0].rows[3].TC=-101;assert.equal(originalEstimate(wrong).differences.length,1);
 assert.equal(result.rows[1].check,'match');assert.equal(result.rows[3].TC,-100);assert.deepEqual(lib,before);
 const html=originalEstimateHtml(result.rows);assert.match(html,/>-100<\/td>/);assert.match(html,/  공종  /);assert.match(html,/도급예정액/);assert.equal((html.match(/data-original-record=/g)||[]).length,6);
 assert.match(originalEstimateHtml([{_record:0,Name:'<img src=x>',GN:0}]),/&lt;img src=x&gt;/);
});
test('실제 EST 저장 공사는 63행·37개 품목·최종 공사비까지 그대로 읽는다',{skip:!process.env.EST_PROJECT_PATH},async()=>{
 const bytes=await fs.readFile(process.env.EST_PROJECT_PATH),lib=await importEst(bytes,'실제 공사.estx',inflateRawSync),result=originalEstimate(lib);
 assert.equal(result.rows.length,63);assert.equal(result.checked,37);assert.equal(result.differences.length,0);assert.equal(result.unset,0);
 assert.equal(result.rows.find(r=>r.Name==='총공사비').TC,1877000);
 assert.equal(result.rows.find(r=>r.Name==='도급예정액').TC,1650000);
 assert.deepEqual(lib.originalBytes,bytes);
});
