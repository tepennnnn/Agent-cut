import {applyTextOperation} from './text-operations.mjs';
import {applySelectionOperation} from './selection-operations.mjs';
import {applySelectionNesting} from './selection-nesting.mjs';
import {applyLibraryOperation} from './library-operations.mjs';
import {nestedMetadata,synchronizeNestedAssets} from './nesting.mjs';
import {applyAdvancedSequenceOperation} from './sequence-edits.mjs';

import {validateV2,timeFromSeconds,addTime,subtractTime,divideTime} from './sequences.mjs';

import {validateOperation,v2OperationTypes} from './operations.mjs';

import {EditError} from './engine.mjs';

const label=value=>{if(typeof value!=='string'||!value.trim()||value.length>80||value.includes('\0'))throw Error('Name must contain 1–80 characters.');return value;};

export function applySequenceOperations(project,operations,{allocateId,validateFinal=true}={}){

 if(!Array.isArray(operations)||!operations.length||operations.length>200)throw new EditError('INVALID_ARGUMENT','Supply 1–200 operations.');

 const q=structuredClone(project);

 const creationId=op=>{if(op.newId===undefined)return allocateId();if(!/^[a-f0-9]{64}$/.test(op.newId))throw Error('newId must be a unique lowercase SHA256 ID.');const has=value=>value&&typeof value==='object'&&(value.id===op.newId||Object.values(value).some(v=>v&&typeof v==='object'&&has(v)));if(has(q))throw Error('newId already exists in the project.');return op.newId;};
 const sequence=id=>{const s=q.sequences.find(s=>s.id===id);if(!s)throw Error('Unknown sequence ID.');return s;};

 const track=(s,id)=>{const t=s.tracks.find(t=>t.id===id);if(!t)throw Error('Unknown track ID.');return t;};

 const entries=s=>s.tracks.flatMap(t=>t.items.map(item=>({track:t,item})));

 const writable=tracks=>{if(tracks.some(t=>t.locked))throw new EditError('TRACK_LOCKED','Unlock affected tracks before editing.');};

 const groups=(s,entry,linked,includeGroups=false)=>{if(linked===false)return [entry];if(!includeGroups)return entry.item.linkGroupId?entries(s).filter(e=>e.item.linkGroupId===entry.item.linkGroupId):[entry];let selected=[entry];for(let pass=0;pass<64;pass++){const links=new Set(selected.map(e=>e.item.linkGroupId).filter(Boolean)),groupIds=new Set(selected.map(e=>e.item.groupId).filter(Boolean)),next=entries(s).filter(e=>e.item.id===entry.item.id||links.has(e.item.linkGroupId)||groupIds.has(e.item.groupId));if(next.length>200)throw Error('Linked/group selection exceeds 200 items.');if(next.length===selected.length)return next;selected=next;}throw Error('Group/link graph is too complex.');};

 for(const [operationIndex,op]of operations.entries())try{

   validateOperation(op);if(!v2OperationTypes.has(op.type))throw Error('Operation is not available for v2 projects.');

   if(op.type==='asset_remove'){if(q.sequences.some(s=>s.tracks.some(t=>t.items.some(i=>i.assetId===op.assetId))))throw Error('Lift all uses before removing an asset.');if(!q.assets.some(a=>a.id===op.assetId))throw Error('Unknown asset.');q.assets=q.assets.filter(a=>a.id!==op.assetId);continue;}
   if(op.type==='sequence_nest'){sequence(op.sequenceId);const meta=nestedMetadata(q,op.sourceSequenceId);let asset=q.assets.find(a=>a.kind==='sequence'&&a.sequenceId===op.sourceSequenceId);if(!asset){asset={id:allocateId(),kind:'sequence',sequenceId:op.sourceSequenceId,name:label(sequence(op.sourceSequenceId).name),...meta};q.assets.push(asset);}else Object.assign(asset,meta);Object.assign(q,applySequenceOperations(q,[{type:'item_add',sequenceId:op.sequenceId,trackId:op.trackId,assetId:asset.id,time:op.time,includeAudio:op.includeAudio!==false}],{allocateId,validateFinal:false}));continue;}
   if(applyLibraryOperation(q,op,{allocateId,label}))continue;
   if(op.type==='project_rename'){if(!op.title.trim()||op.title.length>120)throw Error('Title must contain 1-120 characters.');q.title=op.title;continue;}

   if(op.type==='sequence_create'){const template=sequence(q.activeSequenceId);q.sequences.push({id:creationId(op),name:label(op.name),canvas:structuredClone(template.canvas),timebase:structuredClone(template.timebase),tracks:[],transitions:[],captions:[],markers:[],exportRange:null});continue;}

   if(op.type==='sequence_select'){sequence(op.sequenceId);q.activeSequenceId=op.sequenceId;continue;}

   const s=sequence(op.sequenceId);

   if(applyTextOperation({s,op,allocateId}))continue;
   if(applySelectionOperation({s,op,allocateId,writable}))continue;
   if(applySelectionNesting({q,s,op,allocateId,writable,groups,label}))continue;
   if(applyAdvancedSequenceOperation({q,s,op,allocateId,track,entries,writable,groups,label}))continue;

   if(op.type==='item_add'){

     const t=track(s,op.trackId),a=q.assets.find(a=>a.id===op.assetId);if(a?.kind==='sequence')Object.assign(a,nestedMetadata(q,a.sequenceId));writable([t]);if(t.role==='adjustment')throw Error('Use a media track for placement.');if(!a||t.kind==='video'&&a.kind==='audio'||t.kind==='audio'&&!a.hasAudio)throw Error('Asset cannot populate the destination track.');

     const sourceIn=op.sourceIn??0,speed=op.speed??1,volume=op.volume??1,sourceOut=op.timelineOut!==undefined?sourceIn+(op.timelineOut-op.time)*speed:op.sourceOut??a.duration;if(op.timelineOut!==undefined&&op.sourceOut!==undefined)throw Error('Three-point edit takes timelineOut instead of sourceOut.');

     if(!Number.isFinite(op.time)||op.time<0||op.time>7200||!Number.isFinite(sourceIn)||!Number.isFinite(sourceOut)||sourceIn<0||sourceOut<sourceIn+.01||sourceOut>a.duration||!Number.isFinite(speed)||speed<.25||speed>4||!Number.isFinite(volume)||volume<0||volume>2)throw Error('Invalid placement time, source range, speed or volume.');

     if(t.kind==='audio'&&(op.audioTrackId!==undefined||op.includeAudio!==undefined))throw Error('Audio placement does not take linked-video audio options.');

     if(op.audioTrackId!==undefined&&(op.includeAudio===false||!a.hasAudio))throw Error('Audio destination requires linked audio.');

     if(op.mode&&op.mode!=='place'){

       const span=(sourceOut-sourceIn)/speed;

       if(op.mode==='insert')applyAdvancedSequenceOperation({q,s,op:{type:'sequence_insert_gap',sequenceId:s.id,time:op.time,duration:span,captionPolicy:op.captionPolicy,graphicPolicy:op.graphicPolicy,trackIds:[t.id,...(op.audioTrackId?[op.audioTrackId]:[])]},allocateId,track,entries,writable,groups,label});

       else{const targets=[t.id];if(t.kind==='video'&&op.includeAudio!==false&&a.hasAudio&&op.audioTrackId)targets.push(op.audioTrackId);applyAdvancedSequenceOperation({q,s,op:{type:'sequence_remove_range',sequenceId:s.id,start:op.time,end:op.time+span,ripple:false,captionPolicy:op.captionPolicy,graphicPolicy:op.graphicPolicy,trackIds:targets},allocateId,track,entries,writable,groups,label});}

     }

     const item={id:creationId(op),assetId:a.id,start:timeFromSeconds(op.time),duration:divideTime(subtractTime(timeFromSeconds(sourceOut),timeFromSeconds(sourceIn)),timeFromSeconds(speed)),sourceIn,sourceOut,speed,volume,effects:{},origin:'native'};t.items.push(item);

     if(t.kind==='video'&&a.hasAudio&&op.includeAudio!==false){

       let audio;if(op.audioTrackId){audio=track(s,op.audioTrackId);if(audio.kind!=='audio')throw Error('Linked audio requires an audio track.');writable([audio]);}else{audio={id:allocateId(),kind:'audio',name:label(('Audio: '+t.name).slice(0,80)),role:'native',locked:false,muted:false,solo:false,targeted:false,syncLocked:true,items:[]};s.tracks.push(audio);}

       item.linkGroupId=allocateId();audio.items.push({...structuredClone(item),id:allocateId(),origin:'companion',videoItemId:item.id});

     }continue;

   }

   if(op.type==='track_add'){const index=op.index??s.tracks.length;if(!Number.isInteger(index)||index<0||index>s.tracks.length)throw Error('Invalid track insertion index.');s.tracks.splice(index,0,{id:creationId(op),name:label(op.name),kind:op.kind,role:'native',locked:false,muted:false,solo:false,targeted:false,syncLocked:true,items:[]});continue;}

   if(op.type==='track_update'){const t=track(s,op.trackId);if(op.name!==undefined)t.name=label(op.name);for(const key of ['locked','muted','solo','targeted','syncLocked'])if(op[key]!==undefined)t[key]=op[key];continue;}

   if(op.type==='sequence_clear'){writable(s.tracks);s.tracks.forEach(t=>{t.items=[];delete t.adjustments;});s.transitions=[];s.captions=[];if(s.graphics)s.graphics=[];s.markers=[];s.exportRange=null;continue;}

   let selected;

   if(op.type==='track_delete'){const t=track(s,op.trackId);writable([t]);if((t.items.length||t.adjustments?.length)&&!op.allowNonEmpty)throw Error('Track is populated; allowNonEmpty is required.');selected=t.items.map(item=>({track:t,item}));}

   else{const entry=entries(s).find(e=>e.item.id===op.itemId);if(!entry)throw Error('Unknown item ID.');selected=groups(s,entry,op.linked,true);writable(selected.map(e=>e.track));

     if(op.type==='item_move'){

       if(!Number.isFinite(op.time)||op.time<0||op.time>7200)throw Error('Invalid item start.');const destination=op.trackId?track(s,op.trackId):entry.track;writable([destination]);if(destination.role==='adjustment')throw Error('Use a media track for movement.');if(destination.kind!==entry.track.kind)throw Error('Destination media kind does not match.');

       const delta=subtractTime(timeFromSeconds(op.time),entry.item.start);const ids=new Set(selected.map(e=>e.item.id));if(s.transitions.some(x=>ids.has(x.leftItemId)||ids.has(x.rightItemId)))throw Error('Clear attached transitions before moving items.');

       selected.forEach(e=>e.item.start=addTime(e.item.start,delta));

       if(destination!==entry.track){entry.track.items=entry.track.items.filter(i=>i.id!==entry.item.id);destination.items.push(entry.item);}continue;

     }

   }

   const removed=new Set(selected.map(e=>e.item.id));if(s.transitions.some(x=>removed.has(x.leftItemId)||removed.has(x.rightItemId)))throw Error('Clear attached transitions before lifting/deleting.');

   s.tracks.forEach(t=>t.items=t.items.filter(i=>!removed.has(i.id)));

   for(const e of entries(s))if(e.item.origin==='companion'&&removed.has(e.item.videoItemId)){writable([e.track]);e.item.origin='layer';delete e.item.videoItemId;}

   if(op.type==='track_delete')s.tracks=s.tracks.filter(t=>t.id!==op.trackId);

 }catch(e){throw new EditError(e.code==='TRACK_LOCKED'?'TRACK_LOCKED':'INVALID_OPERATION',e.message,{operationIndex,operationType:op?.type??null});}

 if(validateFinal)try{synchronizeNestedAssets(q);validateV2(q);}catch(e){throw new EditError('INVALID_PROJECT',e.message);}return q;

}

