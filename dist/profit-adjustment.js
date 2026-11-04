// Recover the original profit limit without retaining stale target links.
export function originalProfitCharge(charge){
 let c=structuredClone(charge);
 for(let depth=0;depth<32;depth++){
  const prior=c.link?.type==='target'?c.link.maximum:c.adjustment?.original;
  if(!prior){delete c.adjustment;if(c.link?.type==='target')delete c.link;return c;}
  c=structuredClone(prior);
 }
 throw Error('이윤 역산 이력이 너무 깊습니다. 이윤 요율을 다시 설정하세요.');
}
