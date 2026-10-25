import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {Store,Renderer,run} from './engine.mjs';
import {SphericalService} from './spherical-service.mjs';
const app=path.dirname(fileURLToPath(import.meta.url)),digest=bytes=>createHash('sha256').update(bytes).digest('hex');
async function fixture(){
 const work=path.resolve(app,'../../work/spherical-service-tests');await fs.mkdir(work,{recursive:true});
 const dir=await fs.mkdtemp(path.join(work,'case-')),ffmpeg=JSON.parse(await fs.readFile(path.join(app,'config.local.json'),'utf8')).ffmpeg;
 const store=new Store(dir,ffmpeg);await store.init();
 const input=path.join(dir,'source.mp4');
 await run(ffmpeg,['-hide_banner','-nostdin','-loglevel','error','-y','-threads','1','-f','lavfi','-i','testsrc2=s=320x160:r=10:d=1','-f','lavfi','-i','sine=frequency=440:duration=1','-c:v','libx264','-threads','1','-pix_fmt','yuv420p','-c:a','aac','-shortest',input]);
 await store.import({path:input});const renderer=new Renderer(store);await renderer.ready;const sphere=new SphericalService(store,renderer),asset=store.db.project.assets[0];
 const request={assetId:asset.id,projection:'equirectangular',stitched:true,start:0,end:.8};
 const call=(action,extra={})=>sphere.call({expectedProjectId:store.projectId,expectedRevision:store.db.revision,action,request,...extra});
 return {dir,store,renderer,sphere,asset,request,call};
}
async function finish(renderer,job,status='complete'){
 await renderer.jobService.tail;const result=await renderer.jobService.status(job.id);assert.equal(result.status,status,result.error);return result;
}
test('real sphere suggestions/render/restart preserve project and source; review and outputs reject tampering',{timeout:30000},async()=>{
 const {store,renderer,sphere,asset,request,call}=await fixture(),projectBytes=await fs.readFile(store.file),sourceBytes=await fs.readFile(store.assetPath(asset));
 await assert.rejects(()=>call('render',{expectedRevision:store.db.revision-1}),e=>e.code==='STALE_REVISION');
 await assert.rejects(()=>call('render',{request:{...request,url:'https://example.invalid'}}),/Unknown|field|propert/i);
 const angles=await finish(renderer,await call('suggest')),angleReview=await sphere.read(angles.id);
 assert.equal(angleReview.committed,false);assert.equal(angleReview.sampleTimes.length,3);assert.deepEqual(angleReview.angles.map(a=>a.yaw),[0,90,180,-90]);
 assert.ok(angleReview.images[0].data.length>1000);assert.equal(digest(Buffer.from(angleReview.images[0].data,'base64')),angleReview.imageSha256);
 const imagePath=angleReview.images[0].path,imageBytes=await fs.readFile(imagePath);await fs.appendFile(imagePath,'tampered');await assert.rejects(()=>sphere.read(angles.id),e=>e.code==='SOURCE_CHANGED');await fs.writeFile(imagePath,imageBytes);
 const render=await finish(renderer,await call('render',{request:{...request,width:160,height:320,fps:10,keyframes:[{time:0,yaw:170,pitch:0,roll:0,hFov:90},{time:.8,yaw:-170,pitch:0,roll:0,hFov:75}]}}));
 const review=await sphere.read(render.id);assert.equal(review.output.width,160);assert.equal(review.output.height,320);assert.equal(review.output.hasAudio,true);assert.ok(Math.abs(review.output.duration-.8)<.15);assert.equal(digest(await fs.readFile(review.outputPath)),review.outputSha256);
 const reviewPath=path.join(path.dirname(review.outputPath),'review.json'),reviewBytes=await fs.readFile(reviewPath),changed=JSON.parse(reviewBytes);changed.camera.keyframes[0].yaw=0;await fs.writeFile(reviewPath,JSON.stringify(changed));await assert.rejects(()=>sphere.read(render.id),/provenance/i);await fs.writeFile(reviewPath,reviewBytes);
 const outputBytes=await fs.readFile(review.outputPath);await fs.appendFile(review.outputPath,'tampered');await assert.rejects(()=>sphere.read(render.id),e=>e.code==='SOURCE_CHANGED');await fs.writeFile(review.outputPath,outputBytes);
 const restartedStore=new Store(store.root,store.ffmpeg);await restartedStore.init();const restartedRenderer=new Renderer(restartedStore),restartedSphere=new SphericalService(restartedStore,restartedRenderer);await restartedRenderer.ready;
 assert.equal((await restartedSphere.read(render.id)).outputSha256,review.outputSha256);assert.equal((await restartedSphere.read(angles.id)).imageSha256,angleReview.imageSha256);
 assert.deepEqual(await fs.readFile(store.file),projectBytes);assert.deepEqual(await fs.readFile(store.assetPath(asset)),sourceBytes);
});
test('queued cancellation/retry uses owned jobs and refuses changed source on retry',{timeout:30000},async()=>{
 const {store,renderer,sphere,call}=await fixture();let release;renderer.jobService.tail=new Promise(resolve=>{release=resolve;});
 const job=await call('render',{request:{assetId:store.db.project.assets[0].id,projection:'equirectangular',stitched:true,start:0,end:.8,width:160,height:160,fps:10}});
 await renderer.jobService.cancel(job.id);release();await finish(renderer,job,'canceled');await assert.rejects(()=>sphere.read(job.id),e=>e.code==='SPHERICAL_INCOMPLETE');
 const retry=await renderer.jobService.retry(job.id,(r,j)=>sphere.execute(r,j));const done=await finish(renderer,retry);assert.equal(done.retryOf,job.id);assert.equal((await sphere.read(done.id)).committed,false);
 await fs.appendFile(store.assetPath(store.db.project.assets[0]),'source changed');const rejected=await renderer.jobService.retry(done.id,(r,j)=>sphere.execute(r,j));const failed=await finish(renderer,rejected,'failed');assert.equal(failed.errorCode,'SOURCE_CHANGED');
});
test('queued live relink rejects and actual non-equirectangular bytes reject stale imported metadata',{timeout:30000},async()=>{
 const {store,renderer,sphere,asset,call}=await fixture();let release;renderer.jobService.tail=new Promise(resolve=>{release=resolve;});
 const job=await call('render');const project=structuredClone(store.db.project);project.assets[0].file='replacement.mp4';await fs.copyFile(store.assetPath(asset),path.join(store.root,'media','replacement.mp4'));await store.commit(project,'Synthetic relink during queue');release();const relinked=await finish(renderer,job,'failed');assert.equal(relinked.errorCode,'SOURCE_CHANGED');
 const live=store.db.project.assets[0];await run(store.ffmpeg,['-hide_banner','-nostdin','-loglevel','error','-y','-threads','1','-f','lavfi','-i','color=c=blue:s=160x160:r=10:d=1','-c:v','libx264','-threads','1','-pix_fmt','yuv420p',store.assetPath(live)]);
 const mismatch=await call('render');const failed=await finish(renderer,mismatch,'failed');assert.equal(failed.errorCode,'SOURCE_CHANGED');assert.match(failed.error,/2:1/);await assert.rejects(()=>sphere.read(mismatch.id),e=>e.code==='SPHERICAL_INCOMPLETE');
});
