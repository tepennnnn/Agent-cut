import {usedSources} from './job-inputs.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import {EditError,run,atomic} from './engine.mjs';
import {validateObject} from './operations.mjs';
import {recipeContracts,recipeLimits} from './recipe-contracts.mjs';
import {compileRecipe} from './recipe-compiler.mjs';
import {fileDigest,ownedDirectory,readLocalJson} from './speech-setup.mjs';
import {transcriptDigest} from './transcript-model.mjs';
import {fontCatalog} from './text-fonts.mjs';
import {checkJob} from './job-context.mjs';
const fail=(code,message)=>{throw new EditError(code,message);};
export class RecipeService {
 constructor(store,renderer,speech){this.store=store;this.renderer=renderer;this.speech=speech;}
 contracts(kind){if(!recipeContracts[kind])fail('RECIPE_KIND','Choose an exact recipe kind.');return {kind,schema:recipeContracts[kind],limits:recipeLimits};}
 async call(args){
  this.store.checkIdentity(args.expectedProjectId);
  if(args.action==='contracts')return this.contracts(args.kind);
  if(args.action==='pause_read')return this.readPause(args.evidenceId);
  const kind=args.action==='pause_analyze'?'pause_analyze':args.kind,schema=recipeContracts[kind];
  if(!schema||kind==='pause_analyze'&&args.action!=='pause_analyze')fail('RECIPE_KIND','Unknown recipe.');
  if(Buffer.byteLength(JSON.stringify(args.request??{}))>32768)fail('RECIPE_LIMIT','Recipe request exceeds 32 KiB.');
  try{validateObject(args.request,schema);}catch(e){fail('INVALID_ARGUMENT',e.message);}
  if(args.action==='pause_analyze')return this.analyze(args);
  const project=await this.store.snapshot();this.store.check(args.expectedRevision,args.expectedProjectId);
  const request=args.request,documents=new Map();
  for(const selection of request.selections||[request])if(selection.transcriptId&&!documents.has(selection.transcriptId)){
   const {doc}=await this.speech.load({expectedProjectId:this.store.projectId,transcriptId:selection.transcriptId,expectedAnalysisRevision:selection.expectedAnalysisRevision});documents.set(doc.id,doc);
  }
  const pauseEvidence=kind==='pause_cut'?await this.readPause(request.evidenceId):undefined;
  const fonts=request.title||request.captionPolicy==='draft'?await fontCatalog():[],fontPins=Object.fromEntries(fonts.filter(f=>f.available).map(f=>[f.id,f.sha256]));
  const result=compileRecipe(project,kind,request,{documents,pauseEvidence,fontPins});
  if(Buffer.byteLength(JSON.stringify(result))>60000)fail('RECIPE_LIMIT','Complete recipe review exceeds 60 KB; select fewer passages. No evidence was truncated.');
  // savePlan reloads and rejects a revision changed during hashing/evidence reads.
  const sourceIds=new Set(result.evidence.map(e=>e.assetId).filter(Boolean));for(const doc of documents.values())sourceIds.add(doc.assetId);if(pauseEvidence)sourceIds.add(pauseEvidence.assetId);
  if(kind==='opening'||kind==='pause_cut')for(const asset of usedSources({...project,activeSequenceId:result.sequenceId}))sourceIds.add(asset.id);if(sourceIds.size>30)fail('RECIPE_LIMIT','At most 30 original sources per recipe review; use manual plans for a larger sequence.');
  const sources=[];for(const assetId of sourceIds){const asset=project.assets.find(a=>a.id===assetId);const sha256=await fileDigest(this.store.assetPath(asset)),expected=[...documents.values()].filter(d=>d.assetId===assetId).map(d=>d.provenance.sourceSha256).concat(pauseEvidence?.assetId===assetId?[pauseEvidence.sourceSha256]:[]);if(expected.some(hash=>hash!==sha256))fail('SOURCE_CHANGED','Source changed after evidence was read. Analyze/read again.');sources.push({assetId,file:asset.file,sha256});}
  const review={kind,request,evidence:result.evidence,warnings:result.warnings,explanation:result.explanation,baseRevision:project.revision,scope:'Frozen recipe evidence; later transcript corrections do not rewrite this review.'},recipeBindingDigest=transcriptDigest({projectId:this.store.projectId,sources,review});
  const {plan}=await this.store.savePlan({expectedProjectId:this.store.projectId,expectedRevision:project.revision,recipeBindingDigest,summary:('Recipe: '+kind+' · '+(request.name||'selected timeline cut')).slice(0,200),operations:result.operations});
  const bindings=await ownedDirectory(this.store.root,'recipe-plans');await atomic(path.join(bindings,plan.planId+'.json'),{version:1,planId:plan.planId,projectId:this.store.projectId,sources,review});
  return {...result,kind,projectId:this.store.projectId,baseRevision:project.revision,plan:{planId:plan.planId,expectedRevision:plan.expectedRevision,destructiveOperations:plan.destructiveOperations,noOp:plan.noOp},committed:false,preview:{sequenceId:result.sequenceId,sequenceLimitSeconds:120},scope:'Frozen candidate only. Review evidence and timeline_plan_preview, then explicitly apply through timeline_plan_apply. Later transcript corrections do not change this saved plan.'};
 }
 async analyze(args){
  const project=await this.store.snapshot(),r=args.request,asset=project.assets.find(a=>a.id===r.assetId);
  if(!asset||asset.kind==='sequence'||!asset.hasAudio)fail('RECIPE_SOURCE','Choose an original source with audio.');
  if(!Number.isFinite(r.start)||!Number.isFinite(r.end)||r.start<0||r.end<=r.start||r.end>asset.duration||r.end-r.start>120||!Number.isFinite(r.noiseDb)||r.noiseDb< -70||r.noiseDb> -5||!Number.isFinite(r.minSeconds)||r.minSeconds<.1||r.minSeconds>20)fail('RECIPE_PAUSE','Analyze at most 120 source seconds, threshold -70 to -5 dB and minimum 0.1–20 seconds.');
  await this.renderer.ready;return this.renderer.jobService.start('pause-analysis',{asset,...r},(request,job)=>this.executePause(request,job),{revision:project.revision,preview:true,progress:null,coverage:{start:r.start,end:r.end,coordinates:'source seconds'}});
 }
 async executePause(request,job){
  const {asset,start,end,noiseDb,minSeconds}=request;job.coverage={start,end,coordinates:'source seconds'};const sourceSha256=await fileDigest(this.store.assetPath(asset));
  if(request.sourceSha256&&request.sourceSha256!==sourceSha256)fail('SOURCE_CHANGED','Pause source changed; run new analysis.');request.sourceSha256=sourceSha256;await this.renderer.jobService.persist(job,request);
  const decoderSha256=await fileDigest(this.store.ffmpeg),id=transcriptDigest({projectId:this.store.projectId,assetId:asset.id,sourceSha256,decoderSha256,start,end,noiseDb,minSeconds,version:1});
  if(request.decoderSha256&&request.decoderSha256!==decoderSha256)fail('SOURCE_CHANGED','Pause decoder changed. Start new analysis.');request.decoderSha256=decoderSha256;await this.renderer.jobService.persist(job,request);
  try{const cached=await this.readPause(id);job.evidenceId=id;job.pauseCount=cached.intervals.length;job.cacheHit=true;return;}catch(e){if(!['ENOENT','RECIPE_PAUSE'].includes(e.code))throw e;}
  job.phase='measure bounded source audio';
  const output=await run(this.store.ffmpeg,['-hide_banner','-nostdin','-protocol_whitelist','file,pipe','-ss',String(start),'-t',String(end-start),'-i',this.store.assetPath(asset),'-map','0:a:0','-vn','-af',`silencedetect=noise=${noiseDb}dB:d=${minSeconds}`,'-f','null','-'],{timeout:180000});
  const intervals=parsePauseLog(output.err,{start,end});
  checkJob();if(await fileDigest(this.store.assetPath(asset))!==sourceSha256)fail('SOURCE_CHANGED','Source changed during pause measurement.');
  const dir=await ownedDirectory(this.store.root,'pause-evidence'),names=(await fs.readdir(dir)).filter(n=>/^[a-f0-9]{64}\.json$/.test(n));if(names.length>=100&&!names.includes(id+'.json'))fail('RECIPE_LIMIT','At most 100 retained pause measurements; use existing evidence.');
  const doc={version:1,id,projectId:this.store.projectId,assetId:asset.id,sourceSha256,decoderSha256,start,end,noiseDb,minSeconds,originJobId:job.id,intervals,meaning:'Measured low audio level only; not speech, filler-word or semantic evidence.'};
  await atomic(path.join(dir,id+'.json'),doc);job.evidenceId=id;job.pauseCount=intervals.length;job.phase='complete';
 }
 async readPause(id){
  if(typeof id!=='string'||!/^[a-f0-9]{64}$/.test(id))fail('RECIPE_PAUSE','Supply a measured evidence ID.');
  const dir=await ownedDirectory(this.store.root,'pause-evidence'),doc=await readLocalJson(path.join(dir,id+'.json'),262144);
  if(doc.version!==1||doc.id!==id||doc.projectId!==this.store.projectId||!Array.isArray(doc.intervals)||doc.intervals.length>100||typeof doc.originJobId!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(doc.originJobId))fail('RECIPE_PAUSE','Invalid measured evidence.');
  const record=await readLocalJson(this.renderer.jobService.file(doc.originJobId),16000000);if(record.job?.status!=='complete'||record.job.projectId!==this.store.projectId)fail('RECIPE_PAUSE','Measurement job is incomplete.');
  const project=await this.store.snapshot(),asset=project.assets.find(a=>a.id===doc.assetId);if(!asset||await fileDigest(this.store.assetPath(asset))!==doc.sourceSha256)fail('SOURCE_CHANGED','Measured source changed. Analyze again.');
  let previous=doc.start;for(const interval of doc.intervals){if(!Number.isFinite(interval.start)||!Number.isFinite(interval.end)||interval.start<previous||interval.end<=interval.start||interval.end>doc.end)fail('RECIPE_PAUSE','Corrupt measured intervals.');previous=interval.end;}
  return doc;
 }
}
export function parsePauseLog(log,{start,end}){
 const intervals=[];let open=null;
 for(const match of log.matchAll(/silence_(start|end):\s*(-?\d+(?:\.\d+)?)/g)){
  const value=Math.max(start,Math.min(end,start+Number(match[2])));
  if(match[1]==='start')open=value;else if(open!==null){if(value>open)intervals.push({id:'pause_'+intervals.length,start:open,end:value});open=null;}
 }
 if(open!==null&&end>open)intervals.push({id:'pause_'+intervals.length,start:open,end});
 if(intervals.length>100)fail('RECIPE_LIMIT','More than 100 low-level intervals; analyze a smaller source range.');return intervals;
}
