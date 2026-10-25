import {validateKeyframes,keyframeExpression} from './keyframes.mjs';
export const adjustmentDefaults={brightness:0,contrast:1,saturation:1};
export function validateAdjustments(track,total,ids,seconds){
 if(track.adjustments===undefined)return;
 if(track.kind!=='video'||!Array.isArray(track.adjustments)||track.adjustments.length>32)throw Error('Adjustment spans require a video track and at most 32 spans.');
 const ordered=[...track.adjustments].sort((a,b)=>seconds(a.start)-seconds(b.start));
 for(let n=0;n<ordered.length;n++){const a=ordered[n],start=seconds(a.start),end=seconds(a.end);
   if(typeof a.id!=='string'||!a.id||ids.has(a.id)||typeof a.name!=='string'||!a.name.trim()||a.name.length>80||start<0||end<start+.01||end>total+.001||n&&start<seconds(ordered[n-1].end)-1e-8)throw Error('Invalid adjustment identity, name, interval or same-track overlap.');ids.add(a.id);
   if(!a.values||typeof a.values!=='object'||Array.isArray(a.values)||Object.keys(a.values).some(k=>!Object.hasOwn(adjustmentDefaults,k)))throw Error('Unsupported adjustment property.');
   if(a.keyframes&&Object.keys(a.keyframes).some(k=>!Object.hasOwn(adjustmentDefaults,k)))throw Error('Unsupported animated adjustment property.');validateKeyframes(a,end-start,'video');
   for(const [key,value]of Object.entries({...adjustmentDefaults,...a.values})){const [min,max]=key==='brightness'?[-.5,.5]:key==='contrast'?[.5,2]:[0,2];if(!Number.isFinite(value)||value<min||value>max)throw Error('Invalid adjustment '+key+'.');}
 }
}
export function adjustmentFilter(span,start,end){
 const v={...adjustmentDefaults,...span.values},expression=key=>span.keyframes?.[key]?keyframeExpression(span.keyframes[key],`(t-${start})`):String(v[key]);return `eq=brightness='${expression('brightness')}':contrast='${expression('contrast')}':saturation='${expression('saturation')}':eval=frame:enable='gte(t,${start})*lt(t,${end})'`;
}
