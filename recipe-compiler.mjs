import {apply,canonical,EditError,timeline} from './engine.mjs';
import {timeSeconds as seconds} from './sequences.mjs';
import {playbackAtSource} from './time-remap.mjs';
import {transcriptDigest,mapTranscriptCaptions} from './transcript-model.mjs';
import {textPresets} from './ui/text-model.js';
const fail=(code,message)=>{throw new EditError(code,message);};
const end=i=>seconds(i.start)+seconds(i.duration);
export function recipeItem(project,sequenceId,itemId){
 const sequence=project.sequences.find(s=>s.id===(sequenceId||project.activeSequenceId)),track=sequence?.tracks.find(t=>t.items.some(i=>i.id===itemId)),item=track?.items.find(i=>i.id===itemId),asset=project.assets.find(a=>a.id===item?.assetId);
 if(!item||!asset)fail('RECIPE_ITEM','Unknown selected timeline item.');
 if(track.locked)fail('TRACK_LOCKED','Selected source track is locked.');
 if(asset.kind==='sequence'||item.reverse||item.frameHold)fail('RECIPE_UNSUPPORTED','Select an ordinary forward original source; reverse, held and nested sources require manual edits.');
 return {sequence,track,item,asset};
}
export function sourceToTimeline(item,time){return seconds(item.start)+(item.speedCurve?playbackAtSource(item.speedCurve,time-item.sourceIn):(time-item.sourceIn)/item.speed);}
export function compileRecipe(project,kind,request,{documents=new Map(),pauseEvidence,fontPins={}}={}){
 if(project.schemaVersion!==2)fail('V2_REQUIRED','Review and explicitly activate the v2 track upgrade before using recipes.');
 const operations=[],evidence=[],warnings=[],seed=transcriptDigest({project,kind,request,documents:[...documents].map(([id,d])=>({id,revision:d.revision,sourceSha256:d.provenance.sourceSha256})),pauseEvidence:pauseEvidence?.id,fontPins}),newId=role=>transcriptDigest({seed,role});
 let q=structuredClone(project);
 const add=op=>{if(operations.length>=200)fail('RECIPE_LIMIT','Recipe exceeds 200 operations; select fewer excerpts.');operations.push(op);let n=0;q=apply(project,operations,{allocateId:()=>newId('simulation-'+n++)});};
 const duration=p=>Math.max(0,...timeline(p).map(i=>i.end));
 const docFor=(selection,asset)=>{const doc=documents.get(selection.transcriptId);if(!doc||doc.assetId!==asset.id||doc.revision!==selection.expectedAnalysisRevision)fail('RECIPE_TRANSCRIPT','Read the selected source transcript and its current analysis revision.');return doc;};
 let sequenceId=request.sequenceId||project.activeSequenceId;
 if(kind==='opening'||kind==='pause_cut'){
  const {sequence,item,asset}=recipeItem(project,sequenceId,request.itemId);sequenceId=sequence.id;
  const fps=sequence.timebase.numerator/sequence.timebase.denominator,cuts=[];
  if(kind==='opening'){
   const doc=docFor(request,asset),segment=doc.segments.find(s=>s.id===request.segmentId);
   if(!segment||segment.start<item.sourceIn||segment.start>=item.sourceOut||seconds(item.start)!==0)fail('RECIPE_OPENING','Select an in-range transcript segment on an item starting at timeline zero.');
   const time=Math.floor((sourceToTimeline(item,segment.start)+1e-9)*fps)/fps;
   if(time<1/fps)fail('RECIPE_NO_CHANGE','Selected opening already begins at the start.');cuts.push({start:0,end:time});
   evidence.push({kind:'transcript',transcriptId:doc.id,analysisRevision:doc.revision,segmentId:segment.id,text:segment.text,sourceStart:segment.start,sourceEnd:segment.end,sourceSha256:doc.provenance.sourceSha256});warnings.push('Opening is the explicitly selected passage; no automatic strongest-moment ranking. Cut rounds down to preserve the first syllable.');
  }else{
   if(!pauseEvidence||pauseEvidence.assetId!==asset.id||new Set(request.pauseIds).size!==request.pauseIds.length||!Number.isFinite(request.paddingSeconds)||request.paddingSeconds<0||request.paddingSeconds>2)fail('RECIPE_PAUSE','Select measured pause IDs and 0–2 source seconds of padding.');
   for(const id of request.pauseIds){const interval=pauseEvidence.intervals.find(p=>p.id===id);if(!interval)fail('RECIPE_PAUSE','Unknown measured pause ID.');const start=Math.max(item.sourceIn,interval.start+request.paddingSeconds),finish=Math.min(item.sourceOut,interval.end-request.paddingSeconds);if(finish<=start)fail('RECIPE_PAUSE','Pause is outside the retained clip or too short after padding.');const a=Math.ceil((sourceToTimeline(item,start)-1e-9)*fps)/fps,b=Math.floor((sourceToTimeline(item,finish)+1e-9)*fps)/fps;if(b-a<1/fps-1e-8)fail('RECIPE_PAUSE','Padding/frame rounding leaves no removable frame.');cuts.push({start:a,end:b});evidence.push({kind:'low-audio-level',evidenceId:pauseEvidence.id,pauseId:id,sourceStart:start,sourceEnd:finish,sourceSha256:pauseEvidence.sourceSha256,noiseDb:pauseEvidence.noiseDb});}
   warnings.push('Low audio level is not proof of a speech pause or filler word. Only explicitly selected measured intervals are cut; padding uses source seconds.');
  }
  cuts.sort((a,b)=>b.start-a.start);if(cuts.some((c,i)=>i&&c.end>cuts[i-1].start+1e-8))fail('RECIPE_PAUSE','Selected cuts overlap.');
  for(const cut of cuts)add({type:'sequence_remove_range',sequenceId,...cut,ripple:true,trackIds:sequence.tracks.map(t=>t.id),captionPolicy:request.captionPolicy,graphicPolicy:request.graphicPolicy});
  return {operations,evidence,warnings,sequenceId,removedRanges:cuts,durationBefore:duration(project),durationAfter:duration(q),captionPolicy:request.captionPolicy,graphicPolicy:request.graphicPolicy,explanation:`Remove ${cuts.length} selected range(s), totaling ${cuts.reduce((n,c)=>n+c.end-c.start,0).toFixed(3)} seconds. All tracks and linked media ripple together; captions ${request.captionPolicy}, titles ${request.graphicPolicy}.`};
 }
 const clips=[];
 if(kind==='montage'){
  for(const selection of request.clips){const asset=project.assets.find(a=>a.id===selection.assetId);if(!asset||asset.kind==='audio'||asset.kind==='sequence')fail('RECIPE_SOURCE','Montage clips must be original video assets.');clips.push({asset,start:selection.start,end:selection.end,speed:1});evidence.push({kind:'explicit-source-selection',assetId:asset.id,sourceStart:selection.start,sourceEnd:selection.end});}
 }else{
  for(const selection of request.selections){
   const {sequence,track,item,asset}=recipeItem(project,undefined,selection.itemId),doc=docFor(selection,asset);
   if(track.kind!=='video'||track.muted||track.solo||sequence.tracks.some(t=>t.solo||t.role==='adjustment'&&!t.muted&&t.adjustments?.length)||item.speedCurve||Object.keys(item.effects||{}).length||item.keyframes||item.audio||item.mask||item.blendMode&&item.blendMode!=='normal'||track.audio||sequence.tracks.some(t=>t.ducking))fail('RECIPE_UNSUPPORTED','Excerpt assembly supports forward constant-speed video without effects/automation/processors. Use manual editing to preserve advanced processing.');
   const companions=sequence.tracks.flatMap(t=>t.items.filter(i=>i.linkGroupId&&i.linkGroupId===item.linkGroupId&&i.id!==item.id).map(i=>({item:i,track:t})));
   if(companions.some(({item:a,track:t})=>t.locked||t.muted||t.solo||t.audio||a.audio||a.keyframes||Object.keys(a.effects||{}).length||a.sourceIn!==item.sourceIn||a.sourceOut!==item.sourceOut||a.speed!==item.speed||seconds(a.start)!==seconds(item.start)||a.volume!==item.volume))fail('RECIPE_UNSUPPORTED','Independently processed/trimmed linked audio requires manual editing.');
   const indices=selection.segmentIds.map(id=>doc.segments.findIndex(s=>s.id===id));if(indices.some(i=>i<0)||indices.some((v,i)=>i&&v!==indices[i-1]+1))fail('RECIPE_TRANSCRIPT','Each excerpt selects contiguous, ordered, distinct transcript segment IDs.');
   const segments=indices.map(i=>doc.segments[i]),start=segments[0].start,finish=segments.at(-1).end;
   if(start<item.sourceIn||finish>item.sourceOut)fail('RECIPE_TRANSCRIPT','Whole selected passages must fit the retained source range. Review clipped words manually.');
   clips.push({asset,start,end:finish,speed:item.speed,volume:item.volume,doc,segmentIds:selection.segmentIds});
   for(const segment of segments)evidence.push({kind:'transcript',transcriptId:doc.id,analysisRevision:doc.revision,segmentId:segment.id,text:segment.text,sourceStart:segment.start,sourceEnd:segment.end,itemId:item.id,sourceSha256:doc.provenance.sourceSha256,clipped:!!segment.clipped});
  }
 }
 for(const clip of clips)if(!Number.isFinite(clip.start)||!Number.isFinite(clip.end)||clip.start<0||clip.end>clip.asset.duration||clip.end-clip.start<.1)fail('RECIPE_SOURCE','Choose in-source ranges of at least 0.1 seconds.');
 const template=project.sequences.find(s=>s.id===project.activeSequenceId),fps=template.timebase.numerator/template.timebase.denominator,transition=Math.round((request.transitionSeconds??0)*fps)/fps;
 if(!Number.isFinite(transition)||transition<0||transition>2||clips.some(c=>transition>0&&transition>=(c.end-c.start)/c.speed-.01))fail('RECIPE_TRANSITION','Dissolves must be 0–2 seconds and leave non-overlapping media on each clip.');
 const expectedDuration=clips.reduce((n,c)=>n+(c.end-c.start)/c.speed,0)-Math.max(0,clips.length-1)*transition;
 if(expectedDuration<=0||expectedDuration>120)fail('RECIPE_LIMIT','Recipe assemblies support at most 120 seconds. Select shorter ranges.');
 sequenceId=newId('sequence');const videoTrack=newId('video-track'),audioTrack=newId('audio-track');
 add({type:'sequence_create',name:request.name,newId:sequenceId});add({type:'sequence_select',sequenceId});
 if(request.aspect&&request.aspect!=='current'){const [width,height]={landscape:[1280,720],portrait:[720,1280],square:[1080,1080]}[request.aspect];add({type:'sequence_settings',sequenceId,width,height});}
 add({type:'track_add',sequenceId,kind:'video',name:'Selected video',newId:videoTrack});add({type:'track_add',sequenceId,kind:'audio',name:'Linked dialogue',newId:audioTrack});
 let cursor=0;
 for(const [index,c]of clips.entries()){c.itemId=newId('clip-'+index);add({type:'item_add',sequenceId,trackId:videoTrack,newId:c.itemId,assetId:c.asset.id,time:cursor,sourceIn:c.start,sourceOut:c.end,speed:c.speed,volume:c.volume??1,mode:'place',...(c.asset.hasAudio?{includeAudio:true,audioTrackId:audioTrack}:{includeAudio:false})});cursor+=(c.end-c.start)/c.speed;}
 if(transition)for(const c of clips.slice(0,-1))add({type:'sequence_transition',sequenceId,itemId:c.itemId,seconds:transition,kind:'cross_dissolve'});
 const assembled=q.sequences.find(s=>s.id===sequenceId),actualDuration=duration(q);
 if(request.captionPolicy==='draft'){
  const cues=[];
  for(const [index,c]of clips.entries()){
   if(!c.doc)fail('RECIPE_TRANSCRIPT','Draft captions require transcript-backed excerpts.');
   const item=assembled.tracks.find(t=>t.id===videoTrack).items.find(i=>i.id===c.itemId),mapped=mapTranscriptCaptions(q,c.doc,{sequenceId,itemIds:[c.itemId],segmentIds:c.segmentIds});
   const lo=seconds(item.start)+(index?transition/2:0),hi=end(item)-(index<clips.length-1?transition/2:0);
   for(const cue of mapped.operations){const start=Math.max(lo,cue.start),finish=Math.min(hi,cue.end);if(finish-start<.01)fail('RECIPE_CAPTIONS','Transition leaves no visible cue; reduce overlap or select longer passages.');cues.push({...cue,start,end:finish});}
  }
  add({type:'sequence_caption_style',sequenceId,values:{...textPresets.clean,...(fontPins[textPresets.clean.font]?{fontSha256:fontPins[textPresets.clean.font]}:{})},replace:true});for(const cue of cues)add(cue);
  if(transition)warnings.push('Caption intervals meet at dissolve midpoints. Whole segment text is retained; review coarse timing at joins.');
 }
 if(request.title){const span=request.title.seconds??Math.min(3,actualDuration);if(!Number.isFinite(span)||span<=0||span>actualDuration)fail('RECIPE_TITLE','Title duration must fit the assembled sequence.');add({type:'graphic_text',sequenceId,text:request.title.text,start:0,end:span,style:{...textPresets.headline,...(fontPins[textPresets.headline.font]?{fontSha256:fontPins[textPresets.headline.font]}:{})}});}
 if(request.music){const m=request.music,asset=project.assets.find(a=>a.id===m.assetId);if(!asset||asset.kind==='sequence'||!asset.hasAudio||!Number.isFinite(m.sourceIn)||m.sourceIn<0||m.sourceIn+actualDuration>asset.duration||!Number.isFinite(m.volume)||m.volume<0||m.volume>1||!Number.isFinite(m.fadeSeconds)||m.fadeSeconds<0||m.fadeSeconds>Math.min(10,actualDuration/2))fail('RECIPE_MUSIC','Choose enough local audio for the whole assembly, gain 0–1, and fades up to half its duration. Music is never looped or stretched.');
  if(m.duck&&!clips.some(c=>c.asset.hasAudio))fail('RECIPE_MUSIC','Ducking requires linked source audio to drive it.');
  const trackId=newId('music-track'),itemId=newId('music');add({type:'track_add',sequenceId,kind:'audio',name:'Selected music',newId:trackId});add({type:'item_add',sequenceId,trackId,newId:itemId,assetId:m.assetId,time:0,sourceIn:m.sourceIn,sourceOut:m.sourceIn+actualDuration,volume:m.volume,mode:'place'});add({type:'item_effects',sequenceId,itemId,values:{audioFadeIn:m.fadeSeconds,audioFadeOut:m.fadeSeconds}});if(m.duck)add({type:'track_ducking',sequenceId,trackId,sidechainTrackId:audioTrack,thresholdDb:-30,ratio:4,attackMs:20,releaseMs:250});
  evidence.push({kind:'selected-music',assetId:m.assetId,sourceStart:m.sourceIn,sourceEnd:m.sourceIn+actualDuration,volume:m.volume,fadeSeconds:m.fadeSeconds,duck:m.duck});
 }
 const target=request.targetSeconds??30;if(!Number.isFinite(target)||target<1||target>120)fail('RECIPE_TARGET','Target length must be 1–120 seconds.');if(kind==='highlight'&&Math.abs(actualDuration-target)>.5)warnings.push(`Selected material produces ${actualDuration.toFixed(3)} seconds against a ${target}-second target. Nothing was stretched, repeated or silently dropped.`);
 warnings.push('New sequence uses original source framing with fit; no subject-aware reframing or semantic ranking.');
 return {operations,sequenceId,evidence,warnings,durationBefore:duration(project),durationAfter:actualDuration,captionPolicy:request.captionPolicy,transitionSeconds:transition,targetSeconds:kind==='highlight'?target:null,explanation:`Assemble ${clips.length} explicit source range(s) in a new sequence: ${actualDuration.toFixed(3)} seconds after ${Math.max(0,clips.length-1)} join(s) at ${transition.toFixed(3)} seconds. Captions ${request.captionPolicy}; title ${request.title?'included':'omitted'}; music ${request.music?'included with selected gain/fades/ducking':'omitted'}. Existing sequences remain unchanged.`};
}
