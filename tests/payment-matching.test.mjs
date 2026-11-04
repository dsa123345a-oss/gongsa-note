import test from 'node:test';
import assert from 'node:assert/strict';
import {compatibleWork} from '../dist/match-similarity.js';
import {planAutoLinks,incompatibleAutoLinks} from '../dist/auto-link.js';
const item=(name,spec,category='자재')=>({name,spec,category,unit:'개',code:name,source:'DB',labor:category==='일위대가'?1000:0,material:100,expense:0,other:0,total:category==='일위대가'?1100:100});
test('밸브소켓은 볼밸브로 연결하지 않으며 기존 미검토 연결도 탐지한다',()=>{
 const l={id:'a',name:'STS밸브소켓',spec:'D15',unit:'EA',status:'unmatched',group:'자재대'},bad=item('STS볼밸브','15A'),good=item('STS 밸브소켓','13SU×15A');
 assert.equal(compatibleWork(l,bad),false);
 assert.equal(planAutoLinks({lines:[l]},[{id:'db',name:'DB',items:[bad,good]}])[0].rate,good);
 assert.equal(incompatibleAutoLinks({lines:[{...l,status:'confirmed',rate:bad,autoMatch:{before:l,reviewed:false}}]}).length,1);
});
test('자재포함 앵글밸브 작업은 교체 일위대가를 찾고 자재 단독·내역 단가를 배제한다',()=>{
 const l={id:'a',name:'앵글밸브(10kg/㎠)(자재포함)',spec:'15A',unit:'개',status:'unmatched',group:'1.배관공'};
 const good=item('앵글밸브 교체','D15A','일위대가'),bad=item('앵글밸브(10kg/㎠)','15A'),detail={...bad,category:'내역단가'};
 assert.equal(compatibleWork(l,bad),false);assert.equal(compatibleWork(l,detail),false);
 assert.equal(planAutoLinks({lines:[l]},[{id:'db',name:'DB',items:[bad,detail,good]}])[0].rate,good);
 assert.equal(compatibleWork({name:'앵글밸브',group:'자재대'},bad),true);
});
