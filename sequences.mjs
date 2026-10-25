import {validateSequenceText,hasStyledText} from './ui/text-model.js';
import {validateItemRemap} from './time-remap.mjs';
import {transitionKinds} from './transitions.mjs';
import {validateLibrary} from './library-operations.mjs';
import {validateNesting} from './nesting.mjs';
import {reverseBudget} from './reverse.mjs';
import {validateAudio} from './audio-processing.mjs';
import {validateAdjustments} from './adjustments.mjs';
import {validateMask} from './masks.mjs';
import {validateKeyframes} from './keyframes.mjs';
// Versioned sequence conversion, validation and strict legacy render adapter.
import {createHash} from 'node:crypto';
import {validate,timeline,duration,canonical,EditError,effectsCheck} from './engine.mjs';
const copy=v=>structuredClone(v);
const fail=message=>{throw new EditError('INVALID_SEQUENCE',message);};
const gcd=(a,b)=>{a=a<0n?-a:a;while(b){[a,b]=[b,a%b];}return a;};
function normalized(n,d){if(d<=0n)fail('Rational denominator must be positive.');const g=gcd(n,d);const result={numerator:String(n/g),denominator:String(d/g)};if(result.numerator.length>80||result.denominator.length>80)fail('Rational timestamp exceeds size limit.');return result;}
export function readTime(t){if(!t||typeof t.numerator!=='string'||typeof t.denominator!=='string'||! /^-?\d{1,80}$/.test(t.numerator)||! /^\d{1,80}$/.test(t.denominator))fail('Invalid rational timestamp.');const result=normalized(BigInt(t.numerator),BigInt(t.denominator));if(result.numerator!==t.numerator||result.denominator!==t.denominator)fail('Timestamp must be normalized.');return [BigInt(t.numerator),BigInt(t.denominator)];}
export function timeFromSeconds(value){if(typeof value!=='number'||!Number.isFinite(value))fail('Time must be finite.');const [mantissa,exponent='0']=String(value).split('e'),negative=mantissa.startsWith('-'),digits=mantissa.replace('-','').replace('.',''),places=(mantissa.split('.')[1]?.length||0)-Number(exponent);return normalized(BigInt(digits)*(negative?-1n:1n)*(places<0?10n**BigInt(-places):1n),places>0?10n**BigInt(places):1n);}
export function timeSeconds(t){const [n,d]=readTime(t);return Number(n)/Number(d);}
export function addTime(a,b){const [an,ad]=readTime(a),[bn,bd]=readTime(b);return normalized(an*bd+bn*ad,ad*bd);}
export function subtractTime(a,b){const [an,ad]=readTime(a),[bn,bd]=readTime(b);return normalized(an*bd-bn*ad,ad*bd);}
export function divideTime(a,b){const [an,ad]=readTime(a),[bn,bd]=readTime(b);if(bn<=0n)fail('Time divisor must be positive.');return normalized(an*bd,ad*bn);}
const stable=(kind,key)=>kind+'_'+createHash('sha256').update(key).digest('hex');
const near=(a,b)=>Math.abs(a-b)<1e-8;

export function convertV1(project){
 if(project.schemaVersion!==undefined&&project.schemaVersion!==1)fail('Only legacy v1 projects can be converted.');validate(project);
 const sequenceId=stable('sequence','primary'),tracks=[],transitions=[];
 const track=(kind,role,lane)=>{const id=stable('track',`${kind}:${role}:${lane}`);let t=tracks.find(t=>t.id===id);if(!t){t={id,kind,name:role==='base'?'Primary '+kind:kind+' '+lane,role,lane,locked:false,muted:false,solo:false,targeted:role==='base',syncLocked:true,items:[]};tracks.push(t);}return t;};
 const item=(clip,start,origin,originIndex)=>({...copy(clip),start:timeFromSeconds(start),duration:timeFromSeconds(duration(clip)),origin,originIndex});
 const addVideo=(clip,start,origin,index,lane)=>{
   const video=item(clip,start,origin,index);if(Object.hasOwn(video,'transitionOut')&&!video.transitionOut)video.legacyTransitionOutZero=true;delete video.transitionOut;delete video.kind;delete video.track;video.linkGroupId=stable('link',clip.id);track('video',origin,lane).items.push(video);
   const asset=project.assets.find(a=>a.id===clip.assetId);
   if(asset.hasAudio){const audio={...copy(video),id:stable('audio',clip.id),origin:'companion',videoItemId:clip.id};track('audio',origin==='layer'?'layer-companion':origin,lane).items.push(audio);}
 };
 const positioned=timeline(project);positioned.forEach((c,i)=>{addVideo(project.clips[i],c.start,'base',i,0);if(c.transitionOut)transitions.push({id:stable('transition',c.id),trackId:track('video','base',0).id,leftItemId:c.id,rightItemId:project.clips[i+1].id,type:'cross_dissolve',duration:timeFromSeconds(c.transitionOut),alignment:'legacy-overlap',audio:'crossfade'});});
 (project.layers||[]).forEach((l,i)=>{if(l.kind==='video')addVideo(l,l.start,'layer',i,l.track);else{const audio=item(l,l.start,'layer',i);delete audio.kind;delete audio.track;track('audio','layer',l.track).items.push(audio);}});
 const sequence={id:sequenceId,name:project.title,canvas:copy(project.canvas),timebase:{numerator:project.canvas.fps,denominator:1},tracks,transitions,captions:(project.captions||[]).map(c=>({...copy(c),start:timeFromSeconds(c.start),end:timeFromSeconds(c.end)})),markers:(project.markers||[]).map(m=>({...copy(m),time:timeFromSeconds(m.time)})),exportRange:project.exportRange?{start:timeFromSeconds(project.exportRange.start),end:timeFromSeconds(project.exportRange.end)}:null,compatibility:{layers:Object.hasOwn(project,'layers'),markers:Object.hasOwn(project,'markers'),exportRange:Object.hasOwn(project,'exportRange')}};
 sequence.compatibility.version1Declared=project.schemaVersion===1;
 const result={schemaVersion:2,title:project.title,assets:copy(project.assets),activeSequenceId:sequenceId,sequences:[sequence]};validateV2(result);return result;
}

export function validateV2(project){
 if(project?.schemaVersion!==2||typeof project.title!=='string'||!project.title.trim()||project.title.length>120)fail('Invalid v2 project header.');
 if(!Array.isArray(project.assets)||project.assets.length>500||!Array.isArray(project.sequences)||!project.sequences.length||project.sequences.length>64)fail('Invalid v2 asset/sequence count.');
 try{validateLibrary(project);}catch(e){fail(e.message);}
 const assetIds=new Set();for(const a of project.assets){if(typeof a.id!=='string'||assetIds.has(a.id)||!Number.isFinite(a.duration)||a.duration<=0)fail('Invalid or duplicate asset.');assetIds.add(a.id);}
 const sequenceIds=new Set();
 for(const seq of project.sequences){
   if(typeof seq.id!=='string'||sequenceIds.has(seq.id))fail('Invalid sequence ID.');sequenceIds.add(seq.id);
   if(!seq.timebase||!Number.isSafeInteger(seq.timebase.numerator)||!Number.isSafeInteger(seq.timebase.denominator)||seq.timebase.numerator<=0||seq.timebase.denominator<=0)fail('Invalid frame timebase.');
   const fps=seq.timebase.numerator/seq.timebase.denominator;if(fps<12||fps>60||!near(fps,seq.canvas?.fps))fail('Frame timebase must match canvas fps.');
   if(!seq.canvas||!Number.isInteger(seq.canvas.width)||seq.canvas.width<160||seq.canvas.width>3840||seq.canvas.width%2||!Number.isInteger(seq.canvas.height)||seq.canvas.height<160||seq.canvas.height>2160||seq.canvas.height%2)fail('Invalid canvas.');
   if(!Array.isArray(seq.tracks)||seq.tracks.length>64||!Array.isArray(seq.transitions)||seq.transitions.length>500)fail('Invalid track/transition count.');
   const ids=new Set(),trackIds=new Set(),items=new Map();let total=0;
   for(const t of seq.tracks){
     if(typeof t.id!=='string'||trackIds.has(t.id)||!['video','audio'].includes(t.kind)||!Array.isArray(t.items)||t.items.length>1000)fail('Invalid track.');trackIds.add(t.id);
     try{validateAudio(t.audioMix,t.kind);}catch(e){fail(e.message);}
     if(t.ducking){const d=t.ducking;if(t.kind!=='audio'||!seq.tracks.some(s=>s.kind==='audio'&&s.id===d.sidechainTrackId&&s.id!==t.id))fail('Invalid ducking sidechain.');try{validateAudio({compressor:{thresholdDb:d.thresholdDb,ratio:d.ratio,attackMs:d.attackMs,releaseMs:d.releaseMs}},'audio');}catch(e){fail(e.message);}}

     if(t.role==='adjustment'&&t.items.length)fail('Adjustment layers cannot contain media items.');
     for(const key of ['locked','muted','solo','targeted','syncLocked'])if(typeof t[key]!=='boolean')fail('Invalid track flag.');
     for(const i of t.items){
       if(typeof i.id!=='string'||ids.has(i.id)||!assetIds.has(i.assetId))fail('Invalid or duplicate item ID/asset.');ids.add(i.id);items.set(i.id,{item:i,track:t});
       const a=project.assets.find(a=>a.id===i.assetId),start=timeSeconds(i.start),length=timeSeconds(i.duration);
       if(!Number.isFinite(start)||start<0||!Number.isFinite(length)||length<=0||start+length>7200+.001)fail('Invalid item interval.');
       if(!Number.isFinite(i.sourceIn)||!Number.isFinite(i.sourceOut)||i.sourceIn<0||i.sourceOut<i.sourceIn+.01||i.sourceOut>a.duration+.001||!Number.isFinite(i.speed)||i.speed<.25||i.speed>4||!Number.isFinite(i.volume)||i.volume<0||i.volume>2||!near(length,duration(i)))fail('Invalid item source/speed/volume.');
       try{validateItemRemap(i);}catch(e){fail(e.message);}
       if(t.kind==='video'&&a.kind==='audio'||t.kind==='audio'&&!a.hasAudio)fail('Asset cannot populate this track.');total=Math.max(total,start+length);
       if(i.reverse!==undefined&&i.reverse!==true)fail('Reverse flag must be true or omitted.');if(i.reverse){if(i.frameHold)fail('Clear freeze frame before reversing playback.');try{reverseBudget(i,t.kind==='audio'?{...a,kind:'audio'}:a,seq.timebase);}catch(e){fail(e.message);}}
       if(i.frameHold!==undefined&&(t.kind!=='video'||!i.frameHold||typeof i.frameHold!=='object'||Array.isArray(i.frameHold)||Object.keys(i.frameHold).some(k=>k!=='sourceTime')||!Number.isFinite(i.frameHold.sourceTime)||i.frameHold.sourceTime<0||i.frameHold.sourceTime>a.duration-.1))fail('Freeze frame must reference video source time with at least 0.1 seconds remaining.');
       if(i.groupId!==undefined&&(typeof i.groupId!=='string'||!i.groupId||i.groupId.length>120))fail('Invalid item group.');
       if(i.audioCategory!==undefined&&(t.kind!=='audio'||!['dialogue','music','sfx','ambience'].includes(i.audioCategory)))fail('Invalid audio category.');
       if(i.blendMode!==undefined&&(t.kind!=='video'||!['normal','multiply','screen','darken','lighten','difference','addition'].includes(i.blendMode)))fail('Invalid video blend mode.');
       try{effectsCheck(i.effects||{},length);validateKeyframes(i,length,t.kind);validateMask(i.mask,t.kind);validateAudio(i.audio,t.kind);}catch(e){fail(e.message);}
     }
   }
   const groupCounts=new Map();for(const {item}of items.values())if(item.groupId){const count=(groupCounts.get(item.groupId)||0)+1;if(count>200)fail('Group exceeds 200 items.');groupCounts.set(item.groupId,count);}
   for(const t of seq.tracks)try{validateAdjustments(t,total,ids,timeSeconds);}catch(e){fail(e.message);}
   for(const {item:i,track:t} of items.values())if(i.origin==='companion'){const video=items.get(i.videoItemId);if(t.kind!=='audio'||!video||video.track.kind!=='video'||video.item.linkGroupId!==i.linkGroupId||video.item.assetId!==i.assetId)fail('Invalid linked audio companion.');}
   const transitionIds=new Set();for(const x of seq.transitions){if([items.get(x.leftItemId),items.get(x.rightItemId)].some(e=>e?.item.mask))fail('Source masks cannot be combined with attached dissolve/transition effects.');if([items.get(x.leftItemId),items.get(x.rightItemId)].some(e=>e?.item.blendMode&&e.item.blendMode!=='normal'))fail('Non-normal blend modes cannot be combined with attached dissolve/transition effects.');const left=items.get(x.leftItemId),right=items.get(x.rightItemId),d=timeSeconds(x.duration);if(typeof x.id!=='string'||transitionIds.has(x.id)||!left||!right||left.track.id!==x.trackId||right.track.id!==x.trackId||!transitionKinds.includes(x.type)||left.track.kind!=='video'||x.audio!=='crossfade'||x.alignment!=='legacy-overlap'||d<=0||d>2||d>=Math.min(timeSeconds(left.item.duration),timeSeconds(right.item.duration))-.01||!near(timeSeconds(left.item.start)+timeSeconds(left.item.duration)-timeSeconds(right.item.start),d))fail('Invalid transition.');transitionIds.add(x.id);}
   for(const {item:i,track:t}of items.values()){const incoming=seq.transitions.filter(x=>x.rightItemId===i.id),outgoing=seq.transitions.filter(x=>x.leftItemId===i.id);if(incoming.length>1||outgoing.length>1||incoming.length&&outgoing.length&&timeSeconds(incoming[0].duration)+timeSeconds(outgoing[0].duration)>=timeSeconds(i.duration)-.01)fail('Transitions must leave a non-overlapping item interval.');}
   for(const t of seq.tracks){const sorted=[...t.items].sort((a,b)=>timeSeconds(a.start)-timeSeconds(b.start));for(let i=1;i<sorted.length;i++){const a=sorted[i-1],b=sorted[i];if(timeSeconds(a.start)+timeSeconds(a.duration)>timeSeconds(b.start)+1e-8){const direct=seq.transitions.some(x=>x.leftItemId===a.id&&x.rightItemId===b.id),paired=a.origin==='companion'&&b.origin==='companion'&&seq.transitions.some(x=>x.leftItemId===a.videoItemId&&x.rightItemId===b.videoItemId);if(!direct&&!paired)fail('Unsupported same-track overlap.');}}}
   if(!Array.isArray(seq.captions)||seq.captions.length>500||!Array.isArray(seq.markers)||seq.markers.length>500)fail('Invalid annotation count.');
   const captions=[...seq.captions].sort((a,b)=>timeSeconds(a.start)-timeSeconds(b.start));for(let i=0;i<captions.length;i++){const c=captions[i],s=timeSeconds(c.start),e=timeSeconds(c.end);if(typeof c.text!=='string'||!c.text.trim()||c.text.length>1000||s<0||e<s+.01||e>total+.001||i&&s<timeSeconds(captions[i-1].end)-.001)fail('Invalid caption interval.');}
   try{validateSequenceText(seq,total,timeSeconds);}catch(e){fail(e.message);}
   for(const m of seq.markers){const t=timeSeconds(m.time);if(typeof m.label!=='string'||!m.label.trim()||t<0||t>total)fail('Invalid marker.');}
   if(seq.exportRange){const s=timeSeconds(seq.exportRange.start),e=timeSeconds(seq.exportRange.end);if(s<0||e<s+.01||e>total+.001)fail('Invalid export range.');}
 }
 if(!sequenceIds.has(project.activeSequenceId))fail('Unknown active sequence.');try{validateNesting(project);}catch(e){fail(e.message);}return project;
}

export function legacyRenderSnapshot(project,{forRendering=false}={}){
 validateV2(project);const s=project.sequences.find(s=>s.id===project.activeSequenceId),ordered=[],layers=[];
 if(hasStyledText(s))fail('Legacy adapter cannot flatten styled captions or text graphics.');
 if(project.assets.some(a=>a.kind==='sequence'))fail('Legacy adapter cannot flatten nested sequence sources.');
 if(s.transitions.some(x=>x.type!=='cross_dissolve'))fail('Legacy adapter cannot flatten non-dissolve transitions.');
 if(s.tracks.some(t=>t.audioMix||t.ducking))fail('Legacy adapter cannot flatten track audio processing.');
 if(s.tracks.some(t=>t.adjustments?.length))fail('Legacy adapter cannot flatten adjustment layers.');
 if(s.tracks.some(t=>(t.locked&&!forRendering)||t.muted||t.solo))fail('Legacy adapter cannot represent track flags.');
 for(const t of s.tracks)for(const item of t.items){
   if(item.reverse)fail('Legacy adapter cannot flatten reverse playback.');
   if(item.speedCurve)fail('Legacy adapter cannot flatten time remapping.');
   if(item.frameHold)fail('Legacy adapter cannot flatten freeze frames.');
   if(item.audio)fail('Legacy adapter cannot flatten audio processors.');
   if(item.mask)fail('Legacy adapter cannot flatten masks.');
   if(item.blendMode&&item.blendMode!=='normal')fail('Legacy adapter cannot flatten blend modes.');
   if(item.keyframes&&Object.keys(item.keyframes).length)fail('Legacy adapter cannot flatten animated items.');
   if(item.origin==='companion')continue;
   const c=copy(item);for(const key of ['start','duration','origin','originIndex','linkGroupId','videoItemId','legacyTransitionOutZero','blendMode','groupId'])delete c[key];
   const companions=s.tracks.flatMap(t=>t.items).filter(a=>a.origin==='companion'&&a.videoItemId===item.id),companion=companions[0];
   const needsAudio=t.kind==='video'&&project.assets.find(a=>a.id===item.assetId).hasAudio;if(companions.length!==(needsAudio?1:0))fail('Legacy adapter requires original linked audio.');
   if(companion&&(!near(timeSeconds(companion.start),timeSeconds(item.start))||canonical({...companion,id:item.id,origin:item.origin,videoItemId:undefined})!==canonical({...item,videoItemId:undefined})))fail('Legacy adapter cannot flatten independently edited linked audio.');
   if(item.origin==='base'&&t.kind==='video'){const x=s.transitions.find(x=>x.leftItemId===item.id);if(x)c.transitionOut=timeSeconds(x.duration);else if(item.legacyTransitionOutZero)c.transitionOut=0;ordered.push({index:item.originIndex,clip:c,start:timeSeconds(item.start)});}
   else if(item.origin==='layer'){c.kind=t.kind;c.track=t.lane;c.start=timeSeconds(item.start);layers.push({index:item.originIndex,clip:c});}
   else fail('Legacy adapter cannot represent this item.');
 }
 ordered.sort((a,b)=>a.index-b.index);layers.sort((a,b)=>a.index-b.index);
 const result={title:project.title,canvas:copy(s.canvas),assets:copy(project.assets),clips:ordered.map(o=>o.clip),captions:s.captions.map(c=>({...copy(c),start:timeSeconds(c.start),end:timeSeconds(c.end)}))};
 if(s.compatibility?.version1Declared)result.schemaVersion=1;
 if(s.compatibility?.layers||layers.length)result.layers=layers.map(l=>l.clip);
 if(s.compatibility?.markers||s.markers.length)result.markers=s.markers.map(m=>({...copy(m),time:timeSeconds(m.time)}));
 if(s.compatibility?.exportRange||s.exportRange)result.exportRange=s.exportRange?{start:timeSeconds(s.exportRange.start),end:timeSeconds(s.exportRange.end)}:null;
 try{validate(result);}catch(e){fail('Legacy adapter cannot represent this sequence: '+e.message);}const actual=timeline(result);if(actual.some((c,i)=>!near(c.start,ordered[i].start)))fail('Legacy adapter cannot flatten gaps or independent timing.');return result;
}

export function migrationPreview(project){const converted=convertV1(project),renderSnapshot=legacyRenderSnapshot(converted);return {sourceVersion:1,targetVersion:2,activationAvailable:canonical(project)===canonical(renderSnapshot),proposedProject:converted,legacyRoundTripMatches:canonical(project)===canonical(renderSnapshot),warnings:['Read-only conversion preview. No saved project is migrated.','Review v2 operation contracts and core-workstream-report.md before activation; advanced Premiere features and native runtime parity remain incomplete.']};}
