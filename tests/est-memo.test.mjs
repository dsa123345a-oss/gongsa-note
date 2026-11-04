import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {inflateRawSync} from 'node:zlib';
import {importEst,zipStore,readTable} from '../dist/est.js';
import {readEstMemo,estRemarkText} from '../dist/est-memo.js';
import {upgradeEstLibraryMetadata,hydrateEstProjectMetadata,withEstMetadata,restoreEstProjectLibrary} from '../dist/est-metadata.js';
import {createResourcePricer} from '../dist/resource-pricing.js';
import {collectPrintEvidence} from '../dist/print-evidence.js';
import {collectEvidence} from '../dist/project-data.js';
import {collectPriceEvidence} from '../dist/price-evidence.js';
import {makePrintDocuments} from '../dist/est-print.js';

const encoder=new TextEncoder();
function fixture({memo=encoder.encode('p.837\r\nverified'),block=1,allocation=123,blobAllocation=123}={}){
 const fields=[['Code',1,20,'M1'],['Name',1,30,'Material'],['Size',1,20,'D20'],['Unite',1,8,'EA'],['TC',7,8,100],['Bigo',5635,0,null]];
 let size=1;const layout=fields.map(([name,type,width,value])=>{const length=type===1?width+1:8,offset=size+1;size+=length+1;return {name,type,width,value,length,offset};});
 const start=512+fields.length*768,dat=new Uint8Array(start+size),v=new DataView(dat.buffer),blob=new Uint8Array(1024),bv=new DataView(blob.buffer);
 v.setUint32(41,1,true);v.setUint16(45,size,true);v.setUint16(47,fields.length,true);
 for(const [i,f] of layout.entries()){const p=512+i*768;v.setUint16(p,i+1,true);dat[p+2]=f.name.length;dat.set(encoder.encode(f.name),p+3);v.setUint16(p+164,f.type,true);v.setUint16(p+166,f.width,true);v.setUint16(p+172,f.offset-1,true);dat[start+f.offset-1]=1;
  if(f.type===1)dat.set(encoder.encode(f.value),start+f.offset);else if(f.type===7)v.setFloat64(start+f.offset,f.value,true);else {v.setUint32(start+f.offset,block,true);v.setUint32(start+f.offset+4,allocation,true);}}
 bv.setUint16(520,memo.length,true);bv.setUint32(522,blobAllocation,true);bv.setUint32(526,memo.length,true);blob.set(memo,530);
 return {dat,blob,archive:zipStore({'StuffcDat.dat':dat,'StuffcDat.blb':blob})};
}

test('DBISAM memo follows the record block and allocation, preserving CP949 and line breaks',async()=>{
 const bytes=Uint8Array.from([...encoder.encode('p.837\r\n'),0xb0,0xb3,0xc1,0xa4,0x12]); // 개정 + EST formula marker
 const f=fixture({memo:bytes}),before=Buffer.from(f.archive),lib=await importEst(f.archive,'memo.estx');
 assert.equal(lib.items[0].bigo,'p.837\r\n개정\x12');assert.equal(lib.tables[0].rows[0].Bigo,lib.items[0].bigo);assert.deepEqual(Buffer.from(f.archive),before);
 assert.equal(lib.items[0].total,100);assert.equal(estRemarkText({remark:'fixed',bigo:'memo',rowBigo:'memo'}),'fixed\nmemo');
 assert.equal(estRemarkText({remark:'',bigo:''},{Remark:'other',Bigo:'other'}),'');
 assert.equal(readTable(f.dat,new Set(['Code']),f.blob).rows[0].Bigo,undefined);
});

test('missing, wrong-allocation, out-of-range and unsupported linked memos never supply guessed text or discard the price',async()=>{
 for(const options of [{blobAllocation:124},{block:2}]){const lib=await importEst(fixture(options).archive,'bad.estx');assert.equal(lib.items[0].total,100);assert.equal(lib.items[0].bigo,undefined);assert.equal(lib.tables[0].memoWarnings[0].field,'Bigo');}
 const {dat,blob}=fixture();assert.equal(readTable(dat).rows[0].Bigo,undefined);assert.ok(readTable(dat).memoWarnings.length);
 new DataView(blob.buffer).setUint32(512,2,true);assert.throws(()=>readEstMemo(blob,1,123),/다중 블록/);
 assert.throws(()=>readEstMemo(fixture({memo:Uint8Array.of(0x81)}).blob,1,123),/문자/);
});

test('library migration adds only absent verified metadata and preserves identity, edited prices and explicit empty notes',async()=>{
 const lib=await importEst(fixture().archive,'memo.estx');delete lib.estMetadataVersion;delete lib.items[0].bigo;delete lib.tables[0].rows[0].Bigo;
 const before=structuredClone(lib),result=await upgradeEstLibraryMetadata(lib);
 assert.equal(result.status,'upgraded');assert.equal(result.library.items[0].bigo,'p.837\r\nverified');assert.equal(result.library.items[0].id,lib.items[0].id);assert.equal(result.library.items[0].total,100);assert.deepEqual(lib,before);
 assert.equal((await upgradeEstLibraryMetadata(result.library)).status,'current');
 const edited=structuredClone(lib);edited.items[0].total=101;edited.items[0].material=101;edited.tables[0].rows[0].TC=101;
 const skipped=await upgradeEstLibraryMetadata(edited);assert.equal(skipped.library.items[0].bigo,undefined);assert.equal(skipped.library.tables[0].rows[0].Bigo,undefined);assert.equal(skipped.library.items[0].total,101);
 const empty=structuredClone(lib);empty.items[0].bigo='';assert.equal((await upgradeEstLibraryMetadata(empty)).library.items[0].bigo,'');
 assert.equal((await upgradeEstLibraryMetadata({...lib,originalBytes:undefined})).status,'missing-original');
});

test('saved project metadata hydration requires exact source and applied amounts, including updated price references',async()=>{
 const lib=await importEst(fixture().archive,'memo.estx'),old={...lib.items[0]};delete old.bigo;
 const project={lines:[{id:'a',rate:old},{id:'b',rate:{...old,priceReference:{...old}}}]},before=structuredClone(project),result=hydrateEstProjectMetadata(project,[lib]);
 assert.equal(result.changed,true);assert.equal(result.project.lines[0].rate.bigo,'p.837\r\nverified');assert.equal(result.project.lines[1].rate.priceReference.bigo,'p.837\r\nverified');assert.deepEqual(project,before);
 for(const r of [{...old,source:'different.estx'},{...old,material:90,total:90},{...old,manual:true}])assert.equal(withEstMetadata(r,[lib]),r);
 assert.equal(withEstMetadata({...old,bigo:''},[lib]).bigo,'');
});

test('repriced resources retain the applied memo snapshot for printing without any database',()=>{
 const material={code:'M1',name:'Material',spec:'D20',unit:'EA',source:'old.estx',library:'old',category:'자재',table:'StuffcDat',labor:0,material:100,expense:0,other:0,total:100,bigo:'old memo'};
 const selected={...material,source:'new.estx',library:'new',material:120,total:120,bigo:'new memo'};
 const result=createResourcePricer({},[{id:'new',name:'new.estx',isMain:true,items:[selected]}],{updateDirectMaterials:true}).reprice(material);
 const project=JSON.parse(JSON.stringify({lines:[{id:'x',name:'Material',qty:1,status:'confirmed',rate:result.rate}]}));
 const printed=collectPrintEvidence(project).nodes[0];assert.equal(printed.rate.bigo,'new memo');assert.equal(printed.rate.total,120);assert.equal(result.rate.bigo,'old memo');
});

test('raw assembly saves the used material memo and pages independently of its row note, then reopens without its DB',()=>{
 const material={code:'M1',name:'Material',spec:'D20',unit:'EA',source:'source.estx',library:'source',category:'자재',table:'StuffcDat',labor:0,material:100,expense:0,other:0,total:100,bigo:'supplier memo',quotePages:['p.23']};
 const assembly={...material,code:'U1',name:'Assembly',category:'일위대가',table:'HeadTitleDat',bigo:'p.837'};delete assembly.quotePages;
 const rows=[{_record:0,TitleCode:'U1',Name:'Assembly',Bigo:'p.837'},{_record:1,Code:'M1',Name:'Material',Size:'D20',Unite:'EA',GN:1,NU:0,NC:0,GU:100,GC:100,JU:0,JC:0,TC:100,Bigo:'component-only note'}];
 const lib={id:'source',name:'source.estx',items:[assembly,material],details:[['HeadMainDat:U1',rows]]},project={lines:[{id:'a',name:'Assembly',qty:1,status:'confirmed',rate:assembly}]};
 project.evidence=collectEvidence(project,[lib]);const stored=project.evidence.find(e=>e.rate.code==='M1');assert.equal(stored.rate.bigo,'supplier memo');assert.equal(stored.rate.rowBigo,'component-only note');assert.deepEqual(stored.rate.quotePages,['p.23']);
 const reopened=JSON.parse(JSON.stringify(project)),graph=collectPriceEvidence(reopened),child=graph.nodes.find(n=>n.rate.code==='M1');
 assert.equal(child.rate.bigo,'supplier memo');assert.equal(child.rate.rowBigo,'component-only note');assert.deepEqual(child.rate.quotePages,['p.23']);assert.equal(child.rate.material,100);
 assert.deepEqual(collectEvidence(reopened,[]),reopened.evidence);
});

test('opening a legacy portable library preserves registered archive bytes and restores only matching missing metadata',async()=>{
 const registered=await importEst(fixture().archive,'source.estx'),portable=structuredClone(registered);delete portable.originalBytes;delete portable.estMetadataVersion;delete portable.items[0].bigo;delete portable.tables[0].rows[0].Bigo;
 const before=structuredClone(portable),restored=restoreEstProjectLibrary(portable,[registered]);
 assert.equal(restored.library.originalBytes,registered.originalBytes);assert.equal(restored.library.items[0].bigo,'p.837\r\nverified');assert.equal(restored.portable.originalBytes,undefined);assert.equal(restored.portable.tables[0].rows[0].Bigo,'p.837\r\nverified');assert.deepEqual(portable,before);
 const edited=structuredClone(portable);edited.items[0].total=101;edited.items[0].material=101;edited.tables[0].rows[0].TC=101;
 const unchanged=restoreEstProjectLibrary(edited,[registered]);assert.equal(unchanged.library.items[0].total,101);assert.equal(unchanged.library.items[0].bigo,undefined);assert.equal(unchanged.library.tables[0].rows[0].Bigo,undefined);assert.equal(unchanged.library.originalBytes,registered.originalBytes);
 portable.items[0].bigo='';assert.equal(restoreEstProjectLibrary(portable,[registered]).portable.items[0].bigo,'');
 assert.equal(restoreEstProjectLibrary({...portable,name:'different.estx'},[registered]).library.originalBytes,undefined);
});

function legacyConverted(){
 const material={code:'M1',name:'Material',spec:'D20',unit:'EA',source:'source.estx',library:'source',category:'자재',table:'StuffcDat',record:1,labor:0,material:100,expense:0,other:0,total:100,bigo:'supplier memo'};
 const component={name:'Material',code:'M1',spec:'D20',unit:'EA',source:'source.estx',library:'source',originalRecord:1,qtyExpression:'1',labor:0,material:100,expense:0,other:0};
 const rate={...material,code:'U1',name:'Assembly',category:'일위대가',table:'HeadTitleDat',record:0,components:[component],calculation:{}};delete rate.bigo;
 const rows=[{_record:0,TitleCode:'U1',Name:'Assembly'},{_record:1,Code:'M1',Name:'Material',Size:'D20',Unite:'EA',GN:1,NU:0,NC:0,GU:100,GC:100,JU:0,JC:0,TC:100}];
 const library={id:'source',name:'source.estx',estMetadataVersion:1,items:[{...rate,bigo:'p.837'},material],details:[['HeadMainDat:U1',rows.map(r=>r._record===1?{...r,Bigo:'component original memo'}:r)]],tables:[]};
 const project={schema:1,title:'test',lines:[{id:'a',name:'Assembly',qty:1,status:'confirmed',rate}],evidence:[{rate,rows}],charges:[]};return {project,library};
}

test('legacy converted component row notes reach print and a detached save without leaking resource notes',()=>{
 const {project,library}=legacyConverted(),before=structuredClone(project),restored=hydrateEstProjectMetadata(project,[library]).project;
 assert.equal(restored.lines[0].rate.components[0].rowBigo,'component original memo');assert.equal(restored.lines[0].rate.total,100);assert.deepEqual(project,before);
 restored.evidence=collectEvidence(restored,[library]);const detached=JSON.parse(JSON.stringify(restored)),docs=makePrintDocuments(detached).documents;
 assert.equal(docs.find(d=>d.key==='units').rows[1].cells.at(-1).value,'component original memo');assert.equal(docs.find(d=>d.key==='materials').rows[0].cells.at(-1).value,'supplier memo');
 for(const patch of [{rowBigo:''},{name:'Changed'},{code:'M2'},{manual:true}]){const p=structuredClone(project);Object.assign(p.lines[0].rate.components[0],patch);const got=hydrateEstProjectMetadata(p,[library]).project.lines[0].rate.components[0];assert.equal(got.rowBigo,patch.rowBigo);}
});

test('a verified repriced original restores only missing outer notes without restoring its old prices',()=>{
 const {project,library}=legacyConverted(),current=project.lines[0].rate,original=structuredClone(current);
 current.material=120;current.total=120;current.components[0].material=120;current.resourcePricing={ready:true,original};
 const restored=hydrateEstProjectMetadata(project,[library]).project.lines[0].rate;
 assert.equal(restored.bigo,'p.837');assert.equal(restored.material,120);assert.equal(restored.total,120);assert.equal(restored.components[0].material,120);assert.equal(restored.resourcePricing.original.total,100);
 for(const patch of [{bigo:''},{manual:true},{name:'Edited Assembly'}]){const p=structuredClone(project);Object.assign(p.lines[0].rate,patch);assert.equal(hydrateEstProjectMetadata(p,[library]).project.lines[0].rate.bigo,patch.bigo);}
 const unverified=structuredClone(project);unverified.lines[0].rate.resourcePricing.original.material=99;unverified.lines[0].rate.resourcePricing.original.total=99;assert.equal(hydrateEstProjectMetadata(unverified,[library]).project.lines[0].rate.bigo,undefined);
});

for(const [name,expected] of [['2026-10-main.estx','한국석유공사'],['상수도공사메인(26년)소형감압변 수정.ebkx','p.837']]){
 const file=new URL('../seed/'+name,import.meta.url);
 test('bundled archive verified text memos: '+name,{skip:!fs.existsSync(file)},async()=>{
  const lib=await importEst(fs.readFileSync(file),name,inflateRawSync),rows=lib.tables.flatMap(t=>t.rows);
  assert.equal(lib.tables.flatMap(t=>t.memoWarnings||[]).length,0);assert.ok(rows.some(r=>r.Bigo?.includes(expected)));
  assert.ok(lib.items.some(r=>r.bigo?.includes(expected)));assert.equal(lib.estMetadataVersion,1);
 });
}
