import test from 'node:test';
import assert from 'node:assert/strict';
import {createResourcePricer} from '../dist/resource-pricing.js';
import {calculateAssemblyDetailed} from '../dist/estimate-core.js';
import {isFixedPrintedComponent} from '../dist/est-resource-policy.js';
import {propagateResource} from '../dist/work-core.js';
import {collectPriceEvidence} from '../dist/price-evidence.js';

function fixture(){
 const labor={name:'보통인부',spec:'',unit:'인',code:'L1',category:'노임',table:'LaborcDat',source:'추가',library:'extra',labor:100,material:0,expense:0,other:0,total:100};
 const text='경비: 171 × 2 = 342',fixed={name:'원문 고정 경비',spec:'',unit:'식',code:'',fixedPrice:true,originalRecord:12,formulaSource:text,qtyExpression:'2',labor:0,material:0,expense:171,other:0,total:171};
 const rate={name:'관로 작업',code:'D1',spec:'',unit:'m',category:'단가산출',table:'CostTitleDat',source:'추가',library:'extra',components:[{...labor,qtyExpression:'1',sumTag:'A'},fixed],calculation:{componentDigits:1}};Object.assign(rate,calculateAssemblyDetailed(rate.components,rate.calculation).result);
 const extra={id:'extra',name:'추가',items:[labor,rate],details:[['CostMainDat:D1',[{_record:12,LineData:text}]]]};
 const month={id:'main',name:'2026-10-main.estx',priceUpdateReference:true,items:[{...labor,source:'2026-10-main.estx',library:'main',code:'L2',labor:200,total:200}]};
 const project={schema:1,title:'고정 근거 검증',lines:[{id:'l1',name:rate.name,spec:'',unit:'m',qty:2,group:'토공',bucket:'direct',status:'confirmed',rate}],charges:[],mappings:{}};
 return {labor,rate,fixed,extra,libs:[month,extra],project};
}

test('원문과 일치하는 고정 경비는 가격을 유지하고 수량식은 계산한다',()=>{
 const {rate,libs,fixed,extra}=fixture(),before=JSON.stringify(libs),r=createResourcePricer({},libs).reprice(rate);
 assert.equal(r.ready,true);assert.equal(r.rate.total,542);assert.equal(r.rate.expense,342);assert.equal(r.rate.labor,200);
 assert.ok(r.warnings.some(w=>w.kind==='fixed-formula'&&w.retained));assert.equal(JSON.stringify(libs),before);
 assert.equal(isFixedPrintedComponent({...fixed,code:'M1'},extra.details[0][1]),false);assert.equal(isFixedPrintedComponent({...fixed,formulaSource:'다른 식'},extra.details[0][1]),false);
});

test('산출근거 노임 수정은 고정 경비를 보존하면서 내역서에 전파된다',()=>{
 const {project,libs,labor}=fixture(),replacement={...labor,labor:250,total:250,source:'나의 단가',code:'USER1',origin:{source:labor.source,code:labor.code}};
 const result=propagateResource(project,libs,replacement);
 assert.equal(result.skipped.length,0);assert.equal(result.changes.length,1);assert.equal(result.project.lines[0].rate.total,592);assert.equal(result.project.lines[0].rate.expense,342);assert.equal(result.project.lines[0].rate.components[0].sumTag,'A');
 const evidence=collectPriceEvidence(result.project,libs);assert.ok(!evidence.nodes.some(n=>n.rate.name==='원문 고정 경비'));assert.equal(project.lines[0].rate.total,442);
});

test('자재 DB의 경비 계상 단가를 편집해도 지정 비목의 가격이 사라지지 않는다',()=>{
 const {project,libs}=fixture(),material={name:'운반요금',spec:'',unit:'회',code:'M1',category:'자재',table:'StuffcDat',source:'추가',library:'extra',labor:0,material:100,expense:0,other:0,total:100};
 libs[1].items.push(material);const rate=project.lines[0].rate;rate.components=[{...material,material:0,expense:100,sourceComponent:'expense',qtyExpression:'2',basisTag:'A',sumTag:'B'}];Object.assign(rate,calculateAssemblyDetailed(rate.components,rate.calculation).result);
 const replacement={...material,source:'나의 단가',code:'USER2',material:150,total:150,origin:{source:material.source,code:material.code}},out=propagateResource(project,libs,replacement);
 assert.equal(out.skipped.length,0);assert.equal(out.project.lines[0].rate.expense,300);assert.equal(out.project.lines[0].rate.material,0);assert.equal(out.project.lines[0].rate.components[0].basisTag,'A');assert.equal(out.project.lines[0].rate.components[0].sumTag,'B');
});
