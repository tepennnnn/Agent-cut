import {pairResourceSnapshot} from './gl-renderer.mjs';
import {textFontSnapshot} from './text-fonts.mjs';
import {sourceFingerprints,usedSources} from './job-inputs.mjs';import path from 'node:path';import {run} from './engine.mjs';
import {createHash} from 'node:crypto';
import {convertV1,timeSeconds} from './sequences.mjs';
import {canonical,EditError,timeline} from './engine.mjs';
export class DraftService {
 async frame(args){const project=await this.store.snapshot();const start=Math.max(0,args.time-.1),end=Math.min(project.duration,args.time+.5);if(args.time<0||args.time>=project.duration)throw new EditError('INVALID_ARGUMENT','Frame is outside sequence.');const job=await this.start({expectedProjectId:project.projectId,expectedRevision:project.revision,start,end}),id=job.id;await this.renderer.jobService.tail;const done=await this.renderer.jobService.status(id);if(done.status!=='complete')throw new EditError('PREVIEW_FAILED',done.error||done.status);const frame=path.join(this.store.root,'exports',id,'still-'+String(args.time).replace('.','_')+'.png');const unpin=this.renderer.jobService.pin(id);try{await run(this.store.ffmpeg,['-hide_banner','-nostdin','-y','-ss',String(args.time-done.coverage.start),'-i',done.path,'-frames:v','1',frame]);return {path:frame,time:args.time,revision:project.revision,draft:true,textFonts:done.textFonts,textWarnings:done.textWarnings,coverage:done.coverage};}finally{unpin();}}
 constructor(store,renderer){this.store=store;this.renderer=renderer;this.cache=new Map();}
 async start(args){await this.renderer.ready;const project=await this.store.snapshot();this.store.check(args.expectedRevision,args.expectedProjectId);const p=project.schemaVersion===2?structuredClone(project):convertV1(project),seq=p.sequences.find(s=>s.id===(args.sequenceId||p.activeSequenceId));if(!seq)throw new EditError('INVALID_ARGUMENT','Unknown draft sequence.');p.activeSequenceId=seq.id;seq.exportRange=null;
  const duration=Math.max(0,...timeline(p).map(i=>i.end)),fps=seq.timebase.numerator/seq.timebase.denominator,start=Math.floor((args.start??0)*fps)/fps,end=Math.min(duration,Math.ceil((args.end??Math.min(duration,start+5))*fps)/fps);
  if(!Number.isFinite(start)||!Number.isFinite(end)||start<0||end<=start||end-start>10.1)throw new EditError('INVALID_ARGUMENT','Draft range must be a nonempty interval of at most ten seconds.');
  const sources=await sourceFingerprints(this.store,usedSources(p,{start,end}));const draftRange={start,end,...(args.quality==='native'?{}:{longEdge:640,fps:15})},key=createHash('sha256').update(canonical({project:p,draftRange,sources,textFonts:await textFontSnapshot(p),transitionResources:await pairResourceSnapshot(p),version:2})).digest('hex'),old=this.renderer.jobs.get(this.cache.get(key));if(old&&!old.evicted&&!['failed','canceled','interrupted'].includes(old.status))return structuredClone(old);
  const job=this.renderer.jobService.start('draft',{project:p,draftRange},async(request,j)=>{j.draftRange=request.draftRange;await this.renderer.render(request.project,j);},{revision:project.revision,preview:true,draftRange,cacheKey:key});this.cache.set(key,job.id);return job;
 }
}
