import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {collectPriceEvidence} from '../dist/price-evidence.js';
import {rateIdentity,resolveRateLibrary} from '../dist/project-data.js';
import {calculateAssemblyDetailed} from '../dist/estimate-core.js';

// Exercise the real popup handler without starting storage, workers or the app.
const source=readFileSync(new URL('../dist/app.js',import.meta.url),'utf8');
const handler=source.slice(source.indexOf('function showDetail(item,lineId=null){'),source.indexOf('\nasync function download('));
const rate=(extra={})=>({id:'d',name:'터파기',spec:'백호 90%',unit:'㎥',code:'D1',category:'단가산출',table:'CostTitleDat',library:'added',source:'추가',labor:500,material:0,expense:0,other:0,total:500,...extra});
const component={name:'보통인부',category:'노임',code:'L1',unit:'인',qty:2,labor:250,material:0,expense:0,other:0,total:250};
const raw=[{TitleCode:'D1'},{_record:1,LineData:'1. 기계 (90%)'},{_record:2,LineData:'노무비 : \x03100\x03 × 2 = \x12200\x12'}];
function popup(project={lines:[],evidence:[]},libraries=[]){
 const elements=new Map(),captured=[],edited=[],converted=[];
 const $=id=>{if(!elements.has(id))elements.set(id,{innerHTML:'',textContent:'',insertAdjacentHTML(position,text){this.innerHTML+=text;},showModal(){this.open=true;},close(){this.open=false;}});return elements.get(id);};
 const bindings={$,project,libraries,rateIdentity,resolveRateLibrary,calculateAssemblyDetailed,collectPriceEvidence,
  evidenceContent:node=>{captured.push(node);return '<p data-common-evidence="true">단가산출</p>';},
  esc:s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),num:n=>n==null?'—':Number(n).toLocaleString('ko-KR'),
  editableAssembly:(item,rows)=>{converted.push({item,rows});return {...item,components:[]};},
  assemblyEditor:{open:(...args)=>edited.push(args)},quoteEditor:{open:(...args)=>edited.push(args)},quoteDetails:()=>[['견적가',100]],toast:message=>{throw Error(message);}};
 return {show:Function(...Object.keys(bindings),handler+';return showDetail;')(...Object.values(bindings)),$,captured,edited,converted};
}

test('자료실 단가산출은 원문과 현재 구성·계산값을 함께 공통 EST 표시기로 전달한다',()=>{
 const item=rate({components:[component],calculation:{}}),lib={id:'added',name:'추가',items:[item],details:[['CostMainDat:D1',raw]]};
 const before=structuredClone({item,lib}),ui=popup(undefined,[lib]);ui.show(item,'line-7');
 assert.equal(ui.captured.length,1);const node=ui.captured[0];
 assert.equal(node.verified,true);assert.equal(node.calc.result.labor,500);assert.deepEqual(node.raw,raw);assert.equal(node.parts[0].labor,250);
 assert.match(ui.$('detailContent').innerHTML,/data-common-evidence/);assert.doesNotMatch(ui.$('detailContent').innerHTML,/품명 \/ 원문/);
 assert.equal(ui.$('detailDialog').open,true);ui.$('copyAssembly').onclick();
 assert.equal(ui.edited[0][0],item);assert.deepEqual(ui.edited[0][2],{lineId:'line-7',identity:rateIdentity(item)});
 assert.deepEqual({item,lib},before);
});

test('이전 일위대가 분류 D 코드는 CostMain 원문을 쓰며 저장파일 근거가 있으면 우선한다',()=>{
 const item=rate({category:'일위대가'}),savedRaw=[...raw,{_record:3,LineData:'저장된 작업조건 q = 0.2'}];
 const lib={id:'added',name:'추가',items:[item],details:[['CostMainDat:D1',raw],['HeadMainDat:D1',[{LineData:'잘못된 표'}]]]};
 const project={lines:[],evidence:[{rate:item,rows:savedRaw}]},before=structuredClone(project),ui=popup(project,[lib]);ui.show(item);
 assert.deepEqual(ui.captured[0].raw,savedRaw);assert.ok(ui.captured[0].issues.length);assert.deepEqual(project,before);
 ui.$('copyAssembly').onclick();assert.deepEqual(ui.converted[0].rows,savedRaw);
});

test('아직 적용하지 못한 단가도 상세를 보되 적용대기 상태와 저장단가를 바꾸지 않는다',()=>{
 const item=rate({components:[component],resourcePricing:{ready:false,master:'10월',warnings:[{resource:{name:'특수 자재'},reason:'일치 항목 없음'}]}});
 const project={lines:[],evidence:[{rate:item,rows:raw}]},before=structuredClone({item,project}),ui=popup(project);ui.show(item);
 const node=ui.captured[0];assert.equal(node.rate.resourcePricing.ready,false);assert.equal(node.rate.labor,500);assert.equal(node.verified,true);
 assert.ok(node.issues.some(x=>x.includes('적용 대기')));assert.ok(node.issues.some(x=>x.includes('특수 자재')));assert.deepEqual({item,project},before);
});

test('일반 일위·자재 상세와 조사단가·편집 버튼은 기존 흐름을 유지한다',()=>{
 const item=rate({code:'U1',category:'일위대가',table:'HeadTitleDat',components:[component]}),ui=popup();ui.show(item);
 assert.equal(ui.captured.length,0);assert.match(ui.$('detailContent').innerHTML,/보통인부/);assert.match(ui.$('detailContent').innerHTML,/500/);ui.$('copyAssembly').onclick();assert.equal(ui.edited[0][0],item);
 const material=rate({code:'M1',category:'자재',table:'StuffcDat',quoteMethod:'manual'});ui.show(material,'material-line');
 assert.match(ui.$('detailContent').innerHTML,/조사단가 적용 근거/);ui.$('compareQuotes').onclick();assert.equal(ui.edited[1][0],material);assert.equal(ui.edited[1][2].lineId,'material-line');
});
