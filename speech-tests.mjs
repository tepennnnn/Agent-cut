import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {Store,Renderer,run,canonical,apply} from './engine.mjs';
import {convertV1,timeFromSeconds as T} from './sequences.mjs';
import {SpeechService,pcmDuration,pcmSilent} from './speech-service.mjs';
import {SpeechSetup,fileDigest} from './speech-setup.mjs';
import {normalizeWhisper,mapTranscriptCaptions,transcriptText} from './transcript-model.mjs';
import {JobService} from './job-service.mjs';

const root=path.dirname(fileURLToPath(import.meta.url)),scratch=path.resolve(root,'../../work/speech-tests');
const fixture=()=>{const p=convertV1({title:'Speech fixture',canvas:{width:320,height:180,fps:30},assets:[{id:'source',file:'source.wav',name:'English synthetic narration',kind:'audio',duration:10,width:0,height:0,hasAudio:true}],clips:[],captions:[]});p.sequences[0].tracks.push({id:'voice-track',name:'Voice',kind:'audio',role:'layer',lane:1,locked:false,muted:false,solo:false,targeted:true,syncLocked:true,items:[{id:'voice',assetId:'source',start:T(0),duration:T(10),sourceIn:0,sourceOut:10,speed:1,volume:1,origin:'layer',originIndex:0}]});return p;};
const text='1\n00:00:01,000 --> 00:00:03,000\nFirst source passage.\n\n2\n00:00:04,000 --> 00:00:05,000\nSecond source passage.\n';
async function setup(){
  await fs.mkdir(scratch,{recursive:true});const dir=await fs.mkdtemp(path.join(scratch,'case-'));
  const ffmpeg=JSON.parse(await fs.readFile(path.join(root,'config.local.json'),'utf8')).ffmpeg,s=new Store(dir,ffmpeg);await s.init();await s.commit(fixture(),'Synthetic speech fixture');
  await run(ffmpeg,['-hide_banner','-nostdin','-y','-f','lavfi','-i','anullsrc=r=16000:cl=mono','-t','10','-c:a','pcm_s16le',path.join(dir,'media/source.wav')]);
  const renderer=new Renderer(s);await renderer.ready;return {s,renderer,service:new SpeechService(s,renderer),guard:{expectedProjectId:s.projectId},dir};
}

test('speech timestamps use physically decoded bounds; invalid/overlapping data and literal-text limits reject',()=>{
  const result=normalizeWhisper({transcription:[{offsets:{from:0,to:3000},text:' café 😀 '},{offsets:{from:3500,to:12360},text:'Clipped final words'},{offsets:{from:13000,to:14000},text:'Outside'}]},{start:5,end:15,decodedSeconds:9.75});
  assert.equal(result.segments[0].start,5);assert.equal(result.segments[1].end,14.75);assert.equal(result.segments[1].clipped,true);assert.equal(result.segments[0].uncertainty,null);assert.equal(result.warnings.length,2);
  assert.equal(transcriptText('literal %{command} <b> 😀'),'literal %{command} <b> 😀');
  for(const text of ['','x\0','\ud800','x'.repeat(1001)])assert.throws(()=>transcriptText(text));
  for(const raw of [{},{transcription:[{offsets:{from:-1,to:3},text:'Bad'}]},{transcription:[{offsets:{from:0,to:3000},text:'a'},{offsets:{from:2000,to:4000},text:'b'}]}])assert.throws(()=>normalizeWhisper(raw,{start:0,end:5,decodedSeconds:5}));
});

test('caption mapping honors trims, constant rates and inverse speed curves, and refuses ambiguous combinations',()=>{
  const p=fixture(),sid=p.activeSequenceId,item=p.sequences[0].tracks[0].items[0],doc={assetId:'source',segments:[{id:'s1',start:1,end:3,text:'One'},{id:'s2',start:4,end:8,text:'Two'}]};
  item.sourceIn=2;item.sourceOut=8;item.start=T(5);item.speed=2;item.duration=T(3);
  const mapped=mapTranscriptCaptions(p,doc,{itemIds:[item.id]});assert.deepEqual(mapped.operations.map(c=>[c.start,c.end]),[[5,5.5],[6,8]]);assert.equal(mapped.evidence[0].clipped,true);
  item.sourceIn=0;item.sourceOut=10;item.start=T(2);item.speed=1;item.duration=T(5);item.speedCurve=[{time:0,speed:1},{time:5,speed:3}];
  const ramp=mapTranscriptCaptions(p,doc,{sequenceId:sid,itemIds:[item.id],segmentIds:['s2']});
  const start=ramp.operations[0].start-2;assert.ok(Math.abs(start+.2*start*start-4)<1e-8);
  assert.throws(()=>mapTranscriptCaptions(p,doc,{itemIds:[item.id,item.id]}));
  for(const change of [{reverse:true},{frameHold:{time:0}},{assetId:'different'}])assert.throws(()=>mapTranscriptCaptions({...p,sequences:[{...p.sequences[0],tracks:[{...p.sequences[0].tracks[0],items:[{...item,...change}]}]}]},doc,{itemIds:[item.id]}));
  p.sequences[0].tracks[0].locked=true;assert.throws(()=>mapTranscriptCaptions(p,doc,{itemIds:[item.id]}),/locked/);
});

test('manual transcript fallback is durable, bounded, revision/query guarded and independent of timeline undo',async()=>{
  const {s,service,guard,dir,renderer}=await setup(),before=await fs.readFile(s.file),imported=await service.import({...guard,assetId:'source',text,format:'srt',language:'en'});
  assert.equal((await service.setup.readiness()).ready,false);
  await assert.rejects(()=>service.start({...guard,assetId:'source'}),/configure/);
  const first=await service.read({...guard,transcriptId:imported.transcriptId,pageSize:1});assert.equal(first.segments.length,1);assert.ok(Buffer.byteLength(JSON.stringify(first))<=16384);
  const next=await service.read({...guard,transcriptId:imported.transcriptId,pageSize:1,cursor:first.coverage.nextCursor});assert.equal(next.segments[0].id,'segment_1');
  await assert.rejects(()=>service.read({...guard,transcriptId:imported.transcriptId,query:'other',cursor:first.coverage.nextCursor}),/query/);
  await service.correct({...guard,transcriptId:imported.transcriptId,segmentId:'segment_0',expectedAnalysisRevision:0,text:'Corrected opening.'});
  await assert.rejects(()=>service.correct({...guard,transcriptId:imported.transcriptId,segmentId:'segment_0',expectedAnalysisRevision:0,text:'Stale'}),/changed/);
  await assert.rejects(()=>service.read({...guard,transcriptId:imported.transcriptId,pageSize:1,cursor:first.coverage.nextCursor}),/changed/);
  const reopened=new SpeechService(s,renderer),read=await reopened.read({...guard,transcriptId:imported.transcriptId,query:'corrected'});assert.equal(read.segments[0].rawText,'First source passage.');assert.equal(read.analysisRevision,1);
  const item=s.db.project.sequences[0].tracks[0].items[0],draft=await reopened.captions({...guard,transcriptId:imported.transcriptId,expectedAnalysisRevision:1,expectedRevision:s.db.revision,itemIds:[item.id]});
  assert.equal(draft.committed,false);assert.deepEqual(await fs.readFile(s.file),before);
  const base=canonical(s.db.project);await s.applyPlan({...guard,expectedRevision:s.db.revision,planId:draft.plan.planId});assert.equal(s.db.project.sequences[0].captions[0].text,'Corrected opening.');
  await s.undo({...guard,expectedRevision:s.db.revision});assert.equal(canonical(s.db.project),base);
  assert.equal((await reopened.read({...guard,transcriptId:imported.transcriptId})).analysisRevision,1);
  await fs.appendFile(path.join(dir,'media/source.wav'),'changed');
  await assert.rejects(()=>reopened.read({...guard,transcriptId:imported.transcriptId}),e=>e.code==='SOURCE_CHANGED');
  await assert.rejects(()=>service.read({...guard,transcriptId:'../escape'}),/ID/);
});

test('model/setup errors, no audio, stale identity and unsupported language never edit the timeline',async()=>{
  const {s,service,guard}=await setup(),before=await fs.readFile(s.file);
  await assert.rejects(()=>service.start({...guard,assetId:'source',language:'fr'}),e=>e.code==='SPEECH_LANGUAGE');
  await assert.rejects(()=>service.start({...guard,assetId:'source',end:130}),e=>e.code==='TRANSCRIPT_RANGE');
  await assert.rejects(()=>service.start({expectedProjectId:'wrong',assetId:'source'}),e=>e.code==='PROJECT_MISMATCH');
  await assert.rejects(()=>service.setup.configure({runnerPath:'https://remote/runner',modelPath:'model'}),/absolute/);
  await assert.rejects(()=>service.setup.configure({runnerPath:'\\\\remote\\whisper-cli.exe',modelPath:'C:\\model'}),/Network/);
  const changed=structuredClone(s.db.project);changed.assets[0].hasAudio=false;changed.assets[0].kind='video';changed.assets[0].width=320;changed.assets[0].height=180;changed.sequences[0].tracks=[];await s.commit(changed,'No audio fixture');const noAudio=await fs.readFile(s.file);
  await assert.rejects(()=>service.start({...guard,assetId:'source'}),e=>e.code==='NO_AUDIO');assert.deepEqual(await fs.readFile(s.file),noAudio);assert.ok(before.length);
  await fs.writeFile(service.setup.file,'{}');assert.equal((await service.setup.readiness()).ready,false);
});

test('transcription shares owned queue cancellation/restart and retains frozen content identity',async()=>{
  const {s,renderer,guard}=await setup(),jobs=renderer.jobService,before=await fs.readFile(s.file);
  let began;const started=new Promise(r=>began=r),running=jobs.start('transcribe',{asset:s.db.project.assets[0]},async()=>{began();await run(process.execPath,['-e','setTimeout(()=>{},20000)']);},{preview:true});
  await started;await jobs.cancel(running.id);await jobs.tail;assert.equal((await jobs.status(running.id)).status,'canceled');assert.deepEqual(await fs.readFile(s.file),before);
  const pending=jobs.start('transcribe',{asset:s.db.project.assets[0]},async()=>{}, {preview:true});await jobs.tail;
  const record=JSON.parse(await fs.readFile(jobs.file(pending.id),'utf8'));record.job.status='rendering';record.job.ownerPid=2147483647;await fs.writeFile(jobs.file(pending.id),JSON.stringify(record));
  const restarted=new JobService(s);await restarted.ready;assert.equal((await restarted.status(pending.id)).status,'interrupted');
  await fs.appendFile(s.assetPath(s.db.project.assets[0]),'changed');const retry=await restarted.retry(pending.id,async()=>assert.fail('Changed source must reject before execution'));await restarted.tail;assert.equal((await restarted.status(retry.id)).status,'failed');assert.match((await restarted.status(retry.id)).error,/sources changed/);
});

test('adapter integration: real PCM trim, cache and source changes with explicitly simulated inference; low-memory guard rejects',async()=>{
  const {s,renderer,service,guard,dir}=await setup(),originalFree=os.freemem;
  const config={identity:{version:'test-double'},identities:[],threads:1,decoderVersion:'test-double'};
  service.setup.load=async()=>config;service.setup.validate=async c=>c;
  const before=await fs.readFile(s.file);
  try{
    await run(s.ffmpeg,['-hide_banner','-nostdin','-y','-f','lavfi','-i','sine=frequency=400:sample_rate=16000:duration=10','-c:a','pcm_s16le',s.assetPath(s.db.project.assets[0])]);
    os.freemem=()=>1024**3;
    const guarded=await service.start({...guard,assetId:'source',start:2,end:5});await renderer.jobService.tail;assert.equal((await renderer.jobService.status(guarded.id)).status,'failed');assert.match((await renderer.jobService.status(guarded.id)).error,/2.5 GiB/);
    os.freemem=()=>3*1024**3;
    service.infer=async(c,wav,output)=>{assert.equal(pcmDuration(await fs.readFile(wav)),3);await fs.writeFile(output+'.json',JSON.stringify({transcription:[{offsets:{from:0,to:4000},text:'Simulated boundary passage.'}]}));return {err:'Explicit test inference double; not speech recognition evidence.'};};
    const job=await service.start({...guard,assetId:'source',start:2,end:5});await renderer.jobService.tail;const done=await renderer.jobService.status(job.id);assert.equal(done.status,'complete',done.error);
    const read=await service.read({...guard,transcriptId:done.transcriptId});assert.equal(read.segments[0].start,2);assert.equal(read.segments[0].end,5);assert.equal(read.segments[0].clipped,true);
    const duplicate=await service.start({...guard,assetId:'source',start:2,end:5});await renderer.jobService.tail;assert.equal((await renderer.jobService.status(duplicate.id)).cacheHit,true);
    await service.correct({...guard,transcriptId:done.transcriptId,segmentId:'segment_0',expectedAnalysisRevision:0,text:'Reviewed simulated words.'});
    const reopened=new SpeechService(s,renderer);assert.equal((await reopened.read({...guard,transcriptId:done.transcriptId})).segments[0].text,'Reviewed simulated words.');
    await fs.writeFile(path.join(dir,'exports',job.id,'unused.txt'),'Cache-only raw output');await renderer.jobService.purge(job.id);assert.equal((await reopened.read({...guard,transcriptId:done.transcriptId})).analysisRevision,1);
    const origin=JSON.parse(await fs.readFile(renderer.jobService.file(job.id),'utf8'));origin.job.status='canceled';await fs.writeFile(renderer.jobService.file(job.id),JSON.stringify(origin));await assert.rejects(()=>reopened.read({...guard,transcriptId:done.transcriptId}),e=>e.code==='TRANSCRIPT_INCOMPLETE');assert.equal((await reopened.list(guard)).transcripts.length,0);
    assert.deepEqual(await fs.readFile(s.file),before);
  }finally{os.freemem=originalFree;}
});

test('real local English ASR: physical trim, pinned components, durable cache, silent audio and no application network calls', {timeout:180000,skip:!process.env.AGENT_CUT_SPEECH_FIXTURE?'Set explicit installed runner/model and synthetic speech fixture paths':os.freemem()<2.5*1024**3?'Real ASR pending: less than 2.5 GiB free system RAM':false},async t=>{
  const {s,renderer,service,guard,dir}=await setup(),before=await fs.readFile(s.file),originalFetch=globalThis.fetch;
  globalThis.fetch=()=>{throw Error('Unexpected outbound request');};
  try{
    await fs.copyFile(process.env.AGENT_CUT_SPEECH_FIXTURE,s.assetPath(s.db.project.assets[0]));
    const configured=await service.setup.configure({runnerPath:process.env.AGENT_CUT_SPEECH_RUNNER,modelPath:process.env.AGENT_CUT_SPEECH_MODEL,threads:4});assert.equal(configured.ready,true);if(!configured.canTranscribe){t.skip('Real ASR pending: less than 2.5 GiB free system RAM after setup');return;}
    const started=Date.now(),job=await service.start({...guard,assetId:'source',start:0,end:10,language:'en'});await renderer.jobService.tail;const done=await renderer.jobService.status(job.id);assert.equal(done.status,'complete',done.error);
    const transcript=await service.read({...guard,transcriptId:done.transcriptId});assert.match(transcript.segments.map(s=>s.text).join(' '),/three simple editing steps/i);assert.ok(transcript.segments.every(s=>s.end<=10));assert.equal(transcript.language,'en');
    const wav=await fs.readFile(path.join(dir,'exports',job.id,'normalized.wav'));assert.ok(pcmDuration(wav)<=10);assert.equal(pcmSilent(wav),false);
    const repeated=await service.start({...guard,assetId:'source',start:0,end:10});await renderer.jobService.tail;assert.equal((await renderer.jobService.status(repeated.id)).cacheHit,true);
    const reopened=new SpeechService(s,new Renderer(s));await reopened.renderer.ready;assert.equal((await reopened.read({...guard,transcriptId:done.transcriptId})).segments.length,transcript.segments.length);
    // A removed model is a visible readiness failure, with manual fallback still usable.
    const config=await service.setup.load(),missing=structuredClone(config);missing.model=path.join(dir,'absent.bin');await fs.writeFile(service.setup.file,JSON.stringify(missing));assert.equal((await service.setup.readiness()).ready,false);await fs.writeFile(service.setup.file,JSON.stringify(config));
    await run(s.ffmpeg,['-hide_banner','-nostdin','-y','-f','lavfi','-i','anullsrc=r=16000:cl=mono','-t','10','-c:a','pcm_s16le',s.assetPath(s.db.project.assets[0])]);
    const silent=await service.start({...guard,assetId:'source',start:2,end:3});await renderer.jobService.tail;const quietJob=await renderer.jobService.status(silent.id);assert.equal(quietJob.status,'complete',quietJob.error);const quiet=await service.read({...guard,transcriptId:quietJob.transcriptId});assert.equal(quiet.segmentCount,0);assert.ok(quiet.warnings.some(w=>w.includes('zero')));
    await assert.rejects(()=>service.read({...guard,transcriptId:done.transcriptId}),e=>e.code==='SOURCE_CHANGED');
    assert.deepEqual(await fs.readFile(s.file),before);
    await fs.writeFile(path.join(dir,'speech-proof.json'),JSON.stringify({elapsedIncludingSetupAndCacheMs:Date.now()-started,job:done,segmentCount:transcript.segmentCount,sourceSha256:await fileDigest(process.env.AGENT_CUT_SPEECH_FIXTURE),silentSegmentCount:quiet.segmentCount,projectUnchanged:true,network:'Node fetch replaced by rejecting stub; adapter contains no outbound code. Not an OS socket audit.'},null,2));
  }finally{globalThis.fetch=originalFetch;}
});
