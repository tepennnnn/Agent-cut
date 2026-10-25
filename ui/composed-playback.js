// Rendering runs in the local encoder process. Waiting never occupies the edit queue.
export function composedPlayback({video,call,getProject,getTime,onTime,status,onPlaying,show,token}){
 let generation=0,cached=null,pending=false,wantsPlayback=false;
 const key=p=>p.projectId+':'+p.revision;
 function pause(){generation++;pending=false;wantsPlayback=false;video.pause();onPlaying(false);}
 async function seek(time,resume=false){
   if(!cached||cached.key!==key(getProject())||time<cached.start||time>=cached.end){pause();return false;}
   video.currentTime=time-cached.start;show();onTime(time);if(resume){await video.play();onPlaying(true);}return true;
 }
 async function play({full=false}={}){
   if(pending){pause();return;}const p=getProject();if(!p.duration)return;const mine=++generation,identity=key(p);pending=true;wantsPlayback=true;
   try{
     const start=getTime()>=p.duration-.02?0:getTime();if(!cached||cached.key!==identity||cached.full!==full||start<cached.start||start>=cached.end-.02){status(full?'Composing full playback locally…':'Composing five-second preview locally… You can keep editing.');let job=full?await call('render_start',{preview:true,queue:true,expectedRevision:p.revision}):await call('draft_start',{expectedProjectId:p.projectId,expectedRevision:p.revision,start,end:Math.min(p.duration,start+5)});
       while(['queued','rendering','canceling'].includes(job.status)){await new Promise(r=>setTimeout(r,250));if(mine!==generation||key(getProject())!==identity)return;job=await call('render_status',{jobId:job.id});}
       if(job.status!=='complete')throw Error(job.error||'Composed playback failed.');if(mine!==generation||key(getProject())!==identity)return;
       await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{cleanup();reject(Error('Playback metadata timed out.'));},10000);const cleanup=()=>{clearTimeout(timer);video.removeEventListener('loadedmetadata',ok);video.removeEventListener('error',bad);};const ok=()=>{cleanup();resolve();},bad=()=>{cleanup();reject(Error('Browser cannot play composed preview.'));};video.addEventListener('loadedmetadata',ok);video.addEventListener('error',bad);video.src=`/exports/${job.id}?token=${token}`;video.load();});
       if(mine!==generation||key(getProject())!==identity)return;cached={key:identity,full,warnings:job.textWarnings,start:job.coverage?.start??0,end:job.coverage?.end??p.duration};
     }
     await seek(start,true);status('Playing composed sequence.'+(cached.warnings?.length?' '+cached.warnings.join(' '):''),!!cached.warnings?.length);
   }catch(e){if(mine===generation){wantsPlayback=false;onPlaying(false);status(e.message,true);}}finally{if(mine===generation)pending=false;}
 }
 video.addEventListener('timeupdate',()=>{if(getProject()?.schemaVersion===2&&cached?.key===key(getProject()))onTime(Math.min(cached.end,cached.start+video.currentTime));});
 video.addEventListener('ended',()=>{onPlaying(false);if(wantsPlayback&&cached?.key===key(getProject())&&cached.end<getProject().duration-.02){onTime(cached.end);void play();}else wantsPlayback=false;});
 return {play,pause,seek};
}
