import {applyEmergencySurcharges} from './emergency-surcharges.js';
import {quantityHierarchy} from './levels.js';
import {sectionTitle,emergencyBundleTitle,normalizeSectionTitles} from './project-labels.js';
import {workConnectionJoints,reserveWorkConnectionJoints} from './work-connection-joints.js';
import {EMERGENCY_CONTRACT_LIMIT} from './emergency-rules.js';
export function nextSectionNumber(project){
 const roots=project.lines.filter(l=>l.level===2);
 return Math.max(roots.length,...roots.map(l=>Number(l.sectionNumber)||Number(l.name.match(/(\d+)\s*공구/)?.[1])||0),0)+1;
}
const workbookExtension=/\.xls[xm]?$/i;
const quantityPrefix=/^수량\s*산출서\s*/;
const sectionPrefix=/^\s*(?:\(\s*(?:제\s*)?\d*\s*공구\s*\)|(?:제\s*)?\d+\s*공구)\s*/;
const cleanSite=value=>String(value??'').normalize('NFKC').replace(quantityPrefix,'').replace(sectionPrefix,'').trim();
const comparable=value=>String(value??'').normalize('NFKC').toLowerCase().replace(/[\s()[\]]/g,'');
const comparableSite=value=>comparable(cleanSite(value).replace(/(?:_\d+|\s+\(\d+\))$/,''));
export function quantitySiteName(title,file){
 return cleanSite(title)||cleanSite(String(file||'').replace(workbookExtension,''));
}
export function quantityTitleConflict(title,file){
 const filename=String(file||'').normalize('NFKC').replace(workbookExtension,'');
 const sheetSite=cleanSite(title),fileSite=cleanSite(filename);
 if(!sheetSite||!fileSite||!quantityPrefix.test(filename)||comparableSite(sheetSite)===comparableSite(fileSite))return null;
 return {sheetSite,fileSite};
}
export function quantityDuplicates(project,entries,{append=false}={}){
 const previouslyImported=append?project.lines.filter(l=>l.level===2&&l.sourceFile).map(l=>({
  file:l.sourceFile,digest:l.sourceDigest,site:l.sourceSite||l.name,
 })):[];
 const seen=[...previouslyImported],duplicates=[];
 for(const [index,entry] of entries.entries()){
  const site=comparableSite(entry.sourceSite??entry.site??entry.quantity.title);
  const prior=seen.find(x=>entry.digest&&x.digest===entry.digest||
   comparable(x.file)===comparable(entry.file)||site&&site===comparableSite(x.site));
  if(prior)duplicates.push({index,file:entry.file,prior:prior.file});
  seen.push({file:entry.file,digest:entry.digest,site});
 }
 return duplicates;
}
export function quantityImportKind(entries){
 const labels=entries.map(e=>String(e.quantity?.title||'')+' '+String(e.file||''));
 if(labels.some(s=>/긴급|보수/.test(s)))return 'emergency';
 return labels.length&&labels.every(s=>/신규|급수/.test(s))?'new':null;
}
export function quantitySupplyFeeAvailability(project,entries,{append=false,numbered=false}={}){
 const kind=quantityImportKind(entries),priorEmergency=append&&(project.workType==='emergency'||/긴급|보수/.test(project.title||''));
 const reason=numbered||kind==='emergency'||priorEmergency?'긴급보수·공구별 가져오기에는 신규급수 수수료를 추가하지 않습니다.':entries.length!==1?'여러 파일을 하나의 신청으로 묶어 수수료를 계산하지 않습니다. 단일 신청의 수량산출서를 선택하세요.':'';
 return {allowed:!reason,defaultEnabled:!reason&&!append&&kind==='new',kind,reason};
}
export function buildQuantityProject(project,entries,{append=false,numbered=false,start=1,contractTitle='상수도긴급보수공사',allowDuplicates=false}={}){
 if(!entries.length||entries.some(e=>!e.quantity.rows.length))throw Error('모든 파일에서 수량이 있는 시트를 선택하세요.');
 if(numbered&&(!Number.isInteger(start)||start<1||start>9999||!contractTitle.trim()))throw Error('시작 공구 번호와 공사명을 확인하세요.');
 if(entries.some(e=>e.titleConflict&&!String(e.site||'').trim()))throw Error('서로 다른 공사명 중 사용할 이름을 선택하세요.');
 if(!allowDuplicates&&quantityDuplicates(project,entries,{append}).length)throw Error('이미 포함된 수량산출서 또는 동일 현장이 있습니다. 중복 여부를 확인하세요.');
 const next=append&&project.lines.length?quantityHierarchy(project):{...structuredClone(project),lines:[],quantityFile:''};
 const prior=next.lines.length;
 if(!prior){
  // A replacement belongs to the incoming application, not the preceding one.
  delete next.supplyFees;delete next.workType;
  if((project.workType==='emergency'||/긴급|보수/.test(project.title||''))&&[10_000_000,EMERGENCY_CONTRACT_LIMIT].includes(next.contractLimit))delete next.contractLimit;
  const kind=quantityImportKind(entries);if(kind)next.workType=kind;
 }
 reserveWorkConnectionJoints([
  ...next.lines.filter(l=>l.workConnectionJoints!==undefined).map(l=>({label:l.sourceFile||l.name||'기존 내역',joints:l.workConnectionJoints})),
  ...entries.map(e=>({label:e.file,joints:e.quantity.workConnectionJoints})),
 ]);
 if(numbered&&append&&next.lines.some(l=>l.level===2&&((Number(l.sectionNumber)||Number(l.name.match(/(\d+)\s*공구/)?.[1])||0)>=start)))throw Error('기존 공구 번호와 겹칩니다. 시작 번호를 마지막 공구 뒤로 지정하세요.');
 for(const [i,entry] of entries.entries()){
  const q=structuredClone(entry.quantity),site=entry.site??quantitySiteName(q.title,entry.file);
  const title=numbered?sectionTitle(start+i,site):(entry.titleConflict?site:q.title||entry.file.replace(workbookExtension,'')).replace(/^수량산출서/,'상수도 신규 급수공사');
  // Each file owns an independent L2 subtree, even when its L1 labels repeat.
  const idMap=new Map(q.rows.map(l=>[l.id,crypto.randomUUID()]));
  const imported=q.rows.map(l=>{const row={...l,id:idMap.get(l.id),sourceFile:entry.file};if(row.surcharge?.scope==='selected'){row.surcharge={...row.surcharge,sourceIds:row.surcharge.sourceIds.map(id=>idMap.get(id)||id)};if(row.surcharge.kpAllowance)row.surcharge.kpAllowance={...row.surcharge.kpAllowance,identities:row.surcharge.kpAllowance.identities.map(t=>({...t,id:idMap.get(t.id)||t.id}))};}return row;});
  const section=quantityHierarchy({title,location:q.location||'',lines:imported});
  section.lines[0].sourceFile=entry.file;section.lines[0].sourceSheet=entry.sheets?.[entry.sheet]?.name||'';
  if(entry.digest)section.lines[0].sourceDigest=entry.digest;
  section.lines[0].sourceSite=entry.sourceSite??site;
  section.lines[0].workConnectionJoints=workConnectionJoints(q.workConnectionJoints);
  if(numbered){section.lines[0].sectionNumber=start+i;section.lines[0].autoHeading='section';}
  next.lines.push(...section.lines);
  next.quantityFile=[next.quantityFile,entry.file].filter(Boolean).join(' · ');
  if(!prior&&i===0){next.title=numbered?emergencyBundleTitle(contractTitle,site):title;next.location=q.location||'';}
 }
 if(numbered||prior||entries.length>1)for(const l of next.lines)if(l.autoHeading==='project')l.autoHeading='section';
 if(numbered)next.workType='emergency';
 if(next.workType==='emergency')next.contractLimit??=EMERGENCY_CONTRACT_LIMIT;
 next.ratesReviewed=false;normalizeSectionTitles(next);return numbered?applyEmergencySurcharges(next).project:next;
}
