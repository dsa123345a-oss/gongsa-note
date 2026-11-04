import test from 'node:test';
import assert from 'node:assert/strict';
import {extractQuantities} from '../dist/workbook.js';
import {compatibleWork} from '../dist/match-similarity.js';
import {planAutoLinks,applyAutoLinks,lineSignature,resetIncompatibleAutoLinks,incompatibleAutoLinks} from '../dist/auto-link.js';
const row=(index,values)=>({index,cells:Object.fromEntries(Object.entries(values).map(([col,value])=>[col,{value,ref:col+index,formula:'',cached:true}]))});
const header=row(8,{A:'구분',D:'공종',H:'규격',AD:'수량',AG:'단위'});
test('품명과 수량이 다른 줄에 있는 철거·절단을 읽고 수량이 있는 부모의 하위 근거는 중복하지 않는다',()=>{
 const q=extractQuantities({name:'수량',rows:[header,row(10,{A:'1.토공',D:'터파기',AD:13,AG:'㎥'}),row(11,{M:'콘크리트',AD:10,AG:'㎥'}),row(18,{D:'깨기',H:'백호(0.2㎥)'}),row(19,{M:'콘크리트',AD:1.89,AG:'㎥'}),row(20,{D:'절단'}),row(21,{M:'콘크리트',AD:37.4,AG:'m'}),row(22,{A:'2.포장공',D:'콘크리트 포장',AD:1.89,AG:'㎥'})]});
 assert.deepEqual(q.rows.map(l=>[l.name,l.qty]),[['터파기',13],['콘크리트깨기',1.89],['콘크리트절단',37.4],['콘크리트 포장',1.89]]);
 assert.equal(q.rows[1].spec,'백호(0.2㎥)');assert.equal(q.rows[1].source,'수량!D18 / AD19');assert.equal(q.rows[2].source,'수량!D20 / AD21');assert.equal(q.rows[2].group,'1.토공');
});
test('분리된 항목의 여러 재료와 0 수량을 보존하고 다른 공종·표 머리글로 넘어가지 않는다',()=>{
 const q=extractQuantities({name:'수량',rows:[header,row(9,{A:'1.토공',D:'깨기'}),row(10,{M:'아스콘',AD:0,AG:'㎥'}),row(11,{M:'콘크리트',AD:2,AG:'㎥'}),row(12,{A:'2.포장공',M:'콘크리트',AD:3,AG:'㎥'}),row(13,{D:'절단'}),row(14,{D:'공종',H:'규격',AD:'수량',AG:'단위'}),row(15,{M:'콘크리트',AD:4,AG:'m'})]});
 assert.deepEqual(q.rows.map(l=>[l.name,l.qty,l.exclude]),[['아스콘깨기',0,true],['콘크리트깨기',2,false]]);
});
test('재질이 다른 자동 후보는 품명·규격 점수나 저장된 매핑으로 되살아나지 않는다',()=>{
 for(const [a,b] of [['STS밸브소켓','XL-밸브소켓'],['STS접합및부설','PFP PM 접합 및 부설'],['PE이형관접합','PVC이형관접합'],['밸브소켓 STS','밸브소켓 XL'],['스테인리스 직관','PE 직관']])assert.equal(compatibleWork({name:a},{name:b}),false,a+' / '+b);
 assert.equal(compatibleWork({name:'SUS 직관'},{name:'STS 직관'}),true);
 assert.equal(compatibleWork({name:'PE 직관'},{name:'HDPE 직관'}),true);
 assert.equal(compatibleWork({name:'STS 접합및부설'},{name:'P.E관 접합및부설'}),false);
 assert.equal(compatibleWork({name:'S.T.S 직관'},{name:'PVC 직관'}),false);
 assert.equal(compatibleWork({name:'콘크리트포장',spec:'B-Type'},{name:'콘크리트포장'}),true);
 const line={id:'l',name:'STS밸브소켓',spec:'D20',unit:'개',status:'unmatched',group:'자재대'};
 const rate={name:'XL-밸브소켓',spec:'D20',unit:'개',category:'자재',code:'X',source:'DB',labor:0,material:100,expense:0,other:0,total:100};
 const p={lines:[line],mappings:{[lineSignature(line)]:rate}};
 assert.equal(planAutoLinks(p,[{id:'db',name:'DB',items:[rate]}],'','db')[0].rate,undefined);
 assert.equal(applyAutoLinks(p,[{line,rate}],'stale').lines[0].rate,undefined);
});
test('보호함·보호통은 전체 품목을 찾고 뚜껑은 뚜껑끼리만 연결한다',()=>{
 const rate=(name,spec,unit)=>({name,spec,unit,category:'자재',code:name,source:'DB',labor:0,material:100,expense:0,other:0,total:100});
 const cover=rate('갈바륨계량기보호통뚜껑','15mm','개'),body=rate('계량기보호통','D15×H800mm','조');
 const line={id:'l',name:'계량기보호함',spec:'D15',unit:'개',bucket:'government',status:'unmatched'};
 const p={lines:[line]},lib={id:'db',name:'DB',items:[cover,body]};
 assert.equal(planAutoLinks(p,[lib])[0].rate.name,body.name);
 assert.equal(planAutoLinks(p,[{...lib,items:[cover]}])[0].rate,undefined);
 assert.equal(compatibleWork({name:'계량기보호통뚜껑'},body),false);
 assert.equal(compatibleWork({name:'계량기보호통뚜껑'},{name:'계량기보호통덮개'}),true);
});
test('단순 관경에는 같은 관경의 소켓을 제안하고 절단·깨기는 시공으로 대체하지 않는다',()=>{
 const line={id:'l',name:'STS밸브소켓',spec:'D20',unit:'개',status:'unmatched',group:'자재대'};
 const items=['20SU×15A','20SU×20A'].map(spec=>({name:'STS 밸브소켓',spec,unit:'개',category:'자재',code:spec,source:'DB',labor:0,material:100,expense:0,other:0,total:100}));
 assert.equal(planAutoLinks({lines:[line]},[{id:'db',name:'DB',items}])[0].rate.spec,'20SU×20A');
 assert.equal(compatibleWork({name:'콘크리트절단'},{name:'콘크리트 포장'}),false);
 assert.equal(compatibleWork({name:'콘크리트포장'},{name:'콘크리트포장깨기'}),false);
});
test('예전 자동 오연결은 원래 품명으로 되돌리되 수정한 수량과 사용자 확인·수동 연결은 보존한다',()=>{
 const before={name:'STS밸브소켓',spec:'D20',unit:'개',qty:2,factor:1};
 const bad={id:'bad',name:'XL-밸브소켓',spec:'D20',unit:'개',qty:5,status:'confirmed',rate:{name:'XL-밸브소켓',unit:'개'},autoMatch:{before,reviewed:false}};
 const project={lines:[bad,{...bad,id:'reviewed',autoMatch:{before,reviewed:true}},{...bad,id:'manual',autoMatch:undefined}]};
 const original=structuredClone(project),fixed=resetIncompatibleAutoLinks(project);
 assert.equal(incompatibleAutoLinks(project).length,1);assert.equal(fixed.lines[0].name,'STS밸브소켓');assert.equal(fixed.lines[0].qty,5);assert.equal(fixed.lines[0].rate,null);assert.equal(fixed.lines[0].status,'unmatched');
 assert.deepEqual(fixed.lines.slice(1),original.lines.slice(1));assert.deepEqual(project,original);
});
