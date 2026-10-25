import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import path from 'node:path';import {fileURLToPath} from 'node:url';
import {apply,Store,Renderer,run,canonical} from './engine.mjs';
import {convertV1,timeFromSeconds as T,timeSeconds as seconds} from './sequences.mjs';
const fixture=()=>{const p=convertV1({title:'Selection nest',canvas:{width:320,height:180,fps:30},assets:[{id:'a',name:'Changing source',file:'source.mp4',duration:2,width:320,height:180,hasAudio:true}],clips:[{id:'one',assetId:'a',sourceIn:0,sourceOut:1,speed:1,volume:1},{id:'two',assetId:'a',sourceIn:1,sourceOut:2,speed:1,volume:1},{id:'outside',assetId:'a',sourceIn:0,sourceOut:1,speed:1,volume:1}],captions:[]});for(const t of p.sequences[0].tracks)for(const i of t.items)i.start=T(i.id==='outside'||i.videoItemId==='outside'?5:seconds(i.start)+1);return p;};
const execute=(p,ops)=>apply(p,ops,{allocateId:(()=>{let n=0;return()=>`selection-${++n}`;})()});
const nest=p=>({type:'sequence_nest_selection',sequenceId:p.activeSequenceId,name:'Chosen scene',itemIds:['one','two']});
const wrapper=p=>p.sequences[0].tracks.flatMap(t=>t.items).find(i=>p.assets.find(a=>a.id===i.assetId)?.kind==='sequence'&&i.origin!=='companion');
test('selection nesting includes linked/groups, retains internal transitions/annotations and expands with fresh IDs',()=>{
 let p=fixture();const s=p.sequences[0];s.captions=[{id:'caption',text:'Scene',start:T(1.2),end:T(1.5)}];s.markers=[{id:'marker',label:'Inside',time:T(2.3)},{id:'boundary',label:'Outside',time:T(3)}];
 p=execute(p,[{type:'sequence_transition',sequenceId:s.id,itemId:'one',seconds:.2}]);
 const before=canonical(p),q=execute(p,[nest(p)]),child=q.sequences[1],parent=q.sequences[0],video=wrapper(q);
 assert.equal(child.tracks.length,2);assert.equal(child.tracks[0].items.length,2);assert.equal(child.transitions.length,1);assert.equal(child.transitions[0].trackId,child.tracks[0].id);assert.equal(child.captions[0].text,'Scene');assert.equal(seconds(child.captions[0].start),.2);assert.equal(child.markers[0].label,'Inside');assert.equal(parent.markers.length,1);assert.equal(parent.captions.length,0);assert.equal(seconds(video.start),1);assert.ok(Math.abs(seconds(video.duration)-1.8)<1e-8);assert.equal(parent.tracks[0].items[0].id,'outside');assert.equal(canonical(p),before);
 const expanded=execute(q,[{type:'sequence_unnest',sequenceId:s.id,itemId:video.id}]),restored=expanded.sequences[0];assert.equal(restored.tracks[0].items.length,3);assert.equal(restored.tracks[1].items.length,3);assert.equal(restored.transitions.length,1);assert.equal(seconds(restored.captions[0].start),1.2);assert.equal(restored.markers.length,2);assert.equal(restored.tracks.at(-1).items.length,0);assert.equal(expanded.sequences.length,2,'Reusable source must remain available');
 for(const t of restored.tracks.slice(0,2))for(const item of t.items.filter(i=>i.id!=='outside'&&i.videoItemId!=='outside'))assert.ok(!['one','two'].includes(item.id));
 for(const i of restored.tracks[1].items){const v=restored.tracks[0].items.find(v=>v.id===i.videoItemId);assert.ok(v);assert.equal(v.linkGroupId,i.linkGroupId);}
 const grouped=execute(fixture(),[{type:'item_group',sequenceId:s.id,itemIds:['one','two']}]),single=execute(grouped,[{...nest(grouped),itemIds:['one']}]);assert.equal(single.sequences[1].tracks[0].items.length,2);
});
test('selection nesting rejects partial composition, locks, cross-boundary captions and unsafe expansion atomically',()=>{
 const p=fixture(),sid=p.activeSequenceId;
 assert.throws(()=>execute(p,[{...nest(p),itemIds:['one','outside']}]));
 const locked=execute(p,[{type:'track_update',sequenceId:sid,trackId:p.sequences[0].tracks[1].id,locked:true}]);assert.throws(()=>execute(locked,[nest(p)]),e=>e.code==='TRACK_LOCKED');
 const caption=structuredClone(p);caption.sequences[0].captions=[{id:'crossing',text:'Crossing',start:T(.5),end:T(1.5)}];assert.throws(()=>execute(caption,[nest(p)]));
 const solo=execute(p,[{type:'track_update',sequenceId:sid,trackId:p.sequences[0].tracks[0].id,solo:true}]);assert.throws(()=>execute(solo,[nest(p)]));
 const q=execute(p,[nest(p)]),video=wrapper(q),expand={type:'sequence_unnest',sequenceId:sid,itemId:video.id};
 const effect=execute(q,[{type:'item_effects',sequenceId:sid,itemId:video.id,values:{brightness:.1}}]);assert.throws(()=>execute(effect,[expand]));
 const noTrack=structuredClone(q);noTrack.sequences[0].tracks=noTrack.sequences[0].tracks.filter(t=>t.id!==p.sequences[0].tracks[0].id);assert.throws(()=>execute(noTrack,[expand]));
 const canvas=execute(q,[{type:'sequence_settings',sequenceId:q.sequences[1].id,width:640,height:360}]);assert.throws(()=>execute(canvas,[expand]));
 const move=execute(q,[{type:'item_move',sequenceId:sid,itemId:video.id,time:2}]),expanded=execute(move,[expand]);assert.ok(expanded.sequences[0].tracks[0].items.some(i=>seconds(i.start)===2&&i.assetId==='a'));
 const before=canonical(q);assert.throws(()=>execute(q,[{type:'item_effects',sequenceId:sid,itemId:video.id,values:{brightness:.1}},expand]));assert.equal(canonical(q),before);
});
test('selection nesting and expansion require reviewed plans, persist, undo and redo atomically',async()=>{
 const root=path.dirname(fileURLToPath(import.meta.url)),work=path.resolve(root,'../../work/selection-nesting-tests');await fs.mkdir(work,{recursive:true});const s=new Store(await fs.mkdtemp(path.join(work,'state-')),'unused');await s.init();const p=fixture();await s.commit(p,'Fixture');
 const edit=async(op)=>{const args={expectedProjectId:s.projectId,expectedRevision:s.db.revision,operations:[op],summary:'Reviewed nesting edit'},plan=await s.plan(args);assert.deepEqual(await s.plan(args),plan);assert.equal(plan.destructiveOperations.length,1);await assert.rejects(s.edit({...args,expectedPlanId:plan.planId}));await s.edit({...args,expectedPlanId:plan.planId,confirmPlanId:plan.planId});};
 await edit(nest(p));const nested=canonical(s.db.project);await s.undo({expectedRevision:s.db.revision});assert.deepEqual(s.db.project,p);await s.redo({expectedRevision:s.db.revision});assert.equal(canonical(s.db.project),nested);await edit({type:'sequence_unnest',sequenceId:p.activeSequenceId,itemId:wrapper(s.db.project).id});const expanded=canonical(s.db.project);await s.undo({expectedRevision:s.db.revision});assert.equal(canonical(s.db.project),nested);await s.redo({expectedRevision:s.db.revision});assert.equal(canonical(s.db.project),expanded);const reopened=new Store(s.root,'unused');await reopened.init();assert.equal(canonical(reopened.db.project),expanded);
});
test('real selected nesting and expansion preserve composed cut, gaps, audio and internal transitions',{timeout:60000},async()=>{
 const root=path.dirname(fileURLToPath(import.meta.url)),ffmpeg=JSON.parse(await fs.readFile(path.join(root,'config.local.json'),'utf8')).ffmpeg,work=path.resolve(root,'../../work/selection-nesting-tests');await fs.mkdir(work,{recursive:true});const dir=await fs.mkdtemp(path.join(work,'render-')),s=new Store(dir,ffmpeg);await s.init();
 await run(ffmpeg,['-hide_banner','-nostdin','-y','-f','lavfi','-i','color=c=red:s=320x180:r=30:d=1','-f','lavfi','-i','color=c=blue:s=320x180:r=30:d=1','-f','lavfi','-i','sine=frequency=440:sample_rate=48000:duration=2','-filter_complex','[0:v][1:v]concat=n=2:v=1:a=0[v]','-map','[v]','-map','2:a','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac',path.join(dir,'media/source.mp4')]);
 const p=fixture(),sid=p.activeSequenceId,original=execute(p,[{type:'sequence_transition',sequenceId:sid,itemId:'one',seconds:.2}]),q=execute(original,[nest(p)]),expanded=execute(q,[{type:'sequence_unnest',sequenceId:sid,itemId:wrapper(q).id}]),renderer=new Renderer(s);
 const render=async(p,id)=>{const job={id,status:'rendering'};await renderer.render(p,job);return job.path;},baseline=await render(original,'original'),nested=await render(q,'nested'),flat=await render(expanded,'expanded');
 const y=async(file,time)=>{const {err}=await run(ffmpeg,['-hide_banner','-nostdin','-ss',String(time),'-i',file,'-frames:v','1','-vf','signalstats,metadata=print','-f','null','-']);return Number(err.match(/lavfi.signalstats.YAVG=([\d.]+)/)?.[1]);};
 for(const t of [.5,1.3,1.9,2.5,3.5,5.2]){const reference=await y(baseline,t);assert.ok(Math.abs(await y(nested,t)-reference)<4,`Nested frame ${t}`);assert.ok(Math.abs(await y(flat,t)-reference)<4,`Expanded frame ${t}`);}
 const level=async(file)=>{const {err}=await run(ffmpeg,['-hide_banner','-nostdin','-i',file,'-vn','-af','volumedetect','-f','null','-']);return Number(err.match(/mean_volume: (-?[\d.]+) dB/)?.[1]);};assert.ok(Math.abs(await level(nested)-await level(baseline))<.5);assert.ok(Math.abs(await level(flat)-await level(baseline))<.3);
});
