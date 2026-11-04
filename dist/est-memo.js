import {decodeCp949} from './cp949.js';

// Observed DBISAM text-memo layout, verified against both bundled EST archives.
// The DAT value is a block number plus its allocation identifier. Never scan
// the BLB for plausible text: an unrelated/deleted block can contain valid text.
export function readEstMemo(blob,block,allocation){
 if(!(blob instanceof Uint8Array)||blob.length<512||blob.length%512)throw Error('메모 파일이 없거나 구조가 올바르지 않습니다.');
 const at=block*512;
 if(!Number.isInteger(block)||block<1||at+512>blob.length)throw Error('메모 블록 위치가 범위를 벗어났습니다.');
 const v=new DataView(blob.buffer,blob.byteOffset,blob.byteLength),length=v.getUint16(at+8,true),total=v.getUint32(at+14,true);
 if(v.getUint32(at+10,true)!==allocation)throw Error('메모 블록 식별자가 일치하지 않습니다.');
 // No multi-block text memo occurs in the verified source corpus. Keep those
 // explicit as unsupported instead of guessing the linked-block convention.
 if(v.getUint32(at,true)||v.getUint32(at+4,true)||length>494||length!==total)throw Error('검증되지 않은 다중 블록 메모입니다.');
 const value=decodeCp949(blob.subarray(at+18,at+18+length));
 // EST also stores formula control markers (for example 0x12) in some Bigo
 // strings. Preserve them here, just as LineData does; renderers handle them.
 if(/[\u0000\ufffd]/u.test(value))throw Error('지원하지 않는 메모 문자 형식입니다.');
 return value;
}

// Keep fixed Remark and Bigo distinct in storage; combine only for display.
// Explicit empty snapshot values take precedence over a library fallback.
export function estRemarkText(value={},raw=null){
 const values=[value.remark??value.Remark??raw?.Remark,value.bigo??value.Bigo??raw?.Bigo,value.rowBigo];
 const seen=new Set();return values.filter(v=>typeof v==='string'&&v.trim()).filter(v=>{const key=v.trim();if(seen.has(key))return false;seen.add(key);return true;}).join('\n');
}
