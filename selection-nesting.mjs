import {hasStyledText} from './ui/text-model.js';
import {timeFromSeconds as T,timeSeconds as seconds,subtractTime,addTime} from './sequences.mjs';
import {nestedMetadata,sequenceDuration} from './nesting.mjs';
import {canonical,effectDefaults} from './engine.mjs';

const entries=s=>s.tracks.flatMap(track=>track.items.map(item=>({track,item})));
const end=i=>seconds(i.start)+seconds(i.duration);
const intersects=(start,finish,a,b)=>start<b-1e-8&&finish>a+1e-8;
const flags=(id,name,kind)=>({id,name,kind,role:'native',locked:false,muted:false,solo:false,targeted:true,syncLocked:true,items:[]});
function isolated(s,ids,start,finish) {
 if(entries(s).some(e=>!ids.has(e.item.id)&&intersects(seconds(e.item.start),end(e.item),start,finish)))
   throw Error('Select every media item playing in the nesting interval, including other tracks.');
 if(s.tracks.some(t=>t.adjustments?.some(a=>intersects(seconds(a.start),seconds(a.end),start,finish))))
   throw Error('Selection nesting cannot cross adjustment spans.');
 if(s.tracks.some(t=>t.solo||t.ducking))throw Error('Disable solo and ducking before selection nesting or expansion.');
}
const native=item=>{item.origin='native';delete item.originIndex;delete item.legacyTransitionOutZero;};

export function applySelectionNesting({q,s,op,allocateId,writable,groups,label}) {
 if(['sequence_nest_selection','sequence_unnest'].includes(op.type)&&(hasStyledText(s)||op.type==='sequence_unnest'&&q.sequences.some(seq=>hasStyledText(seq))))throw Error('Styled text cannot be structurally nested/expanded; use a live sequence source or remove styling first.');
 if(op.type==='sequence_nest_selection') {
   const all=entries(s),chosen=new Map();
   for(const id of op.itemIds) {
     const entry=all.find(e=>e.item.id===id);if(!entry)throw Error('Unknown selected media item.');
     for(const e of groups(s,entry,true,true))chosen.set(e.item.id,e);
   }
   const selected=[...chosen.values()],ids=new Set(chosen.keys());
   if(!selected.length||selected.length>200||!selected.some(e=>e.track.kind==='video'))throw Error('Nest 1–200 items including video; linked and grouped media are included.');
   writable(selected.map(e=>e.track));if(selected.some(e=>e.track.muted))throw Error('Unmute selected tracks before nesting.');
   if(selected.some(e=>e.track.audioMix&&Object.keys(e.track.audioMix).length))throw Error('Clear participating track audio processors before selection nesting; clip processors are preserved.');
   const start=Math.min(...selected.map(e=>seconds(e.item.start))),finish=Math.max(...selected.map(e=>end(e.item)));
   isolated(s,ids,start,finish);
   if(s.transitions.some(x=>ids.has(x.leftItemId)!==ids.has(x.rightItemId)))throw Error('Select both sides of every participating transition.');
   const movedCaptions=s.captions.filter(c=>intersects(seconds(c.start),seconds(c.end),start,finish));
   if(movedCaptions.some(c=>seconds(c.start)<start-1e-8||seconds(c.end)>finish+1e-8))throw Error('A caption crosses the selection boundary; split or move it first.');
   const participating=s.tracks.filter(t=>t.items.some(i=>ids.has(i.id))),offset=T(start),childId=allocateId(),trackMap=[];
   const child={id:childId,name:label(op.name),canvas:structuredClone(s.canvas),timebase:structuredClone(s.timebase),tracks:[],transitions:[],captions:[],markers:[],exportRange:null};
   for(const t of participating) {
     const clone=structuredClone(t);clone.id=allocateId();clone.items=clone.items.filter(i=>ids.has(i.id));delete clone.adjustments;
     for(const i of clone.items){i.start=subtractTime(i.start,offset);if(i.origin!=='companion')native(i);}
     child.tracks.push(clone);trackMap.push({childTrackId:clone.id,parentTrackId:t.id});
   }
   child.transitions=s.transitions.filter(x=>ids.has(x.leftItemId)).map(x=>({...structuredClone(x),trackId:trackMap.find(m=>m.parentTrackId===x.trackId).childTrackId}));
   child.captions=movedCaptions.map(c=>({...structuredClone(c),start:subtractTime(c.start,offset),end:subtractTime(c.end,offset)}));
   const movedMarkers=s.markers.filter(m=>seconds(m.time)>=start&&seconds(m.time)<finish);
   child.markers=movedMarkers.map(m=>({...structuredClone(m),time:subtractTime(m.time,offset)}));
   child.nestLayout={parentSequenceId:s.id,trackMap};q.sequences.push(child);
   const asset={id:allocateId(),kind:'sequence',sequenceId:child.id,name:child.name,...nestedMetadata(q,child.id)};q.assets.push(asset);
   for(const t of s.tracks)t.items=t.items.filter(i=>!ids.has(i.id));
   s.transitions=s.transitions.filter(x=>!ids.has(x.leftItemId));s.captions=s.captions.filter(c=>!movedCaptions.includes(c));s.markers=s.markers.filter(m=>!movedMarkers.includes(m));
   const videoTrack=flags(allocateId(),child.name+' video','video'),linkGroupId=allocateId();
   const video={id:allocateId(),assetId:asset.id,start:offset,duration:T(asset.duration),sourceIn:0,sourceOut:asset.duration,speed:1,volume:1,effects:{},origin:'native',linkGroupId};videoTrack.items.push(video);s.tracks.push(videoTrack);
   if(selected.some(e=>e.track.kind==='audio')) {
     const audioTrack=flags(allocateId(),child.name+' audio','audio');audioTrack.items.push({...structuredClone(video),id:allocateId(),origin:'companion',videoItemId:video.id});s.tracks.push(audioTrack);
   }
   return true;
 }
 if(op.type!=='sequence_unnest')return false;
 const all=entries(s),entry=all.find(e=>e.item.id===op.itemId),asset=q.assets.find(a=>a.id===entry?.item.assetId),child=q.sequences.find(seq=>seq.id===asset?.sequenceId);
 if(entry?.track.kind!=='video'||asset?.kind!=='sequence'||!child?.nestLayout||child.nestLayout.parentSequenceId!==s.id)throw Error('Expand a selection nest in its original parent sequence.');
 const wrappers=entry.item.linkGroupId?all.filter(e=>e.item.linkGroupId===entry.item.linkGroupId):[entry],span=sequenceDuration(child),start=seconds(entry.item.start);
 if(wrappers.length!==1+(child.tracks.some(t=>t.kind==='audio'&&t.items.length)?1:0)||wrappers.filter(e=>e.track.kind==='video').length!==1)throw Error('The nest requires its original linked video/audio wrappers.');
 for(const {item:i,track:t}of wrappers) {
   if(i.assetId!==asset.id||Math.abs(seconds(i.start)-start)>1e-8||Math.abs(seconds(i.duration)-span)>1e-8||i.sourceIn!==0||Math.abs(i.sourceOut-span)>1e-8||i.speed!==1||i.volume!==1||i.reverse||i.frameHold||i.speedCurve||i.mask||i.blendMode&&i.blendMode!=='normal'||i.keyframes&&Object.keys(i.keyframes).length||i.audio&&Object.keys(i.audio).length||i.groupId||Object.entries(i.effects||{}).some(([k,v])=>v!==effectDefaults[k])||t.muted||t.audioMix&&Object.keys(t.audioMix).length)
     throw Error('Expansion requires full-length, unprocessed linked nest items; restore their timing/effects/mix first.');
 }
 const wrapperIds=new Set(wrappers.map(e=>e.item.id));isolated(s,wrapperIds,start,start+span);
 if(s.transitions.some(x=>wrapperIds.has(x.leftItemId)||wrapperIds.has(x.rightItemId)))throw Error('Remove attached transitions before expanding a nest.');
 if(canonical(child.canvas)!==canonical(s.canvas)||canonical(child.timebase)!==canonical(s.timebase))throw Error('Match child and parent canvas/timebase before expansion.');
 const layout=child.nestLayout.trackMap;if(!Array.isArray(layout)||layout.length!==child.tracks.length||new Set(layout.map(m=>m.childTrackId)).size!==layout.length||new Set(layout.map(m=>m.parentTrackId)).size!==layout.length)throw Error('The original nesting track layout is unavailable.');
 const destinations=new Map();
 for(const t of child.tracks) {
   const mapping=layout.find(m=>m.childTrackId===t.id),parent=s.tracks.find(t=>t.id===mapping?.parentTrackId);if(!parent||parent.kind!==t.kind)throw Error('Restore the original destination tracks before expansion.');
   if(t.adjustments?.length||t.ducking||t.muted||t.solo||parent.muted||canonical(t.audioMix)!==canonical(parent.audioMix))throw Error('Expansion requires matching unmuted source/destination track mixes and no child adjustment spans.');
   destinations.set(t.id,parent);
 }
 writable([...wrappers.map(e=>e.track),...destinations.values()]);
 const itemIds=new Map(entries(child).map(e=>[e.item.id,allocateId()])),links=new Map(),groupIds=new Map(),offset=T(start);
 for(const {track,item}of entries(child)) {
   const clone=structuredClone(item);clone.id=itemIds.get(item.id);clone.start=addTime(clone.start,offset);
   for(const [key,map]of [['linkGroupId',links],['groupId',groupIds]])if(clone[key]){if(!map.has(clone[key]))map.set(clone[key],allocateId());clone[key]=map.get(clone[key]);}
   if(clone.origin==='companion')clone.videoItemId=itemIds.get(clone.videoItemId);else native(clone);
   destinations.get(track.id).items.push(clone);
 }
 s.transitions.push(...child.transitions.map(x=>({...structuredClone(x),id:allocateId(),trackId:destinations.get(x.trackId).id,leftItemId:itemIds.get(x.leftItemId),rightItemId:itemIds.get(x.rightItemId)})));
 s.captions.push(...child.captions.map(c=>({...structuredClone(c),id:allocateId(),start:addTime(c.start,offset),end:addTime(c.end,offset)})));
 s.markers.push(...child.markers.map(m=>({...structuredClone(m),id:allocateId(),time:addTime(m.time,offset)})));
 for(const t of s.tracks)t.items=t.items.filter(i=>!wrapperIds.has(i.id));
 // Keep the source sequence and library reference: other instances may use it.
 return true;
}
