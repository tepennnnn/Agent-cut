import {cueWordAlignment} from './ui/word-timing.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {getPreset,renderFrame} from 'captions.js';
import Konva from 'konva';
import 'konva/skia-backend';
import {FontLibrary} from 'skia-canvas';
import {localFont} from './text-fonts.mjs';
import {motionStyle,localPreset,motionWords} from './ui/caption-model.js';
import {checkJob} from './job-context.mjs';

// Only the pure frame renderer is used. No upstream font loader, remote input,
// transcription service, shell, or independently hosted server is involved.
export async function burnMotionCaptions(store,{input,output,canvas,duration,captions,preset,fontId,alignment,offset=0},job){
 const spec=motionStyle(preset);if(!spec)throw Error('Unknown animated caption style.');
 fontId=fontId||spec.font;const font=await localFont(fontId);FontLibrary.use('AgentCut-'+fontId,[font.file]);
 const settings=localPreset(preset,getPreset,fontId).captionsSettings,words=motionWords(captions,offset,alignment);
 const width=canvas.width,height=canvas.height,fps=canvas.fps,frames=Math.ceil(duration*fps),scope=checkJob();
 const stage=new Konva.Stage({width,height}),layer=new Konva.Layer({listening:false});stage.add(layer);
 const encoder=spawn(store.ffmpeg,['-hide_banner','-nostdin','-y','-protocol_whitelist','file,pipe','-i',input,'-f','rawvideo','-pixel_format','rgba','-video_size',`${width}x${height}`,'-framerate',String(fps),'-i','pipe:0','-filter_complex_threads','1','-filter_complex','[0:v][1:v]overlay=x=0:y=0:format=auto:shortest=1[out]','-map','[out]','-map','0:a?','-t',String(duration),'-c:v','libx264','-preset','veryfast','-crf','20','-pix_fmt','yuv420p','-c:a','copy','-movflags','+faststart',output],{windowsHide:true,stdio:['pipe','ignore','pipe'],shell:false});
 if(encoder.pid)scope?.onSpawn?.(encoder.pid);
 let stderr='',failed;encoder.stderr.on('data',b=>stderr=(stderr+b).slice(-8000));encoder.stdin.on('error',e=>{failed=e;});
 const aborted=()=>encoder.kill();scope?.signal.addEventListener('abort',aborted,{once:true});
 const timer=setTimeout(()=>{failed=Error('Animated captions timed out.');encoder.kill();},7200000);
 const done=new Promise((resolve,reject)=>{encoder.on('error',reject);encoder.on('close',code=>code===0?resolve():reject(Error('Animated caption encoder failed: '+stderr.slice(-2000))));});
 // Attach rejection immediately: an early encoder failure may precede a frame.
 done.catch(()=>{});
 try{
  for(let i=0;i<frames;i++){
   checkJob();if(failed)throw failed;if(encoder.exitCode!==null)throw Error('Caption encoder exited before all frames were written.');
   layer.destroyChildren();renderFrame(settings,undefined,words,i/fps,[width,height],layer,height/480);layer.draw();
   const bytes=await layer.getNativeCanvasElement().toBuffer('raw');
   await new Promise((resolve,reject)=>encoder.stdin.write(bytes,error=>error?reject(error):resolve()));
   job.progress=90+Math.floor((i+1)/frames*9);
  }
  encoder.stdin.end();await done;checkJob();
  job.captionMotion={preset,name:spec.name,renderer:'captions.js 1.10.0',frames,timing:alignment?'Acoustic word alignment where cues match; explicit estimates for changed cues':'Estimated words within measured phrase boundaries',alignedCues:captions.filter(c=>cueWordAlignment(c,alignment)).length,estimatedCues:captions.filter(c=>!cueWordAlignment(c,alignment)).length,font:{id:fontId,sha256:font.sha256},offline:true};
  await fs.writeFile(path.join(path.dirname(output),'caption-motion.json'),JSON.stringify(job.captionMotion,null,2));
 }finally{
  clearTimeout(timer);scope?.signal.removeEventListener('abort',aborted);if(encoder.exitCode===null)encoder.kill();await done.catch(()=>{});if(encoder.pid)scope?.onExit?.(encoder.pid);stage.destroy();
 }
}
