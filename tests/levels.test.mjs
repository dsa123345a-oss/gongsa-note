import test from 'node:test';import assert from 'node:assert/strict';
import {hierarchyView,changeLevel,groupHeadings} from '../dist/levels.js';
import {hierarchyTotals} from '../dist/estimate-core.js';import {totals} from '../dist/calc.js';
const leaf=(id,group='토공')=>({id,name:id,spec:'',unit:'m',group,qty:2,bucket:'direct',status:'confirmed',factor:1,rate:{labor:100,material:0,expense:0,other:0,total:100}});
test('상위 공종 접기는 다음 같은 레벨부터 다시 표시하고 합계에 영향을 주지 않는다',()=>{
 const lines=[{id:'top',level:3,collapsed:true},{id:'child',level:1},leaf('a'),{id:'next',level:3},leaf('b')],view=hierarchyView(lines);
 assert.equal(view.get('child').hidden,true);assert.equal(view.get('a').depth,2);assert.equal(view.get('next').hidden,false);assert.equal(view.get('b').hidden,false);assert.equal(totals(lines,[]).direct,400);
});
test('공종명으로 소계를 만들어도 수량·금액·행 순서가 유지된다',()=>{
 const p={lines:[leaf('a'),leaf('b','포장공')],charges:[]},next=groupHeadings(p);
 assert.equal(next.lines.length,4);assert.deepEqual(next.lines.filter(l=>!l.level),p.lines);assert.equal(totals(next.lines,[]).direct,400);assert.equal(hierarchyTotals(next.lines).get(next.lines[0].id).total,200);assert.throws(()=>groupHeadings(next),/이미/);
});
test('같은 레벨 변경은 다른 공종과 세부 내역을 유지한다',()=>{
 const p={lines:[{id:'top',level:3},{id:'a',level:1},leaf('x'),{id:'b',level:1}]},next=changeLevel(p,'a',2,'same');
 assert.deepEqual(next.lines.map(l=>l.level||0),[3,2,0,2]);assert.deepEqual(p.lines.map(l=>l.level||0),[3,1,0,1]);assert.throws(()=>changeLevel(p,'x',1,'same'),/현재 행/);
});
