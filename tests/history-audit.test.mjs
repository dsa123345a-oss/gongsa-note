import test from 'node:test';import assert from 'node:assert/strict';
import {extractQuantities} from '../dist/workbook.js';
import {planAutoLinks} from '../dist/auto-link.js';
import {compatibleWork} from '../dist/match-similarity.js';
import {projectFromEst} from '../dist/est-project.js';
import {totals} from '../dist/calc.js';
import {validateProject} from '../dist/project-data.js';
function sheet(entries){const rows=new Map();for(const [ref,value]of Object.entries(entries)){const index=+ref.match(/\d+/)[0];if(!rows.has(index))rows.set(index,{index,cells:{}});rows.get(index).cells[ref.replace(/\d/g,'')]={ref,value,formula:'',cached:true};}return {name:'수량',rows:[...rows.values()].sort((a,b)=>a.index-b.index)};}
const rate=(name,spec,code='M1')=>({name,spec,code,unit:'개',category:'자재',labor:0,material:100,expense:0,other:0,total:100});
const line=(name,spec)=>({id:'x',name,spec,unit:'틀린단위',group:'자재',qty:1,bucket:'direct',status:'unmatched'});
const lib=rows=>({id:'test',name:'test.estx',items:[],tables:[{name:'EstMainDat.dat',rows:rows.map((r,i)=>({...r,_record:i}))}]});
const head=(Name,Level=1)=>({Name,Level});
const row=(Name,qty=1)=>({Name,Code:'M1',GN:qty,Unite:'개',TU:100,GU:100,TC:qty*100,GC:qty*100});
test('older left/right blocks without unit headings retain both quantities and owning groups',()=>{
 const s=sheet({A1:'수량산출서',V4:'구분',W4:'품목',X4:'규격',Y4:'산출근거',AH4:'수량',V5:'4.사급자재대',W5:'PE소켓',X5:'D16',AH5:2,AI5:'개',A7:'구분',B7:'공종',C7:'규격',F7:'산출근거',S7:'수량',A9:'1.토공',B9:'터파기',C9:'기계80%+인력20%',S9:4.5,U9:'㎥',F10:'콘크리트',W10:'레미콘',X10:'25-21-08',AH10:1,AI10:'㎥'});
 const q=extractQuantities(s).rows;assert.deepEqual(q.map(r=>[r.name,r.qty,r.group]),[['터파기',4.5,'1.토공'],['PE소켓',2,'4.사급자재대'],['레미콘',1,'4.사급자재대']]);
});
test('headerless compact quantity form is recognized only with its title, group, numeric quantity and unit',()=>{
 const values={A1:'수량산출서(1공구)',A7:'1.배관공',B7:'계량기철거및설치',F7:'D16',S7:2,U7:'개소'};
 assert.equal(extractQuantities(sheet(values)).rows[0].qty,2);assert.equal(extractQuantities(sheet({...values,A1:'관련 없는 표'})).rows.length,0);
});
test('historical similar names never cross flange purpose, reducer/elbow, compactor or safety-facility type',()=>{
 for(const [a,as,b,bs]of [['합플랜지','D80X40','플랜지관','D80'],['마개플랜지','D80','플랜지관','D80'],['KP소켓편락관(B)','D100X80','11˚KP소켓곡관(B)','D80'],['되메우기및다짐(콤팩터)','백호0.2','되메우기및다짐','백호0.2'],['교통안전시설 설치및철거','PE안전휀스','교통안전시설 설치및철거','칼라콘'],['교통안전시설 설치및철거','PE안전휀스','교통안전시설 설치및철거','윙카등'],['보조기층 포설및다짐','','아스팔트 기층 포설및다짐','']])assert.equal(compatibleWork(line(a,as),rate(b,bs)),false,a+' → '+b);
});
test('an exact requested pipe size in main takes precedence over a different size in preferred DB; nearest size remains fallback',()=>{
 const p={lines:[line('이탈방지압륜(KP부속)','D250')]},libs=[{id:'added',name:'추가',items:[rate('이탈방지압륜(KP부속)','D100','M100')]},{id:'main',name:'메인',items:[rate('이탈방지압륜(KP부속)','D250mm','M250')]}];
 assert.equal(planAutoLinks(p,libs,'','added',{rules:[]})[0].rate.code,'M250');assert.equal(planAutoLinks(p,libs.slice(0,1),'','added',{rules:[]})[0].rate.code,'M100');
});
test('user-confirmed abbreviated backfill always includes compaction even against an exact backfill-only name',()=>{
 const p={lines:[{...line('되메우기','인력100%'),group:'토공'}]},make=(name,code)=>({...rate(name,'인력100%',code),category:'일위대가',unit:'㎥',labor:100,material:0});
 const libs=[{id:'added',name:'추가',items:[make('되메우기','U1'),make('되메우기및다짐','U2')]}];
 assert.equal(planAutoLinks(p,libs,'','added',{rules:[]})[0].rate.code,'U2');
 assert.equal(planAutoLinks(p,[{...libs[0],items:[make('되메우기','U1')]}],'','added',{rules:[]})[0].rate,undefined);
});
test('negative scrap unit price imports as an explicit deduction with the same monetary components',()=>{
 const p=projectFromEst(lib([head('공사',2),{...row('고재정리',25),TU:-260,GU:-260,TC:-6500,GC:-6500}]));
 assert.equal(p.lines[1].qty,-25);assert.equal(p.lines[1].rate.material,260);assert.equal(totals(p.lines,[]).direct,-6500);assert.ok(p.lines[1].deduction);
});
test('negative historical profit is a visibly flagged fixed source amount, not a validated normal percentage',()=>{
 const p=projectFromEst(lib([head('공사',2),row('자재',10)]),[{index:1,rows:[{Name:'직접노무비',Cost:0},{Name:'간접재료비',Cost:1000},{Name:'이윤',Gubun:'F',Cost:-100,Youl:'-10%',VSusic:'D*-0.1'}]}]);
 assert.equal(p.charges[0].base,'fixed');assert.equal(p.charges[0].fixed,-100);assert.equal(totals(p.lines,p.charges).contract,900);assert.ok(p.estImport.warnings.some(w=>w.includes('음수')));
 const changed=structuredClone(p);changed.charges[0].fixed=-200;assert.throws(()=>validateProject(changed));
});
test('waste inside historical gross subtotal is included exactly once and stays linked after editing',()=>{
 const rows=[{Name:'직접노무비',Cost:0},{Name:'간접재료비',Cost:1000},{Name:'순공사원가',Gubun:'D',Cost:1000},{Name:'일반관리비',Gubun:'E',Cost:0},{Name:'이윤',Gubun:'F',Cost:0},{Name:'폐기물처리비',Gubun:'G',Cost:100},{Name:'총원가',Gubun:'H',Cost:1100,VSusic:'D+E+F+G'},{Name:'부가가치세',Gubun:'I',Cost:110,Youl:'10%',VSusic:'H*0.1'},{Name:'도급예정액',Gubun:'J',Cost:1210,VSusic:'H+I'},{Name:'총공사비',Gubun:'K',Cost:1210,VSusic:'J'}];
 const p=projectFromEst(lib([head('공사',2),row('자재',10),{Name:'순공사비',LinkIndex:54,TC:1000},head('폐기물처리비',2),row('폐기물')]),[{index:1,rows}]);
 assert.equal(p.lines[2].bucket,'waste');assert.equal(totals(p.lines,p.charges).contract,1210);p.lines[3].qty=2;assert.equal(totals(p.lines,p.charges).contract,1320);
});
