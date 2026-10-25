// Bounded, clip-local automation shared by validation, editing and rendering.
export const animatedProperties={brightness:[-.5,.5],contrast:[.5,2],saturation:[0,2],rotation:[-180,180],offsetX:[-1,1],offsetY:[-1,1],opacity:[0,1],volume:[0,2]};
export function validateKeyframes(item,duration,kind){
 if(item.keyframes===undefined)return;
 const channels=item.keyframes;if(!channels||typeof channels!=='object'||Array.isArray(channels)||Object.keys(channels).length>8)throw Error('Keyframes must be a bounded property map.');
 for(const [property,frames]of Object.entries(channels)){
   const bounds=Object.hasOwn(animatedProperties,property)&&animatedProperties[property];if(!bounds||kind==='audio'&&property!=='volume'||kind==='video'&&property==='volume')throw Error('Keyframe property does not apply to this track.');
   if(!Array.isArray(frames)||!frames.length||frames.length>32)throw Error('Each property requires 1–32 keyframes.');
   for(let i=0;i<frames.length;i++){const k=frames[i];if(!k||typeof k!=='object'||Array.isArray(k)||Object.keys(k).some(key=>!['time','value','interpolation','control1','control2'].includes(key))||!Number.isFinite(k.time)||k.time<0||k.time>duration+1e-8||i&&k.time<=frames[i-1].time||!Number.isFinite(k.value)||k.value<bounds[0]||k.value>bounds[1]||k.interpolation!==undefined&&!['linear','hold','ease_in','ease_out','ease_in_out','bezier'].includes(k.interpolation))throw Error('Invalid keyframe time, value, order or interpolation.');if(k.interpolation==='bezier'){if(!Number.isFinite(k.control1)||!Number.isFinite(k.control2)||k.control1<0||k.control1>1||k.control2<0||k.control2>1)throw Error('Bezier controls must be within 0-1.');}else if(k.control1!==undefined||k.control2!==undefined)throw Error('Control values require Bezier interpolation.');}
 }
}
const controls=k=>k.interpolation==='ease_in'?[0,1/3]:k.interpolation==='ease_out'?[2/3,1]:k.interpolation==='ease_in_out'?[0,1]:[k.control1,k.control2];
const curved=k=>['ease_in','ease_out','ease_in_out','bezier'].includes(k.interpolation);
function curve(k,u){if(!curved(k))return u;const [a,b]=controls(k);return 3*(1-u)**2*u*a+3*(1-u)*u*u*b+u**3;}
function derivative(k,u){const [a,b]=controls(k);return 3*(1-u)**2*a+6*(1-u)*u*(b-a)+3*u*u*(1-b);}
export function keyframeValue(frames,time){
 if(time<=frames[0].time)return frames[0].value;
 for(let i=0;i<frames.length-1;i++){const a=frames[i],b=frames[i+1];if(time<b.time)return a.interpolation==='hold'?a.value:a.value+(b.value-a.value)*curve(a,(time-a.time)/(b.time-a.time));}
 return frames.at(-1).value;
}
export function keyframeExpression(frames,variable='t'){
 let result=String(frames.at(-1).value);
 for(let i=frames.length-2;i>=0;i--){const a=frames[i],b=frames[i+1],u=`((${variable}-${a.time})/${b.time-a.time})`;let weight=u;if(curved(a)){const [c1,c2]=controls(a);weight=`(3*pow(1-${u},2)*${u}*${c1}+3*(1-${u})*pow(${u},2)*${c2}+pow(${u},3))`;}const value=a.interpolation==='hold'?String(a.value):`(${a.value}+(${b.value-a.value})*${weight})`;result=`if(lt(${variable},${b.time}),${value},${result})`;}
 return `if(lt(${variable},${frames[0].time}),${frames[0].value},${result})`;
}
export function sliceKeyframes(item,from,to){
 if(!item.keyframes)return;
 const result={};for(const [property,frames]of Object.entries(item.keyframes)){
   const times=[from,...frames.filter(k=>k.time>from&&k.time<to).map(k=>k.time),to],list=times.map(t=>({time:t-from,value:keyframeValue(frames,t),interpolation:'linear'}));
   for(let j=0;j<times.length-1;j++){const a=times[j],b=times[j+1],index=frames.findIndex((k,i)=>i<frames.length-1&&a>=k.time&&a<frames[i+1].time);if(index<0)continue;const key=frames[index],next=frames[index+1];
     if(!curved(key)){list[j].interpolation=key.interpolation||'linear';continue;}
     if(a===key.time&&b===next.time){list[j].interpolation=key.interpolation;if(key.interpolation==='bezier'){list[j].control1=key.control1;list[j].control2=key.control2;}continue;}
     const u=(a-key.time)/(next.time-key.time),v=(b-key.time)/(next.time-key.time),f0=curve(key,u),f1=curve(key,v),span=f1-f0;if(Math.abs(span)<1e-14)continue;
     const clamp=x=>Math.max(0,Math.min(1,x));Object.assign(list[j],{interpolation:'bezier',control1:clamp(derivative(key,u)*(v-u)/(3*span)),control2:clamp(1-derivative(key,v)*(v-u)/(3*span))});
   }
   if(list.length>1&&list.at(-1).value===list.at(-2).value)list.pop();
   if(list.length>32)throw Error('Fragment keyframes exceed the 32-point limit; simplify automation first.');result[property]=list;
 }item.keyframes=result;
}
