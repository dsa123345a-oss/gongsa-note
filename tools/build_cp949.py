from pathlib import Path
import json
rows = []
for lead in range(0x81, 0xff):
    chars = []
    for trail in range(0x41, 0xff):
        try:
            char = bytes([lead, trail]).decode('cp949')
        except UnicodeDecodeError:
            char = '\0'
        chars.append(char)
    rows.append(''.join(chars))
text = '''// Generated from Python's CP949 codec by tools/build_cp949.py.
// A fixed map avoids platform-dependent TextDecoder('euc-kr') Hangul loss.
const rows = ''' + json.dumps(rows, ensure_ascii=False) + ''';
export function decodeCp949(bytes){
 let text='';
 for(let i=0;i<bytes.length;i++){
  const first=bytes[i];
  if(first<128){text+=String.fromCharCode(first);continue;}
  const second=bytes[i+1],char=first>=0x81&&first<=0xfe&&second>=0x41&&second<=0xfe?rows[first-0x81][second-0x41]:null;
  if(char&&char!=='\\0'){text+=char;i++;}else text+='\\ufffd';
 }
 return text;
}
'''
(Path(__file__).resolve().parents[1] / 'dist/cp949.js').write_text(text, encoding='utf-8')
