import {createHash} from 'node:crypto';
import {canonical} from './engine.mjs';
import {timeSeconds} from './sequences.mjs';
import {playbackAtSource} from './time-remap.mjs';
import {speechError as fail} from './speech-setup.mjs';

export const transcriptDigest=value=>createHash('sha256').update(canonical(value)).digest('hex');
export function transcriptText(text){
  if(typeof text!=='string'||!text.trim()||text.length>1000||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(text)||/[\uD800-\uDFFF]/u.test(text))fail('TRANSCRIPT_TEXT','Use literal valid Unicode text, 1–1000 UTF-16 units.');
  return text.trim();
}
export function validateSegments(segments,duration){
  if(!Array.isArray(segments)||segments.length>500)fail('TRANSCRIPT_LIMIT','At most 500 segments.');
  let end=0;
  return segments.map((s,index)=>{
    if(!Number.isFinite(s.start)||!Number.isFinite(s.end)||s.start<0||s.end<=s.start||s.end>duration+1e-7||s.start<end-1e-7)fail('TRANSCRIPT_TIMING','Segments must be ordered, non-overlapping and within source bounds.');
    end=s.end;return {id:'segment_'+index,start:s.start,end:s.end,rawText:transcriptText(s.text),text:transcriptText(s.text),...(s.clipped?{clipped:true}:{}),uncertainty:s.uncertainty??null};
  });
}
export function normalizeWhisper(raw,{start,end,decodedSeconds}){
  if(!Array.isArray(raw?.transcription)||raw.transcription.length>500)fail('TRANSCRIPT_FORMAT','Runner returned invalid segment JSON.');
  const duration=Math.min(end-start,decodedSeconds),warnings=[],segments=[];
  for(const s of raw.transcription){
    if(!Number.isFinite(s.offsets?.from)||!Number.isFinite(s.offsets?.to)||s.offsets.from<0||s.offsets.to<=s.offsets.from)fail('TRANSCRIPT_TIMING','Invalid runner timestamps.');
    const from=s.offsets.from/1000,to=s.offsets.to/1000;
    if(from>=duration){warnings.push('Dropped segment outside physically decoded range.');continue;}
    const clipped=to>duration;
    if(clipped)warnings.push('Clipped runner timestamp to physically decoded source range; review boundary text.');
    if(typeof s.text!=='string')fail('TRANSCRIPT_FORMAT','Missing segment text.');
    if(!s.text.trim())continue;
    segments.push({start:start+from,end:start+Math.min(to,duration),text:s.text,clipped,uncertainty:null});
  }
  return {segments:validateSegments(segments,end),warnings:[...new Set(warnings)]};
}

// These are proposed operations, never a mutation. The normal planner validates
// existing cue collisions and allocates stable IDs before any preview/application.
export function mapTranscriptCaptions(project,doc,{sequenceId,itemIds,segmentIds}){
  if(project.schemaVersion!==2)fail('V2_REQUIRED','Review and explicitly activate the v2 migration before caption mapping.');
  const sequence=project.sequences.find(s=>s.id===(sequenceId||project.activeSequenceId));
  if(!sequence||!Array.isArray(itemIds)||!itemIds.length||itemIds.length>20||new Set(itemIds).size!==itemIds.length)fail('TRANSCRIPT_MAPPING','Select 1–20 distinct timeline item IDs.');
  if(segmentIds&&(!Array.isArray(segmentIds)||!segmentIds.length||new Set(segmentIds).size!==segmentIds.length||segmentIds.some(id=>!doc.segments.some(s=>s.id===id))))fail('TRANSCRIPT_MAPPING','Unknown/duplicate segment selection.');
  const selected=doc.segments.filter(s=>!segmentIds||segmentIds.includes(s.id)),operations=[],evidence=[],warnings=[];
  for(const itemId of itemIds){
    const track=sequence.tracks.find(t=>t.items.some(i=>i.id===itemId)),item=track?.items.find(i=>i.id===itemId);
    if(!item||item.assetId!==doc.assetId)fail('TRANSCRIPT_MAPPING','Each selected item must use the transcript source.');
    if(track.locked)fail('TRACK_LOCKED','Selected source track is locked.');
    const asset=project.assets.find(a=>a.id===item.assetId);
    if(asset?.kind==='sequence'||item.reverse||item.frameHold)fail('TRANSCRIPT_MAPPING','Reverse, held and nested sources require manually placed captions.');
    const inverse=value=>timeSeconds(item.start)+(item.speedCurve?playbackAtSource(item.speedCurve,Math.max(0,Math.min(item.sourceOut-item.sourceIn,value-item.sourceIn))):(value-item.sourceIn)/item.speed);
    for(const segment of selected){
      const sourceStart=Math.max(segment.start,item.sourceIn),sourceEnd=Math.min(segment.end,item.sourceOut);
      if(sourceEnd<=sourceStart)continue;
      const start=inverse(sourceStart),end=inverse(sourceEnd),clipped=sourceStart!==segment.start||sourceEnd!==segment.end||!!segment.clipped;
      operations.push({type:'sequence_caption',sequenceId:sequence.id,start,end,text:segment.text});
      evidence.push({segmentId:segment.id,itemId,sourceStart,sourceEnd,start,end,clipped});
      if(clipped)warnings.push('Some segment text crosses a trim; the whole text is retained with clipped timing. Review it before applying.');
    }
  }
  if(!operations.length||operations.length>200)fail('TRANSCRIPT_MAPPING','Choose a range producing 1–200 cues per plan.');
  const sorted=[...operations].sort((a,b)=>a.start-b.start);
  if(sorted.some((s,i)=>i&&s.start<sorted[i-1].end-1e-7))fail('TRANSCRIPT_MAPPING','Selected items produce overlapping cues. Choose one linked partner or a narrower selection.');
  return {operations,evidence,warnings:[...new Set(warnings)],timing:'Estimated segment boundaries; no word alignment. Existing captions are retained; conflicting cues reject.'};
}
