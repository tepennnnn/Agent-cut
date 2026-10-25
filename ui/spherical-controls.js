export function mountSphericalControls({host,el,call,run,dialog,getProject,status,onProject}){
 const details=el('details'),review=el('div'),actions=el('div','buttons');
 details.append(el('summary','','360° reframing'),el('p','muted','Export full-sphere 360 Video from Studio first, then import its stitched 2:1 MP4. Compare four directions before creating a flat clip. No subject tracking.'),actions,review);host.append(details);
 const invoke=(action,extra={})=>call('sphere_reframe',{action,expectedProjectId:getProject().projectId,...extra});
 const button=(parent,label,fn)=>{const b=el('button','',label);b.onclick=()=>run(fn);parent.append(b);return b;};
 const read=async jobId=>{
  const result=await invoke('read',{jobId});review.replaceChildren();
  if(result.images){
   const image=el('img');image.alt=result.grid;image.src='data:image/jpeg;base64,'+result.images[0].data;image.style.width='100%';review.append(image,el('p','',result.grid),el('p','',`Source rows: ${result.sampleTimes.map(t=>t.toFixed(2)+' s').join(', ')}. Directions are relative to Studio orientation; they are not ranked.`));
   for(const angle of result.angles)button(review,'Choose '+angle.id,()=>cameraDialog(result,angle));
  }else{
   review.append(el('p','','Flat clip ready: '+result.outputPath));
   const video=el('video');video.controls=true;video.preload='metadata';video.style.width='100%';
   // The authenticated owned-export route serves only this retained job output.
   import('/session.js').then(({token})=>{video.src='/exports/'+jobId+'?token='+encodeURIComponent(token);});review.append(video);
   button(review,'Import this flat clip',async()=>{const next=await call('media_import',{path:result.outputPath});await onProject(next);status('Flat clip imported. Add it to a reviewed edit plan when ready.');});
  }
 };
 const start=async(action,request)=>{const job=await invoke(action,{expectedRevision:getProject().revision,request});review.replaceChildren(el('p','',`Local job ${job.id}. Use “Review completed 360 job” when complete.`));status('360 job queued. Monitor Local jobs & cache.');};
 function cameraDialog(result,angle){
  dialog('Render a chosen 360 view',[['yaw','Opening yaw (degrees)',angle.yaw,-180,180,1],['pitch','Opening pitch (degrees)',0,-85,85,1],['endYaw','Ending yaw (degrees)',angle.yaw,-180,180,1],['endPitch','Ending pitch (degrees)',0,-85,85,1],['hFov','Horizontal field of view',90,30,120,1],['aspect','Output shape','portrait',undefined,undefined,undefined,['portrait','landscape','square']]],async v=>{
   const shape={portrait:[720,1280],landscape:[1280,720],square:[720,720]}[v.aspect];
   await start('render',{assetId:result.assetId,projection:'equirectangular',stitched:true,start:result.camera.start,end:result.camera.end,width:shape[0],height:shape[1],fps:30,keyframes:[{time:0,yaw:v.yaw,pitch:v.pitch,roll:0,hFov:v.hFov},{time:result.camera.duration,yaw:v.endYaw,pitch:v.endPitch,roll:0,hFov:v.hFov}]});
  });
 }
 button(actions,'Suggest four angles',()=>{
  const assets=getProject().assets.filter(a=>a.kind==='video'&&a.width===a.height*2);if(!assets.length)throw Error('Import a stitched mono 2:1 equirectangular video from Studio first.');
  dialog('Review stitched 360 source',[['assetId','Stitched video',assets[0].id,undefined,undefined,undefined,assets.map(a=>({value:a.id,label:a.name}))],['start','Source start (seconds)',0,0,7200,.01],['end','Source end (maximum 120 seconds)',Math.min(10,assets[0].duration),.01,7200,.01],['stitched','I confirm this is stitched mono equirectangular 360 video',false]],async request=>{if(!request.stitched)throw Error('Confirm the Studio full-sphere export before reframing.');await start('suggest',{...request,projection:'equirectangular'});});
 });
 button(actions,'Review completed 360 job',async()=>{
  const {jobs}=await call('job_control',{action:'list',expectedProjectId:getProject().projectId}),complete=jobs.filter(j=>j.kind?.startsWith('spherical-')&&j.status==='complete'&&!j.evicted);if(!complete.length)throw Error('No completed 360 jobs yet.');
  dialog('Review 360 result',[['jobId','Completed 360 job',complete.at(-1).id,undefined,undefined,undefined,complete.map(j=>({value:j.id,label:j.kind+' · '+j.id.slice(0,8)}))]],v=>read(v.jobId));
 });
}
