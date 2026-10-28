import fs from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {atomic,run,probe,EditError,canonical} from './engine.mjs';
import {checkJob} from './job-context.mjs';

export const VOXCPM_MODELS=JSON.parse(await fs.readFile(new URL('./voxcpm-models.json',import.meta.url),'utf8')).files;
const fail=(code,message)=>{throw new EditError(code,message);};
async function disk(file){
 if(typeof file!=='string'||!path.isAbsolute(file)||file.startsWith('\\\\')||file.startsWith('//'))fail('VOXCPM_PATH','Choose an absolute local file path.');
 const real=await fs.realpath(file).catch(()=>null);if(!real||real.startsWith('\\\\')||real.startsWith('//')||!(await fs.stat(real)).isFile())fail('VOXCPM_PATH','Local runtime, model or reference file is missing.');return real;
}
export async function sha256(file){const hash=createHash('sha256');for await(const bytes of createReadStream(file)){checkJob();hash.update(bytes);}return hash.digest('hex');}
async function fingerprints(files){return Promise.all(files.map(async file=>{const s=await fs.stat(file);if(!s.isFile())fail('VOXCPM_CHANGED','A configured file is no longer a regular file.');return {file,size:s.size,mtimeMs:s.mtimeMs,ctimeMs:s.ctimeMs};}));}
export function voxcpmArgs(c,text,output,reference){
 if(c.backend==='voxgen')return ['--base-lm',c.baseModelPath,'--acoustic',c.acousticModelPath,'--mode','normal','--max-context','512','--text',text,...(reference?['--reference-wav',reference]:[]),'--output-wav',output,'--cfm-steps','10','--cfm-cfg','2.0','--seed','42','--max-steps',String(c.maxSteps),'--variations','1','--stream','off'];
 return ['--cpu','-t',text,'-o',output,...(reference?['-r',reference]:[]),'--steps',String(c.maxSteps),'--timesteps','10','--cfg','2.0','--seed','42',c.baseModelPath,c.acousticModelPath];
}
export function validateVoxChunks(chunks){
 if(!Array.isArray(chunks)||!chunks.length||chunks.length>20)fail('VOXCPM_LIMIT','VoxCPM2 supports 1–20 sentences per bounded job. Split longer stories.');
 for(const c of chunks)if(typeof c.text!=='string'||!c.text.trim()||c.text.length>240||c.text.trim().split(/\s+/u).length>35||/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/u.test(c.text))fail('VOXCPM_LIMIT','Keep each VoxCPM2 sentence within 240 characters and 35 words.');
}
export function inspectVoxWav(bytes,maxSteps){
 if(bytes.toString('ascii',0,4)!=='RIFF'||bytes.toString('ascii',8,12)!=='WAVE')fail('VOXCPM_AUDIO','Runtime did not return a WAV file.');
 let format,channels,rate,bits,data=null;
 for(let n=12;n+8<=bytes.length;){const size=bytes.readUInt32LE(n+4),start=n+8;if(start+size>bytes.length)fail('VOXCPM_AUDIO','Truncated runtime WAV.');const kind=bytes.toString('ascii',n,n+4);
  if(kind==='fmt '&&size>=16){format=bytes.readUInt16LE(start);channels=bytes.readUInt16LE(start+2);rate=bytes.readUInt32LE(start+4);bits=bytes.readUInt16LE(start+14);if(format===65534&&size>=40)format=bytes.readUInt16LE(start+24);}
  if(kind==='data')data=bytes.subarray(start,start+size);n=start+size+(size%2);
 }
 if(channels!==1||rate!==48000||!data||!((format===1&&bits===16)||(format===3&&bits===32))||data.length%(bits/8))fail('VOXCPM_AUDIO','Expected mono 48 kHz PCM16 or float32 WAV.');
 const duration=data.length/(rate*bits/8);if(duration<.1||duration>=maxSteps*.16-.001)fail('VOXCPM_TRUNCATED','Generated speech is empty or reached the decode limit; review the text instead of accepting truncated audio.');
 let peak=0;for(let n=0;n<data.length;n+=bits/8){const value=format===1?data.readInt16LE(n)/32768:data.readFloatLE(n);if(!Number.isFinite(value))fail('VOXCPM_AUDIO','Generated audio contains invalid samples.');peak=Math.max(peak,Math.abs(value));}
 if(peak<.0001||peak>10)fail('VOXCPM_AUDIO','Generated audio is silent or invalid.');return {duration,sampleRate:rate,peak};
}
export class VoxCPMService {
 constructor(store,{models=VOXCPM_MODELS,command=run}={}){this.store=store;this.models=models;this.command=command;this.file=path.join(store.root,'voxcpm.local.json');this.root=path.join(store.root,'stories','voxcpm-voices');}
 defaults(){return {backend:'llama.cpp-omni',runnerPath:'',baseModelPath:'',acousticModelPath:'',sentenceTimeoutSeconds:180,jobTimeoutSeconds:600,maxSteps:80};}
 validateSettings(c){if(!['voxgen','llama.cpp-omni'].includes(c.backend)||!Number.isInteger(c.maxSteps)||c.maxSteps<30||c.maxSteps>120||!Number.isInteger(c.sentenceTimeoutSeconds)||c.sentenceTimeoutSeconds<15||c.sentenceTimeoutSeconds>600||!Number.isInteger(c.jobTimeoutSeconds)||c.jobTimeoutSeconds<30||c.jobTimeoutSeconds>1200||c.sentenceTimeoutSeconds>c.jobTimeoutSeconds)fail('VOXCPM_CONFIG','Choose a supported backend, 30–120 decode steps, 15–600 seconds per sentence and 30–1200 seconds per job.');}
 async status(){try{const c=JSON.parse(await fs.readFile(this.file,'utf8'));await this.verify(c);return {ready:true,engine:'voxcpm2',settings:this.settings(c),offline:true,license:'Apache-2.0',hardware:process.arch,warning:'Experimental. CPU/ARM performance must be measured on the target machine; desktop GPU listening tests do not validate it.'};}catch(e){return {ready:false,engine:'voxcpm2',code:e.code==='ENOENT'?'NOT_CONFIGURED':e.code||'VOXCPM_CONFIG',message:e.code==='ENOENT'?'Configure an installed VoxCPM2 runner and verified local GGUF models.':e.message,defaults:this.defaults()};}}
 settings(c){return Object.fromEntries(Object.keys(this.defaults()).map(k=>[k,c[k]]));}
 async configure(settings={}){
  if(!settings||Array.isArray(settings)||typeof settings!=='object'||Object.keys(settings).some(k=>!Object.hasOwn(this.defaults(),k)))fail('VOXCPM_CONFIG','Unknown VoxCPM2 setup field.');
  const c={...this.defaults(),...settings};
  this.validateSettings(c);
  for(const k of ['runnerPath','baseModelPath','acousticModelPath'])c[k]=await disk(c[k]);
  if(c.backend==='voxgen'&&process.arch==='arm64')fail('VOXCPM_BACKEND','VoxGen is a GPU runtime. Use llama.cpp-omni CPU on Oracle Ampere.');
  if(!new RegExp(c.backend==='voxgen'?'^voxgen(?:\\.exe)?$':'^voxcpm2-cli(?:\\.exe)?$','i').test(path.basename(c.runnerPath)))fail('VOXCPM_PATH','Select voxgen or voxcpm2-cli for the chosen backend.');
  for(const [type,key]of [['base','baseModelPath'],['acoustic','acousticModelPath']]){const s=await fs.stat(c[key]),m=this.models[type];if(s.size!==m.size||await sha256(c[key])!==m.sha256)fail('VOXCPM_MODEL','VoxCPM2 model bytes do not match the pinned Q8_0/F16 conversion. See voxcpm-local.md.');}
  // The pinned llama.cpp-omni CLI deliberately exits 1 after printing help.
  const help=await this.command(c.runnerPath,['--help'],{timeout:15000,allowedExitCodes:c.backend==='llama.cpp-omni'?[0,1]:[0]}),text=help.out+'\n'+help.err;
  if(!text.includes(c.backend==='voxgen'?'--base-lm':'--cpu')||!text.includes(c.backend==='voxgen'?'--reference-wav':'--reference'))fail('VOXCPM_BACKEND','Runner does not advertise the required local VoxCPM2 options.');
  c.version=1;c.runnerSha256=await sha256(c.runnerPath);c.fingerprints=await fingerprints([c.runnerPath,c.baseModelPath,c.acousticModelPath]);await atomic(this.file,c);return this.status();
 }
 async verify(c){
  this.validateSettings(c);
  if(c.version!==1||canonical(c.fingerprints)!==canonical(await fingerprints([c.runnerPath,c.baseModelPath,c.acousticModelPath]))||c.runnerSha256!==await sha256(c.runnerPath))fail('VOXCPM_CHANGED','Configured model or runtime files changed. Reconfigure before generating.');
 }
 async voices(){await fs.mkdir(this.root,{recursive:true});const voices=[{id:'builtin',name:'VoxCPM2 generated voice',language:'tl'}];for(const file of (await fs.readdir(this.root)).filter(n=>/^[a-f0-9-]{36}\.json$/.test(n)).slice(-100)){const v=JSON.parse(await fs.readFile(path.join(this.root,file),'utf8'));voices.push({id:v.id,name:v.name,language:'tl',duration:v.duration});}return {voices,engine:'voxcpm2'};}
 async importVoice(file,name=path.basename(file),start=0,seconds=6){
  file=await disk(file);if((await fs.stat(file)).size>30*1024**2||!['.wav','.mp3','.m4a','.flac','.ogg'].includes(path.extname(file).toLowerCase())||!Number.isFinite(start)||start<0||!Number.isFinite(seconds)||seconds<3||seconds>15)fail('INVALID_VOICE','Choose local audio under 30 MB, with a 3–15 second reference interval.');
  const meta=await probe(this.store.ffmpeg,file);if(!meta.hasAudio||start+seconds>meta.duration+.001)fail('INVALID_VOICE','Reference interval must fit inside the source recording.');
  await fs.mkdir(this.root,{recursive:true});const id=randomUUID(),output=path.join(this.root,id+'.wav');
  await this.command(this.store.ffmpeg,['-hide_banner','-nostdin','-y','-protocol_whitelist','file,pipe','-ss',String(start),'-i',file,'-t',String(seconds),'-map','0:a:0','-vn','-ac','1','-ar','16000','-c:a','pcm_s16le',output]);
  const v={id,name:path.basename(name).slice(0,160),duration:seconds,file:id+'.wav',start,sha256:await sha256(output)};await atomic(path.join(this.root,id+'.json'),v);return v;
 }
 async freeze(voice){
  const c=JSON.parse(await fs.readFile(this.file,'utf8'));await this.verify(c);let reference=null;
  if(voice!=='builtin'){if(typeof voice!=='string'||!/^[a-f0-9-]{36}$/.test(voice))fail('INVALID_VOICE','Select an imported VoxCPM2 reference.');reference=JSON.parse(await fs.readFile(path.join(this.root,voice+'.json'),'utf8'));reference.path=path.join(this.root,voice+'.wav');await this.verifyReference(reference);}
  return {config:c,reference};
 }
 async verifyReference(r){if(r&&await sha256(r.path)!==r.sha256)fail('VOICE_CHANGED','Voice reference changed. Import it again.');}
 async generate(frozen,chunks,dir,job){
  validateVoxChunks(chunks);await this.verify(frozen.config);await this.verifyReference(frozen.reference);await fs.mkdir(dir,{recursive:true});
  const c=frozen.config,start=Date.now();job.speechTotal=chunks.length;job.speechCompleted=0;job.device=c.backend==='voxgen'?'Vulkan GPU':'CPU';
  for(let i=0;i<chunks.length;i++){
   await this.verify(c);await this.verifyReference(frozen.reference);
   checkJob();const remaining=c.jobTimeoutSeconds*1000-(Date.now()-start);if(remaining<=0)fail('VOXCPM_TIMEOUT','VoxCPM2 job time budget reached; no automatic retries.');job.phase=`VoxCPM2 sentence ${i+1}/${chunks.length}`;
   const raw=path.join(dir,`voxcpm-raw-${i}.wav`),part=path.join(dir,`part-${i}.wav`),result=await this.command(c.runnerPath,voxcpmArgs(c,chunks[i].text,raw,frozen.reference?.path),{timeout:Math.min(remaining,c.sentenceTimeoutSeconds*1000)});
   await this.verify(c);await this.verifyReference(frozen.reference);
   if((await fs.stat(raw)).size>5*1024**2)fail('VOXCPM_AUDIO','Runtime output exceeds the bounded sentence size.');
   const audio=inspectVoxWav(await fs.readFile(raw),c.maxSteps);
   if(c.backend==='voxgen'){let report;try{report=JSON.parse(result.out);}catch{fail('VOXCPM_RESPONSE','Invalid VoxGen generation report.');}const r=report.variations?.[0]?.result;if(!r?.stopped_by_predictor||r.generated_patches>=c.maxSteps)fail('VOXCPM_TRUNCATED','VoxCPM2 reached its stop guard; narration was not accepted.');}
   await this.command(this.store.ffmpeg,['-hide_banner','-nostdin','-y','-protocol_whitelist','file,pipe','-i',raw,'-ac','1','-ar','48000','-c:a','pcm_s16le',part],{timeout:30000});
   job.speechCompleted=i+1;job.progress=Math.round((i+1)/chunks.length*90);await atomic(path.join(dir,`voxcpm-receipt-${i}.json`),{text:chunks[i].text,...audio,backend:c.backend,seed:42,reviewRequired:true});
  }
  return {engine:'voxcpm2',model:'openbmb/VoxCPM2',conversion:'DennisHuang648/VoxCPM2-GGUF@169f64d8b98bbaab1761e4ca3a83e6af653456cc',backend:c.backend,sampleRate:48000,parts:chunks.length,seconds:(Date.now()-start)/1000,offline:true,license:'Apache-2.0',referenceSha256:frozen.reference?.sha256??null,reviewRequired:true,wordAccuracyVerified:false};
 }
}
