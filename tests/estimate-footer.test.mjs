import test from 'node:test';
import assert from 'node:assert/strict';
import {addSeparateCost,setSeparateUnitPrice,estimateFooterRows} from '../dist/estimate-footer.js';
import {synchronizeLinkedCosts,totals} from '../dist/calc.js';
import {validateProject} from '../dist/project-data.js';
import {estimateGrid} from '../dist/estimate-grid.js';
import {hierarchyView} from '../dist/levels.js';
import {hierarchyTotals} from '../dist/estimate-core.js';
import {costSheet} from '../dist/cost-sheet.js';
const p=()=>({schema:1,title:'검증',lines:[{id:'root',name:'1공구',spec:'',unit:'',group:'',level:2,headingScope:'direct',bucket:'direct',status:'unmatched'},{id:'a',name:'토공',spec:'',unit:'식',qty:1,bucket:'direct',group:'토공',status:'confirmed',rate:{labor:1000,material:0,expense:0,other:0,total:1000}}],charges:[{key:'management',name:'일반관리비',base:'direct',rate:10},{key:'vat',name:'부가가치세',base:'contractBeforeVat',rate:10}]});
test('별도 비용 입력은 직접공사비와 제경비를 늘리지 않고 부가세·총공사비에만 연결한다',()=>{
 let next=p();const original=structuredClone(next);
 for(const name of ['폐기물처리비','현장점검비','관급자재대','원인자부담금','수수료']){
  const added=addSeparateCost(next,name,'root');added.project.lines=added.project.lines.map(l=>l.id===added.line.id?setSeparateUnitPrice(l,100):l);next=synchronizeLinkedCosts(added.project);
 }
 const t=totals(next.lines,next.charges);assert.equal(t.direct,1000);assert.equal(t.charges[0].amount,100);assert.equal(t.charges[1].amount,130);assert.equal(t.contract,1430);assert.equal(t.grand,1730);
 assert.deepEqual(p(),original);assert.equal(validateProject(next).lines.length,12);
 for(const name of ['폐기물처리비','현장점검비','관급자재대','원인자부담금','수수료'])assert.equal(costSheet(next).rows.find(r=>r.name===name).amount,100);
 assert.deepEqual(synchronizeLinkedCosts(next),next);
});
test('같은 공구·비용을 추가하면 기존 제목 아래에 붙이며 금액 수정·저장 후에도 집계가 유지된다',()=>{
 let a=addSeparateCost(p(),'폐기물처리비','root');let b=addSeparateCost(a.project,'폐기물처리비','root');
 assert.equal(b.project.lines.filter(l=>l.name==='폐기물처리비'&&l.level).length,1);
 b.project.lines=b.project.lines.map(l=>l.id===a.line.id?setSeparateUnitPrice({...l,qty:2},150):l);
 let project=validateProject(JSON.parse(JSON.stringify(synchronizeLinkedCosts(b.project))));assert.equal(totals(project.lines,project.charges).waste,300);
 assert.throws(()=>setSeparateUnitPrice(a.line,-1));assert.throws(()=>setSeparateUnitPrice(a.line,''));
 assert.throws(()=>addSeparateCost(project,'수수료','missing'));
});
test('화면 합계는 원가계산서와 같고 별도 비용이 없어도 항상 맨 아래 나타난다',()=>{
 const project=synchronizeLinkedCosts(p()),rows=estimateFooterRows(project),sheet=costSheet(project);
 for(const id of ['net','beforeVat','contract','grand'])assert.equal(rows.find(r=>r.id===id).amount,sheet.rows.find(r=>r.id===id).amount);
 const html=estimateGrid(project.lines,{project,subtotals:hierarchyTotals(project.lines),hierarchy:hierarchyView(project.lines),esc:String,num:String,money:String});
 assert.equal((html.match(/data-estimate-summary="direct"/g)||[]).length,1);assert.ok(html.indexOf('data-estimate-summary')>html.indexOf('data-id="a"'));
 assert.match(html,/data-add-separate/);
});
test('별도 공구 비용이 있으면 합계는 직접공사 뒤, 별도 공종 앞에 한 번만 나온다',()=>{
 const project=synchronizeLinkedCosts(addSeparateCost(p(),'폐기물처리비','root').project);
 const html=estimateGrid(project.lines,{project,subtotals:hierarchyTotals(project.lines),hierarchy:hierarchyView(project.lines),esc:String,num:String,money:String});
 const index=html.indexOf('data-estimate-summary="direct"');assert.ok(index>html.indexOf('data-id="a"'));assert.ok(index<html.indexOf(`data-id="${project.lines[2].id}"`));
 assert.equal((html.match(/data-estimate-summary="direct"/g)||[]).length,1);
});
