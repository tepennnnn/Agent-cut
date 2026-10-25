import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {apply,Store,Renderer,timeline,probe,run} from './engine.mjs';
import {operationRegistry,validateOperation} from './operations.mjs';
import {spawn} from 'node:child_process';
import {convertV1,legacyRenderSnapshot} from './sequences.mjs';
const ROOT=path.dirname(fileURLToPath(import.meta.url));
const config=JSON.parse(await fs.readFile(path.join(ROOT,'config.local.json'),'utf8'));
const ffmpeg=config.ffmpeg,work=path.resolve(ROOT,'../../work/essential-tests');
await fs.mkdir(work,{recursive:true});
const root=await fs.mkdtemp(path.join(work,'run-'));
test('project identity distinguishes data roots, survives reopen and rejects wrong-project mutations before side effects',async()=>{
 const a=new Store(path.join(root,'identity-a'),ffmpeg),b=new Store(path.join(root,'identity-b'),ffmpeg);
 await a.init();await b.init();
 assert.notEqual(a.read().projectId,b.read().projectId);
 const before=await fs.readFile(a.file,'utf8'),saved=a.read();
 const wrong={expectedRevision:saved.revision,expectedProjectId:b.read().projectId};
 for(const operation of [()=>a.edit({...wrong,summary:'Wrong project',operations:[{type:'rename',title:'Wrong'}]}),()=>a.undo(wrong),()=>a.redo(wrong),()=>a.checkpoint({...wrong,action:'save',name:'Wrong'}),()=>a.importSubtitles({...wrong,text:'invalid'}),()=>a.import({expectedProjectId:wrong.expectedProjectId,path:'missing'})])await assert.rejects(operation(),/Project mismatch/);
 assert.equal(await fs.readFile(a.file,'utf8'),before);assert.deepEqual(a.read(),saved);
 await a.edit({expectedRevision:saved.revision,expectedProjectId:saved.projectId,summary:'Correct project',operations:[{type:'rename',title:'Correct'}]});
 const reopened=new Store(path.join(root,'identity-a'),ffmpeg);await reopened.init();
 assert.equal(reopened.read().projectId,saved.projectId);assert.equal(reopened.read().title,'Correct');
 assert.equal(reopened.read().dataRoot,await fs.realpath(path.join(root,'identity-a')));
 const legacy=JSON.parse(await fs.readFile(reopened.file,'utf8'));assert.equal(legacy.project.projectId,undefined);
});
const basic=()=>({title:'Essential editing test',canvas:{width:320,height:180,fps:30},assets:[{id:'a',name:'A',file:'a.mp4',duration:4,width:320,height:180,hasAudio:true},{id:'b',name:'B',file:'b.mp4',duration:4,width:320,height:180,hasAudio:true}],clips:[{id:'c1',assetId:'a',sourceIn:1,sourceOut:3,speed:1,volume:1},{id:'c2',assetId:'b',sourceIn:1,sourceOut:3,speed:1,volume:1}],captions:[]});
test('all registered operation contracts reject unknown fields at the direct engine boundary without partial edits',()=>{
 const sample=s=>s.const??s.enum?.[0]??(s.type==='string'?'sample':s.type==='boolean'?false:s.type==='object'?Object.fromEntries((s.required||[]).map(k=>[k,sample(s.properties[k])])):s.type==='array'?Array.from({length:s.minItems||0},()=>sample(s.items)):1);
 const p=basic(),before=structuredClone(p);
 for(const [type,{schema}] of Object.entries(operationRegistry)){
   const op=Object.fromEntries(schema.required.map(k=>[k,sample(schema.properties[k])]));validateOperation(op);
   assert.throws(()=>apply(p,[{type:'rename',title:'Should roll back'},{...op,unexpected:true}]),e=>e.code==='INVALID_OPERATION'&&e.details.operationIndex===1&&e.details.operationType===type&&e.message==='Unknown field unexpected.');
 }
 assert.deepEqual(p,before);
 assert.throws(()=>validateOperation({type:'toString'}),/Unknown operation/);
 assert.throws(()=>apply(p,[{type:'effects',clipId:'c1',values:{brightness:NaN}}]),e=>e.code==='INVALID_OPERATION');
 assert.throws(()=>apply(p,[{type:'effects',clipId:'c1',values:{unsupported:1}}]),e=>e.code==='INVALID_OPERATION');
 assert.throws(()=>apply(p,[{type:'slip',clipId:'c1',delta:'0.1'}]),e=>e.code==='INVALID_OPERATION');
});
test('dry runs are deterministic, isolated, stale-safe and exactly match a guarded commit followed by undo',async()=>{
 const s=new Store(path.join(root,'plans'),ffmpeg);await s.init();await s.commit(basic(),'Fixture');
 const original=s.read(),disk=await fs.readFile(s.file,'utf8');
 const args={expectedRevision:original.revision,expectedProjectId:original.projectId,summary:'Split and mark',operations:[{type:'split',clipId:'c1',offset:.5},{type:'marker',time:.5,label:'Opening'}]};
 const plan=await s.plan(args);assert.equal(plan.noOp,false);assert.equal(plan.durationBefore,4);assert.equal(plan.durationAfter,4);
 assert.deepEqual(await s.plan(JSON.parse(JSON.stringify(args))),plan);assert.equal(await fs.readFile(s.file,'utf8'),disk);assert.deepEqual(s.read(),original);
 const reopened=new Store(s.root,ffmpeg);await reopened.init();assert.deepEqual(await reopened.plan(args),plan);
 await assert.rejects(s.plan({...args,expectedProjectId:'wrong'}),/Project mismatch/);
 await assert.rejects(s.plan({...args,expectedRevision:0}),/Stale/);
 await assert.rejects(s.plan({...args,operations:[...args.operations,{type:'trim',clipId:'missing',sourceIn:0,sourceOut:1}]}),/Unknown clip/);
 await assert.rejects(s.plan({...args,operations:[{type:'rename',title:'Not committed'},{type:'trim',clipId:'missing',sourceIn:0,sourceOut:1}]}),e=>e.code==='INVALID_OPERATION'&&e.details.operationIndex===1&&e.details.operationType==='trim');
 await assert.rejects(s.edit({...args,expectedPlanId:'wrong'}),/Plan mismatch/);assert.equal(await fs.readFile(s.file,'utf8'),disk);
 const changed=await s.edit({...args,expectedPlanId:plan.planId});
 const clipChange=plan.changes.find(c=>c.path==='/clips'),markerChange=plan.changes.find(c=>c.path==='/markers');
 assert.deepEqual(changed.clips,clipChange.after);assert.deepEqual(changed.markers,markerChange.after);
 await assert.rejects(s.edit({...args,expectedPlanId:plan.planId}),/Stale/);
 const undone=await s.undo({expectedRevision:changed.revision,expectedProjectId:original.projectId});
 assert.deepEqual(undone.clips,original.clips);assert.deepEqual(undone.markers,original.markers);assert.equal(undone.title,original.title);
 const noOp={expectedRevision:undone.revision,expectedProjectId:undone.projectId,summary:'Unchanged',operations:[{type:'rename',title:undone.title}]};
 const noOpPlan=await s.plan(noOp),beforeNoOp=await fs.readFile(s.file,'utf8');assert.equal(noOpPlan.noOp,true);assert.deepEqual(noOpPlan.changes,[]);
 assert.equal((await s.edit({...noOp,expectedPlanId:noOpPlan.planId})).revision,undone.revision);assert.equal(await fs.readFile(s.file,'utf8'),beforeNoOp);
 const destructive=await s.plan({...noOp,operations:[{type:'clear'}]});assert.deepEqual(destructive.destructiveOperations,['clear']);
});
test('saved plans survive reopen, reject corruption and stale state, enforce destructive confirmation and undo exactly',async()=>{
 const s=new Store(path.join(root,'saved-plans'),ffmpeg);await s.init();await s.commit(basic(),'Fixture');
 const before=s.read(),disk=await fs.readFile(s.file,'utf8');
 const args={expectedProjectId:before.projectId,expectedRevision:before.revision,summary:'Remove opening',operations:[{type:'remove_range',start:0,end:.5},{type:'rename',title:'Shorter'}]};
 const saved=await s.savePlan(args);assert.equal(await fs.readFile(s.file,'utf8'),disk);
 const reopened=new Store(s.root,ffmpeg);await reopened.init();
 assert.deepEqual((await reopened.readPlan({expectedProjectId:before.projectId,planId:saved.plan.planId})).plan,saved.plan);
 const commit={expectedProjectId:before.projectId,expectedRevision:before.revision,planId:saved.plan.planId};
 await assert.rejects(reopened.applyPlan(commit),e=>e.code==='CONFIRMATION_REQUIRED');
 await assert.rejects(reopened.applyPlan({...commit,confirmPlanId:'wrong'}),e=>e.code==='CONFIRMATION_REQUIRED');
 assert.equal(await fs.readFile(s.file,'utf8'),disk);
 await assert.rejects(reopened.readPlan({...commit,planId:'../project'}),e=>e.code==='INVALID_PLAN_ID');
 await assert.rejects(reopened.readPlan({...commit,planId:'0'.repeat(64)}),e=>e.code==='PLAN_NOT_FOUND');
 const text=await fs.readFile(saved.path,'utf8'),corrupt=JSON.parse(text);corrupt.plan.summary='Tampered';await fs.writeFile(saved.path,JSON.stringify(corrupt));
 await assert.rejects(reopened.applyPlan({...commit,confirmPlanId:commit.planId}),e=>e.code==='INVALID_PLAN');await fs.writeFile(saved.path,text);
 const changed=await reopened.applyPlan({...commit,confirmPlanId:commit.planId});assert.equal(changed.duration,3.5);assert.equal(changed.title,'Shorter');
 assert.deepEqual(changed.clips,saved.plan.changes.find(c=>c.path==='/clips').after);
 await assert.rejects(reopened.applyPlan({...commit,expectedRevision:changed.revision,confirmPlanId:commit.planId}),e=>e.code==='STALE_REVISION');
 const undone=await reopened.undo({expectedProjectId:before.projectId,expectedRevision:changed.revision});assert.deepEqual(undone.clips,before.clips);assert.equal(undone.title,before.title);
 await assert.rejects(reopened.applyPlan({...commit,expectedRevision:undone.revision,confirmPlanId:commit.planId}),e=>e.code==='STALE_REVISION');
 const other=new Store(path.join(root,'saved-plans-other'),ffmpeg);await other.init();await assert.rejects(other.readPlan({...commit}),e=>e.code==='PROJECT_MISMATCH');
});
test('independent processes serialize edits and reject a stale owner without losing the winning edit',{timeout:15000},async(t)=>{
 const data=path.join(root,'process-lock'),s=new Store(data,ffmpeg);await s.init();
 const script=`import {Store} from ${JSON.stringify(new URL('./engine.mjs',import.meta.url).href)};const s=new Store(process.argv[1],process.argv[2]);await s.init();process.send({ready:true});process.once('message',async ({title})=>{try{const p=await s.edit({expectedRevision:0,expectedProjectId:s.read().projectId,summary:title,operations:[{type:'rename',title}]});process.send({ok:true,title:p.title});}catch(e){process.send({ok:false,code:e.code});}process.disconnect();});`;
 const children=[];
 const launch=()=>new Promise((resolve,reject)=>{
   const child=spawn(process.execPath,['--input-type=module','-e',script,data,ffmpeg],{stdio:['ignore','ignore','pipe','ipc'],windowsHide:true});children.push(child);
   child.once('error',reject);child.once('exit',code=>{if(code)reject(Error('Worker exited '+code));});
   child.once('message',()=>resolve(child));
 });
 t.after(()=>children.forEach(c=>{if(c.exitCode===null)c.kill();}));
 const [a,b]=await Promise.all([launch(),launch()]);
 const result=c=>new Promise(resolve=>c.once('message',resolve));const pending=[result(a),result(b)];a.send({title:'First owner'});b.send({title:'Second owner'});
 const results=await Promise.all(pending);assert.equal(results.filter(r=>r.ok).length,1);assert.equal(results.find(r=>!r.ok).code,'STALE_REVISION');
 const latest=await s.snapshot();assert.equal(latest.revision,1);assert.equal(latest.title,results.find(r=>r.ok).title);
 const other=new Store(data,ffmpeg);await other.init();
 await assert.rejects(other.edit({expectedRevision:1,summary:'Invalid',operations:[{type:'trim',clipId:'missing',sourceIn:0,sourceOut:1}]}),e=>e.code==='INVALID_OPERATION');
 await other.edit({expectedRevision:1,summary:'Recovered queue',operations:[{type:'rename',title:'Recovered'}]});assert.equal((await s.snapshot()).title,'Recovered');
 await assert.rejects(fs.stat(path.join(data,'project.lock')),e=>e.code==='ENOENT');
 const lock=path.join(data,'project.lock');await fs.writeFile(lock,'abandoned fixture');
 await assert.rejects(s.edit({expectedRevision:2,summary:'Blocked',operations:[{type:'clear'}]}),e=>e.code==='PROJECT_BUSY');assert.equal(await fs.readFile(lock,'utf8'),'abandoned fixture');
 await fs.unlink(lock);assert.equal((await s.snapshot()).revision,2);
});
test('slide preserves selected media and downstream timing, checks handles/transitions/fades, and supports plan/apply/undo',async()=>{
 const p=basic();p.clips=[{...p.clips[0],id:'left',sourceIn:1,sourceOut:2,speed:.5},p.clips[0],{...p.clips[1],speed:2},{...p.clips[1],id:'last',sourceIn:1,sourceOut:2}];
 p.captions=[{id:'caption',text:'Fixed',start:2,end:3}];p.markers=[{id:'marker',time:3,label:'Fixed'}];
 p.layers=[{id:'layer',assetId:'a',kind:'video',start:2,sourceIn:0,sourceOut:1,track:1,speed:1,volume:1}];
 const original=structuredClone(p),times=timeline(p);
 for(const delta of [.25,-.25]){
   const q=apply(p,[{type:'slide',clipId:'c1',delta}]),t=timeline(q);
   assert.deepEqual(q.clips[1],p.clips[1]);assert.equal(t[1].start,times[1].start+delta);assert.equal(t.at(-1).end,times.at(-1).end);assert.equal(t[3].start,times[3].start);
   assert.equal(q.clips[0].sourceOut,2+delta*.5);assert.equal(q.clips[2].sourceIn,1+delta*2);
   assert.deepEqual(q.captions,p.captions);assert.deepEqual(q.markers,p.markers);assert.deepEqual(q.layers,p.layers);
 }
 assert.deepEqual(apply(p,[{type:'slide',clipId:'c1',delta:0}]),p);
 for(const clipId of ['left','last','missing'])assert.throws(()=>apply(p,[{type:'slide',clipId,delta:.1}]));
 for(const delta of [9,-9,Infinity,NaN,'1'])assert.throws(()=>apply(p,[{type:'rename',title:'Rollback'},{type:'slide',clipId:'c1',delta}]));
 for(const i of [0,1,2]){const q=structuredClone(p);q.clips[i].transitionOut=.1;assert.throws(()=>apply(q,[{type:'slide',clipId:'c1',delta:.1}]),/dissolve/);}
 const fades=structuredClone(p);fades.clips[0].effects={fadeOut:1.9};assert.throws(()=>apply(fades,[{type:'slide',clipId:'c1',delta:-.25}]),/fadeOut/);
 assert.deepEqual(p,original);
 const s=new Store(path.join(root,'slide-plan'),ffmpeg);await s.init();await s.commit(p,'Fixture');
 const args={expectedProjectId:s.projectId,expectedRevision:s.read().revision,summary:'Slide middle',operations:[{type:'slide',clipId:'c1',delta:.25}]};
 const plan=await s.plan(args),changed=await s.edit({...args,expectedPlanId:plan.planId});assert.equal(changed.duration,6);assert.deepEqual(changed.clips,plan.changes.find(c=>c.path==='/clips').after);
 const undone=await s.undo({expectedRevision:changed.revision,expectedProjectId:s.projectId});assert.deepEqual(undone.clips,p.clips);assert.deepEqual(undone.captions,p.captions);assert.deepEqual(undone.layers,p.layers);
});
test('rate stretch preserves source range, respects speed limits and dependencies, and supports plans and undo',async()=>{
 const p=basic(),original=structuredClone(p);
 for(const [duration,speed] of [[.5,4],[1,2],[4,.5],[8,.25]]){
   const q=apply(p,[{type:'rate_stretch',clipId:'c1',duration}]);assert.equal(q.clips[0].speed,speed);assert.equal(q.clips[0].sourceIn,1);assert.equal(q.clips[0].sourceOut,3);assert.equal(q.clips[0].id,'c1');assert.equal(timeline(q)[1].start,duration);assert.equal(timeline(q).at(-1).end,duration+2);
 }
 for(const duration of [0,-1,.499,8.001,NaN,Infinity,'2'])assert.throws(()=>apply(p,[{type:'rename',title:'Rollback'},{type:'rate_stretch',clipId:'c1',duration}]));
 assert.throws(()=>apply(p,[{type:'rate_stretch',clipId:'missing',duration:2}]));
 const fades=structuredClone(p);fades.clips[0].effects={fadeOut:1.5};assert.throws(()=>apply(fades,[{type:'rate_stretch',clipId:'c1',duration:1}]),/fadeOut/);
 const annotated=structuredClone(p);annotated.captions=[{id:'cap',text:'End',start:3,end:4}];assert.throws(()=>apply(annotated,[{type:'rate_stretch',clipId:'c1',duration:1}]));
 assert.deepEqual(p,original);
 const s=new Store(path.join(root,'stretch-plan'),ffmpeg);await s.init();await s.commit(p,'Fixture');
 const args={expectedProjectId:s.projectId,expectedRevision:s.read().revision,summary:'Stretch opening',operations:[{type:'rate_stretch',clipId:'c1',duration:4}]};
 const plan=await s.plan(args);assert.equal(plan.durationBefore,4);assert.equal(plan.durationAfter,6);
 const changed=await s.edit({...args,expectedPlanId:plan.planId});assert.deepEqual(changed.clips,plan.changes.find(c=>c.path==='/clips').after);
 const undone=await s.undo({expectedRevision:changed.revision,expectedProjectId:s.projectId});assert.deepEqual(undone.clips,p.clips);
});
test('insert splits speed-mapped media and crossing timed items, ripples boundaries and supports exact plan/undo',async()=>{
 const p=basic();p.clips[0].speed=2;
 p.captions=[{id:'cap',text:'Crossing',start:.25,end:1.5}];p.markers=[{id:'m',label:'Cut',time:.5}];p.exportRange={start:.25,end:2.5};
 p.layers=[{id:'l',kind:'video',assetId:'a',start:.25,sourceIn:0,sourceOut:1,track:1,speed:2,volume:1}];
 const op={type:'insert',assetId:'b',time:.5,sourceIn:0,sourceOut:1},q=apply(p,[op]);
 assert.equal(timeline(q).at(-1).end,4);assert.equal(q.clips.length,4);assert.equal(q.clips[0].id,'c1');assert.equal(q.clips[0].sourceOut,2);assert.equal(q.clips[2].sourceIn,2);assert.equal(q.clips[2].sourceOut,3);assert.equal(q.clips[2].speed,2);
 assert.deepEqual(q.captions.map(c=>[c.start,c.end]),[[.25,.5],[1.5,2.5]]);assert.notEqual(q.captions[0].id,q.captions[1].id);
 assert.deepEqual(q.layers.map(l=>[l.start,l.sourceIn,l.sourceOut]),[[.25,0,.5],[1.5,.5,1]]);assert.equal(q.markers[0].time,1.5);assert.deepEqual(q.exportRange,{start:.25,end:3.5});
 for(const time of [0,1,3]){const r=apply(p,[{...op,time}]);assert.equal(r.clips.length,3);assert.equal(timeline(r).at(-1).end,4);}
 const empty=basic();empty.clips=[];assert.equal(apply(empty,[{type:'insert',assetId:'a',time:0}]).clips[0].sourceOut,4);
 const endRange=basic();endRange.exportRange={start:0,end:2};assert.equal(apply(endRange,[{...op,time:2}]).exportRange.end,2);
 const before=structuredClone(p);
 for(const time of [-1,4,.005,NaN])assert.throws(()=>apply(p,[{type:'rename',title:'Rollback'},{...op,time}]));
 assert.throws(()=>apply(p,[{...op,sourceOut:5}]));assert.throws(()=>apply(p,[{...op,assetId:'missing'}]));
 const audio=basic();audio.assets[1].kind='audio';assert.throws(()=>apply(audio,[op]),/video asset/);
 const transition=basic();transition.clips[0].transitionOut=.1;assert.throws(()=>apply(transition,[op]),/dissolve/);assert.deepEqual(p,before);
 const s=new Store(path.join(root,'insert-plan'),ffmpeg);await s.init();await s.commit(p,'Fixture');
 const args={expectedProjectId:s.projectId,expectedRevision:s.read().revision,summary:'Insert source',operations:[op]};const plan=await s.plan(args);
 const changed=await s.edit({...args,expectedPlanId:plan.planId});for(const key of ['clips','captions','layers','markers'])assert.deepEqual(changed[key],plan.changes.find(c=>c.path==='/'+key).after);
 const undone=await s.undo({expectedRevision:changed.revision,expectedProjectId:s.projectId});for(const key of ['clips','captions','layers','markers','exportRange'])assert.deepEqual(undone[key],p[key]);
});
test('slip and roll preserve intended durations and reject exhausted handles atomically',()=>{
 const p=basic(),slipped=apply(p,[{type:'slip',clipId:'c1',delta:.25}]);
 assert.equal(slipped.clips[0].sourceIn,1.25);assert.equal(timeline(slipped).at(-1).end,4);
 const rolled=apply(p,[{type:'roll',clipId:'c1',delta:.25}]);
 assert.equal(rolled.clips[0].sourceOut,3.25);assert.equal(rolled.clips[1].sourceIn,1.25);assert.equal(timeline(rolled).at(-1).end,4);
 const before=JSON.stringify(p);assert.throws(()=>apply(p,[{type:'rename',title:'Should roll back'},{type:'slip',clipId:'c1',delta:9}]));assert.equal(JSON.stringify(p),before);
 assert.throws(()=>apply(p,[{type:'roll',clipId:'c2',delta:.1}]));
});
test('dissolve reduces timeline duration; excessive overlap and last-clip transitions reject',()=>{
 const p=apply(basic(),[{type:'transition',clipId:'c1',seconds:.5}]);
 assert.equal(timeline(p)[1].start,1.5);assert.equal(timeline(p).at(-1).end,3.5);
 assert.throws(()=>apply(p,[{type:'transition',clipId:'c1',seconds:3}]));
 assert.throws(()=>apply(p,[{type:'transition',clipId:'c2',seconds:.1}]));
});
test('effects, markers, layers, duplicate and export ranges persist and validate',()=>{
 let p=apply(basic(),[{type:'effects',clipId:'c1',values:{brightness:.1,contrast:1.1,saturation:.8,scale:.8,rotation:10,offsetX:.1,offsetY:.05,cropLeft:.05,cropRight:.05,cropTop:0,cropBottom:0,flipH:true,flipV:false,fadeIn:.2,fadeOut:.2,audioFadeIn:.1,audioFadeOut:.1,opacity:.8}},{type:'marker',time:1,label:'Beat'},{type:'layer_add',kind:'video',assetId:'b',start:.5,sourceIn:0,sourceOut:1,track:1,volume:.3,speed:1},{type:'set_range',start:.5,end:3}]);
 assert.equal(p.markers.length,1);assert.equal(p.layers.length,1);
 p=apply(p,[{type:'layer_update',layerId:p.layers[0].id,volume:.5},{type:'delete_marker',markerId:p.markers[0].id},{type:'layer_delete',layerId:p.layers[0].id},{type:'clear_range'},{type:'duplicate',clipId:'c1',index:1}]);
 assert.equal(p.markers.length,0);assert.equal(p.layers.length,0);assert.equal(p.clips.length,3);assert.notEqual(p.clips[0].id,p.clips[1].id);
 assert.throws(()=>apply(basic(),[{type:'set_range',start:3,end:2}]));assert.throws(()=>apply(basic(),[{type:'effects',clipId:'c1',values:{cropLeft:.8,cropRight:.8}}]));
});
test('redo, branching, checkpoints, SRT and stale revision behavior',async()=>{
 const s=new Store(path.join(root,'history'),ffmpeg);await s.init();
 let p=await s.commit(basic(),'Fixture');
 const edit=async operations=>s.edit({expectedRevision:s.read().revision,summary:'Test edit',operations});
 p=await edit([{type:'rename',title:'Saved title'}]);await s.checkpoint({action:'save',name:'Before edits',expectedRevision:p.revision});
 p=await edit([{type:'rename',title:'Changed title'}]);p=await s.undo({expectedRevision:p.revision});assert.equal(p.title,'Saved title');
 p=await s.redo({expectedRevision:p.revision});assert.equal(p.title,'Changed title');
 p=await s.undo({expectedRevision:p.revision});p=await edit([{type:'rename',title:'New branch'}]);await assert.rejects(s.redo({expectedRevision:p.revision}));
 await s.checkpoint({action:'restore',name:'Before edits',expectedRevision:s.read().revision});assert.equal(s.read().title,'Saved title');
 p=await s.importSubtitles({text:'1\n00:00:00,100 --> 00:00:01,000\nHello locally\n\n2\n00:00:02,000 --> 00:00:03,000\nSecond line\n',replace:true,expectedRevision:s.read().revision});assert.equal(p.captions.length,2);assert.equal(p.captions[0].text,'Hello locally');
 const snapshot=JSON.stringify(s.read());await assert.rejects(s.importSubtitles({text:'not SRT',replace:true,expectedRevision:p.revision}));assert.equal(JSON.stringify(s.read()),snapshot);
 await assert.rejects(s.edit({expectedRevision:0,summary:'stale',operations:[{type:'clear'}]}),/Stale/);
});
test('old projects remain neutral and audio-only WAV assets import into audio layers',async()=>{
 const old=basic(),q=apply(old,[{type:'rename',title:'Legacy project'}]);assert.deepEqual(q.clips,old.clips);assert.equal(timeline(q).at(-1).end,4);
 const s=new Store(path.join(root,'audio-import'),ffmpeg);await s.init();await s.commit(old,'Legacy fixture');
 const wav=path.join(root,'tone.wav');await run(ffmpeg,['-hide_banner','-nostdin','-y','-f','lavfi','-i','sine=frequency=330:sample_rate=48000','-t','1',wav]);
 const p=await s.import({path:wav}),a=p.assets.at(-1);assert.equal(a.kind,'audio');assert.equal(a.hasAudio,true);
 assert.throws(()=>apply(p,[{type:'append',assetId:a.id}]));
 const layered=apply(p,[{type:'layer_add',kind:'audio',assetId:a.id,start:0,sourceIn:0,sourceOut:.9}]);assert.equal(layered.layers.length,1);
});
test('local render composes dissolves, color, crop, fades, overlay and audio; range limits export',async()=>{
 const s=new Store(path.join(root,'render'),ffmpeg);await s.init();
 for(const [name,color,tone] of [['a','red',440],['b','blue',660]]) await run(ffmpeg,['-hide_banner','-nostdin','-y','-f','lavfi','-i',`color=c=${color}:s=320x180:r=30`,'-f','lavfi','-i',`sine=frequency=${tone}:sample_rate=48000`,'-t','4','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac',path.join(s.root,'media',name+'.mp4')]);
 const p=apply(basic(),[{type:'transition',clipId:'c1',seconds:.5},{type:'effects',clipId:'c1',values:{brightness:.05,contrast:1.1,saturation:.8,cropLeft:.05,cropRight:.05,fadeIn:.15,fadeOut:.15,audioFadeIn:.1,audioFadeOut:.1}},{type:'layer_add',kind:'video',assetId:'b',start:.5,sourceIn:0,sourceOut:1,track:1,volume:0},{type:'layer_add',kind:'audio',assetId:'a',start:0,sourceIn:0,sourceOut:3,track:1,volume:.2},{type:'set_range',start:.25,end:3.25}]);
 await s.commit(p,'Composed fixture');const r=new Renderer(s),job={id:'composed',status:'rendering',progress:0};await r.render(p,job);
 assert.equal(job.status,'complete');const meta=await probe(ffmpeg,job.path);assert.ok(Math.abs(meta.duration-3)<.12,`Expected 3s ranged export, got ${meta.duration}`);assert.equal(meta.width,320);assert.equal(meta.height,180);assert.equal(meta.hasAudio,true);
 const stats=async time=>{const frame=await r.frame(time);assert.ok((await fs.stat(frame.path)).size>100);const {err}=await run(ffmpeg,['-hide_banner','-nostdin','-i',frame.path,'-vf','signalstats,metadata=print','-frames:v','1','-f','null','-']);const u=Number(err.match(/lavfi.signalstats.UAVG=([\d.]+)/)?.[1]),v=Number(err.match(/lavfi.signalstats.VAVG=([\d.]+)/)?.[1]);assert.ok(Number.isFinite(u)&&Number.isFinite(v),'Color statistics must be present');return {u,v};};
 const overlay=await stats(.75);assert.ok(overlay.u>200&&overlay.v<140,`Blue overlay must cover red base: ${JSON.stringify(overlay)}`);
 const mixed=await stats(1.75);assert.ok(mixed.u>120&&mixed.u<225&&mixed.v>120&&mixed.v<220,`Dissolve must contain red and blue, not a hard cut: ${JSON.stringify(mixed)}`);
 const stretched=basic();stretched.clips=stretched.clips.slice(0,1);const output=apply(stretched,[{type:'rate_stretch',clipId:'c1',duration:4}]);
 const stretchJob={id:'rate-stretch',status:'rendering',progress:0};await r.render(output,stretchJob);assert.equal(stretchJob.status,'complete');
 const stretchedMeta=await probe(ffmpeg,stretchJob.path);assert.ok(Math.abs(stretchedMeta.duration-4)<.12,`Expected 4s stretched export, got ${stretchedMeta.duration}`);assert.equal(stretchedMeta.hasAudio,true);
 const insertBase=basic();insertBase.clips=insertBase.clips.slice(0,1);const inserted=apply(insertBase,[{type:'insert',assetId:'b',time:1,sourceIn:0,sourceOut:1}]);
 const insertJob={id:'insert',status:'rendering',progress:0};await r.render(inserted,insertJob);const insertMeta=await probe(ffmpeg,insertJob.path);assert.ok(Math.abs(insertMeta.duration-3)<.12);assert.equal(insertMeta.hasAudio,true);
 const adapted=legacyRenderSnapshot(convertV1(p)),migrationJob={id:'migration-adapter',status:'rendering',progress:0};assert.deepEqual(adapted,p);await r.render(convertV1(p),migrationJob);
 const decoded=async file=>(await run(ffmpeg,['-hide_banner','-nostdin','-i',file,'-map','0:v:0','-map','0:a:0','-f','framemd5','-'])).out.split('\n').filter(line=>!line.startsWith('#')).join('\n');
 assert.equal(await decoded(migrationJob.path),await decoded(job.path),'Migrated compatibility output must decode to identical video/audio frames');
});
