import test from 'node:test';
import assert from 'node:assert/strict';
import {createExactFormulaContext} from '../dist/formula-precision.js';
import {calculateAssemblyDetailed} from '../dist/estimate-core.js';

test('원문 유리수 수량과 단가를 곱한 뒤 절사하여 정수 경계의 1원 누락을 막는다',()=>{
 const exact=createExactFormulaContext();
 for(const [expression,price,digits,expected] of [
  ['1*2/8/5.4',216000,1,10000],['1/3',3,0,1],['1/7',7,0,1],['(10/3-3)',3,0,1],
  ['0.1+0.2',1000,0,300],['1e-3',1000,0,1],['1/3',-2,1,-0.6],['6%',1500,1,90],
  ['1-1e-15',1,0,0],['1+1e-15',1,0,1],['99999/100000',1,0,0],
 ])assert.equal(exact.truncateProduct(expression,price,digits),expected,expression);
 assert.notEqual(exact.evaluate('1/3'),1);assert.equal(exact.truncateProduct('1/3',3),1);
});

test('작업량 변수의 정의식도 표시용 소수로 바꾸지 않고 다음 변수·금액에 사용한다',()=>{
 const exact=createExactFormulaContext('Q1 = 1/3\nQ2 = Q1 * 3\nQ3 = 1/8*16/12*25/20 # 운전원 보정');
 assert.equal(exact.truncateProduct('Q2',100),100);
 assert.equal(exact.truncateProduct('Q3',240000),50000);
 assert.equal(exact.truncateProduct('1/Q1',7),21);
 const source='Q1 = 2/8/5.4';assert.equal(createExactFormulaContext(source).truncateProduct('Q1',216000,1),10000);
});

test('기존 함수·지수·퍼센트 문법을 유지하고 정확한 제곱근은 분수로 계산한다',()=>{
 const exact=createExactFormulaContext();
 for(const [expression,price,expected] of [
  ['min(1/3,0.4)',3,1],['max(1/3,0.2)',3,1],['abs(-1/3)',3,1],['sqrt(4/9)',3,2],['sqrt(.81)',10,9],
  ['2^3^2',1,512],['-2^2',1,-4],['2^-3',8,1],['(1/3)^2',9,1],['50%%',10000,50],
 ])assert.equal(exact.truncateProduct(expression,price),expected,expression);
 for(const expression of ['sqrt(2)','2^0.5']){
  assert.equal(exact.evaluate(expression),Math.sqrt(2));assert.equal(exact.truncateProduct(expression,100,6),141.421356);
 }
});

test('분수 계산도 잘못된 문법·변수·범위·0 나눗셈을 거부한다',()=>{
 const exact=createExactFormulaContext();
 for(const expression of ['1/0','1 2','1e','min()','abs(1,2)','sqrt(-1)','foo(1)','unknown','x.y','1;2','2^1000'])assert.throws(()=>exact.truncateProduct(expression,1),expression);
 for(const variables of ['Q = missing','Q = 1\nQ = 2','Q = 1/0'])assert.throws(()=>createExactFormulaContext(variables),variables);
 assert.throws(()=>exact.truncateProduct('1',1,7));assert.throws(()=>exact.truncateProduct('1e14',1000));
});

test('구성 계산에서 D43 경계와 변수·함수 수량을 정확하게 계상하고 직접 금액은 유지한다',()=>{
 const part=(name,qtyExpression,price)=>({name,qtyExpression,labor:price,material:0,expense:0,other:0});
 const rows=[part('용수운반','2/8/5.4',216000),{kind:'percent',name:'기구손료',basis:'labor',target:'material',percent:2},part('분수 변수','Q2',3),part('정확 함수','sqrt(4/9)',3),{...part('고정금액','1/3',3),calculationMode:'horizontal',manualAmounts:{labor:7,material:0,expense:0,other:0}}];
 const result=calculateAssemblyDetailed(rows,{componentDigits:1,variables:'Q1=1/3\nQ2=Q1'});
 assert.equal(result.rows[0].amount.labor,10000);assert.equal(result.rows[1].amount.material,200);
 assert.equal(result.rows[2].amount.labor,1);assert.equal(result.rows[3].amount.labor,2);
 assert.equal(result.rows[4].amount.labor,7);assert.equal(result.result.total,10210);
});
