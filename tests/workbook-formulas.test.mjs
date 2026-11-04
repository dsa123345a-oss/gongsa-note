import test from 'node:test';
import assert from 'node:assert/strict';
import {recalculateMissingWorkbook,shiftSharedFormula} from '../dist/workbook-formulas.js';
import {extractQuantities} from '../dist/workbook.js';
import {planAutoLinks,applyAutoLinks} from '../dist/auto-link.js';
import {compatibleWork} from '../dist/match-similarity.js';
function sheet(name,entries){const rows=new Map();for(const [ref,v] of Object.entries(entries)){const index=Number(ref.match(/\d+/)[0]);if(!rows.has(index))rows.set(index,{index,cells:{}});rows.get(index).cells[ref.replace(/\d/g,'')]={ref,...(typeof v==='string'&&v.startsWith('=')?{value:'',formula:v.slice(1),cached:false}:{value:v,formula:'',cached:true})};}return {name,rows:[...rows.values()].sort((a,b)=>a.index-b.index)};}
const cell=(s,ref)=>s.rows.find(r=>r.index===Number(ref.match(/\d+/)[0])).cells[ref.replace(/\d/g,'')];
test('생성기의 ISNUMBER 치수 기본값 수식과 오류·문자·논리값 판정을 Excel처럼 처리한다',()=>{
 const s=sheet('수량',{A1:0.7,A2:'0.7',A3:true,A4:'',B1:'=IF(ISNUMBER(A1),A1,0.5)*10',B2:'=IF(ISNUMBER(A2),A2,0.5)*10',B3:'=ISNUMBER(A3)',B4:'=ISNUMBER(A4)',B5:'=ISNUMBER(1/0)',B6:'=ISNUMBER(0)'});
 recalculateMissingWorkbook([s]);assert.deepEqual(['B1','B2','B3','B4','B5','B6'].map(ref=>cell(s,ref).value),[7,5,false,false,false,true]);
});
test('계산값 없는 토공·레미콘 참조 수식과 파일명으로 생성하는 폐기물 규격을 복구한다',()=>{
 const s=sheet('수량',{A2:'공사명',E2:'=MID(LEFT(CELL("filename",A1),FIND("]",CELL("filename",A1))-1),FIND(")",CELL("filename",A1))+1,255)',A7:'구분',D7:'공종',H7:'규격',P7:'산출근거',AD7:'수량',AG7:'단위',H4:2,N4:3,T4:1,Z4:0.2,AF4:0.5,A9:'1.토공',D9:'터파기',P9:'=N4',S9:'=AF4',V9:2,X9:'=T4',AA9:'=H4',AD9:'=ROUNDDOWN((P9+S9)/V9*X9*AA9,1)',AG9:'㎥',D22:'콘크리트포장',AD22:'=IF(AND(H4>0,Z4>0.05),H4*N4*Z4,0)',AG22:'㎥',D32:'레미콘',AD32:'=MAX(1, AD22)',AG32:'㎥',A37:'6.폐기물처리비',D37:'폐기물처리',H37:'="콘크리트(" & LEFT($E$2,3) & " ↔ 울진)"',AD37:'=AD22*0.7*2300/1000',AG37:'톤'});
 recalculateMissingWorkbook([s],{fileName:'수량산출서(1공구)후포면 예시 공사.xlsx'});
 const q=extractQuantities(s);assert.deepEqual(q.rows.map(l=>l.qty),[3.5,1.2,1.2,1.932]);assert.equal(q.rows.at(-1).spec,'콘크리트(후포면 ↔ 울진)');assert.equal(q.rows[0].cached,false);assert.equal(q.rows[0].quantityCalculated,true);assert.equal(q.rows[0].note,'');
});
test('기존 저장값은 보존하고 미계산·순환·외부참조·미지원 함수는 0으로 확정하지 않는다',()=>{
 const s=sheet('수량',{A1:'=NOTSUPPORTED(1)',A2:'=A3+1',A3:'=A2+1',A4:'=[external.xlsx]Sheet1!A1',A5:'=1/0',A6:'=IF(FALSE,1/0,7)',A7:'=IFERROR(1/0,9)',A8:'=1+2',A9:'=A1+1'});
 Object.assign(cell(s,'A8'),{value:123,cached:true});recalculateMissingWorkbook([s]);
 assert.equal(cell(s,'A8').value,123);assert.equal(cell(s,'A6').value,7);assert.equal(cell(s,'A7').value,9);
 for(const ref of ['A1','A2','A3','A4','A5','A9']){assert.equal(cell(s,ref).value,'');assert.ok(cell(s,ref).calculationError);}
});
test('다른 시트·절대참조·범위와 Excel 반올림 및 절사를 계산한다',()=>{
 const a=sheet('기초 값',{A1:0.1,A2:0.2,A3:0.4});const b=sheet('수량',{A1:"=SUM('기초 값'!$A$1:$A$3)",A2:'=ROUNDDOWN(A1,1)',A3:'=ROUND(-1.25,1)',A4:'=ROUND(1.005,2)',A5:'=MAX(1,0.2)',A6:'=ROUNDUP(-1.21,1)',A7:'=IF(A1>=0.7,"후포"&"면", "북면")'});
 recalculateMissingWorkbook([a,b]);assert.deepEqual(b.rows.map(r=>r.cells.A.value),[0.7,0.7,-1.3,1.01,1,-1.3,'후포면']);
 assert.equal(shiftSharedFormula('SUM(A1,$B1,C$1,$D$1)+IF(A1="A1",\'현장1\'!A1,0)','E1','E2'),'SUM(A2,$B2,C$1,$D$1)+IF(A2="A1",\'현장1\'!A2,0)');
});
const rate=(spec,code)=>({name:'폐기물처리',spec,unit:'톤',code,source:'추가 DB',category:'일위대가',labor:0,material:0,expense:42000,other:0,total:42000});
test('폐기물 재질과 공백·화살표·읍면 표기를 비교하고 과거 학습도 다른 지역으로 연결하지 못한다',()=>{
 const wrong=rate('아스콘(북면⇔울진)','bad'),concreteNorth=rate('콘크리트(북면⇔울진)','north'),right=rate('콘크리트(후포⇔울진)','right');
 const line={id:'l',name:'폐기물처리',spec:'콘크리트(후포면 ↔ 울진)',unit:'톤',qty:1.932,status:'unmatched',bucket:'waste'};
 assert.equal(compatibleWork(line,right),true);assert.equal(compatibleWork(line,concreteNorth),false);assert.equal(compatibleWork(line,wrong),false);
 const profile={rules:[{kind:'emergency',source:{...line,group:''},target:wrong,support:10,total:10,projectCount:10,userConfirmed:true}]};
 const p={title:'긴급보수',lines:[line]},libs=[{id:'db',name:'추가 DB',items:[wrong,concreteNorth,right]}];
 const plans=planAutoLinks(p,libs,'','db',profile);assert.equal(plans[0].rate.code,'right');assert.equal(applyAutoLinks(p,[{line,rate:concreteNorth}],'old').lines[0].rate,undefined);
 assert.equal(planAutoLinks({...p,lines:[{...line,spec:''}]},libs)[0].rate,undefined);
});
test('규격이 같은 여러 공구도 각 파일의 지역을 따로 비교한다',()=>{
 const make=(id,place)=>({id,name:'폐기물처리',spec:'콘크리트',unit:'톤',qty:1,status:'unmatched',sourceFile:`수량산출서(${id}공구)${place} 예시.xlsx`});
 const p={lines:[make('1','후포면'),make('2','북면')]},libs=[{id:'db',name:'DB',items:[rate('콘크리트(북면⇔울진)','north'),rate('콘크리트(후포⇔울진)','south')]}];
 assert.deepEqual(planAutoLinks(p,libs).map(x=>x.rate.code),['south','north']);
});
