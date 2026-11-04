import test from 'node:test';
import assert from 'node:assert/strict';
import {importEst,zipStore} from '../dist/est.js';
import {createResourcePricer} from '../dist/resource-pricing.js';
import {collectEvidence} from '../dist/project-data.js';
import {collectPriceEvidence} from '../dist/price-evidence.js';
import {calculateAssemblyDetailed} from '../dist/estimate-core.js';

// A small real DBISAM-layout table exercises the archive importer, including
// fixed-text empty values and all six survey-page fields.
function table(record){
 const entries=Object.entries(record),fields=[];let rowSize=1;
 for(const [name,value]of entries){const type=typeof value==='number'?7:1,length=type===7?8:65;fields.push({name,value,type,length,offset:rowSize+1});rowSize+=length+1;}
 rowSize=Math.max(26,rowSize);const start=512+fields.length*768,b=new Uint8Array(start+rowSize),v=new DataView(b.buffer),enc=new TextEncoder();
 v.setUint32(41,1,true);v.setUint16(45,rowSize,true);v.setUint16(47,fields.length,true);
 fields.forEach((f,i)=>{const p=512+i*768;v.setUint16(p,i+1,true);b[p+2]=f.name.length;b.set(enc.encode(f.name),p+3);v.setUint16(p+164,f.type,true);v.setUint16(p+166,f.type===1?64:8,true);v.setUint16(p+172,f.offset-1,true);b[start+f.offset-1]=1;if(f.type===7)v.setFloat64(start+f.offset,f.value,true);else b.set(enc.encode(f.value),start+f.offset);});
 return b;
}
const material=(code,name,price,source='추가 DB',library='extra')=>({id:library+':'+code,code,name,spec:'D20',unit:'개',source,library,category:'자재',table:'StuffcDat',labor:0,material:price,expense:0,other:0,total:price});
const line=rate=>({id:'line',name:rate.name,spec:rate.spec,unit:rate.unit,qty:1,group:'자재',bucket:'direct',status:'confirmed',rate});

test('EST importer preserves six survey pages and fixed Remark in a standalone rate snapshot',async()=>{
 const pages=['p.837','  26-10  ','','004','estimate A','last page'];
 const record={Code:'M001',Name:'Material',Size:'D20',Unite:'EA',TC:100,Cost1:100,Cost2:110,Remark:'fixed remark',...Object.fromEntries(pages.map((p,i)=>['Page'+(i+1),p]))};
 const lib=await importEst(zipStore({'StuffcDat.dat':table(record)}),'source.estx');
 const rate=JSON.parse(JSON.stringify(lib.items[0]));assert.deepEqual(rate.quotePages,pages);assert.equal(rate.remark,'fixed remark');assert.equal(rate.prices[0],100);assert.equal(rate.prices[5],null);
 // Fixed Remark is not a guessed restoration of the separate Bigo memo blob.
 assert.equal(rate.Bigo,undefined);
 const noRemark=await importEst(zipStore({'StuffcDat.dat':table({Code:'M002',Name:'No source text',TC:0})}),'empty.estx');
 assert.deepEqual(noRemark.items[0].quotePages,Array(6).fill(''));assert.equal(noRemark.items[0].remark,'');
});

test('direct additional-DB material keeps its own pages rather than the monthly source',()=>{
 const old={...material('M1','소켓',100),prices:[100],quotePages:['추가 원본 10쪽'],remark:'추가 비고'};
 const latest={...material('M9','소켓',120,'10월 DB','main'),prices:[120],quotePages:['월별 20쪽'],remark:'월별 비고'};
 const lib={id:'main',name:'10월 DB',isMain:true,items:[latest]};
 const result=createResourcePricer({},[lib]).reprice(old),saved=JSON.parse(JSON.stringify(result.rate));
 assert.equal(saved.total,100);assert.deepEqual(saved.quotePages,old.quotePages);assert.equal(saved.remark,old.remark);assert.equal(saved.priceReference,undefined);
});

test('updated and retained assembly resources both preserve their exact survey sources after save/reopen without DBs',()=>{
 const old={...material('M1','소켓',100),prices:[100],quotePages:['추가 10쪽'],remark:'추가 소켓'};
 const missing={...material('M2','특수 자재',50),prices:[50],quotePages:['추가 40쪽'],remark:'기존 유지 자재'};
 const current={...material('M9','소켓',120,'10월 DB','main'),prices:[120],quotePages:['월별 20쪽'],remark:'10월 소켓'};
 const parts=[old,missing].map(r=>({name:r.name,code:r.code,spec:r.spec,unit:r.unit,source:r.source,library:r.library,qtyExpression:'1',labor:0,material:r.material,expense:0,other:0}));
 const assembly={code:'U1',name:'설치',spec:'',unit:'개소',source:'추가 DB',library:'extra',category:'일위대가',table:'HeadTitleDat',components:parts,calculation:{},...calculateAssemblyDetailed(parts,{}).result};
 const libraries=[{id:'main',name:'10월 DB',isMain:true,priceUpdateReference:true,items:[current]},{id:'extra',name:'추가 DB',items:[old,missing,assembly]}];
 const before=JSON.stringify(libraries),result=createResourcePricer({},libraries).reprice(assembly);
 assert.equal(result.ready,true);assert.equal(result.rate.total,170);
 const p={lines:[line(result.rate)]};p.evidence=collectEvidence(p,libraries);
 const restored=JSON.parse(JSON.stringify(p)),leaves=collectPriceEvidence(restored,[]).nodes.filter(n=>n.kind==='자재');
 const updated=leaves.find(n=>n.rate.code==='M1').rate,retained=leaves.find(n=>n.rate.code==='M2').rate;
 assert.equal(updated.material,120);assert.deepEqual(updated.priceReference.quotePages,['월별 20쪽']);assert.equal(updated.priceReference.remark,'10월 소켓');
 assert.equal(retained.material,50);assert.deepEqual(retained.quotePages,['추가 40쪽']);assert.equal(retained.remark,'기존 유지 자재');assert.equal(retained.priceReference,undefined);
 assert.equal(JSON.stringify(libraries),before);
});

test('missing historical metadata is not filled from another DB with reused codes',()=>{
 const historical=material('M1','소켓',90,'예전 DB','old');
 const unrelated={...material('M1','소켓',100,'다른 DB','other'),quotePages:['잘못된 99쪽'],remark:'다른 시점'};
 const result=createResourcePricer({},[{id:'other',name:'다른 DB',isMain:true,items:[unrelated]}]).reprice(historical);
 assert.equal(result.rate.total,90);assert.equal(result.rate.quotePages,undefined);assert.equal(result.rate.remark,undefined);assert.equal(result.rate.priceReference,undefined);
});
