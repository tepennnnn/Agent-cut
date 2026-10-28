import {pairResourceSnapshot} from './gl-renderer.mjs';
import {validateRecipeSources,readRecipeReview,validateRecipeBinding} from './recipe-provenance.mjs';
import {textFontSnapshot} from './text-fonts.mjs';
import {hasStyledText} from './ui/text-model.js';
import {JobService} from './job-service.mjs';
import {checkJob,jobContext} from './job-context.mjs';
import {remapTimestampExpression} from './time-remap.mjs';
import {parseSubtitles} from './subtitles.mjs';
import {audioProcessingFilter} from './audio-processing.mjs';
import {normalizeExport,transcodeExport} from './export-options.mjs';
import {maskFilter} from './masks.mjs';
import {keyframeExpression} from './keyframes.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import {validateOperation,operationRegistry,operationIsDestructive} from './operations.mjs';
import {validateV2,timeSeconds,migrationPreview,timeFromSeconds} from './sequences.mjs';
import {applySequenceOperations} from './sequence-operations.mjs';

export const clone = v => structuredClone(v);
export class EditError extends Error {
  constructor(code,message,details={}) {super(message);this.name='EditError';this.code=code;this.details=details;}
}
export const errorResult = e => ({code:e instanceof EditError?e.code:'OPERATION_FAILED',message:e.message,details:e instanceof EditError?e.details:{}});
export const canonical = value => JSON.stringify(value,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
export function projectDiff(before,after) {
  const changes=[];
  const visit=(a,b,p)=>{
    if(canonical(a)===canonical(b))return;
    if(a&&b&&typeof a==='object'&&typeof b==='object'&&!Array.isArray(a)&&!Array.isArray(b)){
      for(const key of [...new Set([...Object.keys(a),...Object.keys(b)])].sort())visit(a[key],b[key],p+'/'+key.replaceAll('~','~0').replaceAll('/','~1'));
    }else changes.push({path:p,kind:a===undefined?'add':b===undefined?'remove':'replace',...(a===undefined?{}:{before:clone(a)}),...(b===undefined?{}:{after:clone(b)})});
  };
  visit(before,after,'');return changes;
}
const id = () => randomUUID();
const num = (v, lo, hi, name) => { if (typeof v !== 'number' || !Number.isFinite(v) || v < lo || v > hi) throw Error(`${name} must be ${lo}â€“${hi}.`); return v; };
const text = (v, max, name) => { if (typeof v !== 'string' || !v.trim() || v.length > max || v.includes('\0')) throw Error(`Invalid ${name}.`); return v; };
export const duration = c => c.speedCurve?.at(-1).time ?? (c.sourceOut - c.sourceIn) / c.speed;
export function timeline(p) {
  if(p.schemaVersion===2){const s=p.sequences.find(s=>s.id===p.activeSequenceId);return s.tracks.flatMap(t=>t.items.map(i=>({...i,start:timeSeconds(i.start),end:timeSeconds(i.start)+timeSeconds(i.duration),duration:timeSeconds(i.duration),trackId:t.id,kind:t.kind,assetName:p.assets.find(a=>a.id===i.assetId)?.name}))).sort((a,b)=>a.start-b.start);}
  let start = 0;
  return p.clips.map(c => { const result = {...c, start, end: start + duration(c), duration: duration(c), assetName:p.assets.find(a=>a.id===c.assetId)?.name}; start = result.end-(c.transitionOut||0); return result; });
}
export const effectDefaults={brightness:0,contrast:1,saturation:1,scale:1,rotation:0,offsetX:0,offsetY:0,cropLeft:0,cropRight:0,cropTop:0,cropBottom:0,flipH:false,flipV:false,fadeIn:0,fadeOut:0,audioFadeIn:0,audioFadeOut:0,opacity:1};
export function effectsCheck(values,seconds) {
  if(!values||typeof values!=='object'||Array.isArray(values))throw Error('Effects must be an object.');
  for(const [k,v]of Object.entries(values)) {
    if(!(k in effectDefaults))throw Error('Unknown effect '+k);
    if(k==='flipH'||k==='flipV'){if(typeof v!=='boolean')throw Error(k+' must be a boolean.');continue;}
    const bounds={brightness:[-.5,.5],contrast:[.5,2],saturation:[0,2],scale:[.25,4],rotation:[-180,180],offsetX:[-1,1],offsetY:[-1,1],opacity:[0,1]};
    num(v,...(bounds[k]||(k.startsWith('crop')?[0,.45]:[0,Math.min(10,seconds)])),k);
  }
  const e={...effectDefaults,...values};
  if(e.fadeIn+e.fadeOut>seconds+.001||e.audioFadeIn+e.audioFadeOut>seconds+.001)throw Error('Fades must fit within the clip duration.');
}
export function validate(p) {
  if(p.schemaVersion===2)return validateV2(p);
  if(p.schemaVersion!==undefined&&p.schemaVersion!==1)throw new EditError('UNSUPPORTED_VERSION','Unsupported project schema version.');
  text(p.title, 120, 'title');
  for (const [k,lo,hi] of [['width',160,3840],['height',160,2160],['fps',12,60]]) { num(p.canvas[k],lo,hi,k); if(!Number.isInteger(p.canvas[k])) throw Error(`${k} must be an integer.`); }
  if (p.canvas.width % 2 || p.canvas.height % 2) throw Error('Canvas dimensions must be even.');
  if(p.captionStyle!==undefined||p.graphics!==undefined||p.captions.some(c=>c.style!==undefined))throw Error('Styled text requires a v2 sequence; review migration first.');
  if(p.clips.length>500 || p.assets.length>500 || p.captions.length>500) throw Error('Maximum 500 assets, clips or captions.');
  const ids = new Set();
  for (const [index,c] of p.clips.entries()) {
    if(c.speedCurve!==undefined)throw Error('Speed curves require a v2 project.');
    if (ids.has(c.id)) throw Error('Duplicate clip ID.'); ids.add(c.id);
    const a = p.assets.find(a=>a.id===c.assetId); if(!a) throw Error('Unknown asset.');if(a.kind==='audio')throw Error('Audio assets belong on audio layers.');
    num(c.sourceIn,0,a.duration,'sourceIn'); num(c.sourceOut,c.sourceIn+.01,a.duration+.001,'sourceOut');
    num(c.speed,.25,4,'speed'); num(c.volume,0,2,'volume');
    effectsCheck(c.effects||{},duration(c));
    const dissolve=c.transitionOut||0;num(dissolve,0,2,'transition');
    if(dissolve && index===p.clips.length-1)throw Error('The last clip cannot have an outgoing transition.');
    if(dissolve && dissolve>=Math.min(duration(c),duration(p.clips[index+1]))-.01)throw Error('Transition exceeds adjacent clip duration.');
    if((p.clips[index-1]?.transitionOut||0)+dissolve>=duration(c)-.009)throw Error('Adjacent transitions consume the entire clip.');
  }
  const total = timeline(p).at(-1)?.end || 0;
  if(total>7200) throw Error('This version supports timelines up to two hours.');
  for(const c of p.captions) { text(c.text,1000,'caption'); num(c.start,0,total,'caption start'); num(c.end,c.start+.01,total+.001,'caption end'); }
  const sorted=[...p.captions].sort((a,b)=>a.start-b.start);
  for(let i=1;i<sorted.length;i++) if(sorted[i].start<sorted[i-1].end-.001) throw Error('Caption intervals must not overlap.');
  if((p.layers||[]).length>64||(p.markers||[]).length>500)throw Error('Maximum 64 layers and 500 markers.');
  for(const l of p.layers||[]) {
    if(l.speedCurve!==undefined)throw Error('Speed curves require a v2 project.');
    if(ids.has(l.id))throw Error('Duplicate layer ID.');ids.add(l.id);
    if(!['video','audio'].includes(l.kind))throw Error('Invalid layer kind.');
    const a=p.assets.find(a=>a.id===l.assetId);if(!a)throw Error('Unknown layer asset.');
    if(l.kind==='video'&&a.kind==='audio'||l.kind==='audio'&&!a.hasAudio)throw Error('Asset does not support this layer kind.');
    num(l.sourceIn,0,a.duration,'layer sourceIn');num(l.sourceOut,l.sourceIn+.01,a.duration+.001,'layer sourceOut');num(l.speed,.25,4,'layer speed');num(l.volume,0,2,'layer volume');num(l.start,0,total,'layer start');
    num(l.track,1,8,'track');if(!Number.isInteger(l.track))throw Error('Track must be an integer.');
    if(l.start+duration(l)>total+.001)throw Error('Layer extends beyond the main timeline.');effectsCheck(l.effects||{},duration(l));
  }
  const layers=[...(p.layers||[])].sort((a,b)=>a.start-b.start);
  for(let i=0;i<layers.length;i++)for(let j=i+1;j<layers.length;j++)if(layers[i].kind===layers[j].kind&&layers[i].track===layers[j].track&&layers[j].start<layers[i].start+duration(layers[i])-.001)throw Error('Items on the same layer track must not overlap.');
  for(const m of p.markers||[]){text(m.label,120,'marker label');num(m.time,0,total,'marker time');}
  if(p.exportRange){num(p.exportRange.start,0,total,'range start');num(p.exportRange.end,p.exportRange.start+.01,total+.001,'range end');}
}
export function apply(p, operations, {allocateId=id}={}) {
  if(p.schemaVersion===2)return applySequenceOperations(p,operations,{allocateId});
  if(!Array.isArray(operations)||!operations.length||operations.length>200) throw new EditError('INVALID_ARGUMENT','Supply 1â€“200 operations.');
  const q=clone(p);
  const clip = key => {const c=q.clips.find(c=>c.id===key);if(!c)throw Error('Unknown clip ID. Read the project again.');return c;};
  for(const [operationIndex,op] of operations.entries()) {
    try {
    validateOperation(op);
    switch(op.type) {
      case 'rename': q.title=text(op.title,120,'title'); break;
      case 'canvas': q.canvas={width:op.width,height:op.height,fps:op.fps}; break;
      case 'append': {
        const a=q.assets.find(a=>a.id===op.assetId);if(!a)throw Error('Unknown asset ID.');
        q.clips.push({id:allocateId(),assetId:a.id,sourceIn:op.sourceIn??0,sourceOut:op.sourceOut??a.duration,speed:1,volume:1}); break;
      }
      case 'trim': {const c=clip(op.clipId); c.sourceIn=op.sourceIn;c.sourceOut=op.sourceOut;break;}
      case 'insert': {
        if(q.clips.some(c=>c.transitionOut))throw Error('Clear dissolves before inserting.');
        const a=q.assets.find(a=>a.id===op.assetId);if(!a||a.kind==='audio')throw Error('Insert requires a video asset.');
        const sourceIn=num(op.sourceIn??0,0,a.duration,'sourceIn'),sourceOut=num(op.sourceOut??a.duration,sourceIn+.01,a.duration,'sourceOut');
        const at=num(op.time,0,timeline(q).at(-1)?.end||0,'time'),added=sourceOut-sourceIn;
        const inserted={id:allocateId(),assetId:a.id,sourceIn,sourceOut,speed:1,volume:1};
        const positioned=timeline(q),index=positioned.findIndex(c=>at<c.end);
        if(index<0)q.clips.push(inserted);
        else if(at===positioned[index].start)q.clips.splice(index,0,inserted);
        else {
          const c=q.clips[index],offset=num(at-positioned[index].start,.01,duration(c)-.01,'split offset'),cut=c.sourceIn+offset*c.speed;
          const right={...clone(c),id:allocateId(),sourceIn:cut,effects:{...c.effects,fadeIn:0,audioFadeIn:0}};
          c.sourceOut=cut;c.effects={...c.effects,fadeOut:0,audioFadeOut:0};q.clips.splice(index+1,0,inserted,right);
        }
        q.captions=q.captions.flatMap(c=>c.start>=at?[{...c,start:c.start+added,end:c.end+added}]:c.end<=at?[c]:[{...c,end:at},{...c,id:allocateId(),start:at+added,end:c.end+added}]);
        q.layers=(q.layers||[]).flatMap(l=>{
          if(l.start>=at)return [{...l,start:l.start+added}];if(l.start+duration(l)<=at)return [l];
          const cut=l.sourceIn+(at-l.start)*l.speed;
          return [{...l,sourceOut:cut,effects:{...l.effects,fadeOut:0,audioFadeOut:0}},{...l,id:allocateId(),start:at+added,sourceIn:cut,effects:{...l.effects,fadeIn:0,audioFadeIn:0}}];
        });
        q.markers=(q.markers||[]).map(m=>({...m,time:m.time>=at?m.time+added:m.time}));
        if(q.exportRange)q.exportRange={start:q.exportRange.start>=at?q.exportRange.start+added:q.exportRange.start,end:q.exportRange.end>at?q.exportRange.end+added:q.exportRange.end};
        break;
      }
      case 'speed': clip(op.clipId).speed=num(op.speed,.25,4,'speed');break;
      case 'rate_stretch': {const c=clip(op.clipId);num(op.duration,Number.MIN_VALUE,28800,'duration');c.speed=num((c.sourceOut-c.sourceIn)/op.duration,.25,4,'speed');break;}
      case 'volume': clip(op.clipId).volume=num(op.volume,0,2,'volume');break;
      case 'split': {
        const c=clip(op.clipId),at=num(op.offset,.01,duration(c)-.01,'offset');
        const right={...c,id:allocateId(),sourceIn:c.sourceIn+at*c.speed,effects:{...c.effects,fadeIn:0,audioFadeIn:0}};c.sourceOut=right.sourceIn;c.transitionOut=0;c.effects={...c.effects,fadeOut:0,audioFadeOut:0};
        q.clips.splice(q.clips.indexOf(c)+1,0,right);break;
      }
      case 'move': {
        const c=clip(op.clipId); num(op.index,0,q.clips.length-1,'index');if(!Number.isInteger(op.index))throw Error('Index must be an integer.');
        q.clips.splice(q.clips.indexOf(c),1);q.clips.splice(op.index,0,c);break;
      }
      case 'delete': q.clips.splice(q.clips.indexOf(clip(op.clipId)),1);if(q.clips.length)q.clips.at(-1).transitionOut=0;break;
      case 'effects': {const c=clip(op.clipId);effectsCheck(op.values,duration(c));c.effects={...c.effects,...op.values};break;}
      case 'transition': clip(op.clipId).transitionOut=num(op.seconds,0,2,'transition seconds');break;
      case 'slip': {const c=clip(op.clipId);num(op.delta,-7200,7200,'delta');c.sourceIn+=op.delta;c.sourceOut+=op.delta;break;}
      case 'roll': {const c=clip(op.clipId),next=q.clips[q.clips.indexOf(c)+1];if(!next)throw Error('Rolling edit requires a following clip.');if(c.transitionOut)throw Error('Clear the dissolve before rolling this boundary.');num(op.delta,-7200,7200,'delta');c.sourceOut+=op.delta*c.speed;next.sourceIn+=op.delta*next.speed;break;}
      case 'duplicate': {const c=clip(op.clipId),index=op.index??q.clips.indexOf(c)+1;num(index,0,q.clips.length,'index');if(!Number.isInteger(index))throw Error('Index must be an integer.');q.clips.splice(index,0,{...clone(c),id:allocateId(),transitionOut:0});break;}
      case 'slide': {
        const c=clip(op.clipId),index=q.clips.indexOf(c),previous=q.clips[index-1],next=q.clips[index+1];
        if(!previous||!next)throw Error('Slide requires a preceding and following clip.');
        if([previous,c,next].some(item=>item.transitionOut))throw Error('Clear neighboring dissolves before sliding this clip.');
        num(op.delta,-7200,7200,'delta');previous.sourceOut+=op.delta*previous.speed;next.sourceIn+=op.delta*next.speed;break;
      }
      case 'marker': (q.markers??=[]).push({id:allocateId(),time:op.time,label:text(op.label,120,'marker label')});break;
      case 'delete_marker': {const i=(q.markers||[]).findIndex(m=>m.id===op.markerId);if(i<0)throw Error('Unknown marker.');q.markers.splice(i,1);break;}
      case 'set_range': q.exportRange={start:op.start,end:op.end};break;
      case 'clear_range': q.exportRange=null;break;
      case 'layer_add': (q.layers??=[]).push({id:allocateId(),kind:op.kind,assetId:op.assetId,start:op.start,sourceIn:op.sourceIn,sourceOut:op.sourceOut,track:op.track??1,speed:op.speed??1,volume:op.volume??1,effects:{}});break;
      case 'layer_delete': {const i=(q.layers||[]).findIndex(l=>l.id===op.layerId);if(i<0)throw Error('Unknown layer.');q.layers.splice(i,1);break;}
      case 'layer_update': {const l=(q.layers||[]).find(l=>l.id===op.layerId);if(!l)throw Error('Unknown layer.');for(const k of ['start','sourceIn','sourceOut','track','volume','speed'])if(op[k]!==undefined)l[k]=op[k];if(op.effects!==undefined)l.effects={...l.effects,...op.effects};break;}
      case 'caption': q.captions.push({id:allocateId(),text:text(op.text,1000,'caption'),start:op.start,end:op.end});break;
      case 'delete_caption': { const i=q.captions.findIndex(c=>c.id===op.captionId);if(i<0)throw Error('Unknown caption ID.');q.captions.splice(i,1);break; }
      case 'clear_captions': q.captions=[];break;
      case 'remove_range': {
        if(q.clips.some(c=>c.transitionOut))throw Error('Clear dissolves before ripple deletion.');
        const total=timeline(q).at(-1)?.end||0;
        const from=num(op.start,0,total,'start'),to=num(op.end,from+.01,total,'end'),cut=to-from;
        const kept=[];
        for(const c of timeline(q)) {
          for(const [s,e] of [[c.start,Math.min(c.end,from)],[Math.max(c.start,to),c.end]]) {
            if(e-s>.009) kept.push({...q.clips.find(x=>x.id===c.id),id:allocateId(),sourceIn:c.sourceIn+(s-c.start)*c.speed,sourceOut:c.sourceIn+(e-c.start)*c.speed,effects:{...c.effects,fadeIn:0,fadeOut:0,audioFadeIn:0,audioFadeOut:0}});
          }
        }
        q.clips=kept;
        const shift=t=>t-Math.min(Math.max(t-from,0),cut);
        q.captions=q.captions.map(c=>({...c,start:shift(c.start),end:shift(c.end)})).filter(c=>c.end-c.start>.009);
        q.markers=(q.markers||[]).filter(m=>m.time<from||m.time>=to).map(m=>({...m,time:shift(m.time)}));
        const remaining=[];for(const l of q.layers||[]){for(const [s,e]of [[l.start,Math.min(l.start+duration(l),from)],[Math.max(l.start,to),l.start+duration(l)]])if(e-s>.009)remaining.push({...l,id:allocateId(),start:shift(s),sourceIn:l.sourceIn+(s-l.start)*l.speed,sourceOut:l.sourceIn+(e-l.start)*l.speed,effects:{...l.effects,fadeIn:0,fadeOut:0,audioFadeIn:0,audioFadeOut:0}});}q.layers=remaining;
        if(q.exportRange){q.exportRange={start:shift(q.exportRange.start),end:shift(q.exportRange.end)};if(q.exportRange.end-q.exportRange.start<.01)q.exportRange=null;}
        break;
      }
      case 'clear': q.clips=[];q.captions=[];q.layers=[];q.markers=[];q.exportRange=null;break;
      default: throw Error(`Unknown operation: ${op.type}`);
    }
    }catch(e){throw new EditError('INVALID_OPERATION',e.message,{operationIndex,operationType:op?.type??null});}
  }
  try{validate(q);}catch(e){throw new EditError('INVALID_PROJECT',e.message);}
  return q;
}
export async function atomic(file, value) {
  const tmp=file+'.'+id()+'.tmp';await fs.writeFile(tmp,JSON.stringify(value,null,2));
  try {
    // Windows scanners/readers can briefly deny replacement. Retry the atomic
    // rename only; never unlink the saved destination as a fallback.
    for(let attempt=0;;attempt++)try{await fs.rename(tmp,file);break;}catch(e){
      if(process.platform!=='win32'||!['EPERM','EACCES','EBUSY'].includes(e.code)||attempt>=4)throw e;
      await new Promise(resolve=>setTimeout(resolve,25*(attempt+1)));
    }
  } catch(e) {await fs.rm(tmp,{force:true});throw e;}
}
export async function run(command,args,{cwd,timeout=120000,allowedExitCodes=[0]}={}) {
  const scope=checkJob();
  return new Promise((resolve,reject)=>{
    const p=spawn(command,args,{cwd,windowsHide:true,stdio:['ignore','pipe','pipe'],shell:false});
    if(p.pid)scope?.onSpawn?.(p.pid);let out='',err='',settled=false;const canceled=()=>{p.kill();};scope?.signal.addEventListener('abort',canceled,{once:true});if(scope?.signal.aborted)canceled();
    const timer=setTimeout(()=>{p.kill();finish(Error('Local encoder timed out.'));},timeout);
    const finish=(error)=>{if(settled)return;settled=true;if(p.pid)scope?.onExit?.(p.pid);clearTimeout(timer);scope?.signal.removeEventListener('abort',canceled);if(scope?.signal.aborted)reject(Error('JOB_CANCELED'));else error?reject(error):resolve({out,err});};
    p.stdout.on('data',b=>out=(out+b).slice(-1000000));p.stderr.on('data',b=>err=(err+b).slice(-1000000));
    p.on('error',finish);p.on('close',code=>finish(allowedExitCodes.includes(code)?null:Error(`Encoder failed (${code}): ${err.slice(-2000)}`)));
  });
}
const base=['-hide_banner','-nostdin','-loglevel','info'];
const local=['-protocol_whitelist','file,pipe'];
const VIDEO=new Set(['.mp4','.mov','.mkv','.webm','.m4v','.avi','.mp3','.wav','.m4a','.flac','.ogg']);
export async function probe(ffmpeg,file) {
  const {err}=await run(ffmpeg,[...base,...local,'-i',file,'-t','0','-f','null','-']);
  const time=err.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  const video=err.match(/Stream[^\n]*Video:[^\n]*/)?.[0];
  const dims=video?.match(/\b(\d{2,5})x(\d{2,5})\b/);
  const hasAudio=/Stream[^\n]*Audio:/.test(err);if(!time||!dims&&!hasAudio)throw Error('Local media with a finite duration is required.');
  return {duration:Number(time[1])*3600+Number(time[2])*60+Number(time[3]),width:dims?Number(dims[1]):0,height:dims?Number(dims[2]):0,kind:video&&dims?'video':'audio',hasAudio};
}
export class Store {
  constructor(root,ffmpeg) {this.root=root;this.ffmpeg=ffmpeg;this.queue=Promise.resolve();}
  serial(fn,{reload=true}={}) {
    const p=this.queue.then(async()=>{
      const guard=path.join(this.root,'project-recovery.lock');if(await fs.lstat(guard).catch(()=>null))throw new EditError('PROJECT_BUSY','Project recovery is in progress.');const lockPath=path.join(this.root,'project.lock');let lock;
      const deadline=Date.now()+1500;
      while(!lock){try{lock=await fs.open(lockPath,'wx');}catch(e){if(e.code!=='EEXIST')throw e;if(Date.now()>=deadline)throw new EditError('PROJECT_BUSY','Another process owns the project lock. Retry after it finishes; abandoned locks require explicit recovery.',{lockPath});await new Promise(resolve=>setTimeout(resolve,25));}}
      try{
        await lock.writeFile(JSON.stringify({pid:process.pid,createdAt:new Date().toISOString()}));
        if(await fs.lstat(guard).catch(()=>null))throw new EditError('PROJECT_BUSY','Project recovery is in progress.');
        if(reload){const db=JSON.parse(await fs.readFile(this.file,'utf8'));validate(db.project);this.db=db;}
        return await fn();
      }finally{await lock.close();await fs.unlink(lockPath);}
    });this.queue=p.catch(()=>{});return p;
  }
  async init({allowRecovery=false}={}) {
    for(const dir of ['media','exports','frames'])await fs.mkdir(path.join(this.root,dir),{recursive:true});
    this.dataRoot=await fs.realpath(this.root);
    const identityPath=process.platform==='win32'?this.dataRoot.toLowerCase():this.dataRoot;
    this.projectId='project_'+createHash('sha256').update(identityPath).digest('hex');
    this.file=path.join(this.root,'project.json');
    try{await this.serial(async()=>{
      try {this.db=JSON.parse(await fs.readFile(this.file,'utf8'));validate(this.db.project);}
      catch(e) {if(e.code!=='ENOENT')throw e;this.db={revision:0,project:{title:'Untitled edit',canvas:{width:1280,height:720,fps:30},assets:[],clips:[],captions:[]},history:[],activity:[]};await atomic(this.file,this.db);}
    },{reload:false});}catch(e){if(!allowRecovery||e.code!=='PROJECT_BUSY')throw e;this.db=JSON.parse(await fs.readFile(this.file,'utf8'));validate(this.db.project);this.recoveryMode=true;}
  }
  read() {if(this.db.project.schemaVersion===2){const p=clone(this.db.project),s=p.sequences.find(s=>s.id===p.activeSequenceId);return {...p,...this.identity(),canvas:s.canvas,revision:this.db.revision,timeline:timeline(p),duration:Math.max(0,...timeline(p).map(i=>i.end)),activity:clone(this.db.activity),redoAvailable:!!this.db.future?.length,checkpoints:(this.db.checkpoints||[]).map(c=>({name:c.name,at:c.at}))};}return {...clone(this.db.project),...this.identity(),layers:clone(this.db.project.layers||[]),markers:clone(this.db.project.markers||[]),exportRange:clone(this.db.project.exportRange||null),revision:this.db.revision,timeline:timeline(this.db.project),duration:timeline(this.db.project).at(-1)?.end||0,activity:clone(this.db.activity),redoAvailable:!!this.db.future?.length,checkpoints:(this.db.checkpoints||[]).map(c=>({name:c.name,at:c.at}))};}
  snapshot() {if(this.recoveryMode)return Promise.resolve({...this.read(),recoveryRequired:true});return this.serial(async()=>this.read());}
  migrationPlan(args){
    if(!args.expectedProjectId)throw new EditError('INVALID_ARGUMENT','Project identity is required for migration.');this.check(args.expectedRevision,args.expectedProjectId);
    const preview=migrationPreview(this.db.project),planId=createHash('sha256').update(canonical({kind:'migration',projectId:this.projectId,revision:this.db.revision,source:this.db.project,target:preview.proposedProject})).digest('hex');
    return {...preview,...this.identity(),expectedRevision:this.db.revision,planId,changes:projectDiff(this.db.project,preview.proposedProject)};
  }
  previewMigration(args){return this.serial(async()=>this.migrationPlan(args));}
  backupFile(backupId){if(typeof backupId!=='string'||!/^[a-f0-9]{64}$/.test(backupId))throw new EditError('INVALID_BACKUP_ID','Invalid recovery backup ID.');return path.join(this.dataRoot,'backups',backupId+'.json');}
  async writeBackup(backupId){
    const file=this.backupFile(backupId),snapshot=clone(this.db),digest=createHash('sha256').update(canonical(snapshot)).digest('hex'),envelope={version:1,projectId:this.projectId,backupId,digest,snapshot};
    const payload=JSON.stringify(envelope,null,2);if(Buffer.byteLength(payload)>64_000_000)throw new EditError('BACKUP_LIMIT','Project backup exceeds the 64 MB limit.');await fs.mkdir(path.dirname(file),{recursive:true});
    let handle;try{handle=await fs.open(file,'wx');}catch(e){if(e.code!=='EEXIST')throw e;const existing=await this.loadBackup(backupId);if(existing.digest!==digest)throw new EditError('INVALID_BACKUP','Existing backup differs from this snapshot.');return {backupId,path:file,digest};}
    try{await handle.writeFile(payload);await handle.sync();}catch(e){await handle.close();await fs.unlink(file);throw e;}await handle.close();return {backupId,path:file,digest};
  }
  async loadBackup(backupId){
    const file=this.backupFile(backupId);let b;try{const stat=await fs.stat(file);if(!stat.isFile()||stat.size>64_000_000)throw new EditError('INVALID_BACKUP','Recovery backup exceeds the read limit.');b=JSON.parse(await fs.readFile(file,'utf8'));}catch(e){if(e instanceof EditError)throw e;throw new EditError(e.code==='ENOENT'?'BACKUP_NOT_FOUND':'INVALID_BACKUP','Recovery backup is missing or unreadable.');}
    if(b.version!==1||b.backupId!==backupId||typeof b.projectId!=='string'||!b.snapshot||b.digest!==createHash('sha256').update(canonical(b.snapshot)).digest('hex'))throw new EditError('INVALID_BACKUP','Recovery backup integrity check failed.');this.checkIdentity(b.projectId);try{validate(b.snapshot.project);}catch{throw new EditError('INVALID_BACKUP','Recovery backup contains an invalid project.');}return b;
  }
  activateMigration(args){return this.serial(async()=>{
    const plan=this.migrationPlan(args);if(!plan.activationAvailable)throw new EditError('MIGRATION_UNAVAILABLE','The migration round-trip check failed.');
    if(args.expectedPlanId!==plan.planId)throw new EditError('PLAN_MISMATCH','Migration plan changed. Review it again.');if(args.confirmPlanId!==plan.planId)throw new EditError('CONFIRMATION_REQUIRED','Confirm the reviewed migration plan.');
    const backup=await this.writeBackup(plan.planId);await this.commitLocked(plan.proposedProject,'Migrate to sequence tracks');return {...this.read(),migrationBackup:backup};
  });}
  restorePlan(args){return this.serial(async()=>this.prepareRestore(args));}
  async prepareRestore(args){
    if(!args.expectedProjectId)throw new EditError('INVALID_ARGUMENT','Project identity is required for recovery.');this.check(args.expectedRevision,args.expectedProjectId);const b=await this.loadBackup(args.backupId);
    const target=b.snapshot.project,planId=createHash('sha256').update(canonical({kind:'restore',backupId:args.backupId,projectId:this.projectId,revision:this.db.revision,source:this.db.project,target})).digest('hex');
    return {backupId:args.backupId,projectId:this.projectId,expectedRevision:this.db.revision,planId,title:target.title,targetVersion:target.schemaVersion||1,changes:projectDiff(this.db.project,target),target};
  }
  restoreBackup(args){return this.serial(async()=>{
    const plan=await this.prepareRestore(args);if(args.expectedPlanId!==plan.planId)throw new EditError('PLAN_MISMATCH','Recovery plan changed. Review it again.');if(args.confirmPlanId!==plan.planId)throw new EditError('CONFIRMATION_REQUIRED','Confirm the reviewed recovery plan.');
    const backup=await this.writeBackup(plan.planId);await this.commitLocked(clone(plan.target),'Restore recovery backup');return {...this.read(),recoverySafetyBackup:backup};
  });}
  listBackups(args){return this.serial(async()=>{
    this.checkIdentity(args.expectedProjectId);const dir=path.join(this.dataRoot,'backups');let files;try{files=await fs.readdir(dir);}catch(e){if(e.code==='ENOENT')return {backups:[]};throw e;}
    const backups=[];for(const file of files.filter(f=>/^[a-f0-9]{64}\.json$/.test(f)).sort().slice(-100)){const backupId=file.slice(0,-5);try{const b=await this.loadBackup(backupId),stat=await fs.stat(this.backupFile(backupId));backups.push({backupId,title:b.snapshot.project.title,schemaVersion:b.snapshot.project.schemaVersion||1,revision:b.snapshot.revision,path:this.backupFile(backupId),createdAt:stat.birthtime.toISOString(),status:'valid'});}catch(e){backups.push({backupId,status:'invalid',error:errorResult(e)});}}return {backups};
  });}
  commit(project,label) {return this.serial(()=>this.commitLocked(project,label));}
  async commitLocked(project,label) {
    validate(project);
    const next={...this.db,revision:this.db.revision+1,project,future:[],history:[...this.db.history,{project:clone(this.db.project),label}].slice(-50),activity:[...this.db.activity,{revision:this.db.revision+1,label,at:new Date().toISOString()}].slice(-100)};
    await atomic(this.file,next);this.db=next;return this.read();
  }
  checkIdentity(expectedProjectId) {if(expectedProjectId!==undefined&&expectedProjectId!==this.projectId)throw new EditError('PROJECT_MISMATCH','Project mismatch: read the connected project before retrying.');}
  identity() {return {projectId:this.projectId,dataRoot:this.dataRoot,identityScope:'data-directory'};}
  check(revision,expectedProjectId) {this.checkIdentity(expectedProjectId);if(revision!==this.db.revision)throw new EditError('STALE_REVISION',`Stale revision: expected ${this.db.revision}. Read the project and retry.`,{expectedRevision:revision,currentRevision:this.db.revision});}
  prepare(args) {
    this.check(args.expectedRevision,args.expectedProjectId);
    text(args.summary,200,'edit summary');
    const digest=createHash('sha256').update(canonical({projectId:this.projectId,revision:this.db.revision,project:this.db.project,operations:args.operations})).digest('hex');
    let counter=0;
    const project=apply(this.db.project,args.operations,{allocateId:()=>createHash('sha256').update(digest+':'+counter++).digest('hex')});
    const changes=projectDiff(this.db.project,project);
    return {project,plan:{projectId:this.projectId,expectedRevision:this.db.revision,planId:digest,summary:args.summary,operations:clone(args.operations),noOp:changes.length===0,changes,durationBefore:Math.max(0,...timeline(this.db.project).map(c=>c.end)),durationAfter:Math.max(0,...timeline(project).map(c=>c.end)),destructiveOperations:args.operations.filter(operationIsDestructive).map(op=>op.type)}};
  }
  plan(args) {return this.serial(async()=>this.prepare(args).plan);}
  edit(args) {return this.serial(async()=>{const prepared=this.prepare(args);if(args.expectedPlanId!==undefined&&args.expectedPlanId!==prepared.plan.planId)throw new EditError('PLAN_MISMATCH','Plan mismatch: validate the proposed operations again.');if(prepared.plan.noOp)return this.read();if(this.db.project.schemaVersion===2&&prepared.plan.destructiveOperations.length&&args.confirmPlanId!==prepared.plan.planId)throw new EditError('CONFIRMATION_REQUIRED','Confirm the reviewed destructive plan before applying it.',{planId:prepared.plan.planId,destructiveOperations:prepared.plan.destructiveOperations});return this.commitLocked(prepared.project,args.summary);});}
  planFile(planId) {
    if(typeof planId!=='string'||!/^[a-f0-9]{64}$/.test(planId))throw new EditError('INVALID_PLAN_ID','Invalid saved plan ID.');
    return path.join(this.dataRoot,'plans',planId+'.json');
  }
  savePlan(args) {return this.serial(async()=>{
    const plan=this.prepare(args).plan,file=this.planFile(plan.planId);
    await fs.mkdir(path.dirname(file),{recursive:true});
    const recipeBindingDigest=args.recipeBindingDigest;if(recipeBindingDigest!==undefined&&!/^[a-f0-9]{64}$/.test(recipeBindingDigest))throw new EditError('INVALID_PLAN','Invalid recipe binding digest.');
    const digest=createHash('sha256').update(canonical(recipeBindingDigest?{plan,recipeBindingDigest}:plan)).digest('hex');
    const envelope={version:1,digest,plan,...(recipeBindingDigest?{recipeBindingDigest}:{})};if(Buffer.byteLength(JSON.stringify(envelope,null,2))>8_000_000)throw new EditError('INVALID_PLAN','Saved plan exceeds the 8 MB read limit.');
    await atomic(file,envelope);return {plan,path:file};
  });}
  async loadPlan(planId) {
    const file=this.planFile(planId);let envelope;
    try{const stat=await fs.stat(file);if(!stat.isFile()||stat.size>8_000_000)throw new EditError('INVALID_PLAN','Saved plan exceeds the 8 MB read limit.');envelope=JSON.parse(await fs.readFile(file,'utf8'));}
    catch(e){if(e instanceof EditError)throw e;throw new EditError(e.code==='ENOENT'?'PLAN_NOT_FOUND':'INVALID_PLAN',e.code==='ENOENT'?'Saved plan not found.':'Saved plan is unreadable.');}
    if(envelope.version!==1||!envelope.plan||envelope.plan.planId!==planId||envelope.digest!==createHash('sha256').update(canonical(envelope.recipeBindingDigest?{plan:envelope.plan,recipeBindingDigest:envelope.recipeBindingDigest}:envelope.plan)).digest('hex'))throw new EditError('INVALID_PLAN','Saved plan integrity check failed.');
    this.checkIdentity(envelope.plan.projectId);if(envelope.recipeBindingDigest)await validateRecipeBinding(this,envelope.plan,envelope.recipeBindingDigest);return envelope.plan;
  }
  readPlan(args) {return this.serial(async()=>{this.checkIdentity(args.expectedProjectId);const plan=await this.loadPlan(args.planId),recipeReview=await readRecipeReview(this,plan);return {plan,...(recipeReview?{recipeReview}:{})};});}
  applyPlan(args) {return this.serial(async()=>{
    this.check(args.expectedRevision,args.expectedProjectId);
    const plan=await this.loadPlan(args.planId);
    await validateRecipeSources(this,plan);
    const prepared=this.prepare({expectedProjectId:plan.projectId,expectedRevision:plan.expectedRevision,summary:plan.summary,operations:plan.operations});
    if(canonical(prepared.plan)!==canonical(plan))throw new EditError('PLAN_MISMATCH','Plan mismatch: validate the proposed operations again.');
    if(plan.destructiveOperations.length&&args.confirmPlanId!==plan.planId)throw new EditError('CONFIRMATION_REQUIRED','Confirm this saved destructive plan before applying it.',{planId:plan.planId,destructiveOperations:plan.destructiveOperations});
    if(plan.noOp)return this.read();return this.commitLocked(prepared.project,plan.summary);
  });}
  undo(args) {return this.serial(async()=>{
    this.check(args.expectedRevision,args.expectedProjectId);const entry=this.db.history.at(-1);if(!entry)throw Error('Nothing to undo.');
    const next={...this.db,revision:this.db.revision+1,project:entry.project,future:[...(this.db.future||[]),{project:clone(this.db.project),label:entry.label}].slice(-50),history:this.db.history.slice(0,-1),activity:[...this.db.activity,{revision:this.db.revision+1,label:'Undo: '+entry.label,at:new Date().toISOString()}].slice(-100)};
    await atomic(this.file,next);this.db=next;return this.read();
  });}
  redo(args) {return this.serial(async()=>{
    this.check(args.expectedRevision,args.expectedProjectId);const entry=this.db.future?.at(-1);if(!entry)throw Error('Nothing to redo.');
    const next={...this.db,revision:this.db.revision+1,project:clone(entry.project),future:this.db.future.slice(0,-1),history:[...this.db.history,{project:clone(this.db.project),label:entry.label}].slice(-50),activity:[...this.db.activity,{revision:this.db.revision+1,label:'Redo: '+entry.label,at:new Date().toISOString()}].slice(-100)};
    validate(next.project);await atomic(this.file,next);this.db=next;return this.read();
  });}
  checkpoint(args) {return this.serial(async()=>{
    this.check(args.expectedRevision,args.expectedProjectId);const name=text(args.name,80,'checkpoint name');
    if(args.action==='restore'){const c=(this.db.checkpoints||[]).find(c=>c.name===name);if(!c)throw Error('Unknown checkpoint.');return this.commitLocked(clone(c.project),'Restore checkpoint '+name);}
    if(args.action!=='save')throw Error('Checkpoint action must be save or restore.');
    const list=this.db.checkpoints||[];if(list.some(c=>c.name===name))throw Error('Checkpoint name already exists.');if(list.length>=30)throw Error('Maximum 30 checkpoints.');
    const at=new Date().toISOString(),next={...this.db,revision:this.db.revision+1,checkpoints:[...list,{name,at,project:clone(this.db.project)}],activity:[...this.db.activity,{revision:this.db.revision+1,label:'Save checkpoint '+name,at}].slice(-100)};
    await atomic(this.file,next);this.db=next;return this.read();
  });}
  importSubtitles(args) {return this.serial(async()=>{
    this.check(args.expectedRevision,args.expectedProjectId);const format=args.format||'srt',captions=parseSubtitles(args.text,format).map(c=>({...c,id:id()}));
    const p=clone(this.db.project),target=p.schemaVersion===2?p.sequences.find(s=>s.id===p.activeSequenceId):p,cues=p.schemaVersion===2?captions.map(c=>({...c,start:timeFromSeconds(c.start),end:timeFromSeconds(c.end)})):captions;target.captions=args.replace?cues:[...target.captions,...cues];return this.commitLocked(p,'Import '+captions.length+' '+format.toUpperCase()+' captions');
  });}
  import(args) {return this.serial(async()=>{
    this.checkIdentity(args.expectedProjectId);
    if(typeof args.path!=='string'||!path.isAbsolute(args.path)||args.path.startsWith('\\\\')||args.path.startsWith('//'))throw Error('Supply an absolute local video path. Network paths are not supported.');
    const file=await fs.realpath(args.path);if(file.startsWith('\\\\')||file.startsWith('//'))throw Error('Network media is not supported.');const ext=path.extname(file).toLowerCase();if(!VIDEO.has(ext))throw Error('Supported local videos: MP4, MOV, MKV, WebM, M4V and AVI.');
    const stat=await fs.stat(file);if(!stat.isFile()||stat.size>4e9)throw Error('Import a video smaller than 4 GB.');
    const meta=await probe(this.ffmpeg,file);if(meta.duration<=0||meta.duration>7200)throw Error('Media must be between 0 and 7200 seconds.');
    const key=id(),dest=path.join(this.root,'media',key+ext);await fs.copyFile(file,dest);
    const project=clone(this.db.project);project.assets.push({id:key,name:path.basename(file),file:path.basename(dest),...meta});
    return this.commitLocked(project,'Import '+path.basename(file));
  });}
  assetPath(asset) {if(asset?.kind==='sequence')throw Error('Nested sources reference sequences; inspect their original media instead.');if(!asset||typeof asset.file!=='string'||path.basename(asset.file)!==asset.file)throw Error('Invalid media reference.');return path.join(this.root,'media',asset.file);}
}
function tempo(speed) {
  const parts=[];while(speed>2){parts.push('atempo=2');speed/=2;}while(speed<.5){parts.push('atempo=0.5');speed/=.5;}parts.push('atempo='+speed);return parts.join(',');
}
function filterPath(file) {return file.replaceAll('\\','/').replaceAll(':','\\:').replaceAll("'","\\'");}
export async function captionFilter(project,work,index) {
  const {width:w,height:h,fps}=project.canvas;
  let vf='null';
  let n=0;
  for(const cap of project.captions) {
    const start=cap.start,end=cap.end;if(end<=start)continue;
    const name=`caption-${index}-${n++}.txt`;await fs.writeFile(path.join(work,name),cap.text,'utf8');
    const font=process.platform==='win32'?`:fontfile='${filterPath(path.join(process.env.WINDIR||'C:\\Windows','Fonts','arial.ttf'))}'`:'';
    vf+=`,drawtext=textfile='${name}':expansion=none${font}:fontcolor=white:fontsize=${Math.round(h*.045)}:box=1:boxcolor=black@0.65:boxborderw=10:x=(w-tw)/2:y=h-th-h*0.08:enable='gte(t,${start})*lt(t,${end})'`;
  }
  return vf;
}
export async function videoFilter(project,clip,work,index,transparent=false,clock={}) {
  const {width:w,height:h,fps}=project.canvas,e={...effectDefaults,...clip.effects},seconds=clock.originalDuration??duration(clip),keys=clip.keyframes||{},expression=(property,variable='t')=>keys[property]?keyframeExpression(keys[property],variable):String(e[property]);
  const crop=`crop=iw*${1-e.cropLeft-e.cropRight}:ih*${1-e.cropTop-e.cropBottom}:iw*${e.cropLeft}:ih*${e.cropTop}`;
  let vf=(clip.frameHold?`trim=end_frame=1,setpts=PTS-STARTPTS,tpad=stop_mode=clone:stop_duration=${(clock.renderDuration??seconds)*clip.speed+1},`:'')+`setpts='${clip.speedCurve?remapTimestampExpression(clip.speedCurve):`(PTS-STARTPTS)/${clip.speed}`}+${clock.offset||0}/TB',${crop},eq=brightness='${expression('brightness')}':contrast='${expression('contrast')}':saturation='${expression('saturation')}':eval=frame`;
  if(e.flipH)vf+=',hflip';if(e.flipV)vf+=',vflip';
  vf+=`,format=rgba${maskFilter(clip.mask)},scale=${w}:${h}:force_original_aspect_ratio=decrease:force_divisible_by=2,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=black@0`;
  if(e.rotation||keys.rotation)vf+=`,rotate='(${expression('rotation')})*PI/180':c=black@0`;
  if(e.scale!==1)vf+=`,scale=${Math.max(2,Math.round(w*e.scale/2)*2)}:${Math.max(2,Math.round(h*e.scale/2)*2)}`;
  if(keys.opacity)vf+=`,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='alpha(X,Y)*(${expression('opacity','T')})'`;else if(e.opacity!==1)vf+=`,colorchannelmixer=aa=${e.opacity}`;
  const tag=String(index).replaceAll(/[^a-zA-Z0-9]/g,'');
  vf+=`,split=2[background${tag}][foreground${tag}];[background${tag}]scale=${w}:${h},lutrgb=r=0:g=0:b=0:a=${transparent?0:255}[canvas${tag}];[canvas${tag}][foreground${tag}]overlay=x='(W-w)/2+(${expression('offsetX')})*${w}':y='(H-h)/2+(${expression('offsetY')})*${h}':eval=frame:format=auto,setsar=1,fps=${fps}`;
  if(e.fadeIn)vf+=`,fade=t=in:st=0:d=${e.fadeIn}:alpha=${transparent?1:0}`;
  if(e.fadeOut)vf+=`,fade=t=out:st=${Math.max(0,seconds-e.fadeOut)}:d=${e.fadeOut}:alpha=${transparent?1:0}`;
  return vf;
}
export function audioFilter(clip,clock={}) {
  const e={...effectDefaults,...clip.effects},seconds=clock.originalDuration??duration(clip);
  let af=`${clip.reverse?'aresample=48000,aformat=channel_layouts=stereo,areverse,':''}asetpts=PTS-STARTPTS,${tempo(clip.speed)},asetpts=PTS+${clock.offset||0}/TB,volume='${clip.keyframes?.volume?`if(isnan(t),${clip.keyframes.volume[0].value},${keyframeExpression(clip.keyframes.volume)})`:clip.volume}':eval=frame,aresample=48000,aformat=channel_layouts=stereo`;
  if(clip.audio)af+=','+audioProcessingFilter(clip.audio);
  if(e.audioFadeIn)af+=`,afade=t=in:st=0:d=${e.audioFadeIn}`;
  if(e.audioFadeOut)af+=`,afade=t=out:st=${Math.max(0,seconds-e.audioFadeOut)}:d=${e.audioFadeOut}`;
  return af;
}
export class Renderer {
  constructor(store) {this.store=store;this.jobService=new JobService(store);this.jobs=this.jobService.jobs;this.ready=this.jobService.ready;this.frameCache=new Map();this.renderTail=Promise.resolve();}
  start({preview=false,queue=false,options}={}) {
    const cached=preview&&!(this.store.db.project.schemaVersion===2&&this.store.db.project.sequences.some(s=>hasStyledText(s)||s.transitions.some(t=>t.type.startsWith('gl_'))))&&[...this.jobs.values()].find(j=>j.kind==='render'&&j.preview&&!j.evicted&&j.revision===this.store.db.revision&&['complete','queued','rendering'].includes(j.status));if(cached)return clone(cached);
    const active=[...this.jobs.values()].filter(j=>j.status==='rendering'||j.status==='queued');if(active.length&&!queue)throw Error('A render is already running. Set queue=true to enqueue a frozen revision.');if(active.length>=20)throw Error('Render queue limit is 20 pending jobs.');
    if(preview&&options)throw Error('Playback preview uses sequence settings.');
    const project=clone(this.store.db.project);validate(project);if(!timeline(project).length)throw Error('Add clips before exporting.');
    if(preview){if(project.schemaVersion===2)project.sequences.find(s=>s.id===project.activeSequenceId).exportRange=null;else project.exportRange=null;}
    const job={id:id(),status:active.length?'queued':'rendering',revision:this.store.db.revision,projectId:this.store.projectId,preview,progress:0,...(options?{options:normalizeExport(options)}:{})};return this.jobService.start('render',{project},async(request,j)=>this.render(request.project,j),job);
  }
  status(jobId) {const j=this.jobs.get(jobId);if(!j)throw Error('Unknown render job. Jobs belong to the running editor session.');return clone(j);}
  async render(p,job) {
    if(!jobContext.getStore()){await this.ready;const meta={...job,projectId:this.store.projectId,preview:job.preview??!!job.candidate};this.jobService.start('render',{project:p},async(request,j)=>this.render(request.project,j),meta);await this.jobService.tail;const result=this.jobs.get(job.id);if(result.status!=='complete')throw Error(result.error||result.status);Object.assign(job,result);return job;}
    const inner=new Proxy({...job},{set:(target,key,value)=>{target[key]=value;if(key==='progress')job.progress=job.options?Math.min(90,value):value;return true;}});
    await this.renderComposition(p,inner);const result=job.options?await transcodeExport(this.store,inner,job.options):inner;Object.assign(job,result);return job;
  }
  async renderComposition(p,job) {
    if(p.schemaVersion===2){
      if(job.draftRange){const {renderSequence}=await import('./sequence-renderer.mjs');return renderSequence(this.store,p,job);}
      const {validateV2,legacyRenderSnapshot}=await import('./sequences.mjs');validateV2(p);
      let legacy;try{legacy=legacyRenderSnapshot(p,{forRendering:true});}catch(e){if(e.code!=='INVALID_SEQUENCE')throw e;}
      if(legacy)return this.renderComposition(legacy,job);
      const {renderSequence}=await import('./sequence-renderer.mjs');return renderSequence(this.store,p,job);
    }
    const work=path.join(this.store.root,'exports',job.id);await fs.mkdir(work,{recursive:true});
    const clips=timeline(p);const segments=[];
    for(let i=0;i<clips.length;i++) {
      const c=clips[i],a=p.assets.find(a=>a.id===c.assetId);const name=`segment-${i}.mp4`;segments.push(name);
      const args=[...base,'-y',...local,'-ss',String(c.sourceIn),'-t',String(c.sourceOut-c.sourceIn),'-i',this.store.assetPath(a)];
      if(!a.hasAudio)args.push('-f','lavfi','-i','anullsrc=r=48000:cl=stereo');
      args.push('-map','0:v:0','-map',a.hasAudio?'0:a:0':'1:a:0','-vf',await videoFilter(p,c,work,i),'-af',audioFilter(c),'-t',String(c.duration),'-c:v','libx264','-preset','veryfast','-crf','20','-pix_fmt','yuv420p','-c:a','aac','-ac','2','-ar','48000','-video_track_timescale','90000','-movflags','+faststart',name);
      await run(this.store.ffmpeg,args,{cwd:work,timeout:7200000});job.progress=Math.round((i+1)/clips.length*90);
    }
    await fs.writeFile(path.join(work,'segments.txt'),segments.map(s=>`file '${s}'`).join('\n'));
    const total=clips.at(-1).end;
    if(!clips.some(c=>c.transitionOut))await run(this.store.ffmpeg,[...base,'-y',...local,'-f','concat','-safe','1','-i','segments.txt','-c','copy','-movflags','+faststart','base.mp4'],{cwd:work,timeout:7200000});
    else {
      const args=[...base,'-y'];for(const segment of segments)args.push(...local,'-i',segment);
      const filters=[];for(let i=0;i<clips.length;i++){filters.push(`[${i}:v]trim=duration=${clips[i].duration},setpts=PTS-STARTPTS,settb=AVTB[v${i}]`);filters.push(`[${i}:a]atrim=duration=${clips[i].duration},asetpts=PTS-STARTPTS[a${i}]`);}
      let v='v0',a='a0',length=clips[0].duration;
      for(let i=1;i<clips.length;i++){
        const d=clips[i-1].transitionOut||0,nv='joinv'+i,na='joina'+i;
        if(d){filters.push(`[${v}][v${i}]xfade=transition=fade:duration=${d}:offset=${length-d}[${nv}]`);filters.push(`[${a}][a${i}]acrossfade=d=${d}:c1=tri:c2=tri[${na}]`);}else filters.push(`[${v}][${a}][v${i}][a${i}]concat=n=2:v=1:a=1[${nv}][${na}]`);
        v=nv;a=na;length+=clips[i].duration-d;
      }
      args.push('-filter_complex_threads','1','-filter_complex',filters.join(';'),'-map',`[${v}]`,'-map',`[${a}]`,'-t',String(total),'-c:v','libx264','-preset','veryfast','-crf','20','-pix_fmt','yuv420p','-c:a','aac','-movflags','+faststart','base.mp4');
      await run(this.store.ffmpeg,args,{cwd:work,timeout:7200000});
    }
    if(!(p.layers||[]).length&&!p.captions.length&&!p.exportRange)await fs.copyFile(path.join(work,'base.mp4'),path.join(work,'edit.mp4'));
    else {
      const args=[...base,'-y',...local,'-i','base.mp4'],filters=[];
      let v='0:v';const audio=['0:a'];
      const layers=[...(p.layers||[])].sort((a,b)=>a.kind.localeCompare(b.kind)||a.track-b.track||a.start-b.start);
      for(let i=0;i<layers.length;i++) {
        const l=layers[i],asset=p.assets.find(a=>a.id===l.assetId),input=i+1;
        args.push(...local,'-ss',String(l.sourceIn),'-t',String(l.sourceOut-l.sourceIn),'-i',this.store.assetPath(asset));
        if(l.kind==='video') {
          filters.push(`[${input}:v]${await videoFilter(p,l,work,'layer'+i,true)},setpts=PTS+${l.start}/TB[layer${i}]`);
          const next='over'+i;filters.push(`[${v}][layer${i}]overlay=eof_action=pass:enable='gte(t,${l.start})*lt(t,${l.start+duration(l)})':format=auto[${next}]`);v=next;
        }
        if(asset.hasAudio&&l.volume>0) {const label='sound'+i;filters.push(`[${input}:a]${audioFilter(l)},adelay=${Math.round(l.start*1000)}:all=1,apad[${label}]`);audio.push(label);}
      }
      filters.push(`[${v}]${await captionFilter(p,work,'final')},format=yuv420p[finalv]`);
      filters.push(audio.map(a=>`[${a}]`).join('')+`amix=inputs=${audio.length}:duration=first:dropout_transition=0:normalize=0,alimiter=limit=0.95:level=0[finala]`);
      args.push('-filter_complex_threads','1','-filter_complex',filters.join(';'),'-map','[finalv]','-map','[finala]');
      if(p.exportRange)args.push('-ss',String(p.exportRange.start),'-t',String(p.exportRange.end-p.exportRange.start));else args.push('-t',String(total));
      args.push('-c:v','libx264','-preset','veryfast','-crf','20','-pix_fmt','yuv420p','-c:a','aac','-ac','2','-ar','48000','-movflags','+faststart','edit.mp4');
      await run(this.store.ffmpeg,args,{cwd:work,timeout:7200000});
    }
    job.path=path.join(work,'edit.mp4');job.file=job.id+'/edit.mp4';job.progress=100;job.status='complete';
    await atomic(path.join(work,'render.json'),{...job,canvas:p.canvas,expectedDuration:p.exportRange?p.exportRange.end-p.exportRange.start:total,exportRange:p.exportRange||null});
  }
  async frame(time) {
    if(this.store.db.project.schemaVersion===2){
      const p=clone(this.store.db.project),revision=this.store.db.revision,sequence=p.sequences.find(s=>s.id===p.activeSequenceId),total=Math.max(0,...timeline(p).map(i=>i.end));num(time,0,total,'time');if(time>=total)throw Error('Time must be inside the sequence.');
      sequence.exportRange=null;const digest=createHash('sha256').update(canonical({p,fonts:await textFontSnapshot(p),transitionResources:await pairResourceSnapshot(p)})).digest('hex');
      if(this.frameCache.has(digest)&&!await fs.stat(await this.frameCache.get(digest)).catch(()=>null))this.frameCache.delete(digest);
      if(!this.frameCache.has(digest)){const job={id:id(),revision,status:'rendering',progress:0,preview:true};const task=this.render(p,job).then(()=>job.path);this.frameCache.set(digest,task);task.catch(()=>this.frameCache.delete(digest));}
      const composed=await this.frameCache.get(digest),work=path.join(this.store.root,'frames',id());await fs.mkdir(work,{recursive:true});await run(this.store.ffmpeg,[...base,'-y',...local,'-ss',String(time),'-i',composed,'-frames:v','1','frame.png'],{cwd:work});return {path:path.join(work,'frame.png'),revision,time,sequenceId:sequence.id,schemaVersion:2,textFonts:this.jobs.get(path.basename(path.dirname(composed)))?.textFonts,textWarnings:this.jobs.get(path.basename(path.dirname(composed)))?.textWarnings};
    }
    const p=clone(this.store.db.project),revision=this.store.db.revision;num(time,0,7200,'time');const c=timeline(p).find(c=>time>=c.start&&time<c.end);if(!c)throw Error('Time must be inside the timeline.');
    const a=p.assets.find(a=>a.id===c.assetId),key=id(),work=path.join(this.store.root,'frames',key);await fs.mkdir(work,{recursive:true});
    if((p.layers||[]).length||p.clips.some(c=>c.transitionOut||Object.entries(c.effects||{}).some(([k,v])=>v!==effectDefaults[k]))) {
      const whole={...p,exportRange:null},digest=createHash('sha256').update(JSON.stringify(whole)).digest('hex');
      if(this.frameCache.has(digest)&&!await fs.stat(await this.frameCache.get(digest)).catch(()=>null))this.frameCache.delete(digest);
      if(!this.frameCache.has(digest)){const job={id:id(),revision,status:'rendering',progress:0,preview:true};const task=this.render(whole,job).then(()=>job.path);this.frameCache.set(digest,task);task.catch(()=>this.frameCache.delete(digest));}
      const composed=await this.frameCache.get(digest);
      await run(this.store.ffmpeg,[...base,'-y',...local,'-ss',String(time),'-i',composed,'-frames:v','1','frame.png'],{cwd:work});return {path:path.join(work,'frame.png'),revision,time};
    }
    // Shift timeline captions into the single-frame source clock.
    const frameProject={...p,captions:p.captions.filter(cap=>time>=cap.start&&time<cap.end).map(cap=>({...cap,start:0,end:1}))};
    const one={...c,start:0,duration:1,sourceIn:0,sourceOut:1,speed:1};const vf=await videoFilter(frameProject,one,work,0)+','+await captionFilter(frameProject,work,'frame');
    await run(this.store.ffmpeg,[...base,'-y',...local,'-ss',String(c.sourceIn+(time-c.start)*c.speed),'-i',this.store.assetPath(a),'-frames:v','1','-vf',vf,'frame.png'],{cwd:work});
    return {path:path.join(work,'frame.png'),revision,time};
  }
  async silence(assetId,noiseDb=-35,minSeconds=.5) {
    num(noiseDb,-70,-5,'noiseDb');num(minSeconds,.1,20,'minSeconds');
    const a=this.store.db.project.assets.find(a=>a.id===assetId);if(!a?.hasAudio)throw Error('Choose an asset with an audio track.');
    const {err}=await run(this.store.ffmpeg,[...base,...local,'-i',this.store.assetPath(a),'-vn','-af',`silencedetect=noise=${noiseDb}dB:d=${minSeconds}`,'-f','null','-'],{timeout:7200000});
    const intervals=[];let start;
    for(const m of err.matchAll(/silence_(start|end):\s*([\d.]+)/g)) {if(m[1]==='start')start=Number(m[2]);else if(start!==undefined){intervals.push({start,end:Number(m[2])});start=undefined;}}
    if(start!==undefined)intervals.push({start,end:a.duration});
    return {assetId,coordinateSystem:'source seconds; map through sourceIn/sourceOut and clip.speed before timeline edits',noiseDb,minSeconds,intervals,warning:'Silence detection measures audio level; it does not identify filler words or understand speech.'};
  }
}
