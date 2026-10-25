import {fileDigest} from './speech-setup.mjs';
import {boundWordAlignment} from './ui/word-timing.js';
import {isPairTransition,transitionCatalog} from './ui/transition-model.js';
import {createGLSession} from './gl-renderer.mjs';
import {prepareGLPair} from './pair-transition-renderer.mjs';
import {wgfxEvidence} from './wgfx-renderer.mjs';
import {textFilter} from './text-renderer.mjs';
import {hasStyledText} from './ui/text-model.js';
import {sourceSlice} from './reverse.mjs';
import {prepareRemappedAudio} from './time-remap-audio.mjs';
import {transitionFilters} from './transitions.mjs';
import {audioProcessingFilter} from './audio-processing.mjs';
import {prepareReverseVideo} from './reverse.mjs';
import {adjustmentFilter} from './adjustments.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {validateV2,timeSeconds} from './sequences.mjs';
import {videoFilter,audioFilter,captionFilter,run,atomic,EditError} from './engine.mjs';

// Native v2 composition. Each video/audio item is independent; track array order
// is bottom-to-top. Legacy-representable projects retain the old render path.
export async function renderSequence(store,project,job,context={cache:new Map(),contributions:0,rootJobId:job.id}){
 context.glOwner??=job.id;try{
 validateV2(project);context.textFonts??=new Map();context.textWarnings??=new Set();const sequence=project.sequences.find(s=>s.id===project.activeSequenceId);
 const hasPairs=sequence.transitions.some(t=>isPairTransition(t.type));
 const all=sequence.tracks.flatMap(t=>t.items),fullTotal=Math.max(0,...all.map(i=>timeSeconds(i.start)+timeSeconds(i.duration))),draft=job.draftRange,offset=draft?Math.max(0,draft.start-(sequence.tracks.some(t=>t.audioMix||t.ducking||t.items.some(i=>i.audio))?10:hasPairs?2.1:sequence.transitions.some(t=>t.type.startsWith('wgfx_'))?.15:0)):0,stop=draft?Math.min(fullTotal,draft.end+(hasPairs?2.1:0)):fullTotal,total=stop-offset;
 if(total<=0)throw new EditError('EMPTY_SEQUENCE','Add media before rendering a sequence.');
 const active=sequence.tracks.filter(t=>!t.muted&&(!sequence.tracks.some(s=>s.kind===t.kind&&s.solo&&!s.muted)||t.solo));
 let entries=active.flatMap(track=>[...[...track.items].sort((a,b)=>timeSeconds(a.start)-timeSeconds(b.start)).map(item=>({track,item})),...(track.adjustments||[]).map(adjustment=>({track,adjustment}))]);
 if(draft)entries=entries.filter(e=>e.adjustment?timeSeconds(e.adjustment.start)<stop&&timeSeconds(e.adjustment.end)>offset:timeSeconds(e.item.start)<stop&&timeSeconds(e.item.start)+timeSeconds(e.item.duration)>offset);
 if(entries.length>64)throw new EditError('RENDER_LIMIT','Native v2 composition supports at most 64 active media items/adjustment spans per render.');
 context.contributions+=entries.length;if(context.contributions>256)throw new EditError('RENDER_LIMIT','Nested composition supports at most 256 active contributions across unique sequences.');
 const work=path.join(store.root,'exports',job.id);await fs.mkdir(work,{recursive:true});
 const canvas={...sequence.canvas,fps:draft?.fps||sequence.timebase.numerator/sequence.timebase.denominator};if(draft?.longEdge){const scale=Math.min(1,draft.longEdge/Math.max(canvas.width,canvas.height));canvas.width=Math.max(160,Math.round(canvas.width*scale/2)*2);canvas.height=Math.max(160,Math.round(canvas.height*scale/2)*2);}
 const p={canvas,referenceCanvas:sequence.canvas,renderDuration:total,captionStyle:sequence.captionStyle,graphics:(sequence.graphics||[]).map(g=>({...g,start:timeSeconds(g.start)-offset,end:timeSeconds(g.end)-offset})),captions:(sequence.captionMotion?[]:sequence.captions).map(c=>({...c,start:timeSeconds(c.start)-offset,end:timeSeconds(c.end)-offset}))};
 const args=['-hide_banner','-nostdin','-loglevel','info','-y','-f','lavfi','-i',`color=c=black:s=${canvas.width}x${canvas.height}:r=${canvas.fps}:d=${total}`,'-f','lavfi','-i',`anullsrc=r=48000:cl=stereo:d=${total}`];
 const pairSources=new Map(),pairMetadata=new Map(),pairEvidence=[],pairTemporary=[];
 const pairNeeded=x=>{if(!x||!isPairTransition(x.type))return false;const right=all.find(i=>i.id===x.rightItemId),begin=timeSeconds(right.start);return !draft||begin<draft.end&&begin+timeSeconds(x.duration)>draft.start;};
 const filters=[],audio=['1:a'],trackAudio=new Map();let video='0:v',inputIndex=2;
 for(let i=0;i<entries.length;i++){
   if(entries[i].adjustment){const a=entries[i].adjustment;filters.push(`[${video}]${adjustmentFilter(a,timeSeconds(a.start)-offset,timeSeconds(a.end)-offset)}[adjusted${i}]`);video='adjusted'+i;continue;}
   const {track,item:original}=entries[i],input=inputIndex++,length=timeSeconds(original.duration),from=draft?Math.max(0,offset-timeSeconds(original.start)):0,to=draft?Math.min(length,stop-timeSeconds(original.start)):length,start=Math.max(0,timeSeconds(original.start)-offset),visibleLength=to-from,item=draft?{...original,...sourceSlice(original,from,to)}:original,asset=project.assets.find(a=>a.id===item.assetId);if(draft&&asset.kind==='sequence')throw new EditError('UNSUPPORTED_DRAFT','Bounded preview of nested sources is not available; use full composed playback.');
   let nestedPath;if(asset.kind==='sequence'){if(!context.cache.has(asset.sequenceId)){const child=structuredClone(project);child.activeSequenceId=asset.sequenceId;child.sequences.find(s=>s.id===asset.sequenceId).exportRange=null;const nestedJob={id:context.rootJobId+'/nested-'+createHash('sha256').update(asset.sequenceId).digest('hex').slice(0,16),revision:job.revision,status:'rendering'};context.cache.set(asset.sequenceId,renderSequence(store,child,nestedJob,context).then(result=>result.path));}nestedPath=await context.cache.get(asset.sequenceId);}
   const inputStore=nestedPath?{ffmpeg:store.ffmpeg,assetPath:()=>nestedPath}:store;
   const reversed=track.kind==='video'&&item.reverse?await prepareReverseVideo(inputStore,item,asset,sequence.timebase,work,String(i),fraction=>{job.progress=Math.floor((i+fraction)/entries.length*30);}):null;
   const remappedAudio=track.kind==='audio'&&item.speedCurve?await prepareRemappedAudio(inputStore,item,asset,work,String(i)):null;
   if(remappedAudio)args.push('-f','f32le','-ar','48000','-ac','2','-i',remappedAudio);else args.push('-protocol_whitelist','file,pipe','-ss',String(reversed?0:item.frameHold?.sourceTime??item.sourceIn),'-t',String(item.frameHold?Math.min(1,asset.duration-item.frameHold.sourceTime):item.sourceOut-item.sourceIn),'-i',reversed||nestedPath||store.assetPath(asset));
   const incoming=sequence.transitions.find(x=>x.rightItemId===(item.videoItemId||item.id)),outgoing=sequence.transitions.find(x=>x.leftItemId===(item.videoItemId||item.id));
   const fadeIn=incoming?timeSeconds(incoming.duration):0,fadeOut=outgoing?timeSeconds(outgoing.duration):0;
   if(track.kind==='video'){
     pairMetadata.set(original.id,{item:original,asset,path:nestedPath||store.assetPath(asset)});
     const dissolve=transitionFilters(incoming,outgoing,length,timeSeconds,{...canvas,clockOffset:Math.round(from*canvas.fps)/canvas.fps});
     filters.push(`[${input}:v]${await videoFilter(p,item,work,'v2'+i,true,{offset:from,originalDuration:length,renderDuration:visibleLength})}${item.speedCurve?`,tpad=stop_mode=clone:stop_duration=${visibleLength}`:''}${dissolve},trim=start=${from}:end=${to},setpts=PTS-STARTPTS+${start}/TB[item${i}]`);
     const nativeIn=pairNeeded(incoming)&&incoming.type.startsWith('native_'),nativeOut=pairNeeded(outgoing)&&outgoing.type.startsWith('native_');
     let normal='item'+i;const branches=[normal+'normal',...(nativeOut?[normal+'pairLeft']:[]),...(nativeIn?[normal+'pairRight']:[])];
     if(branches.length>1){filters.push(`[${normal}]split=${branches.length}`+branches.map(x=>`[${x}]`).join(''));normal=branches[0];if(nativeOut)pairSources.set(outgoing.id,normal.replace('normal','pairLeft'));}
     const ordinaryStart=Math.max(0,timeSeconds(original.start)-offset+(isPairTransition(incoming?.type)?fadeIn:0)),ordinaryEnd=timeSeconds(original.start)+length-offset-(isPairTransition(outgoing?.type)?fadeOut:0);
     if(item.blendMode&&item.blendMode!=='normal'){
       const expressions={multiply:'A*B/255',screen:'255-(255-A)*(255-B)/255',darken:'min(A,B)',lighten:'max(A,B)',difference:'abs(A-B)',addition:'min(255,A+B)'};
       // Full-length transparent foreground avoids losing leading/trailing gaps in framesync.
       filters.push(`color=c=black:s=${canvas.width}x${canvas.height}:r=${canvas.fps}:d=${total},format=rgba,colorchannelmixer=aa=0[blank${i}]`);
       filters.push(`[blank${i}][${normal}]overlay=eof_action=pass:repeatlast=0:enable='gte(t,${ordinaryStart})*lt(t,${ordinaryEnd})':format=auto,split=2[foreground${i}][maskSource${i}]`);
 filters.push(`[${video}]format=gbrp,split=2[baseBlend${i}][baseMerge${i}];[foreground${i}]format=gbrp[blendSource${i}];[maskSource${i}]alphaextract[mask${i}]`);
       filters.push(`[baseBlend${i}][blendSource${i}]blend=all_expr='${expressions[item.blendMode]}'[blend${i}];[baseMerge${i}][blend${i}][mask${i}]maskedmerge[over${i}]`);
     }else
 filters.push(`[${video}][${normal}]overlay=eof_action=pass:repeatlast=0:enable='gte(t,${ordinaryStart})*lt(t,${ordinaryEnd})':format=auto[over${i}]`);video='over'+i;
     if(pairNeeded(incoming)){
      const transitionStart=timeSeconds(original.start)-offset,d=fadeIn,label='pair'+i;let produced;
      if(nativeIn){
       const left=pairSources.get(incoming.id);if(!left)throw Error('Transition left source is unavailable.');const right='item'+i+'pairRight',effect=transitionCatalog.find(t=>t.id===incoming.type)?.effect;if(!effect)throw Error('Unknown native transition');
       for(const [source,suffix]of [[left,'a'],[right,'b']])filters.push(`[${source}]trim=start=${transitionStart}:end=${transitionStart+d},setpts=PTS-STARTPTS,settb=AVTB,format=gbrap[${label}${suffix}]`);
       filters.push(`[${label}a][${label}b]xfade=transition=${effect}:duration=${d}:offset=0,format=rgba,setpts=PTS-STARTPTS+${transitionStart}/TB[${label}]`);produced=label;pairEvidence.push({preset:incoming.type,renderer:'Native FFmpeg xfade',effect});
      }else{
       const left=pairMetadata.get(incoming.leftItemId),right=pairMetadata.get(original.id);if(!left)throw Error('GL transition left source is unavailable.');const result=await prepareGLPair(store,left,right,{canvas,duration:d,work,tag:String(i),kind:incoming.type,sessionProvider:async(folder,options)=>{context.glSession??=await createGLSession(folder,options);context.glSession.setSource(folder,options);return context.glSession;}},job),pairInput=inputIndex++;args.push('-protocol_whitelist','file,pipe','-i',result.path);filters.push(`[${pairInput}:v]setpts=PTS-STARTPTS+${transitionStart}/TB[${label}]`);produced=label;pairEvidence.push(result.evidence);pairTemporary.push(result.path);
      }
      filters.push(`[${video}][${produced}]overlay=eof_action=pass:repeatlast=0:enable='gte(t,${transitionStart})*lt(t,${transitionStart+d})':format=auto[pairOver${i}]`);video='pairOver'+i;
     }
   }else{
     filters.push(`[${input}:a]${audioFilter(item,{offset:from,originalDuration:length})}${fadeIn?`,afade=t=in:st=0:d=${fadeIn}`:''}${fadeOut?`,afade=t=out:st=${length-fadeOut}:d=${fadeOut}`:''},atrim=start=${from}:end=${to},asetpts=PTS-STARTPTS,adelay=${Math.round(start*48000)}S:all=1,apad[sound${i}]`);if(!trackAudio.has(track.id))trackAudio.set(track.id,[]);trackAudio.get(track.id).push('sound'+i);
   }
 }
 const ducking=active.filter(t=>t.kind==='audio'&&t.ducking&&trackAudio.has(t.id)&&trackAudio.has(t.ducking.sidechainTrackId)),rawMixes=new Map();
 for(const [trackId,labels]of trackAudio){const track=sequence.tracks.find(t=>t.id===trackId);if(!track.audioMix&&!ducking.length){audio.push(...labels);continue;}const tag='trackMix'+rawMixes.size;filters.push(`anullsrc=r=48000:cl=stereo:d=${total}[anchor${tag}]`);filters.push(`[anchor${tag}]`+labels.map(label=>`[${label}]`).join('')+`amix=inputs=${labels.length+1}:duration=first:normalize=0:dropout_transition=0,asetpts=PTS-STARTPTS,${audioProcessingFilter(track.audioMix)}[${tag}]`);rawMixes.set(trackId,tag);}
 const mainMixes=new Map(),controls=new Map();for(const [trackId,tag]of rawMixes){const users=ducking.filter(t=>t.ducking.sidechainTrackId===trackId),outputs=[tag+'main',...users.map((t,i)=>tag+'control'+i)];filters.push(`[${tag}]asplit=${outputs.length}`+outputs.map(label=>`[${label}]`).join(''));mainMixes.set(trackId,outputs[0]);users.forEach((t,i)=>controls.set(t.id,outputs[i+1]));}
 for(const [trackId,label]of mainMixes){const track=sequence.tracks.find(t=>t.id===trackId),control=controls.get(trackId);if(control){const d=track.ducking,tag=label+'duck';filters.push(`[${label}][${control}]sidechaincompress=threshold=${10**(d.thresholdDb/20)}:ratio=${d.ratio}:attack=${d.attackMs}:release=${d.releaseMs}[${tag}]`);audio.push(tag);}else audio.push(label);}
 filters.push(`[${video}]${hasStyledText(sequence)?await textFilter(p,work,'v2',job):await captionFilter(p,work,'v2')},format=yuv420p[finalv]`);
 for(const font of job.textFonts||[])context.textFonts.set(font.requestedId,font);for(const warning of job.textWarnings||[])context.textWarnings.add(warning);if(context.textFonts.size){job.textFonts=[...context.textFonts.values()];job.textWarnings=[...context.textWarnings];}
 filters.push(audio.map(a=>`[${a}]`).join('')+`amix=inputs=${audio.length}:duration=first:dropout_transition=0:normalize=0,alimiter=limit=0.95:level=0[finala]`);
 await fs.writeFile(path.join(work,'filters.txt'),filters.join(';'));
 args.push('-filter_complex_threads','1','-/filter_complex','filters.txt','-map','[finalv]','-map','[finala]');
 const range=draft?{start:draft.start-offset,end:draft.end-offset}:sequence.exportRange?{start:timeSeconds(sequence.exportRange.start),end:timeSeconds(sequence.exportRange.end)}:null;
 if(range)args.push('-ss',String(range.start),'-t',String(range.end-range.start));else args.push('-t',String(total));
 args.push('-c:v','libx264','-preset','veryfast','-crf','20','-pix_fmt','yuv420p','-c:a','aac','-ac','2','-ar','48000','-movflags','+faststart','edit.mp4');
 await run(store.ffmpeg,args,{cwd:work,timeout:7200000});
 for(const file of pairTemporary)await fs.unlink(file);
 if(sequence.captionMotion&&sequence.captions.length){
  const input=path.join(work,'composition.mp4'),output=path.join(work,'edit.mp4');await fs.rename(output,input);
  const {burnMotionCaptions}=await import('./caption-motion-renderer.mjs');let wordAlignment=boundWordAlignment(sequence);if(wordAlignment){const asset=project.assets.find(a=>a.id===wordAlignment.audioId);if(!asset||await fileDigest(store.assetPath(asset))!==wordAlignment.audioSha256)wordAlignment=undefined;}if(sequence.captionAlignment&&!wordAlignment)job.captionAlignmentWarning='Narration binding or audio bytes changed; word positions use explicit estimates.';
  await burnMotionCaptions(store,{input,output,canvas,duration:range?range.end-range.start:total,captions:sequence.captions.map(c=>({...c,start:timeSeconds(c.start),end:timeSeconds(c.end)})),preset:sequence.captionMotion.preset,fontId:sequence.captionMotion.font,alignment:wordAlignment,offset:offset+(range?.start||0)},job);
  await fs.unlink(input);
 }
 if(draft)job.coverage={start:draft.start,end:draft.end,processingStart:offset,processingEnd:stop,contributions:entries.length,canvas};
 if(pairEvidence.length)job.transitionEngines=pairEvidence;
 if(sequence.transitions.some(t=>t.type.startsWith('wgfx_')))job.transitionAdaptations=wgfxEvidence(sequence.transitions);
 Object.assign(job,{path:path.join(work,'edit.mp4'),file:job.id+'/edit.mp4',progress:100,status:'complete'});
 await atomic(path.join(work,'render.json'),{...job,schemaVersion:2,sequenceId:sequence.id,canvas,expectedDuration:range?range.end-range.start:total,exportRange:range});
 return job;
 }finally{if(context.glOwner===job.id)await context.glSession?.close();}
}
