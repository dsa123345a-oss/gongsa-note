import test from 'node:test';
import assert from 'node:assert/strict';
import {totals,synchronizeLinkedCosts} from '../dist/calc.js';
import {resolveCostScopes,separateSectionLabel} from '../dist/cost-scopes.js';
import {hierarchyView} from '../dist/levels.js';
import {costSheet} from '../dist/cost-sheet.js';
import {connectNamedCostGroup,insertCostCharge} from '../dist/cost-edit.js';
import {makePrintDocuments} from '../dist/est-print.js';
import {validateProject} from '../dist/project-data.js';
import {hierarchyTotals} from '../dist/estimate-core.js';
const item=(id,n)=>({id,name:id,spec:'',unit:'식',group:'시험',bucket:'direct',qty:1,status:'confirmed',rate:{name:id,unit:'식',labor:n,material:0,expense:0,other:0,total:n}});
const heading=(id,name,level=1)=>({...item(id,0),name,level,headingScope:level===2?'direct':undefined});
const project=()=>({schema:1,title:'별도 공종 시험',lines:[heading('root','공사명',2),heading('earth','토공'),item('dig',1000),...['폐기물처리비','현장점검비','관급자재대','수수료','원인자부담금'].flatMap((name,i)=>[heading('h'+i,name),item('i'+i,(i+1)*100)])],charges:[{key:'management',name:'일반관리비',base:'direct',rate:10},{key:'profit',name:'이윤',base:'profitBase',rate:10},{key:'vat',name:'부가가치세',base:'contractBeforeVat',rate:10}]});
test('L1 별도공종은 하위 금액을 이름별 집계하고 제경비와 부가세를 구분한다',()=>{
 const p=synchronizeLinkedCosts(project()),t=totals(p.lines,p.charges);
 assert.equal(t.direct,1000);assert.equal(t.waste,300);assert.equal(t.government,300);assert.equal(t.fees,900);
 assert.deepEqual(t.charges.map(c=>c.amount),[100,110,151]);assert.equal(t.contract,1661);assert.equal(t.grand,2861);
 assert.equal(hierarchyTotals(p.lines).get('root').total,1000);
 const rows=costSheet(p).rows;for(const [name,n]of [['폐기물처리비',100],['현장점검비',200],['관급자재대',300],['수수료',400],['원인자부담금',500]])assert.equal(rows.find(r=>r.name===name).amount,n);
 const changed=structuredClone(p);changed.lines.find(l=>l.id==='i1').qty=3;
 assert.equal(totals(changed.lines,changed.charges).waste,700);assert.equal(totals(changed.lines,changed.charges).charges[0].amount,100);
 assert.equal(totals(validateProject(p).lines,p.charges).grand,t.grand);
});
test('직접공종으로 이름 변경·별도공종 삭제 시 이전 계상구분으로 복원하며 수동 구분을 보존한다',()=>{
 const lines=resolveCostScopes([heading('h','현장점검비'),item('x',100),heading('next','배관공'),item('y',50)]);
 assert.equal(lines[1].bucket,'waste');assert.equal(lines[3].bucket,'direct');
 lines[0].name='배관공';assert.equal(resolveCostScopes(lines)[1].bucket,'direct');
 assert.equal(resolveCostScopes(lines.slice(1))[0].bucket,'direct');
 lines[0].costScope='waste';assert.equal(resolveCostScopes(lines)[1].bucket,'waste');
 lines[0].name='폐기물처리비';lines[0].costScope='direct';assert.equal(resolveCostScopes(lines)[1].bucket,'direct');
});
test('원가계산서에 같은 이름 행을 추가하면 기존 별도공종으로 연결해 이중 가산하지 않는다',()=>{
 const original=project(),{project:p,key}=insertCostCharge(original);p.charges.find(c=>c.key===key).name='현장 점검비';
 const result=connectNamedCostGroup(p,key);assert.equal(result.connected,true);assert.equal(result.project.charges.length,original.charges.length);
 assert.equal(totals(result.project.lines,result.project.charges).grand,totals(original.lines,original.charges).grand);
 assert.equal(connectNamedCostGroup(original,'profit').connected,false);
});
test('내역서 출력은 순공사비 아래 별도공종과 그 하위 내역을 표시한다',()=>{
 const bundle=makePrintDocuments(project()),rows=bundle.documents.find(d=>d.key==='estimate').rows;
 const index=value=>rows.findIndex(r=>r.cells.some(c=>c.value===value));
 assert.ok(index('dig')<index('순 공 사 비'));
 for(const id of ['i0','i1','i2','i3','i4'])assert.ok(index(id)>index('순 공 사 비'),id);
 const summary=bundle.documents.find(d=>d.key==='summary').rows;
 assert.ok(summary.some(r=>r.cells.some(c=>c.value==='현장점검비')));
});
test('여러 공구의 별도 공종을 모두 맨 아래에 모으고 공구 소속과 금액을 보존한다',()=>{
 const p=project();p.lines=[...p.lines,...project().lines.map(l=>({...l,id:l.id+'2'}))];
 const before=totals(p.lines,p.charges),s=synchronizeLinkedCosts(p);
 assert.deepEqual(s.lines.slice(-20).filter(l=>l.level).map(l=>separateSectionLabel(l)),['1공구','2공구','1공구','2공구','1공구','2공구','1공구','2공구','1공구','2공구']);
 const boundary=s.lines.findIndex(l=>l.separateTail);assert.ok(s.lines.slice(boundary).every(l=>l.bucket!=='direct'));
 assert.ok(s.lines.slice(0,boundary).every(l=>l.bucket==='direct'));
 assert.equal(totals(s.lines,s.charges).grand,before.grand);
 assert.deepEqual(synchronizeLinkedCosts(s),s);
 assert.equal(new Set(s.lines.map(l=>l.id)).size,p.lines.length);
 const h=hierarchyTotals(s.lines);assert.equal(h.get('root').total,1000);assert.equal(h.get('root2').total,1000);
 s.lines.find(l=>l.id==='root2').collapsed=true;assert.equal(hierarchyView(s.lines).get('h0').hidden,false);
 const estimate=makePrintDocuments(s).documents.find(d=>d.key==='estimate');
 const items=estimate.rows.filter(r=>r.cells.some(c=>['i0','i02'].includes(c.value)));
 assert.deepEqual(items.map(r=>r.cells[0].value),['1공구','2공구']);
 assert.ok(!estimate.rows.some(r=>r.costId));
});
test('EST에서 이미 말미에 모인 비용의 원본 공구 표시는 마지막 공구로 바뀌지 않는다',()=>{
 const p=project();p.lines.find(l=>l.id==='h0').separateTail=true;
 const x=p.lines.find(l=>l.id==='i0');x.sectionLabel='3공구';
 const s=synchronizeLinkedCosts(p);assert.equal(separateSectionLabel(s.lines.find(l=>l.id==='i0')),'3공구');
 assert.equal(separateSectionLabel(s.lines.find(l=>l.id==='h0')),'');
});
