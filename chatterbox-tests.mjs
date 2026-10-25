import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Store,Renderer,run,probe} from './engine.mjs';
import {StoryService,wavSeconds} from './story-service.mjs';
import {ChatterboxService} from './chatterbox-service.mjs';
const root=path.dirname(fileURLToPath(import.meta.url));
const files=['ve.safetensors','t3_nano_v1.safetensors','s3gen_meanflow.safetensors','conds.pt','merges.txt','vocab.json','tokenizer_config.json','special_tokens_map.json','added_tokens.json'];
async function fixture(){const parent=path.resolve(root,'../../work/chatterbox-tests');await fs.mkdir(parent,{recursive:true});const dir=await fs.mkdtemp(path.join(parent,'case-')),ffmpeg=JSON.parse(await fs.readFile(path.join(root,'config.local.json'),'utf8')).ffmpeg,store=new Store(dir,ffmpeg);await store.init();const renderer=new Renderer(store);await renderer.ready;const service=new StoryService(store,renderer);return {dir,store,renderer,service,ffmpeg};}
async function simulatedRuntime(f){const pythonPath=path.join(f.dir,process.platform==='win32'?'python.exe':'python'),modelDir=path.join(f.dir,'model');await fs.writeFile(pythonPath,'test-interpreter');await fs.mkdir(modelDir);for(const name of files)await fs.writeFile(path.join(modelDir,name),'simulated model fixture');f.service.chatterbox.invoke=async()=>({version:'simulated-test-only',cudaAvailable:false,python:'test'});await f.service.chatterbox.configure({pythonPath,modelDir,model:'nano',device:'cpu',threads:2});return {pythonPath,modelDir,model:'nano',device:'cpu',threads:2};}
async function finish(f,j,status='complete'){await f.renderer.jobService.tail;const done=await f.renderer.jobService.status(j.id);assert.equal(done.status,status,done.error);return done;}
test('optional setup is closed, local, persistent and rejects changed frozen model files without touching project',async()=>{
 const f=await fixture(),c=f.service.chatterbox,before=await fs.readFile(f.store.file);assert.equal((await c.status()).ready,false);
 await assert.rejects(()=>c.configure({url:'https://example.invalid'}),e=>e.code==='CHATTERBOX_CONFIG');await assert.rejects(()=>c.configure({threads:20}),e=>e.code==='CHATTERBOX_CONFIG');await assert.rejects(()=>c.configure({pythonPath:'relative.exe'}),e=>e.code==='CHATTERBOX_PATH');
 const settings=await simulatedRuntime(f);assert.equal((await new ChatterboxService(f.store).status()).ready,true);const frozen=await c.freeze('builtin');assert.equal(frozen.reference,null);
 await fs.appendFile(path.join(settings.modelDir,'t3_nano_v1.safetensors'),'changed');assert.equal((await c.status()).ready,false);await assert.rejects(()=>c.verify(frozen.config),e=>e.code==='CHATTERBOX_CHANGED');assert.deepEqual(await fs.readFile(f.store.file),before);
});
test('reference imports are owned, bounded and content-checked; simulated adapter feeds real timed WAV/FFmpeg output',{timeout:30000},async()=>{
 const f=await fixture(),c=f.service.chatterbox;await simulatedRuntime(f);const before=await fs.readFile(f.store.file),source=path.join(f.dir,'reference.wav');
 await run(f.ffmpeg,['-hide_banner','-nostdin','-y','-f','lavfi','-i','sine=frequency=220:duration=6','-ac','1','-ar','24000',source]);const voice=await c.importVoice(source,'Test reference.wav'),frozen=await c.freeze(voice.id);assert.equal((await c.voices()).voices.length,2);
 await fs.appendFile(frozen.reference.path,'changed');await assert.rejects(()=>c.verifyReference(frozen.reference),e=>e.code==='VOICE_CHANGED');
 await assert.rejects(()=>c.freeze('../unsafe'),e=>e.code==='INVALID_VOICE');
 c.generate=async(settings,chunks,dir,job)=>{for(let i=0;i<chunks.length;i++)await run(f.ffmpeg,['-hide_banner','-nostdin','-y','-f','lavfi','-i','sine=frequency=440:duration=1','-ac','1','-ar','24000',path.join(dir,'part-'+i+'.wav')]);return {engine:'chatterbox',simulated:true};};
 const job=await f.service.generate({expectedProjectId:f.store.projectId,engine:'chatterbox',voice:'builtin',title:'Adapter fixture',script:'One short phrase.\n\nA second phrase.',rate:2});const done=await finish(f,job),d=await f.service.read(done.storyId);assert.equal(d.engine,'chatterbox');assert.equal(d.generation.simulated,true);assert.equal(d.scenes.length,2);assert.ok(d.duration<2&&d.duration>1.5);assert.equal(d.scenes[0].end,d.scenes[1].start);assert.equal(d.captions.at(-1).end,d.duration);assert.equal(wavSeconds(await fs.readFile(f.store.assetPath(d.audio))),d.duration);assert.deepEqual(await fs.readFile(f.store.file),before);
});
test('queued Chatterbox cancellation and changed-model retry preserve project and frozen setup',{timeout:30000},async()=>{
 const f=await fixture(),settings=await simulatedRuntime(f),before=await fs.readFile(f.store.file);let release;f.renderer.jobService.tail=new Promise(r=>release=r);
 const job=await f.service.generate({expectedProjectId:f.store.projectId,engine:'chatterbox',voice:'builtin',title:'Queue fixture',script:'A short test.'});await f.renderer.jobService.cancel(job.id);release();await finish(f,job,'canceled');
 await fs.appendFile(path.join(settings.modelDir,'ve.safetensors'),'modified');const retried=await f.renderer.jobService.retry(job.id,(r,j)=>f.service.execute(r,j));const done=await finish(f,retried,'failed');assert.equal(done.errorCode,'CHATTERBOX_CHANGED');assert.deepEqual(await fs.readFile(f.store.file),before);
});
test('real local Nano generates offline speech and a portrait MP4 with audio and timed captions',{skip:process.env.AGENT_CUT_REAL_CHATTERBOX!=='1',timeout:240000},async()=>{
 const f=await fixture(),before=await fs.readFile(f.store.file),status=await f.service.chatterbox.configure({});assert.equal(status.ready,true);
 const job=await f.service.generate({expectedProjectId:f.store.projectId,engine:'chatterbox',voice:'builtin',title:'Local Chatterbox demo',script:'The house was silent.\n\nThen a light appeared.',shape:'portrait'});const done=await finish(f,job),d=await f.service.read(done.storyId);assert.equal(d.generation.offline,true);assert.equal(d.generation.model,'nano');assert.ok(d.duration>1);assert.equal(d.scenes.length,2);
 const images=[];for(const color of ['navy','darkgreen']){const file=path.join(f.dir,color+'.png');await run(f.ffmpeg,['-hide_banner','-nostdin','-y','-f','lavfi','-i',`color=c=${color}:s=180x320`,'-frames:v','1','-update','1',file]);images.push(await f.service.importImage(file));}
 const updated=await f.service.update({storyId:d.id,expectedStoryRevision:d.revision,imageIds:images.map(i=>i.id)});const preview=await f.service.preview({storyId:d.id,expectedStoryRevision:updated.revision,expectedProjectId:f.store.projectId,expectedRevision:f.store.db.revision});const rendered=await finish(f,preview.job),meta=await probe(f.ffmpeg,rendered.path);assert.equal(meta.width,720);assert.equal(meta.height,1280);assert.equal(meta.hasAudio,true);assert.ok(Math.abs(meta.duration-d.duration)<.15);assert.deepEqual(await fs.readFile(f.store.file),before);
 const evidence={directory:f.dir,generation:d.generation,duration:d.duration,narration:f.store.assetPath(d.audio),video:rendered.path,sceneCount:d.scenes.length,captionCount:d.captions.length,projectUnchanged:true};await fs.writeFile(path.join(f.dir,'chatterbox-acceptance.json'),JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence));
});
