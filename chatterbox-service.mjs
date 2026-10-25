import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID,createHash} from 'node:crypto';
import {atomic,run,probe,EditError,canonical} from './engine.mjs';
const ROOT=path.dirname(fileURLToPath(import.meta.url));
const worker=path.join(ROOT,'chatterbox-worker.py');
const fail=(code,message)=>{throw new EditError(code,message);};
const safe=id=>{if(typeof id!=='string'||! /^[a-f0-9-]{36}$/.test(id))fail('INVALID_VOICE','Select an imported voice reference.');return id;};
const modelFiles=model=>['ve.safetensors',model==='nano'?'t3_nano_v1.safetensors':'t3_turbo_v1.safetensors','s3gen_meanflow.safetensors','conds.pt','merges.txt','vocab.json','tokenizer_config.json','special_tokens_map.json','added_tokens.json'];
async function local(file,directory=false){
 if(typeof file!=='string'||!path.isAbsolute(file)||file.startsWith('\\\\')||file.startsWith('//'))fail('CHATTERBOX_PATH','Choose an absolute local disk path.');
 const resolved=await fs.realpath(file).catch(()=>null);if(!resolved||resolved.startsWith('\\\\')||resolved.startsWith('//'))fail('CHATTERBOX_PATH','Local runtime/model path is missing or unsupported.');
 const stat=await fs.stat(resolved);if(directory?!stat.isDirectory():!stat.isFile())fail('CHATTERBOX_PATH','Expected a local '+(directory?'directory.':'file.'));return resolved;
}
async function fingerprints(files){const result=[];for(const file of files){const st=await fs.stat(file);if(!st.isFile())fail('CHATTERBOX_FILES','Missing required local model/runtime file.');result.push({file,size:st.size,mtimeMs:st.mtimeMs});}return result;}
export class ChatterboxService {
 constructor(store){this.store=store;this.root=path.join(store.root,'stories','voices');this.file=path.join(store.root,'chatterbox.local.json');}
 async defaults(){
  for(const root of [path.resolve(ROOT,'../agent-cut-runtime/chatterbox'),path.resolve(ROOT,'../../agent-cut-runtime/chatterbox')]){const pythonPath=path.join(root,'.venv',process.platform==='win32'?'Scripts/python.exe':'bin/python'),modelDir=path.join(root,'models','nano');if(await fs.stat(pythonPath).catch(()=>null))return {pythonPath,modelDir,model:'nano',device:'auto',threads:2};}
  return {pythonPath:'',modelDir:'',model:'nano',device:'auto',threads:2};
 }
 async status(){
  let c;try{c=JSON.parse(await fs.readFile(this.file,'utf8'));}catch(e){if(e.code!=='ENOENT')return {ready:false,code:'CHATTERBOX_CONFIG',message:'Local Chatterbox configuration is unreadable.',defaults:await this.defaults()};return {ready:false,code:'NOT_CONFIGURED',message:'Configure an installed local Chatterbox runtime and model.',defaults:await this.defaults()};}
  try{await this.verify(c);return {ready:true,settings:{pythonPath:c.pythonPath,modelDir:c.modelDir,model:c.model,device:c.device,threads:c.threads},runtime:c.runtime,offline:true};}catch(e){return {ready:false,code:e.code||'CHATTERBOX_FILES',message:e.message,defaults:{pythonPath:c.pythonPath,modelDir:c.modelDir,model:c.model,device:c.device,threads:c.threads}};}
 }
 async invoke(pythonPath,request,dir){await fs.mkdir(dir,{recursive:true});const file=path.join(dir,'chatterbox-request.json');await atomic(file,request);const result=await run(pythonPath,['-I',worker,file],{timeout:request.action==='probe'?120000:3600000});const lines=result.out.trim().split(/\r?\n/);try{return JSON.parse(lines.at(-1));}catch{fail('CHATTERBOX_RESPONSE','Local Chatterbox worker returned an invalid response.');}}
 async configure(settings={}){
  if(!settings||Array.isArray(settings)||typeof settings!=='object'||Object.keys(settings).some(k=>!['pythonPath','modelDir','model','device','threads'].includes(k)))fail('CHATTERBOX_CONFIG','Unknown Chatterbox setup field.');
  const c={...await this.defaults(),...settings};if(!['nano','turbo'].includes(c.model)||!['auto','cpu','cuda'].includes(c.device)||!Number.isInteger(c.threads)||c.threads<1||c.threads>4)fail('CHATTERBOX_CONFIG','Choose Nano/Turbo, auto/CPU/CUDA and 1–4 CPU threads.');
  c.pythonPath=await local(c.pythonPath);c.modelDir=await local(c.modelDir,true);
  if(process.platform==='win32'&&path.basename(c.pythonPath).toLowerCase()!=='python.exe'||process.platform!=='win32'&&!/^python(?:3(?:\.\d+)?)?$/.test(path.basename(c.pythonPath)))fail('CHATTERBOX_PATH','Select a Python interpreter.');
  c.fingerprints=await fingerprints([c.pythonPath,worker,...modelFiles(c.model).map(n=>path.join(c.modelDir,n))]);
  const dir=path.join(this.store.root,'stories','setup',randomUUID());c.runtime=await this.invoke(c.pythonPath,{action:'probe'},dir);
  if(c.device==='cuda'&&!c.runtime.cudaAvailable)fail('CHATTERBOX_CUDA','CUDA is not available in this runtime. Choose CPU or install a compatible CUDA build.');
  c.version=1;await atomic(this.file,c);return this.status();
 }
 async verify(c){
  if(c.version!==1||!['nano','turbo'].includes(c.model)||!['cpu','cuda','auto'].includes(c.device)||!Number.isInteger(c.threads)||c.threads<1||c.threads>4||!Array.isArray(c.fingerprints))fail('CHATTERBOX_CONFIG','Reconfigure the local Chatterbox runtime.');
  const expected=[c.pythonPath,worker,...modelFiles(c.model).map(n=>path.join(c.modelDir,n))];
  if(canonical(c.fingerprints)!==canonical(await fingerprints(expected)))fail('CHATTERBOX_CHANGED','Local model/runtime files changed. Reconfigure Chatterbox before generating.');
 }
 async voices(){await fs.mkdir(this.root,{recursive:true});const voices=[{id:'builtin',name:'Chatterbox default voice',language:'en'}];for(const n of (await fs.readdir(this.root)).filter(n=>/^[a-f0-9-]{36}\.json$/.test(n)).slice(-100)){const v=JSON.parse(await fs.readFile(path.join(this.root,n),'utf8'));voices.push({id:v.id,name:v.name,language:'en',duration:v.duration});}return {voices};}
 async importVoice(file,name=path.basename(file)){
  file=await local(file);const stat=await fs.stat(file);if(stat.size>30*1024**2||!['.wav','.mp3','.m4a','.flac','.ogg'].includes(path.extname(file).toLowerCase()))fail('INVALID_VOICE','Choose a local WAV/MP3/M4A/FLAC/OGG smaller than 30 MB.');
  const metadata=await probe(this.store.ffmpeg,file);if(!metadata.hasAudio||metadata.duration<5.1||metadata.duration>30)fail('INVALID_VOICE','Voice references must contain 5.1–30 seconds of clean speech.');
  await fs.mkdir(this.root,{recursive:true});const id=randomUUID(),output=path.join(this.root,id+'.wav');await run(this.store.ffmpeg,['-hide_banner','-nostdin','-y','-protocol_whitelist','file,pipe','-i',file,'-map','0:a:0','-vn','-ac','1','-ar','24000','-c:a','pcm_s16le',output]);
  const bytes=await fs.readFile(output),v={id,name:path.basename(name).slice(0,160),duration:metadata.duration,file:id+'.wav',sha256:createHash('sha256').update(bytes).digest('hex')};await atomic(path.join(this.root,id+'.json'),v);return v;
 }
 async freeze(voice){
  const status=await this.status();if(!status.ready)fail(status.code,status.message);const config=JSON.parse(await fs.readFile(this.file,'utf8'));let reference=null;
  if(voice!=='builtin'){safe(voice);reference=JSON.parse(await fs.readFile(path.join(this.root,voice+'.json'),'utf8'));reference.path=path.join(this.root,voice+'.wav');await this.verifyReference(reference);}
  return {config,reference};
 }
 async verifyReference(reference){if(reference&&createHash('sha256').update(await fs.readFile(reference.path)).digest('hex')!==reference.sha256)fail('VOICE_CHANGED','Voice reference changed. Import it again before generating.');}
 async generate(frozen,chunks,dir,job){
  await this.verify(frozen.config);await this.verifyReference(frozen.reference);const c=frozen.config;
  const timer=setInterval(()=>{void fs.readFile(path.join(dir,'speech-progress.json'),'utf8').then(s=>{const p=JSON.parse(s);if(Number.isInteger(p.completed)&&p.completed>=0&&p.completed<=chunks.length&&p.total===chunks.length){job.speechCompleted=p.completed;job.speechTotal=p.total;job.device=p.device;job.progress=Math.max(job.progress,Math.min(90,Math.round(p.completed/p.total*90)));}}).catch(()=>{});},750);
  try{return await this.invoke(c.pythonPath,{action:'generate',modelDir:c.modelDir,model:c.model,device:c.device,threads:c.threads,chunks,outputDir:dir,referencePath:frozen.reference?.path??null},dir);}finally{clearInterval(timer);}
 }
}
