import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {inflateRawSync} from 'node:zlib';
import {estFormulaDisplay} from '../dist/est-formula-display.js';
import {calculateAssemblyDetailed} from '../dist/estimate-core.js';
import {editableAssembly} from '../dist/est-edit.js';
import {importEst} from '../dist/est.js';

const money=(labor,material=0,expense=0)=>({labor,material,expense,other:0,total:labor+material+expense});
const part=(record,price=100)=>({name:'보통인부',originalRecord:record,code:'L1',sourceComponent:'labor',qtyExpression:'1/Q1',labor:price,material:0,expense:0,other:0});
function node(parts=[part(5)],variables='Q1 = 2'){
 const calc=calculateAssemblyDetailed(parts,{variables,componentDigits:1});
 return {rate:{name:'터파기',...calc.result},calc,parts,verified:true,raw:[
  {TitleCode:'D1',...{TC:50,NC:50}},
  {_record:1,LineData:' 1. 기 계',Level:1},
  {_record:2,LineData:'       60×q×E'},
  {_record:3,LineData:' Q = ────── = \x122\x12 ㎥/hr'},
  {_record:4,LineData:'          Cm'},
  {_record:5,Code:'L1',SCheck:-1,LineData:' 보통인부 : \x03100\x03 ÷ \x112\x11 = \x1250\x12',TC:50,NC:50},
  {_record:6,LineData:' 2. 합 계',Level:1},
  {_record:7,LineData:' \x1a노무비 : 50\x1a',SCheck:-1,Level:-1},
  {_record:8,LineData:' \x1a계 :\x1a \x1250\x12',SCheck:-5,Level:-1,TC:50,NC:50,PageSkip:1},
 ]};
}

test('원문 설명, 분수 세 행, 공백 및 페이지 구분을 보존하고 입력을 변경하지 않는다',()=>{
 const n=node(),before=structuredClone(n),d=estFormulaDisplay(n);
 assert.deepEqual(n,before);assert.equal(d.source,'est');assert.deepEqual(d.warnings,[]);
 assert.equal(d.rows[1].text,'       60×q×E');assert.equal(d.rows[2].text,' Q = ────── = 2 ㎥/hr');
 assert.equal(d.rows[1].blockId,d.rows[3].blockId);assert.ok(d.rows[1].blockId);
 assert.ok(d.rows.find(r=>r.originalRecord===8).breakBefore);assert.equal(d.rows.at(-1).amount.total,50);
 assert.ok(d.rows.every(r=>!/[\x00-\x08\x0b-\x1f]/.test(r.text)));
});

test('최신 가격, 구성 결과, 소계와 최종 금액을 같은 원문 위치에 표시한다',()=>{
 const n=node([part(5,140)]),d=estFormulaDisplay(n),text=d.rows.map(r=>r.text).join('\n');
 assert.match(text,/140 ÷ 2 = 70/);assert.match(text,/노무비\s*:\s*70/);assert.match(text,/계\s*:\s*70/);
 assert.doesNotMatch(text,/\b100\b|\b50\b/);assert.equal(d.rows.at(-1).amount.total,70);assert.deepEqual(d.warnings,[]);
});

test('수량식 수정은 과거 Q 계산을 현재 산식인 것처럼 표시하지 않는다',()=>{
 const d=estFormulaDisplay(node([part(5,140)],'Q1 = 4')),text=d.rows.map(r=>r.text).join('\n');
 assert.match(text,/작업조건·작업량 설명은 원문 기준/);assert.match(text,/140 × \(1 ÷ \(4\)\) = 35/);
 assert.doesNotMatch(text,/140 ÷ 2 = 35/);assert.equal(d.rows.at(-1).amount.total,35);
 assert.equal(d.rows[2].blockId,d.rows[4].blockId);
});

test('삭제한 원문 비용은 현재 구성에서 제외하고 새 비용만 계상한다',()=>{
 const newPart={...part(undefined,80),qtyExpression:'1'},d=estFormulaDisplay(node([newPart])),text=d.rows.map(r=>r.text).join('\n');
 assert.match(text,/삭제된 구성/);assert.match(text,/현재 추가 구성/);assert.doesNotMatch(text,/100 ÷ 2 = 50/);
 assert.equal(d.rows.at(-1).amount.total,80);assert.ok(d.warnings.length);
});

test('미지원 원문에는 임의 숫자 치환을 하지 않고 내부 색인 태그를 숨긴다',()=>{
 const n=node();n.verified=false;n.raw[5].LineData=' 보통인부 : \x03100\x03 ÷ 2 = \x06A\x06\x1250\x12';
 n.raw.splice(6,0,{_record:50,LineData:'\x07A\x07\x1a50\x1a × 5% = \x122.5\x12'});
 const d=estFormulaDisplay(n),text=d.rows.map(r=>r.text).join('\n');assert.match(text,/100 ÷ 2 = 50/);assert.doesNotMatch(text,/A50/);assert.match(text,/50 × 5% = 2.5/);
});

test('가격을 0으로 고쳐도 과거 단가를 대체하며 비목만 적용 시 명시한다',()=>{
 const n=node([part(5,0)]);n.rate.sourceComponent='labor';const d=estFormulaDisplay(n),text=d.rows.map(r=>r.text).join('\n');
 assert.match(text,/0 ÷ 2 = 0/);assert.doesNotMatch(text,/100/);assert.match(d.rows.at(-1).text,/노무비만 적용/);assert.equal(d.rows.at(-1).amount.total,0);
});

test('직접 입력 및 여러 비목 출력에서 같은 행 금액을 반복 계상하지 않는다',()=>{
 const p={...part(5),calculationMode:'horizontal',manualAmounts:{labor:10,material:20,expense:0,other:0}};
 const d=estFormulaDisplay(node([p]));const details=d.rows.filter(r=>r.originalRecord===5);
 assert.equal(details.length,2);assert.equal(details.filter(r=>r.amount).length,1);assert.equal(details.at(-1).amount.total,30);
});

test('세로 집계 제외한 구성은 계산근거에서 집계 제외임을 명시한다',()=>{
 const n=node([{...part(5),exclude:true}]),d=estFormulaDisplay(n);assert.match(d.rows.find(r=>r.originalRecord===5).text,/세로 집계 제외/);assert.equal(d.rows.at(-1).amount.total,0);
});

test('근거 낙찰된 구성은 적용 가격과 비율을 표시하고 원가격을 다시 할인하지 않는다',()=>{
 const n=node([part(5,95)]);n.rate.evidenceBid={percent:95,original:{...n.rate,...money(50)}};
 const before=structuredClone(n),d=estFormulaDisplay(n),text=d.rows.map(r=>r.text).join('\n');
 assert.match(text,/95 ÷ 2 = 47.5/);assert.match(d.rows.at(-1).text,/근거 낙찰 95% 적용/);assert.equal(d.rows.at(-1).amount.total,47);assert.deepEqual(n,before);
});

test('여러 개의 동일한 옛 가격이 서로 다르게 갱신되면 원문 행별 대응을 사용한다',()=>{
 const n=node([part(5,140),part(9,180)]);
 n.raw.splice(6,0,{_record:9,Code:'L1',SCheck:-1,LineData:' 보통인부 : \x03100\x03 ÷ \x112\x11 = \x1250\x12',NC:50,TC:50});
 n.raw[0].NC=n.raw[0].TC=100;n.raw.at(-2).LineData=' \x1a노무비 : 50 + 50 =\x1a \x12100\x12';
 n.raw.at(-1).LineData=' \x1a계 :\x1a \x12100\x12';n.raw.at(-1).NC=n.raw.at(-1).TC=100;
 const d=estFormulaDisplay(n),text=d.rows.map(r=>r.text).join('\n');assert.match(text,/140 ÷ 2 = 70/);assert.match(text,/180 ÷ 2 = 90/);
 assert.match(text,/노무비\s*:\s*160/);assert.doesNotMatch(text,/70 \+ 70|90 \+ 90/);assert.equal(d.rows.at(-1).amount.total,160);
});

test('EST 수량 소계 표식은 같은 숫자의 노임 가격이 바뀌어도 금액으로 치환하지 않는다',()=>{
 const n=node([part(5,140)]);n.raw.splice(6,0,{_record:61,LinkIndex:61,LineData:' 소계 : \x0c50\x0c kg'});
 const d=estFormulaDisplay(n),r=d.rows.find(r=>r.originalRecord===61);
 assert.equal(r.text,' 소계 : 50 kg');assert.equal(r.amount,undefined);assert.deepEqual(d.warnings,[]);
});

test('두 기본 DB의 전체 단가산출 원문을 누락 없이 표시한다',{skip:!process.env.GONGSA_EST_DISPLAY_FIXTURES},async()=>{
 const release=JSON.parse(fs.readFileSync(new URL('../release.json',import.meta.url)));
 let count=0,converted=0;
 for(const file of release.defaultDatabases){
  const name=typeof file==='string'?file:file.name,lib=await importEst(fs.readFileSync(new URL('../seed/'+name,import.meta.url)),name,inflateRawSync),details=new Map(lib.details);
  for(const rate of lib.items.filter(r=>r.table==='CostTitleDat')){
   const raw=details.get('CostMainDat:'+rate.code)||[];assert.ok(raw.length,rate.code);
   const n={rate,raw};try{const edit=editableAssembly(rate,raw,lib.items);n.calc=calculateAssemblyDetailed(edit.components,edit.calculation);n.parts=edit.components;n.verified=true;converted++;}catch{}
   const before=JSON.stringify(n),d=estFormulaDisplay(n);assert.equal(JSON.stringify(n),before,rate.code);
   const actual=new Set(d.rows.map(r=>r.originalRecord));for(const r of raw.filter(r=>!r.TitleCode))assert.ok(actual.has(r._record),rate.code+' / '+r._record);
   assert.ok(d.rows.every(r=>!/[\x00-\x08\x0b-\x1f]/.test(r.text)),rate.code);
   assert.equal(d.rows.at(-1).amount.total,rate.total,rate.code);count++;
  }
 }
 assert.equal(count,1623);assert.ok(converted>1200);
});
