// Explicit setup only. Agent Cut's generation/status paths never download files.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createWriteStream,createReadStream} from 'node:fs';
import {Readable,Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {createHash} from 'node:crypto';
import {parseArgs} from 'node:util';
const manifest=JSON.parse(await fs.readFile(new URL('../voxcpm-models.json',import.meta.url),'utf8'));
const {values}=parseArgs({options:{directory:{type:'string'},download:{type:'boolean',default:false},help:{type:'boolean',default:false}},strict:true});
if(values.help){console.log('node scripts/setup-voxcpm-models.mjs --directory /absolute/model/folder [--download]\nWithout --download: print the pinned download plan only.');process.exit(0);}
if(!values.directory||!path.isAbsolute(values.directory)||values.directory.startsWith('\\\\')||values.directory.startsWith('//'))throw Error('Supply an absolute local --directory.');
const plan=Object.values(manifest.files).map(f=>({...f,url:`https://huggingface.co/${manifest.repository}/resolve/${manifest.revision}/${f.name}`,path:path.join(values.directory,f.name)}));
if(!values.download){console.log(JSON.stringify({download:false,totalBytes:plan.reduce((n,f)=>n+f.size,0),files:plan},null,2));process.exit(0);}
await fs.mkdir(values.directory,{recursive:true});
async function hash(file){const h=createHash('sha256');for await(const bytes of createReadStream(file))h.update(bytes);return h.digest('hex');}
for(const f of plan){
 const exists=await fs.stat(f.path).catch(()=>null);
 if(exists){if(exists.size!==f.size||await hash(f.path)!==f.sha256)throw Error('Existing model does not match the pinned checksum: '+f.path);console.log('Already verified: '+f.name);continue;}
 const partial=f.path+'.partial';if(await fs.lstat(partial).catch(()=>null))throw Error('An interrupted .partial file exists. Review/remove that incomplete file before retrying: '+partial);
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),600000);let count=0,last=Date.now();const digest=createHash('sha256');
 try{
  const response=await fetch(f.url,{signal:controller.signal});if(!response.ok||!response.body)throw Error('Model download HTTP '+response.status);
  const meter=new Transform({transform(chunk,encoding,callback){count+=chunk.length;if(count>f.size){callback(Error('Model download exceeds the pinned size.'));return;}digest.update(chunk);if(Date.now()-last>15000){console.log(f.name+': '+(count/f.size*100).toFixed(1)+'%');last=Date.now();}callback(null,chunk);}});
  await pipeline(Readable.fromWeb(response.body),meter,createWriteStream(partial,{flags:'wx'}),{signal:controller.signal});
  if(count!==f.size||digest.digest('hex')!==f.sha256)throw Error('Model checksum failed. Incomplete file retained for inspection.');
  await fs.rename(partial,f.path);console.log('Verified: '+f.name);
 }finally{clearTimeout(timer);}
}
await fs.writeFile(path.join(values.directory,'agent-cut-model-receipt.json'),JSON.stringify({repository:manifest.repository,revision:manifest.revision,files:manifest.files,verifiedAt:new Date().toISOString()},null,2));
console.log('Models ready. Configure the local runtime through story_sync tts_configure; no story has changed.');
