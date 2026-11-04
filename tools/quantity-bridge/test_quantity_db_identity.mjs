import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {spawnSync} from 'node:child_process';
const context=vm.createContext({console});
vm.runInContext(fs.readFileSync(new URL('./quantity-db-identity.js',import.meta.url),'utf8'),context);
const api=context.QuantityDbIdentity;
const catalog=JSON.parse(fs.readFileSync(new URL('./quantity_db_catalog.json',import.meta.url),'utf8'));
const db=api.create(catalog),plain=x=>JSON.parse(JSON.stringify(x));
const row=(name,spec='D20',unit='개소',qty=2)=>({id:'row',name,spec,unit,qty});
const item=code=>catalog.items.find(x=>x.code===code&&x.role==='assembly');

test('새들분기 범위품은 본관 일치·지관 범위 포함·유일 후보일 때 자동 연결',()=>{
 const cases=[['D80×15','U0000000179'],['D80×20','U0000000179'],['80×(15~20)','U0000000179'],['D80×25','U0000000180'],['D80×32','U0000000180'],['D80×40','U0000000181'],['D80×50','U0000000181'],['D100×20','U0000000182']];
 for(const [spec,code] of cases){
  const r=row('부단수 새들분수전 분기',spec,'개소',2),before=plain(r),found=db.identify(r,'work');
  assert.equal(found.match?.code,code,spec);assert.equal(found.match.role,'assembly');
  assert.equal(db.contract(r,'work').id,found.match.id);assert.deepEqual(plain(r),before);
  assert.ok(db.search('새들분수전 '+spec.replace(/\(.*\)/,'20'),'work',{limit:1000}).some(x=>x.id===found.match.id),spec);
 }
 for(const spec of ['D80×21','D80×(20~25)','D90×20','D80','D80×100'])assert.equal(db.identify(row('부단수 새들분수전 분기',spec),'work').match,null,spec);
});
test('새들분기는 수동 선택·기존 저장값에도 본관과 지관 범위를 검증',()=>{
 const r=row('부단수 새들분수전 분기','D80×20');
 assert.throws(()=>db.select(r,item('U0000000182').id,{kind:'work'}),/관경/);
 assert.throws(()=>db.select(r,item('U0000000180').id,{kind:'work'}),/관경/);
 const chosen=db.select(r,item('U0000000179').id,{kind:'work'});assert.equal(db.identify(chosen,'work').status,'selected');
 const wrong=item('U0000000182');chosen.quantityDb={...wrong,original:{name:r.name,spec:r.spec,unit:r.unit}};
 assert.equal(db.identify(chosen,'work').status,'stale');
 const t=item('U0000000179'),ambiguous=api.create({schema:1,items:[t,{...t,id:'overlap',code:'Uoverlap',spec:'Φ80*(15~25)'}]});
 assert.equal(ambiguous.identify(r,'work').match,null);
 const priority=api.create({schema:1,items:[t,{...t,id:'main-exact',code:'Umain',role:'resource',spec:'D80×20'}]});
 assert.equal(priority.identify(r,'work').match.id,t.id);
});

test('실제 검색도 품명·관경·단위를 같이 해석하고 D20과 D200을 구분',()=>{
 for(const query of ['PE 소켓 D20SU','PE소켓 20SU EA','PE 소켓 S20SU','PE소켓 D 20 mm 개','PE소켓 D20']){
  const xs=db.search(query,'material',{limit:1000});assert.ok(xs.length,query);
  assert.equal(xs.filter(x=>api.nameKey(x.name)==='pe소켓').length,1,query);
  assert.ok(xs.every(x=>api.pipeKey(x.spec)==='d20'),query);
  assert.ok(xs.filter(x=>api.nameKey(x.name)==='pe소켓').every(x=>x.role==='assembly'),query);
 }
 for(const query of ['D20','D20SU','20SU','S20SU','D 20 mm','20','D20 EA','DN=20','D=20 EA']){
  assert.equal(api.matchesQuery({name:'PE 소켓',spec:'D20mm',unit:'개',code:'M0001'},query),true,query);
  assert.equal(api.matchesQuery({name:'PE 소켓',spec:'D200mm',unit:'개',code:'M00020'},query),false,query);
 }
 assert.equal(api.matchesQuery({name:'STS 소켓',spec:'D20',unit:'개'},'PE 소켓 D20SU'),false);
 assert.equal(api.matchesQuery({name:'PE 소켓',spec:'D25mm',unit:'개'},'PE소켓 D20SU'),false);
});

test('자재는 공백과 규격·단위 표기에 관계없이 추가 DB만 신규 후보로 노출',()=>{
 const expected=catalog.items.filter(x=>x.kind==='material'&&x.role==='assembly'&&api.nameKey(x.name)==='pe소켓');
 assert.equal(expected.length,9);
 for(const name of ['PE소켓','PE 소켓',' PE  소 켓 ']){
  assert.deepEqual(new Set(db.familyView(name,'material').candidates.map(x=>x.id)),new Set(expected.map(x=>x.id)));
  assert.equal(db.search(name,'material',{limit:1000}).filter(x=>api.nameKey(x.name)==='pe소켓').length,9);
  for(const spec of ['D20','D20mm','D20SU','20SU','S20SU','D 20 SU','Φ20mm','20A'])for(const unit of ['개','개소','EA','ea.',' E A ']){
   const r=row(name,spec,unit,7.25),found=db.identify(r,'material');assert.equal(found.match?.role,'assembly',JSON.stringify(r));
   assert.equal(db.contract(r,'material').qty,7.25);assert.equal(db.view(r,'material').unit,'개');
  }
 }
});
test('넓은 검색에서도 추가 없는 자재는 10월을 유지하고 기존 선택은 원형 보존',()=>{
 const extraFamilies=new Set(catalog.items.filter(x=>x.kind==='material'&&x.role==='assembly').map(x=>api.nameKey(x.name)));
 for(const [key,representative] of new Map(catalog.items.filter(x=>x.kind==='material').map(x=>[api.nameKey(x.name),x]))){
  const xs=db.familyView(representative.name,'material').candidates;
  if(extraFamilies.has(key))assert.ok(xs.every(x=>x.role==='assembly'),key);
  else assert.ok(xs.length,key);
 }
 const socket=db.search('소켓','material',{limit:1000});assert.ok(socket.some(x=>x.role==='resource'));assert.ok(socket.every(x=>x.role==='assembly'||!extraFamilies.has(api.nameKey(x.name))));
 const main=catalog.items.find(x=>x.kind==='material'&&x.role==='resource'&&api.nameKey(x.name)==='pe소켓'&&api.specKey(x.spec)==='d20');assert.ok(main);
 const r=db.select(row('PE소켓','D20','개',3),main.id,{kind:'material'}),before=plain(r);
 assert.equal(db.identify(r,'material').match.id,main.id);assert.ok(!db.identify(r,'material').candidates.some(x=>x.id===main.id));
 assert.equal(db.contract(r,'material').id,main.id);assert.deepEqual(plain(r),before);
});
test('추가에 없는 규격은 다른 관경으로 자동 대체하지 않으며 단위 실환산은 별도',()=>{
 const base=catalog.items.find(x=>x.kind==='material'&&x.role==='assembly'&&api.nameKey(x.name)==='pe소켓');
 const custom=api.create({schema:1,items:[{...base,id:'extra20',spec:'D20mm'},{...base,id:'main25',role:'resource',spec:'D25SU'}]});
 assert.equal(custom.identify(row('PE 소켓','D25','개'),'material').match,null);
 assert.deepEqual(plain(custom.familyView('PE 소켓','material').candidates.map(x=>x.id)),['extra20']);
 for(const [a,b] of [['㎥','m^3'],['㎡','m²'],['T','톤'],['ℓ','리터'],['M','미터']])assert.equal(api.safeUnit(a,b),true);
 for(const [a,b] of [['M','본'],['kg','Ton'],['개','조']])assert.equal(api.safeUnit(a,b),false);
});

test('화면·선택·내보내기 모두 같은 DB 정식 이름 규격 단위를 사용',()=>{
 const original=row('소프트실제수밸브설치','D50'),before=structuredClone(original);
 const found=db.identify(original,'work');assert.equal(found.status,'matched');assert.equal(found.match.code,'U0000000249');
 assert.deepEqual(plain(db.view(original,'work')),{name:'소프트지수밸브 설치',spec:'Φ50mm',unit:'개',status:'matched',identity:plain(found.match),needsSelection:false,reason:''});
 const selected=db.select(original,found.match.id,{kind:'work'}),out=db.contract(selected,'work');
 assert.equal(selected.name,original.name);assert.equal(selected.unit,'개소');assert.equal(selected.qty,2);assert.deepEqual(original,before);
 assert.equal(out.quantityDb.name,'소프트지수밸브 설치');assert.equal(out.quantityDb.unit,'개');assert.equal(out.id,found.match.id);assert.deepEqual(plain(out.quantityDb.original),before&&{name:before.name,spec:before.spec,unit:before.unit});
});
test('추가 DB를 우선하고 선택 identity에 출처·코드까지 보존',()=>{
 const found=db.identify(row('PE이형관접합'),'work');assert.equal(found.match.role,'assembly');
 const out=db.contract(row('PE이형관접합'),'work');assert.equal(out.quantityDb.code,'U0000000009');assert.equal(out.quantityDb.source,'상수도공사메인(26년)소형감압변 수정.ebkx');assert.equal(out.quantityDb.unit,'개');
});
test('STS 조인트 방식과 KP 인력 방식은 이름이 비슷해도 자동 추정하지 않음',()=>{
 for(const r of [row('STS이형관접합'),row('KP메커니컬 접합 및 부설','D80','본')]){
  const found=db.identify(r,'work');assert.equal(found.match,null);assert.equal(found.status,'review');assert.ok(found.candidates.length);assert.equal(db.view(r,'work').needsSelection,true);assert.equal(db.contract(r,'work'),null);
 }
 const r=row('STS이형관접합'),selected=db.select(r,item('U0000000100').id,{kind:'work'});
 assert.equal(selected.spec,'D20');assert.equal(db.view(selected,'work').spec,'Φ20mm/HI-DR조인트');assert.equal(db.contract(selected,'work').quantityDb.code,'U0000000100');
});
test('다른 관경은 내부 규격을 명시적으로 수정하기 전 선택하지 않음',()=>{
 assert.throws(()=>db.select(row('PE이형관접합','D20'),item('U0000000010').id,{kind:'work'}),/관경/);
 const target=item('U0000000010'),next=db.select(row('PE이형관접합',target.spec),target.id,{kind:'work'});assert.equal(next.quantityDb.spec,target.spec);
});
test('선택 후 원본 규격·단위를 바꾸거나 선택 정체성을 조작하면 재선택',()=>{
 const r=db.select(row('PE이형관접합'),item('U0000000009').id,{kind:'work'});
 for(const mutate of [x=>x.spec='D25',x=>x.unit='M',x=>x.quantityDb.code='wrong',x=>x.quantityDb.name='다른 품']){
  const changed=structuredClone(r);mutate(changed);assert.equal(db.identify(changed,'work').status,'stale');assert.throws(()=>db.contract(changed,'work'),/다시|다릅니다/);
 }
 assert.equal(db.clear(r).quantityDb,undefined);assert.ok(r.quantityDb);
});
test('M↔개·M↔본은 확인 버튼만으로 수량이나 단위를 바꾸지 않음',()=>{
 const saddle=item('U0000000195'),kp=item('U0000000406');
 for(const [r,t] of [[row('부단수할정자관부설및접합','D200','M',12),saddle],[row('KP메커니컬 접합 및 부설','D80','M',12),kp]]){
  const before=structuredClone(r);assert.throws(()=>db.select(r,t.id,{kind:'work',confirmUnit:true,quantity:2}),/입력 단위/);assert.deepEqual(r,before);
 }
});
test('개↔조는 확인한 실제 수량만 반영하고 기존 값과 선택 당시 수량 보존',()=>{
 const target=catalog.items.find(x=>x.role==='assembly'&&x.kind==='material'&&x.name.includes('이탈방지압륜')&&x.spec==='D80mm');assert.ok(target);
 const r=row('이탈방지압륜(KP부속)','D80','개',2);
 assert.throws(()=>db.select(r,target.id,{kind:'material'}),/실제 수량/);
 const selected=db.select(r,target.id,{kind:'material',confirmUnit:true,quantity:1});
 assert.deepEqual(plain(selected.originalQuantity),{qty:2,unit:'개'});assert.equal(selected.unit,'조');assert.equal(selected.qty,1);assert.equal(selected.quantityDb.quantity,1);assert.equal(db.contract(selected,'material').confirmUnit,true);
 selected.qty=2;assert.equal(db.identify(selected,'material').status,'selected');assert.equal(db.contract(selected,'material').qty,2);assert.deepEqual(plain(selected.originalQuantity),{qty:2,unit:'개'});
});
test('종류가 다른 품목 ID를 붙일 수 없고 검색은 실제 DB 항목을 반환',()=>{
 const actual=item('U0000000009');assert.throws(()=>db.select(row('PE이형관접합'),actual.id,{kind:'material'}),/같은 자재/);
 const found=db.search('STS 이형관','work',{limit:3});assert.equal(found.length,3);assert.ok(found.every(x=>x.name==='STS 이형관 접합'&&x.kind==='work'));
 const f=db.familyView('PE이형관접합','work');assert.equal(f.name,'PE 이형관 접합');assert.equal(f.unit,'개');
});
test('동일 후보가 여러 개이거나 단위가 다르면 대표 품을 임의로 선택하지 않음',()=>{
 const source=item('U0000000009'),dup={...source,id:source.id+'copy',code:'U000copy'};const custom=api.create({schema:1,version:'test',items:[source,dup]});
 assert.equal(custom.identify(row('PE이형관접합'),'work').match,null);
 assert.throws(()=>api.create({schema:1,items:[source,source]}),/중복/);
});
test('정식 이름·규격 정규화는 숫자 표현과 공백을 정리해도 수량에 손대지 않음',()=>{
 for(const spec of ['D20','D20mm','D20SU','20SU','S20SU']){const r=row('PE 이형관 접합',spec,'개소',7.25);const out=db.contract(r,'work');assert.equal(out.quantityDb.code,'U0000000009');assert.equal(out.qty,7.25);}
 assert.equal(api.nameKey('배  관  공'),'배관공');assert.deepEqual(plain(api.diameters('D20×15')),[20,15]);
});
test('미선택 품목도 실제 입력명·관경·수량 단위를 숨기거나 변환하지 않음',()=>{
 const unknown=row('알수없는 부품','D20×15','M',12),shown=db.view(unknown,'material');assert.equal(shown.name,unknown.name);assert.equal(shown.spec,unknown.spec);assert.equal(shown.unit,'M');assert.equal(shown.needsSelection,true);
 const legacy=row('부단수할정자관부설및접합','D200','M',12),view=db.view(legacy,'work');assert.equal(view.name,'부단수 할정자관 부설및접합');assert.equal(view.spec,'D200');assert.equal(view.unit,'M');assert.equal(view.needsSelection,true);
});
test('괄호 안의 공법 관경도 검사하고 저장된 선택도 다시 검증',()=>{
 const base=item('U0000000406'),target={...base,id:'method',spec:'(인력:Φ100mm)'};
 const custom=api.create({schema:1,items:[target]});assert.deepEqual(plain(api.diameters(target.spec)),[100]);
 assert.throws(()=>custom.select(row('KP메커니컬 접합 및 부설','D80','본'),target.id,{kind:'work'}),/관경/);
 const r=custom.select(row('KP메커니컬 접합 및 부설','D100','본'),target.id,{kind:'work'});r.spec='D80';r.quantityDb.original.spec='D80';assert.equal(custom.identify(r,'work').status,'stale');
});
test('PE청동밸브소켓은 관측만 저장된 DB를 선택해도 나사측 입력을 보존',()=>{
 const r=row('PE청동밸브소켓','D20×15','개'),target=item('M0000000989');assert.equal(db.identify(r,'material').match,null);
 const next=db.select(r,target.id,{kind:'material'});assert.equal(next.spec,'D20×15');assert.equal(db.view(next,'material').spec,'D20×15');assert.equal(db.view(next,'material').name,'PE 청동밸브소켓');assert.equal(next.quantityDb.spec,'D20mm');
 assert.throws(()=>db.select({...r,spec:'D25×15'},target.id,{kind:'material'}),/관경/);
});
test('확인된 보호통·PE용 분수전 별칭만 정식 DB 계열로 연결',()=>{
 assert.equal(db.familyView('FRP보호통','material').name,'FRP 제수밸브보호통');assert.equal(db.familyView('새들붙이분수전(PE관용)','material').name,'새들붙이분수전(PE용)');
 assert.equal(db.familyView('XL소켓','material').candidates.length,0);assert.equal(db.familyView('관매달기 ㄱ형강','material').candidates.length,0);
});
test('KP 관경 범위품은 명시선택 시만 적용하고 범위 밖이면 차단',()=>{
 const target=item('U0000000392');assert.equal(target.spec,'D=125mm이하');
 assert.equal(db.identify(row('KP메커니컬 접합 및 부설','D80','본'),'work').match,null);
 const selected=db.select(row('KP메커니컬 접합 및 부설','D80','본'),target.id,{kind:'work'});assert.equal(selected.spec,'D80');assert.equal(selected.qty,2);assert.equal(db.identify(selected,'work').status,'selected');
 assert.throws(()=>db.select(row('KP메커니컬 접합 및 부설','D150','본'),target.id,{kind:'work'}),/관경/);
 const included=item('U0000000399');assert.equal(db.select(row('KP메커니컬 접합 및 부설','D80(이탈방지압륜사용)','본'),included.id,{kind:'work'}).quantityDb.id,included.id);
 assert.throws(()=>db.select(row('PE이형관접합','D20'),item('U0000000010').id,{kind:'work'}),/관경/);
});
test('사용자가 확정한 STS엘보는 나사식 자재만 연결하며 과거 프레스 선택은 재검토',()=>{
 const r=row('STS엘보','D20','개'),found=db.identify(r,'material');assert.equal(found.match.code,'M0005333632');assert.equal(found.match.name,'STS 엘보 (나사식)');assert.equal(found.match.role,'resource');assert.ok(found.candidates.every(x=>x.name==='STS 엘보 (나사식)'));
 const prior=catalog.items.find(x=>x.name==='STS 엘보 (이중링프레스식)');assert.ok(prior);
 const saved={...r,quantityDb:{...prior,original:{name:r.name,spec:r.spec,unit:r.unit}}};assert.equal(db.identify(saved,'material').status,'stale');assert.equal(db.identify(saved,'material').match,null);
 assert.throws(()=>db.select(r,prior.id,{kind:'material'}),/같은 자재/);
});
test('Python DB bridge와 실제 카탈로그 자동 선택 결과 일치',()=>{
 const cases=[['PE이형관접합','D20','개소','work'],['소프트실제수밸브설치','D50','개소','work'],['STS이형관접합','D20','개소','work'],['KP메커니컬 접합 및 부설','D80','본','work'],['부단수할정자관부설및접합','D200','개소','work'],['부단수 천공 분기점 분기','D80','개소','work'],['나사식접합','D13','개소','work'],['PE소켓플랜지','D80','개','material'],['XL정티','D20','개','material']];
 const code="import sys,json;from quantity_db import candidates,safe_unit;out=[]\nfor n,s,u,k in json.load(sys.stdin):\n m,c=candidates(n,s,k);out.append(m['id'] if m and safe_unit(u,m['unit']) else None)\nprint(json.dumps(out))";
 const python=process.env.PYTHON_EXECUTABLE||(process.platform==='win32'?'python':'python3');
 const result=spawnSync(python,['-X','utf8','-c',code],{cwd:new URL('.',import.meta.url),input:JSON.stringify(cases),encoding:'utf8'});
 assert.equal(result.status,0,result.stderr);const expected=JSON.parse(result.stdout);
 assert.deepEqual(cases.map(([n,s,u,k])=>db.identify(row(n,s,u),k).match?.id||null),expected);
});
