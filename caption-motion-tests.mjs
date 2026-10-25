import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {Store,Renderer,run,probe,canonical} from './engine.mjs';
import {StoryService} from './story-service.mjs';
import {motionStyles,captionStyles,motionWords,localPreset,validateMotion} from './ui/caption-model.js';
import {getPreset,renderFrame} from 'captions.js';
import Konva from 'konva';
import 'konva/skia-backend';
import {FontLibrary} from 'skia-canvas';
import {localFont,textFontSnapshot} from './text-fonts.mjs';
import {burnMotionCaptions} from './caption-motion-renderer.mjs';
import {jobContext} from './job-context.mjs';
import {validateV2} from './sequences.mjs';
const app=path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/,'$1'));
const sha=b=>createHash('sha256').update(b).digest('hex');
test('all pinned caption presets render offline with actual library, distinct designs and word timing disclosure',async()=>{
 assert.equal(motionStyles.length,26);assert.equal(captionStyles.length,28);assert.throws(()=>validateMotion({preset:'https://bad'}));assert.throws(()=>validateMotion({preset:'motion:karaoke',url:'x'}));
 const words=motionWords([{text:'A quiet house.',start:1,end:4}],1);assert.equal(words.length,3);assert.equal(words[0].startTime,0);assert.equal(words.at(-1).endTime,3);assert.equal(words[1].startTime,words[0].endTime);
 for(const id of ['sans-bold','serif'])FontLibrary.use('AgentCut-'+id,[(await localFont(id)).file]);
 const beforeFetch=globalThis.fetch;globalThis.fetch=()=>{throw Error('Unexpected network request');};
 const stage=new Konva.Stage({width:720,height:1280}),layer=new Konva.Layer();stage.add(layer);const hashes=new Set();
 try{for(const spec of motionStyles){layer.destroyChildren();renderFrame(localPreset(spec.id,getPreset).captionsSettings,undefined,words,1,[720,1280],layer,1280/480);layer.draw();const b=await layer.getNativeCanvasElement().toBuffer('raw');assert.ok(b.some((v,i)=>i%4===3&&v>0),'Missing text '+spec.name);hashes.add(sha(b));}assert.ok(hashes.size>=20);}finally{globalThis.fetch=beforeFetch;stage.destroy();}
});
async function fixture(){const base=path.resolve(app,'../../work/caption-tests');await fs.mkdir(base,{recursive:true});const dir=await fs.mkdtemp(path.join(base,'case-')),ffmpeg=JSON.parse(await fs.readFile(path.join(app,'config.local.json'),'utf8')).ffmpeg;const store=new Store(dir,ffmpeg);await store.init();const renderer=new Renderer(store);await renderer.ready;return {dir,ffmpeg,store,renderer,service:new StoryService(store,renderer)};}
async function finish(renderer,job){await renderer.jobService.tail;const result=await renderer.jobService.status(job.id);assert.equal(result.status,'complete',result.error);return result;}
test('animated story style survives save/reload, real preview/export/apply/undo and range render',{timeout:180000,skip:process.platform!=='win32'},async()=>{
 const {dir,ffmpeg,store,renderer,service}=await fixture(),before=await fs.readFile(store.file),original=canonical(store.db.project);
 const call=(action,args={})=>service.call({action,expectedProjectId:store.projectId,...args});
 assert.equal((await call('caption_styles')).styles.length,28);
 const voices=await service.voices(),j=await finish(renderer,await call('generate',{title:'Animated story test',voice:voices.voices[0].id,script:'Someone inside was calling my name.',captionStyle:'motion:karaoke'}));let d=await service.read(j.storyId);
 const image=path.join(dir,'image.png');await run(ffmpeg,['-hide_banner','-nostdin','-y','-f','lavfi','-i','color=c=0x152c28:s=720x1280','-frames:v','1','-update','1',image]);const im=await call('image',{path:image});
 const update=style=>call('update',{storyId:d.id,expectedStoryRevision:d.revision,imageIds:[im.id],captionStyle:style});
 d=await update('motion:focus-box');await assert.rejects(()=>update('remote:url'),/caption style/);
 const stale=d.revision;d=await update('motion:karaoke');await assert.rejects(()=>call('update',{storyId:d.id,expectedStoryRevision:stale,imageIds:[im.id],captionStyle:'clean'}),/changed/);
 const preview=await call('preview',{storyId:d.id,expectedStoryRevision:d.revision,expectedRevision:store.db.revision});const done=await finish(renderer,preview.job);d=await service.read(d.id);assert.equal(done.captionMotion.name,'Karaoke');assert.equal(done.captionMotion.offline,true);
 const meta=await probe(ffmpeg,done.path);assert.equal(meta.width,720);assert.equal(meta.height,1280);assert.equal(meta.hasAudio,true);assert.ok(Math.abs(meta.duration-d.duration)<.12);assert.deepEqual(await fs.readFile(store.file),before);
 const request=JSON.parse(await fs.readFile(path.join(service.root,d.review.planId+'.plan.json'),'utf8')),seq=request.project.sequences.at(-1);assert.equal(seq.captionMotion.preset,'motion:karaoke');assert.ok((await textFontSnapshot(request.project)).some(f=>f.id==='sans-bold'));assert.throws(()=>validateV2({...request.project,sequences:request.project.sequences.map(s=>({...s,captionMotion:{preset:'invalid'}}))}));
 const exported=await finish(renderer,await call('export',{storyId:d.id,expectedStoryRevision:d.revision,confirmPlanId:d.review.planId}));
 const pixels=[];for(const [n,file]of [['preview',done.path],['export',exported.path]]){const out=path.join(dir,n+'.rgb');await run(ffmpeg,['-hide_banner','-nostdin','-y','-ss','0.7','-i',file,'-frames:v','1','-f','rawvideo','-pix_fmt','rgb24',out]);pixels.push(sha(await fs.readFile(out)));}assert.equal(pixels[0],pixels[1],'preview/export decoded pixels differ');
 await call('apply',{storyId:d.id,expectedRevision:store.db.revision,confirmPlanId:d.review.planId,allowMigration:true});assert.equal(store.db.project.sequences.at(-1).captionMotion.preset,'motion:karaoke');
 const ranged=structuredClone(store.db.project);ranged.sequences.at(-1).exportRange={start:{numerator:'1',denominator:'2'},end:{numerator:'3',denominator:'2'}};const rangeJob={id:'range-'+Date.now(),status:'rendering',revision:store.db.revision};await renderer.render(ranged,rangeJob);assert.equal(rangeJob.captionMotion.frames,30);
 await store.undo({expectedProjectId:store.projectId,expectedRevision:store.db.revision});assert.equal(canonical(store.db.project),original);
 d=await update('motion:cinema');assert.equal(d.review,undefined);await assert.rejects(()=>call('export',{storyId:d.id,expectedStoryRevision:d.revision,confirmPlanId:preview.review.planId}),/Preview/);
 await fs.writeFile(path.join(dir,'acceptance.json'),JSON.stringify({dir,preview:done.path,export:exported.path,projectUnchanged:true,pixelMatch:true,motion:done.captionMotion,range:rangeJob.path},null,2));console.log(JSON.stringify({evidence:dir}));
});
test('caption encoder cancellation releases its owned child process',{timeout:30000},async()=>{
 const {dir,ffmpeg}=await fixture(),input=path.join(dir,'base.mp4');await run(ffmpeg,['-hide_banner','-nostdin','-y','-f','lavfi','-i','color=c=black:s=160x160:r=30:d=1','-c:v','libx264',input]);
 const controller=new AbortController(),pids=new Set();await assert.rejects(()=>jobContext.run({signal:controller.signal,onSpawn:pid=>{pids.add(pid);controller.abort();},onExit:pid=>pids.delete(pid)},()=>burnMotionCaptions({ffmpeg},{input,output:path.join(dir,'out.mp4'),canvas:{width:160,height:160,fps:30},duration:1,captions:[{text:'Cancel this caption.',start:0,end:1}],preset:'motion:karaoke'},{})),/CANCELED/);assert.equal(pids.size,0);
});
