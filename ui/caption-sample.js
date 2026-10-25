import {Konva,getPreset,renderFrame} from '/captions-vendor.js';
import {motionStyle,localPreset,motionWords} from '/caption-model.js';
export async function captionSample(container,token){
 const stage=new Konva.Stage({container,width:720,height:320}),layer=new Konva.Layer({listening:false});stage.add(layer);
 let selected='clean',selectedFont='preset',frame=0,started=performance.now(),ready=false;
 const observer=new ResizeObserver(()=>{const width=container.clientWidth;stage.size({width,height:width*320/720});layer.scale({x:width/720,y:width/720});});observer.observe(container);
 const loaded=new Map();
 async function font(id){if(!loaded.has(id))loaded.set(id,(async()=>{const face=new FontFace('AgentCut-'+id,`url(/caption-font/${id}?token=${encodeURIComponent(token)})`);await face.load();document.fonts.add(face);})());await loaded.get(id);}
 const words=motionWords([{text:'Someone inside was calling my name.',start:0,end:3.5}]);
 function draw(now){
  frame=requestAnimationFrame(draw);if(document.hidden||!ready)return;
  const time=((now-started)/1000)%4;layer.destroyChildren();
  if(motionStyle(selected))renderFrame(localPreset(selected,getPreset,selectedFont).captionsSettings,undefined,words,time,[720,320],layer,1.4);
  else layer.add(new Konva.Text({x:30,y:130,width:660,text:'Someone inside was calling my name.',fontFamily:'AgentCut-'+(selectedFont!=='preset'?selectedFont:selected==='clean'?'sans':'sans-bold'),fontSize:32,align:'center',fill:selected==='emphasis'?'#C7F47A':'#FFFFFF'}));
  layer.draw();
 }
 frame=requestAnimationFrame(draw);
 return {async select(id,fontId='preset'){selected=id;selectedFont=fontId;ready=false;try{await font(fontId!=='preset'?fontId:motionStyle(id)?.font||(id==='clean'?'sans':'sans-bold'));if(selected===id&&selectedFont===fontId){started=performance.now();ready=true;}}catch{container.setAttribute('aria-label','Caption sample unavailable; composed preview remains available.');}},destroy(){cancelAnimationFrame(frame);observer.disconnect();stage.destroy();}};
}
