import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
const recipeBytes=await fs.readFile(new URL('./wgfx-recipes.json',import.meta.url));
const data=JSON.parse(recipeBytes),recipeSha256=createHash('sha256').update(recipeBytes).digest('hex');
const recipes=new Map(data.recipes.map(r=>[r.id,r]));
export const wgfxRecipe=id=>recipes.get(id);
const f=v=>{if(!Number.isFinite(v)||Math.abs(v)>10000)throw Error('Invalid local transition recipe.');return Number(v.toFixed(6)).toString();};
// Remove collinear samples before compiling expressions. Perspective evaluates
// these once per frame; the optional pixel mapping uses only nonconstant curves.
function curve(recipe,key,p){let points=recipe.samples.map((s,i)=>[i/8,s[key]]);for(let i=1;i<points.length-1;){const a=points[i-1],b=points[i],c=points[i+1],v=a[1]+(c[1]-a[1])*(b[0]-a[0])/(c[0]-a[0]);if(Math.abs(v-b[1])<.00001)points.splice(i,1);else i++;}if(points.every(x=>x[1]===points[0][1]))return f(points[0][1]);let expr=f(points.at(-1)[1]);for(let i=points.length-2;i>=0;i--){const [t,v]=points[i],[end,next]=points[i+1];const line=Math.abs(next-v)<.000001?f(v):`(${f(v)}+${f((next-v)/(end-t))}*((${p})-${f(t)}))`;expr=`if(lt(${p},${f(end)}),${line},${expr})`;}return expr;}
export function wgfxFilter(id,begin,duration,{fps=30,width=720,height=1280,clockOffset=0}={}){
 const r=recipes.get(id);if(!r)throw Error('Unknown WGFX adaptation.');
 const end=begin+duration,enable=`between(t,${f(begin)},${f(end)})`,phase=`clip((on/${f(fps)}+${f(clockOffset)}-${f(begin)})/${f(duration)},0,1)`,envelope=`sin(PI*(${phase}))`;
 const sx=`max(0.2,1+((${curve(r,'sx',phase)})-1)*${envelope})`,sy=`max(0.2,1+((${curve(r,'sy',phase)})-1)*${envelope})`,angle=`(${curve(r,'angle',phase)})*PI/180*${envelope}`,px=`(${curve(r,'x',phase)})*W*${envelope}`,py=`(${curve(r,'y',phase)})*H*${envelope}`;
 const x=(a,b)=>`W/2+(${a}*W/2)*(${sx})*cos(${angle})-(${b}*H/2)*(${sy})*sin(${angle})+${px}`;
 const y=(a,b)=>`H/2+(${a}*W/2)*(${sx})*sin(${angle})+(${b}*H/2)*(${sy})*cos(${angle})+${py}`;
 let result=',format=gbrap';
 if(r.samples.some(s=>s.sx!==1||s.sy!==1||s.angle!==0||s.x!==0||s.y!==0))result+=`,perspective=x0='${x(-1,-1)}':y0='${y(-1,-1)}':x1='${x(1,-1)}':y1='${y(1,-1)}':x2='${x(-1,1)}':y2='${y(-1,1)}':x3='${x(1,1)}':y3='${y(1,1)}':sense=destination:eval=frame:enable='${enable}'`;
 const p=`clip((T-${f(begin)})/${f(duration)},0,1)`,env=`sin(PI*(${p}))`,ox=curve(r,'offsetX',p),oy=curve(r,'offsetY',p),lens=curve(r,'lens',p),turb=curve(r,'turbulence',p);
 if(r.samples.some(s=>s.offsetX||s.offsetY||s.red||s.green||s.blue||s.lens||s.turbulence)){
  // Wrap offsets; radial distortion and per-channel trails are local adaptations
  // of Adobe's lens/turbulence/channel blur operators, not their proprietary math.
  const active=key=>r.samples.some(s=>Math.abs(s[key])>.000001),hasLens=active('lens'),wrapX=active('offsetX'),wrapY=active('offsetY'),hasTurb=active('turbulence');
  const mapped=channel=>{let prefix=`st(0,${p});st(1,sin(PI*ld(0)));`,x='X',y='Y';
   if(hasLens){prefix+=`st(2,1+(${curve(r,'lens','ld(0)')})*ld(1)*(((X-W/2)/W)^2+((Y-H/2)/H)^2));`;x='W/2+(X-W/2)*ld(2)';y='H/2+(Y-H/2)*ld(2)';}
   if(wrapX)x+=`-(${curve(r,'offsetX','ld(0)')})*W`;if(wrapY)y+=`-(${curve(r,'offsetY','ld(0)')})*H`;
   if(hasTurb)x+=`+(${curve(r,'turbulence','ld(0)')})*W*sin(Y/H*36+ld(0)*19)*ld(1)`;
   if(channel!=='green'&&active(channel))x+=`+min(0.03,${curve(r,channel,'ld(0)')})*W*ld(1)*${channel==='red'?1:-1}`;
   if(wrapX)x=`mod(mod(${x},W)+W,W)`;if(wrapY)y=`mod(mod(${y},H)+H,H)`;
   return prefix+`${channel[0]}(${x},${y})`;};
  result+=`,geq=r='${mapped('red')}':g='${mapped('green')}':b='${mapped('blue')}':a='alpha(X,Y)':enable='${enable}'`;
 }
 const peak=key=>Math.max(...r.samples.map(s=>s[key]));
 const middle=`between(t,${f(begin+duration*.18)},${f(begin+duration*.82)})`;
 if(peak('blur')>.02)result+=`,gblur=sigma=${f(Math.min(4,Math.max(.3,peak('blur')*height/480)))}:planes=7:enable='${middle}'`;
 if(peak('echo')>.02)result+=`,tmix=frames=3:weights='1 0.35 0.15':enable='${middle}'`;
 if(peak('flash')>.02){const t=`clip((t-${f(begin)})/${f(duration)},0,1)`;result+=`,eq=brightness='min(0.18,(${curve(r,'flash',t)})*0.18)*sin(PI*${t})':saturation=1.15:eval=frame:enable='${enable}'`;}
 if(peak('noise')>.01)result+=`,noise=alls=${f(Math.min(20,peak('noise')*20))}:allf=t:all_seed=42:enable='${middle}'`;
 return result+',format=rgba';
}
export function wgfxEvidence(transitions){return transitions.filter(t=>recipes.has(t.type)).map(t=>{const r=recipes.get(t.type);return {transitionId:t.id,preset:r.id,name:r.name,sourceSha256:data.sourceSha256,sourceObjectIds:r.sourceObjectIds,sourceEffects:r.effects,omittedAdobeOperators:r.effects.filter(e=>['AE.ADBE Mirror','AE.ADBE Invert'].includes(e)),adapted:true,limitations:'Sampled source curves; Adobe interpolation, mirror, blur, echo and lens operators are approximated.'};});}

export function wgfxResourceSnapshot(project){if(project?.schemaVersion!==2)return null;const ids=new Set(),visited=new Set();function visit(id){if(visited.has(id))return;visited.add(id);const sequence=project.sequences.find(s=>s.id===id);for(const t of sequence?.transitions||[])if(recipes.has(t.type))ids.add(t.type);for(const t of sequence?.tracks||[])for(const i of t.items){const a=project.assets.find(a=>a.id===i.assetId);if(a?.kind==='sequence')visit(a.sequenceId);}}visit(project.activeSequenceId);return ids.size?{sha256:recipeSha256,sourceSha256:data.sourceSha256,presets:[...ids].sort()}:null;}
