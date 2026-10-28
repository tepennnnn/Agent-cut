import {transitionSample} from '/transition-sample.js';
import {storyVideoPanel} from '/story-video-panel.js';
import {storyCreator} from '/story-creator.js';
import {narrationSync} from '/story-sync.js';
import {fontChoices} from '/font-model.js';
import {sceneArt} from '/story-art.js';
import {transitionCatalog} from '/transition-model.js';

import {captionStyles,motionStyle} from '/caption-model.js';

import {captionSample} from '/caption-sample.js';

import {token} from '/session.js';

const $=id=>document.getElementById(id);

let art=null,resync=null,creator=null,videos=null;
let project,draft,busy=false,dirty=false,currentJob=null,reviewJob=null,exportJob=null,applied=false,ttsReady=false;

const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

const url=p=>p+'?token='+encodeURIComponent(token);

function status(text,error=false){$('status').textContent=text;$('status').classList.toggle('error',error);}

async function request(path,options={}){const response=await fetch(path,{...options,headers:{'x-agent-cut-token':token,...options.headers}});const result=await response.json();if(!response.ok)throw Error(result.error||'Local request failed.');return result;}

async function call(name,args={}){return request('/api/call',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,arguments:{...(['story_sync','job_control'].includes(name)?{expectedProjectId:project.projectId}:{}),...args}})});}

const story=(action,args={})=>call('story_sync',{action,...args});

$('caption-font').innerHTML='<option value="preset">Preset default · keep this style’s original font</option>'+fontChoices.map(f=>`<option value="${f.id}">${esc(f.name)} · ${esc(f.group)}</option>`).join('');
$('caption-style').innerHTML=captionStyles.map(s=>`<option value="${s.id}">${esc(s.name)}</option>`).join('');

$('transition-kind').innerHTML='<option value="none">Cut · no transition</option>'+transitionCatalog.map(t=>`<option value="${t.id}">${esc(t.name)}</option>`).join('');

$('transition-search').addEventListener('input',()=>{const query=$('transition-search').value.trim().toLowerCase();for(const option of $('transition-kind').options){const entry=transitionCatalog.find(t=>t.id===option.value);option.hidden=option.value!==$('transition-kind').value&&![option.textContent,entry?.description,...(entry?.tags||[])].join(' ').toLowerCase().includes(query);}});

function transitionChoice(){transitionPreview.select($('transition-kind').value,Number($('transition-seconds').value));const adapted=$('transition-kind').value.startsWith('wgfx_');$('transition-note').textContent=(adapted?'WGFX adaptation · Adobe effects and easing are approximated. ':$('transition-kind').value.startsWith('gl_')?'Original GL shader · local Chrome/Edge renderer. ':'')+'Images blend around scene boundaries; narration and subtitles keep their timing. Save and compose again to review.';}

for(const id of ['transition-kind','transition-seconds'])$(id).addEventListener('change',()=>{transitionChoice();if(draft)invalidate();});

const sample=await captionSample($('caption-sample'),token);
const transitionPreview=transitionSample($('transition-sample'),{url,story:(a,b)=>a==='__sample_status'?call('render_status',b):story(a,b)});


function captionChoice(){const id=$('caption-style').value;sample.select(id,$('caption-font').value);$('caption-font-note').textContent=fontChoices.find(f=>f.id===$('caption-font').value)?.use||'Preset default preserves the style’s original local font. All choices work offline.';$('caption-style-note').textContent=motionStyle(id)?(draft?.captionAlignment?'captions.js · composed preview uses acoustic word timings; review machine alignment.':'captions.js · local fonts · word timing estimated within measured narration phrases. Save, then compose a new preview to apply.'):'Static captions · short groups use estimated timing within measured sentences on new narration.';}

$('caption-font').addEventListener('change',()=>{captionChoice();if(draft)invalidate();});
$('caption-style').addEventListener('change',()=>{captionChoice();if(draft)invalidate();});captionChoice();

function controls(){

 $('generate').disabled=busy||!$('voice').value||$('engine').value!=='windows'&&!ttsReady;

 $('engine').disabled=busy;$('tts-configure').disabled=busy;$('vox-configure').disabled=busy;$('reference-file').disabled=busy;

 $('compose').disabled=busy||!draft||draft.scenes.some(s=>!s.imageId&&!s.video);

 $('save').disabled=busy||!draft||(!dirty&&!creator?.hasPending());

 $('batch').disabled=busy||!draft;$('batch-label').classList.toggle('disabled',busy||!draft);

 $('srt').disabled=busy||!draft;

 const reviewed=!!reviewJob&&reviewJob.status==='complete'&&!dirty&&draft?.review?.planId===reviewJob.planId;

 $('export').disabled=busy||!reviewed;

 $('apply').disabled=busy||applied||!reviewed||draft?.review?.requiresMigration&&!$('migration').checked;

 $('saved').disabled=busy;$('caption-style').disabled=busy;$('caption-font').disabled=busy;$('transition-kind').disabled=busy;$('transition-seconds').disabled=busy;$('transition-search').disabled=busy;

 for(const el of document.querySelectorAll('#scene-list input'))el.disabled=busy;

 $('cancel').hidden=!currentJob;

 $('progress').hidden=!currentJob;art?.sync(busy);resync?.sync(busy);creator?.sync(busy);videos?.sync(busy);

}

async function action(fn){if(busy)return;busy=true;controls();try{await fn();}catch(e){status(e.message,true);}finally{busy=false;currentJob=null;controls();}}

async function wait(job){currentJob=job;$('progress').value=0;controls();while(true){const result=await call('render_status',{jobId:job.id});$('progress').value=result.progress||0;if(result.kind==='story-voice'&&['chatterbox','voxcpm2'].includes(result.engine)&&['queued','rendering'].includes(result.status))status(result.speechTotal?`Generating local speech · ${result.speechCompleted}/${result.speechTotal} phrases · ${result.device}`:'Loading local '+result.engine+' model… The first sentence may take longer.');if(result.phase&&['story-scene-voice','story-scene-image','story-quality'].includes(result.kind)&&['queued','rendering'].includes(result.status))status(result.phase+'…');if(result.transitionStage&&['queued','rendering'].includes(result.status))status('Preparing '+result.transitionStage.replace('Rendering ','')+' transition…');if(result.status==='complete')return result;if(['failed','canceled','interrupted'].includes(result.status))throw Error(result.error||'Job '+result.status);await new Promise(r=>setTimeout(r,750));}}

async function refreshVoices(selected){

 const engine=$('engine').value;$('chatterbox-panel').hidden=engine==='windows';$('chatterbox-setup').hidden=engine!=='chatterbox';$('voxcpm-setup').hidden=engine!=='voxcpm2';$('reference-label').textContent=engine==='voxcpm2'?'Import VoxCPM2 voice reference':'Import voice reference (5.1–30 seconds)';$('reference-note').textContent=engine==='voxcpm2'?'Use a clear speech recording. The reference interval in VoxCPM2 setup selects a short local segment.':'Use a clean English speech clip for a voice you have permission to use, or choose the built-in voice below.';

 if(engine==='chatterbox'){

  const s=await story('tts_status');ttsReady=s.ready;const c=s.settings||s.defaults||{};

  $('tts-python').value=c.pythonPath||'';$('tts-model-dir').value=c.modelDir||'';$('tts-model').value=c.model||'nano';$('tts-device').value=c.device||'auto';$('tts-threads').value=c.threads||2;

  $('tts-status').textContent=s.ready?`Ready · Chatterbox ${c.model} · ${c.device} · ${s.runtime.gpu||'CPU runtime'} · offline`:(s.message||'Local runtime needs setup.');

  $('tts-status').classList.toggle('error',!s.ready);

 }

 if(engine==='voxcpm2'){const s=await story('tts_status',{engine});ttsReady=s.ready;const c=s.settings||s.defaults||{};for(const [id,key]of [['vox-backend','backend'],['vox-runner','runnerPath'],['vox-base','baseModelPath'],['vox-acoustic','acousticModelPath'],['vox-timeout','sentenceTimeoutSeconds'],['vox-budget','jobTimeoutSeconds']])$(id).value=c[key]??'';$('tts-status').textContent=s.ready?'Ready · VoxCPM2 · '+c.backend+' · local; listen before publishing':s.message;$('tts-status').classList.toggle('error',!s.ready);}
 const voices=await story('voices',{engine});$('voice').innerHTML=voices.voices.map(v=>`<option value="${esc(v.id)}">${esc(v.name)} · ${esc(v.language)}</option>`).join('');

 if(!voices.voices.length){$('voice').innerHTML='<option value="">No voices available</option>';$('voice-note').textContent=voices.unavailable||'No local voices are available.';}else $('voice-note').textContent=engine==='voxcpm2'?'Experimental Tagalog narration; review pronunciation and timing.':engine==='chatterbox'?'English local AI narration. Generated audio determines scene/caption timing.':'Offline installed Windows voices.';

 if(selected&&voices.voices.some(v=>v.id===selected))$('voice').value=selected;controls();

}

$('engine').addEventListener('change',()=>action(()=>refreshVoices()));

$('tts-configure').addEventListener('click',()=>action(async()=>{status('Checking the local Chatterbox runtime…');await story('tts_configure',{settings:{pythonPath:$('tts-python').value,modelDir:$('tts-model-dir').value,model:$('tts-model').value,device:$('tts-device').value,threads:Number($('tts-threads').value)}});await refreshVoices();status('Local Chatterbox is ready. Choose a voice and generate narration.');}));

$('vox-configure').addEventListener('click',()=>action(async()=>{status('Verifying VoxCPM2 model hashes…');await story('tts_configure',{engine:'voxcpm2',settings:{backend:$('vox-backend').value,runnerPath:$('vox-runner').value,baseModelPath:$('vox-base').value,acousticModelPath:$('vox-acoustic').value,sentenceTimeoutSeconds:Number($('vox-timeout').value),jobTimeoutSeconds:Number($('vox-budget').value)}});await refreshVoices();status('Local VoxCPM2 configuration verified.');}));

$('reference-file').addEventListener('change',()=>action(async()=>{const file=$('reference-file').files[0];if(!file)return;status('Importing local voice reference…');const v=await request('/api/story-voice?'+new URLSearchParams({engine:$('engine').value,start:$('vox-reference-start').value,seconds:$('vox-reference-seconds').value}),{method:'POST',headers:{'x-agent-cut-project-id':project.projectId,'x-file-name':encodeURIComponent(file.name)},body:file});await refreshVoices(v.id);$('reference-file').value='';status('Voice reference imported. It stays on this PC.');}));

async function saved(){const {stories}=await story('list');$('saved').innerHTML='<option value="">Choose a story…</option>'+stories.map(d=>`<option value="${esc(d.id)}">${esc(d.title)} · ${d.scenes} scenes</option>`).join('');if(draft)$('saved').value=draft.id;}

function render(){

 $('narration').hidden=!draft;$('scene-count').textContent=(draft?.scenes.length||0)+' scenes';

 if(!draft){controls();return;}

 $('audio').src=url('/story-audio/'+draft.id);$('audio-download').href=url('/story-audio/'+draft.id);

 $('timing-note').textContent=`${draft.duration.toFixed(2)} seconds · ${draft.captions.length} caption phrases · ${draft.timing}`;

 $('scene-help').textContent='Images follow narration scene boundaries. Move an image boundary below if needed; spoken audio and captions keep their original timing. Batch images are assigned in filename order.';

 $('scene-list').innerHTML=draft.scenes.map((s,i)=>`<article class="scene" data-index="${i}"><div class="scene-image">${s.video?`<video controls muted playsinline src="${url('/story-video/'+s.video.clipId)}" aria-label="Scene ${i+1} clip"></video>`:s.imageId?`<img src="${url('/story-image/'+s.imageId)}" alt="Scene ${i+1} image">`:'<div class="empty-thumb">＋ Add an image</div>'}<label class="file-button">${s.imageId?'Replace image':'Choose image'}<input type="file" accept="image/png,image/jpeg,image/webp" data-image="${i}" hidden></label></div><div class="scene-copy"><h3>SCENE ${String(i+1).padStart(2,'0')} <small> / ${s.start.toFixed(2)}–${s.end.toFixed(2)}s</small></h3><p>${esc(s.text)}</p></div><div class="scene-time">${i<draft.scenes.length-1?`<label>Image ends at (s)<input data-boundary="${i}" type="number" min="0.1" max="${draft.duration-.1}" step="any" value="${s.end}"></label>`:`<small>Ends with narration<br>${s.end.toFixed(2)} seconds</small>`}</div></article>`).join('');

 $('review-badge').textContent=reviewJob?.status==='complete'?'Preview ready':dirty?'Unsaved story changes':'Narration ready';

 $('migration-label').hidden=!draft.review?.requiresMigration;

 controls();

}

function invalidate(markDirty=true){resync?.invalidate();creator?.invalidate();if(markDirty)dirty=true;applied=false;reviewJob=null;exportJob=null;$('preview').pause();$('preview').removeAttribute('src');$('preview').hidden=true;$('preview-empty').hidden=false;$('download').hidden=true;$('review-badge').textContent='Changes need a new preview';controls();}

async function save(){
 await art?.flush();
 if(dirty){const boundaries=[...document.querySelectorAll('[data-boundary]')].map(el=>Number(el.value));draft=await story('update',{storyId:draft.id,expectedStoryRevision:draft.revision,imageIds:draft.scenes.map(s=>s.imageId),captionStyle:$('caption-style').value,captionFont:$('caption-font').value,transitionKind:$('transition-kind').value,transitionSeconds:Number($('transition-seconds').value),boundaries});dirty=false;await art?.load(draft);resync?.load();await creator?.load();await videos?.load(draft);render();status('Scene images and timing saved. Caption style saved. Transitions saved. Compose a new preview to review them.');}
 await creator?.flush();
}

async function upload(file){return request('/api/story-image',{method:'POST',headers:{'x-agent-cut-project-id':project.projectId,'x-file-name':encodeURIComponent(file.name)},body:file});}

async function load(id){if(draft&&draft.id!==id){await save();await art.flush();}applied=false;$('apply').textContent='Add story to editor as a new sequence';draft=await story('read',{storyId:id});dirty=false;reviewJob=null;exportJob=null;

 $('story-title').value=draft.title;$('script').value=draft.scenes.map(s=>s.text).join('\n\n');$('shape').value=draft.shape;$('caption-style').value=draft.captionStyle;$('caption-font').value=draft.captionFont||'preset';captionChoice();$('transition-search').value='';for(const option of $('transition-kind').options)option.hidden=false;$('transition-kind').value=draft.transition?.kind||'none';$('transition-seconds').value=draft.transition?.seconds??.4;transitionChoice();$('engine').value=draft.engine||'windows';await refreshVoices(draft.voice);if(![...$('rate').options].some(o=>o.value===String(draft.rate)))$('rate').add(new Option('Custom ('+draft.rate+')',String(draft.rate)));$('rate').value=String(draft.rate);count();

 $('preview').pause();$('preview').hidden=true;$('preview-empty').hidden=false;$('download').hidden=true;

 if(draft.review){const job=await call('render_status',{jobId:draft.review.jobId}).catch(()=>null);if(job?.status==='complete'&&!job.evicted){reviewJob=job;$('preview').src=url('/exports/'+job.id);$('preview').hidden=false;$('preview-empty').hidden=true;}}

 await art.load(draft);resync.load();await creator.load();await videos?.load(draft);render();localStorage.setItem('agent-cut-story:'+project.projectId,draft.id);$('saved').value=draft.id;status('Story loaded. Original editor timeline is unchanged.');

}

function count(){const text=$('script').value;const scenes=text.trim()?text.trim().split(/\n\s*\n/).length:0;$('script-count').textContent=`${scenes} scenes · ${text.length.toLocaleString()} characters`;}

$('script').addEventListener('input',count);

$('script-file').addEventListener('change',()=>action(async()=>{const f=$('script-file').files[0];if(!f)return;if(f.size>60000)throw Error('Script file exceeds 60 KB.');const text=await f.text();if(text.length>12000)throw Error('Script exceeds 12,000 characters.');$('script').value=text;count();$('script-file').value='';}));

$('generate-form').addEventListener('submit',event=>{event.preventDefault();void action(async()=>{

 await art.flush();status('Generating narration offline…');const job=await story('generate',{artSettings:art.settings(),engine:$('engine').value,title:$('story-title').value,script:$('script').value,voice:$('voice').value,rate:Number($('rate').value),shape:$('shape').value,captionStyle:$('caption-style').value,captionFont:$('caption-font').value,transitionKind:$('transition-kind').value,transitionSeconds:Number($('transition-seconds').value)});

 const done=await wait(job);await load(done.storyId);await saved();status(`Narration generated: ${done.sceneCount} scenes and ${done.captionCount} timed phrases. Add your scene images below.`);

 });});

$('saved').addEventListener('change',()=>{if($('saved').value)void action(()=>load($('saved').value));});

$('scene-list').addEventListener('change',event=>{const el=event.target;if(el.dataset.boundary!==undefined){invalidate();return;}if(el.dataset.image!==undefined)void action(async()=>{const file=el.files[0];if(!file)return;const image=await upload(file);draft.scenes[Number(el.dataset.image)].imageId=image.id;invalidate();await save();});});

$('batch').addEventListener('change',()=>action(async()=>{const files=[...$('batch').files].sort((a,b)=>a.name.localeCompare(b.name,undefined,{numeric:true}));if(!files.length)return;if(files.length>draft.scenes.length)throw Error(`Choose at most ${draft.scenes.length} images.`);status('Importing local scene images…');for(let i=0;i<files.length;i++){const image=await upload(files[i]);draft.scenes[i].imageId=image.id;invalidate();}await save();$('batch').value='';}));

$('save').addEventListener('click',()=>action(save));

$('compose').addEventListener('click',()=>action(async()=>{await save();project=await request('/api/project');status('Composing images, narration and captions…');const result=await story('preview',{storyId:draft.id,expectedStoryRevision:draft.revision,expectedRevision:project.revision});draft.review=result.review;const done=await wait(result.job);reviewJob=done;draft=await story('read',{storyId:draft.id});$('preview').src=url('/exports/'+done.id);$('preview').hidden=false;$('preview-empty').hidden=true;$('review-note').textContent='Review the composed video. Export it directly, or add it to the editor as a new sequence.';render();status('Composed preview ready. Your current editor timeline is unchanged.');}));

$('cancel').addEventListener('click',async()=>{try{if(currentJob)await call('job_control',{action:'cancel',jobId:currentJob.id});}catch(e){status(e.message,true);}});

$('migration').addEventListener('change',controls);

$('apply').addEventListener('click',()=>action(async()=>{const result=await story('apply',{storyId:draft.id,expectedRevision:draft.review.baseRevision,confirmPlanId:draft.review.planId,allowMigration:$('migration').checked});project=result.project;$('apply').textContent='Added — open the editor ↗';applied=true;status('Story added as a new sequence. Your previous edit is retained; Undo restores it.');}));

$('export').addEventListener('click',()=>action(async()=>{status('Exporting the reviewed story…');const result=await story('export',{storyId:draft.id,confirmPlanId:draft.review.planId,expectedStoryRevision:draft.revision});exportJob=await wait(result);if(exportJob.qualitySummary)await creator.showReport(exportJob.id);$('download').href=url('/exports/'+exportJob.id);$('download').hidden=false;status('MP4 ready: '+exportJob.path);}));

function stamp(t){const ms=Math.round(t*1000);return [Math.floor(ms/3600000),Math.floor(ms/60000)%60,Math.floor(ms/1000)%60].map(v=>String(v).padStart(2,'0')).join(':')+','+String(ms%1000).padStart(3,'0');}

$('srt').addEventListener('click',()=>{if(!draft)return;const text=draft.captions.map((c,i)=>`${i+1}\n${stamp(c.start)} --> ${stamp(c.end)}\n${c.text}`).join('\n\n')+'\n';const href=URL.createObjectURL(new Blob([text],{type:'application/x-subrip'})),a=document.createElement('a');a.href=href;a.download='story-subtitles.srt';a.click();setTimeout(()=>URL.revokeObjectURL(href),1000);});

for(const player of [$('audio'),$('preview')])player.addEventListener('timeupdate',()=>{if(!draft)return;for(const el of document.querySelectorAll('.scene')){const s=draft.scenes[Number(el.dataset.index)];el.classList.toggle('active',player.currentTime>=s.start&&player.currentTime<s.end);}});

$('audio').addEventListener('play',()=>$('preview').pause());$('preview').addEventListener('play',()=>$('audio').pause());

art=sceneArt({story,upload,url,action,status,beforeApprove:save,onApprove:async()=>{draft=await story('read',{storyId:draft.id});invalidate();dirty=false;await videos?.load(draft);render();}});
resync=narrationSync({story,request,url,action,wait,status,getDraft:()=>draft,isDirty:()=>dirty,uploadHeaders:()=>({'x-agent-cut-project-id':project.projectId}),beforePrepare:async()=>{await art.flush();await save();},reload:()=>load(draft.id)});
creator=storyCreator({story,upload,url,action,wait,status,getDraft:()=>draft,isDirty:()=>dirty,save,reload:()=>load(draft.id),onPending:()=>invalidate(false),onChange:async next=>{draft=next;invalidate(false);dirty=false;await art.load(draft);resync.load();await videos?.load(draft);render();}});
videos=storyVideoPanel($('video-panel'),{story,request,url,action,status,wait,projectId:()=>project?.projectId,beforeChange:save,reload:()=>load(draft.id)});
await action(async()=>{project=await request('/api/project');await art.init();await resync.init();await refreshVoices();await saved();const requested=new URLSearchParams(location.search).get('story'),id=requested||localStorage.getItem('agent-cut-story:'+project.projectId);if(requested)await load(requested);else if(id)await load(id).catch(()=>{localStorage.removeItem('agent-cut-story:'+project.projectId);status('Ready. Enter a script and choose a voice.');});else status('Ready. Enter a script and choose a voice.');});

