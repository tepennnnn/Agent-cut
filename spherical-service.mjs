import fs from 'node:fs/promises';
import path from 'node:path';
import {EditError,run,atomic,probe} from './engine.mjs';
import {validateObject} from './operations.mjs';
import {ownedDirectory,fileDigest,readLocalJson} from './speech-setup.mjs';
import {checkJob} from './job-context.mjs';
import {validateReframeRequest,buildCommandFile,buildReframeArgs} from './spherical-reframe.mjs';

const number={type:'number'},string={type:'string'};
const base={assetId:string,projection:{enum:['equirectangular']},stitched:{const:true},start:number,end:number};
const keyframe={type:'object',additionalProperties:false,properties:{time:number,yaw:number,pitch:number,roll:number,hFov:number},required:['time','yaw','pitch','roll','hFov']};
export const sphericalContracts={
 suggest:{type:'object',additionalProperties:false,properties:base,required:['assetId','projection','stitched','start','end']},
 render:{type:'object',additionalProperties:false,properties:{...base,width:{type:'integer'},height:{type:'integer'},fps:number,keyframes:{type:'array',minItems:1,maxItems:32,items:keyframe}},required:['assetId','projection','stitched','start','end']}
};
export const sphericalAngles=[{id:'front',yaw:0},{id:'right',yaw:90},{id:'back',yaw:180},{id:'left',yaw:-90}];
const fail=(message,code='SPHERICAL_ARGUMENT')=>{throw new EditError(code,message);};

export class SphericalService{
 constructor(store,renderer){this.store=store;this.renderer=renderer;}
 async call(args){
  this.store.checkIdentity(args.expectedProjectId);
  if(args.action==='contracts')return {contracts:sphericalContracts,limits:{seconds:120,keyframes:32,maxDimension:1920,maxFps:30},workflow:'Studio stitches/stabilizes original INSV locally. Import its mono 2:1 equirectangular MP4, explicitly confirm stitching, suggest angles, review, render a chosen flat view, then explicitly import that file. No timeline edits, subject tracking, INSV stitching or network calls.'};
  if(args.action==='read')return this.read(args.jobId);
  const schema=sphericalContracts[args.action];if(!schema)fail('Choose contracts, suggest, render or read.');
  try{validateObject(args.request,schema);}catch(e){fail(e.message);}
  const snapshot=await this.store.snapshot();this.store.check(args.expectedRevision,args.expectedProjectId);
  const {assetId,...request}=args.request,asset=snapshot.assets.find(a=>a.id===assetId);
  if(!asset||asset.kind==='audio'||asset.kind==='sequence')fail('Choose an imported original stitched video.');
  let camera;try{camera=validateReframeRequest(request,asset);}catch(e){fail(e.message);}
  await this.renderer.ready;
  return this.renderer.jobService.start(args.action==='suggest'?'spherical-suggestions':'spherical-reframe',{asset,camera},(r,j)=>this.execute(r,j),{revision:snapshot.revision,preview:args.action==='suggest',progress:null,scope:'Derived local view only; original source and timeline remain unchanged.'});
 }
 async execute(request,job){
  const {asset,camera}=request,source=this.store.assetPath(asset),sourceSha256=await fileDigest(source),decoderSha256=await fileDigest(this.store.ffmpeg);
  const current=await this.store.snapshot(),live=current.assets.find(a=>a.id===asset.id);
  if(!live||live.file!==asset.file)fail('Source was removed or relinked; create a fresh camera review.','SOURCE_CHANGED');
  if(request.sourceSha256&&request.sourceSha256!==sourceSha256||request.decoderSha256&&request.decoderSha256!==decoderSha256)fail('Source or decoder changed; create a fresh camera review.','SOURCE_CHANGED');
  const sourceMeta=await probe(this.store.ffmpeg,source),{duration,...cameraInput}=camera;
  try{validateReframeRequest(cameraInput,sourceMeta);}catch(e){fail(e.message,'SOURCE_CHANGED');}
  request.sourceSha256=sourceSha256;request.decoderSha256=decoderSha256;await this.renderer.jobService.persist(job,request);
  const exportsRoot=await ownedDirectory(this.store.root,'exports'),dir=await ownedDirectory(exportsRoot,job.id);
  const metadata={version:1,projectId:this.store.projectId,assetId:asset.id,sourceFile:asset.file,sourceSha256,decoderSha256,camera,originJobId:job.id,timelineUnchanged:true,interpretation:'Rectilinear views of explicitly declared stitched equirectangular input; no subject detection or automatic semantic ranking.'};
  if(job.kind==='spherical-suggestions'){
   job.phase='sample four directions at three source times';
   const times=[camera.start,camera.start+camera.duration/2,Math.max(camera.start,camera.end-Math.min(.1,camera.duration/4))];
   for(let row=0;row<times.length;row++)for(let column=0;column<sphericalAngles.length;column++){
    checkJob();const angle=sphericalAngles[column],yaw=angle.yaw,file=`view-${row}-${column}.jpg`;
    const vf=`v360=input=equirect:output=flat:w=240:h=426:yaw=${yaw}:pitch=0:roll=0:h_fov=90:v_fov=121.193512575,setsar=1`;
    await run(this.store.ffmpeg,['-hide_banner','-nostdin','-y','-threads','2','-filter_threads','1','-protocol_whitelist','file,pipe','-ss',String(times[row]),'-i',source,'-map','0:v:0','-vf',vf,'-frames:v','1','-an',file],{cwd:dir,timeout:60000});
   }
   // Explicit concat list contains generated owned basenames only.
   await fs.writeFile(path.join(dir,'views.txt'),times.flatMap((_,row)=>sphericalAngles.map((_,column)=>`file 'view-${row}-${column}.jpg'`)).join('\n')+'\n');
   await run(this.store.ffmpeg,['-hide_banner','-nostdin','-y','-filter_threads','1','-protocol_whitelist','file,pipe','-f','concat','-safe','1','-i','views.txt','-vf','tile=4x3','-frames:v','1','-an','angles.jpg'],{cwd:dir,timeout:60000});
   metadata.angles=sphericalAngles.map(a=>({...a,pitch:0,roll:0,hFov:90}));metadata.sampleTimes=times;metadata.grid='Columns: front/right/back/left relative to stitched orientation. Rows: start/middle/end of the selected source window.';job.path=path.join(dir,'angles.jpg');metadata.imageSha256=await fileDigest(job.path);
  }else if(job.kind==='spherical-reframe'){
   job.phase='render reviewed local camera path';await fs.writeFile(path.join(dir,'camera-commands.txt'),buildCommandFile(camera));
   await run(this.store.ffmpeg,buildReframeArgs(camera,{inputPath:source}),{cwd:dir,timeout:600000});
   job.path=path.join(dir,'reframed.mp4');job.file=job.id+'/reframed.mp4';
   const output=await probe(this.store.ffmpeg,job.path);
   if(output.width!==camera.width||output.height!==camera.height||Math.abs(output.duration-camera.duration)>Math.max(.15,2/camera.fps)||output.hasAudio!==sourceMeta.hasAudio)fail('Rendered output did not match the reviewed dimensions, duration or audio.','SPHERICAL_OUTPUT');
   metadata.outputSha256=await fileDigest(job.path);metadata.output={...output,requestedFps:camera.fps};
  }else fail('Unknown spherical job kind.');
  checkJob();if(await fileDigest(source)!==sourceSha256)fail('Source changed during reframing; result is not accepted.','SOURCE_CHANGED');
  await atomic(path.join(dir,'review.json'),metadata);job.reviewSha256=await fileDigest(path.join(dir,'review.json'));job.phase='complete';
 }
 async read(jobId){
  await this.renderer.ready;const service=this.renderer.jobService,job=await service.status(jobId);
  if(!['spherical-suggestions','spherical-reframe'].includes(job.kind)||job.status!=='complete'||job.evicted)fail('Choose a complete retained spherical job.','SPHERICAL_INCOMPLETE');
  const unpin=service.pin(jobId);try{
   const exportsRoot=await ownedDirectory(this.store.root,'exports'),dir=await ownedDirectory(exportsRoot,jobId),doc=await readLocalJson(path.join(dir,'review.json'),262144);
   if(!job.reviewSha256||await fileDigest(path.join(dir,'review.json'))!==job.reviewSha256||doc.version!==1||doc.projectId!==this.store.projectId||doc.originJobId!==jobId)fail('Spherical provenance is invalid.');
   const snapshot=await this.store.snapshot(),asset=snapshot.assets.find(a=>a.id===doc.assetId);
   if(!asset||asset.file!==doc.sourceFile||await fileDigest(this.store.assetPath(asset))!==doc.sourceSha256)fail('Source changed since this camera review.','SOURCE_CHANGED');
   if(job.kind==='spherical-suggestions'){
    const imagePath=path.join(dir,'angles.jpg'),stat=await fs.lstat(imagePath);
    if(!stat.isFile()||stat.isSymbolicLink()||stat.size>8*1024*1024||await fileDigest(imagePath)!==doc.imageSha256)fail('Angle preview changed or exceeds its local bounds.','SOURCE_CHANGED');
    return {...doc,committed:false,images:[{label:'Proposed spherical views; columns front/right/back/left, rows start/middle/end',path:imagePath,mimeType:'image/jpeg',data:(await fs.readFile(imagePath)).toString('base64')}]};
   }
   const outputPath=path.join(dir,'reframed.mp4'),stat=await fs.lstat(outputPath);if(!stat.isFile()||stat.isSymbolicLink()||await fileDigest(outputPath)!==doc.outputSha256)fail('Derived output changed.','SOURCE_CHANGED');
   return {...doc,committed:false,outputPath,next:'Review this flat view, then explicitly media_import it. It has not been inserted into any timeline.'};
  }finally{unpin();}
 }
}
