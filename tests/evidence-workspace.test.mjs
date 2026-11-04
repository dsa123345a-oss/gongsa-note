import test from 'node:test';
import assert from 'node:assert/strict';
import {evidenceEntries,evidenceContent} from '../dist/evidence-workspace.js';
const labor={name:'배 관 공',spec:'',unit:'인',category:'노임',code:'L1',labor:100,material:0,expense:0,other:0,total:100,source:'10월'};
const rate={name:'STS 이형관 접합',spec:'13mm',unit:'개소',category:'단가산출',code:'D1',source:'추가',components:[{...labor,qty:2}],calculation:{},labor:200,material:0,expense:0,other:0,total:200};
const project=()=>({lines:[{id:'line',name:rate.name,group:'배관',unit:'개소',qty:3,bucket:'direct',status:'confirmed',rate}],charges:[]});
test('하단 탭은 공사에 사용한 단가만 구분하며 공백 없이 검색한다',()=>{
 const p=project(),entry=evidenceEntries(p,[],'단가산출','STS이형관접합');assert.equal(entry.length,1);assert.equal(entry[0].lines[0].id,'line');assert.equal(entry[0].editNode,entry[0].node);
 assert.equal(evidenceEntries(p,[],'일위대가').length,0);p.lines[0].exclude=true;assert.equal(evidenceEntries(p,[],'단가산출').length,0);
});
test('구성 노임은 사용 내역으로 이동하되 부모 산출을 편집하도록 연결한다',()=>{
 const entry=evidenceEntries(project(),[],'노임')[0];assert.equal(entry.node.rate.name,'배 관 공');assert.equal(entry.lines[0].id,'line');assert.equal(entry.editNode.rate.code,'D1');assert.notEqual(entry.editNode,entry.node);
});
test('근거에는 수식과 비목 금액을 표시하고 품명 HTML은 실행하지 않는다',()=>{
 const p=project();p.lines[0].rate=structuredClone(rate);p.lines[0].rate.name='<img src=x onerror=alert(1)>';
 const entry=evidenceEntries(p,[],'단가산출')[0],html=evidenceContent(entry.node);assert.match(html,/100 × \(2\)/);assert.match(html,/200/);assert.match(html,/&lt;img/);assert.doesNotMatch(html,/<img/);
});
