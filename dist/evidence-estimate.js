import {exportEstimate} from './workbook.js';
import {buildPriceEvidence} from './price-evidence-workbook.js';
import {writeTemplateWorkbook} from './template-workbook.js';
import {synchronizeLinkedCosts} from './calc.js';
import {manualCalculation} from './calculation-modes.js';
import {rateIdentity} from './project-data.js';
// Internal workbook only. The contractor export keeps its original three sheets.
export function evidenceEstimateSheets(input,libraries=[]){
 const project=synchronizeLinkedCosts(input),evidence=buildPriceEvidence(project,libraries),base=exportEstimate(project,{sheets:true}),ids=evidence.styleIds;
 const lines=project.lines.filter(l=>!l.exclude);
 for(const [i,line] of lines.entries()){
  const linked=evidence.lineRefs.get(line.id);if(!linked||manualCalculation(line)||line.generatedProcurement?.auto)continue;
  for(const [j,key] of ['labor','material','expense','other'].entries())base[0].rows[i+3][6+j]={formula:linked.refs[j],value:line.rate[key]||0};
  base[0].rows[i+3][12]+=' | '+linked.sheet+' '+linked.id;
 }
 for(const [i,entry] of (project.evidence||[]).entries()){
  const line=lines.find(l=>l.rate&&rateIdentity(l.rate)===rateIdentity(entry.rate)),linked=line&&evidence.lineRefs.get(line.id);if(!linked)continue;
  for(const [j,key] of ['labor','material','expense','other'].entries())base[3].rows[i+3][4+j]={formula:linked.refs[j],value:entry.rate[key]||0};
  base[3].rows[i+3][8]={formula:`SUM(E${i+4}:H${i+4})`,value:entry.rate.total};
 }
 base[4].rows[1]=['확인','저장 당시의 근거 기록입니다. 수정·재계산은 일위단가표·기계경비단가산출표·자재단가표·노임단가표에서 확인하세요.'];
 const sheets=base.map(s=>({name:s.name,columns:s.widths.map((width,column)=>({width,column})),rows:s.rows.map((values,index)=>({values,height:index===0?30:28,styles:values.map(v=>index===0||index===2?ids.header:typeof v==='number'||v?.formula?ids.number:ids.text)})),merges:[],printArea:[0,1,0,0,0,s.widths.length],printTitles:[0,1,2,3],showGridLines:false,showZeros:true,print:{...evidence.sheets[0].print,paperSize:8}}));
 sheets.push(...evidence.sheets);return {sheets,styles:evidence.styles,evidence,project};
}
export function exportEvidenceEstimate(project,libraries=[]){const b=evidenceEstimateSheets(project,libraries);return writeTemplateWorkbook(b.sheets,b.styles);}
