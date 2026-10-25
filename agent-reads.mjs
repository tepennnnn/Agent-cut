import {createHmac,randomBytes,timingSafeEqual,createHash} from 'node:crypto';
import {canonical,EditError} from './engine.mjs';
import {timeSeconds} from './sequences.mjs';
import {operationRegistry} from './operations.mjs';
const secret=randomBytes(32),fail=(code,message)=>{throw new EditError(code,message);};
const digest=value=>createHash('sha256').update(canonical(value)).digest('hex');
const sign=value=>createHmac('sha256',secret).update(value).digest('base64url');
function decode(cursor){try{if(typeof cursor!=='string'||cursor.length>2048)throw Error();const [body,mac,...rest]=cursor.split('.');if(rest.length||!body||!mac)throw Error();const expected=Buffer.from(sign(body)),actual=Buffer.from(mac);if(actual.length!==expected.length||!timingSafeEqual(actual,expected))throw Error();return JSON.parse(Buffer.from(body,'base64url').toString());}catch{fail('INVALID_CURSOR','Invalid or expired read cursor; start a fresh read.');}}
export function page(records,{context,query,cursor,pageSize=20,maxBytes,assemble}){
 if(!Number.isInteger(pageSize)||pageSize<1||pageSize>100)fail('INVALID_ARGUMENT','Page size must be 1–100.');
 const key=digest(query);let offset=0;
 if(cursor){const c=decode(cursor);if(c.context!==context)fail('STALE_CURSOR','Read state changed; start a fresh read.');if(c.query!==key||!Number.isSafeInteger(c.offset)||c.offset<0||c.offset>records.length)fail('INVALID_CURSOR','Cursor does not match the query.');offset=c.offset;}
 let count=Math.min(pageSize,records.length-offset);
 for(;;){const next=offset+count<records.length?{context,query:key,offset:offset+count}:null,body=next?Buffer.from(JSON.stringify(next)).toString('base64url'):null,result=assemble(records.slice(offset,offset+count),{total:records.length,offset,returned:count,exhausted:!next,nextCursor:body?body+'.'+sign(body):null});
   if(Buffer.byteLength(JSON.stringify(result))<=maxBytes)return result;
   if(count<=1)fail('READ_LIMIT','One record exceeds the read budget; request summary detail or a narrower contract.');count--;
 }
}
export function readProjectView(project,args={}) {
 if(args.expectedProjectId!==undefined&&args.expectedProjectId!==project.projectId)fail('PROJECT_MISMATCH','Read the intended project before inspecting it.');
 if(args.expectedRevision!==undefined&&args.expectedRevision!==project.revision)fail('STALE_REVISION','Project revision changed; read again.');
 const view=args.view||'full';
 if(view==='full'){if(['sequenceId','itemIds','start','end','cursor','pageSize','detail'].some(k=>args[k]!==undefined))fail('INVALID_ARGUMENT','Window filters require view=window.');return project;}
 const seq=project.schemaVersion===2?project.sequences.find(s=>s.id===(args.sequenceId||project.activeSequenceId)):null;
 if(project.schemaVersion===2&&!seq||project.schemaVersion!==2&&args.sequenceId!==undefined)fail('INVALID_ARGUMENT','Unknown sequence ID.');
 const base={view,projectId:project.projectId,revision:project.revision,schemaVersion:project.schemaVersion||1,title:project.title,activeSequenceId:project.activeSequenceId??null,sequenceId:seq?.id??null,canvas:seq?.canvas||project.canvas};
 const records=seq?seq.tracks.flatMap(track=>track.items.map(item=>({item,track}))):[...(project.timeline||[]).map(item=>({item,track:{id:null,kind:'video'}})),...(project.layers||[]).map(item=>({item:{...item,duration:(item.sourceOut-item.sourceIn)/item.speed},track:{id:null,kind:item.kind}}))];
 const seconds=t=>typeof t==='number'?t:timeSeconds(t);
 if(view==='summary') {
   if(['itemIds','start','end','cursor','pageSize','detail'].some(k=>args[k]!==undefined))fail('INVALID_ARGUMENT','Summary does not accept window filters.');
   return {...base,duration:Math.max(0,...records.map(e=>seconds(e.item.start)+seconds(e.item.duration))),counts:{assets:project.assets.length,sequences:project.sequences?.length||1,tracks:seq?.tracks.length??null,items:records.length,captions:(seq?.captions||project.captions||[]).length,graphics:seq?.graphics?.length||0},redoAvailable:project.redoAvailable??false,coverage:'Summary only; request a window for item IDs/timing.'};
 }
 if(view!=='window')fail('INVALID_ARGUMENT','Unknown project read view.');
 const start=args.start??0,end=args.end??7200,detail=args.detail||'summary';if(!Number.isFinite(start)||!Number.isFinite(end)||start<0||end>7200||end<=start||!['summary','full','text'].includes(detail))fail('INVALID_ARGUMENT','Use a non-empty window within 0–7200 seconds.');
 if(detail==='text'){const text=[...(seq?.graphics||[]).map(g=>({...g,kind:'title'})),...(seq?.captions||project.captions||[]).map(c=>({...c,kind:'caption'}))];if(args.itemIds?.some(id=>!text.some(c=>c.id===id)))fail('INVALID_ARGUMENT','Unknown text ID.');const selected=text.filter(c=>seconds(c.start)<end&&seconds(c.end)>start&&(!args.itemIds||args.itemIds.includes(c.id))).map(c=>({...structuredClone(c),start:seconds(c.start),end:seconds(c.end)})),query={sequenceId:seq?.id??null,start,end,detail,itemIds:args.itemIds??null};return page(selected,{context:`project:${project.projectId}:${project.revision}`,query,cursor:args.cursor,pageSize:args.pageSize,maxBytes:16384,assemble:(items,coverage)=>({...base,window:{start,end},detail,captionStyle:seq?.captionStyle||{},captionMotion:seq?.captionMotion||null,items,coverage})});}
 if(args.itemIds&&(!Array.isArray(args.itemIds)||args.itemIds.length<1||args.itemIds.length>200||args.itemIds.some(id=>typeof id!=='string'||!records.some(e=>e.item.id===id))))fail('INVALID_ARGUMENT','Unknown or invalid selected item IDs.');
 const selected=records.filter(({item})=>seconds(item.start)<end&&seconds(item.start)+seconds(item.duration)>start&&(!args.itemIds||args.itemIds.includes(item.id))).map(({item,track})=>detail==='full'?{trackId:track.id,kind:track.kind,...structuredClone(item)}:{id:item.id,trackId:track.id,kind:track.kind,assetId:item.assetId,start:seconds(item.start),duration:seconds(item.duration),sourceIn:item.sourceIn,sourceOut:item.sourceOut,speed:item.speed,volume:item.volume,linkGroupId:item.linkGroupId,groupId:item.groupId,effects:item.effects||{},automationProperties:Object.keys(item.keyframes||{}),reverse:!!item.reverse,frameHold:item.frameHold??null,speedCurvePoints:item.speedCurve?.length||0});
 const query={sequenceId:seq?.id??null,start,end,detail,itemIds:args.itemIds??null};
 return page(selected,{context:`project:${project.projectId}:${project.revision}`,query,cursor:args.cursor,pageSize:args.pageSize,maxBytes:16384,assemble:(items,coverage)=>({...base,window:{start,end},detail,items,coverage})});
}
export function readOperationContracts(args={}) {
 if(!Object.keys(args).length)return {operations:operationRegistry};
 if(args.schemaVersion!==undefined&&![1,2].includes(args.schemaVersion))fail('INVALID_ARGUMENT','Operation version must be 1 or 2.');
 if(args.names&&(!Array.isArray(args.names)||!args.names.length||args.names.length>100||args.names.some(n=>!Object.hasOwn(operationRegistry,n))))fail('INVALID_ARGUMENT','Unknown operation contract name.');
 const entries=Object.entries(operationRegistry).filter(([name,v])=>(!args.names||args.names.includes(name))&&(args.schemaVersion===undefined||v.schemaVersion===args.schemaVersion));
 const version=digest(operationRegistry),query={names:args.names??null,schemaVersion:args.schemaVersion??null};
 return page(entries,{context:'contracts:'+version,query,cursor:args.cursor,pageSize:args.pageSize??5,maxBytes:8192,assemble:(rows,coverage)=>({contractVersion:version,operations:Object.fromEntries(rows),coverage})});
}

export function advertisedTools(tools,compact=false) {
 if(!compact)return tools;
 return tools.map(spec=>{const copy=structuredClone(spec);const strip=value=>{if(!value||typeof value!=='object')return;delete value.description;for(const child of Object.values(value))if(child&&typeof child==='object')strip(child);};strip(copy.inputSchema);copy.description=copy.description.replace(' Supply expectedProjectId from project_read to guard against the wrong project.','');if(copy.annotations?.readOnlyHint===false&&copy.inputSchema.properties.expectedProjectId&&!copy.inputSchema.required.includes('expectedProjectId'))copy.inputSchema.required.push('expectedProjectId');if(copy.inputSchema.properties.operations){copy.inputSchema.properties.operations.items={type:'object',required:['type'],properties:{type:{type:'string',description:'Exact operation name from timeline_operations'}},additionalProperties:true};copy.description+=' Fetch exact edit schemas with timeline_operations; runtime validates.';}if(copy.name==='story_sync'){copy.description='Story/affiliate drafts: art_contract, sync_contract, creator_contract, affiliate_contract. Video: video_prompt_pack/video_import/creator_video_prepare. Sample: transition_sample. Read revision guards.';copy.inputSchema.properties.affiliateOptions={type:'object',additionalProperties:true};copy.inputSchema.properties.action={type:'string'};copy.inputSchema.properties.syncOptions={type:'object',additionalProperties:true};copy.inputSchema.properties.creatorOptions={type:'object',additionalProperties:true};for(const name of Object.keys(copy.inputSchema.properties.artOptions.properties))delete copy.inputSchema.properties[name];copy.inputSchema.properties.artOptions={type:'object',additionalProperties:true};copy.inputSchema.properties.captionStyle={type:'string'};copy.inputSchema.properties.captionFont={type:'string'};copy.inputSchema.properties.transitionKind={type:'string'};}return copy;});
}
