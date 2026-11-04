import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import {fileURLToPath} from 'node:url';
import {importEst} from '../../dist/est.js';
const directory=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(directory,'../..');
const release=JSON.parse(fs.readFileSync(path.join(root,'release.json'),'utf8')),entries=[],seen=new Set();
for(const config of [...release.defaultDatabases].sort((a,b)=>Number(b.role==='assembly')-Number(a.role==='assembly'))){
 const raw=fs.readFileSync(path.join(root,'seed',config.name));
 if(crypto.createHash('sha256').update(raw).digest('hex')!==config.sha256)throw Error('DB hash mismatch');
 const lib=await importEst(raw,config.name),canonical=new Map();
 for(const item of [...lib.items].sort((a,b)=>Number(b.table==='EstMainDat')-Number(a.table==='EstMainDat'))){
  const key=JSON.stringify([item.code,item.name,item.spec,String(item.unit||'').normalize('NFKC').replace(/\s|당/g,'').toLowerCase()]);
  if(!canonical.has(key))canonical.set(key,item);
 }
 for(const item of canonical.values()){
  if(!/^[MUD]/.test(item.code||'')||!item.name)continue;
  const data={source:config.name,role:config.role,code:item.code,name:item.name,spec:item.spec||'',unit:item.unit||'',kind:item.code.startsWith('M')?'material':'work'};
  const key=JSON.stringify(data);if(seen.has(key))continue;seen.add(key);
  entries.push({id:crypto.createHash('sha256').update(key).digest('hex').slice(0,24),...data});
 }
}
fs.writeFileSync(path.join(directory,'quantity_db_catalog.json'),JSON.stringify({schema:1,version:'2026.11.02.1',databases:release.defaultDatabases,items:entries}));
console.log(entries.length+' identities; no prices.');
