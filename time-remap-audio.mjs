import {checkJob} from './job-context.mjs';import fs from 'node:fs/promises';
import path from 'node:path';
import {validateItemRemap} from './time-remap.mjs';

// Offline resampling: pitch follows speed. Source storage is bounded to 60s;
// output is written in chunks rather than retaining a second full PCM buffer.
export async function prepareRemappedAudio(store,item,asset,work,tag) {
  validateItemRemap(item);
  const {run,probe}=await import('./engine.mjs');
  const input=store.assetPath(asset),actual=await probe(store.ffmpeg,input);
  if(!actual.hasAudio||item.sourceOut>actual.duration+.001)throw Error('Time-remap audio source changed; review and relink it.');
  const decoded=path.join(work,`remap-${tag}-source.f32`),output=path.join(work,`remap-${tag}.f32`),rate=48000,channels=2;
  await run(store.ffmpeg,['-hide_banner','-nostdin','-y','-protocol_whitelist','file,pipe','-ss',String(item.sourceIn),'-t',String(item.sourceOut-item.sourceIn),'-i',input,'-vn','-ar',String(rate),'-ac',String(channels),'-c:a','pcm_f32le','-f','f32le',decoded],{timeout:120000});
  const stat=await fs.stat(decoded);
  if(stat.size>60.1*rate*channels*4||stat.size%8||stat.size<8)throw Error('Decoded time-remap audio exceeds its PCM budget or is empty.');
  const pcm=await fs.readFile(decoded),frames=pcm.length/8,curve=item.speedCurve,total=Math.round(curve.at(-1).time*rate);
  if(frames+rate*.05<(item.sourceOut-item.sourceIn)*rate)throw Error('Decoded audio is shorter than the retained source range.');
  const file=await fs.open(output,'w');
  let segment=1,sourceBase=0;
  try {
    for(let begin=0;begin<total;begin+=4096) {
      checkJob();const count=Math.min(4096,total-begin),chunk=Buffer.alloc(count*8);
      for(let j=0;j<count;j++) {
        const time=(begin+j)/rate;
        while(segment<curve.length-1&&time>curve[segment].time) {
          const a=curve[segment-1],b=curve[segment];sourceBase+=(b.time-a.time)*(a.speed+b.speed)/2;segment++;
        }
        const a=curve[segment-1],b=curve[segment],dt=time-a.time,k=(b.speed-a.speed)/(b.time-a.time),position=(sourceBase+a.speed*dt+k*dt*dt/2)*rate,speed=a.speed+k*dt;
        // Windowed-sinc interpolation with a speed-dependent anti-alias cutoff.
        const cutoff=Math.min(1,1/speed),radius=16,first=Math.floor(position)-radius+1;
        let left=0,right=0,weight=0;
        for(let n=first;n<=first+2*radius-1;n++) {
          const distance=position-n;if(Math.abs(distance)>=radius)continue;
          const x=Math.PI*distance*cutoff,w=(Math.abs(x)<1e-12?cutoff:Math.sin(x)/(Math.PI*distance))*.5*(1+Math.cos(Math.PI*distance/radius));
          const index=Math.min(frames-1,Math.max(0,n))*8;
          left+=pcm.readFloatLE(index)*w;right+=pcm.readFloatLE(index+4)*w;weight+=w;
        }
        chunk.writeFloatLE(left/weight,j*8);chunk.writeFloatLE(right/weight,j*8+4);
      }
      await file.writeFile(chunk);
    }
  } finally {await file.close();}
  return output;
}
