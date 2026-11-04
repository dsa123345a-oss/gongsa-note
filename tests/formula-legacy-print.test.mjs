import test from 'node:test';
import assert from 'node:assert/strict';
import {printPack} from '../dist/print-pack.js';

function sample(){
 const component={name:'보통인부',code:'L1',category:'노임',originalRecord:5,sourceComponent:'labor',qtyExpression:'1/Q1',labor:140,material:0,expense:0,other:0};
 const rate={name:'터파기',spec:'백호',code:'D1',category:'단가산출',source:'추가',unit:'㎥',labor:70,material:0,expense:0,other:0,total:70,components:[component],calculation:{variables:'Q1 = 2',componentDigits:1}};
 const raw=[{TitleCode:'D1',TC:50,NC:50},{_record:1,LineData:'1. 기 계',Level:1},{_record:2,LineData:'       60×q×E'},{_record:3,LineData:' Q = ────── = \x122\x12 ㎥/hr'},{_record:4,LineData:'          Cm'},{_record:5,Code:'L1',SCheck:-1,LineData:' 보통인부 : \x03100\x03 ÷ \x112\x11 = \x1250\x12',TC:50,NC:50},{_record:6,LineData:'2. 합 계',Level:1},{_record:7,LineData:' \x1a노무비 : 50\x1a',SCheck:-1,Level:-1},{_record:8,LineData:' \x1a계 :\x1a \x1250\x12',SCheck:-5,Level:-1,TC:50,NC:50,PageSkip:1}];
 return {schema:1,title:'시험공사',location:'후포면',lines:[{id:'line',name:rate.name,spec:rate.spec,unit:rate.unit,qty:1,group:'토공',bucket:'direct',status:'confirmed',rate}],charges:[],evidence:[{rate,rows:raw}]};
}

test('기타 문서 단가산출도 원문 작업조건과 현재 가격을 표시하고 분수는 한 행으로 유지한다',()=>{
 const project=sample(),before=structuredClone(project),html=printPack(project,[],{sections:['evidence']}).html;
 assert.match(html,/legacy-est-formula/);assert.match(html,/140 ÷ 2 = 70/);assert.match(html,/노무비\s*:\s*70/);
 assert.doesNotMatch(html,/100 ÷ 2 = 50|품명 \/ 산식/);assert.match(html,/1\. 기 계/);assert.match(html,/산출 단가 \/ 기준 수량 1/);
 const fractions=html.match(/<tr[^>]*><td class="formula-source">[^<]*60×q×E[^<]*Q = ────── = 2 ㎥\/hr[^<]*Cm<\/td>/g);
 assert.equal(fractions?.length,1);assert.match(html,/<tr class="print-break/);assert.deepEqual(project,before);
});

test('현재 사용하지 않는 옛 단산 근거는 출력하지 않고 DB 원문으로 현재 사용 단가를 보충한다',()=>{
 const project=sample(),current=project.lines[0].rate,raw=project.evidence[0].rows;
 project.evidence=[{rate:{...current,name:'폐기한 과거 단산',code:'D-old'},rows:raw},{rate:{name:'일반 일위',spec:'',code:'U1',source:'추가',category:'일위대가'},rows:[{Name:'기존 일위 구성',GN:2,TU:10,TC:20}]}];
 const lib={id:'db',name:'추가',items:[current],details:[['CostMainDat:D1',raw]]};
 const html=printPack(project,[lib],{sections:['evidence']}).html;
 assert.doesNotMatch(html,/폐기한 과거 단산/);assert.match(html,/140 ÷ 2 = 70/);assert.match(html,/기존 일위 구성/);assert.match(html,/품명 \/ 산식/);
});

test('갱신된 단산의 원문 HTML을 실행하지 않으며 공사설명서·공정 출력은 유지한다',()=>{
 const project=sample();project.documents={description:'공사설명 <확인>'};project.evidence[0].rows.unshift({_record:0,LineData:'<img src=x onerror=alert(1)>'});
 const html=printPack(project,[],{sections:['description','evidence','schedule']}).html;
 assert.doesNotMatch(html,/<img /);assert.match(html,/&lt;img/);assert.match(html,/공사설명 &lt;확인&gt;/);assert.match(html,/data-section="schedule"/);
 assert.ok(html.indexOf('data-section="description"')<html.indexOf('data-section="evidence"'));
});
