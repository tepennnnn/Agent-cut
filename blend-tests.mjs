import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Store,Renderer,apply,canonical,run} from './engine.mjs';
import {convertV1,timeFromSeconds as T} from './sequences.mjs';
const root=path.dirname(fileURLToPath(import.meta.url));
const fixture=()=>convertV1({title:'Blend fixture',canvas:{width:320,height:180,fps:30},assets:[{id:'base',name:'Base gray',file:'base.mp4',duration:2,width:320,height:180,hasAudio:false},{id:'upper',name:'Upper gray',file:'upper.mp4',duration:2,width:320,height:180,hasAudio:false}],clips:[{id:'clip',assetId:'base',sourceIn:0,sourceOut:2,speed:1,volume:1}],captions:[]});
const operation=(p,mode)=>({type:'item_blend',sequenceId:p.activeSequenceId,itemId:'clip',mode});

test('blend commands validate kind, enum and locks and reset without metadata residue',()=>{
 const p=fixture(),before=canonical(p),q=apply(p,[operation(p,'multiply')]);assert.equal(q.sequences[0].tracks[0].items[0].blendMode,'multiply');assert.deepEqual(apply(q,[operation(p,'normal')]),p);
 for(const op of [{...operation(p,'invalid')},{...operation(p,'screen'),itemId:'missing'}])assert.throws(()=>apply(p,[op]));
 const locked=apply(p,[{type:'track_update',sequenceId:p.activeSequenceId,trackId:p.sequences[0].tracks[0].id,locked:true}]);assert.throws(()=>apply(locked,[operation(p,'screen')]),e=>e.code==='TRACK_LOCKED');assert.equal(canonical(p),before);
 const split=apply(p,[{type:'item_split',sequenceId:p.activeSequenceId,itemId:'clip',time:1}],{allocateId:(()=>{let n=0;return()=>`split-${++n}`;})()});assert.throws(()=>apply(split,[operation(p,'multiply'),{type:'sequence_transition',sequenceId:p.activeSequenceId,itemId:'clip',seconds:.2}]),/attached dissolve\/transition/);
 const withAudio=fixture();withAudio.assets[0].hasAudio=true;withAudio.sequences[0].tracks.push({id:'audio',kind:'audio',name:'Audio',role:'native',locked:false,muted:false,solo:false,targeted:false,syncLocked:true,items:[{...structuredClone(withAudio.sequences[0].tracks[0].items[0]),id:'audio-item',origin:'native'}]});assert.throws(()=>apply(withAudio,[{...operation(p,'multiply'),itemId:'audio-item'}]),/video item/);
 const bad=structuredClone(p);bad.sequences[0].tracks[0].items[0].blendMode='bogus';assert.throws(()=>apply(bad,[{type:'project_rename',title:'Reject'}]));
});

test('blend plans persist, replay deterministically, undo/redo and detect no-op reset',async()=>{
 const work=path.resolve(root,'../../work/blend-tests');await fs.mkdir(work,{recursive:true});const data=await fs.mkdtemp(path.join(work,'state-')),s=new Store(data,'unused');await s.init();const p=fixture();await s.commit(p,'Fixture');
 const args={expectedProjectId:s.projectId,expectedRevision:s.read().revision,summary:'Multiply',operations:[operation(p,'multiply')]},plan=await s.plan(args);assert.deepEqual(await s.plan(args),plan);await s.edit({...args,expectedPlanId:plan.planId});const reopened=new Store(data,'unused');await reopened.init();assert.equal(reopened.db.project.sequences[0].tracks[0].items[0].blendMode,'multiply');await reopened.undo({expectedRevision:reopened.read().revision});assert.deepEqual(reopened.db.project,p);await reopened.redo({expectedRevision:reopened.read().revision});assert.equal(reopened.db.project.sequences[0].tracks[0].items[0].blendMode,'multiply');
 await reopened.edit({expectedRevision:reopened.read().revision,summary:'Reset',operations:[operation(p,'normal')]});const revision=reopened.read().revision;await reopened.edit({expectedRevision:revision,summary:'No-op reset',operations:[operation(p,'normal')]});assert.equal(reopened.read().revision,revision);
});

test('native RGB blends match numeric reference colors, alpha and temporal gaps',{timeout:60000},async()=>{
 const ffmpeg=JSON.parse(await fs.readFile(path.join(root,'config.local.json'),'utf8')).ffmpeg,work=path.resolve(root,'../../work/blend-tests');await fs.mkdir(work,{recursive:true});const data=await fs.mkdtemp(path.join(work,'render-')),s=new Store(data,ffmpeg);await s.init();
 for(const [name,color]of [['base','0x808080'],['upper','0xC0C0C0']])await run(ffmpeg,['-hide_banner','-nostdin','-y','-f','lavfi','-i',`color=c=${color}:s=320x180:r=30`,'-t','2','-c:v','libx264','-pix_fmt','yuv420p',path.join(data,'media',name+'.mp4')]);
 const p=fixture(),seq=p.sequences[0],base=seq.tracks[0],upper={...structuredClone(base),id:'upper-track',name:'Upper',items:[{...structuredClone(base.items[0]),id:'upper-item',assetId:'upper',start:T(.5),duration:T(1),sourceOut:1,origin:'native'}]};seq.tracks.push(upper);const item=upper.items[0],renderer=new Renderer(s);
 const y=async(file,time,filter='')=>{const {err}=await run(ffmpeg,['-hide_banner','-nostdin','-ss',String(time),'-i',file,'-vf',filter+'signalstats,metadata=print','-frames:v','1','-f','null','-']);return Number(err.match(/lavfi.signalstats.YAVG=([\d.]+)/)?.[1]);};
 const expected={normal:192,multiply:128*192/255,screen:255-(255-128)*(255-192)/255,darken:128,lighten:192,difference:64,addition:255};
 for(const [mode,value]of Object.entries(expected)){item.blendMode=mode;const job={id:mode,status:'rendering'};await renderer.render(p,job);const actual=await y(job.path,1),reference=16+219*value/255;assert.ok(Math.abs(actual-reference)<5,`${mode}: expected Y ${reference}, got ${actual}`);assert.ok(Math.abs(await y(job.path,.2)-(16+219*128/255))<5,mode+' must preserve leading background');assert.ok(Math.abs(await y(job.path,1.8)-(16+219*128/255))<5,mode+' must preserve trailing background');}
 item.blendMode='multiply';item.effects={opacity:.5};const alpha={id:'alpha',status:'rendering'};await renderer.render(p,alpha);assert.ok(Math.abs(await y(alpha.path,1)-(16+219*((128+128*192/255)/2)/255))<5,'Blend must be interpolated using foreground alpha');
 item.effects={offsetX:.5};const moved={id:'transparent-geometry',status:'rendering'};await renderer.render(p,moved);assert.ok(Math.abs(await y(moved.path,1,'crop=80:80:0:40,')-(16+219*128/255))<5,'Transparent padded pixels must preserve the lower track');
 item.effects={};item.keyframes={opacity:[{time:0,value:0},{time:1,value:1}]};const animated={id:'animated-alpha',status:'rendering'};await renderer.render(p,animated);assert.ok(await y(animated.path,.6)>await y(animated.path,1.4)+15,'Animated alpha must control blend strength');
 upper.muted=true;const muted={id:'muted-blend',status:'rendering'};await renderer.render(p,muted);assert.ok(Math.abs(await y(muted.path,1)-(16+219*128/255))<5);upper.muted=false;
 await s.commit(p,'Blend preview fixture');const frame=await renderer.frame(1);assert.ok(Math.abs(await y(frame.path,0)-await y(animated.path,1))<3,'Composed frame and exported blend must agree');
 for(const color of ['red','blue'])await run(ffmpeg,['-hide_banner','-nostdin','-y','-f','lavfi','-i',`color=c=${color}:s=320x180:r=30`,'-t','2','-c:v','libx264','-pix_fmt','yuv420p',path.join(data,'media',color+'.mp4')]);
 p.assets[0].file='red.mp4';p.assets[1].file='blue.mp4';item.blendMode='screen';delete item.keyframes;const colorJob={id:'rgb-screen',status:'rendering'};await renderer.render(p,colorJob);const {err}=await run(ffmpeg,['-hide_banner','-nostdin','-ss','1','-i',colorJob.path,'-vf','signalstats,metadata=print','-frames:v','1','-f','null','-']);assert.ok(Number(err.match(/lavfi.signalstats.UAVG=([\d.]+)/)?.[1])>180&&Number(err.match(/lavfi.signalstats.VAVG=([\d.]+)/)?.[1])>180,'Screen must combine red and blue into magenta in RGB');

});
