import path from 'node:path';
import {run,atomic} from './engine.mjs';
export const exportOptionsSchema={type:'object',additionalProperties:false,properties:{preset:{enum:['sequence','web720','web1080','master']},codec:{enum:['h264','hevc','prores']},width:{type:'integer',minimum:160,maximum:3840},height:{type:'integer',minimum:160,maximum:2160},fpsNumerator:{type:'integer',minimum:1,maximum:60000},fpsDenominator:{type:'integer',minimum:1,maximum:1001},crf:{type:'number',minimum:0,maximum:51},videoBitrateKbps:{type:'integer',minimum:100,maximum:100000},audioBitrateKbps:{type:'integer',minimum:64,maximum:320}}};
export function normalizeExport(options={}){
 if(!options||typeof options!=='object'||Array.isArray(options))throw Error('Invalid export options.');for(const k of Object.keys(options))if(!Object.hasOwn(exportOptionsSchema.properties,k))throw Error('Unknown export option '+k);
 const p=options.preset||'sequence';if(!['sequence','web720','web1080','master'].includes(p))throw Error('Unknown export preset.');
 const result={codec:p==='master'?'prores':'h264',crf:20,audioBitrateKbps:192,...(p==='web720'?{width:1280,height:720}:p==='web1080'?{width:1920,height:1080}:{}),...options,preset:p};
 if(!['h264','hevc','prores'].includes(result.codec))throw Error('Unsupported export codec.');
 if((result.width===undefined)!==(result.height===undefined))throw Error('Supply both export width and height.');
 for(const k of ['width','height','fpsNumerator','fpsDenominator','crf','videoBitrateKbps','audioBitrateKbps'])if(result[k]!==undefined){const spec=exportOptionsSchema.properties[k];if(!Number.isFinite(result[k])||result[k]<spec.minimum||result[k]>spec.maximum||spec.type==='integer'&&!Number.isInteger(result[k]))throw Error('Invalid export '+k);}
 if(result.width%2||result.height%2)throw Error('Export dimensions must be even.');
 if((result.fpsNumerator===undefined)!==(result.fpsDenominator===undefined))throw Error('Supply both frame-rate numerator and denominator.');
 if(result.fpsNumerator!==undefined&&(result.fpsNumerator/result.fpsDenominator<12||result.fpsNumerator/result.fpsDenominator>60))throw Error('Export frame rate must be 12–60 fps.');
 if(result.codec==='prores'&&(options.crf!==undefined||options.videoBitrateKbps!==undefined))throw Error('ProRes master uses a fixed 422 profile; omit CRF/bitrate.');
 if(result.codec==='prores')delete result.crf;
 return result;
}
export async function transcodeExport(store,job,options){
 const o=normalizeExport(options),extension=o.codec==='prores'?'mov':'mp4',file='export.'+extension,work=path.dirname(job.path),args=['-hide_banner','-nostdin','-y','-protocol_whitelist','file,pipe','-i',job.path,'-map','0:v:0','-map','0:a:0'];
 const filters=[];if(o.width)filters.push(`scale=${o.width}:${o.height}:force_original_aspect_ratio=decrease,pad=${o.width}:${o.height}:(ow-iw)/2:(oh-ih)/2,setsar=1`);if(o.fpsNumerator)filters.push(`fps=${o.fpsNumerator}/${o.fpsDenominator}`);if(filters.length)args.push('-vf',filters.join(','));
 if(o.codec==='prores')args.push('-c:v','prores_ks','-profile:v','2','-pix_fmt','yuv422p10le','-c:a','pcm_s16le');
 else {args.push('-c:v',o.codec==='hevc'?'libx265':'libx264','-preset','veryfast','-pix_fmt','yuv420p',...(o.videoBitrateKbps?['-b:v',o.videoBitrateKbps+'k']:['-crf',String(o.crf)]),'-c:a','aac','-b:a',o.audioBitrateKbps+'k');if(o.codec==='hevc')args.push('-tag:v','hvc1','-x265-params','pools=1:frame-threads=1');}
 args.push('-ac','2','-ar','48000','-movflags','+faststart',file);await run(store.ffmpeg,args,{cwd:work,timeout:7200000});
 const result={...job,path:path.join(work,file),file:job.id+'/'+file,options:o,container:extension,colorScope:'SDR composition; no HDR conversion or signaling',status:'complete',progress:100};await atomic(path.join(work,'render.json'),result);return result;
}
