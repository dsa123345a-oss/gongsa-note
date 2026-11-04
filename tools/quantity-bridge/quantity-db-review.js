/* Shared by the two generators. Only explicit choices are sent back. */
window.reviewQuantityDb = function(review) {
  return new Promise(resolve => {
    const dlg = document.createElement('dialog');
    dlg.setAttribute('aria-label', '단가 DB 품목 확인');
    dlg.style.cssText = 'width:min(1050px,94vw);max-height:90vh;padding:22px;border:1px solid #8898a7;border-radius:8px;background:#fff;color:#172637;font:14px "맑은 고딕",sans-serif;box-shadow:0 16px 60px #0005';
    const el = (tag, text, parent=dlg) => { const e=document.createElement(tag); if(text!==undefined)e.textContent=text; parent.append(e); return e; };
    el('h2','단가 DB 품목 확인').style.cssText='font-size:19px;margin:0 0 12px';
    el('p',`정확히 일치한 ${review.matched}개는 연결했습니다. 아래 항목은 규격·시공방법을 확인해 선택하세요. 추가 DB에 없으면 10월 메인에서 선택할 수 있습니다.`);
    el('p','수량과 계산식은 유지됩니다. DB 단위를 적용할 때 수량도 맞는지 확인하세요. 선택하지 않은 항목은 공사노트에서 확인 대상으로 표시됩니다.').style.color='#744c12';
    const body=el('div');body.style.cssText='overflow:auto;max-height:58vh;border-top:1px solid #d3dbe2';
    const controls=[];
    for(const row of review.rows){
      const box=el('section',undefined,body);box.style.cssText='padding:13px 0;border-bottom:1px solid #d3dbe2';
      el('strong',`${row.original.name} · ${row.original.spec||'규격 없음'} · ${row.original.unit}`,box);
      el('div',row.group,box).style.cssText='color:#526172;margin:4px 0 7px';
      const select=el('select',undefined,box);select.style.cssText='width:100%;padding:8px;background:#fff;color:#172637;border:1px solid #a8b6c2;font:inherit';
      const keep=el('option','원래 입력 유지 — 공사노트에서 직접 확인',select);keep.value='keep';
      for(const item of row.candidates){
        const opt=el('option',`${item.role==='assembly'?'추가 DB':'10월 메인'} | ${item.name} | ${item.spec||'규격 없음'} | ${item.unit} | ${item.code}`,select);opt.value=item.id;
      }
      controls.push({row,select});
    }
    const foot=el('div');foot.style.cssText='display:flex;justify-content:flex-end;gap:8px;margin-top:16px';
    const finish=value=>{dlg.close();dlg.remove();resolve(value);};
    const cancel=el('button','입력으로 돌아가기',foot),apply=el('button','확인 후 파일 생성',foot);
    for(const b of [cancel,apply]){b.type='button';b.style.cssText='padding:9px 16px;border:1px solid #94a3b1;border-radius:4px;background:#f5f7fa;color:#172637;font:inherit;cursor:pointer';}
    apply.style.background='#204f75';apply.style.color='#fff';
    cancel.onclick=()=>finish(null);
    apply.onclick=()=>finish(Object.fromEntries(controls.map(({row,select})=>[row.key,{signature:row.signature,id:select.value,confirmUnit:true}])));
    dlg.addEventListener('cancel',e=>{e.preventDefault();finish(null);});
    document.body.append(dlg);dlg.showModal();cancel.focus();
  });
};
