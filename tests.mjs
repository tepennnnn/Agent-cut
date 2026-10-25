import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import readline from 'node:readline';
import {apply,validate,timeline,Store,Renderer,run,probe} from './engine.mjs';
import {operationRegistry} from './operations.mjs';
const ROOT=path.dirname(fileURLToPath(import.meta.url)),WORK=path.resolve(ROOT,'../../work/agent-cut-tests');
const config=JSON.parse(await fs.readFile(path.join(ROOT,'config.local.json'),'utf8'));
const ffmpeg=process.env.AGENT_CUT_FFMPEG||config.ffmpeg;
await fs.mkdir(WORK,{recursive:true});
const root=await fs.mkdtemp(path.join(WORK,'run-'));
const fixture=path.join(root,'source.mp4');
await run(ffmpeg,['-hide_banner','-nostdin','-y','-f','lavfi','-i','testsrc2=size=320x180:rate=30','-f','lavfi','-i','aevalsrc=if(between(t\\,1\\,2)\\,0\\,0.2*sin(2*PI*440*t)):s=48000:d=3','-t','3','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac',fixture]);
const basic=()=>({title:'Test',canvas:{width:320,height:180,fps:30},assets:[{id:'asset',name:'source.mp4',file:'source.mp4',duration:10,width:320,height:180,hasAudio:true}],clips:[{id:'clip',assetId:'asset',sourceIn:1,sourceOut:9,speed:2,volume:1}],captions:[]});
test('split preserves source ranges and duration; move, trim, speed and volume',()=>{
  const p=basic(),q=apply(p,[{type:'split',clipId:'clip',offset:1.5}]);
  assert.equal(q.clips[0].sourceOut,4);assert.equal(q.clips[1].sourceIn,4);assert.equal(timeline(q).at(-1).end,4);assert.equal(p.clips.length,1);
  const r=apply(q,[{type:'move',clipId:q.clips[1].id,index:0},{type:'trim',clipId:'clip',sourceIn:1,sourceOut:3},{type:'speed',clipId:'clip',speed:1},{type:'volume',clipId:'clip',volume:0}]);assert.equal(r.clips[0].id,q.clips[1].id);assert.equal(r.clips[1].volume,0);
});
test('ripple removal maps speed correctly and retimes captions',()=>{
  const p=basic();p.captions=[{id:'cap',text:'Caption',start:.5,end:3}];
  const q=apply(p,[{type:'remove_range',start:1,end:2}]);assert.equal(timeline(q).at(-1).end,3);assert.equal(q.clips[0].sourceOut,3);assert.equal(q.clips[1].sourceIn,5);assert.equal(q.captions[0].end,2);
  assert.equal(apply(p,[{type:'remove_range',start:0,end:4}]).clips.length,0);
});
test('invalid transaction leaves source unchanged',()=>{
  const p=basic(),snapshot=JSON.stringify(p);assert.throws(()=>apply(p,[{type:'volume',clipId:'clip',volume:0},{type:'trim',clipId:'clip',sourceIn:5,sourceOut:2}]));assert.equal(JSON.stringify(p),snapshot);
  assert.throws(()=>apply(p,[{type:'canvas',width:321,height:180,fps:30}]));assert.throws(()=>apply(p,[{type:'speed',clipId:'clip',speed:0}]));assert.throws(()=>apply(p,[{type:'caption',text:'',start:0,end:1}]));
});
test('local media probe, persistent revision, conflict and undo',async()=>{
  const meta=await probe(ffmpeg,fixture);assert.equal(meta.width,320);assert.ok(meta.hasAudio);assert.ok(Math.abs(meta.duration-3)<.1);
  const s=new Store(path.join(root,'store'),ffmpeg);await s.init();await assert.rejects(s.import({path:'https://example.com/video.mp4'}));
  let p=await s.import({path:fixture});p=await s.edit({expectedRevision:p.revision,summary:'Append source',operations:[{type:'append',assetId:p.assets[0].id}]});
  await assert.rejects(s.edit({expectedRevision:0,summary:'stale',operations:[{type:'clear'}]}),/Stale/);
  const restored=await s.undo({expectedRevision:p.revision});assert.equal(restored.clips.length,0);assert.equal(restored.revision,p.revision+1);
  const reopened=new Store(path.join(root,'store'),ffmpeg);await reopened.init();assert.equal(reopened.read().revision,restored.revision);
});
test('real FFmpeg render, caption frame, silence detector and exported duration',async()=>{
  const s=new Store(path.join(root,'render'),ffmpeg);await s.init();let p=await s.import({path:fixture});
  p=await s.edit({expectedRevision:p.revision,summary:'Compose fixture',operations:[{type:'canvas',width:320,height:180,fps:30},{type:'append',assetId:p.assets[0].id,sourceIn:0,sourceOut:2.4}]});
  p=await s.edit({expectedRevision:p.revision,summary:'Split and caption',operations:[{type:'split',clipId:p.clips[0].id,offset:1.2},{type:'caption',text:'LOCAL : 100% \' test',start:.2,end:.8}]});
  p=await s.edit({expectedRevision:p.revision,summary:'Speed and mute',operations:[{type:'speed',clipId:p.clips[1].id,speed:2},{type:'volume',clipId:p.clips[1].id,volume:0}]});
  const r=new Renderer(s);const frame=await r.frame(.4);const bytes=await fs.readFile(frame.path);assert.equal(bytes.subarray(1,4).toString(),'PNG');
  const silent=await r.silence(p.assets[0].id,-35,.4);assert.ok(silent.intervals.some(i=>i.start<1.1&&i.end>1.9));
  const job=r.start();while(r.status(job.id).status==='rendering')await new Promise(resolve=>setTimeout(resolve,100));
  const final=r.status(job.id);assert.equal(final.status,'complete',final.error);const meta=await probe(ffmpeg,final.path);assert.equal(meta.width,320);assert.ok(Math.abs(meta.duration-1.8)<.15,`duration=${meta.duration}`);assert.ok(meta.hasAudio);
  await fs.writeFile(path.join(ROOT,'verification-render.json'),JSON.stringify({source:fixture,export:final.path,expectedDuration:1.8,observedDuration:meta.duration,dimensions:[meta.width,meta.height],frame:frame.path,silenceIntervals:silent.intervals},null,2));
});
test('stdio MCP handshake, tool discovery, import and edit calls',async(t)=>{
  const data=path.join(root,'mcp'),port=45000+process.pid%1000;
  const child=spawn(process.execPath,[path.join(ROOT,'server.mjs'),'--stdio'],{env:{...process.env,AGENT_CUT_DATA:data,AGENT_CUT_PORT:String(port)},stdio:['pipe','pipe','pipe'],windowsHide:true});
  let errors='';child.stderr.on('data',b=>errors+=b);const lines=readline.createInterface({input:child.stdout});const pending=new Map();let id=0;
  lines.on('line',line=>{const result=JSON.parse(line),entry=pending.get(result.id);if(entry){clearTimeout(entry.timer);pending.delete(result.id);entry.resolve(result);}});
  const rpc=(method,params={})=>new Promise((resolve,reject)=>{const key=++id;pending.set(key,{resolve,timer:setTimeout(()=>reject(Error('MCP timed out: '+errors)),15000)});child.stdin.write(JSON.stringify({jsonrpc:'2.0',id:key,method,params})+'\n');});
  try{
    const hello=await rpc('initialize',{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'test',version:'1'}});assert.equal(hello.result.protocolVersion,'2025-06-18');
    const listing=await rpc('tools/list');assert.equal(listing.result.tools.length,39);
    for(const [name,argumentsForTool,key] of [['media_find',{query:'opening'},'assets'],['media_status',{},'offlineCount'],['subtitle_export',{format:'vtt'},'text']]){const response=await rpc('tools/call',{name,arguments:argumentsForTool});assert.equal(response.result.isError,undefined);assert.ok(Object.hasOwn(response.result.structuredContent,key));}
    const contracts=await rpc('tools/call',{name:'timeline_operations',arguments:{}});assert.deepEqual(contracts.result.structuredContent.operations,operationRegistry);
    const editSchema=listing.result.tools.find(t=>t.name==='timeline_edit').inputSchema.properties.operations.items;
    assert.deepEqual(editSchema.oneOf,Object.values(operationRegistry).map(d=>d.schema));
    let result=await rpc('tools/call',{name:'project_read',arguments:{}});assert.equal(result.result.structuredContent.revision,0);
    const identity=result.result.structuredContent.projectId;assert.match(identity,/^project_[a-f0-9]{64}$/);
    const migration=await rpc('tools/call',{name:'project_migration_preview',arguments:{expectedProjectId:identity,expectedRevision:0}});assert.equal(migration.result.structuredContent.activationAvailable,true);assert.equal(migration.result.structuredContent.legacyRoundTripMatches,true);assert.equal(migration.result.structuredContent.proposedProject.schemaVersion,2);
    const info=await rpc('tools/call',{name:'editor_info',arguments:{}});assert.equal(info.result.structuredContent.projectId,identity);assert.equal(info.result.structuredContent.identityScope,'data-directory');assert.equal(info.result.structuredContent.token,undefined);
    for(const name of ['timeline_edit','render_start']){
      const argumentsForTool=name==='timeline_edit'?{expectedRevision:0,summary:'Wrong project',operations:[{type:'rename',title:'Wrong'}]}:{};
      const rejected=await rpc('tools/call',{name,arguments:{...argumentsForTool,expectedProjectId:'another-project'}});
      assert.equal(rejected.result.isError,true);assert.match(rejected.result.content[0].text,/Project mismatch/);
    }
    result=await rpc('tools/call',{name:'project_read',arguments:{}});assert.equal(result.result.structuredContent.revision,0);
    const plannedArgs={expectedRevision:0,expectedProjectId:identity,summary:'Rename via MCP',operations:[{type:'rename',title:'MCP test'}]};
    const planned=await rpc('tools/call',{name:'timeline_plan',arguments:plannedArgs});assert.equal(planned.result.structuredContent.noOp,false);assert.equal(planned.result.structuredContent.changes[0].path,'/title');
    const savedPlan=await rpc('tools/call',{name:'timeline_plan_save',arguments:plannedArgs});assert.equal(savedPlan.result.structuredContent.plan.planId,planned.result.structuredContent.planId);
    const loadedPlan=await rpc('tools/call',{name:'timeline_plan_read',arguments:{expectedProjectId:identity,planId:planned.result.structuredContent.planId}});assert.deepEqual(loadedPlan.result.structuredContent.plan,planned.result.structuredContent);
    const wrongPlan=await rpc('tools/call',{name:'timeline_plan_apply',arguments:{expectedProjectId:'wrong',expectedRevision:0,planId:planned.result.structuredContent.planId}});assert.equal(wrongPlan.result.structuredContent.error.code,'PROJECT_MISMATCH');
    const unchanged=await rpc('tools/call',{name:'project_read',arguments:{}});assert.equal(unchanged.result.structuredContent.revision,0);
    const invalidPlan=await rpc('tools/call',{name:'timeline_plan',arguments:{...plannedArgs,operations:[{type:'rename',title:'MCP test',unexpected:true}]}});assert.equal(invalidPlan.result.isError,true);
    result=await rpc('tools/call',{name:'timeline_edit',arguments:{expectedRevision:0,summary:'Rename via MCP',operations:[{type:'rename',title:'MCP test'}]}});assert.equal(result.result.structuredContent.title,'MCP test');
    result=await rpc('tools/call',{name:'timeline_edit',arguments:{expectedRevision:0,summary:'stale',operations:[{type:'clear'}]}});assert.equal(result.result.isError,true);
    result=await rpc('tools/call',{name:'media_import',arguments:{path:fixture}});const asset=result.result.structuredContent.assets[0];
    assert.equal(asset.width,320);
    result=await rpc('tools/call',{name:'timeline_edit',arguments:{expectedRevision:result.result.structuredContent.revision,summary:'Append via MCP',operations:[{type:'append',assetId:asset.id}]}});assert.equal(result.result.structuredContent.clips.length,1);
    result=await rpc('tools/call',{name:'frame_preview',arguments:{time:.5}});assert.ok(result.result.content.some(c=>c.type==='image'&&c.mimeType==='image/png'));
    let read=(await rpc('tools/call',{name:'project_read',arguments:{}})).result.structuredContent;
    const upgrade=(await rpc('tools/call',{name:'project_migration_preview',arguments:{expectedProjectId:identity,expectedRevision:read.revision}})).result.structuredContent;
    read=(await rpc('tools/call',{name:'project_migration_activate',arguments:{expectedProjectId:identity,expectedRevision:read.revision,expectedPlanId:upgrade.planId,confirmPlanId:upgrade.planId}})).result.structuredContent;
    const sequenceId=read.activeSequenceId,itemId=read.sequences[0].tracks.find(t=>t.kind==='video').items[0].id;
    const editArgs={expectedProjectId:identity,expectedRevision:read.revision,summary:'Split and dissolve through MCP',operations:[{type:'sequence_settings',sequenceId,width:320,height:180},{type:'item_split',sequenceId,itemId,time:1},{type:'sequence_transition',sequenceId,itemId,seconds:.2},{type:'item_keyframes',sequenceId,itemId,property:'opacity',frames:[{time:0,value:0},{time:1,value:1}]}]};
    const splitPlan=(await rpc('tools/call',{name:'timeline_plan',arguments:editArgs})).result.structuredContent;
    result=await rpc('tools/call',{name:'timeline_edit',arguments:{...editArgs,expectedPlanId:splitPlan.planId}});assert.equal(result.result.isError,undefined,JSON.stringify(result.result));read=result.result.structuredContent;assert.equal(read.sequences[0].transitions.length,1);
    const animationFrame=await rpc('tools/call',{name:'frame_preview',arguments:{time:.5}});assert.ok(animationFrame.result.content.some(c=>c.type==='image'));
    const audioId=read.sequences[0].tracks.find(t=>t.kind==='audio').items[0].id;const audioRead=await rpc('tools/call',{name:'audio_analyze',arguments:{sequenceId,itemId:audioId,expectedProjectId:identity,targetLUFS:-23}});assert.ok(Number.isFinite(audioRead.result.structuredContent.meanDbFS));assert.equal(audioRead.result.structuredContent.revision,read.revision);
    const sourceMatch=await rpc('tools/call',{name:'sequence_inspect',arguments:{timecode:'00:00:00:15'}});assert.equal(sourceMatch.result.structuredContent.frame,15);assert.ok(sourceMatch.result.structuredContent.matches.length>=2);
    result=await rpc('tools/call',{name:'render_start',arguments:{preview:true,expectedRevision:read.revision-1,expectedProjectId:identity}});assert.equal(result.result.structuredContent.error.code,'STALE_REVISION');
    result=await rpc('tools/call',{name:'timeline_undo',arguments:{expectedRevision:read.revision,expectedProjectId:identity}});assert.equal(result.result.structuredContent.sequences[0].transitions.length,0);
    result=await rpc('tools/call',{name:'timeline_undo',arguments:{expectedRevision:result.result.structuredContent.revision,expectedProjectId:identity}});assert.equal(result.result.structuredContent.schemaVersion,undefined);
    await t.test('live loopback HTTP authorization and media ranges',async(t)=>{
      const runtime=JSON.parse(await fs.readFile(path.join(data,'runtime.json'),'utf8'));
      let response;try{response=await fetch(`http://127.0.0.1:${port}/api/project`);}catch(e){if(e.cause?.code==='EACCES'){t.skip('Sandbox denies local TCP connections; live HTTP integration unverified.');return;}throw e;}
      assert.equal(response.status,401);
      assert.equal((await fetch(`http://127.0.0.1:${port}/api/project`,{headers:{'x-agent-cut-token':runtime.token,Origin:'https://untrusted.example'}})).status,403);
      response=await fetch(`http://127.0.0.1:${port}/media/${asset.id}?token=${runtime.token}`,{headers:{Range:'bytes=0-31'}});assert.equal(response.status,206);assert.equal((await response.arrayBuffer()).byteLength,32);
      const html=await(await fetch(`http://127.0.0.1:${port}/`)).text();assert.match(html,/AGENT CUT/);
      const {UI_ASSETS}=await import('./ui-assets.mjs');
      for(const route of UI_ASSETS){
        const assetResponse=await fetch(`http://127.0.0.1:${port}${route}`);
        assert.equal(assetResponse.status,200,route);
        assert.match(assetResponse.headers.get('content-type'),route.endsWith('.css')?/text\/css/:/text\/javascript/);
        assert.ok((await assetResponse.text()).length>0,route);
      }
    });
    const beforeMigration=await rpc('tools/call',{name:'project_read',arguments:{}}),sourceProject=beforeMigration.result.structuredContent;
    const migrationPlan=await rpc('tools/call',{name:'project_migration_preview',arguments:{expectedProjectId:identity,expectedRevision:sourceProject.revision}});
    const migrated=await rpc('tools/call',{name:'project_migration_activate',arguments:{expectedProjectId:identity,expectedRevision:sourceProject.revision,expectedPlanId:migrationPlan.result.structuredContent.planId,confirmPlanId:migrationPlan.result.structuredContent.planId}});assert.equal(migrated.result.structuredContent.schemaVersion,2);
    const backupId=migrated.result.structuredContent.migrationBackup.backupId;
    const recovery=await rpc('tools/call',{name:'project_restore_preview',arguments:{expectedProjectId:identity,expectedRevision:migrated.result.structuredContent.revision,backupId}});
    const restored=await rpc('tools/call',{name:'project_restore_backup',arguments:{expectedProjectId:identity,expectedRevision:migrated.result.structuredContent.revision,backupId,expectedPlanId:recovery.result.structuredContent.planId,confirmPlanId:recovery.result.structuredContent.planId}});assert.deepEqual(restored.result.structuredContent.clips,sourceProject.clips);assert.equal(restored.result.structuredContent.schemaVersion,undefined);
  }finally{child.stdin.end();await new Promise(resolve=>{child.once('exit',resolve);setTimeout(()=>{child.kill();resolve();},3000).unref();});for(const entry of pending.values())clearTimeout(entry.timer);}
});
