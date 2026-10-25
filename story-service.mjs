import {StoryVideoService} from './story-video-service.mjs';
import {transitionSample} from './transition-sample-service.mjs';
import {AffiliateService} from './affiliate-service.mjs';
import {StoryCreatorService} from './story-creator-service.mjs';
import {renderStoryImage} from './story-image-renderer.mjs';
import {StorySyncService} from './story-sync-service.mjs';
import {validateCaptionFont} from './ui/font-model.js';import {fontCatalog} from './text-fonts.mjs';
import {sentenceChunks,sentenceCaptions} from './story-speech.mjs';
import {StoryArtService} from './story-art-service.mjs';
import {transitionCatalog,transitionSettings} from './ui/transition-model.js';
import {captionStyles,captionStyleIds,motionStyle} from './ui/caption-model.js';
import {ChatterboxService} from './chatterbox-service.mjs';
import {validateFrozenInputs} from './job-inputs.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID,createHash} from 'node:crypto';
import {atomic,run,EditError,canonical} from './engine.mjs';
import {convertV1,validateV2,timeFromSeconds,migrationPreview} from './sequences.mjs';
import {textPresets} from './ui/text-model.js';
const ROOT=path.dirname(fileURLToPath(import.meta.url));
const fail=message=>{throw new EditError('INVALID_STORY',message);};
const key=id=>{if(typeof id!=='string'||! /^[a-f0-9-]{36}$/.test(id))fail('Invalid story/image ID.');return id;};
const digest=value=>createHash('sha256').update(canonical(value)).digest('hex');
const clean=text=>text.replace(/\s+/g,' ').trim();
export function splitStory(script){
 if(typeof script!=='string'||!script.trim()||script.length>12000||/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(script))fail('Enter a script of 1–12,000 characters without text controls.');
 const scenes=script.trim().split(/\n\s*\n/).map(text=>clean(text.replace(/^\s*(?:scene\s+\d+\s*[:.—-]?|#{1,6}\s+[^\n]*\n)/i,''))).filter(Boolean);
 if(!scenes.length||scenes.length>60)fail('Use 1–60 scenes, separated by blank lines.');
 return scenes;
}
export const speechChunks=sentenceChunks;
// PCM chunk lengths provide actual generated phrase boundaries, independent of WPM estimates.
export function wavSeconds(buffer){
 if(buffer.toString('ascii',0,4)!=='RIFF'||buffer.toString('ascii',8,12)!=='WAVE')fail('Speech engine did not return a WAV file.');
 let rate=0,size=0;for(let offset=12;offset+8<=buffer.length;){const type=buffer.toString('ascii',offset,offset+4),length=buffer.readUInt32LE(offset+4);if(offset+8+length>buffer.length)fail('Truncated generated audio.');if(type==='fmt '&&length>=16)rate=buffer.readUInt32LE(offset+16);if(type==='data')size+=length;offset+=8+length+(length%2);}
 if(!rate||!size)fail('Generated audio is empty.');return size/rate;
}
export class StoryService {
 constructor(store,renderer){this.store=store;this.renderer=renderer;this.root=path.join(store.root,'stories');this.chatterbox=new ChatterboxService(store);this.art=new StoryArtService(this);this.sync=new StorySyncService(this);this.creator=new StoryCreatorService(this);this.affiliate=new AffiliateService(this);this.videos=new StoryVideoService(this);}
 async ready(){await fs.mkdir(this.root,{recursive:true});}
 async voiceRequest(request,dir){
  await fs.mkdir(dir,{recursive:true});const input=path.join(dir,'voice-request.json');await atomic(input,request);
  const result=await run('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(ROOT,'story-voice.ps1'),'-RequestFile',input],{timeout:1200000});
  return JSON.parse(result.out.replace(/^\uFEFF/,''));
 }
 async voices(){
  if(process.platform!=='win32')return {voices:[],engine:'Windows SAPI (offline)',unavailable:'Voice generation currently requires Windows and an installed SAPI voice.'};
  const dir=path.join(this.root,'voice-check',randomUUID());await this.ready();
  try{return await this.voiceRequest({action:'voices'},dir);}catch(e){return {voices:[],unavailable:'Windows speech voices could not be loaded: '+e.message};}
 }
 async list(){await this.ready();const files=(await fs.readdir(this.root)).filter(n=>/^[a-f0-9-]{36}\.json$/.test(n));const stories=[];for(const file of files.slice(-100)){const d=JSON.parse(await fs.readFile(path.join(this.root,file),'utf8'));if(d.projectId===this.store.projectId)stories.push({id:d.id,title:d.title,revision:d.revision,engine:d.engine??'windows',voice:d.voice,scenes:d.scenes.length,updatedAt:d.updatedAt});}return {stories};}
 file(id){return path.join(this.root,key(id)+'.json');}
 async read(id){const d=JSON.parse(await fs.readFile(this.file(id),'utf8'));this.store.checkIdentity(d.projectId);return d;}
 async generate(args){
  const scenes=splitStory(args.script),chunks=speechChunks(scenes),engine=args.engine??'windows';if(!['windows','chatterbox'].includes(engine))fail('Choose Windows or Chatterbox TTS.');
  if(typeof args.voice!=='string'||! /^[A-Za-z0-9_.-]{1,160}$/.test(args.voice))fail('Choose a voice.');
  const rate=args.rate??0;if(!Number.isInteger(rate)||rate< -5||rate>5)fail('Voice rate must be an integer from -5 to 5.');
  const shape=args.shape??'portrait';if(!['portrait','landscape','square'].includes(shape))fail('Choose portrait, landscape or square.');
  const style=args.captionStyle??'clean';if(!captionStyleIds.includes(style))fail('Choose an available caption style.');
  validateCaptionFont(args.captionFont);const captionFont=args.captionFont??'preset';
  const transition=transitionSettings(args.transitionKind,args.transitionSeconds);
  const title=typeof args.title==='string'?args.title.trim():'Untitled story';if(!title||title.length>120)fail('Title must contain 1–120 characters.');
  this.store.checkIdentity(args.expectedProjectId);await this.ready();
  const artSettings=await this.art.settings(args.artSettings??{});
  const tts=engine==='chatterbox'?await this.chatterbox.freeze(args.voice):null;
  return this.renderer.jobService.start('story-voice',{engine,tts,artSettings,speechSegmentation:'sentence-v1',storyId:randomUUID(),projectId:this.store.projectId,title,scenes,chunks,voice:args.voice,rate,shape,captionStyle:style,captionFont,transition},(r,j)=>this.execute(r,j),{revision:this.store.db.revision,engine});
 }
 async execute(request,job){
  if(!request.privateDraft&&['story-scene-voice','story-scene-image','story-scene-video','story-quality'].includes(job.kind))return this.creator.execute(request,job);
  if(job.kind==='story-resync')return this.sync.execute(request,job);
  if(request.project){await this.creator.beforeExport(request,job);await this.renderer.render(request.project,job);if(job.kind==='story-transition-sample'){const muted=path.join(path.dirname(job.path),'transition-sample.mp4');await run(this.store.ffmpeg,['-hide_banner','-nostdin','-y','-i',job.path,'-map','0:v:0','-c:v','copy','-an',muted]);job.path=muted;job.file=path.basename(muted);}return;}
  const storyId=await fs.stat(this.file(request.storyId)).catch(()=>null)?randomUUID():request.storyId;
  const work=path.join(this.store.root,'exports',job.id);await fs.mkdir(work,{recursive:true});
  let generation={engine:'windows'};
  if(request.engine==='chatterbox'){
   generation=await this.chatterbox.generate(request.tts,request.chunks,work,job);
   if(request.rate!==0){const factor=2**(request.rate/10);for(let i=0;i<request.chunks.length;i++){const file=path.join(work,'part-'+i+'.wav'),raw=path.join(work,'raw-part-'+i+'.wav');await fs.rename(file,raw);await run(this.store.ffmpeg,['-hide_banner','-nostdin','-y','-i',raw,'-af','atempo='+factor,'-c:a','pcm_s16le',file]);}}
  }else await this.voiceRequest({action:'generate',voice:request.voice,rate:request.rate,chunks:request.chunks,outputDir:work},work);
  let cursor=0;const captions=[],scenes=request.scenes.map((text,index)=>({id:randomUUID(),text,index,start:0,end:0,imageId:null}));
  const parts=[];
  for(let i=0;i<request.chunks.length;i++){
   const file=path.join(work,'part-'+i+'.wav'),duration=wavSeconds(await fs.readFile(file)),chunk=request.chunks[i];
   if(duration<.02)fail('Speech engine returned an empty phrase.');
   const scene=scenes[chunk.sceneIndex];if(!i||request.chunks[i-1].sceneIndex!==chunk.sceneIndex)scene.start=cursor;
   if(request.speechSegmentation==='sentence-v1')captions.push(...sentenceCaptions(chunk.text,cursor,duration).map(c=>({id:randomUUID(),...c})));else captions.push({id:randomUUID(),text:chunk.text,start:cursor,end:cursor+duration});cursor+=duration;scene.end=cursor;parts.push("file 'part-"+i+".wav'");
  }
  if(cursor>1200)fail('Story narration exceeds the first-version 20 minute limit.');
  await fs.writeFile(path.join(work,'parts.txt'),parts.join('\n'));
  const file=storyId+'.wav',output=path.join(this.store.root,'media',file);
  await run(this.store.ffmpeg,['-hide_banner','-nostdin','-y','-f','concat','-safe','1','-i','parts.txt','-c:a','pcm_s16le',output],{cwd:work,timeout:120000});
  const duration=wavSeconds(await fs.readFile(output));
  if(Math.abs(duration-cursor)>.002)fail('Narration concatenation changed speech timing.');
  const d={id:storyId,engine:request.engine??'windows',generation,projectId:request.projectId,revision:1,title:request.title,shape:request.shape,captionStyle:request.captionStyle,captionFont:request.captionFont??'preset',transition:request.transition??{kind:'none',seconds:.4},voice:request.voice,rate:request.rate,speechSegmentation:request.speechSegmentation??'legacy-phrases',timing:request.speechSegmentation==='sentence-v1'?'Measured sentence audio boundaries; subtitle group timing estimated within sentences (not word alignment)':'Generated phrase audio boundaries (not word alignment)',duration,scenes,captions,audio:{id:storyId,name:request.title+' narration',file,duration,width:0,height:0,kind:'audio',hasAudio:true},updatedAt:new Date().toISOString()};
  d.art=this.art.normalize({...d,art:{version:1,revision:1,settings:request.artSettings??{},scenes:[]}});
  if(request.privateDraft){await atomic(path.join(work,'speech-draft.json'),d);return d;}
  await atomic(this.file(d.id),d);job.storyId=d.id;job.sceneCount=scenes.length;job.captionCount=captions.length;job.duration=duration;
 }
 async importImage(file,name=path.basename(file)){
  if(!path.isAbsolute(file)||file.startsWith('\\\\')||file.startsWith('//')||!['.png','.jpg','.jpeg','.webp'].includes(path.extname(name).toLowerCase()))fail('Choose a local PNG, JPG or WebP image.');
  file=await fs.realpath(file);if(file.startsWith('\\\\')||file.startsWith('//'))fail('Network images are not supported.');
  const stat=await fs.stat(file);if(!stat.isFile()||stat.size>20*1024**2||stat.size<12)fail('Images must be regular files smaller than 20 MB.');
  const buffer=await fs.readFile(file);const png=buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])),jpg=buffer[0]===255&&buffer[1]===216&&buffer[2]===255,webp=buffer.toString('ascii',0,4)==='RIFF'&&buffer.toString('ascii',8,12)==='WEBP';if(!png&&!jpg&&!webp)fail('Image content must be PNG, JPG or WebP.');
  const id=randomUUID(),dir=path.join(this.root,'images');await fs.mkdir(dir,{recursive:true});
  const output=path.join(dir,id+'.png');
  // Decode to a bounded, single-frame owned PNG. Never retain uploaded executable/URL data.
  await run(this.store.ffmpeg,['-hide_banner','-nostdin','-y','-protocol_whitelist','file,pipe','-max_pixels','24000000','-i',file,'-vf','scale=1920:1920:force_original_aspect_ratio=decrease','-frames:v','1','-update','1',output]);
  const image={id,name:path.basename(name).slice(0,200),file:id+'.png'};await atomic(path.join(dir,id+'.json'),image);return image;
 }
 async image(id){const dir=path.join(this.root,'images'),image=JSON.parse(await fs.readFile(path.join(dir,key(id)+'.json'),'utf8'));return {...image,path:path.join(dir,id+'.png')};}
 async update(args){return this.store.serial(async()=>{
  const d=await this.read(args.storyId);if(d.revision!==args.expectedStoryRevision)throw new EditError('STALE_STORY','Story changed; reload it before editing.');
  if(!Array.isArray(args.imageIds)||args.imageIds.length!==d.scenes.length)fail('Provide one image ID per scene.');
  for(let i=0;i<d.scenes.length;i++){const id=args.imageIds[i];if(id!==null)await this.image(id);if(id!==null&&id!==d.scenes[i].imageId)delete d.scenes[i].video;d.scenes[i].imageId=id;}
  if(args.transitionKind!==undefined||args.transitionSeconds!==undefined)d.transition=transitionSettings(args.transitionKind??d.transition?.kind,args.transitionSeconds??d.transition?.seconds);
  if(args.captionFont!==undefined){validateCaptionFont(args.captionFont);d.captionFont=args.captionFont;}
  if(args.captionStyle!==undefined){if(!captionStyleIds.includes(args.captionStyle))fail('Choose an available caption style.');d.captionStyle=args.captionStyle;}
  if(args.boundaries!==undefined){const b=args.boundaries;if(!Array.isArray(b)||b.length!==d.scenes.length-1||b.some((v,i)=>!Number.isFinite(v)||v<.1||v>d.duration-.1||i>0&&v-b[i-1]<.1))fail('Scene boundaries must be ascending and leave at least 0.1 seconds per image.');d.scenes.forEach((s,i)=>{s.start=i?b[i-1]:0;s.end=i<b.length?b[i]:d.duration;});}
  d.revision++;d.updatedAt=new Date().toISOString();delete d.review;await atomic(this.file(d.id),d);return d;
 });}
 async candidate(d){
  if(this.store.db.project.schemaVersion!==2&&!migrationPreview(this.store.db.project).activationAvailable)fail('Existing project contains fields that cannot be safely migrated.');
  const p=this.store.db.project.schemaVersion===2?structuredClone(this.store.db.project):convertV1(this.store.db.project);
  const canvas={...({portrait:{width:720,height:1280},landscape:{width:1280,height:720},square:{width:1080,height:1080}}[d.shape]),fps:30};
  const track=kind=>({id:randomUUID(),name:kind==='video'?'Story images':'Story narration',kind,locked:false,muted:false,solo:false,targeted:true,syncLocked:true,items:[]});
  const video=track('video'),audio=track('audio'),t=timeFromSeconds,transition=transitionSettings(d.transition?.kind,d.transition?.seconds),half=transition.kind==='none'?0:transition.seconds/2;
  if(half&&d.scenes.length>1&&d.scenes.some(s=>s.end-s.start<=transition.seconds+.02))fail('Shorten the transition duration: it must be shorter than every scene.');
  const item=(asset,start,end)=>({id:randomUUID(),assetId:asset.id,start:t(start),duration:t(end-start),sourceIn:0,sourceOut:end-start,speed:1,volume:1,effects:{},origin:'layer'});
  for(const [sceneIndex,s]of d.scenes.entries()){
   if(!s.imageId&&!s.video)fail('Assign an image or video to every scene before previewing.');
   const clipLength=s.end-s.start+(sceneIndex?half:0)+(sceneIndex<d.scenes.length-1?half:0),rendered=s.video?await this.videos.render(s,canvas,clipLength):await renderStoryImage(this,s,canvas,clipLength),{image,file,duration:length,hash}=rendered;
   let asset=p.assets.find(a=>a.file===file);if(!asset){asset={id:hash,name:image.name,file,duration:length,width:canvas.width,height:canvas.height,kind:'video',hasAudio:false};p.assets.push(asset);}
   video.items.push({...item(asset,s.start-(sceneIndex?half:0),s.end+(sceneIndex<d.scenes.length-1?half:0)),...(rendered.moving?{}:{frameHold:{sourceTime:0}})});
  }
  if(!p.assets.some(a=>a.id===d.audio.id))p.assets.push(d.audio);audio.items.push({...item(d.audio,0,d.duration),audioCategory:'dialogue'});
  const seq={id:randomUUID(),name:d.title,canvas,timebase:{numerator:30,denominator:1},tracks:[video,audio],transitions:half?video.items.slice(1).map((right,i)=>({id:randomUUID(),trackId:video.id,leftItemId:video.items[i].id,rightItemId:right.id,type:transition.kind,duration:t(transition.seconds),alignment:'legacy-overlap',audio:'crossfade'})):[],captions:d.captions.map(c=>({...c,start:t(c.start),end:t(c.end)})),captionStyle:{...structuredClone(textPresets[d.captionStyle]||textPresets.clean),...(d.captionFont&&d.captionFont!=='preset'?{font:d.captionFont}:{})},...(d.captionAlignment?{captionAlignment:structuredClone(d.captionAlignment)}:{}),...(motionStyle(d.captionStyle)?{captionMotion:{preset:d.captionStyle,...(d.captionFont&&d.captionFont!=='preset'?{font:d.captionFont}:{})}}:{}),markers:d.scenes.map((s,i)=>({id:randomUUID(),time:t(s.start),label:'Scene '+(i+1)})),exportRange:null};
  p.sequences.push(seq);p.activeSequenceId=seq.id;validateV2(p);return p;
 }
 async preview(args){return this.store.serial(async()=>{
  this.store.check(args.expectedRevision,args.expectedProjectId);const d=await this.read(args.storyId);if(d.revision!==args.expectedStoryRevision)throw new EditError('STALE_STORY','Reload the story before previewing.');
  const project=await this.candidate(d),planId=digest({project,projectId:this.store.projectId,revision:this.store.db.revision,storyRevision:d.revision}),request={project,planId,storyId:d.id,storyRevision:d.revision,storyVideoFingerprints:await this.videos.snapshot(d),storyImageFingerprints:await this.creator.imageSnapshot(d)};
  await validateFrozenInputs(this.store,request);
  const job=this.renderer.jobService.start('story-preview',request,(r,j)=>this.execute(r,j),{revision:this.store.db.revision,preview:true,storyId:d.id,storyRevision:d.revision,planId});
  await atomic(path.join(this.root,planId+'.plan.json'),request);d.review={planId,jobId:job.id,baseRevision:this.store.db.revision,storyRevision:d.revision,requiresMigration:this.store.db.project.schemaVersion!==2};await atomic(this.file(d.id),d);return {job,review:d.review};
 });}
 async apply(args){return this.store.serial(async()=>{
  this.store.check(args.expectedRevision,args.expectedProjectId);const d=await this.read(args.storyId),r=d.review;
  if(!r||r.planId!==args.confirmPlanId||r.storyRevision!==d.revision||r.baseRevision!==this.store.db.revision)throw new EditError('STALE_STORY','Preview this story against the current project before applying.');
  const job=await this.renderer.jobService.status(r.jobId);if(job.status!=='complete'||job.evicted)fail('Wait for a successful story preview before applying.');
  if(r.requiresMigration&&args.allowMigration!==true)throw new EditError('MIGRATION_REQUIRED','Explicitly approve the backed-up sequence upgrade to keep your existing edit and add this story.');
  const request=JSON.parse(await fs.readFile(path.join(this.root,r.planId+'.plan.json'),'utf8'));if(digest({project:request.project,projectId:this.store.projectId,revision:r.baseRevision,storyRevision:d.revision})!==r.planId)fail('Story review integrity check failed.');
  await validateFrozenInputs(this.store,request);if(request.storyImageFingerprints)await this.creator.verifyImages(request.storyImageFingerprints);if(request.storyVideoFingerprints)await this.videos.verify(request.storyVideoFingerprints);
  const backup=await this.store.writeBackup(r.planId);const result=await this.store.commitLocked(request.project,'Create story: '+d.title);return {project:result,backup,sequenceId:request.project.activeSequenceId};
 });}
 async export(args){return this.store.serial(async()=>{
  const d=await this.read(args.storyId),r=d.review;if(!r||d.revision!==args.expectedStoryRevision||r.planId!==args.confirmPlanId||r.storyRevision!==d.revision)throw new EditError('STALE_STORY','Preview the current story before export.');
  const job=await this.renderer.jobService.status(r.jobId);if(job.status!=='complete'||job.evicted)fail('Complete a composed preview before exporting.');
  const request=JSON.parse(await fs.readFile(path.join(this.root,r.planId+'.plan.json'),'utf8'));if(digest({project:request.project,projectId:this.store.projectId,revision:r.baseRevision,storyRevision:d.revision})!==r.planId)fail('Story review integrity check failed.');
  return this.renderer.jobService.start('story-export',{...request,qualityStory:structuredClone(d)},(r,j)=>this.execute(r,j),{revision:r.baseRevision,preview:false,storyId:d.id,storyRevision:d.revision,planId:r.planId});
 });}
 async call(args={}){
  if(!args.expectedProjectId)fail('Read the project and supply expectedProjectId.');this.store.checkIdentity(args.expectedProjectId);
  if(args.artOptions){for(const k of Object.keys(args.artOptions))if(args[k]!==undefined)fail('Duplicate image action field: '+k);args={...args,...args.artOptions};}
  if(args.action?.startsWith('affiliate_'))return this.affiliate.call(args);
  if(args.action?.startsWith('creator_'))return this.creator.call(args);
  if(args.action?.startsWith('sync_'))return this.sync.call(args);
  if(args.action?.startsWith('art_'))return this.art.call(args);
  switch(args.action){case 'transition_sample':return transitionSample(this,args);case 'video_prompt_pack':return this.videos.prompts(args);case 'video_import':return this.videos.import(args.path);case 'video_read':return this.videos.read(args.creatorOptions?.clipId);case 'caption_fonts':return {fonts:await fontCatalog(),default:'preset',offline:true,note:'Font choice is independent of caption animation style. Bundled local fonts; no runtime downloads.'};case 'transition_styles':return {transitions:[{id:'none',name:'Cut (no transition)',adapted:false},...transitionCatalog],note:'257 offline transitions: basics, FFmpeg, original GL shaders and WGFX adaptations. GL uses installed local Chrome/Edge.'};case 'caption_styles':return {styles:captionStyles,renderer:'captions.js 1.10.0',timing:'Word timing is estimated within measured phrases',offline:true};case 'voices':return args.engine==='chatterbox'?this.chatterbox.voices():this.voices();case 'tts_status':return this.chatterbox.status();case 'tts_configure':return this.store.serial(()=>this.chatterbox.configure(args.settings));case 'voice_import':return this.chatterbox.importVoice(args.path);case 'list':return this.list();case 'read':return this.read(args.storyId);case 'generate':return this.generate(args);case 'image':return this.importImage(args.path);case 'update':return this.update(args);case 'preview':return this.preview(args);case 'export':return this.export(args);case 'apply':return this.apply(args);default:fail('Unknown story action.');}
 }
}
