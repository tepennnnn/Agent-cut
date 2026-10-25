import {sourceAtPlayback,sliceSpeedCurve} from './time-remap.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
// This bounds the reverse filter's frame batch, not total FFmpeg process RSS.
export function reverseBudget(item,asset,timebase){
 const span=item.sourceOut-item.sourceIn;if(span>60)throw Error('Reverse playback supports at most 60 source seconds per item.');
 if(asset.kind==='audio')return {span};
 if(!Number.isSafeInteger(asset.width)||!Number.isSafeInteger(asset.height)||asset.width<1||asset.height<1||asset.width*asset.height>3840*2160)throw Error('Reverse video requires known source dimensions up to 3840×2160 pixels.');
 const fps=timebase.numerator/timebase.denominator/item.speed,frames=Math.ceil(span*fps-1e-8),batch=Math.max(1,Math.floor(256*1024*1024/(asset.width*asset.height*16))),chunks=Math.ceil(frames/batch);
 if(chunks>256)throw Error('Reverse video exceeds the 256-chunk render limit; shorten the source range or increase speed.');return {span,fps,frames,batch,chunks};
}
export function sourceSlice(item,from,to){
 if(item.speedCurve)return {sourceIn:item.sourceIn+sourceAtPlayback(item.speedCurve,from),sourceOut:item.sourceIn+sourceAtPlayback(item.speedCurve,to),speedCurve:sliceSpeedCurve(item.speedCurve,from,to)};
 return item.reverse?{sourceIn:item.sourceOut-to*item.speed,sourceOut:item.sourceOut-from*item.speed}:{sourceIn:item.sourceIn+from*item.speed,sourceOut:item.sourceIn+to*item.speed};
}
export async function prepareReverseVideo(store,item,asset,timebase,work,tag,onProgress=()=>{}){
 const {run,probe}=await import('./engine.mjs'),actual=await probe(store.ffmpeg,store.assetPath(asset));if(actual.kind!=='video'||item.sourceOut>actual.duration+.001)throw Error('Reverse source no longer matches saved video bounds; review and relink it.');const b=reverseBudget(item,actual,timebase),files=[];
 const normalized=`reverse-${tag}-forward.nut`;
 // Normalize the entire retained source once. Chunk-local source seeks can skip
 // frames at fractional rates; a canonical frame grid prevents those seams.
 await run(store.ffmpeg,['-hide_banner','-nostdin','-y','-protocol_whitelist','file,pipe','-ss',String(item.sourceIn),'-t',String(b.span),'-i',store.assetPath(asset),'-map','0:v:0','-an','-vf',`setpts=PTS-STARTPTS,tpad=stop_mode=clone:stop_duration=${1/b.fps},fps=${b.fps},trim=end_frame=${b.frames}`,'-frames:v',String(b.frames),'-c:v','ffv1','-level','3','-pix_fmt','yuv444p','-threads','1',normalized],{cwd:work,timeout:120000});
 for(let k=0;k<b.chunks;k++){
  const first=k*b.batch,count=Math.min(b.batch,b.frames-first),start=Math.max(0,(first-.5)/b.fps),name=`reverse-${tag}-${k}.nut`;
  await run(store.ffmpeg,['-hide_banner','-nostdin','-y','-protocol_whitelist','file,pipe','-ss',String(start),'-i',normalized,'-map','0:v:0','-an','-vf',`trim=end_frame=${count},reverse,setpts=PTS-STARTPTS`,'-frames:v',String(count),'-c:v','ffv1','-level','3','-pix_fmt','yuv444p','-threads','1',name],{cwd:work,timeout:120000});
  files.unshift(name);onProgress((k+1)/b.chunks);
 }
 const list=`reverse-${tag}.txt`,file=`reverse-${tag}.nut`;await fs.writeFile(path.join(work,list),files.map(f=>`file '${f}'`).join('\n'));
 // Concat packet durations are rounded in microseconds. Rebuild timestamps from
 // frame index so a later fps filter cannot drop frames at fractional-rate seams.
 await run(store.ffmpeg,['-hide_banner','-nostdin','-y','-protocol_whitelist','file,pipe','-f','concat','-safe','1','-i',list,'-vf',`setpts=N/(${b.fps}*TB),fps=${b.fps}`,'-frames:v',String(b.frames),'-c:v','ffv1','-level','3','-pix_fmt','yuv444p','-threads','1',file],{cwd:work,timeout:120000});return path.join(work,file);
}
