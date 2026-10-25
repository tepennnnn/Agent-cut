import fs from 'node:fs/promises';import path from 'node:path';import {spawn} from 'node:child_process';import {sourceSlice,prepareReverseVideo} from './reverse.mjs';import {timeSeconds} from './sequences.mjs';import {checkJob} from './job-context.mjs';import {createGLSession,glSpec} from './gl-renderer.mjs';
export async function prepareGLPair(store,left,right,{canvas,duration,work,tag,kind,sessionProvider},job){
 const {run,videoFilter}=await import('./engine.mjs'),folder=await fs.mkdtemp(path.join(work,'gl-'+tag+'-')),frames=Math.ceil(duration*canvas.fps-1e-8),output=path.join(work,'gl-'+tag+'.nut');
 try{
  for(const [side,meta]of [['a',left],['b',right]]){
   checkJob();const original=meta.item,length=timeSeconds(original.duration),from=side==='a'?length-duration:0,to=from+duration,item={...original,...sourceSlice(original,from,to)},dir=path.join(folder,side);await fs.mkdir(dir);
   const inputStore=meta.path?{ffmpeg:store.ffmpeg,assetPath:()=>meta.path}:store;
   const reverse=item.reverse?await prepareReverseVideo(inputStore,item,meta.asset,{numerator:Math.round(canvas.fps*1000),denominator:1000},folder,side):null;
   const source=reverse||meta.path||store.assetPath(meta.asset),ss=reverse?0:item.frameHold?.sourceTime??item.sourceIn,span=item.frameHold?Math.min(1,meta.asset.duration-item.frameHold.sourceTime):item.sourceOut-item.sourceIn;
   const vf=await videoFilter({canvas},item,folder,side,true,{offset:from,originalDuration:length,renderDuration:duration});
   await fs.writeFile(path.join(folder,side+'.filters'),`[0:v]${vf},trim=start=${from}:end=${to},setpts=PTS-STARTPTS,tpad=stop_mode=clone:stop_duration=${2/canvas.fps},format=rgba[out]`);
   await run(store.ffmpeg,['-hide_banner','-nostdin','-y','-protocol_whitelist','file,pipe','-ss',String(ss),'-t',String(span),'-i',source,'-filter_complex_threads','1','-/filter_complex',side+'.filters','-map','[out]','-an','-frames:v',String(frames),'-start_number','0',path.join(dir,'%d.png')],{cwd:folder,timeout:120000});
  }
  const session=sessionProvider?await sessionProvider(folder,{...canvas,frames}):await createGLSession(folder,{...canvas,frames}),scope=checkJob();let encoder,pid,done,aborted;
  try{
   const runtime=await session.initialize(kind);job.transitionStage='Rendering '+glSpec(kind).name;
   encoder=spawn(store.ffmpeg,['-hide_banner','-nostdin','-y','-f','image2pipe','-framerate',String(canvas.fps),'-c:v','png','-i','pipe:0','-an','-frames:v',String(frames),'-c:v','ffv1','-level','3','-pix_fmt','bgra','-threads','1',output],{windowsHide:true,stdio:['pipe','ignore','pipe'],shell:false});pid=encoder.pid;if(pid)scope?.onSpawn?.(pid);let stderr='',failure;encoder.stderr.on('data',b=>stderr=(stderr+b).slice(-5000));encoder.stdin.on('error',e=>failure=e);
   done=new Promise((r,j)=>{encoder.on('error',j);encoder.on('close',code=>code===0?r():j(Error('GL frame encoder failed: '+stderr)));});done.catch(()=>{});aborted=()=>encoder.kill();scope?.signal.addEventListener('abort',aborted,{once:true});checkJob();
   for(let i=0;i<frames;i++){checkJob();if(failure)throw failure;const png=await session.frame(i,Math.min(1,i/(duration*canvas.fps)));await new Promise((r,j)=>encoder.stdin.write(png,e=>e?j(e):r()));job.progress=10+Math.floor((i+1)/frames*30);}
   encoder.stdin.end();await done;checkJob();return {path:output,evidence:{preset:kind,name:glSpec(kind).name,renderer:'Original GL Transitions 1.76.1 GLSL',runtime,frames,extraTextures:glSpec(kind).textures,offline:true}};
  }finally{scope?.signal.removeEventListener('abort',aborted);if(encoder&&encoder.exitCode===null)encoder.kill();await done?.catch(()=>{});if(pid)scope?.onExit?.(pid);if(!sessionProvider)await session.close();}
 }finally{if(path.dirname(path.resolve(folder))!==path.resolve(work))throw Error('Unsafe GL scratch directory');await fs.rm(folder,{recursive:true,force:true});}
}
