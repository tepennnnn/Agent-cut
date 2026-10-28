import {videoSettingsSchema} from './ui/video-prompt-model.js';
import {briefSchema,sceneSchema} from './ui/product-model.js';
import {visualSchema} from './ui/story-visual-model.js';
import {Transform} from 'node:stream';
import {artSettingsSchema} from './ui/story-art-model.js';
import {storyTransitionIds} from './ui/transition-model.js';
import {captionStyleIds} from './ui/caption-model.js';
import {localFont} from './text-fonts.mjs';
import {StoryService} from './story-service.mjs';
import {SphericalService} from './spherical-service.mjs';
import {RecipeService} from './recipe-service.mjs';
import {UI_ASSETS} from './ui-assets.mjs';
import {forwardRuntimeCall} from './runtime-forward.mjs';
import {SpeechService} from './speech-service.mjs';
import {fontCatalog} from './text-fonts.mjs';
import {textPresets,fontIds} from './ui/text-model.js';
import {DraftService} from './draft-service.mjs';
import {SourceOverview} from './source-overview.mjs';
import {recoverLock} from './lock-recovery.mjs';
import {BUILD} from './app-build.mjs';
import {readProjectView,readOperationContracts,advertisedTools} from './agent-reads.mjs';
import {CandidatePreview} from './candidate-preview.mjs';
import {exportSubtitles} from './subtitles.mjs';
import {findMedia} from './library-operations.mjs';
import {mediaStatus,previewRelink,activateRelink} from './media-management.mjs';
import {exportOptionsSchema} from './export-options.mjs';
import {analyzeAudio} from './audio-analysis.mjs';
import {matchesRuntime,bindEditor,acceptsLocalOrigin} from './startup.mjs';
import {inspectSequence} from './timecode.mjs';
import fs from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import http from 'node:http';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { randomBytes, randomUUID } from 'node:crypto';
import { Store, Renderer, atomic, EditError, errorResult } from './engine.mjs';

import {migrationPreview} from './sequences.mjs';
import {operationSchema,operationRegistry,validateObject} from './operations.mjs';

const ROOT=path.dirname(fileURLToPath(import.meta.url));
let config={};try{config=JSON.parse(await fs.readFile(path.join(ROOT,'config.local.json'),'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
const DATA=process.env.AGENT_CUT_DATA||path.join(ROOT,'data');
const PORT=Number(process.env.AGENT_CUT_PORT??config.port??43127);
const FFMPEG=process.env.AGENT_CUT_FFMPEG||config.ffmpeg||'ffmpeg';
await fs.mkdir(DATA,{recursive:true});
const RUNTIME=path.join(DATA,'runtime.json');
const field=(type,description)=>({type,description});
function tool(name,description,properties={},required=[],readOnly=false){return {name,description,inputSchema:{type:'object',properties,required,additionalProperties:false},annotations:{readOnlyHint:readOnly,destructiveHint:!readOnly,idempotentHint:readOnly,openWorldHint:false}};}
export const tools=[
  tool('media_find','Search local imported metadata by all query words (name, bin, tags, notes, label); does not inspect speech or source files.',{query:field('string','Literal search terms up to 200 characters')},[],true),
  tool('audio_analyze','Measure isolated v2 audio-item RMS/peak, true peak and EBU R128 loudness locally. Optional targetLUFS returns a proposed gain operation; does not edit or normalize automatically.',{itemId:field('string','Audio item ID'),sequenceId:field('string','Sequence ID; default active'),expectedProjectId:field('string','Optional identity guard'),targetLUFS:field('number','Optional target -36 to -5 LUFS')},['itemId'],true),
  tool('sequence_inspect','Read v2 frame/timecode and source matches at a sequence time; assetId/sourceTime finds reverse matches.',{sequenceId:field('string','Sequence ID; default active'),time:field('number','Sequence seconds; default 0'),assetId:field('string','Optional asset filter'),sourceTime:field('number','Reverse match source seconds'),timecode:field('string','Optional HH:MM:SS:FF or drop-frame HH:MM:SS;FF; overrides time'),dropFrame:field('boolean','29.97/59.94 drop-frame timecode')},[],true),
  tool('editor_info','Get the local editor URL, available features and runtime requirements.',{},[],true),
  tool('project_read','Read current assets, ordered timeline, layers, captions, markers, export range, revision and edit history. Always read before editing.',{},[],true),
  tool('media_import','Copy a user-selected absolute local video or audio path into the project library and inspect it with the local encoder. Does not upload media.',{path:field('string','Absolute local MP4/MOV/MKV/WebM/M4V/AVI/MP3/WAV/M4A/FLAC/OGG path')},['path']),
  tool('timeline_edit','Apply an atomic batch of reversible timeline edits. expectedRevision prevents stale changes. In/out are source seconds; captions/remove_range use timeline seconds. Trimming, speed, move and delete do not automatically retime captions; adjust captions in the same batch if necessary. remove_range ripples clips and captions.',{expectedRevision:field('integer','Revision from project_read'),summary:field('string','Plain-language edit description'),operations:{type:'array',minItems:1,maxItems:200,items:operationSchema}},['expectedRevision','summary','operations']),
  tool('timeline_undo','Undo the most recent project mutation, preserving a new revision.',{expectedRevision:field('integer','Revision from project_read')},['expectedRevision']),
  tool('timeline_redo','Reapply the last undone mutation, preserving a new revision.',{expectedRevision:field('integer','Revision from project_read')},['expectedRevision']),
  tool('project_checkpoint','Save a named project snapshot or restore it. Restore is reversible and requires the latest revision.',{action:{enum:['save','restore']},name:field('string','Checkpoint name'),expectedRevision:field('integer','Revision from project_read')},['action','name','expectedRevision']),
  tool('subtitle_import','Import literal SRT or plain VTT subtitle text locally as timed captions; no URLs or file reads. Set replace to replace existing captions.',{text:field('string','Literal SRT contents'),expectedRevision:field('integer','Revision from project_read'),replace:field('boolean','Replace existing captions; default false')},['text','expectedRevision']),
  tool('frame_preview','Render a composed timeline frame locally and return it as an image, including captions and canvas framing.',{time:field('number','Timeline seconds inside a clip')},['time'],true),
  tool('silence_detect','Measure low-volume intervals in one source asset using local FFmpeg. Returns source seconds; this is not transcription or filler-word recognition.',{assetId:field('string','Imported asset ID'),noiseDb:field('number','Threshold -70 to -5 dB; default -35'),minSeconds:field('number','Minimum duration .1–20 seconds; default .5')},['assetId'],true),
  tool('render_start','Start or queue a local SDR video export from a frozen project revision. Options support H.264/HEVC MP4 or ProRes MOV, dimensions, fractional frame rate, CRF/bitrate and AAC bitrate. Composition uses an H.264 intermediate; ProRes output is not a lossless source master. Creates files in the project exports folder; poll render_status. preview=true renders the full sequence for playback, ignoring the export range.',{preview:field('boolean','Full composed playback preview; default false'),expectedRevision:field('integer','Optional current revision guard')},[]),
  tool('render_status','Read export progress, failures and final file path.',{jobId:field('string','ID from render_start')},['jobId'],true)
];
for(const spec of tools)if(!spec.annotations.readOnlyHint){
  spec.inputSchema.properties.expectedProjectId=field('string','Project ID from project_read. Supply it with every mutation to reject a different connected project.');
  spec.description+=' Supply expectedProjectId from project_read to guard against the wrong project.';
}
tools.push(tool('subtitle_export','Return active-sequence plain-text SRT or VTT captions without writing files.',{format:{enum:['srt','vtt']},expectedProjectId:field('string','Optional identity guard')},[],true));
tools.find(t=>t.name==='subtitle_import').inputSchema.properties.format={enum:['srt','vtt']};
const editTool=tools.find(t=>t.name==='timeline_edit');
Object.assign(tools.find(t=>t.name==='render_start').inputSchema.properties,{options:exportOptionsSchema,queue:field('boolean','Queue a frozen revision behind current jobs; default false')});
const planTool=tool('timeline_plan','Validate a proposed edit batch without changing the project. Returns deterministic planId, reversible before/after changes, durations, noOp and destructive operation names. This is a state diff, not a rendered preview.',structuredClone(editTool.inputSchema.properties),[...editTool.inputSchema.required,'expectedProjectId'],true);
tools.push(planTool);
tools.push(tool('timeline_operations','List the shared typed editing operation contracts and destructive flags. Dynamic media and timeline limits are also checked by the engine.',{},[],true));
editTool.inputSchema.properties.confirmPlanId=field('string','Required for destructive v2 edits; reviewed plan ID after user authorization.');
editTool.inputSchema.properties.expectedPlanId=field('string','Optional planId from timeline_plan. Rejects a changed plan before committing.');
tools.push(tool('timeline_plan_save','Validate and save a local edit plan without changing timeline revision.',structuredClone(planTool.inputSchema.properties),planTool.inputSchema.required));
tools.push(tool('timeline_plan_read','Read a saved local plan by ID. A plan may be stale; reading does not apply it.',{planId:field('string','Saved plan ID'),expectedProjectId:field('string','Project ID from project_read')},['planId','expectedProjectId'],true));
tools.push(tool('timeline_plan_apply','Revalidate and apply a saved plan against its original project and revision. Destructive plans require confirmPlanId matching planId after user authorization.',{planId:field('string','Saved plan ID'),expectedProjectId:field('string','Project ID from project_read'),expectedRevision:field('integer','Current revision'),confirmPlanId:field('string','Confirmed destructive plan ID')},['planId','expectedProjectId','expectedRevision']));
tools.push(tool('project_migration_preview','Read-only preview of the proposed v2 sequence/track conversion. Does not activate migration or change saved projects.',{expectedProjectId:field('string','Project ID'),expectedRevision:field('integer','Current revision')},['expectedProjectId','expectedRevision'],true));
const recoveryGuard={expectedProjectId:field('string','Project ID'),expectedRevision:field('integer','Current revision')};
tools.push(tool('media_status','Inspect availability of managed local source files without changing the project.',{expectedProjectId:field('string','Optional project identity guard')},[],true));
const relinkFields={...recoveryGuard,assetId:field('string','Asset ID'),path:field('string','Absolute replacement local source path')};
tools.push(tool('media_relink_preview','Validate replacement media against all timeline source handles. Returns a content-hashed review plan without changing files.',relinkFields,Object.keys(relinkFields),true));
tools.push(tool('media_relink','Copy a reviewed replacement into managed storage, save a recovery backup, and relink the asset as one undoable change. Retains previous source for undo.',{...relinkFields,expectedPlanId:field('string','Reviewed plan ID'),confirmPlanId:field('string','Authorized plan ID')},[...Object.keys(relinkFields),'expectedPlanId','confirmPlanId']));
tools.push(tool('project_migration_activate','Explicitly activate a reviewed v2 migration after saving a recovery backup. Do not call without user authorization.',{...recoveryGuard,expectedPlanId:field('string','Reviewed migration plan ID'),confirmPlanId:field('string','Authorized migration plan ID')},['expectedProjectId','expectedRevision','expectedPlanId','confirmPlanId']));
tools.push(tool('project_backups','List up to 100 local recovery backups and integrity status.',{expectedProjectId:field('string','Project ID')},['expectedProjectId'],true));
tools.push(tool('project_restore_preview','Review a recovery backup diff without restoring it.',{...recoveryGuard,backupId:field('string','Recovery backup ID')},['expectedProjectId','expectedRevision','backupId'],true));
tools.push(tool('project_restore_backup','Restore a reviewed backup as one undoable change, saving the current state first.',{...recoveryGuard,backupId:field('string','Recovery backup ID'),expectedPlanId:field('string','Reviewed recovery plan ID'),confirmPlanId:field('string','Authorized recovery plan ID')},['expectedProjectId','expectedRevision','backupId','expectedPlanId','confirmPlanId']));
const readSpec=tools.find(t=>t.name==='project_read');readSpec.description+=' Window detail=text reads title/caption IDs, styles and timing with bounded pagination.';Object.assign(readSpec.inputSchema.properties,{view:{enum:['full','summary','window']},sequenceId:field('string','Sequence ID; default active'),itemIds:{type:'array',minItems:1,maxItems:200,items:field('string','Selected item ID')},start:field('number','Inclusive window seconds'),end:field('number','Exclusive window seconds'),detail:{enum:['summary','full','text']},pageSize:field('integer','1–100; default 20'),cursor:field('string','Revision/query-bound continuation cursor'),expectedProjectId:field('string','Optional identity guard'),expectedRevision:field('integer','Optional revision guard')});
Object.assign(tools.find(t=>t.name==='timeline_operations').inputSchema.properties,{names:{type:'array',minItems:1,maxItems:100,items:field('string','Exact operation name')},schemaVersion:field('integer','1 or 2'),pageSize:field('integer','1–100; default 5'),cursor:field('string','Contract/query-bound continuation cursor')});
tools.push(tool('timeline_plan_preview','Compose before/candidate stills from a saved plan without committing edits. Initial full-sequence preview limited to 120 seconds. Returns labeled proposed frames and stale status. Save a plan first; applying still requires its original revision and confirmation.',{planId:field('string','Saved plan ID'),expectedProjectId:field('string','Project ID'),expectedRevision:field('integer','Base revision'),sequenceId:field('string','Proposed sequence; default active'),time:field('number','Candidate timeline time'),includeBefore:field('boolean','Include committed base frame; default true')},['planId','expectedProjectId','expectedRevision','time'],true));
tools.push(tool('draft_start','Compose a bounded local preview, maximum ten seconds. Poll render_status. No project edits.',{...recoveryGuard,sequenceId:field('string','Optional sequence'),start:field('number','Start timeline seconds'),end:field('number','End timeline seconds'),quality:{enum:['draft','native']}},['expectedProjectId','expectedRevision','start','end']));
tools.push(tool('job_control','List/status/cancel/retry owned jobs or purge terminal preview cache; exports are protected.',{expectedProjectId:field('string','Project ID'),action:{enum:['list','status','cancel','retry','purge']},jobId:field('string','Job ID')},['expectedProjectId','action']));
tools.push(tool('media_overview','Local source thumbnail/waveform, maximum 120-second window. No speech analysis.',{expectedProjectId:field('string','Project ID'),assetId:field('string','Source asset'),start:field('number','Source start'),end:field('number','Source end')},['expectedProjectId','assetId'],true));
tools.push(tool('project_lock_recovery','Inspect an abandoned lock, then explicitly recover a verified dead owner with reviewed revision/plan; saves backup.',{...recoveryGuard,action:{enum:['inspect','recover']},confirmPlanId:field('string','Reviewed recovery plan')},['expectedProjectId','action']));
tools.find(t=>t.name==='frame_preview').inputSchema.properties.draft=field('boolean','Use bounded low-resolution composition; default false');
tools.push(tool('speech_setup','Optional offline English ASR. status checks files; configure explicitly selects existing pinned whisper.cpp 1.9.3/medium.en paths and 1–4 CPU threads. No installation/download.',{expectedProjectId:field('string','Project ID'),action:{enum:['status','configure']},runnerPath:field('string','Absolute installed whisper-cli.exe path'),modelPath:field('string','Absolute installed medium.en model path'),threads:field('integer','1–4 CPU threads')},['expectedProjectId','action']));
tools.push(tool('transcript','Offline source transcript sidecars. start: asset/range ≤120s, English; poll render_status. read/search: ≤100 segments/16KiB. correct: text + analysis revision, preserves raw text. import: literal source-timed SRT/VTT fallback. captions: selected itemIds and revisions → saved candidate plan only; review/preview/apply separately. list returns bounded index. No timeline mutation.',{...recoveryGuard,action:{enum:['start','list','read','correct','import','captions']},assetId:field('string','Source asset'),start:field('number','Source start seconds'),end:field('number','Source end seconds'),language:field('string','en for ASR; metadata for import'),transcriptId:field('string','Transcript ID'),expectedAnalysisRevision:field('integer','Revision from transcript read'),segmentId:field('string','Segment to correct'),text:field('string','Correction or literal timed text'),format:{enum:['srt','vtt']},query:field('string','Literal search up to 200 characters'),pageSize:field('integer','1–100; default 20'),cursor:field('string','State/query-bound page cursor'),sequenceId:field('string','Caption target sequence'),itemIds:{type:'array',minItems:1,maxItems:20,items:{type:'string'}},segmentIds:{type:'array',minItems:1,maxItems:500,items:{type:'string'}}},['expectedProjectId','action']));
tools.push(tool('edit_recipe','Build a frozen candidate, never apply automatically. Fetch contracts by kind first. Opening/excerpt/highlight use explicit transcript selections; pause_analyze measures at most 120 source seconds, poll render_status then pause_read. pause_cut uses selected measured IDs. Montage uses selected local ranges/music/title. Review source evidence, preview, then timeline_plan_apply; destructive cuts need confirmation.',{...recoveryGuard,action:{enum:['contracts','plan','pause_analyze','pause_read']},kind:{enum:['opening','excerpt','highlight','pause_cut','montage','pause_analyze']},request:{type:'object',additionalProperties:true,description:'Exact closed schema from action=contracts and selected kind'},evidenceId:field('string','Measured pause ID')},['expectedProjectId','action']));
tools.push(tool('sphere_reframe','Local stitched mono 2:1 equirectangular video only. contracts returns closed request schemas. suggest samples four directions at three times; poll render_status then read for images. render bakes an explicit camera path to a flat MP4; read returns its path for separate import. No timeline edits, tracking or INSV stitching.',{...recoveryGuard,action:{enum:['contracts','suggest','render','read']},request:{type:'object',additionalProperties:true},jobId:field('string','Completed job ID')},['expectedProjectId','action']));
async function existing() {
  try {
    const info=JSON.parse(await fs.readFile(RUNTIME,'utf8'));
    if(!matchesRuntime(info,PORT))return null;
    const res=await fetch(`http://127.0.0.1:${info.port}/api/health`,{headers:{'x-agent-cut-token':info.token},signal:AbortSignal.timeout(1500)});
    if(res.ok){const health=await res.json();if(health.name==='agent-cut'&&health.dataRoot===await fs.realpath(DATA)&&health.build===BUILD)return info;}
  } catch {}return null;
}
tools.push(tool('story_sync','Offline story drafts: voices → generate → read → image/update → preview → export/apply. Poll render_status. Paragraphs define scenes; apply adds a backed-up, undoable sequence. Script ≤12000 chars; ≤60 scenes.',{expectedProjectId:field('string','Project ID from project_read'),action:{enum:['transition_sample','video_import','video_read','video_prompt_pack','creator_video_prepare','affiliate_video_settings','affiliate_video_prompts','affiliate_contract','affiliate_list','affiliate_read','affiliate_build','affiliate_save','affiliate_generate','affiliate_finish','voices','tts_status','tts_configure','voice_import','transition_styles','caption_styles','caption_fonts','creator_contract','creator_read','creator_visuals','creator_image_request','creator_voice_prepare','creator_image_prepare','creator_plan','creator_apply','creator_undo','creator_preflight','creator_report','sync_contract','sync_status','sync_configure','sync_prepare','sync_read','sync_apply','sync_undo','art_contract','art_read','art_update','art_import','art_import_folder','art_approve','art_remove_variation','art_profiles','art_profile_save','art_pack','list','read','generate','image','update','preview','export','apply']},expectedRevision:field('integer','Latest project revision for preview/apply'),engine:{enum:['windows','chatterbox','voxcpm2']},referenceStart:field('number','VoxCPM2 voice_import only: local recording start seconds; default 0'),referenceSeconds:field('number','VoxCPM2 voice_import only: 3–15 seconds; default 6'),settings:{type:'object',additionalProperties:true,description:'tts_configure: Chatterbox uses pythonPath/modelDir/model/device/threads; VoxCPM2 uses backend=llama.cpp-omni|voxgen, runnerPath, baseModelPath, acousticModelPath, sentenceTimeoutSeconds, jobTimeoutSeconds, maxSteps. No downloads; closed validation.'},storyId:field('string','Story draft ID'),affiliateOptions:{type:'object',additionalProperties:false,properties:{campaignId:{type:'string'},expectedCampaignRevision:{type:'integer'},videoSettings:videoSettingsSchema,storyId:{type:'string'},brief:briefSchema,scenes:{type:'array',minItems:2,maxItems:20,items:sceneSchema},jobId:{type:'string'},offset:{type:'integer'},limit:{type:'integer'}}},creatorOptions:{type:'object',additionalProperties:false,properties:{clipId:{type:'string'},sourceIn:{type:'number'},clipFit:{enum:['contain','cover']},endMode:{enum:['hold','loop']},clearVideo:{type:'boolean'},videoSettings:videoSettingsSchema,sceneId:{type:'string'},visuals:{type:'array',minItems:1,maxItems:60,items:{...visualSchema,required:['sceneId'],properties:{sceneId:{type:'string'},...visualSchema.properties}}},scope:{enum:['scene','sentence']},sentenceIndex:{type:'integer'},text:{type:'string'},engine:{enum:['windows','chatterbox','voxcpm2']},voice:{type:'string'},rate:{type:'integer'},alignWords:{type:'boolean'},imageId:{type:'string'},acceptLowConfidence:{type:'boolean'},jobId:{type:'string'},offset:{type:'integer'},limit:{type:'integer'}}},syncOptions:{type:'object',additionalProperties:false,properties:{mode:{enum:['aligned','proportional']},audioId:{type:'string'},useCurrent:{type:'boolean'},pythonPath:{type:'string'},modelPath:{type:'string'},threads:{type:'integer'},acceptLowConfidence:{type:'boolean'},offset:{type:'integer'},limit:{type:'integer'}}},artOptions:{type:'object',additionalProperties:false,properties:{expectedArtRevision:field('integer','Image-plan revision from art_read; required for art mutations/pack'),artSettings:artSettingsSchema,artEdits:{type:'array',maxItems:60,items:{type:'object',additionalProperties:false,required:['sceneId'],properties:{sceneId:{type:'string'},brief:{type:'string'},prompt:{type:'string'}}}},buildPrompts:{type:'boolean'},replaceEditedPrompts:{type:'boolean'},artImages:{type:'array',minItems:1,maxItems:60,items:{type:'object',additionalProperties:false,required:['imageId','name'],properties:{imageId:{type:'string'},name:{type:'string'},sceneId:{type:'string'}}}},sceneId:{type:'string'},imageId:{type:'string'},artOffset:{type:'integer'},artLimit:{type:'integer'},profileId:{type:'string'},profileName:{type:'string'},expectedProfilesRevision:{type:'integer'},}},expectedArtRevision:field('integer','Image-plan revision from art_read; required for art mutations/pack'),artSettings:artSettingsSchema,artEdits:{type:'array',maxItems:60,items:{type:'object',additionalProperties:false,required:['sceneId'],properties:{sceneId:{type:'string'},brief:{type:'string'},prompt:{type:'string'}}}},buildPrompts:{type:'boolean'},replaceEditedPrompts:{type:'boolean'},artImages:{type:'array',minItems:1,maxItems:60,items:{type:'object',additionalProperties:false,required:['imageId','name'],properties:{imageId:{type:'string'},name:{type:'string'},sceneId:{type:'string'}}}},sceneId:{type:'string'},imageId:{type:'string'},artOffset:{type:'integer'},artLimit:{type:'integer'},profileId:{type:'string'},profileName:{type:'string'},expectedProfilesRevision:{type:'integer'},expectedStoryRevision:field('integer','Draft revision for update/preview'),title:field('string','Story title'),script:field('string','Plain-text script; blank lines separate scenes'),voice:field('string','Local engine voice ID from voices; VoxCPM2 supports builtin or imported reference IDs'),rate:field('integer','-5 to 5; default 0'),shape:{enum:['portrait','landscape','square']},captionStyle:{enum:captionStyleIds},captionFont:{enum:['preset',...fontIds]},transitionKind:{enum:storyTransitionIds},transitionSeconds:field('number','Scene transition overlap 0.1–2 seconds; narration and captions keep their timing'),path:field('string','Absolute local image or voice-reference audio path'),imageIds:{type:'array',maxItems:60,items:{oneOf:[{type:'string'},{enum:[null]}]}},boundaries:{type:'array',maxItems:59,items:{type:'number'}},confirmPlanId:field('string','Reviewed plan ID for apply'),allowMigration:field('boolean','Explicitly approve backed-up v1 upgrade')},['expectedProjectId','action']));
let runtime=await existing(),store,renderer,server,candidatePreview,drafts,overviews,speech,recipes,spheres,stories;
async function execute(name,args={}) {
  const spec=tools.find(t=>t.name===name);if(!spec)throw new EditError('UNKNOWN_TOOL','Unknown tool.');try{validateObject(args,spec.inputSchema);}catch(e){throw new EditError('INVALID_ARGUMENT',e.message);} if(!spec.annotations.readOnlyHint)store.checkIdentity(args.expectedProjectId);
  switch(name) {
    case 'sphere_reframe':return spheres.call(args);
    case 'edit_recipe':return recipes.call(args);
    case 'editor_info':return {transitions:{basic:7,wgfxAdaptations:74,nativeAdditional:51,gl:125,total:257,catalog:'story_sync action=transition_styles',note:'WGFX presets are adapted from local XML, not Adobe render-equivalent.'},affiliate:{url:`http://127.0.0.1:${runtime.port}/affiliate`,tool:'story_sync affiliate_contract',scope:'Local product briefs, provider video prompt packs, reviewed silent scene clips, narrated drafts, transition samples and publishing copy. No provider calls or automatic publishing.'},story:{tool:'story_sync',url:`http://127.0.0.1:${runtime.port}/story`,voice:'Windows SAPI or optional local Chatterbox Nano/Turbo',resync:'story_sync sync_contract: reviewed narration replacement, acoustic word alignment and draft undo',workshop:'story_sync creator_contract: seven motion presets, manual focus/fit/fill, reviewed scene or sentence voice and image replacement, backed-up undo and automatic export preflight',timing:'Optional offline English acoustic word alignment via sync_*; otherwise short captions use estimated timing within measured sentences',captionStyles:captionStyleIds,images:'Scene prompts, reusable visual profiles, reference-image packs and approved variations; external ChatGPT/Flow generation or Codex-assisted generation via art_* actions',output:'30 fps MP4 with audio and burned captions; SRT; optional new sequence'},spherical:{tool:'sphere_reframe',input:'Explicitly confirmed stitched mono 2:1 equirectangular MP4 from Studio',output:'Four angle suggestions; keyframed flat H264/AAC MP4; separate import',tracking:false,insvStitching:false},recipes:{tool:'edit_recipe',kinds:['opening','excerpt','highlight','pause_cut','montage'],behavior:'Source-evidenced frozen candidates, composed preview, explicit apply and undo'},speech:await speech.setup.readiness(),text:{fonts:await fontCatalog(),presets:textPresets,limits:{characters:1000,graphics:200,wrappedLines:12},coordinates:'x/y/width fractions of canvas; size, padding and safeMargin fractions of canvas height'},...store.identity(),applicationRoot:ROOT,build:BUILD,compactMcp:process.env.AGENT_CUT_COMPACT_MCP==='1',url:`http://127.0.0.1:${runtime.port}`,media:'Local files only; no uploads or external AI calls',agent:'Codex supplies the reasoning through these MCP tools',export:'Local FFmpeg SDR H.264/HEVC MP4 or converted ProRes MOV; frozen-revision queue',scope:'M4 optional offline English ASR, bounded transcript read/search/correction/import and reviewed source-mapped caption plans. M3 text: timed titles, sequence/cue caption styles, four local presets, font fingerprints/fallback warnings, safe wrapping, explicit cut text policies and plain SRT/VTT export. Creator workspace: bounded five-second drafts and stills, persistent owned jobs/cancel/retry/cache/recovery, source thumbnails/waveforms, direct track gestures, multi-selection/linked duplicate and guarded copy/paste, simple/advanced inspector and explicit fit/fill/manual framing. Bounded nested-source drafts reject; full native composition remains available. Reviewed isolated selection nesting and full unprocessed expansion into original tracks; bounded smooth speed curves with linked stereo audio whose pitch follows speed; live nested sequence sources; V2 media bins/search/metadata/reviewed relink, grouped edits/attribute paste, item/track audio processors/ducking/loudness, plain SRT/VTT captions, eased clip-local keyframes for opacity, position, rotation, basic color and audio volume. Versioned sequences/tracks with placement, insert, overwrite, trim, split, slip, roll, slide, rate stretch, linked A/V, composed playback, frame/timecode and source match; legacy sequential timeline with video/audio layers, transforms, crop, basic color, fades, dissolve transitions, slip/roll/duplicate edits, markers, export range, SRT captions, undo/redo and named checkpoints. Offline story narration uses installed Windows voices; no image generation or cloud transcription.'};
    case 'speech_setup':{if(args.action==='status')return speech.setup.readiness();return speech.setup.configure(args);}
    case 'transcript':{const methods={start:'start',list:'list',read:'read',correct:'correct',import:'import',captions:'captions'};return speech[methods[args.action]](args);}
    case 'project_read':return readProjectView(await store.snapshot(),args);
    case 'sequence_inspect':await store.snapshot();return {...inspectSequence(store.db.project,args),revision:store.db.revision,projectId:store.projectId};
    case 'project_migration_preview':return store.previewMigration(args);
    case 'project_migration_activate':return store.activateMigration(args);
    case 'project_backups':return store.listBackups(args);
    case 'project_restore_preview':return store.restorePlan(args);
    case 'project_restore_backup':return store.restoreBackup(args);
    case 'media_import':return store.import(args);
    case 'media_status':return mediaStatus(store,args);
    case 'media_relink_preview':return previewRelink(store,args);
    case 'media_relink':return activateRelink(store,args);
    case 'timeline_edit':return store.edit(args);
    case 'timeline_plan':return store.plan(args);
    case 'timeline_operations':return readOperationContracts(args);
    case 'timeline_plan_preview':return candidatePreview.preview(args);
    case 'timeline_plan_save':return store.savePlan(args);
    case 'timeline_plan_read':return store.readPlan(args);
    case 'timeline_plan_apply':return store.applyPlan(args);
    case 'timeline_undo':return store.undo(args);
    case 'timeline_redo':return store.redo(args);
    case 'project_checkpoint':return store.checkpoint(args);
    case 'subtitle_import':return store.importSubtitles(args);
    case 'subtitle_export':{const p=await store.snapshot();store.checkIdentity(args.expectedProjectId);return {...exportSubtitles(p,args.format||'srt'),projectId:p.projectId,revision:p.revision};}
    case 'frame_preview': {await store.snapshot();const f=args.draft?await drafts.frame(args):await renderer.frame(args.time);return {...f,image: (await fs.readFile(f.path)).toString('base64')};}
    case 'media_find':{const project=await store.snapshot();return {projectId:project.projectId,revision:project.revision,assets:findMedia(project,args.query||'')};}
    case 'audio_analyze':return analyzeAudio(store,args);
    case 'silence_detect':await store.snapshot();return renderer.silence(args.assetId,args.noiseDb,args.minSeconds);
    case 'render_start':return store.serial(async()=>{store.checkIdentity(args.expectedProjectId);if(args.expectedRevision!==undefined)store.check(args.expectedRevision,args.expectedProjectId);return renderer.start({preview:args.preview===true,queue:args.queue===true,options:args.options});});
    case 'render_status':return renderer.jobService.status(args.jobId);
    case 'draft_start':return drafts.start(args);
    case 'media_overview':return overviews.get(args);
    case 'project_lock_recovery':return recoverLock(store,args);
    case 'story_sync':return stories.call(args);
    case 'job_control':{store.checkIdentity(args.expectedProjectId);await renderer.ready;const service=renderer.jobService;if(args.action==='list')return {jobs:[...service.jobs.values()].map(j=>structuredClone(j))};if(!args.jobId)throw new EditError('INVALID_ARGUMENT','Supply jobId.');if(args.action==='status')return service.status(args.jobId);if(args.action==='cancel')return service.cancel(args.jobId);if(args.action==='purge')return service.purge(args.jobId);const job=await service.status(args.jobId);return service.retry(args.jobId,async(request,j)=>{if(['story-voice','story-preview','story-export','story-resync','story-scene-voice','story-scene-image','story-scene-video','story-transition-sample','story-quality'].includes(job.kind))return stories.execute(request,j);if(['spherical-suggestions','spherical-reframe'].includes(job.kind))return spheres.execute(request,j);if(job.kind==='pause-analysis')return recipes.executePause(request,j);if(job.kind==='transcribe')return speech.execute(request,j);if(job.kind==='overview')return overviews.execute(request,j);j.draftRange=request.draftRange;return renderer.render(request.project,j);});}
  }
}
const json=(res,status,body)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(body));};
async function body(req) {let text='',bytes=0;for await(const chunk of req){bytes+=chunk.length;if(bytes>1000000)throw Error('Request too large.');text+=chunk;}return JSON.parse(text);}
async function fileResponse(req,res,file,mime) {
  const stat=await fs.stat(file),range=req.headers.range;
  if(range) {
    const m=/^bytes=(\d+)-(\d*)$/.exec(range);if(!m){res.writeHead(416,{'Content-Range':`bytes */${stat.size}`});res.end();return;}
    const start=Number(m[1]),end=Math.min(m[2]?Number(m[2]):stat.size-1,stat.size-1);
    if(start>end||start>=stat.size){res.writeHead(416,{'Content-Range':`bytes */${stat.size}`});res.end();return;}
    res.writeHead(206,{'Content-Type':mime,'Content-Length':end-start+1,'Content-Range':`bytes ${start}-${end}/${stat.size}`,'Accept-Ranges':'bytes'});
    await pipeline(createReadStream(file,{start,end}),res);
  } else {res.writeHead(200,{'Content-Type':mime,'Content-Length':stat.size,'Accept-Ranges':'bytes'});await pipeline(createReadStream(file),res);}
}
if(!runtime) {
  store=new Store(DATA,FFMPEG);await store.init({allowRecovery:true});renderer=new Renderer(store);await renderer.ready;candidatePreview=new CandidatePreview(store,renderer);drafts=new DraftService(store,renderer);overviews=new SourceOverview(store,renderer);speech=new SpeechService(store,renderer);recipes=new RecipeService(store,renderer,speech);spheres=new SphericalService(store,renderer);stories=new StoryService(store,renderer);
  runtime={port:PORT,configuredPort:PORT,token:randomBytes(32).toString('hex'),pid:process.pid};
  server=http.createServer(async(req,res)=>{
    res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
    try {
      const origin=`http://127.0.0.1:${runtime.port}`;
      if(!acceptsLocalOrigin(req.headers.host,req.headers.origin,runtime.port)){json(res,403,{error:'Local origin required.'});return;}
      const url=new URL(req.url,origin);
      if(req.method==='GET'&&url.pathname==='/favicon.ico'){res.writeHead(204);res.end();return;}
      if(req.method==='GET'&&['/','/story','/affiliate'].includes(url.pathname)) {
        res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; media-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'none'");
        res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});res.end(await fs.readFile(path.join(ROOT,'ui',url.pathname==='/affiliate'?'affiliate.html':url.pathname==='/story'?'story.html':'index.html')));return;
      }
      if(req.method==='GET'&&UI_ASSETS.includes(url.pathname)) {
        res.writeHead(200,{'Content-Type':url.pathname.endsWith('.css')?'text/css':'text/javascript','Cache-Control':'no-store'});
        res.end(url.pathname==='/session.js'?`export const token=${JSON.stringify(runtime.token)};`:await fs.readFile(url.pathname==='/keyframes.mjs'?path.join(ROOT,'keyframes.mjs'):path.join(ROOT,'ui',url.pathname.slice(1))));return;
      }
      const auth=req.headers['x-agent-cut-token']||url.searchParams.get('token');if(auth!==runtime.token){json(res,401,{error:'Local session token required.'});return;}
      if(req.method==='GET'&&url.pathname.startsWith('/caption-font/')){const id=url.pathname.slice(14);if(!fontIds.includes(id))throw Error('Unknown local font.');const font=await localFont(id);await fileResponse(req,res,font.file,'font/ttf');return;}
      if(req.method==='GET'&&url.pathname==='/api/health'){json(res,200,{name:'agent-cut',version:'0.2.0',build:BUILD,...store.identity()});return;}
      if(req.method==='GET'&&url.pathname==='/api/project'){json(res,200,await store.snapshot());return;}
      if(req.method==='GET'&&url.pathname==='/api/jobs'){json(res,200,[...renderer.jobs.values()]);return;}
      if(req.method==='POST'&&url.pathname==='/api/call') {const call=await body(req);json(res,200,await execute(call.name,call.arguments));return;}
      if(req.method==='GET'&&url.pathname.startsWith('/api/story-art-pack/')) {const pack=await stories.call({action:'art_pack',expectedProjectId:url.searchParams.get('projectId'),storyId:url.pathname.slice(20),expectedStoryRevision:Number(url.searchParams.get('storyRevision')),expectedArtRevision:Number(url.searchParams.get('artRevision'))});res.setHeader('Content-Disposition','attachment; filename=agent-cut-scene-images.zip');res.setHeader('Cache-Control','no-store');await fileResponse(req,res,pack.zipPath,'application/zip');return;}
      if(req.method==='GET'&&url.pathname.startsWith('/story-image/')) {const image=await stories.image(url.pathname.slice(13));await fileResponse(req,res,image.path,'image/png');return;}
      if(req.method==='GET'&&url.pathname.startsWith('/story-audio/')) {const d=await stories.read(url.pathname.slice(13));await fileResponse(req,res,store.assetPath(d.audio),'audio/wav');return;}
      if(req.method==='GET'&&url.pathname.startsWith('/story-video/')){const clip=await stories.videos.read(url.pathname.slice(13));await fileResponse(req,res,clip.path,'video/mp4');return;}
      if(req.method==='POST'&&url.pathname==='/api/story-video'){store.checkIdentity(req.headers['x-agent-cut-project-id']);if(!req.headers['x-agent-cut-project-id'])throw Error('Project identity required.');const name=path.basename(decodeURIComponent(req.headers['x-file-name']||''));if(!/\.(mp4|mov|m4v|webm)$/i.test(name))throw Error('Choose MP4, MOV, M4V or WebM.');const dir=path.join(DATA,'uploads',randomUUID());await fs.mkdir(dir,{recursive:true});const file=path.join(dir,name);try{let bytes=0;const limiter=new Transform({transform(chunk,encoding,callback){bytes+=chunk.length;callback(bytes>300*1024**2?Error('Scene video exceeds 300 MB.'):null,chunk);}});await pipeline(req,limiter,createWriteStream(file,{flags:'wx'}));json(res,200,await stories.videos.import(file,name));}finally{await fs.unlink(file).catch(()=>{});await fs.rmdir(dir).catch(()=>{});}return;}
      if(req.method==='POST'&&url.pathname==='/api/story-voice') {
        store.checkIdentity(req.headers['x-agent-cut-project-id']);if(!req.headers['x-agent-cut-project-id'])throw Error('Project identity required.');
        const name=path.basename(decodeURIComponent(req.headers['x-file-name']||''));if(!['.wav','.mp3','.m4a','.flac','.ogg'].includes(path.extname(name).toLowerCase()))throw Error('Choose a WAV/MP3/M4A/FLAC/OGG voice reference.');
        const chunks=[];let bytes=0;for await(const chunk of req){bytes+=chunk.length;if(bytes>30*1024**2)throw Error('Voice reference exceeds 30 MB.');chunks.push(chunk);}
        const dir=path.join(DATA,'uploads',randomUUID());await fs.mkdir(dir,{recursive:true});const file=path.join(dir,name);
        try{await fs.writeFile(file,Buffer.concat(chunks));json(res,200,await (url.searchParams.get('engine')==='voxcpm2'?stories.voxcpm.importVoice(file,name,Number(url.searchParams.get('start')??0),Number(url.searchParams.get('seconds')??6)):stories.chatterbox.importVoice(file,name)));}finally{await fs.unlink(file).catch(()=>{});await fs.rmdir(dir).catch(()=>{});}return;
      }
      if(req.method==='GET'&&url.pathname.startsWith('/story-creator-audio/')){const p=await stories.creator.plan(url.pathname.slice(21));await fileResponse(req,res,store.assetPath(p.after.audio),'audio/wav');return;}
      if(req.method==='GET'&&url.pathname.startsWith('/story-resync-audio/')){const p=await stories.sync.readPlan(url.pathname.slice(20));await fileResponse(req,res,store.assetPath(p.after.audio),'audio/wav');return;}
      if(req.method==='POST'&&url.pathname==='/api/story-narration'){
        store.checkIdentity(req.headers['x-agent-cut-project-id']);if(!req.headers['x-agent-cut-project-id'])throw Error('Project identity required.');const name=path.basename(decodeURIComponent(req.headers['x-file-name']||''));if(!/\.(wav|mp3|m4a|flac|ogg)$/i.test(name))throw Error('Choose an audio narration file.');const dir=path.join(DATA,'uploads',randomUUID());await fs.mkdir(dir,{recursive:true});const file=path.join(dir,name);try{let bytes=0;const limiter=new Transform({transform(chunk,encoding,callback){bytes+=chunk.length;callback(bytes>200*1024**2?Error('Narration exceeds 200 MB.'):null,chunk);}});await pipeline(req,limiter,createWriteStream(file,{flags:'wx'}));json(res,200,await stories.sync.importAudio(file,name));}finally{await fs.unlink(file).catch(()=>{});await fs.rmdir(dir).catch(()=>{});}return;}
      if(req.method==='POST'&&url.pathname==='/api/story-image') {
        store.checkIdentity(req.headers['x-agent-cut-project-id']);if(!req.headers['x-agent-cut-project-id'])throw Error('Project identity required.');
        const name=path.basename(decodeURIComponent(req.headers['x-file-name']||''));
        if(!['.png','.jpg','.jpeg','.webp'].includes(path.extname(name).toLowerCase()))throw Error('Choose PNG, JPG or WebP.');
        const chunks=[];let bytes=0;for await(const chunk of req){bytes+=chunk.length;if(bytes>20*1024**2)throw Error('Image exceeds 20 MB.');chunks.push(chunk);}
        const dir=path.join(DATA,'uploads',randomUUID());await fs.mkdir(dir,{recursive:true});const file=path.join(dir,name);
        try{await fs.writeFile(file,Buffer.concat(chunks));json(res,200,await stories.importImage(file,name));}finally{await fs.unlink(file).catch(()=>{});await fs.rmdir(dir).catch(()=>{});}return;
      }
      if(req.method==='POST'&&url.pathname==='/api/upload') {
        store.checkIdentity(req.headers['x-agent-cut-project-id']);
        const name=path.basename(decodeURIComponent(req.headers['x-file-name']||''));const ext=path.extname(name).toLowerCase();
        if(!['.mp4','.mov','.mkv','.webm','.m4v','.avi','.mp3','.wav','.m4a','.flac','.ogg'].includes(ext))throw Error('Select a local video or audio file.');
        const dir=path.join(DATA,'uploads',randomUUID());await fs.mkdir(dir,{recursive:true});const file=path.join(dir,name);
        let size=0;req.on('data',chunk=>{size+=chunk.length;if(size>4e9)req.destroy();});
        try {await pipeline(req,createWriteStream(file,{flags:'wx'}));json(res,200,await store.import({path:file}));}finally{await fs.rm(dir,{recursive:true,force:true});}
        return;
      }
      if(req.method==='GET'&&url.pathname.startsWith('/media/')) {
        const key=url.pathname.slice(7),asset=store.db.project.assets.find(a=>a.id===key);if(!asset)throw Error('Unknown asset.');
        const mime={'.mp4':'video/mp4','.m4v':'video/mp4','.mov':'video/quicktime','.webm':'video/webm','.mkv':'video/x-matroska','.avi':'video/x-msvideo','.mp3':'audio/mpeg','.wav':'audio/wav','.m4a':'audio/mp4','.flac':'audio/flac','.ogg':'audio/ogg'}[path.extname(asset.file)];
        await fileResponse(req,res,store.assetPath(asset),mime);return;
      }
      if(req.method==='GET'&&url.pathname.startsWith('/exports/')) {
        const key=url.pathname.slice(9),job=renderer.jobs.get(key);if(job?.status!=='complete'||!job.path||['overview','spherical-suggestions','story-voice'].includes(job.kind)||job.evicted)throw Error('Export is not ready.');
        if(job.kind==='spherical-reframe')await spheres.read(job.id);
        const unpin=renderer.jobService.pin(job.id);try{const mov=path.extname(job.path)==='.mov';res.setHeader('Content-Disposition',(job.preview||job.kind==='spherical-reframe')?'inline':`attachment; filename="agent-cut-edit.${mov?'mov':'mp4'}"`);await fileResponse(req,res,job.path,mov?'video/quicktime':'video/mp4');}finally{unpin();}return;
      }
      json(res,404,{error:'Not found.'});
    }catch(e){if(!res.headersSent)json(res,400,{error:e.message,errorDetails:errorResult(e)});else res.destroy();}
  });
  const binding=await bindEditor(server,{port:PORT,existing,strict:process.env.AGENT_CUT_STRICT_PORT==='1'});
  if(binding.reused){runtime=binding.runtime;store=null;renderer=null;server=null;}
  else{runtime.port=binding.port;await atomic(RUNTIME,runtime);if(binding.fallback)process.stderr.write(`Agent Cut port ${PORT} is busy; using local port ${runtime.port} for ${DATA}.\n`);} 
}
async function call(name,args) {
  if(process.env.AGENT_CUT_COMPACT_MCP==='1'&&tools.find(t=>t.name===name)?.annotations.readOnlyHint===false&&!args?.expectedProjectId)throw new EditError('INVALID_ARGUMENT','Compact MCP mutations require expectedProjectId from a fresh project read.');
  if(store)return execute(name,args);
  const forwarded=await forwardRuntimeCall(runtime,{refresh:existing,send:current=>fetch(`http://127.0.0.1:${current.port}/api/call`,{method:'POST',headers:{'x-agent-cut-token':current.token,'Content-Type':'application/json'},body:JSON.stringify({name,arguments:args})})});
  runtime=forwarded.runtime;const res=forwarded.response;
  const value=await res.json();if(!res.ok)throw new EditError(value.errorDetails?.code||'OPERATION_FAILED',value.error,value.errorDetails?.details||{});return name==='editor_info'?{...value,compactMcp:process.env.AGENT_CUT_COMPACT_MCP==='1'}:value;
}
function content(value) {
  if(value.images){const {images,...meta}=value;return {content:[{type:'text',text:JSON.stringify({...meta,frames:images.map(({label,path})=>({label,path}))})},...images.flatMap(i=>[{type:'text',text:i.label},{type:'image',mimeType:i.mimeType,data:i.data}])],structuredContent:{...meta,frames:images.map(({label,path})=>({label,path}))}};}
  if(value.image) {const {image,...meta}=value;return {content:[{type:'text',text:JSON.stringify(meta)},{type:'image',mimeType:'image/png',data:image}]};}
  return {content:[{type:'text',text:JSON.stringify(value)}],structuredContent:value};
}
if(process.argv.includes('--stdio')) {
  let initialized=false;
  const rl=readline.createInterface({input:process.stdin,crlfDelay:Infinity});
  let chain=Promise.resolve();
  rl.on('line',line=>{chain=chain.then(async()=>{
    let message;try{message=JSON.parse(line);}catch{process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:null,error:{code:-32700,message:'Invalid JSON'}})+'\n');return;}
    if(message.id===undefined)return;
    let result,error;
    try {
      if(message.jsonrpc!=='2.0')throw Error('JSON-RPC 2.0 required.');
      switch(message.method) {
        case 'initialize': initialized=true;result={protocolVersion:'2025-06-18',capabilities:{tools:{}},serverInfo:{name:'agent-cut',version:'0.2.0'},instructions:'Local video editor. Start with project_read view=summary, then bounded windows and selected timeline_operations contracts. Supply project identity/revision before edits. Save a plan and use timeline_plan_preview for candidate evidence. Use frame_preview for committed proof. Do not claim speech understanding from silence detection.'};break;
        case 'ping':result={};break;
        case 'tools/list':if(!initialized)throw Error('Initialize first.');result={tools:advertisedTools(tools,process.env.AGENT_CUT_COMPACT_MCP==='1')};break;
        case 'tools/call':if(!initialized)throw Error('Initialize first.');try{result=content(await call(message.params.name,message.params.arguments||{}));}catch(e){result={isError:true,content:[{type:'text',text:e.message}],structuredContent:{error:errorResult(e)}};}break;
        default:error={code:-32601,message:'Method not found'};
      }
    }catch(e){error={code:-32602,message:e.message};}
    process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:message.id,...(error?{error}:{result})})+'\n');
  }).catch(e=>process.stderr.write(e.message+'\n'));});
  rl.on('close',()=>{chain.finally(()=>{if(server)server.close(()=>process.exit(0));else process.exit(0);});});
}else {console.log(`Agent Cut is ready: http://127.0.0.1:${runtime.port}\nProject folder: ${DATA}`);if(!server)process.exit(0);}
process.on('SIGTERM',()=>{if(server)server.close(()=>process.exit(0));else process.exit(0);});
