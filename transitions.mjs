import {transitionIds,isPairTransition} from './ui/transition-model.js';
import {wgfxFilter} from './wgfx-renderer.mjs';
export const transitionKinds=transitionIds;
export function transitionFilters(incoming,outgoing,length,seconds,canvas={}){
 let result='';
 if(outgoing?.type.startsWith('wgfx_')){const d=seconds(outgoing.duration);result+=wgfxFilter(outgoing.type,length-d,d,canvas);}
 if(outgoing?.type==='dip_black'||outgoing?.type==='dip_white'){const d=seconds(outgoing.duration);result+=`,fade=t=out:st=${length-d}:d=${d/2}:color=${outgoing.type==='dip_white'?'white':'black'}`;}
 if(!incoming)return result;const d=seconds(incoming.duration),kind=incoming.type;
 if(isPairTransition(kind))return result;
 if(kind.startsWith('wgfx_'))return result+wgfxFilter(kind,0,d,canvas)+`,format=rgba,fade=t=in:st=0:d=${d}:alpha=1`;
 if(kind==='cross_dissolve')return result+`,format=rgba,fade=t=in:st=0:d=${d}:alpha=1`;
 if(kind==='dip_black'||kind==='dip_white')return result+`,format=rgba,fade=t=in:st=${d/2}:d=${d/2}:color=${kind==='dip_white'?'white':'black'},geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='alpha(X,Y)*gte(T,${d/2})'`;
 const progress=`clip(T/${d},0,1)`,mask={wipe_left_to_right:`lt(X/W,${progress})`,wipe_right_to_left:`gte(X/W,1-${progress})`,wipe_top_to_bottom:`lt(Y/H,${progress})`,wipe_bottom_to_top:`gte(Y/H,1-${progress})`}[kind];
 if(!mask)throw Error('Unsupported transition kind.');return result+`,format=rgba,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='alpha(X,Y)*(${mask})'`;
}
