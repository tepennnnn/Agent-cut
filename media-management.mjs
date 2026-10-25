import fs from 'node:fs/promises';
import {constants,createReadStream} from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {probe,validate,canonical,EditError} from './engine.mjs';
const extensions=new Set(['.mp4','.mov','.mkv','.webm','.m4v','.avi','.mp3','.wav','.m4a','.flac','.ogg']);
const hash=async file=>{const h=createHash('sha256');for await(const chunk of createReadStream(file))h.update(chunk);return h.digest('hex');};
async function localSource(input){
 if(typeof input!=='string'||!path.isAbsolute(input)||input.startsWith('\\\\')||input.startsWith('//'))throw new EditError('INVALID_ARGUMENT','An absolute local media path is required.');
 const file=await fs.realpath(input);if(file.startsWith('\\\\')||file.startsWith('//')||!extensions.has(path.extname(file).toLowerCase()))throw new EditError('INVALID_ARGUMENT','Unsupported local media path.');
 const stat=await fs.stat(file);if(!stat.isFile()||stat.size>4e9)throw new EditError('INVALID_ARGUMENT','Choose a regular media file smaller than 4 GB.');return file;
}
export async function mediaStatus(store,args={}){
 const p=await store.snapshot();store.checkIdentity(args.expectedProjectId);
 const assets=await Promise.all(p.assets.map(async a=>{if(a.kind==='sequence')return {assetId:a.id,name:a.name,status:'sequence',sequenceId:a.sequenceId,duration:a.duration};const file=store.assetPath(a);try{const s=await fs.stat(file);return {assetId:a.id,name:a.name,status:s.isFile()?'online':'offline',bytes:s.size,path:file};}catch(e){return {assetId:a.id,name:a.name,status:e.code==='ENOENT'?'offline':'unreadable',path:file};}}));
 return {projectId:p.projectId,revision:p.revision,assets,offlineCount:assets.filter(a=>a.status==='offline'||a.status==='unreadable').length};
}
async function prepare(store,args){
 if(!args.expectedProjectId)throw new EditError('INVALID_ARGUMENT','Read the project identity before relinking.');
 store.check(args.expectedRevision,args.expectedProjectId);const project=structuredClone(store.db.project),asset=project.assets.find(a=>a.id===args.assetId);if(!asset)throw new EditError('INVALID_ARGUMENT','Unknown asset.');if(asset.kind==='sequence')throw new EditError('INVALID_ARGUMENT','A nested sequence is not a relinkable file. Edit its source sequence.');
 const sourcePath=await localSource(args.path),digest=await hash(sourcePath),metadata=await probe(store.ffmpeg,sourcePath);if(metadata.duration<=0||metadata.duration>7200)throw new EditError('INVALID_ARGUMENT','Media duration must be 0–7200 seconds.');
 const filename=`relink-${digest}${path.extname(sourcePath).toLowerCase()}`,before=structuredClone(asset);Object.assign(asset,metadata,{file:filename});
 // Full model validation checks every sequence and retained source handle before any copy/commit.
 validate(project);
 const planId=createHash('sha256').update(canonical({kind:'media_relink',projectId:store.projectId,revision:store.db.revision,assetId:asset.id,sourcePath,digest,before,after:asset})).digest('hex');
 return {project,plan:{projectId:store.projectId,expectedRevision:store.db.revision,assetId:asset.id,sourcePath,sourceDigest:digest,planId,before,after:structuredClone(asset),undoable:true,scope:'Replace managed source for this asset in all sequences; retain previous file for undo.'}};
}
export function previewRelink(store,args){return store.serial(async()=>(await prepare(store,args)).plan);}
export function activateRelink(store,args){return store.serial(async()=>{
 const {project,plan}=await prepare(store,args);if(args.expectedPlanId!==plan.planId)throw new EditError('PLAN_MISMATCH','Relink source or project changed; review again.');if(args.confirmPlanId!==plan.planId)throw new EditError('CONFIRMATION_REQUIRED','Confirm the reviewed relink plan.');
 const dest=store.assetPath(plan.after);let owned=false;
 try{
  try{await fs.copyFile(plan.sourcePath,dest,constants.COPYFILE_EXCL);owned=true;}catch(e){if(e.code!=='EEXIST')throw e;}
  if(await hash(dest)!==plan.sourceDigest)throw new EditError('SOURCE_CHANGED','Source changed while copying or a managed file has different contents.');
  const copiedMetadata=await probe(store.ffmpeg,dest);for(const key of Object.keys(copiedMetadata))if(copiedMetadata[key]!==plan.after[key])throw new EditError('SOURCE_CHANGED','Copied source metadata changed; review again.');
  const backup=await store.writeBackup(plan.planId);await store.commitLocked(project,'Relink '+plan.before.name);return {...store.read(),relinkBackup:backup};
 }catch(e){if(owned)await fs.unlink(dest).catch(()=>{});throw e;}
});}
