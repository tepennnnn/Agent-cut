export const audioDefaults={gainDb:0,pan:0,channel:'stereo',highpassHz:0,lowpassHz:0,lowEqDb:0,midEqDb:0,highEqDb:0,noiseReductionDb:0,humHz:0,deess:0};
const bounds={gainDb:[-60,24],pan:[-1,1],highpassHz:[0,1000],lowpassHz:[0,20000],lowEqDb:[-24,24],midEqDb:[-24,24],highEqDb:[-24,24],noiseReductionDb:[0,50],deess:[0,1],limiterDb:[-20,0]};
export function validateAudio(values,kind='audio'){
 if(values===undefined)return;if(kind!=='audio'||!values||typeof values!=='object'||Array.isArray(values))throw Error('Audio processing requires an audio item/track.');
 for(const [key,value]of Object.entries(values)){
   if(key==='channel'){if(!['stereo','left','right','mono'].includes(value))throw Error('Unsupported audio channel mapping.');}
   else if(key==='humHz'){if(![0,50,60].includes(value))throw Error('Hum filter requires 0, 50 or 60 Hz.');}
   else if(key==='compressor'){
     if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Invalid compressor.');const ranges={thresholdDb:[-60,0],ratio:[1,20],attackMs:[.01,2000],releaseMs:[.01,9000],makeupDb:[0,24]};
     for(const [name,number]of Object.entries(value))if(!ranges[name]||!Number.isFinite(number)||number<ranges[name][0]||number>ranges[name][1])throw Error('Invalid compressor '+name+'.');
   }else if(!Object.hasOwn(bounds,key)||!Number.isFinite(value)||value<bounds[key][0]||value>bounds[key][1])throw Error('Invalid audio processor '+key+'.');
 }
 if(values.highpassHz&&values.lowpassHz&&values.highpassHz>=values.lowpassHz)throw Error('High-pass cutoff must be below low-pass cutoff.');
}
export function audioProcessingFilter(values){
 if(!values||!Object.keys(values).length)return 'anull';validateAudio(values);const a={...audioDefaults,...values},filters=[];
 if(a.channel==='left'||a.channel==='right'){const n=a.channel==='left'?0:1;filters.push(`pan=stereo|c0=c${n}|c1=c${n}`);}else if(a.channel==='mono')filters.push('pan=stereo|c0=0.5*c0+0.5*c1|c1=0.5*c0+0.5*c1');
 if(a.gainDb)filters.push(`volume=${a.gainDb}dB`);if(a.pan)filters.push(`pan=stereo|c0=${a.pan>0?1-a.pan:1}*c0|c1=${a.pan<0?1+a.pan:1}*c1`);
 if(a.highpassHz)filters.push(`highpass=f=${a.highpassHz}`);if(a.lowpassHz)filters.push(`lowpass=f=${a.lowpassHz}`);
 if(a.lowEqDb)filters.push(`bass=g=${a.lowEqDb}:f=100`);if(a.midEqDb)filters.push(`equalizer=f=1000:t=q:w=1:g=${a.midEqDb}`);if(a.highEqDb)filters.push(`treble=g=${a.highEqDb}:f=3000`);
 if(a.compressor){const c={thresholdDb:-18,ratio:3,attackMs:20,releaseMs:250,makeupDb:0,...a.compressor};filters.push(`acompressor=threshold=${10**(c.thresholdDb/20)}:ratio=${c.ratio}:attack=${c.attackMs}:release=${c.releaseMs}:makeup=${10**(c.makeupDb/20)}`);}
 if(a.noiseReductionDb)filters.push(`afftdn=nr=${a.noiseReductionDb}`);if(a.humHz)for(const multiple of [1,2,3])filters.push(`equalizer=f=${a.humHz*multiple}:t=q:w=10:g=-30`);if(a.deess)filters.push(`deesser=i=${a.deess}:m=0.5:f=0.5`);
 if(a.limiterDb!==undefined)filters.push(`alimiter=limit=${10**(a.limiterDb/20)}:level=0:latency=1`);return filters.join(',')||'anull';
}
