import test from 'node:test';
import assert from 'node:assert/strict';
import {sectionCaption,workbookFileName,pdfFileName,renameProject,normalizeSectionTitles,emergencyBundleTitle} from '../dist/project-labels.js';
import {addSeparateCost,setSeparateUnitPrice} from '../dist/estimate-footer.js';
import {costSheet} from '../dist/cost-sheet.js';
import {printExcelSheets} from '../dist/print-excel.js';
import {defaultCharges,totals} from '../dist/calc.js';
const project=()=>({schema:1,title:'상수도긴급보수공사',lines:[{id:'h',level:2,headingScope:'direct',name:'상수도긴급보수공사(1공구 후포면 검증길 1-2 급수관 보수)',spec:'',unit:'',group:'',bucket:'direct',status:'unmatched'},{id:'a',name:'터파기',spec:'백호',unit:'㎥',group:'토공',bucket:'direct',qty:1,status:'confirmed',rate:{labor:300000,material:100000,expense:200000,other:0,total:600000}}],charges:defaultCharges()});
test('묶음 제목을 L2에 중복하지 않고 공구 현장의 괄호를 유지한다',()=>{
 const title='상수도긴급보수공사(후포면 첫 현장 등)',name=title+'(2공구 평해읍 현장(야간) 보수)';
 const p=project();p.lines[0]={...p.lines[0],name,autoHeading:'section',sectionNumber:2};const before=totals(p.lines,p.charges);
 const next=normalizeSectionTitles(structuredClone(p));assert.equal(next.lines[0].name,'2공구 평해읍 현장(야간) 보수');assert.equal(next.lines[0].originalHeading,name);
 assert.equal(sectionCaption(next.lines[0]),'평해읍 현장(야간) 보수');assert.deepEqual(totals(next.lines,next.charges),before);
 assert.deepEqual(normalizeSectionTitles(structuredClone(next)),next);
 assert.equal(emergencyBundleTitle('상수도긴급보수공사','후포면 첫 현장'),title);
 assert.equal(emergencyBundleTitle(title,'다른 현장'),title);
});
test('공구 이름은 공통 접두어만 제거하고 원본·고유 괄호·실제 규격을 보존한다',()=>{
 const p=project();assert.equal(sectionCaption(p.lines[0]),'후포면 검증길 1-2 급수관 보수');
 assert.equal(sectionCaption({name:'평해읍 검증길 3-4',spec:'급수관 보수'}),'평해읍 검증길 3-4 급수관 보수');
 assert.equal(sectionCaption({name:'특수 공사(야간)'}),'특수 공사(야간)');
 assert.equal(sectionCaption({name:'상수도 긴급 보수공사(12공구 시험 현장)'}),'시험 현장');
 const renamed=renameProject(p,'수정 공사명');assert.equal(renamed.title,'수정 공사명');assert.equal(renamed.lines[0].name,p.lines[0].name);
 assert.equal(workbookFileName(renamed.title),'수정 공사명(내역서).xlsx');assert.equal(workbookFileName('A/B:공사'),'A_B_공사(내역서).xlsx');
 assert.equal(pdfFileName(renamed.title),'수정 공사명(내역서).pdf');assert.equal(pdfFileName('A/B:공사'),'A_B_공사(내역서).pdf');
});
test('내역에 없는 수수료·원인자부담금 행을 만들지 않고 존재하는 항목만 한 줄씩 표시한다',()=>{
 let p=project();for(const id of ['fees','waste','government'])assert.equal(costSheet(p).rows.some(r=>r.id===id),false);
 for(const name of ['수수료','원인자부담금']){const a=addSeparateCost(p,name);p=a.project;p.lines=p.lines.map(l=>l.id===a.line.id?setSeparateUnitPrice(l,100):l);}
 const rows=costSheet(p).rows;assert.equal(rows.filter(r=>r.name==='수수료').length,1);assert.equal(rows.filter(r=>r.name==='원인자부담금').length,1);assert.equal(rows.some(r=>r.name==='수수료·부담금 소계'),false);
 assert.equal(rows.find(r=>r.id==='grand').amount,totals(p.lines,p.charges).grand);
 p.lines=p.lines.filter(l=>l.name!=='수수료');assert.equal(costSheet(p).rows.some(r=>r.name==='수수료'),false);
});
test('EST 양식의 공구 번호 크기를 유지하고 공구명 C:F 병합 및 공사명 인쇄 머리글을 출력한다',()=>{
 const p=renameProject(project(),'상수도 긴급보수공사(삼율리 등)'),r=printExcelSheets(p,[],{sections:['summary','estimate']});
 for(const sheet of r.sheets)assert.ok(sheet.print.headerText.includes(p.title));
 const detail=r.sheets[1],idx=detail.rows.findIndex(row=>row.values[1]==='1공구');
 assert.equal(idx,4);assert.equal(detail.rows[idx].values[2],'후포면 검증길 1-2 급수관 보수');assert.ok(detail.merges.includes('C5:F5'));
 const row=detail.pages[0].grid.rows.find(row=>row.cells[0]?.value==='1공구');assert.ok(Math.abs(row.cells[0].fontSize-9*.85)<.001);assert.equal(row.cells[0].fit,false);assert.equal(row.cells[1].span,4);assert.equal(row.cells[1].readable,true);
 assert.ok(detail.columns[1].width>4);assert.equal(p.lines[0].name,project().lines[0].name);
});
test('긴 공구명을 극소 글자로 줄이지 않고 읽을 수 있는 크기와 행 높이를 확보한다',()=>{
 const p=project();p.lines[0].name='상수도긴급보수공사(1공구 '+('상세 현장 주소 '.repeat(8))+')';const result=printExcelSheets(p,[],{sections:['estimate']});
 const row=result.pages[0].grid.rows.find(r=>r.cells[0]?.value==='1공구');assert.ok(row.height>19.7*.85*.967);assert.ok(Math.abs(row.cells[1].fontSize-9*.85)<.001);assert.ok(row.cells[1].lines.length>1);
});

test('금액이 0원인 별도 내역은 표시하고 제외하거나 삭제한 항목은 원가계산서에서 없어진다',()=>{
 let p=project();for(const name of ['폐기물처리비','관급자재대','수수료','원인자부담금'])p=addSeparateCost(p,name).project;
 for(const name of ['폐기물처리비','관급자재대','수수료','원인자부담금'])assert.equal(costSheet(p).rows.find(r=>r.name===name).amount,0);
 p.lines=p.lines.map(l=>({...l,exclude:l.name==='관급자재대'}));assert.equal(costSheet(p).rows.some(r=>r.name==='관급자재대'),false);
});
