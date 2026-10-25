import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Store,Renderer,apply,canonical,run} from './engine.mjs';
import {convertV1,timeSeconds} from './sequences.mjs';
import {keyframeValue,sliceKeyframes,validateKeyframes} from './keyframes.mjs';
const root=path.dirname(fileURLToPath(import.meta.url));
const fixture=()=>convertV1({title:'Animation fixture',canvas:{width:320,height:180,fps:30},assets:[{id:'a',file:'red.mp4',name:'Red',duration:4,width:320,height:180,hasAudio:true}],clips:[{id:'clip',assetId:'a',sourceIn:0,sourceOut:4,speed:1,volume:1}],captions:[]});
const edit=(p,operations)=>{let n=0;return apply(p,operations,{allocateId:()=>`animation-${++n}`});};
const op=(p,type,fields)=>({type,sequenceId:p.activeSequenceId,itemId:'clip',...fields});

test('keyframes validate bounds, track kind, interpolation, ordering, locks and atomic rollback',()=>{
 const p=fixture(),frames=[{time:0,value:0},{time:4,value:1}],before=canonical(p),q=edit(p,[op(p,'item_keyframes',{property:'opacity',frames})]);assert.deepEqual(q.sequences[0].tracks[0].items[0].keyframes.opacity,frames);
 for(const invalid of [[{time:0,value:2}],[{time:5,value:.5}],[{time:1,value:.5},{time:1,value:.6}],[{time:2,value:.5},{time:1,value:.6}],[{time:0,value:.5,interpolation:'bezier'}],Array.from({length:33},(_,i)=>({time:i/10,value:.5}))])assert.throws(()=>edit(p,[op(p,'item_keyframes',{property:'opacity',frames:invalid})]));
 assert.throws(()=>edit(p,[op(p,'item_keyframes',{property:'volume',frames})]));const audio=p.sequences[0].tracks[1].items[0].id;assert.throws(()=>edit(p,[op(p,'item_keyframes',{itemId:audio,property:'opacity',frames})]));
 const locked=edit(p,[{type:'track_update',sequenceId:p.activeSequenceId,trackId:p.sequences[0].tracks[0].id,locked:true}]);assert.throws(()=>edit(locked,[op(p,'item_keyframes',{property:'opacity',frames})]),e=>e.code==='TRACK_LOCKED');assert.equal(canonical(p),before);
 const cleared=edit(q,[op(p,'item_keyframes_clear',{property:'opacity'})]);assert.equal(cleared.sequences[0].tracks[0].items[0].keyframes,undefined);
 assert.throws(()=>edit(q,[op(p,'item_trim',{sourceIn:0,sourceOut:2})]));
});

test('linear/hold automation clamps endpoints and remains equivalent after split, insert and range fragments',()=>{
 for(const interpolation of ['linear','hold']){
   const frames=[{time:0,value:.1,interpolation},{time:2,value:.7,interpolation},{time:4,value:.3}],p=fixture(),q=edit(p,[op(p,'item_keyframes',{property:'opacity',frames})]);
   assert.equal(keyframeValue(frames,-1),.1);assert.equal(keyframeValue(frames,5),.3);assert.equal(keyframeValue(frames,1),interpolation==='linear'?.4:.1);
   const split=edit(q,[op(p,'item_split',{time:1})]),items=split.sequences[0].tracks[0].items;
   for(const item of items)for(const local of [0,.25,.75]){const original=timeSeconds(item.start)+local;assert.ok(Math.abs(keyframeValue(item.keyframes.opacity,local)-keyframeValue(frames,original))<1e-8);}
   const inserted=edit(q,[{type:'sequence_insert_gap',sequenceId:p.activeSequenceId,time:1,duration:1}]);const right=inserted.sequences[0].tracks[0].items.find(i=>timeSeconds(i.start)===2);assert.ok(Math.abs(keyframeValue(right.keyframes.opacity,.5)-keyframeValue(frames,1.5))<1e-8);
   const removed=edit(q,[{type:'sequence_remove_range',sequenceId:p.activeSequenceId,start:1,end:2}]);const fragment=removed.sequences[0].tracks[0].items.find(i=>timeSeconds(i.start)===1);assert.equal(keyframeValue(fragment.keyframes.opacity,0),keyframeValue(frames,2));
 }
});

test('animated plans are deterministic, persist and undo/redo without affecting linked audio',async()=>{
 const work=path.resolve(root,'../../work/keyframe-tests');await fs.mkdir(work,{recursive:true});const data=await fs.mkdtemp(path.join(work,'state-')),store=new Store(data,'unused');await store.init();const p=fixture();await store.commit(p,'Fixture');
 const args={expectedRevision:store.read().revision,expectedProjectId:store.projectId,summary:'Animate opacity',operations:[op(p,'item_keyframes',{property:'opacity',frames:[{time:0,value:0},{time:4,value:1}]})]};const plan=await store.plan(args);assert.deepEqual(await store.plan(args),plan);await store.edit({...args,expectedPlanId:plan.planId});const after=canonical(store.db.project);assert.equal(store.db.project.sequences[0].tracks[1].items[0].keyframes,undefined);const reopened=new Store(data,'unused');await reopened.init();assert.equal(canonical(reopened.db.project),after);await reopened.undo({expectedRevision:reopened.read().revision});assert.deepEqual(reopened.db.project,p);await reopened.redo({expectedRevision:reopened.read().revision});assert.equal(canonical(reopened.db.project),after);
});

test('real native render animates alpha, geometry, color and audio gain',{timeout:60000},async()=>{
 const ffmpeg=JSON.parse(await fs.readFile(path.join(root,'config.local.json'),'utf8')).ffmpeg,work=path.resolve(root,'../../work/keyframe-tests');await fs.mkdir(work,{recursive:true});const data=await fs.mkdtemp(path.join(work,'render-')),store=new Store(data,ffmpeg);await store.init();
 for(const color of ['red','blue'])await run(ffmpeg,['-hide_banner','-nostdin','-y','-f','lavfi','-i',`color=c=${color}:s=320x180:r=30`,'-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','4','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac',path.join(data,'media',color+'.mp4')]);
 const p=fixture(),s=p.sequences[0],video=s.tracks[0],audio=s.tracks[1],red=video.items[0];p.assets.push({...p.assets[0],id:'blue',file:'blue.mp4',name:'Blue'});s.tracks.unshift({...structuredClone(video),id:'lower',name:'Blue lower',items:[{...structuredClone(red),id:'blue-item',assetId:'blue',origin:'native',linkGroupId:undefined}]});
 red.keyframes={opacity:[{time:0,value:0,interpolation:'ease_in'},{time:4,value:1}],rotation:[{time:0,value:0,interpolation:'ease_in_out'},{time:4,value:10}],contrast:[{time:0,value:1,interpolation:'bezier',control1:.2,control2:.8},{time:4,value:1.1}],saturation:[{time:0,value:1},{time:4,value:1.1}]};audio.items[0].keyframes={volume:[{time:0,value:0,interpolation:'ease_in'},{time:4,value:1}]};
 const renderer=new Renderer(store),job={id:'animated',status:'rendering'};await renderer.render(p,job);
 const stats=async(file,time,filter='')=>{const {err}=await run(ffmpeg,['-hide_banner','-nostdin','-ss',String(time),'-i',file,'-vf',filter+'signalstats,metadata=print','-frames:v','1','-f','null','-']);return Object.fromEntries(['YAVG','UAVG','VAVG'].map(k=>[k,Number(err.match(new RegExp('lavfi.signalstats.'+k+'=([\\d.]+)'))?.[1])]));};
 assert.ok((await stats(job.path,1)).VAVG<130,'Ease-in at quarter duration must remain closer to blue than a linear ramp');
 const early=await stats(job.path,.15),late=await stats(job.path,3.7);assert.ok(early.UAVG>200&&late.VAVG>200,JSON.stringify({early,late}));
 const volume=async(time)=>{const {err}=await run(ffmpeg,['-hide_banner','-nostdin','-ss',String(time),'-i',job.path,'-t','0.3','-vn','-af','volumedetect','-f','null','-']);return Number(err.match(/mean_volume: (-?[\d.]+) dB/)?.[1]);};assert.ok(await volume(3.5)-await volume(.1)>12,'Volume automation must increase audible gain');
 delete red.keyframes.opacity;red.keyframes.brightness=[{time:0,value:0,interpolation:'hold'},{time:2,value:.25}];red.keyframes.offsetX=[{time:0,value:-.5},{time:4,value:.5}];red.keyframes.offsetY=[{time:0,value:0},{time:4,value:0}];s.tracks.shift();const motion={id:'motion',status:'rendering'};await renderer.render(p,motion);
 assert.ok((await stats(motion.path,.1,'crop=80:80:0:40,')).YAVG>40);assert.ok((await stats(motion.path,.1,'crop=80:80:240:40,')).YAVG<25);assert.ok((await stats(motion.path,3.8,'crop=80:80:240:40,')).YAVG>80);
 await store.commit(p,'Animation output fixture');const frame=await renderer.frame(3.8);assert.ok((await stats(frame.path,0,'crop=80:80:240:40,')).YAVG>80,'Composed frame must include automation');
});


test('eased and bounded cubic curves remain exact through splits, repeated slices and range edits',()=>{
 for(const interpolation of ['ease_in','ease_out','ease_in_out','bezier']){
   const control=interpolation==='bezier'?{control1:.8,control2:.2}:{},frames=[{time:0,value:.2,interpolation,...control},{time:2,value:.9,interpolation,...control},{time:4,value:.1}],p=fixture(),q=edit(p,[op(p,'item_keyframes',{property:'opacity',frames})]);
   const split=edit(q,[op(p,'item_split',{time:.7})]);for(const item of split.sequences[0].tracks[0].items){const start=timeSeconds(item.start),length=timeSeconds(item.duration);for(let n=0;n<=30;n++){const t=length*n/30;assert.ok(Math.abs(keyframeValue(item.keyframes.opacity,t)-keyframeValue(frames,start+t))<1e-9,interpolation+' split');}}
   const part={keyframes:{opacity:structuredClone(frames)}};sliceKeyframes(part,.4,3.6);sliceKeyframes(part,.2,2);validateKeyframes(part,1.8,'video');for(let n=0;n<=30;n++){const t=1.8*n/30;assert.ok(Math.abs(keyframeValue(part.keyframes.opacity,t)-keyframeValue(frames,.6+t))<1e-9,interpolation+' repeated slice');}
   const removed=edit(q,[{type:'sequence_remove_range',sequenceId:p.activeSequenceId,start:.5,end:1.5}]),right=removed.sequences[0].tracks[0].items.find(i=>timeSeconds(i.start)===.5);for(let n=0;n<=20;n++){const t=2.5*n/20;assert.ok(Math.abs(keyframeValue(right.keyframes.opacity,t)-keyframeValue(frames,1.5+t))<1e-9);}
 }
 assert.equal(keyframeValue([{time:0,value:0,interpolation:'ease_in'},{time:1,value:1}],.25),.0625);assert.equal(keyframeValue([{time:0,value:0,interpolation:'ease_out'},{time:1,value:1}],.25),.4375);
 const p=fixture();for(const frame of [{time:0,value:0,interpolation:'bezier',control1:-.1,control2:1},{time:0,value:0,interpolation:'linear',control1:0,control2:1},{time:0,value:0,interpolation:'bezier',control1:0,control2:2}])assert.throws(()=>edit(p,[op(p,'item_keyframes',{property:'opacity',frames:[frame,{time:4,value:1}]})]));
});
