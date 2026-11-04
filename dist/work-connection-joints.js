// Physical joint identities belong to the whole estimate, not an import file.
export function workConnectionJoints(value){
 if(value===undefined)return [];
 if(!Array.isArray(value))throw Error('접합부 연결정보 형식이 올바르지 않습니다. 수량산출서를 다시 생성하세요.');
 const ids=new Set();
 return value.map(j=>{
  if(!j||typeof j!=='object'||Array.isArray(j)||typeof j.id!=='string'||!j.id.trim()||!Number.isFinite(j.diameter)||j.diameter<=0)throw Error('접합부 번호·관경 연결정보가 손상되었습니다. 수량산출서를 다시 생성하세요.');
  const id=j.id.trim();
  if(ids.has(id))throw Error(`접합부 ${id}의 연결정보가 중복되었습니다. 수량산출서를 다시 생성하세요.`);
  ids.add(id);return {id,diameter:j.diameter};
 });
}
export function reserveWorkConnectionJoints(owners){
 const ledger=new Map();
 for(const owner of owners){
  const label=String(owner.label||'기존 내역');
  for(const joint of workConnectionJoints(owner.joints)){
   const prior=ledger.get(joint.id);
   if(prior)throw Error(`접합부 ${joint.id}가 ${prior.label}와 ${label}에 중복되어 있습니다. 같은 접합부는 전체 내역에서 한 번만 계상하도록 원본 조건을 수정하세요.`);
   ledger.set(joint.id,{...joint,label});
  }
 }
 return ledger;
}
