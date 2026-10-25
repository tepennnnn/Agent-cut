import {validateRecipeSources} from './recipe-provenance.mjs';
import {textFontSnapshot} from './text-fonts.mjs';
import fs from 'node:fs/promises';import path from 'node:path';import {createHash} from 'node:crypto';
import {canonical,EditError,timeline,run} from './engine.mjs';
// Frozen candidate composition. No assignment to Store.db and no project commit.
// Range-optimized draft rendering/cancellation follows in M1-04/M2.
export class CandidatePreview {
 constructor(store,renderer){this.store=store;this.renderer=renderer;this.cache=new Map();this.tail=Promise.resolve();}
 preview(args){const pending=this.tail.then(()=>this.compose(args));this.tail=pending.catch(()=>{});return pending;}
 async compose(args) {
   const frozen=await this.store.serial(async()=>{
     this.store.check(args.expectedRevision,args.expectedProjectId);const saved=await this.store.loadPlan(args.planId),prepared=this.store.prepare({expectedProjectId:saved.projectId,expectedRevision:saved.expectedRevision,summary:saved.summary,operations:saved.operations});
     if(canonical(saved)!==canonical(prepared.plan))throw new EditError('PLAN_MISMATCH','Saved plan no longer matches its frozen input.');
     return {before:structuredClone(this.store.db.project),after:prepared.project,plan:prepared.plan};
   });
   await validateRecipeSources(this.store,frozen.plan);
   const {plan}=frozen,sequenceId=args.sequenceId??frozen.after.activeSequenceId??null;
   if(frozen.after.schemaVersion===2&&!frozen.after.sequences.some(s=>s.id===sequenceId)||frozen.after.schemaVersion!==2&&args.sequenceId!==undefined)throw new EditError('INVALID_ARGUMENT','Unknown candidate sequence.');
   const select=project=>{const p=structuredClone(project);if(p.schemaVersion===2){p.activeSequenceId=sequenceId;const s=p.sequences.find(s=>s.id===sequenceId);if(!s)return null;s.exportRange=null;}else p.exportRange=null;return p;};
   const after=select(frozen.after),before=select(frozen.before),duration=p=>p?Math.max(0,...timeline(p).map(i=>i.end)):0,afterDuration=duration(after),beforeDuration=duration(before);
   if(!Number.isFinite(args.time)||args.time<0||args.time>=afterDuration)throw new EditError('INVALID_ARGUMENT','Candidate time must lie inside the proposed sequence.');
   if(Math.max(afterDuration,args.includeBefore===false?0:beforeDuration)>120)throw new EditError('PREVIEW_LIMIT','Initial candidate still preview supports sequences up to 120 seconds. Bounded range preview is not yet available.');
   const id=createHash('sha256').update(canonical({projectId:plan.projectId,planId:plan.planId,sequenceId,fonts:{before:await textFontSnapshot(before),after:await textFontSnapshot(after)},implementation:'candidate-still-v2'})).digest('hex');
   const render=async(project,side)=>{
     const key=id+':'+side;if(this.cache.has(key)&&!await fs.stat(await this.cache.get(key).promise).catch(()=>null))this.cache.delete(key);if(!this.cache.has(key)){
       if(this.cache.size>=4){const settled=[...this.cache].find(([,v])=>v.settled);if(!settled)throw new EditError('PREVIEW_BUSY','Candidate preview cache is busy; wait for current composition.');this.cache.delete(settled[0]);}
       const job={id:'candidate-'+id+'-'+side,revision:plan.expectedRevision,projectId:plan.projectId,status:'rendering',candidate:true},entry={settled:false};entry.promise=this.renderer.render(project,job).then(()=>{entry.settled=true;return job.path;},e=>{this.cache.delete(key);throw e;});this.cache.set(key,entry);
     }
     const file=await this.cache.get(key).promise,frameId=createHash('sha256').update(String(args.time)).digest('hex').slice(0,16),frame=path.join(this.store.root,'exports','candidate-'+id+'-'+side,`frame-${frameId}.png`);
     const unpin=this.renderer.jobService?.pin(path.basename(path.dirname(file)))||(()=>{});try{await run(this.store.ffmpeg,['-hide_banner','-nostdin','-y','-protocol_whitelist','file,pipe','-ss',String(args.time),'-i',file,'-frames:v','1',frame],{timeout:120000});
     return {label:side==='before'?'Committed base frame':'Proposed candidate frame',textFonts:this.renderer.jobs?.get(path.basename(path.dirname(file)))?.textFonts,textWarnings:this.renderer.jobs?.get(path.basename(path.dirname(file)))?.textWarnings,path:frame,mimeType:'image/png',data:(await fs.readFile(frame)).toString('base64')};}finally{unpin();}
   };
   const images=[];if(args.includeBefore!==false&&before&&args.time<beforeDuration)images.push(await render(before,'before'));images.push(await render(after,'after'));
   const current=await this.store.snapshot();return {candidate:true,committed:false,projectId:plan.projectId,baseRevision:plan.expectedRevision,currentRevision:current.revision,stale:current.revision!==plan.expectedRevision,planId:plan.planId,sequenceId,time:args.time,coverage:{kind:'composed stills',renderStrategy:'full frozen sequence',previewSequenceLimitSeconds:120,beforeAvailable:images.length===2},durationBefore:beforeDuration,durationAfter:afterDuration,changedPaths:plan.changes.map(c=>c.path),destructiveOperations:plan.destructiveOperations,images};
 }
}
