// Recipe inputs are closed here, independently of the compact MCP envelope.
const str={type:'string'},num={type:'number'},obj=(properties,required=Object.keys(properties))=>({type:'object',additionalProperties:false,properties,required}),ids={type:'array',minItems:1,maxItems:100,items:str};
const common={sequenceId:str,captionPolicy:{enum:['retain','retime']},graphicPolicy:{enum:['retain','retime']}};
const assembly={name:str,aspect:{enum:['landscape','portrait','square','current']},transitionSeconds:num,captionPolicy:{enum:['omit','draft']},targetSeconds:num,title:obj({text:str,seconds:num},['text']),music:obj({assetId:str,sourceIn:num,volume:num,fadeSeconds:num,duck:{type:'boolean'}},['assetId','sourceIn','volume','fadeSeconds','duck'])};
export const recipeContracts={
 opening:obj({...common,itemId:str,transcriptId:str,expectedAnalysisRevision:{type:'integer'},segmentId:str},['itemId','transcriptId','expectedAnalysisRevision','segmentId','captionPolicy','graphicPolicy']),
 excerpt:obj({...assembly,selections:{type:'array',minItems:1,maxItems:12,items:obj({itemId:str,transcriptId:str,expectedAnalysisRevision:{type:'integer'},segmentIds:ids})}},['name','captionPolicy','selections']),
 highlight:obj({...assembly,selections:{type:'array',minItems:1,maxItems:12,items:obj({itemId:str,transcriptId:str,expectedAnalysisRevision:{type:'integer'},segmentIds:ids})}},['name','captionPolicy','selections']),
 montage:obj({...assembly,captionPolicy:{enum:['omit']},clips:{type:'array',minItems:1,maxItems:12,items:obj({assetId:str,start:num,end:num})}},['name','captionPolicy','clips']),
 pause_cut:obj({...common,itemId:str,evidenceId:str,pauseIds:ids,paddingSeconds:num},['itemId','evidenceId','pauseIds','paddingSeconds','captionPolicy','graphicPolicy']),
 pause_analyze:obj({assetId:str,start:num,end:num,noiseDb:num,minSeconds:num},['assetId','start','end','noiseDb','minSeconds'])
};
export const recipeLimits={clips:12,operations:200,assemblySeconds:120,pauseAnalysisSeconds:120,highlightTargetSeconds:30,coordinates:'Transcript/pause evidence uses source seconds; cut ranges and operations use timeline seconds.',behavior:'Plans only. No automatic strongest-moment selection, semantic silence claims, stretching, repetition, model downloads or project migration.'};
