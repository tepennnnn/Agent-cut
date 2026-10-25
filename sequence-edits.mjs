import {textPolicies,retimeCut,retimeInsert} from './text-operations.mjs';
import {validateSpeedCurve} from './time-remap.mjs';
import {adjustmentDefaults} from './adjustments.mjs';
import {sourceSlice} from './reverse.mjs';
import {maskDefaults} from './masks.mjs';
import {sliceKeyframes} from './keyframes.mjs';
import {timeFromSeconds as T,timeSeconds as seconds,addTime,subtractTime,divideTime} from './sequences.mjs';

// Pure commands share Store planning, validation and undo; no filesystem work here.
const end=i=>seconds(i.start)+seconds(i.duration);
const duration=i=>i.speedCurve?T(i.speedCurve.at(-1).time):divideTime(subtractTime(T(i.sourceOut),T(i.sourceIn)),T(i.speed));
const finite=(v,min,max)=>{if(!Number.isFinite(v)||v<min||v>max)throw Error(`Value must be within ${min}–${max}.`);};
const native=i=>{i.origin='native';delete i.originIndex;delete i.legacyTransitionOutZero;};
export function applyAdvancedSequenceOperation({q,s,op,allocateId,track,entries,writable,groups,label}){
 const all=()=>entries(s),total=()=>Math.max(0,...all().map(e=>end(e.item)));
 const attached=ids=>{if(s.transitions.some(x=>ids.has(x.leftItemId)||ids.has(x.rightItemId)))throw Error('Remove attached transitions before changing source or duration.');};
 const selected=()=>{const entry=all().find(e=>e.item.id===op.itemId);if(!entry)throw Error('Unknown item ID.');const list=groups(s,entry,op.type==='item_effects'?op.linked===true:op.linked);writable(list.map(e=>e.track));return {entry,list};};
 if(op.type==='item_speed_curve'||op.type==='item_speed_curve_clear'){const {list}=selected();attached(new Set(list.map(e=>e.item.videoItemId||e.item.id)));if(op.type==='item_speed_curve')validateSpeedCurve(op.points);for(const {item}of list){if(op.type==='item_speed_curve'){item.speedCurve=structuredClone(op.points);item.speed=1;}else{if(!item.speedCurve)continue;delete item.speedCurve;item.speed=1;}item.duration=duration(item);}return true;}
 if(op.type==='item_reverse'){const {list}=selected();for(const {item}of list){if(op.enabled)item.reverse=true;else delete item.reverse;}return true;}
 if(op.type==='item_freeze'||op.type==='item_freeze_clear'){const entry=all().find(e=>e.item.id===op.itemId);if(!entry||entry.track.kind!=='video')throw Error('Freeze frame requires a video item.');writable([entry.track]);if(op.type==='item_freeze')entry.item.frameHold={sourceTime:op.sourceTime};else delete entry.item.frameHold;return true;}
 if(op.type==='item_attributes'){const source=all().find(e=>e.item.id===op.sourceItemId);if(!source)throw Error('Unknown source item.');const targets=[...new Set(op.targetItemIds)].map(id=>{const e=all().find(e=>e.item.id===id);if(!e)throw Error('Unknown attribute target.');return e;});writable(targets.map(e=>e.track));for(const {item}of targets)for(const key of op.properties){if(source.item[key]===undefined)delete item[key];else item[key]=structuredClone(source.item[key]);}return true;}
 if(op.type==='item_group'){let selected=[];for(const id of op.itemIds){const entry=all().find(e=>e.item.id===id);if(!entry)throw Error('Unknown group item.');selected.push(...groups(s,entry,true,true));}selected=[...new Map(selected.map(e=>[e.item.id,e])).values()];if(selected.length>200)throw Error('Group exceeds 200 items.');writable(selected.map(e=>e.track));const groupId=allocateId();for(const e of selected)e.item.groupId=groupId;return true;}
 if(op.type==='item_ungroup'){const entry=all().find(e=>e.item.id===op.itemId);if(!entry)throw Error('Unknown grouped item.');if(!entry.item.groupId)return true;const selected=all().filter(e=>e.item.groupId===entry.item.groupId);writable(selected.map(e=>e.track));for(const e of selected)delete e.item.groupId;return true;}
 if(op.type==='track_ducking'){const t=track(s,op.trackId);writable([t]);if(t.kind!=='audio')throw Error('Ducking requires an audio track.');if(op.sidechainTrackId)t.ducking={sidechainTrackId:op.sidechainTrackId,thresholdDb:op.thresholdDb??-30,ratio:op.ratio??4,attackMs:op.attackMs??20,releaseMs:op.releaseMs??250};else delete t.ducking;return true;}
 if(op.type==='item_audio_preset'){const entry=all().find(e=>e.item.id===op.itemId);if(!entry||entry.track.kind!=='audio')throw Error('Choose an audio item.');writable([entry.track]);const presets={dialogue:{highpassHz:80,midEqDb:2,compressor:{thresholdDb:-18,ratio:3,attackMs:10,releaseMs:150}},music:{compressor:{thresholdDb:-18,ratio:2,attackMs:30,releaseMs:300}},sfx:{limiterDb:-1},ambience:{highpassHz:40}};if(op.preset==='neutral'){delete entry.item.audio;delete entry.item.audioCategory;}else{entry.item.audio=structuredClone(presets[op.preset]);entry.item.audioCategory=op.preset;}return true;}
 if(op.type==='item_audio'||op.type==='track_audio'){
   const entry=op.type==='item_audio'?all().find(e=>e.item.id===op.itemId):null,t=entry?entry.track:op.type==='track_audio'?track(s,op.trackId):null;if(!t||t.kind!=='audio')throw Error('Choose an audio item or track.');writable([t]);const target=entry?entry.item:t,key=entry?'audio':'audioMix';target[key]=op.replace?structuredClone(op.values):{...target[key],...op.values};if(!Object.keys(target[key]).length)delete target[key];if(entry)delete target.audioCategory;return true;
 }
 if(op.type==='adjustment_layer_add'){
   const index=op.index??s.tracks.length;if(!Number.isInteger(index)||index<0||index>s.tracks.length)throw Error('Invalid adjustment layer index.');
   s.tracks.splice(index,0,{id:allocateId(),name:label(op.name),kind:'video',role:'adjustment',locked:false,muted:false,solo:false,targeted:false,syncLocked:true,items:[],adjustments:[{id:allocateId(),name:label(op.name),start:T(op.start),end:T(op.end),values:{...adjustmentDefaults,...op.values}}]});return true;
 }
 if(op.type==='adjustment_keyframes'||op.type==='adjustment_keyframes_clear'){
   const t=track(s,op.trackId);writable([t]);const a=t.adjustments?.find(a=>a.id===op.adjustmentId);if(!a)throw Error('Unknown adjustment span.');
   if(op.type==='adjustment_keyframes')a.keyframes={...a.keyframes,[op.property]:structuredClone(op.frames)};
   else if(op.property){if(a.keyframes)delete a.keyframes[op.property];if(a.keyframes&&!Object.keys(a.keyframes).length)delete a.keyframes;}else delete a.keyframes;return true;
 }
 if(op.type==='adjustment_update'||op.type==='adjustment_delete'){
   const t=track(s,op.trackId);writable([t]);const a=t.adjustments?.find(a=>a.id===op.adjustmentId);if(!a)throw Error('Unknown adjustment span.');
   if(op.type==='adjustment_delete'){t.adjustments=t.adjustments.filter(x=>x!==a);if(!t.adjustments.length)delete t.adjustments;}
   else{if(op.name!==undefined)a.name=label(op.name);if(op.start!==undefined)a.start=T(op.start);if(op.end!==undefined)a.end=T(op.end);if(op.values)a.values={...a.values,...op.values};}return true;
 }
 if(op.type==='item_mask'||op.type==='item_mask_clear'){const entry=all().find(e=>e.item.id===op.itemId);if(!entry||entry.track.kind!=='video')throw Error('Mask requires a video item.');writable([entry.track]);if(op.type==='item_mask')entry.item.mask={...maskDefaults,...structuredClone(op.mask)};else delete entry.item.mask;return true;}
 if(op.type==='item_blend'){const entry=all().find(e=>e.item.id===op.itemId);if(!entry||entry.track.kind!=='video')throw Error('Blend mode requires a video item.');writable([entry.track]);if(op.mode==='normal')delete entry.item.blendMode;else entry.item.blendMode=op.mode;return true;}
 if(op.type==='item_keyframes'||op.type==='item_keyframes_clear'){
   const entry=all().find(e=>e.item.id===op.itemId);if(!entry)throw Error('Unknown item ID.');writable([entry.track]);const i=entry.item;
  
 if(op.type==='item_keyframes')i.keyframes={...i.keyframes,[op.property]:structuredClone(op.frames)};
   else if(op.property){if(i.keyframes)delete i.keyframes[op.property];if(i.keyframes&&!Object.keys(i.keyframes).length)delete i.keyframes;}else delete i.keyframes;return true;
 }
 if(op.type==='sequence_razor'){
   finite(op.time,0,total());const targets=all().filter(e=>(op.targetedOnly===false||e.track.targeted)&&seconds(e.item.start)<op.time&&end(e.item)>op.time),done=new Set();if(!targets.length)throw Error('No targeted media crosses this cut.');
   for(const entry of targets){const key=entry.item.linkGroupId||entry.item.id;if(done.has(key))continue;done.add(key);applyAdvancedSequenceOperation({q,s,op:{type:'item_split',itemId:entry.item.id,time:op.time},allocateId,track,entries,writable,groups,label});}return true;
 }
 if(op.type==='sequence_settings'){
   if(op.name!==undefined)s.name=label(op.name);if(op.width!==undefined)s.canvas.width=op.width;if(op.height!==undefined)s.canvas.height=op.height;
   if(op.fpsNumerator!==undefined)s.timebase.numerator=op.fpsNumerator;if(op.fpsDenominator!==undefined)s.timebase.denominator=op.fpsDenominator;s.canvas.fps=s.timebase.numerator/s.timebase.denominator;return true;
 }
 if(op.type==='track_reorder'){const t=track(s,op.trackId);writable([t]);if(!Number.isInteger(op.index)||op.index<0||op.index>=s.tracks.length)throw Error('Invalid track destination index.');s.tracks.splice(s.tracks.indexOf(t),1);s.tracks.splice(op.index,0,t);return true;}
 if(['sequence_caption','sequence_marker','sequence_caption_delete','sequence_marker_delete','sequence_range','sequence_range_clear'].includes(op.type)){
   if(op.type==='sequence_range_clear'){s.exportRange=null;return true;}
   if(op.type==='sequence_range'){finite(op.start,0,total());finite(op.end,op.start+.01,total());s.exportRange={start:T(op.start),end:T(op.end)};return true;}
   const caption=op.type.includes('caption'),list=caption?s.captions:s.markers,key=caption?'captionId':'markerId',id=op[key];
   if(op.type.endsWith('_delete')){const index=list.findIndex(i=>i.id===id);if(index<0)throw Error('Unknown annotation ID.');list.splice(index,1);return true;}
   const existing=id?list.find(i=>i.id===id):null;if(id&&!existing)throw Error('Unknown annotation ID.');
   const value=caption?{id:id||allocateId(),text:op.text,start:T(op.start),end:T(op.end)}:{id:id||allocateId(),label:op.label,time:T(op.time)};
   if(caption){if(op.clearStyle&&op.style!==undefined)throw Error('Choose style or clearStyle.');if(op.style!==undefined)value.style=structuredClone(op.style);if(existing&&op.clearStyle)delete existing.style;}if(existing)Object.assign(existing,value);else list.push(value);return true;
 }
 if(['item_trim','item_split','item_slip','item_rate','item_effects','item_volume'].includes(op.type)){
   const {entry,list}=selected();
   if(op.type==='item_effects'){const affected=op.linked===true?list:[entry];for(const {item:i}of affected)i.effects=op.replace?structuredClone(op.values):{...i.effects,...op.values};return true;}
   if(op.type==='item_volume'){finite(op.volume,0,2);for(const {item:i}of list)i.volume=op.volume;return true;}
   if(['item_trim','item_rate'].includes(op.type)&&list.some(e=>e.item.speedCurve))throw Error('Clear the speed curve before source trim or constant rate stretch.');
   attached(new Set(list.flatMap(e=>[e.item.id,e.item.videoItemId]).filter(Boolean)));
   if(op.type==='item_split'){
     finite(op.time,0,7200);const ids=new Map(),linkIds=new Map(),right=[];
     for(const {track:t,item:i}of list){const offset=op.time-seconds(i.start);if(offset*i.speed<.01||(seconds(i.duration)-offset)*i.speed<.01)throw Error('Cut must leave at least 0.01 source seconds on both sides.');
       const r=structuredClone(i),leftRange=sourceSlice(i,0,offset),rightRange=sourceSlice(i,offset,seconds(i.duration));r.id=allocateId();ids.set(i.id,r.id);Object.assign(r,rightRange);r.start=T(op.time);r.duration=duration(r);sliceKeyframes(r,offset,seconds(i.duration));sliceKeyframes(i,0,offset);Object.assign(i,leftRange);i.duration=duration(i);native(i);native(r);right.push({track:t,item:r,oldVideo:i.videoItemId});
       if(i.linkGroupId){if(!linkIds.has(i.linkGroupId))linkIds.set(i.linkGroupId,allocateId());r.linkGroupId=linkIds.get(i.linkGroupId);}
     }
     for(const {item:i}of list)if(i.videoItemId){if(ids.has(i.videoItemId))i.origin='companion';else delete i.videoItemId;}
     for(const {track:t,item:r,oldVideo}of right){if(oldVideo&&ids.has(oldVideo)){r.origin='companion';r.videoItemId=ids.get(oldVideo);}else delete r.videoItemId;t.items.push(r);}return true;
   }
   for(const {item:i}of list){
     if(op.type==='item_trim'){i.sourceIn=op.sourceIn;i.sourceOut=op.sourceOut;}
     if(op.type==='item_slip'){finite(op.delta,-7200,7200);i.sourceIn+=op.delta;i.sourceOut+=op.delta;}
     if(op.type==='item_rate'){finite(op.duration,.0025,7200);i.speed=(i.sourceOut-i.sourceIn)/op.duration;}
     i.duration=duration(i); // final project validation checks source handles, speed, fades and collisions
   }return true;
 }
 if(op.type==='item_roll'||op.type==='item_slide'){
   finite(op.delta,-7200,7200);const {entry}=selected(),ordered=[...entry.track.items].sort((a,b)=>seconds(a.start)-seconds(b.start)),index=ordered.indexOf(entry.item);
   const left=op.type==='item_roll'?entry.item:ordered[index-1],middle=op.type==='item_slide'?entry.item:null,right=ordered[index+1];
   if(!left||!right||Math.abs(end(left)-seconds((middle||right).start))>1e-8||middle&&Math.abs(end(middle)-seconds(right.start))>1e-8)throw Error('Edit requires adjacent neighbors on the same track.');
   const leftEntries=groups(s,{track:entry.track,item:left},op.linked),rightEntries=groups(s,{track:entry.track,item:right},op.linked),middleEntries=middle?groups(s,entry,op.linked):[];
   if([...leftEntries,...rightEntries,...middleEntries].some(e=>e.item.speedCurve))throw Error('Clear speed curves before roll or slide edits.');
   writable([...leftEntries,...rightEntries,...middleEntries].map(e=>e.track));attached(new Set([...leftEntries,...rightEntries,...middleEntries].map(e=>e.item.videoItemId||e.item.id)));
   for(const {item:i}of leftEntries){if(i.reverse)i.sourceIn-=op.delta*i.speed;else i.sourceOut+=op.delta*i.speed;i.duration=duration(i);}
   for(const {item:i}of rightEntries){if(i.reverse)i.sourceOut-=op.delta*i.speed;else i.sourceIn+=op.delta*i.speed;i.start=addTime(i.start,T(op.delta));i.duration=duration(i);}
   for(const {item:i}of middleEntries)i.start=addTime(i.start,T(op.delta));return true;
 }
 if(op.type==='sequence_insert_gap'){textPolicies(s,op);
   finite(op.time,0,total());finite(op.duration,.01,7200);if(s.transitions.length)throw Error('Remove transitions before insertion.');const targets=s.tracks.filter(t=>t.syncLocked||t.targeted||op.trackIds?.includes(t.id));if(targets.some(t=>t.adjustments?.length))throw Error('Remove or disable sync lock/targeting on adjustment layers before insertion.');if(!targets.length)throw Error('Target or sync-lock a track before insertion.');writable(targets.filter(t=>t.items.some(i=>end(i)>op.time)));const links=new Map(),right=[];
   for(const t of targets){for(const i of [...t.items]){const a=seconds(i.start),b=end(i);if(a>=op.time){i.start=addTime(i.start,T(op.duration));continue;}if(b<=op.time)continue;
     const before=sourceSlice(i,0,op.time-a),after=sourceSlice(i,op.time-a,seconds(i.duration));if(before.sourceOut-before.sourceIn<.01||after.sourceOut-after.sourceIn<.01)throw Error('Insertion cut leaves insufficient source media.');
     const r=structuredClone(i),leftRange=sourceSlice(i,0,op.time-a),rightRange=sourceSlice(i,op.time-a,seconds(i.duration));r.id=allocateId();Object.assign(r,rightRange);r.start=T(op.time+op.duration);r.duration=duration(r);sliceKeyframes(r,op.time-a,seconds(i.duration));sliceKeyframes(i,0,op.time-a);Object.assign(i,leftRange);i.duration=duration(i);native(i);native(r);delete i.videoItemId;delete r.videoItemId;
     if(i.linkGroupId){if(!links.has(i.linkGroupId))links.set(i.linkGroupId,allocateId());r.linkGroupId=links.get(i.linkGroupId);}t.items.push(r);right.push(r);
   }}
   for(const {track:t,item:i}of all())if(t.kind==='audio'&&i.linkGroupId&&targets.includes(t)){const v=all().find(e=>e.track.kind==='video'&&e.item.linkGroupId===i.linkGroupId);if(v){i.origin='companion';i.videoItemId=v.item.id;}}
   const map=t=>t>=op.time?t+op.duration:t;if(op.captionPolicy!=='retain')s.captions=retimeInsert(s.captions,op.time,op.duration,allocateId);if(s.graphics&&op.graphicPolicy==='retime')s.graphics=retimeInsert(s.graphics,op.time,op.duration,allocateId).map((g,order)=>({...g,order}));s.markers=s.markers.map(m=>({...m,time:T(map(seconds(m.time)))}));if(s.exportRange)s.exportRange={start:T(map(seconds(s.exportRange.start))),end:T(map(seconds(s.exportRange.end)))};return true;
 }
 if(op.type==='sequence_remove_range'){textPolicies(s,op);
   finite(op.start,0,7200);finite(op.end,op.start+.01,7200);if(op.ripple!==false&&op.end>total())throw Error('Ripple range exceeds sequence.');if(s.transitions.length)throw Error('Remove transitions before a range edit.');
   const ripple=op.ripple!==false,span=op.end-op.start;let cutTracks=s.tracks.filter(t=>op.trackIds?op.trackIds.includes(t.id):t.targeted||ripple&&t.syncLocked);if(op.trackIds){const links=new Set(cutTracks.flatMap(t=>t.items.filter(i=>end(i)>op.start&&seconds(i.start)<op.end).map(i=>i.linkGroupId).filter(Boolean)));cutTracks=s.tracks.filter(t=>cutTracks.includes(t)||t.items.some(i=>links.has(i.linkGroupId)));}if(op.trackIds?.some(id=>!s.tracks.some(t=>t.id===id)))throw Error('Unknown affected track ID.');if(!cutTracks.length)throw Error('Target a track before a range edit.');
   if(cutTracks.some(t=>t.adjustments?.length))throw Error('Remove or exclude adjustment layers before a range edit.');
   const affected=cutTracks.filter(t=>t.items.some(i=>end(i)>op.start));writable(affected);const rightLinks=new Map();
   for(const t of cutTracks){const result=[];for(const item of t.items){const a=seconds(item.start),b=end(item);
     if(b<=op.start){result.push(item);continue;}if(a>=op.end){if(ripple)item.start=subtractTime(item.start,T(span));result.push(item);continue;}
     const keep=(from,to,start,right)=>{if((to-from)*item.speed<.01)return;const part=structuredClone(item);Object.assign(part,sourceSlice(item,from-a,to-a));part.start=T(start);part.duration=duration(part);sliceKeyframes(part,from-a,to-a);native(part);delete part.videoItemId;
       if(right){part.id=allocateId();if(part.linkGroupId){if(!rightLinks.has(part.linkGroupId))rightLinks.set(part.linkGroupId,allocateId());part.linkGroupId=rightLinks.get(part.linkGroupId);}}result.push(part);};
     if(a<op.start)keep(a,op.start,a,false);if(b>op.end)keep(op.end,b,ripple?op.start:op.end,a<op.start);
   }t.items=result;}
   // Rebind surviving companions; split fragments use shared link groups.
   for(const {track:t,item:i}of all())if(t.kind==='audio'&&i.linkGroupId){const v=all().find(e=>e.track.kind==='video'&&e.item.linkGroupId===i.linkGroupId&&e.item.assetId===i.assetId);if(cutTracks.includes(t)||i.origin==='companion'&&(!v||i.videoItemId!==v.item.id)){writable([t]);if(v){i.origin='companion';i.videoItemId=v.item.id;}else{native(i);delete i.videoItemId;}}}
   if(op.captionPolicy==='retime'||op.captionPolicy===undefined&&ripple)s.captions=retimeCut(s.captions,op.start,op.end,ripple,allocateId);if(s.graphics&&op.graphicPolicy==='retime')s.graphics=retimeCut(s.graphics,op.start,op.end,ripple,allocateId).map((g,order)=>({...g,order}));if(ripple){const map=v=>v<=op.start?v:v>=op.end?v-span:op.start;s.markers=s.markers.filter(m=>seconds(m.time)<op.start||seconds(m.time)>=op.end).map(m=>({...m,time:T(map(seconds(m.time)))}));if(s.exportRange){const a=map(seconds(s.exportRange.start)),b=map(seconds(s.exportRange.end));s.exportRange=b-a>=.01?{start:T(a),end:T(b)}:null;}}
   return true;
 }
 if(op.type==='sequence_transition'){
   finite(op.seconds,0,2);const {entry}=selected(),{item:left,track:t}=entry;if(t.kind!=='video')throw Error('Select an outgoing video item.');
   const old=s.transitions.find(x=>x.leftItemId===left.id),sorted=[...t.items].sort((a,b)=>seconds(a.start)-seconds(b.start)),right=old?t.items.find(i=>i.id===old.rightItemId):sorted[sorted.indexOf(left)+1];
   if(!right){if(op.seconds===0)return true;throw Error('A transition needs a following video item.');}
   if(op.seconds&&op.seconds>=Math.min(seconds(left.duration),seconds(right.duration))-.01)throw Error('Transition must leave non-overlapping media on both items.');
   const previous=old?seconds(old.duration):0;if(Math.abs(end(left)-seconds(right.start)-previous)>1e-8)throw Error('Transition requires adjacent clips.');
   const suffix=sorted.slice(sorted.indexOf(right)),linkedIds=new Set(suffix.map(i=>i.linkGroupId).filter(Boolean)),affected=all().filter(e=>suffix.includes(e.item)||linkedIds.has(e.item.linkGroupId));writable([t,...affected.map(e=>e.track)]);
   const shift=T(previous-op.seconds);for(const {item:i}of affected)i.start=addTime(i.start,shift);
   s.transitions=s.transitions.filter(x=>x!==old);if(op.seconds)s.transitions.push({id:old?.id||allocateId(),trackId:t.id,leftItemId:left.id,rightItemId:right.id,type:op.kind||old?.type||'cross_dissolve',duration:T(op.seconds),alignment:'legacy-overlap',audio:'crossfade'});return true;
 }
 return false;
}
