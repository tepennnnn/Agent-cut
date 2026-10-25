import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Store,Renderer,run} from './engine.mjs';
const root=path.dirname(fileURLToPath(import.meta.url));
const config=JSON.parse(await fs.readFile(path.join(root,'config.local.json'),'utf8'));
const store=new Store(path.join(root,'data'),process.env.AGENT_CUT_FFMPEG||config.ffmpeg);await store.init();
if(store.db.project.assets.length){console.log('Project already has media; left unchanged.');process.exit(0);}
const file=path.join(root,'data','demo-source.mp4');
await run(store.ffmpeg,['-hide_banner','-nostdin','-y','-f','lavfi','-i','testsrc2=size=640x360:rate=30','-f','lavfi','-i','sine=frequency=220:sample_rate=48000','-t','6','-c:v','libx264','-pix_fmt','yuv420p','-af','volume=0.08','-c:a','aac',file]);
let p=await store.import({path:file});
p=await store.edit({expectedRevision:p.revision,summary:'Build a local demonstration',operations:[{type:'rename',title:'My first agentic edit'},{type:'append',assetId:p.assets[0].id,sourceIn:0,sourceOut:2.4},{type:'append',assetId:p.assets[0].id,sourceIn:3,sourceOut:5.4},{type:'caption',text:'Your footage. Your edits.',start:.1,end:2.2},{type:'caption',text:'Codex controls the timeline.',start:2.5,end:4.7}]});
const renderer=new Renderer(store),job=renderer.start();
while(renderer.status(job.id).status==='rendering')await new Promise(r=>setTimeout(r,100));
const result=renderer.status(job.id);if(result.status!=='complete')throw Error(result.error);
await fs.copyFile(result.path,path.join(root,'demo-edit.mp4'));
console.log('Local demo and MP4 created.');
