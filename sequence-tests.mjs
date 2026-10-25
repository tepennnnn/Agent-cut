import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {convertV1,legacyRenderSnapshot,validateV2,timeFromSeconds,timeSeconds,addTime,migrationPreview} from './sequences.mjs';
import {Store,canonical,apply,timeline} from './engine.mjs';
const fixture=()=>({title:'Migration fixture',canvas:{width:320,height:180,fps:30},assets:[{id:'a',name:'A',file:'a.mp4',duration:4,width:320,height:180,hasAudio:true}],clips:[{id:'c1',assetId:'a',sourceIn:.5,sourceOut:2.5,speed:1,volume:.7,transitionOut:.25,effects:{brightness:.1,audioFadeIn:.1}},{id:'c2',assetId:'a',sourceIn:1,sourceOut:3,speed:1,volume:1,transitionOut:0}],layers:[{id:'v',assetId:'a',kind:'video',start:.5,sourceIn:0,sourceOut:1,speed:1,volume:.3,track:1,effects:{scale:.5}},{id:'sound',assetId:'a',kind:'audio',start:.5,sourceIn:0,sourceOut:1,speed:1,volume:.4,track:1,effects:{audioFadeOut:.1}}],captions:[{id:'cap',text:'Caption',start:1,end:2}],markers:[{id:'mark',time:2,label:'Beat'}],exportRange:{start:.25,end:3.5}});
test('pure migration preserves full legacy render state and stable IDs including overlapping overlay/audio lanes',()=>{
 const p=fixture(),before=canonical(p),v2=convertV1(p);assert.equal(canonical(p),before);assert.equal(v2.schemaVersion,2);assert.deepEqual(convertV1(JSON.parse(JSON.stringify(p))),v2);assert.deepEqual(legacyRenderSnapshot(v2),p);
 const seq=v2.sequences[0];assert.equal(seq.tracks.length,5);assert.equal(seq.transitions.length,1);assert.equal(timeSeconds(seq.transitions[0].duration),.25);
 assert.equal(seq.tracks.flatMap(t=>t.items).filter(i=>i.origin==='companion').length,3);
 assert.equal(migrationPreview(p).legacyRoundTripMatches,true);assert.equal(migrationPreview(p).activationAvailable,true);
 const declared={...p,schemaVersion:1};assert.deepEqual(legacyRenderSnapshot(convertV1(declared)),declared);assert.equal(migrationPreview({...p,customMetadata:{notes:'preserve me'}}).activationAvailable,false);
 const empty=fixture();empty.clips=[];empty.layers=[];empty.captions=[];empty.markers=[];empty.exportRange=null;assert.deepEqual(legacyRenderSnapshot(convertV1(empty)),empty);
 const silent=fixture();silent.assets[0].hasAudio=false;silent.layers=[];assert.deepEqual(legacyRenderSnapshot(convertV1(silent)),silent);
});
test('rational timestamps normalize exactly and reject malformed, negative-denominator and oversized inputs',()=>{
 assert.deepEqual(timeFromSeconds(.1),{numerator:'1',denominator:'10'});assert.deepEqual(addTime(timeFromSeconds(.1),timeFromSeconds(.2)),{numerator:'3',denominator:'10'});
 assert.equal(timeSeconds(timeFromSeconds(1e-7)),1e-7);
 for(const t of [{numerator:'1',denominator:'0'},{numerator:'2',denominator:'4'},{numerator:'1',denominator:'-1'},{numerator:'1'.repeat(81),denominator:'1'},{numerator:1,denominator:'1'}])assert.throws(()=>timeSeconds(t),e=>e.code==='INVALID_SEQUENCE');
 assert.throws(()=>timeFromSeconds(Infinity));
});
test('v2 validator rejects corrupt references, source bounds, timebase and overlaps; adapter refuses nonrepresentable changes',()=>{
 const original=convertV1(fixture()),mutate=fn=>{const p=structuredClone(original);fn(p.sequences[0],p);return p;};
 for(const change of [s=>s.timebase.denominator=0,s=>s.timebase.numerator=24,s=>s.tracks[0].items[0].sourceOut=9,s=>s.tracks[0].items[0].start={numerator:'-1',denominator:'1'},s=>s.tracks[0].items[0].effects={unsupported:1},s=>s.transitions[0].rightItemId='missing',s=>s.tracks[1].items[0].videoItemId='missing',s=>s.tracks[0].items.push(structuredClone(s.tracks[0].items[0]))])assert.throws(()=>validateV2(mutate(change)));
 assert.throws(()=>legacyRenderSnapshot(mutate(s=>s.tracks[0].muted=true)),/track flags/);
 assert.throws(()=>legacyRenderSnapshot(mutate(s=>s.tracks[1].items[0].volume=.2)),/linked audio/);
 assert.throws(()=>legacyRenderSnapshot(mutate(s=>s.tracks[1].items=[])),/linked audio/);
 assert.deepEqual(original,convertV1(fixture()));
});
test('migration preview leaves the stored project and revision unchanged',async()=>{
 const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../work/sequence-tests');await fs.mkdir(root,{recursive:true});const data=await fs.mkdtemp(path.join(root,'run-'));
 const s=new Store(data,'unused');await s.init();await s.commit(fixture(),'Fixture');const before=await fs.readFile(s.file,'utf8'),revision=s.read().revision;
 const result=await s.serial(async()=>migrationPreview(s.db.project));assert.equal(result.legacyRoundTripMatches,true);assert.equal(await fs.readFile(s.file,'utf8'),before);assert.equal(s.read().revision,revision);
});
const editable=()=>{const p=fixture();p.clips.forEach(c=>c.transitionOut=0);p.layers=[];p.captions=[];p.markers=[];p.exportRange=null;return convertV1(p);};
test('v2 operations enforce linked track locks, kind and collision constraints with atomic rollback',()=>{
 const p=editable(),s=p.sequences[0],video=s.tracks.find(t=>t.kind==='video'),audio=s.tracks.find(t=>t.kind==='audio'),before=canonical(p),sequenceId=s.id,itemId=video.items[0].id;
 const moved=apply(p,[{type:'item_move',sequenceId,itemId,time:5}]);assert.equal(timeSeconds(moved.sequences[0].tracks[0].items[0].start),5);assert.equal(timeSeconds(moved.sequences[0].tracks[1].items[0].start),5);assert.equal(Math.max(...timeline(moved).map(i=>i.end)),7);
 const locked=apply(p,[{type:'track_update',sequenceId,trackId:audio.id,locked:true}]);assert.throws(()=>apply(locked,[{type:'item_move',sequenceId,itemId,time:5}]),e=>e.code==='TRACK_LOCKED');
 assert.equal(timeSeconds(apply(locked,[{type:'item_move',sequenceId,itemId,time:5,linked:false}]).sequences[0].tracks[1].items[0].start),0);
 for(const op of [{type:'item_move',sequenceId,itemId,time:1},{type:'item_move',sequenceId,itemId,time:-1},{type:'item_move',sequenceId,itemId,time:5,trackId:audio.id},{type:'item_lift',sequenceId,itemId:'missing'},{type:'track_delete',sequenceId,trackId:video.id}])assert.throws(()=>apply(p,[{type:'track_update',sequenceId,trackId:video.id,name:'Rollback'},op]));
 const lifted=apply(p,[{type:'item_lift',sequenceId,itemId,linked:false}]);assert.equal(lifted.sequences[0].tracks[0].items.length,1);assert.equal(lifted.sequences[0].tracks[1].items[0].origin,'layer');assert.equal(lifted.sequences[0].tracks[1].items[0].videoItemId,undefined);
 const cleared=apply(p,[{type:'sequence_clear',sequenceId}]);assert.equal(timeline(cleared).length,0);
 assert.throws(()=>apply(locked,[{type:'sequence_clear',sequenceId}]),e=>e.code==='TRACK_LOCKED');assert.equal(canonical(p),before);
});
test('v2 Store plans, save/apply, reopen, multi-step undo-all and redo preserve both schema versions',async()=>{
 const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../work/sequence-tests');await fs.mkdir(root,{recursive:true});const data=await fs.mkdtemp(path.join(root,'edit-'));
 const s=new Store(data,'unused');await s.init();const p=editable();await s.commit(p,'V2 fixture');const sequenceId=p.activeSequenceId,video=p.sequences[0].tracks[0],itemId=video.items[0].id;
 const args=operations=>({expectedProjectId:s.projectId,expectedRevision:s.read().revision,summary:'V2 test',operations});
 const save=await s.savePlan(args([{type:'item_move',sequenceId,itemId,time:5}]));assert.equal(save.plan.durationBefore,4);assert.equal(save.plan.durationAfter,7);
 await s.applyPlan({expectedProjectId:s.projectId,expectedRevision:s.read().revision,planId:save.plan.planId});
 await s.edit(args([{type:'track_update',sequenceId,trackId:video.id,muted:true}]));
 const lift=await s.savePlan(args([{type:'item_lift',sequenceId,itemId}]));await assert.rejects(s.applyPlan({expectedProjectId:s.projectId,expectedRevision:s.read().revision,planId:lift.plan.planId}),e=>e.code==='CONFIRMATION_REQUIRED');
 await s.applyPlan({expectedProjectId:s.projectId,expectedRevision:s.read().revision,planId:lift.plan.planId,confirmPlanId:lift.plan.planId});
 const reopened=new Store(data,'unused');await reopened.init();assert.equal(reopened.read().schemaVersion,2);assert.equal(reopened.read().duration,4);
 for(let i=0;i<3;i++)await reopened.undo({expectedRevision:reopened.read().revision,expectedProjectId:reopened.projectId});assert.deepEqual(reopened.db.project,p);
 await reopened.redo({expectedRevision:reopened.read().revision,expectedProjectId:reopened.projectId});assert.equal(reopened.read().duration,7);
 await reopened.undo({expectedRevision:reopened.read().revision});await reopened.undo({expectedRevision:reopened.read().revision});assert.equal(reopened.db.project.schemaVersion,undefined);assert.equal(reopened.read().title,'Untitled edit');
});
test('v2 sequence creation/selection and track add/delete are deterministic through plans',async()=>{
 const p=editable(),q=apply(p,[{type:'sequence_create',name:'Second'}],{allocateId:()=> 'second'});assert.equal(q.sequences.length,2);
 const selected=apply(q,[{type:'sequence_select',sequenceId:'second'},{type:'track_add',sequenceId:'second',kind:'video',name:'V1',index:0}],{allocateId:()=> 'new-track'});assert.equal(selected.activeSequenceId,'second');assert.equal(selected.sequences[1].tracks[0].id,'new-track');
 const removed=apply(selected,[{type:'track_delete',sequenceId:'second',trackId:'new-track'}]);assert.equal(removed.sequences[1].tracks.length,0);
 assert.throws(()=>apply(p,[{type:'sequence_select',sequenceId:'missing'}]));assert.throws(()=>apply(p,[{type:'track_add',sequenceId:p.activeSequenceId,kind:'audio',name:'Bad',index:99}]));
});
test('explicit migration backs up before commit, rejects stale/unconfirmed calls, reopens, undoes and restores safely',async()=>{
 const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../work/sequence-tests');await fs.mkdir(root,{recursive:true});const data=await fs.mkdtemp(path.join(root,'migrate-')),s=new Store(data,'unused');await s.init();await s.commit(fixture(),'Legacy fixture');
 const original=structuredClone(s.db),disk=await fs.readFile(s.file,'utf8'),guard=()=>({expectedProjectId:s.projectId,expectedRevision:s.read().revision});
 const plan=await s.previewMigration(guard());assert.equal(plan.activationAvailable,true);assert.deepEqual(await s.previewMigration(guard()),plan);assert.equal(await fs.readFile(s.file,'utf8'),disk);
 await assert.rejects(s.activateMigration({...guard(),expectedPlanId:plan.planId}),e=>e.code==='CONFIRMATION_REQUIRED');await assert.rejects(s.activateMigration({...guard(),expectedPlanId:'bad',confirmPlanId:'bad'}),e=>e.code==='PLAN_MISMATCH');assert.equal(await fs.readFile(s.file,'utf8'),disk);
 await fs.writeFile(path.join(data,'backups'),'blocked');await assert.rejects(s.activateMigration({...guard(),expectedPlanId:plan.planId,confirmPlanId:plan.planId}));assert.equal(await fs.readFile(s.file,'utf8'),disk);await fs.unlink(path.join(data,'backups'));
 const commit=s.commitLocked;s.commitLocked=async()=>{throw Error('Injected commit failure');};await assert.rejects(s.activateMigration({...guard(),expectedPlanId:plan.planId,confirmPlanId:plan.planId}),/Injected/);s.commitLocked=commit;
 assert.equal(await fs.readFile(s.file,'utf8'),disk);assert.deepEqual((await s.loadBackup(plan.planId)).snapshot,original);
 const activated=await s.activateMigration({...guard(),expectedPlanId:plan.planId,confirmPlanId:plan.planId});assert.equal(activated.schemaVersion,2);assert.equal(activated.revision,original.revision+1);assert.equal(activated.migrationBackup.backupId,plan.planId);
 const reopened=new Store(data,'unused');await reopened.init();assert.equal(reopened.read().schemaVersion,2);await assert.rejects(s.activateMigration({...guard(),expectedRevision:original.revision,expectedPlanId:plan.planId,confirmPlanId:plan.planId}),e=>e.code==='STALE_REVISION');
 await s.undo(guard());assert.deepEqual(s.db.project,original.project);await s.redo(guard());assert.equal(s.db.project.schemaVersion,2);
 const restore=await s.restorePlan({...guard(),backupId:plan.planId});await assert.rejects(s.restoreBackup({...guard(),backupId:plan.planId,expectedPlanId:restore.planId}),e=>e.code==='CONFIRMATION_REQUIRED');
 const restored=await s.restoreBackup({...guard(),backupId:plan.planId,expectedPlanId:restore.planId,confirmPlanId:restore.planId});assert.deepEqual(s.db.project,original.project);assert.ok(restored.recoverySafetyBackup.backupId);
 await s.undo(guard());assert.equal(s.db.project.schemaVersion,2);const backups=await s.listBackups({expectedProjectId:s.projectId});assert.equal(backups.backups.length,2);assert.ok(backups.backups.every(b=>b.status==='valid'));
 const backupFile=s.backupFile(plan.planId),corrupt=JSON.parse(await fs.readFile(backupFile,'utf8'));corrupt.snapshot.project.title='Corrupt';await fs.writeFile(backupFile,JSON.stringify(corrupt));
 await assert.rejects(s.restorePlan({...guard(),backupId:plan.planId}),e=>e.code==='INVALID_BACKUP');await assert.rejects(s.restorePlan({...guard(),backupId:'../project'}),e=>e.code==='INVALID_BACKUP_ID');assert.equal((await s.listBackups({expectedProjectId:s.projectId})).backups.find(b=>b.backupId===plan.planId).status,'invalid');
});

test('v2 media placement links audio, computes rational duration and rejects overlap atomically',()=>{
 const p=editable(),sequenceId=p.activeSequenceId,trackId=p.sequences[0].tracks[0].id,before=canonical(p);let n=0;
 const op={type:'item_add',sequenceId,trackId,assetId:'a',time:5,sourceIn:.1,sourceOut:.4,speed:3};
 const q=apply(p,[op],{allocateId:()=>`placed-${++n}`}),s=q.sequences[0],video=s.tracks[0].items.at(-1),audio=s.tracks.at(-1).items[0];
 assert.deepEqual(video.duration,{numerator:'1',denominator:'10'});assert.equal(audio.linkGroupId,video.linkGroupId);assert.equal(audio.videoItemId,video.id);
 for(const bad of [{...op,time:1},{...op,sourceOut:5},{...op,audioTrackId:trackId}])assert.throws(()=>apply(p,[bad],{allocateId:()=>`bad-${++n}`}));
 const locked=apply(p,[{type:'track_update',sequenceId,trackId,locked:true}]);assert.throws(()=>apply(locked,[op]),e=>e.code==='TRACK_LOCKED');assert.equal(canonical(p),before);
});

test('v2 placement has repeatable plans and exact undo',async()=>{
 const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../work/sequence-tests');await fs.mkdir(root,{recursive:true});const data=await fs.mkdtemp(path.join(root,'place-')),store=new Store(data,'unused');await store.init();const p=editable();await store.commit(p,'Fixture');
 const args={expectedProjectId:store.projectId,expectedRevision:store.read().revision,operations:[{type:'item_add',sequenceId:p.activeSequenceId,trackId:p.sequences[0].tracks[0].id,assetId:'a',time:5,sourceIn:0,sourceOut:1}],summary:'Place source'};
 const first=await store.plan(args);assert.deepEqual(await store.plan(args),first);await store.edit({...args,expectedPlanId:first.planId});assert.equal(store.read().duration,6);await store.undo({expectedRevision:store.read().revision,expectedProjectId:store.projectId});assert.deepEqual(store.db.project,p);
});
