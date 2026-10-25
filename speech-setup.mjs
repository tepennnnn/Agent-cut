// Explicitly configured, external whisper.cpp installation. Nothing is downloaded.
import fs from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {atomic,EditError,run} from './engine.mjs';
import {checkJob} from './job-context.mjs';

export const speechCandidate=Object.freeze({
  name:'whisper.cpp',version:'1.9.3',language:'en',granularity:'segment',
  runnerSha256:'b6b27a4b7ce9543382344ba273ea82bac35f821ca4317cf16710e16b26791e0f',
  modelSha256:'cc37e93478338ec7700281a7ac30a10128929eb8f427dda2e865faa8f6da4356',
  model:'medium.en',modelBytes:1533774781,
  license:'External components; upstream whisper.cpp and Whisper are MIT. Not bundled.',
  limits:{seconds:120,threads:4,segments:500,timing:'Segment estimates; no word alignment or confidence guarantee.'}
});
export const speechError=(code,message)=>{throw new EditError(code,message);};
export async function fileDigest(file){
  if(!path.isAbsolute(file)||file.startsWith('\\\\')||file.startsWith('//'))speechError('SPEECH_FILE','Only absolute local disk files are supported.');
  const resolved=await fs.realpath(file);
  if(resolved.startsWith('\\\\')||resolved.startsWith('//'))speechError('SPEECH_FILE','Network files are not supported.');
  const hash=createHash('sha256'),before=await fs.stat(file);
  if(!before.isFile())speechError('SPEECH_FILE','Expected a regular local file.');
  for await(const chunk of createReadStream(file)){checkJob();hash.update(chunk);}
  const after=await fs.stat(file);
  if(before.size!==after.size||before.mtimeMs!==after.mtimeMs)speechError('SOURCE_CHANGED','File changed while hashing.');
  return hash.digest('hex');
}
export async function ownedDirectory(root,name){
  const real=await fs.realpath(root),dir=path.join(real,name);
  await fs.mkdir(dir,{recursive:true});
  if(await fs.realpath(dir)!==dir||(await fs.lstat(dir)).isSymbolicLink())speechError('UNSAFE_CACHE','Owned directory must not be a link.');
  return dir;
}
export async function readLocalJson(file,max=1024*1024){
  const st=await fs.lstat(file);
  if(!st.isFile()||st.isSymbolicLink()||st.size>max)speechError('SPEECH_FILE','Invalid or oversized local metadata.');
  return JSON.parse(await fs.readFile(file,'utf8'));
}
export class SpeechSetup {
  constructor(store){this.store=store;this.file=path.join(store.root,'speech.local.json');}
  async load(){try{return await readLocalJson(this.file);}catch(e){if(e.code==='ENOENT')return null;throw e;}}
  async readiness(){
    try{
      const config=await this.load();
      if(!config)return {ready:false,code:'NOT_CONFIGURED',fallback:'Import timed text/SRT/VTT; no model download is required.',candidate:speechCandidate};
      await this.validate(config,false);
      const freeBytes=os.freemem();
      return {ready:true,canTranscribe:freeBytes>=2.5*1024**3,freeBytes,minimumFreeBytes:2.5*1024**3,identity:config.identity,threads:config.threads,verification:'Pinned files exist; full hashes are rechecked before each job/retry.',candidate:speechCandidate};
    }catch(e){return {ready:false,code:e.code||'SPEECH_UNAVAILABLE',message:e.message,fallback:'Use timed text/SRT/VTT import or explicitly reconfigure.'};}
  }
  async configure({runnerPath,modelPath,threads=4}){
    if(!path.isAbsolute(runnerPath||'')||!path.isAbsolute(modelPath||'')||!Number.isInteger(threads)||threads<1||threads>4)speechError('SPEECH_SETUP','Choose absolute installed paths and 1–4 CPU threads.');
    if([runnerPath,modelPath,this.store.ffmpeg].some(p=>p.startsWith('\\\\')||p.startsWith('//')))speechError('SPEECH_SETUP','Network paths are not supported.');
    const runner=await fs.realpath(runnerPath),model=await fs.realpath(modelPath);
    if(path.basename(runner).toLowerCase()!=='whisper-cli.exe')speechError('SPEECH_SETUP','This release supports the pinned Windows whisper-cli.exe only.');
    const runnerHash=await fileDigest(runner),modelHash=await fileDigest(model);
    if(runnerHash!==speechCandidate.runnerSha256||modelHash!==speechCandidate.modelSha256)speechError('SPEECH_IDENTITY','Runner/model differs from the verified 1.9.3 medium.en pair. No files were configured.');
    const files=[runner,model];
    const dlls=(await fs.readdir(path.dirname(runner))).filter(n=>n.toLowerCase().endsWith('.dll')).sort();
    if(dlls.length>64)speechError('SPEECH_SETUP','Unexpectedly large runtime dependency directory.');
    files.push(...dlls.map(n=>path.join(path.dirname(runner),n)));
    // Resolve and pin the decoder executable too; a bare PATH command is not reproducible.
    if(!path.isAbsolute(this.store.ffmpeg))speechError('SPEECH_SETUP','Configure an absolute local FFmpeg path before enabling speech.');
    files.push(await fs.realpath(this.store.ffmpeg));
    const identities=[];
    for(const file of files)identities.push({path:file,sha256:file===runner?runnerHash:file===model?modelHash:await fileDigest(file),size:(await fs.stat(file)).size});
    const decoderVersion=(await run(this.store.ffmpeg,['-version'],{timeout:5000})).out.split(/\r?\n/)[0].slice(0,200);
    const config={version:1,runner,model,threads,identities,decoderVersion,identity:{...speechCandidate,decoderVersion,dependencies:identities.map(({path:file,...rest})=>({name:path.basename(file),...rest}))}};
    await atomic(this.file,config);
    return this.readiness();
  }
  async validate(config,full=true){
    if(config?.version!==1||!Array.isArray(config.identities)||config.identities.length<3||config.identities.length>67||config.identity?.runnerSha256!==speechCandidate.runnerSha256||config.identity?.modelSha256!==speechCandidate.modelSha256||!Number.isInteger(config.threads)||config.threads<1||config.threads>4)speechError('SPEECH_SETUP','Invalid speech setup; explicitly configure again.');
    if(!config.identities.some(f=>f.path===config.runner&&f.sha256===speechCandidate.runnerSha256)||!config.identities.some(f=>f.path===config.model&&f.sha256===speechCandidate.modelSha256)||!config.identities.some(f=>f.path===this.store.ffmpeg))speechError('SPEECH_SETUP','Pinned paths do not match the selected runner, model and decoder.');
    for(const file of config.identities){
      if(!path.isAbsolute(file.path)||!/^[a-f0-9]{64}$/.test(file.sha256))speechError('SPEECH_SETUP','Invalid pin.');
      const stat=await fs.stat(file.path);
      if(!stat.isFile()||stat.size!==file.size||(full&&await fileDigest(file.path)!==file.sha256))speechError('SPEECH_IDENTITY','A pinned speech component changed. Explicitly reconfigure and start a new job.');
    }
    // Loading additional DLLs after setup is also a changed runtime.
    const actual=(await fs.readdir(path.dirname(config.runner))).filter(n=>n.toLowerCase().endsWith('.dll')).sort();
    const pinned=config.identities.filter(f=>f.path.toLowerCase().endsWith('.dll')).map(f=>path.basename(f.path)).sort();
    if(JSON.stringify(actual)!==JSON.stringify(pinned))speechError('SPEECH_IDENTITY','Runtime DLL set changed.');
    return config;
  }
}
