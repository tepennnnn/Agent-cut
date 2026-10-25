import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {StoryService,splitStory,speechChunks,wavSeconds} from './story-service.mjs';
import {Store,Renderer,run,probe,canonical} from './engine.mjs';
import {timeSeconds} from './sequences.mjs';
import {parseSubtitles,exportSubtitles} from './subtitles.mjs';
const app=path.dirname(fileURLToPath(import.meta.url));
test('story parsing keeps paragraph order and speech text; rejects oversized/control input',()=>{
 assert.deepEqual(splitStory('Scene 1: A quiet night.\n\nScene 2: The door opens.'),['A quiet night.','The door opens.']);
 assert.deepEqual(splitStory('One line\ncontinues.\n\nSecond scene.'),['One line continues.','Second scene.']);
 const chunks=speechChunks(['One two three four five six seven eight nine ten. A new sentence.']);assert.equal(chunks.length,2);assert.equal(chunks.map(c=>c.text).join(' '),'One two three four five six seven eight nine ten. A new sentence.');
 assert.throws(()=>splitStory('x'.repeat(12001)));assert.throws(()=>splitStory('x\0'));assert.throws(()=>splitStory(Array(61).fill('scene').join('\n\n')));assert.throws(()=>wavSeconds(Buffer.from('not audio')));
});
async function fixture(){const base=path.resolve(app,'../../work/story-tests');await fs.mkdir(base,{recursive:true});const dir=await fs.mkdtemp(path.join(base,'case-')),ffmpeg=JSON.parse(await fs.readFile(path.join(app,'config.local.json'),'utf8')).ffmpeg;const store=new Store(dir,ffmpeg);await store.init();const renderer=new Renderer(store);await renderer.ready;return {dir,store,renderer,service:new StoryService(store,renderer),ffmpeg};}
async function finish(renderer,job){await renderer.jobService.tail;const done=await renderer.jobService.status(job.id);assert.equal(done.status,'complete',done.error);return done;}
test('offline generated story composes real image/audio/caption output, guarded apply/backup/undo, export and reload',{skip:process.platform!=='win32',timeout:180000},async()=>{
 const {dir,store,renderer,service,ffmpeg}=await fixture();
 const oldFile=path.join(dir,'original.mp4');await run(ffmpeg,['-hide_banner','-nostdin','-y','-f','lavfi','-i','color=c=green:s=320x180:r=30:d=1','-an','-c:v','libx264','-pix_fmt','yuv420p',oldFile]);await store.import({path:oldFile});
 const old=structuredClone(store.db.project);old.clips=[{id:'original-clip',assetId:old.assets[0].id,sourceIn:0,sourceOut:1,speed:1,volume:1,effects:{}}];await store.commit(old,'Existing edit fixture');
 const before=await fs.readFile(store.file),original=canonical(store.db.project),voices=await service.voices();assert.ok(voices.voices.length,JSON.stringify(voices));
 const call=(action,args={})=>service.call({action,expectedProjectId:store.projectId,...args});
 await assert.rejects(()=>service.call({action:'list'}));await assert.rejects(()=>call('generate',{script:'Hello',voice:'../bad'}));
 const generated=await finish(renderer,await call('generate',{title:'Story acceptance',script:'The house was quiet.\n\nThen the light appeared.',voice:voices.voices[0].id,shape:'portrait'}));
 let d=await call('read',{storyId:generated.storyId});assert.equal(d.scenes.length,2);assert.equal(d.captions.length,2);assert.equal(d.scenes[0].end,d.scenes[1].start);assert.equal(d.captions.at(-1).end,d.duration);assert.deepEqual(await fs.readFile(store.file),before);
 const guard=()=>({storyId:d.id,expectedStoryRevision:d.revision,expectedRevision:store.db.revision});
 await assert.rejects(()=>call('preview',guard()),/image (?:or video )?to every scene/);
 const images=[];for(const color of ['red','blue']){const file=path.join(dir,color+'.png');await run(ffmpeg,['-hide_banner','-nostdin','-y','-f','lavfi','-i',`color=c=${color}:s=180x320`,'-frames:v','1','-update','1',file]);images.push(await call('image',{path:file}));}
 await assert.rejects(()=>call('update',{...guard(),expectedStoryRevision:0,imageIds:images.map(i=>i.id)}),e=>e.code==='STALE_STORY');
 d=await call('update',{...guard(),imageIds:images.map(i=>i.id),boundaries:[d.scenes[0].end]});
 await assert.rejects(()=>call('update',{...guard(),imageIds:images.map(i=>i.id),boundaries:[-1]}));
 const preview=await call('preview',guard());d=await call('read',{storyId:d.id});const composed=await finish(renderer,preview.job),metadata=await probe(ffmpeg,composed.path);assert.equal(metadata.width,720);assert.equal(metadata.height,1280);assert.equal(metadata.hasAudio,true);assert.ok(Math.abs(metadata.duration-d.duration)<.12);assert.deepEqual(await fs.readFile(store.file),before);
 const subtitle=exportSubtitles(JSON.parse(await fs.readFile(path.join(service.root,d.review.planId+'.plan.json'),'utf8')).project);assert.equal(parseSubtitles(subtitle.text).length,2);
 await assert.rejects(()=>call('apply',{storyId:d.id,expectedRevision:store.db.revision,confirmPlanId:d.review.planId}),e=>e.code==='MIGRATION_REQUIRED');
 await assert.rejects(()=>call('apply',{storyId:d.id,expectedRevision:store.db.revision,confirmPlanId:'wrong',allowMigration:true}),e=>e.code==='STALE_STORY');
 const exported=await finish(renderer,await call('export',{...guard(),confirmPlanId:d.review.planId}));assert.equal(exported.preview,false);assert.ok((await fs.stat(exported.path)).size>1000);
 const applied=await call('apply',{storyId:d.id,expectedRevision:store.db.revision,confirmPlanId:d.review.planId,allowMigration:true});assert.ok(await fs.stat(applied.backup.path));assert.equal(store.db.project.sequences.length,2);assert.equal(store.db.project.sequences[0].tracks[0].items[0].id,'original-clip');const seq=store.db.project.sequences.at(-1);assert.equal(seq.tracks[0].items.length,2);assert.equal(seq.tracks[1].items.length,1);assert.ok(Math.abs(timeSeconds(seq.captions[1].start)-d.captions[1].start)<1e-9);
 await store.undo({expectedRevision:store.db.revision,expectedProjectId:store.projectId});assert.equal(canonical(store.db.project),original);
 const restarted=new StoryService(store,renderer);assert.equal((await restarted.read(d.id)).revision,d.revision);assert.equal((await restarted.list()).stories.length,1);
 d=await call('update',{...guard(),imageIds:images.map(i=>i.id),boundaries:[d.scenes[0].end+.1]});assert.equal(d.review,undefined);await assert.rejects(()=>call('export',{...guard(),confirmPlanId:preview.review.planId}),e=>e.code==='STALE_STORY');
 const retried=await finish(renderer,await renderer.jobService.retry(generated.id,(r,j)=>service.execute(r,j)));assert.notEqual(retried.storyId,d.id);assert.equal((await call('read',{storyId:d.id})).revision,d.revision);
 console.log(JSON.stringify({evidence:dir,preview:composed.path,export:exported.path,duration:d.duration,scenes:2,captions:2}));
});
