import test from 'node:test';
import assert from 'node:assert/strict';
import {compatibleWork,textSimilarity} from '../dist/match-similarity.js';
import {planAutoLinks,applyAutoLinks,incompatibleAutoLinks,resetIncompatibleAutoLinks,lineSignature} from '../dist/auto-link.js';
const rate=(name,spec='',extra={})=>({name,spec,unit:'TON당',code:'U1',source:'추가',category:'일위대가',labor:0,material:0,expense:43900,other:0,total:43900,...extra});
const water=rate('물','',{code:'M0000000003',category:'자재',unit:'ℓ',material:1.26,expense:0,total:1.26});
const line=(name='폐기물처리',spec='아스콘(검사 ↔ 울진)',unit='톤')=>({id:'w',name,spec,unit,group:'5.폐기물처리비',qty:2.303,bucket:'waste',status:'unmatched',rate:null});
const library=items=>({id:'added',name:'추가',items});

test('waste handling cannot fall back to water or another non-waste item even with learned or saved links',()=>{
 const l=line(),p={title:'긴급보수',lines:[l],mappings:{[lineSignature(l)]:water}};
 const profile={rules:[{kind:'emergency',source:l,target:water,support:10,total:10,projectCount:10}]};
 assert.equal(compatibleWork(l,water),false);assert.equal(compatibleWork(line('물',''),rate('폐기물처리','아스콘(후포⇔울진)')),false);
 const planned=planAutoLinks(p,[library([water,rate('폐기물처리','아스콘(후포⇔울진)')])],'','added',profile)[0];
 assert.equal(planned.rate,undefined);assert.equal(planned.recommended,false);
 assert.equal(applyAutoLinks(p,[{line:l,rate:water}],'stale').lines[0].rate,null);
});

test('one-character Korean substrings do not identify longer work names while identical names remain valid',()=>{
 for(const [work,short] of [['구조물보수','물'],['시설물청소','물'],['풀깎기','풀'],['잔디줄떼','줄']]){
  assert.equal(textSimilarity(work,short),0);assert.equal(textSimilarity(short,work),0);
  const p={lines:[line(work,'')]},planned=planAutoLinks(p,[library([rate(short,'',{category:'자재'})])],'','added',{rules:[]})[0];
  assert.equal(planned.rate,undefined);assert.equal(planned.recommended,false);
 }
 assert.equal(textSimilarity('물','물'),1);
 const planned=planAutoLinks({lines:[line('물','','m')]},[library([water])],'','added',{rules:[]})[0];
 assert.deepEqual(planned.rate.resourcePricing.original,water);assert.equal(planned.rate.resourcePricing.mode,'direct-material');assert.equal(planned.rate.resourcePricing.ready,true);assert.equal(planned.rate.total,water.total);assert.equal(planned.recommended,true);
});

test('waste material and route safety is independent of DB category and quantity-sheet unit',()=>{
 for(const category of ['일위대가','내역단가','자재'])for(const material of ['아스콘','콘크리트']){
  const good=rate('폐기물처리',material+'(후포⇔울진)',{category}),wrongMaterial=rate('폐기물처리',(material==='아스콘'?'콘크리트':'아스콘')+'(후포⇔울진)',{category}),wrongRoute=rate('폐기물처리',material+'(온정⇔울진)',{category});
  const l=line('폐기물처리',material+'(후포면 ↔ 울진)','개'),p={lines:[l]};
  assert.equal(compatibleWork(l,wrongMaterial),false);assert.equal(compatibleWork(l,wrongRoute),false);
  const planned=planAutoLinks(p,[library([water,wrongMaterial,wrongRoute,good])],'','added',{rules:[]})[0];
  assert.deepEqual(planned.rate.resourcePricing.original,good);assert.equal(planned.rate.resourcePricing.ready,category==='자재');assert.equal(planned.recommended,true);
  const linked=applyAutoLinks(p,[planned],'b').lines[0];assert.equal(linked.unit,'TON당');assert.equal(linked.qty,2.303);assert.equal(linked.name,good.name);assert.equal(linked.spec,good.spec);assert.equal(linked.status,category==='자재'?'confirmed':'proposed');
 }
});

test('existing unreviewed waste-to-water links are repairable without changing quantity',()=>{
 const before=line(),bad={...before,name:water.name,spec:water.spec,unit:water.unit,status:'confirmed',rate:water,qty:7,autoMatch:{before,reviewed:false}},p={lines:[bad]};
 assert.equal(incompatibleAutoLinks(p).length,1);
 const fixed=resetIncompatibleAutoLinks(p).lines[0];assert.equal(fixed.name,'폐기물처리');assert.equal(fixed.unit,'톤');assert.equal(fixed.qty,7);assert.equal(fixed.rate,null);assert.equal(fixed.status,'unmatched');
 assert.deepEqual(resetIncompatibleAutoLinks({lines:[{...bad,autoMatch:{...bad.autoMatch,reviewed:true}}]}).lines[0].rate,water);
});

test('repair or cleaning work cannot fall back to a material-only product',()=>{
 for(const [name,target] of [['구조물보수','격자형 구조물 보강재'],['시설물청소','시설물 청소재']]){
  const material=rate(target,'',{category:'자재',labor:0,material:100,expense:0,total:100}),l=line(name,'');
  assert.equal(compatibleWork(l,material),false);
  assert.equal(planAutoLinks({lines:[l]},[library([material])],'','added',{rules:[]})[0].rate,undefined);
 }
 const material=rate('콘크리트보수재','',{category:'자재',labor:0,material:100,expense:0,total:100});
 assert.equal(compatibleWork(line(material.name,''),material),true);
});
