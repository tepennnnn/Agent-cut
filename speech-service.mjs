import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {atomic,canonical,run} from './engine.mjs';
import {checkJob} from './job-context.mjs';
import {page} from './agent-reads.mjs';
import {parseSubtitles} from './subtitles.mjs';
import {SpeechSetup,fileDigest,ownedDirectory,readLocalJson,speechError as fail} from './speech-setup.mjs';
import {transcriptDigest,transcriptText,validateSegments,normalizeWhisper,mapTranscriptCaptions} from './transcript-model.mjs';

const idOk=id=>typeof id==='string'&&/^[a-f0-9]{64}$/.test(id);
export class SpeechService {
  constructor(store,renderer){this.store=store;this.renderer=renderer;this.setup=new SpeechSetup(store);this.writes=Promise.resolve();}
  serialize(fn){const task=this.writes.then(fn);this.writes=task.catch(()=>{});return task;}
  async asset(args){
    const project=await this.store.snapshot();this.store.checkIdentity(args.expectedProjectId);
    if(args.expectedRevision!==undefined)this.store.check(args.expectedRevision,args.expectedProjectId);
    const asset=project.assets.find(a=>a.id===args.assetId);
    if(!asset||asset.kind==='sequence')fail('TRANSCRIPT_SOURCE','Choose an imported original source.');
    return {project,asset};
  }
  async start(args){
    const {project,asset}=await this.asset(args);
    if(!asset.hasAudio)fail('NO_AUDIO','Selected source has no audio. Import a timed transcript as a fallback.');
    const start=args.start??0,end=args.end??Math.min(asset.duration,start+30);
    if(!Number.isFinite(start)||!Number.isFinite(end)||start<0||end<=start||end>asset.duration+1e-7||end-start>120)fail('TRANSCRIPT_RANGE','Choose an in-source interval of at most 120 seconds.');
    if(args.language!==undefined&&args.language!=='en')fail('SPEECH_LANGUAGE','Configured medium.en supports English only. Other languages require timed text import.');
    const config=await this.setup.load();if(!config)fail('SPEECH_UNAVAILABLE','Explicitly configure the existing local runner/model or import timed text.');
    // All expensive hashing and media processing runs in the shared cancellable queue.
    const request={asset,start,end,config,language:'en',adapterVersion:1};
    await this.renderer.ready;
    return this.renderer.jobService.start('transcribe',request,(r,j)=>this.execute(r,j),{revision:project.revision,preview:true,progress:null,coverage:{start,end,coordinates:'source seconds'}});
  }
  async execute(request,job){
    const {asset,start,end,config}=request;
    job.phase='verify local inputs';
    await this.setup.validate(config,true);
    const current=await this.store.snapshot(),live=current.assets.find(a=>a.id===asset.id);
    if(!live||live.file!==asset.file)fail('SOURCE_CHANGED','Speech source was removed or relinked.');
    const file=this.store.assetPath(asset),sourceSha256=await fileDigest(file);
    if(request.sourceSha256&&request.sourceSha256!==sourceSha256)fail('SOURCE_CHANGED','Source bytes changed; start new analysis.');
    request.sourceSha256=sourceSha256;
    // Persist the full digest before inference so retries cannot silently accept changed bytes.
    await this.renderer.jobService.persist(job,request);
    const provenance={projectId:this.store.projectId,assetId:asset.id,sourceSha256,range:{start,end},components:config.identities,runnerVersion:config.identity.version,decoderVersion:config.decoderVersion,language:'en',threads:config.threads,granularity:'segment',adapterVersion:1,settings:{cpu:true,bestOf:1,beamSize:1,noFallback:true,translation:false}};
    const id=transcriptDigest(provenance),dir=await ownedDirectory(this.store.root,'transcripts'),fileName=path.join(dir,id+'.json');
    try{const cached=await readLocalJson(fileName);this.validateDoc(cached);await this.completeOrigin(cached);job.transcriptId=id;job.analysisRevision=cached.revision;job.cacheHit=true;job.phase='complete';return;}catch(e){if(!['ENOENT','TRANSCRIPT_INCOMPLETE'].includes(e.code))throw e;}
    const exports=await ownedDirectory(this.store.root,'exports'),work=await ownedDirectory(exports,job.id),wav=path.join(work,'normalized.wav');
    job.phase='normalize audio';
    await run(this.store.ffmpeg,['-hide_banner','-nostdin','-y','-protocol_whitelist','file,pipe','-ss',String(start),'-i',file,'-t',String(end-start),'-map','0:a:0','-vn','-ac','1','-ar','16000','-c:a','pcm_s16le','-f','wav',wav],{timeout:180000});
    const bytes=await fs.readFile(wav),decodedSeconds=pcmDuration(bytes);
    if(decodedSeconds<=0||decodedSeconds>end-start+.002)fail('SPEECH_DECODE','Normalized PCM duration is outside requested bounds.');
    job.phase='transcribe English (segment timing)';
    const output=path.join(work,'raw');
    let result,raw;
    if(pcmSilent(bytes)){
      result={err:'All normalized PCM samples are zero; inference skipped.'};raw={transcription:[],note:result.err};await atomic(output+'.json',raw);
    }else{
      if(os.freemem()<2.5*1024**3)fail('SPEECH_MEMORY','At least 2.5 GiB free RAM is required for the installed medium.en model. Use timed text import.');
      result=await this.infer(config,wav,output);
      raw=await readLocalJson(output+'.json',2*1024*1024);
    }
    // run() never uses a shell, and only FFmpeg local file/pipe protocols are enabled.
    await fs.writeFile(path.join(work,'runner.log'),result.err);
    const normalized=normalizeWhisper(raw,{start,end,decodedSeconds});
    if(raw.note)normalized.warnings.push(raw.note);
    checkJob();
    if(await fileDigest(file)!==sourceSha256)fail('SOURCE_CHANGED','Source changed during transcription; result was not published.');
    const doc={version:1,id,projectId:this.store.projectId,assetId:asset.id,revision:0,kind:'local-asr',originJobId:job.id,provenance,coverage:{start,end:start+decodedSeconds,coordinates:'source seconds'},partial:start>0||start+decodedSeconds<asset.duration-.001,segments:normalized.segments,warnings:[...normalized.warnings,'Machine transcript: review text and segment timing. Confidence/word alignment unavailable.'],raw,corrections:[],createdAt:new Date().toISOString()};
    await this.serialize(async()=>{checkJob();await this.save(doc);});
    job.transcriptId=id;job.analysisRevision=0;job.segmentCount=doc.segments.length;job.warnings=doc.warnings;job.phase='complete';
  }
  async infer(config,wav,output){
    return run(config.runner,['-m',config.model,'-f',wav,'-ng','-t',String(config.threads),'-p','1','-bo','1','-bs','1','-nf','-l','en','-oj','-of',output],{cwd:path.dirname(config.runner),timeout:600000});
  }
  validateDoc(doc){
    if(doc?.version!==1||!idOk(doc.id)||doc.projectId!==this.store.projectId||!Number.isSafeInteger(doc.revision)||doc.revision<0||!Array.isArray(doc.segments)||doc.segments.length>500||!/^[a-f0-9]{64}$/.test(doc.provenance?.sourceSha256))fail('TRANSCRIPT_FORMAT','Invalid transcript sidecar.');
    const checked=validateSegments(doc.segments.map(s=>({...s,text:s.text})),7200);
    for(let i=0;i<checked.length;i++)if(checked[i].id!==doc.segments[i].id)fail('TRANSCRIPT_FORMAT','Invalid transcript segment ID.');
    return doc;
  }
  async completeOrigin(doc){
    if(doc.kind!=='local-asr')return;
    if(typeof doc.originJobId!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(doc.originJobId))fail('TRANSCRIPT_FORMAT','Missing origin job.');
    const record=await readLocalJson(this.renderer.jobService.file(doc.originJobId),16000000);
    if(record.job?.projectId!==this.store.projectId||record.job?.status!=='complete')fail('TRANSCRIPT_INCOMPLETE','Origin job did not complete. Retry analysis; partial results are not published.');
  }
  async save(doc){
    this.validateDoc(doc);const dir=await ownedDirectory(this.store.root,'transcripts'),file=path.join(dir,doc.id+'.json');
    let count=0,size=0;for(const name of await fs.readdir(dir)){if(!/^[a-f0-9]{64}\.json$/.test(name))continue;const stat=await fs.lstat(path.join(dir,name));if(stat.isSymbolicLink())fail('UNSAFE_CACHE','Transcript sidecar is a link.');if(name!==doc.id+'.json'){count++;size+=stat.size;}}
    const bytes=Buffer.byteLength(JSON.stringify(doc,null,2));
    if(count>=100||bytes>1024*1024||size+bytes>32*1024*1024)fail('TRANSCRIPT_LIMIT','Transcript storage limit reached (100 documents/32 MiB; 1 MiB per document). Corrections are never automatically evicted.');
    const existing=await fs.lstat(file).catch(()=>null);if(existing?.isSymbolicLink())fail('UNSAFE_CACHE','Transcript target is a link.');
    await atomic(file,doc);
  }
  async load(args){
    if(!idOk(args.transcriptId))fail('TRANSCRIPT_ID','Supply a transcript ID.');
    const dir=await ownedDirectory(this.store.root,'transcripts'),doc=this.validateDoc(await readLocalJson(path.join(dir,args.transcriptId+'.json')));
    await this.completeOrigin(doc);
    const {project,asset}=await this.asset({...args,assetId:doc.assetId});
    if(await fileDigest(this.store.assetPath(asset))!==doc.provenance.sourceSha256)fail('SOURCE_CHANGED','Source bytes differ from transcript provenance. Reanalyze or reimport.');
    if(args.expectedAnalysisRevision!==undefined&&args.expectedAnalysisRevision!==doc.revision)fail('STALE_TRANSCRIPT','Transcript corrections changed. Read again.');
    return {doc,project,asset};
  }
  async read(args){
    const {doc,project}=await this.load(args),query=args.query??'';
    if(typeof query!=='string'||query.length>200)fail('TRANSCRIPT_QUERY','Use a literal search up to 200 characters.');
    const records=doc.segments.filter(s=>!query||s.text.toLowerCase().includes(query.toLowerCase())),summary=this.summary(doc);
    return page(records,{context:transcriptDigest({id:doc.id,revision:doc.revision,projectRevision:project.revision}),query:{query},cursor:args.cursor,pageSize:args.pageSize,maxBytes:16384,assemble:(segments,coverage)=>({...summary,segments,coverage})});
  }
  summary(doc){return {transcriptId:doc.id,assetId:doc.assetId,analysisRevision:doc.revision,kind:doc.kind,sourceSha256:doc.provenance.sourceSha256,sourceRange:doc.coverage,partial:doc.partial,segmentCount:doc.segments.length,warnings:doc.warnings,language:doc.provenance.language,timing:'Source seconds; estimated segment boundaries; no word alignment.'};}
  async list(args){
    this.store.checkIdentity(args.expectedProjectId);const dir=await ownedDirectory(this.store.root,'transcripts'),records=[];
    for(const name of await fs.readdir(dir)){if(!/^[a-f0-9]{64}\.json$/.test(name))continue;const doc=this.validateDoc(await readLocalJson(path.join(dir,name)));try{await this.completeOrigin(doc);}catch(e){if(e.code==='TRANSCRIPT_INCOMPLETE')continue;throw e;}if(!args.assetId||args.assetId===doc.assetId)records.push(this.summary(doc));}
    const project=await this.store.snapshot();records.sort((a,b)=>a.transcriptId.localeCompare(b.transcriptId));
    return page(records,{context:transcriptDigest({records,revision:project.revision}),query:{assetId:args.assetId??null},cursor:args.cursor,pageSize:args.pageSize,maxBytes:16384,assemble:(transcripts,coverage)=>({transcripts,coverage,scope:'Index only; source validity is checked on read/correction/caption draft.'})});
  }
  async correct(args){return this.serialize(async()=>{
    if(!Number.isSafeInteger(args.expectedAnalysisRevision))fail('STALE_TRANSCRIPT','Supply expectedAnalysisRevision from read.');
    const {doc}=await this.load(args),segment=doc.segments.find(s=>s.id===args.segmentId);
    if(!segment)fail('TRANSCRIPT_ID','Unknown segment.');
    if(doc.corrections.length>=100)fail('TRANSCRIPT_LIMIT','Maximum 100 corrections per transcript.');
    const text=transcriptText(args.text);doc.corrections.push({revision:doc.revision+1,segmentId:segment.id,before:segment.text,after:text,at:new Date().toISOString()});segment.text=text;doc.revision++;await this.save(doc);return this.summary(doc);
  });}
  async import(args){return this.serialize(async()=>{
    if(args.language!==undefined&&(typeof args.language!=='string'||args.language.length>32||!/^[-\w ]{1,32}$/.test(args.language)))fail('SPEECH_LANGUAGE','Use a short language label (up to 32 ASCII letters/digits/dashes/spaces).');
    const {asset}=await this.asset(args),segments=validateSegments(parseSubtitles(args.text,args.format||'srt'),asset.duration),sourceSha256=await fileDigest(this.store.assetPath(asset));
    const provenance={sourceSha256,language:args.language||'unspecified',format:args.format||'srt',contentSha256:transcriptDigest(args.text),importId:randomUUID()};
    const doc={version:1,id:transcriptDigest(provenance),projectId:this.store.projectId,assetId:asset.id,revision:0,kind:'manual-import',provenance,coverage:{start:segments[0].start,end:segments.at(-1).end,coordinates:'source seconds'},partial:segments[0].start>0||segments.at(-1).end<asset.duration-.001,segments,warnings:['User-supplied timing and text; no automatic accuracy validation.'],corrections:[],createdAt:new Date().toISOString()};
    await this.save(doc);return this.summary(doc);
  });}
  async captions(args){
    if(!Number.isSafeInteger(args.expectedAnalysisRevision)||!Number.isSafeInteger(args.expectedRevision))fail('STALE_TRANSCRIPT','Supply current project and analysis revisions.');
    const {project,doc}=await this.load(args),mapped=mapTranscriptCaptions(project,doc,args),saved=await this.store.savePlan({expectedProjectId:this.store.projectId,expectedRevision:project.revision,summary:'Draft captions from reviewed transcript',operations:mapped.operations});
    return {...saved,transcriptId:doc.id,analysisRevision:doc.revision,sourceSha256:doc.provenance.sourceSha256,...mapped,committed:false,warning:'Saved candidate only. Preview/review, then apply through timeline_plan_apply. Later transcript corrections do not change this frozen plan.'};
  }
}

export function pcmDuration(bytes){
  if(bytes.toString('ascii',0,4)!=='RIFF'||bytes.toString('ascii',8,12)!=='WAVE')fail('SPEECH_DECODE','Expected PCM WAV.');
  let rate=0,data=0;
  for(let offset=12;offset+8<=bytes.length;){const name=bytes.toString('ascii',offset,offset+4),size=bytes.readUInt32LE(offset+4);if(size>bytes.length-offset-8)fail('SPEECH_DECODE','Truncated WAV.');if(name==='fmt '){if(size<16||bytes.readUInt16LE(offset+8)!==1||bytes.readUInt16LE(offset+10)!==1||bytes.readUInt32LE(offset+12)!==16000||bytes.readUInt16LE(offset+22)!==16)fail('SPEECH_DECODE','Expected 16 kHz mono PCM16.');rate=bytes.readUInt32LE(offset+16);}if(name==='data')data+=size;offset+=8+size+(size%2);}
  if(rate!==32000||!data)fail('SPEECH_DECODE','Empty/invalid PCM.');return data/rate;
}
export function pcmSilent(bytes){
  pcmDuration(bytes);
  for(let offset=12;offset+8<=bytes.length;){const size=bytes.readUInt32LE(offset+4);if(bytes.toString('ascii',offset,offset+4)==='data'){for(let n=offset+8;n<offset+8+size;n++)if(bytes[n]!==0)return false;}offset+=8+size+(size%2);}
  return true;
}
