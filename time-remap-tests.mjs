import test from 'node:test';
import assert from 'node:assert/strict';
import {validateSpeedCurve, sourceAtPlayback, playbackAtSource, sliceSpeedCurve} from './time-remap.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Store,Renderer,apply,run} from './engine.mjs';
import {convertV1,legacyRenderSnapshot,timeSeconds} from './sequences.mjs';
import {inspectSequence} from './timecode.mjs';
const fixture=()=>convertV1({title:'Speed ramps',canvas:{width:320,height:180,fps:30},assets:[{id:'a',name:'Ramp source',file:'source.mp4',duration:4,width:320,height:180,hasAudio:true}],clips:[{id:'clip',assetId:'a',sourceIn:0,sourceOut:4,speed:1,volume:1}],captions:[]});
const points=[{time:0,speed:.5},{time:4,speed:1.5}];
const close = (a,b) => assert.ok(Math.abs(a-b)<1e-9, `${a} != ${b}`);
test('smooth speed ramp integrates and inverts source timing', () => {
  const curve=[{time:0,speed:.5},{time:2,speed:1.5},{time:4,speed:1}];
  close(sourceAtPlayback(curve,1),.75);
  close(sourceAtPlayback(curve,2),2);
  close(sourceAtPlayback(curve,4),4.5);
  for(let t=0;t<=4;t+=.03125) close(playbackAtSource(curve,sourceAtPlayback(curve,t)),t);
});
test('slicing a ramp preserves source displacement across cuts', () => {
  const curve=[{time:0,speed:4},{time:2,speed:.25},{time:3,speed:2}];
  const original=structuredClone(curve), slice=sliceSpeedCurve(curve,.75,2.5);
  for(let t=0;t<=1.75;t+=.03125)
    close(sourceAtPlayback(slice,t),sourceAtPlayback(curve,t+.75)-sourceAtPlayback(curve,.75));
  assert.deepEqual(curve,original);
});
test('invalid curves and out-of-range timing fail explicitly', () => {
  for(const points of [[],[{time:0,speed:1}], [{time:1,speed:1},{time:2,speed:1}],
    [{time:0,speed:1},{time:0,speed:2}], [{time:0,speed:1},{time:2,speed:Infinity}],
    [{time:0,speed:.1},{time:2,speed:1}]]) assert.throws(()=>validateSpeedCurve(points));
  const curve=[{time:0,speed:1},{time:2,speed:1}];
  for(const t of [-1,3,NaN]) {
    assert.throws(()=>sourceAtPlayback(curve,t));
    assert.throws(()=>playbackAtSource(curve,t));
  }
  assert.throws(()=>sliceSpeedCurve(curve,1,1));
});

test('speed commands validate atomically, preserve links and source matches, and undo through Store',async()=>{
 const p=fixture(),sid=p.activeSequenceId,op={type:'item_speed_curve',sequenceId:sid,itemId:'clip',points},q=apply(p,[op]);
 assert.ok(q.sequences[0].tracks.every(t=>JSON.stringify(t.items[0].speedCurve)===JSON.stringify(points)));
 close(inspectSequence(q,{time:1}).matches[0].sourceTime,.625);
 close(inspectSequence(q,{assetId:'a',sourceTime:.625}).matches[0].time,1);
 assert.throws(()=>legacyRenderSnapshot(q));
 const before=JSON.stringify(p);
 for(const bad of [{...op,points:[{time:0,speed:1},{time:2,speed:1}]},{...op,points:[{time:0,speed:1},{time:4,speed:1,extra:1}]}]) assert.throws(()=>apply(p,[bad]));
 for(const bad of [{type:'item_reverse',enabled:true},{type:'item_freeze',sourceTime:1},{type:'item_trim',sourceIn:0,sourceOut:3},{type:'item_rate',duration:2}])assert.throws(()=>apply(q,[{sequenceId:sid,itemId:'clip',...bad}]));
 const locked=apply(p,[{type:'track_update',sequenceId:sid,trackId:p.sequences[0].tracks[1].id,locked:true}]);assert.throws(()=>apply(locked,[op]),e=>e.code==='TRACK_LOCKED');
 const split=apply(q,[{type:'item_split',sequenceId:sid,itemId:'clip',time:1}],{allocateId:(()=>{let n=0;return()=>`ramp-${++n}`;})()});
 for(const t of split.sequences[0].tracks){close(t.items[0].sourceOut,.625);close(t.items[1].sourceIn,.625);close(timeSeconds(t.items[1].duration),3);close(sourceAtPlayback(t.items[1].speedCurve,1),sourceAtPlayback(points,2)-.625);}
 const range=apply(q,[{type:'sequence_remove_range',sequenceId:sid,start:1,end:2}],{allocateId:(()=>{let n=0;return()=>`range-${++n}`;})()});close(timeSeconds(range.sequences[0].tracks[0].items[1].start),1);close(range.sequences[0].tracks[0].items[1].sourceIn,1.5);
 const inserted=apply(q,[{type:'sequence_insert_gap',sequenceId:sid,time:1,duration:.5}],{allocateId:(()=>{let n=0;return()=>`insert-${++n}`;})()});close(inserted.sequences[0].tracks[0].items[1].sourceIn,.625);close(timeSeconds(inserted.sequences[0].tracks[0].items[1].start),1.5);
 const constant=apply(p,[{type:'item_rate',sequenceId:sid,itemId:'clip',duration:2}]);assert.deepEqual(apply(constant,[{type:'item_speed_curve_clear',sequenceId:sid,itemId:'clip'}]),constant);
 const cleared=apply(q,[{type:'item_speed_curve_clear',sequenceId:sid,itemId:'clip'}]);assert.deepEqual(cleared,p);assert.equal(JSON.stringify(p),before);
 const root=path.dirname(fileURLToPath(import.meta.url)),work=path.resolve(root,'../../work/time-remap-tests');await fs.mkdir(work,{recursive:true});const s=new Store(await fs.mkdtemp(path.join(work,'state-')),'unused');await s.init();await s.commit(p,'Fixture');
 const args={expectedProjectId:s.projectId,expectedRevision:s.db.revision,summary:'Smooth speed ramp',operations:[op]},plan=await s.plan(args);assert.deepEqual(await s.plan(args),plan);await s.edit({...args,expectedPlanId:plan.planId});assert.deepEqual(s.db.project,q);await s.undo({expectedRevision:s.db.revision});assert.deepEqual(s.db.project,p);await s.redo({expectedRevision:s.db.revision});assert.deepEqual(s.db.project,q);
});

test('real linked ramp moves a visual cut and an audio pulse to matching playback times',{timeout:60000},async()=>{
 const root=path.dirname(fileURLToPath(import.meta.url)),ffmpeg=JSON.parse(await fs.readFile(path.join(root,'config.local.json'),'utf8')).ffmpeg,work=path.resolve(root,'../../work/time-remap-tests');await fs.mkdir(work,{recursive:true});const dir=await fs.mkdtemp(path.join(work,'render-')),s=new Store(dir,ffmpeg);await s.init();
 await run(ffmpeg,['-hide_banner','-nostdin','-y','-f','lavfi','-i','color=c=red:s=320x180:r=30:d=1','-f','lavfi','-i','color=c=blue:s=320x180:r=30:d=3','-f','lavfi','-i',"aevalsrc=if(between(t\\,1\\,1.2)\\,0.2*sin(2*PI*440*t)\\,0):s=48000:d=4",'-filter_complex','[0:v][1:v]concat=n=2:v=1:a=0[v]','-map','[v]','-map','2:a','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac',path.join(dir,'media/source.mp4')]);
 const p=fixture(),q=apply(p,[{type:'item_speed_curve',sequenceId:p.activeSequenceId,itemId:'clip',points}]),renderer=new Renderer(s),job={id:'smooth',status:'rendering'};await renderer.render(q,job);
 const y=async(time)=>{const {err}=await run(ffmpeg,['-hide_banner','-nostdin','-ss',String(time),'-i',job.path,'-frames:v','1','-vf','signalstats,metadata=print','-f','null','-']);return Number(err.match(/lavfi.signalstats.YAVG=([\d.]+)/)?.[1]);};
 assert.ok(await y(1.2)>65,'visual cut should remain red before remapped source second 1');assert.ok(await y(1.8)<60,'visual cut should become blue afterward');
 const pcm=path.join(dir,'ramp.f32');await run(ffmpeg,['-hide_banner','-nostdin','-y','-i',job.path,'-vn','-ac','1','-ar','48000','-f','f32le',pcm]);const data=await fs.readFile(pcm);
 const rms=(time)=>{let sum=0;for(let n=Math.round(time*48000);n<Math.round((time+.05)*48000);n++)sum+=data.readFloatLE(n*4)**2;return Math.sqrt(sum/2400);};
 assert.ok(rms(1.1)<.005,'source pulse must move away from original time');assert.ok(rms(1.5)>.04,'pulse must align with remapped source time');assert.ok(Math.abs(data.length/4/48000-4)<.06);
 const split=apply(q,[{type:'item_split',sequenceId:p.activeSequenceId,itemId:'clip',time:2}],{allocateId:(()=>{let n=0;return()=>`split-${++n}`;})()}),splitJob={id:'split',status:'rendering'};await renderer.render(split,splitJob);assert.equal(splitJob.status,'complete');
 const many=Array.from({length:32},(_,i)=>({time:4*i/31,speed:i%2?1.5:.5})),multi=apply(p,[{type:'item_speed_curve',sequenceId:p.activeSequenceId,itemId:'clip',points:many}]),multiJob={id:'many-points',status:'rendering'};await renderer.render(multi,multiJob);assert.equal(multiJob.status,'complete');
});
