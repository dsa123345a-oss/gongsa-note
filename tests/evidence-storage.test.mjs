import test from 'node:test';
import assert from 'node:assert/strict';
import {collectEvidence} from '../dist/project-data.js';
import {collectPriceEvidence} from '../dist/price-evidence.js';

const rate=(code,name,labor=100)=>({code,name,spec:'',unit:'개',source:'추가 DB',library:'extra',category:code.startsWith('D')?'단가산출':'일위대가',table:code.startsWith('D')?'CostTitleDat':'HeadTitleDat',labor,material:0,expense:0,other:0,total:labor});
const line=r=>({id:'line',name:r.name,spec:r.spec,unit:r.unit,qty:1,status:'confirmed',rate:r});
function fixture(){
 const child=rate('D1','단가산출'),grand=rate('D2','하위 산출'),unused=rate('D3','사용 안 함');
 child.components=[{...grand,qty:1,qtyExpression:'1'}];child.calculation={};
 const top=rate('U1','상위 일위');top.components=[{...child,qty:1,qtyExpression:'1'},{...unused,qty:0,qtyExpression:'0'},{...unused,qty:1,exclude:true}];top.calculation={};
 const rows=r=>[{_record:1,TitleCode:r.code,LineData:r.name},{_record:2,LineData:'    Q = 원본 분수식'}];
 const lib={id:'extra',name:'추가 DB',items:[top,child,grand,unused],details:[['HeadMainDat:U1',rows(top)],['CostMainDat:D1',rows(child)],['CostMainDat:D2',rows(grand)],['CostMainDat:D3',rows(unused)]]};
 return {top,child,grand,unused,lib,p:{lines:[line(top)]}};
}
test('사용하는 중첩 산출 원문만 저장하고 DB 없이 다시 열어도 보존한다',()=>{
 const {p,lib}=fixture();p.evidence=collectEvidence(p,[lib]);
 assert.deepEqual(p.evidence.map(e=>e.rate.code),['U1','D1','D2']);
 const reopened=JSON.parse(JSON.stringify(p));
 assert.deepEqual(collectPriceEvidence(reopened,[]).nodes.filter(n=>n.kind==='단가산출').map(n=>n.raw[1].LineData),['    Q = 원본 분수식','    Q = 원본 분수식']);
 assert.deepEqual(collectEvidence(reopened,[]),reopened.evidence);
});
test('반복 사용한 중첩 단가는 한 번만 저장하며 같은 코드 다른 단가는 분리한다',()=>{
 const {p,lib,child}=fixture();p.lines[0].rate.components.push({...child,qty:2});p.lines.push({...line({...child,labor:120,total:120}),id:'other'});
 const saved=collectEvidence(p,[lib]);assert.equal(saved.filter(e=>e.rate.code==='D1').length,2);assert.equal(saved.filter(e=>e.rate.code==='D2').length,1);
});
test('동일 코드의 다른 DB로 원본을 바꾸지 않고 저장된 근거를 우선한다',()=>{
 const {p,lib}=fixture();p.evidence=collectEvidence(p,[lib]);
 const other={...lib,id:'other',name:'다른 DB',details:lib.details.map(([k])=>[k,[{LineData:'다른 원문'}]])};
 const saved=collectEvidence(p,[other]);assert.equal(saved.find(e=>e.rate.code==='D1').rows[1].LineData,'    Q = 원본 분수식');
});
test('원문 일위에서 복원된 실제 구성의 산출 근거도 저장한다',()=>{
 const nested=rate('D1','하위 산출'),top=rate('U1','원본 일위');
 const lib={id:'extra',name:'추가 DB',items:[top,nested],details:[['HeadMainDat:U1',[{_record:1,TitleCode:'U1',Name:'원본 일위'},{_record:2,Code:'D1',Name:nested.name,Size:'',Unite:'개',GN:1,NU:100,GU:0,JU:0,TC:100,NC:100,GC:0,JC:0}]],['CostMainDat:D1',[{_record:3,LineData:'하위 산출 원문'}]]]};
 const p={lines:[line(top)]};p.evidence=collectEvidence(p,[lib]);assert.equal(p.evidence.find(e=>e.rate.code==='D1').rows[0].LineData,'하위 산출 원문');
 const detached=collectPriceEvidence(JSON.parse(JSON.stringify(p)),[]);assert.equal(detached.nodes.find(n=>n.rate.code==='D1').raw[0].LineData,'하위 산출 원문');
});
test('단가 갱신 후 DB ID가 바뀌면 검증된 원본 스냅샷으로 근거를 복원한다',()=>{
 const {p,lib}=fixture(),reloaded={...structuredClone(lib),id:'reloaded'},current=p.lines[0].rate,original=structuredClone(current);
 current.library='old-id';current.labor=120;current.total=120;current.resourcePricing={original};original.library='old-id';
 const saved=collectEvidence(p,[reloaded]);assert.ok(saved[0].rows.length);
 original.total=999;original.labor=999;assert.equal(collectEvidence(p,[reloaded])[0].rows.length,0);
});
test('다른 적용금액의 저장된 단가산출은 코드가 같아도 대신 연결하지 않는다',()=>{
 const child={name:'하위 산출',spec:'',unit:'개',code:'D1',source:'추가 DB',library:'extra',qty:1,labor:100,material:0,expense:0,other:0,total:100};
 const top={...rate('U1','상위'),components:[child]};
 const p={lines:[line(top)],evidence:[{rate:{...child,category:'단가산출',table:'CostTitleDat',labor:200,total:200},rows:[{LineData:'다른 단가 원문'}]}]};
 assert.equal(collectPriceEvidence(p,[]).nodes.some(n=>n.rate.code==='D1'),false);
});
test('원문 순환 참조는 중복 탐색하지 않고 종료한다',()=>{
 const a=rate('U1','a'),b=rate('U2','b');
 const rows=(title,child)=>[{_record:1,TitleCode:title.code,Name:title.name},{_record:2,Code:child.code,Name:child.name,Size:'',Unite:'개',GN:1,NU:100,GU:0,JU:0,TC:100,NC:100,GC:0,JC:0}];
 const lib={id:'extra',name:'추가 DB',items:[a,b],details:[['HeadMainDat:U1',rows(a,b)],['HeadMainDat:U2',rows(b,a)]]};
 const saved=collectEvidence({lines:[line(a)]},[lib]);assert.ok(saved.length<=3);assert.ok(saved.every(e=>e.rows.length===2));
});
