import {frameToTimecode,timecodeToFrame,inspectSequence} from './timecode.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {apply,Store,canonical} from './engine.mjs';
import {convertV1,timeSeconds as seconds} from './sequences.mjs';
const fixture=()=>convertV1({title:'Edit fixture',canvas:{width:320,height:180,fps:30},assets:[{id:'a',name:'A',file:'a.mp4',duration:20,width:320,height:180,hasAudio:true}],clips:[{id:'first',assetId:'a',sourceIn:1,sourceOut:5,speed:1,volume:1},{id:'second',assetId:'a',sourceIn:5,sourceOut:9,speed:1,volume:1}],captions:[]});
const execute=(p,ops)=>{let n=0;return apply(p,ops,{allocateId:()=>`new-${++n}`});};
const operation=(p,type,fields={})=>({type,sequenceId:p.activeSequenceId,...fields});

test('v2 trim/slip/rate operate on linked media and split preserves source continuity',()=>{
 const p=fixture(),op=(type,fields)=>operation(p,type,{itemId:'first',...fields});
 const trimmed=execute(p,[op('item_trim',{sourceIn:2,sourceOut:4})]);assert.equal(seconds(trimmed.sequences[0].tracks[0].items[0].duration),2);assert.equal(trimmed.sequences[0].tracks[1].items[0].sourceIn,2);
 const slipped=execute(p,[op('item_slip',{delta:1})]);assert.equal(slipped.sequences[0].tracks[0].items[0].sourceIn,2);assert.equal(seconds(slipped.sequences[0].tracks[0].items[0].duration),4);
 const rate=execute(p,[op('item_rate',{duration:2})]);assert.equal(rate.sequences[0].tracks[0].items[0].speed,2);assert.equal(rate.sequences[0].tracks[1].items[0].speed,2);
 const split=execute(p,[op('item_split',{time:2})]);for(const t of split.sequences[0].tracks){assert.equal(t.items.length,3);assert.equal(t.items[0].sourceOut,3);assert.equal(t.items[2].sourceIn,3);assert.equal(seconds(t.items[2].start),2);}assert.equal(split.sequences[0].tracks[1].items[2].videoItemId,split.sequences[0].tracks[0].items[2].id);
 for(const bad of [op('item_trim',{sourceIn:1,sourceOut:6}),op('item_slip',{delta:-2}),op('item_rate',{duration:20}),op('item_split',{time:0}),op('item_split',{time:4})])assert.throws(()=>execute(p,[bad]));
});

test('v2 controls, annotations and effects validate and respect lock boundaries',()=>{
 const p=fixture(),sid=p.activeSequenceId,trackId=p.sequences[0].tracks[0].id,op=(type,fields)=>operation(p,type,fields);
 const q=execute(p,[{type:'project_rename',title:'Changed'},op('sequence_settings',{name:'Sequence',width:640,height:360,fpsNumerator:30000,fpsDenominator:1001}),op('track_reorder',{trackId,index:1}),op('item_volume',{itemId:'first',volume:.4}),op('item_effects',{itemId:'first',values:{brightness:.1}}),op('sequence_caption',{text:'Hello',start:0,end:1}),op('sequence_marker',{label:'Beat',time:2}),op('sequence_range',{start:1,end:7})]);
 assert.equal(q.title,'Changed');assert.equal(q.sequences[0].tracks[1].id,trackId);assert.equal(q.sequences[0].canvas.fps,30000/1001);assert.equal(q.sequences[0].tracks[1].items[0].effects.brightness,.1);
 const s=q.sequences[0],deleted=execute(q,[op('sequence_caption_delete',{captionId:s.captions[0].id}),op('sequence_marker_delete',{markerId:s.markers[0].id}),op('sequence_range_clear',{})]);assert.equal(deleted.sequences[0].captions.length,0);assert.equal(deleted.sequences[0].markers.length,0);assert.equal(deleted.sequences[0].exportRange,null);
 for(const bad of [{type:'project_rename',title:''},op('sequence_settings',{width:161}),op('track_reorder',{trackId,index:20}),op('item_volume',{itemId:'first',volume:3}),op('item_effects',{itemId:'first',values:{brightness:10}}),op('sequence_caption',{text:'',start:0,end:1}),op('sequence_marker',{label:'X',time:9}),op('sequence_range',{start:2,end:1}),op('sequence_caption_delete',{captionId:'missing'}),op('sequence_marker_delete',{markerId:'missing'})])assert.throws(()=>execute(p,[bad]));
 const locked=execute(p,[op('track_update',{trackId:s.tracks[0].id,locked:true})]);assert.doesNotThrow(()=>execute(locked,[op('item_effects',{itemId:'first',values:{contrast:1.2}})]));assert.throws(()=>execute(locked,[op('item_volume',{itemId:'first',volume:.5})]),e=>e.code==='TRACK_LOCKED');
});

test('v2 range deletion splits speed-mapped media, ripples sync tracks and maps annotations',()=>{
 const p=fixture(),op=(type,fields)=>operation(p,type,fields);const annotated=execute(p,[op('sequence_caption',{text:'Across',start:1,end:6}),op('sequence_marker',{label:'Inside',time:2.5}),op('sequence_marker',{label:'After',time:6}),op('sequence_range',{start:1,end:7})]);
 const q=execute(annotated,[op('sequence_remove_range',{start:2,end:3})]),s=q.sequences[0];assert.equal(s.tracks[0].items.length,3);assert.equal(seconds(s.tracks[0].items[1].start),2);assert.equal(s.tracks[0].items[1].sourceIn,4);assert.equal(seconds(s.tracks[0].items[2].start),3);assert.equal(seconds(s.captions[0].end),5);assert.equal(s.markers.length,1);assert.equal(seconds(s.markers[0].time),5);assert.equal(seconds(s.exportRange.end),6);
 const lift=execute(p,[op('sequence_remove_range',{start:2,end:3,ripple:false})]);assert.equal(seconds(lift.sequences[0].tracks[0].items[1].start),3);assert.equal(seconds(lift.sequences[0].tracks[0].items[2].start),4);
 const locked=execute(p,[op('track_update',{trackId:p.sequences[0].tracks[1].id,locked:true})]);assert.throws(()=>execute(locked,[op('sequence_remove_range',{start:2,end:3})]),e=>e.code==='TRACK_LOCKED');assert.throws(()=>execute(p,[op('sequence_remove_range',{start:2,end:2})]));
});

test('v2 dissolve adds/updates/removes linked overlap and rejects invalid edits atomically',()=>{
 const p=fixture(),before=canonical(p),op=(seconds)=>operation(p,'sequence_transition',{itemId:'first',seconds});
 const q=execute(p,[op(.5)]);assert.equal(seconds(q.sequences[0].tracks[0].items[1].start),3.5);assert.equal(seconds(q.sequences[0].tracks[1].items[1].start),3.5);assert.equal(q.sequences[0].transitions.length,1);
 const updated=execute(q,[op(1)]);assert.equal(seconds(updated.sequences[0].tracks[0].items[1].start),3);const removed=execute(updated,[op(0)]);assert.equal(seconds(removed.sequences[0].tracks[0].items[1].start),4);assert.equal(removed.sequences[0].transitions.length,0);
 assert.throws(()=>execute(q,[operation(p,'item_trim',{itemId:'first',sourceIn:1,sourceOut:4})]));assert.throws(()=>execute(p,[op(3)]));assert.equal(canonical(p),before);
});

test('v2 multi-step editing plan commits once, persists, undoes and redoes exactly',async()=>{
 const work=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../work/sequence-edit-tests');await fs.mkdir(work,{recursive:true});const data=await fs.mkdtemp(path.join(work,'run-')),store=new Store(data,'unused');await store.init();const p=fixture();await store.commit(p,'Fixture');
 const op=(type,fields)=>operation(p,type,fields),args={expectedProjectId:store.projectId,expectedRevision:store.read().revision,summary:'Trim, title and dissolve',operations:[op('item_trim',{itemId:'first',sourceIn:2,sourceOut:5}),op('item_move',{itemId:'second',time:3}),op('sequence_transition',{itemId:'first',seconds:.5}),op('sequence_caption',{text:'Highlight',start:0,end:2}),{type:'project_rename',title:'Highlight edit'}]};
 const plan=await store.plan(args);assert.deepEqual(await store.plan(args),plan);await store.edit({...args,expectedPlanId:plan.planId});const after=canonical(store.db.project);assert.equal(store.read().revision,2);const reopened=new Store(data,'unused');await reopened.init();assert.equal(canonical(reopened.db.project),after);await reopened.undo({expectedRevision:2});assert.deepEqual(reopened.db.project,p);await reopened.redo({expectedRevision:3});assert.equal(canonical(reopened.db.project),after);
});

test('v2 insert/overwrite/three-point placement obey sync locks and preserve linked fragments',()=>{
 const p=fixture(),trackId=p.sequences[0].tracks[0].id,op=(type,fields)=>operation(p,type,fields);
 const base=op('item_add',{trackId,assetId:'a',time:2,sourceIn:10,sourceOut:11});
 const inserted=execute(p,[{...base,mode:'insert'}]),s=inserted.sequences[0];assert.equal(s.tracks[0].items.length,4);assert.equal(seconds(s.tracks[0].items.find(i=>i.id==='second').start),5);assert.equal(s.tracks[0].items.at(-1).sourceIn,10);
 const overwritten=execute(p,[{...base,mode:'overwrite'}]),o=overwritten.sequences[0];assert.equal(o.tracks[0].items.length,4);assert.equal(seconds(o.tracks[0].items.find(i=>i.id==='second').start),4);const oldAudio=o.tracks[1].items;assert.ok(oldAudio.every(i=>seconds(i.start)>=3||seconds(i.start)+seconds(i.duration)<=2),'Overwritten audio must be removed along with linked video');
 const three=execute(p,[op('item_add',{trackId,assetId:'a',time:8,sourceIn:10,timelineOut:10})]);assert.equal(three.sequences[0].tracks[0].items.at(-1).sourceOut,12);
 assert.throws(()=>execute(p,[{...base,timelineOut:4}]));const locked=execute(p,[op('track_update',{trackId:p.sequences[0].tracks[1].id,locked:true})]);for(const mode of ['insert','overwrite'])assert.throws(()=>execute(locked,[{...base,mode}]),e=>e.code==='TRACK_LOCKED');
 const gap=execute(p,[op('sequence_insert_gap',{time:2,duration:1})]);assert.equal(seconds(gap.sequences[0].tracks[0].items.find(i=>i.id==='second').start),5);
});

test('v2 roll and slide conserve total duration, source handles and linked offsets',()=>{
 const p=fixture(),op=(type,fields)=>operation(p,type,fields);const rolled=execute(p,[op('item_roll',{itemId:'first',delta:1})]);assert.equal(rolled.sequences[0].tracks[0].items[0].sourceOut,6);assert.equal(rolled.sequences[0].tracks[0].items[1].sourceIn,6);assert.equal(seconds(rolled.sequences[0].tracks[0].items[1].start),5);
 const split=execute(p,[op('item_split',{itemId:'first',time:2})]),middle=split.sequences[0].tracks[0].items.at(-1);const slid=execute(split,[op('item_slide',{itemId:middle.id,delta:.5})]);const moved=slid.sequences[0].tracks[0].items.find(i=>i.id===middle.id);assert.equal(seconds(moved.start),2.5);assert.equal(moved.sourceIn,middle.sourceIn);assert.equal(moved.sourceOut,middle.sourceOut);assert.equal(seconds(slid.sequences[0].tracks[0].items.find(i=>i.id==='second').start),4.5);
 assert.throws(()=>execute(p,[op('item_slide',{itemId:'first',delta:1})]));assert.throws(()=>execute(p,[op('item_roll',{itemId:'first',delta:5})]));
});


test('frame/timecode and source/reverse matches handle fractional rates and drop-frame boundaries',()=>{
 const ntsc={numerator:30000,denominator:1001};for(const frame of [0,1,1798,1800,17982,107892]){const label=frameToTimecode(frame,ntsc,{dropFrame:true});assert.equal(timecodeToFrame(label,ntsc),frame);}assert.equal(frameToTimecode(1800,ntsc,{dropFrame:true}),'00:01:00;02');assert.throws(()=>timecodeToFrame('00:01:00;00',ntsc));assert.throws(()=>timecodeToFrame('00:00:00:30',ntsc));
 const p=fixture(),result=inspectSequence(p,{time:1});assert.equal(result.frame,30);assert.equal(result.timecode,'00:00:01:00');assert.equal(result.matches[0].sourceTime,2);const reverse=inspectSequence(p,{assetId:'a',sourceTime:6});assert.equal(reverse.matches[0].time,5);assert.throws(()=>inspectSequence(p,{time:-1}));
});


test('destructive v2 overwrite requires the reviewed plan and SRT imports remain undoable',async()=>{
 const work=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../work/sequence-edit-tests');await fs.mkdir(work,{recursive:true});const data=await fs.mkdtemp(path.join(work,'confirm-')),store=new Store(data,'unused');await store.init();const p=fixture();await store.commit(p,'Fixture');
 const args={expectedRevision:store.read().revision,expectedProjectId:store.projectId,summary:'Overwrite',operations:[operation(p,'item_add',{trackId:p.sequences[0].tracks[0].id,assetId:'a',time:1,sourceIn:10,sourceOut:11,mode:'overwrite'})]};const plan=await store.plan(args);assert.deepEqual(plan.destructiveOperations,['item_add']);await assert.rejects(store.edit({...args,expectedPlanId:plan.planId}),e=>e.code==='CONFIRMATION_REQUIRED');await store.edit({...args,expectedPlanId:plan.planId,confirmPlanId:plan.planId});await store.undo({expectedRevision:store.read().revision});assert.deepEqual(store.db.project,p);
 await store.importSubtitles({expectedRevision:store.read().revision,text:'1\n00:00:00,000 --> 00:00:01,000\nLiteral title'});assert.equal(store.db.project.sequences[0].captions[0].text,'Literal title');await store.undo({expectedRevision:store.read().revision});assert.deepEqual(store.db.project,p);
});


test('razor cuts each linked group once and rejects empty cuts and locked partners',()=>{
 const p=fixture(),op=(type,fields)=>operation(p,type,fields);const q=execute(p,[op('sequence_razor',{time:2,targetedOnly:false})]);assert.equal(q.sequences[0].tracks[0].items.length,3);assert.equal(q.sequences[0].tracks[1].items.length,3);assert.throws(()=>execute(p,[op('sequence_razor',{time:0})]));const locked=execute(p,[op('track_update',{trackId:p.sequences[0].tracks[1].id,locked:true})]);assert.throws(()=>execute(locked,[op('sequence_razor',{time:2})]),e=>e.code==='TRACK_LOCKED');
});
