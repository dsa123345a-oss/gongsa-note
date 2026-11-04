import {norm,unitNorm} from './calc.js';
import {bundledConnections} from './waterworks-connections.js';
import {nameNorm,compareSpecs,specNorm} from './match-similarity.js';
export const connectionKind=p=>['new','emergency','any'].includes(p.connectionLearningKind)?p.connectionLearningKind:p.workType==='emergency'||/긴급|보수/.test(p.title||'')?'emergency':p.workType==='new'||/신규|급수/.test(p.title||'')?'new':'any';
export const groupFamily=g=>norm(g).replace(/^\d+/,'').replace(/토공.*/,'토공').replace(/포장.*/,'포장공').replace(/배관|관로/,'배관').replace(/관급자재대|관급자재/,'관급').replace(/자재대|재료비|재료대/,'자재').replace(/폐기물처리비/,'폐기물');
export const specIdentity=specNorm;
export const itemCategory=r=>r.category&&r.category!=='내역단가'?r.category:({U:'일위대가',D:'단가산출',M:'자재',L:'노임',E:'장비'})[r.code?.[0]]||'';
export const sourceIdentity=(s,kind='any')=>[kind,groupFamily(s.group),nameNorm(s.name),specIdentity(s.spec),unitNorm(s.unit)].join('|');
// Quantity-sheet unit typos must not select a different learned work item.
const sourceWorkIdentity=(s,kind)=>[kind,groupFamily(s.group),nameNorm(s.name),specIdentity(s.spec)].join('|');
const sourceNameIdentity=(s,kind)=>[kind,groupFamily(s.group),nameNorm(s.name)].join('|');
export const targetIdentity=r=>[nameNorm(r.name),specIdentity(r.spec),unitNorm(r.unit),itemCategory(r)].join('|');
export const targetDescriptor=r=>({name:r.name,spec:r.spec||'',unit:r.unit||'',category:itemCategory(r)});
let active=bundledConnections,revision=0,compiled=null;
export const getActiveLearning=()=>active;
export function validateLearning(value){
 if(!value||value.schema!==1||value.type!=='gongsa-connections'||!Array.isArray(value.rules)||value.rules.length>20000)throw Error('공사노트 연결 학습 파일이 아닙니다.');
 const copy=structuredClone(value);
 for(const r of copy.rules){if(!['new','emergency','any'].includes(r.kind)||!r.source||!r.target||!['name','spec','unit'].every(k=>typeof r.source[k]==='string'&&typeof r.target[k]==='string')||typeof r.source.group!=='string'||!r.target.name||![r.support,r.total,r.projectCount].every(n=>Number.isInteger(n)&&n>=1)||r.support>r.total||r.projectCount>r.support)throw Error('연결 학습 항목의 형식을 확인하세요.');}
 return copy;
}
export function setActiveLearning(value){active=validateLearning(value);revision++;compiled=null;return active;}
export function learningIndex(profile=active){
 if(profile===active&&compiled?.revision===revision)return compiled;
 const exact=new Map(),names=new Map();
 for(const r of profile.rules||[]){const k=sourceWorkIdentity(r.source,r.kind),name=sourceNameIdentity(r.source,r.kind);exact.set(k,[...(exact.get(k)||[]),r]);names.set(name,[...(names.get(name)||[]),r]);}
 const result={exact,names,revision};if(profile===active)compiled=result;return result;
}
export function learnedChoices(line,kind,index){
 let rules=index.exact.get(sourceWorkIdentity(line,kind))||index.exact.get(sourceWorkIdentity(line,'any'))||[],exact=!!rules.length;
 if(!rules.length)rules=index.names.get(sourceNameIdentity(line,kind))||index.names.get(sourceNameIdentity(line,'any'))||[];
 return rules.map(r=>({rule:r,identity:targetIdentity(r.target),exact,confidence:r.support/r.total,strong:exact&&(r.userConfirmed||r.projectCount>=2&&r.support/r.total>=.85),bonus:exact?(r.userConfirmed?250:110*(r.support/r.total)+Math.min(r.projectCount,20)):Math.max(0,35+compareSpecs(line.spec,r.source.spec).score)*.025}));
}
export function rememberConnection(profile,source,target,kind){
 const p=validateLearning(profile),key=sourceIdentity(source,kind);
 p.rules=p.rules.filter(r=>!(r.userConfirmed&&sourceIdentity(r.source,r.kind)===key));
 p.rules.push({kind,source:{name:source.name,spec:source.spec||'',unit:source.unit||'',group:source.group||''},target:targetDescriptor(target),targetSource:target.source||'',support:1,total:1,projectCount:1,userConfirmed:true,updatedAt:new Date().toISOString()});
 p.updatedAt=new Date().toISOString();return p;
}
