import {motionStyles} from './ui/caption-model.js';
import {fontIds,textStyleSchema} from './ui/text-model.js';
import {transitionKinds} from './transitions.mjs';
// Shared contract for HTTP/MCP, dry runs and engine commits. Dynamic timeline constraints remain in engine.mjs.

const field=(type,description)=>({type,description});

const effectsSchema={type:'object',additionalProperties:false,properties:Object.fromEntries([

  ...['brightness','contrast','saturation','scale','rotation','offsetX','offsetY','cropLeft','cropRight','cropTop','cropBottom','fadeIn','fadeOut','audioFadeIn','audioFadeOut','opacity'].map(k=>[k,field('number',k)]),

  ...['flipH','flipV'].map(k=>[k,field('boolean',k)])

])};

export const operationSchema={oneOf:[

  ['rename',{title:field('string','Project title')}],['canvas',{width:field('integer','Even width, 160–3840'),height:field('integer','Even height, 160–2160'),fps:field('integer','12–60')}],

  ['append',{assetId:field('string','An imported asset ID')},{sourceIn:field('number','Optional source seconds'),sourceOut:field('number','Optional source seconds')}],

  ['insert',{assetId:field('string','Video asset ID'),time:field('number','Insertion position in timeline seconds')},{sourceIn:field('number','Source in, default 0'),sourceOut:field('number','Source out, default asset duration')}],

  ['trim',{clipId:field('string','Clip ID'),sourceIn:field('number','Source in seconds'),sourceOut:field('number','Source out seconds')}],

  ['split',{clipId:field('string','Clip ID'),offset:field('number','Timeline seconds relative to the start of this clip')}],

  ['speed',{clipId:field('string','Clip ID'),speed:field('number','0.25–4')}],['volume',{clipId:field('string','Clip ID'),volume:field('number','0 mute, 1 original, maximum 2')}],

  ['rate_stretch',{clipId:field('string','Clip ID'),duration:field('number','Desired timeline seconds; preserve source range and calculate constant speed within 0.25–4')}],

  ['move',{clipId:field('string','Clip ID'),index:field('integer','Destination zero-based index')}],['delete',{clipId:field('string','Clip ID')}],

  ['caption',{text:field('string','Literal caption text, use newlines for wrapping'),start:field('number','Timeline seconds'),end:field('number','Timeline seconds')}],

  ['delete_caption',{captionId:field('string','Caption ID')}],['clear_captions',{}],['remove_range',{start:field('number','Timeline seconds inclusive'),end:field('number','Timeline seconds exclusive')}],['clear',{}],

  ['effects',{clipId:field('string','Clip ID'),values:effectsSchema}],

  ['transition',{clipId:field('string','Outgoing clip ID'),seconds:field('number','Dissolve duration in seconds; zero removes transition')}],

  ['slip',{clipId:field('string','Clip ID'),delta:field('number','Shift source in/out by source seconds, preserving timeline duration')}],

  ['roll',{clipId:field('string','Left clip ID at boundary'),delta:field('number','Move boundary by timeline seconds, preserving pair duration')}],

  ['slide',{clipId:field('string','Middle clip ID with both neighbors'),delta:field('number','Signed timeline seconds; preserve selected source range and total duration by trimming neighbors')}],

  ['duplicate',{clipId:field('string','Clip ID')},{index:field('integer','Optional zero-based insertion index')}],

  ['marker',{time:field('number','Timeline seconds'),label:field('string','Marker label')}],['delete_marker',{markerId:field('string','Marker ID')}],

  ['layer_add',{kind:{enum:['video','audio']},assetId:field('string','Imported asset ID'),start:field('number','Timeline start seconds'),sourceIn:field('number','Source in seconds'),sourceOut:field('number','Source out seconds')},{track:field('integer','Lane number'),volume:field('number','Audio volume'),speed:field('number','Playback speed')}],

  ['layer_delete',{layerId:field('string','Layer ID')}],

  ['layer_update',{layerId:field('string','Layer ID')},{start:field('number','Timeline start seconds'),sourceIn:field('number','Source in seconds'),sourceOut:field('number','Source out seconds'),track:field('integer','Lane number'),volume:field('number','Audio volume'),speed:field('number','Playback speed'),effects:effectsSchema}],

  ['set_range',{start:field('number','Timeline range start'),end:field('number','Timeline range end')}],['clear_range',{}]

].map(([type,required,optional={}])=>({type:'object',properties:{type:{const:type},...required,...optional},required:['type',...Object.keys(required)],additionalProperties:false}))};

const v2Definitions=[
 ['bin_add',{name:field('string','Bin name')}],['bin_update',{binId:field('string','Bin ID'),name:field('string','Bin name')}],['bin_delete',{binId:field('string','Bin ID')}],
 ['asset_update',{assetId:field('string','Asset ID')},{name:field('string','Display name'),binId:field('string','Bin ID, empty clears bin'),label:{enum:['none','red','orange','yellow','green','blue','purple']},notes:field('string','Up to 2000 literal characters'),tags:{type:'array',maxItems:20,items:field('string','Literal tag up to 40 characters')}}],
 ['item_attributes',{sequenceId:field('string','Sequence ID'),sourceItemId:field('string','Source item ID'),targetItemIds:{type:'array',minItems:1,maxItems:200,items:field('string','Target item ID')},properties:{type:'array',minItems:1,maxItems:6,items:{enum:['effects','keyframes','audio','mask','blendMode','volume']}}}],
 ['item_group',{sequenceId:field('string','Sequence ID'),itemIds:{type:'array',minItems:2,maxItems:200,items:field('string','Item ID')}}],['item_ungroup',{sequenceId:field('string','Sequence ID'),itemId:field('string','Grouped item ID')}],
 ['track_ducking',{sequenceId:field('string','Sequence ID'),trackId:field('string','Target audio track ID')},{sidechainTrackId:field('string','Control audio track; omit to clear ducking'),thresholdDb:field('number','Threshold -60 to 0 dB; default -30'),ratio:field('number','1–20; default 4'),attackMs:field('number','0.01–2000; default 20'),releaseMs:field('number','0.01–9000; default 250')}],
 ['item_audio_preset',{sequenceId:field('string','Sequence ID'),itemId:field('string','Audio item ID'),preset:{enum:['neutral','dialogue','music','sfx','ambience']}}],
 ['item_audio',{sequenceId:field('string','Sequence ID'),itemId:field('string','Audio item ID'),values:{type:'object',additionalProperties:false,properties:{...Object.fromEntries(['gainDb','pan','highpassHz','lowpassHz','lowEqDb','midEqDb','highEqDb','noiseReductionDb','deess','limiterDb'].map(k=>[k,field('number',k)])),channel:{enum:['stereo','left','right','mono']},humHz:{enum:[0,50,60]},compressor:{type:'object',additionalProperties:false,properties:Object.fromEntries(['thresholdDb','ratio','attackMs','releaseMs','makeupDb'].map(k=>[k,field('number',k)]))}}}},{replace:field('boolean','Replace processors rather than merge')}],
 ['track_audio',{sequenceId:field('string','Sequence ID'),trackId:field('string','Audio track ID'),values:{type:'object',additionalProperties:false,properties:{...Object.fromEntries(['gainDb','pan','highpassHz','lowpassHz','lowEqDb','midEqDb','highEqDb','noiseReductionDb','deess','limiterDb'].map(k=>[k,field('number',k)])),channel:{enum:['stereo','left','right','mono']},humHz:{enum:[0,50,60]},compressor:{type:'object',additionalProperties:false,properties:Object.fromEntries(['thresholdDb','ratio','attackMs','releaseMs','makeupDb'].map(k=>[k,field('number',k)]))}}}},{replace:field('boolean','Replace processors rather than merge')}],
 ['adjustment_layer_add',{sequenceId:field('string','Sequence ID'),name:field('string','Layer name'),start:field('number','Inclusive sequence seconds'),end:field('number','Exclusive sequence seconds'),values:{type:'object',additionalProperties:false,properties:Object.fromEntries(['brightness','contrast','saturation'].map(k=>[k,field('number','Correction '+k)]))}},{index:field('integer','Bottom-to-top track insertion index; default top')}],
 ['adjustment_update',{sequenceId:field('string','Sequence ID'),trackId:field('string','Video track ID'),adjustmentId:field('string','Span ID')},{name:field('string','Span name'),start:field('number','Inclusive sequence seconds'),end:field('number','Exclusive sequence seconds'),values:{type:'object',additionalProperties:false,properties:Object.fromEntries(['brightness','contrast','saturation'].map(k=>[k,field('number','Correction '+k)]))}}],
 ['adjustment_delete',{sequenceId:field('string','Sequence ID'),trackId:field('string','Video track ID'),adjustmentId:field('string','Span ID')}],

 ['item_mask',{sequenceId:field('string','Sequence ID'),itemId:field('string','Video item ID'),mask:{type:'object',additionalProperties:false,required:['shape'],properties:{shape:{enum:['rectangle','ellipse']},...Object.fromEntries(['x','y','width','height','feather','opacity'].map(k=>[k,field('number','Normalized source '+k)])),inverted:field('boolean','Keep outside the shape instead')}}}],

 ['item_mask_clear',{sequenceId:field('string','Sequence ID'),itemId:field('string','Video item ID')}],

 ['item_blend',{sequenceId:field('string','Sequence ID'),itemId:field('string','Video item ID'),mode:{enum:['normal','multiply','screen','darken','lighten','difference','addition']}}],

 ['item_keyframes',{sequenceId:field('string','Sequence ID'),itemId:field('string','Item ID'),property:{enum:['brightness','contrast','saturation','rotation','offsetX','offsetY','opacity','volume']},frames:{type:'array',minItems:1,maxItems:32,items:{type:'object',additionalProperties:false,required:['time','value'],properties:{time:field('number','Clip-local playback seconds'),value:field('number','Absolute animated value'),interpolation:{enum:['linear','hold','ease_in','ease_out','ease_in_out','bezier']},control1:field('number','Bezier value control 0-1; required only for bezier'),control2:field('number','Bezier value control 0-1; required only for bezier')}}}}],

 ['item_keyframes_clear',{sequenceId:field('string','Sequence ID'),itemId:field('string','Item ID')},{property:{enum:['brightness','contrast','saturation','rotation','offsetX','offsetY','opacity','volume']}}],

 ['project_rename',{title:field('string','Project title')}],

 ['sequence_settings',{sequenceId:field('string','Sequence ID')},{name:field('string','Sequence name'),width:field('integer','Even canvas width 160–3840'),height:field('integer','Even canvas height 160–2160'),fpsNumerator:field('integer','Frame rate numerator'),fpsDenominator:field('integer','Frame rate denominator')}],

 ['track_reorder',{sequenceId:field('string','Sequence ID'),trackId:field('string','Track ID'),index:field('integer','Bottom-to-top destination index')}],

 ['sequence_insert_gap',{sequenceId:field('string','Sequence ID'),time:field('number','Sequence insertion time'),duration:field('number','Gap duration') },{trackIds:{type:'array',minItems:1,maxItems:64,items:field('string','Also insert on these destination tracks')}}],

 ['sequence_razor',{sequenceId:field('string','Sequence ID'),time:field('number','Absolute cut time')},{targetedOnly:field('boolean','Only targeted tracks plus linked partners, default true')}],

 ['item_roll',{sequenceId:field('string','Sequence ID'),itemId:field('string','Left item ID'),delta:field('number','Signed sequence seconds')},{linked:field('boolean','Include linked media, default true')}],

 ['item_slide',{sequenceId:field('string','Sequence ID'),itemId:field('string','Middle item ID'),delta:field('number','Signed sequence seconds')},{linked:field('boolean','Include linked media, default true')}],

 ['item_trim',{sequenceId:field('string','Sequence ID'),itemId:field('string','Item ID'),sourceIn:field('number','New source in'),sourceOut:field('number','New source out')},{linked:field('boolean','Include linked media, default true')}],

 ['item_split',{sequenceId:field('string','Sequence ID'),itemId:field('string','Item ID'),time:field('number','Absolute sequence cut time')},{linked:field('boolean','Include linked media, default true')}],

 ['item_slip',{sequenceId:field('string','Sequence ID'),itemId:field('string','Item ID'),delta:field('number','Signed source seconds')},{linked:field('boolean','Include linked media, default true')}],

 ['item_rate',{sequenceId:field('string','Sequence ID'),itemId:field('string','Item ID'),duration:field('number','New timeline duration; preserve source range')},{linked:field('boolean','Include linked media, default true')}],
 ['item_freeze',{sequenceId:field('string','Sequence ID'),itemId:field('string','Video item ID'),sourceTime:field('number','Hold first decoded frame at or after source seconds; retain timeline duration and audio')}],
 ['item_freeze_clear',{sequenceId:field('string','Sequence ID'),itemId:field('string','Video item ID')}],
 ['item_speed_curve',{sequenceId:field('string','Sequence ID'),itemId:field('string','Item ID'),points:{type:'array',minItems:2,maxItems:32,items:{type:'object',additionalProperties:false,required:['time','speed'],properties:{time:field('number','Playback seconds; start at zero'),speed:field('number','Continuous linear speed 0.25–4')}}}},{linked:field('boolean','Include linked media, default true; audio pitch follows speed')}],
 ['item_speed_curve_clear',{sequenceId:field('string','Sequence ID'),itemId:field('string','Item ID')},{linked:field('boolean','Include linked media, default true; restore constant speed 1')}],
 ['item_reverse',{sequenceId:field('string','Sequence ID'),itemId:field('string','Item ID'),enabled:field('boolean','Reverse retained source range; false restores forward playback')},{linked:field('boolean','Include linked media, default true')}],
 ['sequence_nest_selection',{sequenceId:field('string','Parent sequence ID'),name:field('string','New source sequence name'),itemIds:{type:'array',minItems:1,maxItems:200,items:field('string','Selected item ID; includes linked/grouped media')} }],
 ['sequence_unnest',{sequenceId:field('string','Original parent sequence ID'),itemId:field('string','Selection nest video item ID; expand full unprocessed linked wrappers into original tracks')}],
 ['sequence_nest',{sequenceId:field('string','Parent sequence ID'),sourceSequenceId:field('string','Nested source sequence ID'),trackId:field('string','Destination video track ID'),time:field('number','Parent timeline start seconds')},{includeAudio:field('boolean','Create linked nested audio, default true')}],
 ['asset_remove',{assetId:field('string','Unreferenced library asset ID; managed files remain for undo')}],

 ['item_effects',{sequenceId:field('string','Sequence ID'),itemId:field('string','Item ID'),values:effectsSchema},{linked:field('boolean','Include linked media, default false'),replace:field('boolean','Replace rather than merge effects, default false')}],

 ['item_volume',{sequenceId:field('string','Sequence ID'),itemId:field('string','Item ID'),volume:field('number','Linear volume 0–2')},{linked:field('boolean','Include linked media, default true')}],

 ['sequence_remove_range',{sequenceId:field('string','Sequence ID'),start:field('number','Inclusive sequence seconds'),end:field('number','Exclusive sequence seconds')},{ripple:field('boolean','Close gap on sync-locked or targeted tracks, default true'),trackIds:{type:'array',minItems:1,maxItems:64,items:field('string','Explicit affected track ID')}}],

 ['sequence_caption',{sequenceId:field('string','Sequence ID'),text:field('string','Literal caption text'),start:field('number','Start seconds'),end:field('number','End seconds')},{captionId:field('string','Existing caption ID to update')}],

 ['sequence_caption_delete',{sequenceId:field('string','Sequence ID'),captionId:field('string','Caption ID')}],

 ['sequence_marker',{sequenceId:field('string','Sequence ID'),time:field('number','Sequence seconds'),label:field('string','Marker label')},{markerId:field('string','Existing marker ID to update')}],

 ['sequence_marker_delete',{sequenceId:field('string','Sequence ID'),markerId:field('string','Marker ID')}],

 ['sequence_range',{sequenceId:field('string','Sequence ID'),start:field('number','Export start seconds'),end:field('number','Export end seconds')}],

 ['sequence_range_clear',{sequenceId:field('string','Sequence ID')}],

 ['sequence_transition',{sequenceId:field('string','Sequence ID'),itemId:field('string','Outgoing video item ID'),seconds:field('number','Overlap transition duration 0–2; zero removes')},{kind:{enum:transitionKinds}}],

 ['item_add',{sequenceId:field('string','Sequence ID'),trackId:field('string','Destination video/audio track'),assetId:field('string','Imported asset ID'),time:field('number','Timeline start seconds')},{sourceIn:field('number','Source in, default 0'),sourceOut:field('number','Source out, default asset duration'),timelineOut:field('number','Three-point edit: derive source out from this exclusive sequence end; omit sourceOut'),speed:field('number','Constant speed 0.25–4; default 1'),volume:field('number','Audio volume 0–2; default 1'),mode:{enum:['place','insert','overwrite']},includeAudio:field('boolean','For video, create linked audio when available; default true'),audioTrackId:field('string','Optional existing linked-audio destination; otherwise create an audio track')}],

 ['sequence_create',{name:field('string','Sequence name')}],

 ['sequence_select',{sequenceId:field('string','Sequence ID')}],

 ['sequence_clear',{sequenceId:field('string','Sequence ID')}],

 ['track_add',{sequenceId:field('string','Sequence ID'),kind:{enum:['video','audio']},name:field('string','Track name')},{index:field('integer','Optional bottom-to-top insertion index')}],

 ['track_update',{sequenceId:field('string','Sequence ID'),trackId:field('string','Track ID')},{name:field('string','Track name'),locked:field('boolean','Prevent content edits'),muted:field('boolean','Mute contribution'),solo:field('boolean','Solo within media kind'),targeted:field('boolean','Target for future edits'),syncLocked:field('boolean','Participate in future ripple edits')}],

 ['track_delete',{sequenceId:field('string','Sequence ID'),trackId:field('string','Track ID')},{allowNonEmpty:field('boolean','Explicitly allow deleting populated track; default false')}],

 ['item_move',{sequenceId:field('string','Sequence ID'),itemId:field('string','Item ID'),time:field('number','New timeline start seconds')},{trackId:field('string','Optional destination track of matching media kind'),linked:field('boolean','Move linked items together; default true')}],

 ['item_lift',{sequenceId:field('string','Sequence ID'),itemId:field('string','Item ID')},{linked:field('boolean','Remove linked items together; default true')}]

];

v2Definitions.push(['adjustment_keyframes',{sequenceId:field('string','Sequence ID'),trackId:field('string','Video track ID'),adjustmentId:field('string','Span ID'),property:{enum:['brightness','contrast','saturation']},frames:v2Definitions.find(d=>d[0]==='item_keyframes')[1].frames}],['adjustment_keyframes_clear',{sequenceId:field('string','Sequence ID'),trackId:field('string','Video track ID'),adjustmentId:field('string','Span ID')},{property:{enum:['brightness','contrast','saturation']}}]);
for(const type of ['items_duplicate','items_move','items_lift'])v2Definitions.push([type,{sequenceId:field('string','Sequence ID'),itemIds:{type:'array',minItems:1,maxItems:200,items:field('string','Selected item ID')},...(type==='items_duplicate'?{time:field('number','Paste start, timeline seconds')}:type==='items_move'?{delta:field('number','Timeline offset seconds')}:{})},type==='items_duplicate'?{sourceDigest:field('string','Optional copied selection SHA-256; rejects changed source'),includeCaptions:field('boolean','Copy fully contained captions; crossing cues reject; default false')}:{ }]);
v2Definitions.push(['sequence_caption_style',{sequenceId:field('string','Sequence ID'),values:textStyleSchema},{replace:field('boolean','Replace defaults; empty resets'),motionFont:{enum:fontIds},motion:{enum:['none',...motionStyles.map(s=>s.id)],description:'captions.js preset; absent/none restores static captions. Word timing is estimated within cues.'}}],['graphic_text',{sequenceId:field('string','Sequence ID'),text:field('string','Literal title, 1–1000 characters'),start:field('number','Timeline start seconds'),end:field('number','Timeline end seconds')},{graphicId:field('string','Existing title ID'),style:textStyleSchema,clearStyle:field('boolean','Reset title style'),order:field('integer','Bottom-to-top text stack index')}],['graphic_delete',{sequenceId:field('string','Sequence ID'),graphicId:field('string','Title ID')}],['sequence_text_retime',{sequenceId:field('string','Sequence ID'),delta:field('number','Selected text offset seconds')},{captionIds:{type:'array',maxItems:500,items:field('string','Cue ID')},graphicIds:{type:'array',maxItems:200,items:field('string','Title ID')}}]);
Object.assign(v2Definitions.find(d=>d[0]==='sequence_caption')[2],{style:textStyleSchema,clearStyle:field('boolean','Reset cue override')});
for(const type of ['sequence_remove_range','sequence_insert_gap','item_add'])Object.assign(v2Definitions.find(d=>d[0]===type)[2],{captionPolicy:{enum:['retain','retime','regenerate_draft']},graphicPolicy:{enum:['retain','retime']}});
for(const type of ['sequence_create','track_add','item_add']){const entry=v2Definitions.find(d=>d[0]===type);entry[2]??={};entry[2].newId=field('string','Optional unique lowercase SHA256 ID for dependent operations in a single plan');}
export const v2OperationTypes=new Set(v2Definitions.map(d=>d[0]));

operationSchema.oneOf.push(...v2Definitions.map(([type,required,optional={}])=>({type:'object',properties:{type:{const:type},...required,...optional},required:['type',...Object.keys(required)],additionalProperties:false})));

export function validateObject(value,schema) {

  if(schema.oneOf) {if(!schema.oneOf.some(s=>{try{validateObject(value,s);return true;}catch{return false;}}))throw Error('Operation fields do not match a supported edit schema.');return;}

  if(schema.const!==undefined&&value!==schema.const)throw Error('Unexpected operation type.');

  if(schema.enum&&!schema.enum.includes(value))throw Error('Unsupported field value.');

  if(!schema.type)return;

  const valid=schema.type==='integer'?Number.isInteger(value):schema.type==='array'?Array.isArray(value):schema.type==='object'?value!==null&&typeof value==='object'&&!Array.isArray(value):typeof value===schema.type;

  if(!valid)throw Error(`Expected ${schema.type}.`);

  if(schema.type==='number'&&!Number.isFinite(value))throw Error('Expected finite number.');

  if(schema.type==='object') {

    for(const key of schema.required||[])if(!(key in value))throw Error(`Missing ${key}.`);

    for(const [key,v]of Object.entries(value)) {if(!schema.properties?.[key]){if(schema.additionalProperties===false)throw Error(`Unknown field ${key}.`);}else validateObject(v,schema.properties[key]);}

  }

  if(schema.type==='array') {if(value.length<(schema.minItems||0)||value.length>(schema.maxItems||Infinity))throw Error('Invalid list length.');for(const v of value)validateObject(v,schema.items);}

}



export const operationRegistry=Object.fromEntries(operationSchema.oneOf.map(schema=>[schema.properties.type.const,{schema,schemaVersion:v2OperationTypes.has(schema.properties.type.const)?2:1,destructive:['delete','clear','clear_captions','delete_caption','delete_marker','layer_delete','remove_range','item_lift','items_lift','graphic_delete','track_delete','sequence_clear','sequence_remove_range','sequence_caption_delete','sequence_marker_delete','adjustment_delete','bin_delete','item_attributes','asset_remove','sequence_nest_selection','sequence_unnest'].includes(schema.properties.type.const)}]));

export function validateOperation(op){const descriptor=Object.hasOwn(operationRegistry,op?.type)?operationRegistry[op.type]:null;if(!descriptor)throw Error('Unknown operation: '+op?.type);validateObject(op,descriptor.schema);return descriptor;}



export function operationIsDestructive(op){return Boolean(operationRegistry[op.type]?.destructive||op.type==='item_add'&&op.mode==='overwrite');}

operationRegistry.item_add.destructiveWhen={mode:'overwrite'};

