import path from 'node:path';

// Projection only: the caller owns source selection, probing, hashing, job CWD,
// persistence and review. No decoder, stitching, tracking or downloads live here.
const fields = new Set(['projection','stitched','start','end','width','height','fps','keyframes']);
const cameraFields = new Set(['time','yaw','pitch','roll','hFov']);
const finite = (x,min,max,label) => {if(!Number.isFinite(x)||x<min||x>max)throw Error(`Invalid ${label}.`);return x;};
const closed = (o,allowed,label) => {if(!o||typeof o!=='object'||Array.isArray(o)||Object.keys(o).some(k=>!allowed.has(k)))throw Error(`Invalid ${label} fields.`);};
const wrap = x => ((x+180)%360+360)%360-180;
const number = x => Number(x.toFixed(9)).toString();
export function validateReframeRequest(request,sourceMeta){
 closed(request,fields,'reframe request');
 if(request.projection!=='equirectangular'||request.stitched!==true)throw Error('Explicitly confirmed stitched mono equirectangular input is required; INSV/dual-fisheye stitching is unsupported.');
 if(!sourceMeta||!Number.isSafeInteger(sourceMeta.width)||!Number.isSafeInteger(sourceMeta.height)||sourceMeta.height<1||sourceMeta.width!==sourceMeta.height*2)throw Error('Stitched source must have exact 2:1 dimensions; dimensions alone do not establish stitching.');
 finite(sourceMeta.duration,.001,7200,'source duration');
 const start=finite(request.start===undefined?0:request.start,0,sourceMeta.duration,'source start'),end=finite(request.end,start+.001,sourceMeta.duration,'source end'),duration=end-start;
 if(duration>120)throw Error('Reframe source range must not exceed 120 seconds.');
 const width=request.width===undefined?720:request.width,height=request.height===undefined?1280:request.height,fps=request.fps===undefined?30:request.fps;
 for(const value of [width,height])if(!Number.isSafeInteger(value)||value<160||value>1920||value%2)throw Error('Output dimensions must be even integers from 160 to 1920.');
 finite(fps,1,30,'output fps');
 const frames=request.keyframes===undefined?[{time:0,yaw:0,pitch:0,roll:0,hFov:90}]:request.keyframes;
 if(!Array.isArray(frames)||!frames.length||frames.length>32)throw Error('Supply 1–32 camera keyframes.');
 const keyframes=frames.map((k,i)=>{closed(k,cameraFields,'camera keyframe');const result={time:finite(k.time,0,duration,'camera time'),yaw:finite(k.yaw,-180,180,'yaw'),pitch:finite(k.pitch,-85,85,'pitch'),roll:finite(k.roll,-180,180,'roll'),hFov:finite(k.hFov,30,120,'horizontal FOV')};if(i&&result.time<=frames[i-1].time)throw Error('Camera times must strictly increase.');return result;});
 return {projection:'equirectangular',stitched:true,start,end,duration,width,height,fps,keyframes};
}
export function interpolateCamera(keyframes,time){
 if(!Array.isArray(keyframes)||!keyframes.length||!Number.isFinite(time))throw Error('Camera samples and finite time required.');
 let a=keyframes[0],b=a;
 for(let i=1;i<keyframes.length;i++){b=keyframes[i];if(time<=b.time)break;a=b;}
 const u=a===b?0:Math.max(0,Math.min(1,(time-a.time)/(b.time-a.time))),smooth=u*u*(3-2*u);
 // Smoothstep endpoints avoid abrupt starts/stops. Yaw and roll use the
 // shortest arc; this format intentionally cannot encode full camera spins.
 return {yaw:wrap(a.yaw+wrap(b.yaw-a.yaw)*smooth),pitch:a.pitch+(b.pitch-a.pitch)*smooth,roll:wrap(a.roll+wrap(b.roll-a.roll)*smooth),hFov:a.hFov+(b.hFov-a.hFov)*smooth};
}
function checked(r){return validateReframeRequest(Object.fromEntries(Object.entries(r).filter(([k])=>k!=='duration')),{width:2,height:1,duration:r.end});}
function basename(value){if(typeof value!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,100}$/.test(value)||value.includes('..'))throw Error('Use a safe owned-job basename.');return value;}
const verticalFov = (r,c) => 2*Math.atan(Math.tan(c.hFov*Math.PI/360)*r.height/r.width)*180/Math.PI;
export function buildCommandFile(request){
 const r=checked(request),lines=[];
 for(let frame=0;frame<Math.ceil(r.duration*r.fps-1e-9);frame++){
  const time=frame/r.fps,c=interpolateCamera(r.keyframes,time);
  const commands={yaw:c.yaw,pitch:c.pitch,roll:c.roll,h_fov:c.hFov,v_fov:verticalFov(r,c)};
  // sendcmd parses clock timestamps at microsecond precision. Place a command
  // just before its frame to prevent rounding delaying e.g. frame 2 at 30 fps.
  lines.push(`${number(Math.max(0,time-.000001))} `+Object.entries(commands).map(([key,value])=>`v360@camera ${key} ${number(value)}`).join(', ')+`;`);
 }
 return lines.join('\n')+'\n';
}
export function v360Filter(request,commandBasename='camera-commands.txt'){
 const r=checked(request),c=interpolateCamera(r.keyframes,0);
 // FFmpeg otherwise compounds runtime rotations. Absolute camera commands
 // require reset_rot=1 (verified by direction and seam pixel tests).
 return `setpts=PTS-STARTPTS,fps=${number(r.fps)},sendcmd=f=${basename(commandBasename)},v360@camera=input=equirect:output=flat:w=${r.width}:h=${r.height}:interp=line:reset_rot=1:yaw=${number(c.yaw)}:pitch=${number(c.pitch)}:roll=${number(c.roll)}:h_fov=${number(c.hFov)}:v_fov=${number(verticalFov(r,c))},setsar=1,format=yuv420p`;
}
export function buildReframeArgs(request,{inputPath,outputBasename='reframed.mp4',commandBasename='camera-commands.txt'}={}){
 const r=checked(request);
 if(typeof inputPath!=='string'||!path.isAbsolute(inputPath)&&!path.win32.isAbsolute(inputPath)||inputPath.startsWith('\\\\')||inputPath.startsWith('//')||/[\0\r\n]/.test(inputPath)||/^[a-z]+:\/\//i.test(inputPath))throw Error('Absolute local input path required.');
 const output=basename(outputBasename);if(!output.endsWith('.mp4'))throw Error('Output must be MP4.');
 return ['-hide_banner','-nostdin','-y','-threads','2','-filter_threads','1','-protocol_whitelist','file,pipe','-ss',number(r.start),'-t',number(r.duration),'-i',inputPath,'-map','0:v:0','-map','0:a:0?','-vf',v360Filter(r,commandBasename),'-af','asetpts=PTS-STARTPTS','-t',number(r.duration),'-c:v','libx264','-threads','2','-preset','veryfast','-crf','20','-pix_fmt','yuv420p','-c:a','aac','-ac','2','-ar','48000','-movflags','+faststart',output];
}
