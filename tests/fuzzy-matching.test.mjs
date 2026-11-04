import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {inflateRawSync} from 'node:zlib';
import {searchLibraries} from '../dist/library-search.js';
import {planAutoLinks} from '../dist/auto-link.js';
import {importEst} from '../dist/est.js';
import {estimateGrid} from '../dist/estimate-grid.js';
const item=(id,name,spec)=>({id,code:id,name,spec,unit:'개소',category:'일위대가',source:'메인',labor:100,material:0,expense:0,other:0,total:100});
test('제수·지수·소프트실 이름 변형과 띄어쓰기를 관련 후보로 검색한다',()=>{
 const lib={id:'a',items:[item('a','소프트지수밸브 설치','D50'),item('b','소프트실제수밸브설치','D80'),item('c','콘크리트 포장','D50')]};
 assert.deepEqual(searchLibraries([lib],'소프트실제수밸브 설치','일위대가')[0].items.map(i=>i.id),['b','a']);
 assert.deepEqual(searchLibraries([lib],'소프트지수밸브 설치','일위대가')[0].items.map(i=>i.id),['a','b']);
 assert.equal(searchLibraries([lib],'소프트지수밸브 설치','자재')[0].items.length,0);
});
test('규격 숫자가 모두 달라도 같은 품명의 가까운 관경을 자동 제안한다',()=>{
 const line={id:'l',name:'소프트실제수밸브 설치',spec:'D80',unit:'개소',group:'배관공',status:'unmatched'},libs=[{id:'a',name:'메인',items:[item('far','소프트지수밸브 설치','D300'),item('near','소프트지수밸브 설치','D75'),item('missing','소프트지수밸브 설치','')]}];
 const match=planAutoLinks({lines:[line]},libs)[0];assert.equal(match.rate.id,'near');assert.match(match.reason,/규격 수치 다름/);
 libs[0].items.push(item('exact','소프트지수밸브 설치','D80'));assert.equal(planAutoLinks({lines:[line]},libs)[0].rate.id,'exact');
});
test('긴 공종 제목은 여러 줄 편집 칸이며 미확정 내역은 별도 표시한다',()=>{
 const heading={id:'h',level:2,name:'상수도긴급보수공사(1공구 후포면 후포로182 배수관 보수)',group:'',source:''};
 const line={id:'l',level:0,name:'밸브',spec:'D80',unit:'개소',group:'배관공',qty:1,status:'unmatched',bucket:'direct'};
 const html=estimateGrid([heading,line],{selectedLineId:null,subtotals:new Map([['h',{total:0,labor:0,material:0,expense:0,missing:1}]]),hierarchy:new Map(),esc:s=>String(s??''),num:String,money:String});
 assert.match(html,/colspan="5" class="heading-title"/);assert.match(html,/<textarea[^>]+data-field="name"/);assert.ok(html.includes(heading.name));assert.match(html,/unconfirmed-row/);assert.match(html,/미확정 · 연결/);
});
test('실제 메인 두 개에서 소프트실제수밸브 설치로 관련 일위를 찾는다',{skip:!process.env.EST_MONTH_PATH||!process.env.EST_ADDED_PATH},async()=>{
 const libs=[];for(const path of [process.env.EST_MONTH_PATH,process.env.EST_ADDED_PATH])libs.push(await importEst(await fs.readFile(path),path,inflateRawSync));
 const result=searchLibraries(libs,'소프트실제수밸브 설치','일위대가');assert.ok(result.some(g=>g.items.length));
 for(const g of result){assert.ok(g.items.every(i=>i.category==='일위대가'));console.log(g.items.slice(0,3).map(i=>({name:i.name,spec:i.spec})));}
 const lines=[['PE이형관접합','D20','개소'],['소프트실제수밸브','D20','개'],['콘크리트 포장','','㎥'],['수도미터','D15','개']].map(([name,spec,unit],i)=>({id:String(i),name,spec,unit,status:'unmatched',group:i===1||i===3?'자재대':'배관공'}));
 const plans=planAutoLinks({lines},[libs[1]],'',libs[1].id);
 assert.deepEqual(plans.map(p=>p.rate?.code),['U0000000009','M0000000088','D0000000042','M0000000130']);
});
