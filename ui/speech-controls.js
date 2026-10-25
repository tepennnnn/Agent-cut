import {transcriptRecipeButtons} from '/recipe-controls.js';
// Transcript contents are requested only after a user opens a selected sidecar.
export function mountSpeechControls({host,el,call,run,dialog,getProject,onProject,status}){
  const details=el('details'),summary=el('summary','','Offline speech & transcripts'),actions=el('div','buttons'),message=el('p','muted','Optional English model. Explicit setup uses installed files; nothing is downloaded.'),index=el('div'),content=el('div','transcript-content');
  details.append(summary,message,actions,index,content);host.append(details);
  let current=null,query='';
  const guard=()=>({expectedProjectId:getProject().projectId});
  const button=(parent,label,fn)=>{const b=el('button','',label);b.onclick=()=>run(fn);parent.append(b);return b;};
  const sourceDialog=(title,extra,fn)=>{
    const assets=getProject().assets.filter(a=>a.kind!=='sequence');
    if(!assets.length)throw Error('Import a local source first.');
    dialog(title,[['assetId','Transcript source',assets[0].id,undefined,undefined,undefined,assets.map(a=>({label:a.name,value:a.id}))],...extra],fn);
  };
  const list=async()=>{
    const result=await call('transcript',{...guard(),action:'list',pageSize:100});index.replaceChildren();
    for(const record of result.transcripts)button(index,`Open transcript · ${record.assetId.slice(0,12)} · ${record.segmentCount} segments`,()=>open(record.transcriptId));
    if(!result.transcripts.length)index.append(el('p','','No completed transcripts. Start a job or import timed text.'));
    if(!result.coverage.exhausted)index.append(el('p','','More transcripts exist; use MCP pagination to read the rest.'));
  };
  const open=async(id,cursor)=>{
    const result=await call('transcript',{...guard(),action:'read',transcriptId:id,query,pageSize:20,...(cursor?{cursor}:{})});current=result;
    content.replaceChildren(el('p','',`${result.kind} · source ${result.sourceRange.start.toFixed(2)}–${result.sourceRange.end.toFixed(2)} s · revision ${result.analysisRevision}${result.partial?' · partial source coverage':''}`));
    for(const warning of result.warnings)content.append(el('p','text-warning',warning));
    button(content,'Search transcript',()=>dialog('Search transcript',[['query','Literal transcript search',query,undefined,undefined,undefined,undefined,false]],async v=>{query=v.query;await open(id);}));
    for(const segment of result.segments){
      const row=el('div','transcript-row');row.append(el('strong','',`${segment.start.toFixed(2)}–${segment.end.toFixed(2)} s · ${segment.id}`),el('p','',segment.text));
      if(segment.text!==segment.rawText)row.append(el('small','',`Original: ${segment.rawText}`));
      button(row,'Correct '+segment.id,()=>dialog('Correct transcript segment',[['text','Corrected transcript text',segment.text]],async v=>{await call('transcript',{...guard(),action:'correct',transcriptId:id,expectedAnalysisRevision:result.analysisRevision,segmentId:segment.id,text:v.text});await open(id);status('Transcript corrected; timeline unchanged.');}));content.append(row);
    }
    if(result.coverage.nextCursor)button(content,'Next transcript page',()=>open(id,result.coverage.nextCursor));
    button(content,'First transcript page',()=>open(id));
    transcriptRecipeButtons({host:content,el,call,run,dialog,getProject,onProject,status},result);
    button(content,'Draft captions for a clip',()=>{
      const p=getProject();if(p.schemaVersion!==2)throw Error('Review the track upgrade before generating timeline captions.');
      const sequence=p.sequences.find(s=>s.id===p.activeSequenceId),items=sequence.tracks.flatMap(t=>t.items.filter(i=>i.assetId===result.assetId).map(i=>({label:`${t.name} · ${i.id.slice(0,12)}`,value:i.id})));
      if(!items.length)throw Error('Place this transcript source in the active timeline first.');
      dialog('Draft source-mapped captions',[['itemId','Target timeline clip',items[0].value,undefined,undefined,undefined,items]],async values=>{
        const p=getProject(),candidate=await call('transcript',{...guard(),action:'captions',transcriptId:id,expectedRevision:p.revision,expectedAnalysisRevision:result.analysisRevision,sequenceId:p.activeSequenceId,itemIds:[values.itemId]});
        showCandidate(candidate);
      });
    });
  };
  function showCandidate(candidate){
    const review=el('div','caption-candidate');content.replaceChildren(review);
    review.append(el('h3','','Caption candidate · not applied'),el('p','',`${candidate.operations.length} cues. Existing captions are retained. Review text/timing before applying.`));
    for(const warning of candidate.warnings)review.append(el('p','text-warning',warning));
    for(const cue of candidate.operations)review.append(el('p','',`${cue.start.toFixed(2)}–${cue.end.toFixed(2)} s · ${cue.text}`));
    const images=el('div');review.append(images);
    button(review,'Preview caption candidate',async()=>{
      const time=(candidate.operations[0].start+candidate.operations[0].end)/2,p=getProject();
      const preview=await call('timeline_plan_preview',{...guard(),expectedRevision:candidate.plan.expectedRevision,planId:candidate.plan.planId,sequenceId:p.activeSequenceId,time,includeBefore:false});
      images.replaceChildren();for(const frame of preview.images){const img=el('img');img.alt=frame.label;img.src='data:image/png;base64,'+frame.data;images.append(img);}
      status(preview.stale?'Candidate is stale; create a new draft.':'Composed candidate preview; timeline unchanged.');
    });
    button(review,'Apply caption candidate',async()=>{
      if(!window.confirm('Apply this reviewed caption candidate? Undo restores the timeline.'))return;
      const project=await call('timeline_plan_apply',{...guard(),expectedRevision:getProject().revision,planId:candidate.plan.planId});await onProject(project);status('Transcript captions applied. Undo restores the previous timeline.');
    });
    button(review,'Discard caption candidate',()=>open(current.transcriptId));
  }
  button(actions,'Check speech setup',async()=>{const result=await call('speech_setup',{...guard(),action:'status'});message.textContent=result.ready?`Configured · whisper.cpp ${result.candidate.version} · English · ${result.threads} CPU threads · segment timing${result.canTranscribe?'':' · low RAM: inference requires 2.5 GiB free; timed text import remains available'}`:`${result.code}: ${result.message||result.fallback}`;});
  button(actions,'Configure local speech',()=>dialog('Use an existing offline speech installation',[['runnerPath','Installed whisper-cli.exe path',''],['modelPath','Installed medium.en model path',''],['threads','CPU threads',4,1,4,1]],async values=>{const result=await call('speech_setup',{...guard(),action:'configure',...values});message.textContent=result.ready?'Local speech configured. English, segment timestamps; no downloads.':result.message;}));
  button(actions,'Transcribe source range',()=>sourceDialog('Transcribe English locally',[['start','Source start (seconds)',0,0,7200,.01],['end','Source end (maximum 120 seconds)',10,.01,7200,.01]],async values=>{const job=await call('transcript',{...guard(),action:'start',expectedRevision:getProject().revision,language:'en',...values});message.textContent=`Queued local speech job ${job.id}. Monitor/cancel in Local jobs & cache, then refresh transcripts.`;}));
  button(actions,'Import source transcript',()=>sourceDialog('Import source-timed SRT/VTT',[['format','Timed text format','srt',undefined,undefined,undefined,['srt','vtt']],['language','Transcript language metadata','unspecified'],['text','Literal source-timed subtitle text','']],async values=>{const result=await call('transcript',{...guard(),action:'import',expectedRevision:getProject().revision,...values});query='';await list();await open(result.transcriptId);status('Transcript imported; timeline unchanged.');}));
  button(actions,'Refresh transcripts',list);
}
